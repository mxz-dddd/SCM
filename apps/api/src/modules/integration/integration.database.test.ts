import { createHash, createHmac, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IdempotencyService } from '../platform/idempotency.service';
import { ChangeRecordingFacade } from '../platform/public/change-recording.facade';
import { IdempotencyExecutionFacade } from '../platform/public/idempotency-execution.facade';
import { ApiContractService } from './api-contract.service';
import {
  deriveGatewaySecret,
  GatewayService,
  type GatewayAuthorizationInput,
} from './gateway.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();
const masterKey = 'integration-gateway-test-master-key-32-characters';

const context = (tenantId = randomUUID()): TenantContext => ({
  accountId: randomUUID(),
  accountKind: 'TENANT_ADMIN',
  deviceId: 'integration-gateway-database-test',
  organizationIds: [],
  permissionVersion: 1,
  tenantId,
  tokenId: randomUUID(),
});
const command = () => ({
  correlationId: randomUUID(),
  idempotencyKey: randomUUID(),
  ipAddress: '127.0.0.1',
});
const policyInput = (
  overrides: Partial<{
    allowedIps: readonly string[];
    dailyLimit: number;
    perMinuteLimit: number;
    requiredScopes: readonly string[];
  }> = {},
) => ({
  allowedIps: overrides.allowedIps ?? ['127.0.0.1'],
  code: `POLICY-${randomUUID()}`,
  dailyLimit: overrides.dailyLimit ?? 100,
  maxRequestBytes: 10_000,
  name: 'Order API policy',
  perMinuteLimit: overrides.perMinuteLimit ?? 20,
  requiredScopes: overrides.requiredScopes ?? ['orders.write'],
  routePattern: '/api/v1/external/orders*',
  sensitiveDailyLimit: Math.min(overrides.dailyLimit ?? 100, 10),
});
const authorize = (
  secret: string,
  keyId: string,
  overrides: Partial<GatewayAuthorizationInput> = {},
): GatewayAuthorizationInput => ({
  body: { externalOrderNo: 'SO-1' },
  ipAddress: '127.0.0.1',
  keyId,
  method: 'POST',
  requestBytes: 120,
  route: '/api/v1/external/orders',
  secret,
  type: 'API_KEY',
  ...overrides,
});

databaseDescribe('Integration API gateway and OpenAPI governance', () => {
  let gateway: GatewayService;
  let contracts: ApiContractService;

  beforeAll(() => {
    process.env.API_CREDENTIAL_MASTER_KEY = masterKey;
    const changes = new ChangeRecordingFacade();
    gateway = new GatewayService(
      prisma as never,
      changes,
      new IdempotencyExecutionFacade(new IdempotencyService(prisma as never)),
    );
    contracts = new ApiContractService(prisma as never, changes);
  });
  afterAll(() => prisma.$disconnect());

  it('authorizes API key, HMAC, mTLS and replay-safe OAuth client credentials', async () => {
    const actor = context();
    const policy = await gateway.createPolicy(policyInput(), actor, command());
    await gateway.transitionPolicy(
      policy.id,
      { expectedVersion: 1, target: 'ACTIVE' },
      actor,
      command(),
    );
    const apiKey = await gateway.createCredential(
      { name: 'API key', scopes: ['orders.write'], type: 'API_KEY' },
      actor,
      command(),
    );
    await expect(
      gateway.authorize(authorize(apiKey.secret!, apiKey.keyId)),
    ).resolves.toMatchObject({ allowed: true, tenantId: actor.tenantId });

    const hmac = await gateway.createCredential(
      { name: 'HMAC client', scopes: ['orders.write'], type: 'HMAC' },
      actor,
      command(),
    );
    const timestamp = new Date().toISOString();
    const body = { externalOrderNo: 'SO-HMAC' };
    const bodyHash = createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex');
    const signature = createHmac('sha256', hmac.secret!)
      .update(`${timestamp}\nPOST\n/api/v1/external/orders\n${bodyHash}`)
      .digest('hex');
    await expect(
      gateway.authorize({
        body,
        ipAddress: '127.0.0.1',
        keyId: hmac.keyId,
        method: 'POST',
        requestBytes: 130,
        route: '/api/v1/external/orders',
        signature,
        timestamp,
        type: 'HMAC',
      }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      gateway.authorize({
        body,
        ipAddress: '127.0.0.1',
        keyId: hmac.keyId,
        method: 'POST',
        requestBytes: 130,
        route: '/api/v1/external/orders',
        signature,
        timestamp,
        type: 'HMAC',
      }),
    ).rejects.toMatchObject({ code: 'GATEWAY_HMAC_REPLAYED', statusCode: 401 });

    const fingerprint = 'AA:BB:CC:DD:EE:FF';
    const mtls = await gateway.createCredential(
      {
        certificateFingerprint: fingerprint,
        name: 'mTLS client',
        scopes: ['orders.write'],
        type: 'MTLS',
      },
      actor,
      command(),
    );
    expect(mtls).not.toHaveProperty('secret');
    await expect(
      gateway.authorize({
        certificateFingerprint: fingerprint,
        ipAddress: '127.0.0.1',
        keyId: mtls.keyId,
        method: 'POST',
        requestBytes: 80,
        route: '/api/v1/external/orders',
        type: 'MTLS',
      }),
    ).resolves.toMatchObject({ allowed: true });

    const oauth = await gateway.createCredential(
      {
        name: 'OAuth client',
        scopes: ['orders.write', 'orders.read'],
        type: 'OAUTH2_CLIENT',
      },
      actor,
      command(),
    );
    const tokenKey = randomUUID();
    const firstToken = await gateway.issueToken(
      {
        clientId: oauth.keyId,
        clientSecret: oauth.secret!,
        scopes: ['orders.write'],
      },
      tokenKey,
    );
    const replayToken = await gateway.issueToken(
      {
        clientId: oauth.keyId,
        clientSecret: oauth.secret!,
        scopes: ['orders.write'],
      },
      tokenKey,
    );
    expect(replayToken).toEqual(firstToken);
    await expect(
      gateway.issueToken(
        {
          clientId: oauth.keyId,
          clientSecret: oauth.secret!,
          scopes: ['orders.read'],
        },
        tokenKey,
      ),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_CONFLICT',
      statusCode: 409,
    });
    await expect(
      gateway.authorize({
        accessToken: firstToken.accessToken,
        ipAddress: '127.0.0.1',
        method: 'POST',
        requestBytes: 100,
        route: '/api/v1/external/orders',
        type: 'OAUTH2_CLIENT',
      }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it('rotates credentials atomically and rejects the previous secret', async () => {
    const actor = context();
    const policy = await gateway.createPolicy(policyInput(), actor, command());
    await gateway.transitionPolicy(
      policy.id,
      { expectedVersion: 1, target: 'ACTIVE' },
      actor,
      command(),
    );
    const oldCredential = await gateway.createCredential(
      { name: 'Rotating API key', scopes: ['orders.write'], type: 'API_KEY' },
      actor,
      command(),
    );
    const replacement = await gateway.rotateCredential(
      oldCredential.credentialId,
      { expectedVersion: 1 },
      actor,
      command(),
    );
    await expect(
      gateway.authorize(authorize(oldCredential.secret!, oldCredential.keyId)),
    ).rejects.toMatchObject({ code: 'GATEWAY_CREDENTIAL_INACTIVE' });
    await expect(
      gateway.authorize(authorize(replacement.secret!, replacement.keyId)),
    ).resolves.toMatchObject({ allowed: true });
    expect(
      await prisma.integrationApiCredential.findUnique({
        where: { id: oldCredential.credentialId },
      }),
    ).toMatchObject({
      rotatedToCredentialId: replacement.credentialId,
      status: 'ROTATED',
      version: 2,
    });
  });

  it('serializes concurrent quota checks and preserves every decision and log', async () => {
    const actor = context();
    const policy = await gateway.createPolicy(
      policyInput({ perMinuteLimit: 2 }),
      actor,
      command(),
    );
    await gateway.transitionPolicy(
      policy.id,
      { expectedVersion: 1, target: 'ACTIVE' },
      actor,
      command(),
    );
    const credential = await gateway.createCredential(
      { name: 'Concurrent key', scopes: ['orders.write'], type: 'API_KEY' },
      actor,
      command(),
    );
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, (_, index) =>
        gateway.authorize(
          authorize(credential.secret!, credential.keyId, {
            body: { externalOrderNo: `SO-CONCURRENT-${index}` },
          }),
        ),
      ),
    );
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      2,
    );
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({
        code: 'GATEWAY_RATE_LIMIT_EXCEEDED',
        statusCode: 429,
      }),
    });
    expect(
      await prisma.integrationRateLimitDecision.count({
        where: {
          credentialId: credential.credentialId,
          tenantId: actor.tenantId,
        },
      }),
    ).toBe(3);
    expect(
      await prisma.integrationGatewayLog.count({
        where: {
          credentialId: credential.credentialId,
          tenantId: actor.tenantId,
        },
      }),
    ).toBe(3);
    await expect(
      prisma.integrationGatewayLog.update({
        data: { reasonCode: 'TAMPERED' },
        where: {
          id: (
            await prisma.integrationGatewayLog.findFirstOrThrow({
              where: { credentialId: credential.credentialId },
            })
          ).id,
        },
      }),
    ).rejects.toBeDefined();
  });

  it('enforces IP, scope, request size and sensitive daily policy decisions', async () => {
    const actor = context();
    const policy = await gateway.createPolicy(
      {
        ...policyInput({ dailyLimit: 3, requiredScopes: ['orders.sensitive'] }),
        maxRequestBytes: 10,
        sensitiveDailyLimit: 1,
      },
      actor,
      command(),
    );
    await gateway.transitionPolicy(
      policy.id,
      { expectedVersion: 1, target: 'ACTIVE' },
      actor,
      command(),
    );
    const credential = await gateway.createCredential(
      { name: 'Restricted key', scopes: ['orders.read'], type: 'API_KEY' },
      actor,
      command(),
    );
    await expect(
      gateway.authorize(
        authorize(credential.secret!, credential.keyId, {
          ipAddress: '10.0.0.1',
          requestBytes: 50,
        }),
      ),
    ).rejects.toMatchObject({ code: 'GATEWAY_IP_DENIED', statusCode: 403 });
    await expect(
      gateway.authorize(
        authorize(credential.secret!, credential.keyId, {
          ipAddress: '127.0.0.1',
          requestBytes: 50,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'GATEWAY_REQUEST_TOO_LARGE',
      statusCode: 413,
    });
    await expect(
      gateway.authorize(
        authorize(credential.secret!, credential.keyId, {
          ipAddress: '127.0.0.1',
          requestBytes: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'GATEWAY_SCOPE_DENIED', statusCode: 403 });
    const reasons = await prisma.integrationRateLimitDecision.findMany({
      select: { reasonCode: true },
      where: { credentialId: credential.credentialId },
    });
    expect(reasons).toContainEqual({ reasonCode: 'GATEWAY_IP_DENIED' });
  });

  it('publishes machine-readable versions, requires a new major for breaking changes and records deprecation', async () => {
    const actor = context();
    const definition = await contracts.createDefinition(
      {
        name: `orders-${randomUUID()}`,
        routeBase: '/api/v1/orders',
        title: 'Orders API',
      },
      actor,
      command(),
    );
    const specification = {
      info: { title: 'Orders API', version: '1.0.0' },
      openapi: '3.1.0',
      paths: {
        '/orders': {
          post: { responses: { '201': { description: 'Created' } } },
        },
      },
    };
    const v1 = await contracts.createVersion(
      definition.id,
      {
        errorCodes: [{ code: 'ORDER_INVALID', message: 'Order is invalid' }],
        examples: { createOrder: { externalOrderNo: 'SO-1' } },
        semanticVersion: '1.0.0',
        specification,
      },
      actor,
      command(),
    );
    const published = await contracts.publishVersion(
      v1.id,
      { expectedVersion: 1 },
      actor,
      command(),
    );
    expect(published.status).toBe('PUBLISHED');
    const breakingV1 = await contracts.createVersion(
      definition.id,
      {
        breakingChange: true,
        errorCodes: [{ code: 'ORDER_INVALID', message: 'Order is invalid' }],
        examples: { createOrder: { externalOrderNo: 'SO-2' } },
        semanticVersion: '1.1.0',
        specification: {
          ...specification,
          info: { title: 'Orders API', version: '1.1.0' },
        },
      },
      actor,
      command(),
    );
    await expect(
      contracts.publishVersion(
        breakingV1.id,
        { expectedVersion: 1 },
        actor,
        command(),
      ),
    ).rejects.toMatchObject({
      code: 'API_BREAKING_CHANGE_REQUIRES_MAJOR_VERSION',
      statusCode: 409,
    });
    const deprecated = await contracts.deprecateVersion(
      v1.id,
      {
        deprecationDate: '2030-01-01T00:00:00.000Z',
        expectedVersion: 2,
        replacementVersion: '2.0.0',
        summary: 'Use Orders API v2',
        sunsetDate: '2030-07-01T00:00:00.000Z',
      },
      actor,
      command(),
    );
    expect(deprecated.version.status).toBe('DEPRECATED');
    const publicContract = await contracts.publicSpecification(
      actor.tenantId,
      definition.name,
      '1.0.0',
    );
    expect(publicContract).toMatchObject({
      deprecation: { replacementVersion: '2.0.0' },
      specification: { openapi: '3.1.0' },
      version: '1.0.0',
    });
    await expect(
      prisma.integrationDeprecationNotice.update({
        data: { summary: 'TAMPERED' },
        where: { id: deprecated.notice.id },
      }),
    ).rejects.toBeDefined();
  });

  it('keeps tenant workbenches isolated and never returns credential hashes', async () => {
    const tenantA = context();
    const tenantB = context();
    const credential = await gateway.createCredential(
      { name: 'Tenant A only', scopes: ['orders.write'], type: 'API_KEY' },
      tenantA,
      command(),
    );
    const viewA = await gateway.workbench(tenantA);
    const viewB = await gateway.workbench(tenantB);
    expect(viewA.credentials).toContainEqual(
      expect.objectContaining({ id: credential.credentialId }),
    );
    expect(viewB.credentials).not.toContainEqual(
      expect.objectContaining({ id: credential.credentialId }),
    );
    expect(JSON.stringify(viewA)).not.toContain('secretHash');
    expect(
      deriveGatewaySecret(masterKey, tenantA.tenantId, credential.keyId),
    ).toBe(credential.secret);
  });
});

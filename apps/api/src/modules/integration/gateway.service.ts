import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type IntegrationCredentialType } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../database/prisma.service';
import { ChangeRecordingFacade } from '../platform/public/change-recording.facade';
import { IdempotencyExecutionFacade } from '../platform/public/idempotency-execution.facade';
import type { CommandMetadata } from '../platform/tenant.service';

type JsonObject = Readonly<Record<string, unknown>>;

export interface SaveGatewayPolicyInput {
  readonly allowedIps?: readonly string[];
  readonly code: string;
  readonly dailyLimit: number;
  readonly maxRequestBytes: number;
  readonly name: string;
  readonly perMinuteLimit: number;
  readonly requiredScopes?: readonly string[];
  readonly routePattern: string;
  readonly sensitiveDailyLimit: number;
}

export interface CreateGatewayCredentialInput {
  readonly allowedIps?: readonly string[];
  readonly certificateFingerprint?: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly type: IntegrationCredentialType;
  readonly validUntil?: string;
}

export interface GatewayAuthorizationInput {
  readonly accessToken?: string;
  readonly body?: unknown;
  readonly certificateFingerprint?: string;
  readonly correlationId?: string;
  readonly ipAddress: string;
  readonly keyId?: string;
  readonly method: string;
  readonly requestBytes: number;
  readonly route: string;
  readonly secret?: string;
  readonly sensitive?: boolean;
  readonly signature?: string;
  readonly timestamp?: string;
  readonly type: IntegrationCredentialType;
}

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
const list = (value: Prisma.JsonValue): string[] =>
  Array.isArray(value) ? value.map(String) : [];
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;

export function deriveGatewaySecret(
  masterKey: string,
  tenantId: string,
  keyId: string,
): string {
  if (masterKey.length < 32)
    throw new AppError(
      'GATEWAY_MASTER_KEY_INVALID',
      'API_CREDENTIAL_MASTER_KEY must contain at least 32 characters',
      500,
    );
  return `scmg_${createHmac('sha256', masterKey)
    .update(`${tenantId}:${keyId}`)
    .digest('base64url')}`;
}

@Injectable()
export class GatewayService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChangeRecordingFacade)
    private readonly changes: ChangeRecordingFacade,
    @Inject(IdempotencyExecutionFacade)
    private readonly idempotency: IdempotencyExecutionFacade,
  ) {}

  async workbench(context: TenantContext) {
    const where = { tenantId: context.tenantId };
    const [policies, credentials, decisions, logs] = await Promise.all([
      this.prisma.integrationGatewayPolicy.findMany({
        orderBy: { updatedAt: 'desc' },
        where,
      }),
      this.prisma.integrationApiCredential.findMany({
        orderBy: { updatedAt: 'desc' },
        select: {
          allowedIps: true,
          certificateFingerprint: true,
          createdAt: true,
          credentialType: true,
          id: true,
          keyId: true,
          lastUsedAt: true,
          name: true,
          rotatedToCredentialId: true,
          scopes: true,
          status: true,
          validFrom: true,
          validUntil: true,
          version: true,
        },
        where,
      }),
      this.prisma.integrationRateLimitDecision.findMany({
        orderBy: { decidedAt: 'desc' },
        take: 100,
        where,
      }),
      this.prisma.integrationGatewayLog.findMany({
        orderBy: { occurredAt: 'desc' },
        take: 100,
        where,
      }),
    ]);
    return { credentials, decisions, logs, policies };
  }

  async createPolicy(
    input: SaveGatewayPolicyInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = this.text(input.code, 'code', 100).toUpperCase();
    const name = this.text(input.name, 'name', 200);
    const routePattern = this.route(input.routePattern);
    this.positive(input.maxRequestBytes, 'maxRequestBytes');
    this.positive(input.perMinuteLimit, 'perMinuteLimit');
    this.positive(input.dailyLimit, 'dailyLimit');
    this.positive(input.sensitiveDailyLimit, 'sensitiveDailyLimit');
    if (input.sensitiveDailyLimit > input.dailyLimit)
      this.invalid('sensitiveDailyLimit must not exceed dailyLimit');
    const requiredScopes = this.values(input.requiredScopes ?? [], 'scope');
    const allowedIps = this.values(input.allowedIps ?? [], 'IP');
    return this.prisma.$transaction(async (tx) => {
      const policy = await tx.integrationGatewayPolicy.create({
        data: {
          allowedIps: json(allowedIps),
          code,
          createdBy: context.accountId,
          dailyLimit: input.dailyLimit,
          maxRequestBytes: input.maxRequestBytes,
          name,
          perMinuteLimit: input.perMinuteLimit,
          requiredScopes: json(requiredScopes),
          routePattern,
          sensitiveDailyLimit: input.sensitiveDailyLimit,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        policy.id,
        policy.version,
        'integration.gateway-policy-created.v1',
        context,
        metadata,
        { code, status: policy.status },
      );
      return policy;
    });
  }

  transitionPolicy(
    id: string,
    input: {
      readonly expectedVersion: number;
      readonly target: 'ACTIVE' | 'RETIRED';
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const policy = await tx.integrationGatewayPolicy.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!policy) this.notFound('GATEWAY_POLICY_NOT_FOUND', 'Gateway policy');
      this.version(policy.version, input.expectedVersion);
      const allowed =
        (policy.status === 'DRAFT' && input.target === 'ACTIVE') ||
        (policy.status === 'ACTIVE' && input.target === 'RETIRED');
      if (!allowed)
        throw new AppError(
          'GATEWAY_POLICY_TRANSITION_INVALID',
          `Cannot transition gateway policy from ${policy.status} to ${input.target}`,
          409,
        );
      const changed = await tx.integrationGatewayPolicy.update({
        data: {
          ...(input.target === 'ACTIVE' ? { activatedAt: new Date() } : {}),
          ...(input.target === 'RETIRED' ? { retiredAt: new Date() } : {}),
          status: input.target,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        changed.version,
        `integration.gateway-policy-${input.target.toLowerCase()}.v1`,
        context,
        metadata,
        { status: changed.status },
      );
      return changed;
    });
  }

  createCredential(
    input: CreateGatewayCredentialInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const created = await this.insertCredential(tx, input, context);
      await this.record(
        tx,
        created.credential.id,
        1,
        'integration.api-credential-created.v1',
        context,
        metadata,
        {
          credentialType: created.credential.credentialType,
          keyId: created.credential.keyId,
          status: created.credential.status,
        },
      );
      return this.credentialResponse(created.credential, created.secret);
    });
  }

  rotateCredential(
    id: string,
    input: {
      readonly certificateFingerprint?: string;
      readonly expectedVersion: number;
      readonly validUntil?: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.integrationApiCredential.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!current) this.notFound('API_CREDENTIAL_NOT_FOUND', 'API credential');
      this.version(current.version, input.expectedVersion);
      if (current.status !== 'ACTIVE')
        throw new AppError(
          'API_CREDENTIAL_NOT_ACTIVE',
          'Only active credentials can be rotated',
          409,
        );
      const created = await this.insertCredential(
        tx,
        {
          allowedIps: list(current.allowedIps),
          ...(input.certificateFingerprint || current.certificateFingerprint
            ? {
                certificateFingerprint:
                  input.certificateFingerprint ??
                  current.certificateFingerprint!,
              }
            : {}),
          name: current.name,
          scopes: list(current.scopes),
          type: current.credentialType,
          ...(input.validUntil
            ? { validUntil: input.validUntil }
            : current.validUntil
              ? { validUntil: current.validUntil.toISOString() }
              : {}),
        },
        context,
      );
      const rotated = await tx.integrationApiCredential.update({
        data: {
          rotatedToCredentialId: created.credential.id,
          status: 'ROTATED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        rotated.version,
        'integration.api-credential-rotated.v1',
        context,
        metadata,
        {
          rotatedToCredentialId: created.credential.id,
          status: rotated.status,
        },
      );
      return this.credentialResponse(created.credential, created.secret);
    });
  }

  revokeCredential(
    id: string,
    input: { readonly expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.integrationApiCredential.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!current) this.notFound('API_CREDENTIAL_NOT_FOUND', 'API credential');
      this.version(current.version, input.expectedVersion);
      if (current.status !== 'ACTIVE')
        throw new AppError(
          'API_CREDENTIAL_NOT_ACTIVE',
          'Only active credentials can be revoked',
          409,
        );
      const changed = await tx.integrationApiCredential.update({
        data: {
          status: 'REVOKED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await tx.integrationAccessToken.updateMany({
        data: {
          revokedAt: new Date(),
          status: 'REVOKED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          credentialId: id,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      await this.record(
        tx,
        id,
        changed.version,
        'integration.api-credential-revoked.v1',
        context,
        metadata,
        { status: changed.status },
      );
      return {
        credentialId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async issueToken(
    input: {
      readonly clientId: string;
      readonly clientSecret: string;
      readonly scopes?: readonly string[];
    },
    idempotencyKey: string | undefined,
  ) {
    const credential = await this.prisma.integrationApiCredential.findFirst({
      where: { keyId: input.clientId },
    });
    if (!credential || credential.credentialType !== 'OAUTH2_CLIENT')
      this.auth('GATEWAY_CREDENTIAL_INVALID', 'OAuth client is invalid');
    this.assertActive(credential);
    this.assertSecret(credential, input.clientSecret);
    const permitted = list(credential.scopes);
    const requested = this.values(input.scopes ?? permitted, 'scope');
    if (requested.some((scope) => !permitted.includes(scope)))
      this.auth('GATEWAY_SCOPE_DENIED', 'Requested OAuth scope is not allowed');
    return this.idempotency.execute(
      {
        actorId: credential.id,
        key: idempotencyKey,
        payload: input,
        responseCode: 201,
        scope: 'integration.oauth-token.issue.v1',
        tenantId: credential.tenantId,
      },
      async (tx) => {
        const token = `scmt_${randomBytes(32).toString('base64url')}`;
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        await tx.integrationAccessToken.create({
          data: {
            createdBy: credential.id,
            credentialId: credential.id,
            expiresAt,
            scopes: json(requested),
            tenantId: credential.tenantId,
            tokenHash: sha256(token),
            updatedBy: credential.id,
          },
        });
        return {
          accessToken: token,
          expiresAt: expiresAt.toISOString(),
          scope: requested.join(' '),
          tokenType: 'Bearer',
        };
      },
    );
  }

  async authorize(input: GatewayAuthorizationInput) {
    const authenticated = await this.authenticate(input);
    const correlationId = input.correlationId?.trim() || randomUUID();
    if (correlationId.length > 100)
      this.invalid('correlationId must not exceed 100 characters');
    this.text(input.route, 'route', 300);
    this.text(input.method, 'method', 10);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${authenticated.credential.tenantId}:gateway:${authenticated.credential.id}`}))`;
      const policies = await tx.integrationGatewayPolicy.findMany({
        orderBy: { activatedAt: 'desc' },
        where: {
          status: 'ACTIVE',
          tenantId: authenticated.credential.tenantId,
        },
      });
      const matchedPolicy = policies.find(({ routePattern }) =>
        this.matches(routePattern, input.route),
      );
      const policy = matchedPolicy ?? policies[0];
      if (!policy)
        throw new AppError(
          'GATEWAY_POLICY_NOT_FOUND',
          'No active gateway policy is configured',
          403,
        );
      const reason = matchedPolicy
        ? this.policyReason(
            policy,
            authenticated.credential.allowedIps,
            authenticated.scopes,
            input,
          )
        : 'GATEWAY_ROUTE_DENIED';
      const now = new Date();
      const minuteStart = new Date(now);
      minuteStart.setUTCSeconds(0, 0);
      const dayStart = new Date(now);
      dayStart.setUTCHours(0, 0, 0, 0);
      const minute = await this.incrementBucket(
        tx,
        policy.id,
        authenticated.credential,
        'MINUTE',
        minuteStart,
      );
      const day = await this.incrementBucket(
        tx,
        policy.id,
        authenticated.credential,
        'DAY',
        dayStart,
      );
      const dailyLimit = input.sensitive
        ? policy.sensitiveDailyLimit
        : policy.dailyLimit;
      const limitReason =
        minute.requestCount > policy.perMinuteLimit
          ? 'GATEWAY_RATE_LIMIT_EXCEEDED'
          : day.requestCount > dailyLimit
            ? 'GATEWAY_DAILY_QUOTA_EXCEEDED'
            : undefined;
      const reasonCode = reason ?? limitReason ?? 'GATEWAY_ALLOWED';
      const outcome = reasonCode === 'GATEWAY_ALLOWED' ? 'ALLOWED' : 'REJECTED';
      await Promise.all([
        tx.integrationRateLimitDecision.create({
          data: {
            appliedLimit:
              reasonCode === 'GATEWAY_RATE_LIMIT_EXCEEDED'
                ? policy.perMinuteLimit
                : dailyLimit,
            correlationId,
            createdBy: authenticated.credential.id,
            credentialId: authenticated.credential.id,
            dailyCount: day.requestCount,
            minuteCount: minute.requestCount,
            outcome,
            policyId: policy.id,
            reasonCode,
            route: input.route,
            sensitive: input.sensitive ?? false,
            tenantId: authenticated.credential.tenantId,
            updatedBy: authenticated.credential.id,
          },
        }),
        tx.integrationGatewayLog.create({
          data: {
            authType: authenticated.credential.credentialType,
            correlationId,
            createdBy: authenticated.credential.id,
            credentialId: authenticated.credential.id,
            ipAddress: input.ipAddress,
            method: input.method.toUpperCase(),
            outcome,
            policyId: policy.id,
            reasonCode,
            requestBytes: input.requestBytes,
            requestHash: sha256(JSON.stringify(input.body ?? null)),
            route: input.route,
            tenantId: authenticated.credential.tenantId,
            updatedBy: authenticated.credential.id,
          },
        }),
        tx.integrationApiCredential.update({
          data: { lastUsedAt: now },
          where: { id: authenticated.credential.id },
        }),
      ]);
      return {
        allowed: outcome === 'ALLOWED',
        correlationId,
        credentialId: authenticated.credential.id,
        reasonCode,
        scopes: authenticated.scopes,
        tenantId: authenticated.credential.tenantId,
      };
    });
    if (!result.allowed)
      throw new AppError(
        result.reasonCode,
        'Gateway request was rejected',
        result.reasonCode === 'GATEWAY_REQUEST_TOO_LARGE'
          ? 413
          : result.reasonCode === 'GATEWAY_RATE_LIMIT_EXCEEDED' ||
              result.reasonCode === 'GATEWAY_DAILY_QUOTA_EXCEEDED'
            ? 429
            : 403,
        {
          retryable:
            result.reasonCode === 'GATEWAY_RATE_LIMIT_EXCEEDED' ||
            result.reasonCode === 'GATEWAY_DAILY_QUOTA_EXCEEDED',
        },
      );
    return result;
  }

  private async authenticate(input: GatewayAuthorizationInput) {
    if (input.type === 'OAUTH2_CLIENT' && input.accessToken) {
      const token = await this.prisma.integrationAccessToken.findFirst({
        where: { tokenHash: sha256(input.accessToken) },
      });
      if (!token || token.status !== 'ACTIVE' || token.expiresAt <= new Date())
        this.auth(
          'GATEWAY_ACCESS_TOKEN_INVALID',
          'OAuth access token is invalid',
        );
      const credential = await this.prisma.integrationApiCredential.findFirst({
        where: { id: token.credentialId, tenantId: token.tenantId },
      });
      if (!credential)
        this.auth('GATEWAY_CREDENTIAL_INVALID', 'OAuth credential is invalid');
      this.assertActive(credential);
      return { credential, scopes: list(token.scopes) };
    }
    const keyId = input.keyId?.trim();
    if (!keyId)
      this.auth('GATEWAY_KEY_ID_REQUIRED', 'Gateway key id is required');
    const credential = await this.prisma.integrationApiCredential.findFirst({
      where: { keyId },
    });
    if (!credential || credential.credentialType !== input.type)
      this.auth('GATEWAY_CREDENTIAL_INVALID', 'Gateway credential is invalid');
    this.assertActive(credential);
    if (input.type === 'MTLS') {
      if (
        !input.certificateFingerprint ||
        this.normalizeFingerprint(input.certificateFingerprint) !==
          credential.certificateFingerprint
      )
        this.auth('GATEWAY_MTLS_INVALID', 'Client certificate is invalid');
    } else if (input.type === 'HMAC') {
      const timestamp = input.timestamp?.trim();
      if (!timestamp || Math.abs(Date.now() - Date.parse(timestamp)) > 300_000)
        this.auth(
          'GATEWAY_HMAC_TIMESTAMP_INVALID',
          'HMAC timestamp is invalid',
        );
      const bodyHash = sha256(JSON.stringify(input.body ?? null));
      const expected = createHmac(
        'sha256',
        this.secret(credential.tenantId, credential.keyId),
      )
        .update(
          `${timestamp}\n${input.method.toUpperCase()}\n${input.route}\n${bodyHash}`,
        )
        .digest('hex');
      if (!input.signature || !this.equal(expected, input.signature))
        this.auth('GATEWAY_HMAC_INVALID', 'HMAC signature is invalid');
    } else {
      if (!input.secret)
        this.auth('GATEWAY_SECRET_REQUIRED', 'Secret is required');
      this.assertSecret(credential, input.secret);
    }
    return { credential, scopes: list(credential.scopes) };
  }

  private async insertCredential(
    tx: Prisma.TransactionClient,
    input: CreateGatewayCredentialInput,
    context: TenantContext,
  ) {
    const name = this.text(input.name, 'name', 200);
    const scopes = this.values(input.scopes, 'scope');
    if (scopes.length === 0) this.invalid('At least one scope is required');
    const allowedIps = this.values(input.allowedIps ?? [], 'IP');
    const validUntil = input.validUntil
      ? this.date(input.validUntil, 'validUntil')
      : undefined;
    if (validUntil && validUntil <= new Date())
      this.invalid('validUntil must be in the future');
    const keyId = randomUUID();
    const secret =
      input.type === 'MTLS' ? undefined : this.secret(context.tenantId, keyId);
    const certificateFingerprint =
      input.type === 'MTLS'
        ? this.normalizeFingerprint(
            this.text(
              input.certificateFingerprint,
              'certificateFingerprint',
              128,
            ),
          )
        : undefined;
    const credential = await tx.integrationApiCredential.create({
      data: {
        allowedIps: json(allowedIps),
        ...(certificateFingerprint ? { certificateFingerprint } : {}),
        createdBy: context.accountId,
        credentialType: input.type,
        keyId,
        name,
        scopes: json(scopes),
        ...(secret ? { secretHash: sha256(secret) } : {}),
        tenantId: context.tenantId,
        updatedBy: context.accountId,
        ...(validUntil ? { validUntil } : {}),
      },
    });
    return { credential, secret };
  }

  private policyReason(
    policy: {
      readonly allowedIps: Prisma.JsonValue;
      readonly maxRequestBytes: number;
      readonly requiredScopes: Prisma.JsonValue;
      readonly routePattern: string;
    },
    credentialIps: Prisma.JsonValue,
    scopes: readonly string[],
    input: GatewayAuthorizationInput,
  ): string | undefined {
    const policyIps = list(policy.allowedIps);
    const allowedCredentialIps = list(credentialIps);
    if (
      (policyIps.length > 0 && !policyIps.includes(input.ipAddress)) ||
      (allowedCredentialIps.length > 0 &&
        !allowedCredentialIps.includes(input.ipAddress))
    )
      return 'GATEWAY_IP_DENIED';
    if (input.requestBytes < 0 || input.requestBytes > policy.maxRequestBytes)
      return 'GATEWAY_REQUEST_TOO_LARGE';
    if (list(policy.requiredScopes).some((scope) => !scopes.includes(scope)))
      return 'GATEWAY_SCOPE_DENIED';
    return undefined;
  }

  private incrementBucket(
    tx: Prisma.TransactionClient,
    policyId: string,
    credential: { readonly id: string; readonly tenantId: string },
    bucketKind: string,
    bucketStart: Date,
  ) {
    return tx.integrationGatewayUsageBucket.upsert({
      create: {
        bucketKind,
        bucketStart,
        createdBy: credential.id,
        credentialId: credential.id,
        policyId,
        requestCount: 1,
        tenantId: credential.tenantId,
        updatedBy: credential.id,
      },
      update: {
        requestCount: { increment: 1 },
        updatedBy: credential.id,
        version: { increment: 1 },
      },
      where: {
        tenantId_policyId_credentialId_bucketKind_bucketStart: {
          bucketKind,
          bucketStart,
          credentialId: credential.id,
          policyId,
          tenantId: credential.tenantId,
        },
      },
    });
  }

  private credentialResponse(
    credential: {
      readonly credentialType: IntegrationCredentialType;
      readonly id: string;
      readonly keyId: string;
      readonly status: string;
      readonly validUntil: Date | null;
      readonly version: number;
    },
    secret: string | undefined,
  ) {
    return {
      credentialId: credential.id,
      credentialType: credential.credentialType,
      keyId: credential.keyId,
      ...(secret ? { secret } : {}),
      status: credential.status,
      validUntil: credential.validUntil,
      version: credential.version,
    };
  }

  private assertActive(credential: {
    readonly status: string;
    readonly validFrom: Date;
    readonly validUntil: Date | null;
  }): void {
    const now = new Date();
    if (
      credential.status !== 'ACTIVE' ||
      credential.validFrom > now ||
      (credential.validUntil !== null && credential.validUntil <= now)
    )
      this.auth(
        'GATEWAY_CREDENTIAL_INACTIVE',
        'Gateway credential is inactive',
      );
  }

  private assertSecret(
    credential: {
      readonly keyId: string;
      readonly secretHash: string | null;
      readonly tenantId: string;
    },
    supplied: string,
  ): void {
    if (
      !credential.secretHash ||
      !this.equal(credential.secretHash, sha256(supplied))
    )
      this.auth('GATEWAY_SECRET_INVALID', 'Gateway secret is invalid');
  }

  private equal(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private secret(tenantId: string, keyId: string): string {
    return deriveGatewaySecret(
      process.env.API_CREDENTIAL_MASTER_KEY ?? '',
      tenantId,
      keyId,
    );
  }

  private normalizeFingerprint(value: string): string {
    return value.replaceAll(':', '').trim().toUpperCase();
  }

  private matches(pattern: string, route: string): boolean {
    return pattern.endsWith('*')
      ? route.startsWith(pattern.slice(0, -1))
      : pattern === route;
  }

  private route(value: string): string {
    const route = this.text(value, 'routePattern', 300);
    if (!route.startsWith('/api/'))
      this.invalid('routePattern must start with /api/');
    return route;
  }

  private values(values: readonly string[], label: string): string[] {
    const normalized = [...new Set(values.map((value) => value.trim()))];
    if (normalized.some((value) => !value || value.length > 200))
      this.invalid(`${label} values are invalid`);
    return normalized;
  }

  private positive(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value <= 0)
      this.invalid(`${field} must be a positive integer`);
  }

  private text(
    value: string | undefined,
    field: string,
    maximum: number,
  ): string {
    const normalized = value?.trim();
    if (!normalized || normalized.length > maximum)
      this.invalid(`${field} is invalid`);
    return normalized;
  }

  private date(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) this.invalid(`${field} is invalid`);
    return date;
  }

  private version(actual: number, expected: number): void {
    if (!Number.isSafeInteger(expected) || actual !== expected)
      throw new AppError(
        'GATEWAY_VERSION_CONFLICT',
        'Gateway aggregate version conflict',
        409,
      );
  }

  private invalid(message: string): never {
    throw new AppError('GATEWAY_INPUT_INVALID', message, 400);
  }

  private auth(code: string, message: string): never {
    throw new AppError(code, message, 401);
  }

  private notFound(code: string, label: string): never {
    throw new AppError(code, `${label} was not found`, 404);
  }

  private record(
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    payload: JsonObject,
  ) {
    return this.changes.record(
      tx,
      {
        aggregateId: id,
        aggregateType: eventName.includes('credential')
          ? 'IntegrationApiCredential'
          : 'IntegrationGatewayPolicy',
        aggregateVersion: version,
        eventName,
        payload: json(payload) as Prisma.InputJsonObject,
      },
      context,
      metadata,
    );
  }
}

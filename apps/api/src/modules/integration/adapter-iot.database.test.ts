import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IdempotencyService } from '../platform/idempotency.service';
import { ChangeRecordingFacade } from '../platform/public/change-recording.facade';
import { IdempotencyExecutionFacade } from '../platform/public/idempotency-execution.facade';
import { AdapterIotService } from './adapter-iot.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();
const context = (tenantId = randomUUID()): TenantContext => ({
  accountId: randomUUID(),
  accountKind: 'TENANT_ADMIN',
  deviceId: 'adapter-iot-database-test',
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
const fingerprint = (seed: string) => seed.padEnd(64, '0').slice(0, 64);

databaseDescribe('ERP/finance adapters and IoT gateway', () => {
  let service: AdapterIotService;

  beforeAll(() => {
    service = new AdapterIotService(
      prisma as never,
      new ChangeRecordingFacade(),
      new IdempotencyExecutionFacade(new IdempotencyService(prisma as never)),
    );
  });
  afterAll(() => prisma.$disconnect());

  it('tests and publishes an adapter while keeping vendor semantics out of canonical events', async () => {
    const actor = context();
    const adapter = await service.createAdapter(
      {
        adapterType: 'ERP',
        capabilities: ['ORDER'],
        code: `SAP-ORDER-${randomUUID()}`,
        expectedCanonical: { customerId: 'CUS-1', orderNo: 'SO-1' },
        name: 'ERP order adapter',
        rules: [
          { source: 'VBELN', target: 'orderNo' },
          { source: 'KUNNR', target: 'customerId' },
        ],
        sampleInput: { KUNNR: 'CUS-1', SAP_BUKRS: '1000', VBELN: 'SO-1' },
        vendor: 'SAP',
      },
      actor,
      command(),
    );
    await expect(
      service.publishAdapterVersion(
        adapter.adapterVersionId,
        { expectedVersion: 1 },
        actor,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'ADAPTER_VERSION_TRANSITION_INVALID' });
    const tested = await service.testAdapterVersion(
      adapter.adapterVersionId,
      { expectedVersion: 1 },
      actor,
      command(),
    );
    expect(tested).toMatchObject({ passed: true, status: 'TESTED', version: 2 });
    await service.publishAdapterVersion(
      adapter.adapterVersionId,
      { expectedVersion: 2 },
      actor,
      command(),
    );
    const input = {
      businessRef: 'SO-1',
      capability: 'ORDER' as const,
      definitionId: adapter.adapterId,
      direction: 'INBOUND' as const,
      externalRef: 'SAP-SO-1',
      vendorPayload: { KUNNR: 'CUS-1', SAP_BUKRS: '1000', VBELN: 'SO-1' },
    };
    const normalized = await service.submitAdapterCommand(input, actor, command());
    expect(normalized).toMatchObject({
      canonicalPayload: { customerId: 'CUS-1', orderNo: 'SO-1' },
      duplicate: false,
      status: 'NORMALIZED',
    });
    expect(JSON.stringify(normalized.canonicalPayload)).not.toContain('SAP_BUKRS');
    await expect(service.submitAdapterCommand(input, actor, command())).resolves.toMatchObject({
      adapterCommandId: normalized.adapterCommandId,
      duplicate: true,
    });
    await expect(
      service.submitAdapterCommand(
        { ...input, vendorPayload: { ...input.vendorPayload, VBELN: 'SO-CHANGED' } },
        actor,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'ADAPTER_EXTERNAL_REF_CONFLICT', statusCode: 409 });
    const dispatched = await service.dispatchAdapterCommand(
      normalized.adapterCommandId,
      { expectedVersion: normalized.version },
      actor,
      command(),
    );
    expect(dispatched).toMatchObject({ status: 'DISPATCHED', version: 2 });
    await expect(
      service.acknowledgeAdapterCommand(
        normalized.adapterCommandId,
        { expectedVersion: dispatched.version, outcome: 'ACKNOWLEDGED', vendorResponse: { SAP_DOC: '9001' } },
        actor,
        command(),
      ),
    ).resolves.toMatchObject({ status: 'ACKNOWLEDGED', version: 3 });
    const dispatchedOutbox = await prisma.platformOutbox.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
      where: { aggregateId: normalized.adapterCommandId, eventName: 'integration.adapter-command-dispatched.v1' },
    });
    expect(JSON.stringify(dispatchedOutbox.payload)).not.toContain('SAP_BUKRS');
    await expect(
      prisma.integrationAdapterVersion.update({ data: { rules: [] }, where: { id: adapter.adapterVersionId } }),
    ).rejects.toBeDefined();
    const event = await prisma.integrationAdapterEvent.findFirstOrThrow({ where: { commandId: normalized.adapterCommandId } });
    await expect(
      prisma.integrationAdapterEvent.update({ data: { eventType: 'tampered' }, where: { id: event.id } }),
    ).rejects.toBeDefined();
  });

  it('rejects forbidden canonical fields and supports the adapter failed terminal path', async () => {
    const actor = context();
    const adapter = await service.createAdapter(
      {
        adapterType: 'FINANCE',
        capabilities: ['PAYMENT'],
        code: `FIN-PAY-${randomUUID()}`,
        expectedCanonical: { paymentNo: 'PAY-1' },
        name: 'Finance payment adapter',
        rules: [{ source: 'PAYMENT_ID', target: 'paymentNo' }],
        sampleInput: { PAYMENT_ID: 'PAY-1' },
        vendor: 'FINANCE-ERP',
      },
      actor,
      command(),
    );
    await service.testAdapterVersion(adapter.adapterVersionId, { expectedVersion: 1 }, actor, command());
    await service.publishAdapterVersion(adapter.adapterVersionId, { expectedVersion: 2 }, actor, command());
    const next = await service.createAdapterVersion(
      adapter.adapterId,
      {
        expectedCanonical: { SAP_BUKRS: '1000' },
        rules: [{ source: 'BUKRS', target: 'SAP_BUKRS' }],
        sampleInput: { BUKRS: '1000' },
      },
      actor,
      command(),
    );
    await expect(
      service.testAdapterVersion(next.adapterVersionId, { expectedVersion: 1 }, actor, command()),
    ).rejects.toMatchObject({ code: 'ADAPTER_SEMANTIC_LEAKAGE' });
    const submitted = await service.submitAdapterCommand(
      {
        businessRef: 'PAY-1',
        capability: 'PAYMENT',
        definitionId: adapter.adapterId,
        direction: 'OUTBOUND',
        externalRef: 'PAY-1',
        vendorPayload: { PAYMENT_ID: 'PAY-1' },
      },
      actor,
      command(),
    );
    const sent = await service.dispatchAdapterCommand(submitted.adapterCommandId, { expectedVersion: 1 }, actor, command());
    await expect(
      service.acknowledgeAdapterCommand(
        submitted.adapterCommandId,
        { errorCode: 'ERP_REJECTED', expectedVersion: sent.version, outcome: 'FAILED' },
        actor,
        command(),
      ),
    ).resolves.toMatchObject({ status: 'FAILED' });
    const suspended = await service.transitionAdapter(
      adapter.adapterId,
      { expectedVersion: 2, target: 'SUSPENDED' },
      actor,
      command(),
    );
    const resumed = await service.transitionAdapter(
      adapter.adapterId,
      { expectedVersion: suspended.version, target: 'ACTIVE' },
      actor,
      command(),
    );
    await expect(
      service.transitionAdapter(
        adapter.adapterId,
        { expectedVersion: resumed.version, target: 'RETIRED' },
        actor,
        command(),
      ),
    ).resolves.toMatchObject({ status: 'RETIRED' });
    expect(
      await prisma.integrationAdapterVersion.findUnique({
        where: { id: adapter.adapterVersionId },
      }),
    ).toMatchObject({ status: 'RETIRED' });
  });

  it('governs registration, state, certificate, heartbeat and command acknowledgement with idempotency', async () => {
    const actor = context();
    const firstFingerprint = fingerprint('a');
    const registered = await service.registerDevice(
      {
        capabilities: ['temperature', 'location'],
        certificateFingerprint: firstFingerprint,
        certificateValidUntil: '2035-01-01T00:00:00.000Z',
        deviceType: 'TEMPERATURE',
        hardwareId: `TEMP-${randomUUID()}`,
        name: 'Cold-chain sensor',
        telemetryPerMinuteLimit: 2,
      },
      actor,
      command(),
    );
    const active = await service.transitionDevice(registered.deviceId, { expectedVersion: 1, target: 'ACTIVE' }, actor, command());
    expect(active).toMatchObject({ status: 'ACTIVE', version: 2 });
    const identity = await prisma.integrationDevice.findUniqueOrThrow({ where: { id: registered.deviceId } });
    const heartbeatInput = {
      certificateFingerprint: firstFingerprint,
      firmwareVersion: '1.2.3',
      hardwareId: identity.hardwareId,
      health: { battery: 92 },
      occurredAt: '2026-07-15T10:00:00.000Z',
      tenantId: actor.tenantId,
    };
    const key = randomUUID();
    const first = await service.heartbeat(heartbeatInput, key, randomUUID());
    const replay = await service.heartbeat(heartbeatInput, key, randomUUID());
    expect(replay).toEqual(first);
    await expect(
      service.heartbeat({ ...heartbeatInput, health: { battery: 91 } }, key, randomUUID()),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT', statusCode: 409 });
    const rotated = await service.rotateDeviceCertificate(
      registered.deviceId,
      { certificateFingerprint: fingerprint('b'), expectedVersion: first.version, validUntil: '2036-01-01T00:00:00.000Z' },
      actor,
      command(),
    );
    expect(rotated.version).toBe(first.version + 1);
    const issued = await service.issueDeviceCommand(
      registered.deviceId,
      { commandType: 'SET_SAMPLE_INTERVAL', expiresAt: '2030-01-01T00:00:00.000Z', payload: { seconds: 30 } },
      actor,
      command(),
    );
    const sent = await service.sendDeviceCommand(issued.deviceCommandId, { expectedVersion: issued.version }, actor, command());
    const ack = await service.acknowledgeDeviceCommand(
      {
        certificateFingerprint: fingerprint('b'),
        commandId: issued.deviceCommandId,
        hardwareId: identity.hardwareId,
        occurredAt: '2026-07-15T10:01:00.000Z',
        outcome: 'ACKNOWLEDGED',
        payload: { applied: true },
        tenantId: actor.tenantId,
      },
      randomUUID(),
      randomUUID(),
    );
    expect(ack).toMatchObject({ status: 'ACKNOWLEDGED', version: sent.version + 1 });
    const failedIssued = await service.issueDeviceCommand(
      registered.deviceId,
      { commandType: 'REBOOT', expiresAt: '2030-01-01T00:00:00.000Z', payload: {} },
      actor,
      command(),
    );
    const failedSent = await service.sendDeviceCommand(
      failedIssued.deviceCommandId,
      { expectedVersion: failedIssued.version },
      actor,
      command(),
    );
    await expect(
      service.acknowledgeDeviceCommand(
        {
          certificateFingerprint: fingerprint('b'),
          commandId: failedIssued.deviceCommandId,
          hardwareId: identity.hardwareId,
          occurredAt: '2026-07-15T10:02:00.000Z',
          outcome: 'FAILED',
          payload: { errorCode: 'DEVICE_BUSY' },
          tenantId: actor.tenantId,
        },
        randomUUID(),
        randomUUID(),
      ),
    ).resolves.toMatchObject({ status: 'FAILED', version: failedSent.version + 1 });
    const expiring = await service.issueDeviceCommand(
      registered.deviceId,
      { commandType: 'STALE_COMMAND', expiresAt: '2030-01-01T00:00:00.000Z', payload: {} },
      actor,
      command(),
    );
    await prisma.integrationDeviceCommand.update({
      data: { expiresAt: new Date('2020-01-01T00:00:00.000Z') },
      where: { id: expiring.deviceCommandId },
    });
    await expect(
      service.sendDeviceCommand(
        expiring.deviceCommandId,
        { expectedVersion: expiring.version },
        actor,
        command(),
      ),
    ).resolves.toMatchObject({ status: 'EXPIRED' });
    const suspended = await service.transitionDevice(
      registered.deviceId,
      { expectedVersion: rotated.version, target: 'SUSPENDED' },
      actor,
      command(),
    );
    const resumed = await service.transitionDevice(
      registered.deviceId,
      { expectedVersion: suspended.version, target: 'ACTIVE' },
      actor,
      command(),
    );
    const revoked = await service.transitionDevice(
      registered.deviceId,
      { expectedVersion: resumed.version, target: 'REVOKED' },
      actor,
      command(),
    );
    expect(revoked.status).toBe('REVOKED');
    expect(
      await prisma.integrationDeviceCertificate.count({
        where: { deviceId: registered.deviceId, status: 'ACTIVE' },
      }),
    ).toBe(0);
  });

  it('atomically limits concurrent telemetry and keeps telemetry immutable', async () => {
    const actor = context();
    const cert = fingerprint('c');
    const hardwareId = `GPS-${randomUUID()}`;
    const registered = await service.registerDevice(
      {
        capabilities: ['location'],
        certificateFingerprint: cert,
        certificateValidUntil: '2035-01-01T00:00:00.000Z',
        deviceType: 'GPS',
        hardwareId,
        name: 'Truck GPS',
        telemetryPerMinuteLimit: 1,
      },
      actor,
      command(),
    );
    await service.transitionDevice(registered.deviceId, { expectedVersion: 1, target: 'ACTIVE' }, actor, command());
    const base = {
      certificateFingerprint: cert,
      hardwareId,
      occurredAt: '2026-07-15T11:00:10.000Z',
      telemetryType: 'LOCATION',
      tenantId: actor.tenantId,
    };
    const outcomes = await Promise.allSettled([
      service.ingestTelemetry({ ...base, sequence: '1', values: { latitude: 31.2, longitude: 121.5 } }, randomUUID(), randomUUID()),
      service.ingestTelemetry({ ...base, sequence: '2', values: { latitude: 31.3, longitude: 121.6 } }, randomUUID(), randomUUID()),
    ]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'DEVICE_TELEMETRY_RATE_LIMITED', statusCode: 429 } });
    const telemetry = await prisma.integrationDeviceTelemetry.findFirstOrThrow({ where: { deviceId: registered.deviceId } });
    await expect(
      prisma.integrationDeviceTelemetry.update({ data: { valueSnapshot: { tampered: true } }, where: { id: telemetry.id } }),
    ).rejects.toBeDefined();
    expect(await prisma.integrationDeviceTelemetry.count({ where: { deviceId: registered.deviceId } })).toBe(1);
  });
});

import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventService, type BusinessEventInput } from '../platform/event.service';
import { IdempotencyService } from '../platform/idempotency.service';
import { ChangeRecordingFacade } from '../platform/public/change-recording.facade';
import { EventConsumptionFacade } from '../platform/public/event-consumption.facade';
import { MobilePortalService } from './mobile-portal.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();
const context = (tenantId = randomUUID(), accountId = randomUUID()): TenantContext => ({
  accountId,
  accountKind: 'TENANT_ADMIN',
  deviceId: 'mobile-portal-database-test',
  organizationIds: [],
  permissionVersion: 1,
  tenantId,
  tokenId: randomUUID(),
});
const command = () => ({ correlationId: randomUUID(), idempotencyKey: randomUUID(), ipAddress: '127.0.0.1' });
const event = (aggregateId: string, aggregateVersion: number, payload: Readonly<Record<string, unknown>> = {}): BusinessEventInput => ({
  aggregateId,
  aggregateType: 'Order',
  aggregateVersion,
  eventId: randomUUID(),
  eventType: 'order.updated.v1',
  occurredAt: new Date(Date.UTC(2026, 6, 15, 10, aggregateVersion)).toISOString(),
  payload,
  schemaVersion: 1,
  traceId: randomUUID(),
});

databaseDescribe('Customer mobile and scoped partner portal', () => {
  let service: MobilePortalService;

  beforeAll(() => {
    const idempotency = new IdempotencyService(prisma as never);
    service = new MobilePortalService(
      prisma as never,
      new ChangeRecordingFacade(),
      new EventConsumptionFacade(new EventService(idempotency, prisma as never)),
    );
  });
  afterAll(() => prisma.$disconnect());

  it('projects current customer views, ignores stale versions and preserves immutable history', async () => {
    const tenantId = randomUUID();
    const accountId = randomUUID();
    const administrator = context(tenantId);
    const customer = context(tenantId, accountId);
    const principalRef = `CUSTOMER-${randomUUID()}`;
    const grant = await service.saveGrant(
      {
        accountId,
        displayName: 'Customer mobile user',
        permissions: ['VIEW_ORDER', 'VIEW_INVENTORY', 'ORDER_CONFIRM', 'ORDER_CANCEL', 'RETURN_CREATE', 'MESSAGE_SEND', 'ATTACHMENT_ADD'],
        principalRef,
        principalType: 'CUSTOMER',
      },
      administrator,
      command(),
    );
    const aggregateId = randomUUID();
    const firstEvent = event(aggregateId, 1, { orderNo: 'SO-1', status: 'OPEN' });
    const first = await service.project(
      {
        businessRef: 'SO-1',
        event: firstEvent,
        principalRef,
        principalType: 'CUSTOMER',
        projectionKey: 'SO-1',
        projectionType: 'ORDER',
        snapshot: { amount: '100.00', currency: 'CNY', orderNo: 'SO-1', status: 'OPEN' },
      },
      administrator,
      command(),
    );
    expect(first).toMatchObject({ duplicate: false, status: 'PROCESSED' });
    await expect(
      service.project(
        {
          businessRef: 'SO-1',
          event: firstEvent,
          principalRef,
          principalType: 'CUSTOMER',
          projectionKey: 'SO-1',
          projectionType: 'ORDER',
          snapshot: { orderNo: 'SO-1', status: 'OPEN' },
        },
        administrator,
        command(),
      ),
    ).resolves.toMatchObject({ duplicate: true, status: 'PROCESSED' });
    await service.project(
      {
        businessRef: 'SO-1',
        event: event(aggregateId, 2),
        principalRef,
        principalType: 'CUSTOMER',
        projectionKey: 'SO-1',
        projectionType: 'ORDER',
        snapshot: { amount: '100.00', currency: 'CNY', orderNo: 'SO-1', status: 'APPROVED' },
      },
      administrator,
      command(),
    );
    await expect(
      service.project(
        {
          businessRef: 'SO-1',
          event: event(aggregateId, 1),
          principalRef,
          principalType: 'CUSTOMER',
          projectionKey: 'SO-1',
          projectionType: 'ORDER',
          snapshot: { orderNo: 'SO-1', status: 'STALE' },
        },
        administrator,
        command(),
      ),
    ).resolves.toMatchObject({ status: 'IGNORED' });
    const portal = await service.portal(customer);
    expect(portal.grants).toHaveLength(1);
    expect(portal.projections).toContainEqual(expect.objectContaining({ snapshot: expect.objectContaining({ status: 'APPROVED' }), sourceVersion: 2 }));
    expect(portal.projections).toHaveLength(1);
    const projection = await prisma.integrationPortalProjection.findFirstOrThrow({ where: { sourceEventId: firstEvent.eventId } });
    await expect(
      prisma.integrationPortalProjection.update({ data: { snapshot: { status: 'TAMPERED' } }, where: { id: projection.id } }),
    ).rejects.toBeDefined();
    const disabled = await service.transitionGrant(grant.grantId, { expectedVersion: grant.version, target: 'INACTIVE' }, administrator, command());
    await expect(service.portal(customer)).rejects.toMatchObject({ code: 'PORTAL_SCOPE_DENIED', statusCode: 403 });
    await service.transitionGrant(grant.grantId, { expectedVersion: disabled.version, target: 'ACTIVE' }, administrator, command());
    await expect(
      service.project(
        {
          businessRef: 'SO-SECRET',
          event: event(randomUUID(), 1),
          principalRef,
          principalType: 'CUSTOMER',
          projectionKey: 'SO-SECRET',
          projectionType: 'ORDER',
          snapshot: { accessToken: 'must-not-project' },
        },
        administrator,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'PORTAL_SENSITIVE_FIELD_REJECTED' });
  });

  it('routes customer commands through Outbox and governs acknowledged and failed terminal paths', async () => {
    const tenantId = randomUUID();
    const accountId = randomUUID();
    const administrator = context(tenantId);
    const customer = context(tenantId, accountId);
    const principalRef = `CUSTOMER-${randomUUID()}`;
    await service.saveGrant(
      { accountId, displayName: 'Customer', permissions: ['VIEW_ALL', 'COMMAND_ALL'], principalRef, principalType: 'CUSTOMER' },
      administrator,
      command(),
    );
    await service.project(
      { businessRef: 'SO-2', event: event(randomUUID(), 1), principalRef, principalType: 'CUSTOMER', projectionKey: 'SO-2', projectionType: 'ORDER', snapshot: { orderNo: 'SO-2', status: 'OPEN' } },
      administrator,
      command(),
    );
    const accepted = await service.createCommand(
      { businessRef: 'SO-2', commandType: 'CUSTOMER_CONFIRM', payload: { expectedVersion: 1 }, principalRef, principalType: 'CUSTOMER' },
      customer,
      command(),
    );
    expect(accepted).toMatchObject({ accepted: true, status: 'ACCEPTED', version: 1 });
    const outbox = await prisma.platformOutbox.findFirstOrThrow({ where: { aggregateId: accepted.portalCommandId, eventName: 'integration.portal-command-requested.v1' } });
    expect(outbox.payload).toMatchObject({ businessRef: 'SO-2', targetDomain: 'oms' });
    const dispatched = await service.dispatchCommand(accepted.portalCommandId, { expectedVersion: 1 }, administrator, command());
    await expect(
      service.completeCommand(accepted.portalCommandId, { expectedVersion: dispatched.version, outcome: 'ACKNOWLEDGED' }, administrator, command()),
    ).resolves.toMatchObject({ status: 'ACKNOWLEDGED', version: 3 });
    const cancellation = await service.createCommand(
      { businessRef: 'SO-2', commandType: 'CUSTOMER_CANCEL', payload: { reason: 'No longer required' }, principalRef, principalType: 'CUSTOMER' },
      customer,
      command(),
    );
    const cancellationDispatched = await service.dispatchCommand(cancellation.portalCommandId, { expectedVersion: 1 }, administrator, command());
    await expect(
      service.completeCommand(cancellation.portalCommandId, { errorCode: 'ORDER_ALREADY_EXECUTING', expectedVersion: cancellationDispatched.version, outcome: 'FAILED' }, administrator, command()),
    ).resolves.toMatchObject({ status: 'FAILED', version: 3 });
  });

  it('isolates supplier and carrier projections and commands by exact partner scope', async () => {
    const tenantId = randomUUID();
    const administrator = context(tenantId);
    const supplierAccount = randomUUID();
    const carrierAccount = randomUUID();
    const supplierRef = `SUPPLIER-${randomUUID()}`;
    const carrierRef = `CARRIER-${randomUUID()}`;
    await service.saveGrant({ accountId: supplierAccount, displayName: 'Supplier', permissions: ['VIEW_ALL', 'COMMAND_ALL'], principalRef: supplierRef, principalType: 'SUPPLIER' }, administrator, command());
    await service.saveGrant({ accountId: carrierAccount, displayName: 'Carrier', permissions: ['VIEW_ALL', 'COMMAND_ALL'], principalRef: carrierRef, principalType: 'CARRIER' }, administrator, command());
    await service.project({ businessRef: 'PO-1', event: event(randomUUID(), 1), principalRef: supplierRef, principalType: 'SUPPLIER', projectionKey: 'PO-1', projectionType: 'ORDER', snapshot: { orderNo: 'PO-1' } }, administrator, command());
    await service.project({ businessRef: 'SHP-1', event: event(randomUUID(), 1), principalRef: carrierRef, principalType: 'CARRIER', projectionKey: 'SHP-1', projectionType: 'TENDER', snapshot: { shipmentNo: 'SHP-1' } }, administrator, command());
    const supplierPortal = await service.portal(context(tenantId, supplierAccount));
    expect(supplierPortal.projections).toHaveLength(1);
    expect(supplierPortal.projections[0]).toMatchObject({ businessRef: 'PO-1', principalRef: supplierRef });
    await expect(
      service.createCommand(
        { businessRef: 'SHP-1', commandType: 'SUPPLIER_ASN_SUBMIT', payload: { lines: [{ quantity: 1 }] }, principalRef: carrierRef, principalType: 'SUPPLIER' },
        context(tenantId, supplierAccount),
        command(),
      ),
    ).rejects.toMatchObject({ code: 'PORTAL_SCOPE_DENIED', statusCode: 403 });
    await expect(
      service.createCommand(
        { businessRef: 'SHP-1', commandType: 'CARRIER_TENDER_RESPONSE', payload: { decision: 'ACCEPT' }, principalRef: carrierRef, principalType: 'CARRIER' },
        context(tenantId, carrierAccount),
        command(),
      ),
    ).resolves.toMatchObject({ accepted: true, status: 'ACCEPTED' });
  });
});

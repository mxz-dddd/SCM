import { randomUUID } from 'node:crypto';
import { PrismaClient, type OrderStatus } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { CalendarReleaseFacade } from '../mdm/public/calendar-release.facade';
import { ChangeReverseService } from './change-reverse.service';
import { FulfillmentReleaseService } from './fulfillment-release.service';
import { OrderGovernanceService } from './order-governance.service';
import { OrderOperationsService } from './order-operations.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();
databaseDescribe(
  'order operations, SLA, settlement and portal persistence',
  () => {
    afterAll(() => prisma.$disconnect());
    it('aggregates exceptions, escalates SLA, requests settlement and isolates portal customers', async () => {
      const tenantId = randomUUID(),
        actorId = randomUUID(),
        customerId = randomUUID(),
        productId = randomUUID(),
        warehouseId = randomUUID();
      const context: TenantContext = {
        accountId: actorId,
        accountKind: 'TENANT_ADMIN',
        deviceId: 'operations-db',
        organizationIds: [],
        permissionVersion: 1,
        tenantId,
        tokenId: randomUUID(),
      };
      const command = () => ({
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
        ipAddress: '127.0.0.1',
      });
      const calendar = await prisma.businessCalendar.create({
        data: {
          code: 'SLA_TEST',
          createdBy: actorId,
          effectiveFrom: new Date('2020-01-01'),
          id: randomUUID(),
          name: 'SLA test',
          publishedAt: new Date(),
          status: 'ACTIVE',
          tenantId,
          timeZone: 'UTC',
          updatedBy: actorId,
          versionNumber: 1,
          workingDays: [0, 1, 2, 3, 4, 5, 6],
        },
      });
      const calendarFacade = new CalendarReleaseFacade(prisma as never);
      const governance = new OrderGovernanceService(prisma as never);
      const fulfillment = new FulfillmentReleaseService(
        prisma as never,
        calendarFacade,
      );
      const reverse = new ChangeReverseService(prisma as never);
      const denied = new Set<string>();
      const permission = {
        decideOrder: (_code: string, id: string) =>
          Promise.resolve({ allowed: !denied.has(id) }),
      };
      const service = new OrderOperationsService(
        prisma as never,
        calendarFacade,
        permission as never,
        governance,
        fulfillment,
        reverse,
      );
      async function order(status: OrderStatus) {
        const suffix = randomUUID().slice(0, 8);
        const raw = await prisma.rawMessageRef.create({
          data: {
            channel: 'API',
            contentHash: suffix.padEnd(64, 'a'),
            createdBy: actorId,
            externalOrderNo: `SO-${suffix}`,
            externalVersion: '1',
            mappingVersion: 'test',
            rawPayload: {},
            tenantId,
            updatedBy: actorId,
          },
        });
        const row = await prisma.businessOrder.create({
          data: {
            channel: 'API',
            createdBy: actorId,
            currency: 'CNY',
            customerId,
            externalOrderNo: `SO-${suffix}`,
            externalVersion: '1',
            mappingVersion: 'test',
            orderNo: `ORD-${suffix}`,
            rawMessageRefId: raw.id,
            sourcePayloadHash: suffix.padEnd(64, 'b'),
            status,
            tenantId,
            totalAmount: '100',
            type: 'SALES',
            updatedBy: actorId,
          },
        });
        const line = await prisma.businessOrderLine.create({
          data: {
            baseUom: 'EA',
            createdBy: actorId,
            id: randomUUID(),
            lineNo: 1,
            lineVersion: 1,
            orderId: row.id,
            originalUom: 'EA',
            productId,
            quantityBase: '10',
            quantityOriginal: '10',
            tenantId,
            updatedBy: actorId,
          },
        });
        return { line, row };
      }
      const invalid = await order('INVALID'),
        problem = await order('APPROVED'),
        released = await order('RELEASED');
      await prisma.orderAllocation.create({
        data: {
          baseUom: 'EA',
          businessOrderId: problem.row.id,
          createdBy: actorId,
          decisionId: randomUUID(),
          failureCode: 'NO_STOCK',
          orderLineId: problem.line.id,
          originalUom: 'EA',
          ownerId: customerId,
          productId,
          quantityBase: '10',
          quantityOriginal: '10',
          reservationKey: randomUUID(),
          status: 'FAILED',
          tenantId,
          updatedBy: actorId,
          warehouseId,
        },
      });
      await prisma.backorder.create({
        data: {
          baseUom: 'EA',
          businessOrderId: problem.row.id,
          createdBy: actorId,
          orderLineId: problem.line.id,
          quantityBase: '4',
          reason: 'SHORT',
          tenantId,
          updatedBy: actorId,
        },
      });
      const detected = await service.detectExceptions(
        {
          now: new Date(Date.now() + 86_400_000).toISOString(),
          stalledMinutes: 60,
        },
        context,
        command(),
      );
      expect(detected.created).toBeGreaterThanOrEqual(4);
      await expect(
        service.detectExceptions(
          {
            now: new Date(Date.now() + 86_400_000).toISOString(),
            stalledMinutes: 60,
          },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ created: 0 });
      await expect(
        service.reportException(
          {
            description: 'Carrier ETA exceeded',
            exceptionType: 'TRANSPORT_DELAY',
            orderId: released.row.id,
            responsibleDomain: 'TMS',
            severity: 'HIGH',
            sourceRef: 'shipment-delay-1',
          },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ status: 'OPEN' });
      const exception = await prisma.orderExceptionCase.findFirstOrThrow({
        where: { businessOrderId: invalid.row.id },
      });
      const assigned = await service.assignException(
        exception.id,
        { assignedTo: randomUUID(), expectedVersion: 1 },
        context,
        command(),
      );
      expect(assigned.status).toBe('ASSIGNED');
      const retried = await service.requestExceptionAction(
        exception.id,
        'RETRY',
        { expectedVersion: 2, reason: 'retry validation' },
        context,
        command(),
      );
      expect(retried.status).toBe('RETRYING');
      await expect(
        service.requestExceptionAction(
          exception.id,
          'CLOSE',
          { expectedVersion: 3, reason: 'too early' },
          context,
          command(),
        ),
      ).rejects.toMatchObject({ code: 'ORDER_EXCEPTION_TRANSITION_INVALID' });
      const resolved = await service.requestExceptionAction(
        exception.id,
        'RESOLVE',
        { expectedVersion: 3, reason: 'fixed' },
        context,
        command(),
      );
      await expect(
        service.requestExceptionAction(
          exception.id,
          'CLOSE',
          { expectedVersion: resolved.version, reason: 'verified' },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ status: 'CLOSED' });
      const openCases = await prisma.orderExceptionCase.findMany({
        take: 2,
        where: { status: 'OPEN', tenantId },
      });
      const assignee = randomUUID();
      await expect(
        service.batchExceptions(
          {
            action: 'ASSIGN',
            assignedTo: assignee,
            members: openCases.map(({ id, version }) => ({
              caseId: id,
              expectedVersion: version,
            })),
          },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ failedCount: 0, processedCount: 2 });
      await expect(
        service.batchExceptions(
          {
            action: 'RETRY',
            members: openCases.map(({ id }) => ({
              caseId: id,
              expectedVersion: 2,
            })),
            reason: 'bulk retry',
          },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ failedCount: 0, processedCount: 2 });
      const started = await service.startSla(
        released.row.id,
        {
          calendarCode: calendar.code,
          durationMinutes: 10,
          responsibleDomain: 'TMS',
          sourceVersion: 1,
          stage: 'DELIVERY',
          startedAt: new Date(Date.now() - 3_600_000).toISOString(),
          warningLeadMinutes: 5,
        },
        context,
        command(),
      );
      await expect(
        service.startSla(
          released.row.id,
          {
            calendarCode: calendar.code,
            durationMinutes: 10,
            responsibleDomain: 'TMS',
            sourceVersion: 1,
            stage: 'DELIVERY',
            startedAt: new Date().toISOString(),
            warningLeadMinutes: 5,
          },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ applied: false });
      const monitor = await service.monitorSla({}, context, command());
      expect(monitor.breached).toBe(1);
      expect(
        await prisma.slaBreachEvent.count({
          where: { slaClockId: started.clockId },
        }),
      ).toBe(1);
      expect(
        await prisma.orderExceptionCase.count({
          where: { dedupeKey: `SLA_BREACH:${started.clockId}` },
        }),
      ).toBe(1);
      const settlement = await service.createSettlement(
        released.row.id,
        {
          chargeFacts: [
            {
              factId: 'ship-1',
              factSnapshot: { status: 'COMPLETED' },
              factType: 'SHIPMENT',
              sourceDomain: 'TMS',
            },
          ],
          discountAmount: '10',
          expectedVersion: 1,
          serviceAmount: '5',
        },
        context,
        command(),
      );
      expect(settlement.requestedAmount.toString()).toBe('95');
      expect(
        await prisma.chargeFactRef.count({
          where: { settlementRequestId: settlement.requestId },
        }),
      ).toBe(1);
      const chargeFact = await prisma.chargeFactRef.findFirstOrThrow({
        where: { settlementRequestId: settlement.requestId },
      });
      await expect(
        prisma.chargeFactRef.update({
          data: { status: 'INACTIVE' },
          where: { id: chargeFact.id },
        }),
      ).rejects.toBeTruthy();
      expect(
        await prisma.platformOutbox.count({
          where: {
            aggregateId: settlement.requestId,
            eventName: 'settlement.requested.v1',
          },
        }),
      ).toBe(1);
      await expect(
        service.projectSettlement(
          settlement.requestId,
          { billingReference: 'BILL-1', sourceVersion: 2, status: 'ACCEPTED' },
          context,
          command(),
        ),
      ).resolves.toMatchObject({
        applied: true,
        sourceVersion: 2,
        status: 'ACCEPTED',
      });
      await expect(
        service.projectSettlement(
          settlement.requestId,
          {
            billingReference: 'BILL-OLD',
            sourceVersion: 1,
            status: 'ACCEPTED',
          },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ applied: false, sourceVersion: 2 });
      await expect(
        service.createSettlement(
          problem.row.id,
          { chargeFacts: [], expectedVersion: 1 },
          context,
          command(),
        ),
      ).rejects.toMatchObject({ code: 'SETTLEMENT_ORDER_STATE_INVALID' });
      await expect(
        service.portalView(released.row.id, { partnerId: customerId }, context),
      ).resolves.toMatchObject({ order: { id: released.row.id } });
      await expect(
        service.portalView(
          released.row.id,
          { partnerId: randomUUID() },
          context,
        ),
      ).rejects.toMatchObject({ code: 'ORDER_PARTNER_SCOPE_DENIED' });
    });
    it('authorizes and validates every member of a batch independently', async () => {
      const tenantId = randomUUID(),
        actorId = randomUUID(),
        customerId = randomUUID();
      const context: TenantContext = {
        accountId: actorId,
        accountKind: 'TENANT_ADMIN',
        deviceId: 'batch-db',
        organizationIds: [],
        permissionVersion: 1,
        tenantId,
        tokenId: randomUUID(),
      };
      const command = () => ({
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
        ipAddress: '127.0.0.1',
      });
      const calendar = new CalendarReleaseFacade(prisma as never),
        governance = new OrderGovernanceService(prisma as never),
        fulfillment = new FulfillmentReleaseService(prisma as never, calendar),
        reverse = new ChangeReverseService(prisma as never);
      const denied = new Set<string>();
      const permission = {
        decideOrder: (_code: string, id: string) =>
          Promise.resolve({ allowed: !denied.has(id) }),
      };
      const service = new OrderOperationsService(
        prisma as never,
        calendar,
        permission as never,
        governance,
        fulfillment,
        reverse,
      );
      async function open() {
        const suffix = randomUUID().slice(0, 8);
        const raw = await prisma.rawMessageRef.create({
          data: {
            channel: 'API',
            contentHash: suffix.padEnd(64, 'c'),
            createdBy: actorId,
            externalOrderNo: suffix,
            externalVersion: '1',
            mappingVersion: 'test',
            rawPayload: {},
            tenantId,
            updatedBy: actorId,
          },
        });
        return prisma.businessOrder.create({
          data: {
            channel: 'API',
            createdBy: actorId,
            customerId,
            externalOrderNo: suffix,
            externalVersion: '1',
            mappingVersion: 'test',
            orderNo: `ORD-${suffix}`,
            rawMessageRefId: raw.id,
            sourcePayloadHash: suffix.padEnd(64, 'd'),
            status: 'OPEN',
            tenantId,
            type: 'SALES',
            updatedBy: actorId,
          },
        });
      }
      const first = await open(),
        second = await open();
      denied.add(second.id);
      const result = await service.batch(
        {
          action: 'HOLD',
          members: [
            { expectedVersion: 1, orderId: first.id },
            { expectedVersion: 1, orderId: second.id },
          ],
          reason: 'risk',
        },
        context,
        command(),
      );
      expect(result).toMatchObject({
        failedCount: 1,
        processedCount: 1,
        status: 'PARTIAL',
      });
      expect(
        (
          await prisma.businessOrder.findUniqueOrThrow({
            where: { id: first.id },
          })
        ).status,
      ).toBe('HOLD');
      expect(
        (
          await prisma.businessOrder.findUniqueOrThrow({
            where: { id: second.id },
          })
        ).status,
      ).toBe('OPEN');
      expect(
        await prisma.batchCommandItem.count({
          where: { batchCommandResultId: result.batchId },
        }),
      ).toBe(2);
    });
  },
);

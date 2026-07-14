import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { ChangeReverseService } from './change-reverse.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe(
  'order change, partial fulfillment and reverse persistence',
  () => {
    afterAll(() => prisma.$disconnect());

    it('applies confirmed changes, guards quantity states and completes RMA lifecycle', async () => {
      const tenantId = randomUUID();
      const actorId = randomUUID();
      const customerId = randomUUID();
      const productId = randomUUID();
      const context: TenantContext = {
        accountId: actorId,
        accountKind: 'TENANT_ADMIN',
        deviceId: 'change-reverse-db',
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
      const service = new ChangeReverseService(prisma as never);

      async function createOrder(
        status: 'APPROVED' | 'ALLOCATED' | 'RELEASED' = 'APPROVED',
      ) {
        const suffix = randomUUID().slice(0, 8);
        const raw = await prisma.rawMessageRef.create({
          data: {
            channel: 'API',
            contentHash: suffix.padEnd(64, 'a'),
            createdBy: actorId,
            externalOrderNo: `SO-${suffix}`,
            externalVersion: '1',
            mappingVersion: 'test-v1',
            rawPayload: { suffix },
            tenantId,
            updatedBy: actorId,
          },
        });
        const order = await prisma.businessOrder.create({
          data: {
            channel: 'API',
            createdBy: actorId,
            customerId,
            customerSnapshot: { id: customerId },
            deliveryAddressId: randomUUID(),
            deliveryAddressSnapshot: { city: 'Shanghai' },
            externalOrderNo: `SO-${suffix}`,
            externalVersion: '1',
            mappingVersion: 'test-v1',
            orderNo: `ORD-${suffix}`,
            rawMessageRefId: raw.id,
            requestedFrom: new Date('2026-08-01T01:00:00Z'),
            requestedUntil: new Date('2026-08-01T09:00:00Z'),
            sourcePayloadHash: suffix.padEnd(64, 'b'),
            status,
            tenantId,
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
            orderId: order.id,
            originalUom: 'EA',
            productId,
            productSnapshot: { sku: suffix },
            quantityBase: '10',
            quantityOriginal: '10',
            tenantId,
            updatedBy: actorId,
          },
        });
        await prisma.orderVersion.create({
          data: {
            businessOrderId: order.id,
            changeReason: 'TEST_ORDER',
            createdBy: actorId,
            snapshot: { orderId: order.id },
            tenantId,
            updatedBy: actorId,
            versionNumber: 1,
          },
        });
        return { line, order };
      }

      const first = await createOrder();
      const requested = await service.createChange(
        first.order.id,
        {
          expectedVersion: 1,
          lineChanges: [
            {
              lineId: first.line.id,
              quantityBase: '12',
              quantityOriginal: '12',
            },
          ],
          serviceLevel: 'EXPRESS',
        },
        context,
        command(),
      );
      expect(requested).toMatchObject({ status: 'PENDING_CONFIRMATIONS' });
      const confirmations = await prisma.changeDomainConfirmation.findMany({
        orderBy: { domain: 'asc' },
        where: { orderChangeId: requested.changeId },
      });
      let applied: { status: string; orderVersion?: number } = { status: '' };
      for (const confirmation of confirmations)
        applied = await service.confirmChange(
          requested.changeId,
          { accepted: true, domain: confirmation.domain },
          context,
          command(),
        );
      expect(applied).toMatchObject({ orderVersion: 2, status: 'APPLIED' });
      expect(
        (
          await prisma.businessOrderLine.findUniqueOrThrow({
            where: { id: first.line.id },
          })
        ).quantityBase!.toString(),
      ).toBe('12');
      expect(
        await prisma.changeSet.count({
          where: { businessOrderId: first.order.id, toVersion: 2 },
        }),
      ).toBe(1);

      const rejectedChange = await service.createChange(
        first.order.id,
        { expectedVersion: 2, serviceLevel: 'ECONOMY' },
        context,
        command(),
      );
      const rejectedDomain =
        await prisma.changeDomainConfirmation.findFirstOrThrow({
          where: { orderChangeId: rejectedChange.changeId },
        });
      await expect(
        service.confirmChange(
          rejectedChange.changeId,
          {
            accepted: false,
            domain: rejectedDomain.domain,
            reason: 'capacity unavailable',
          },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ status: 'REJECTED' });

      const progress = await service.progress(
        first.order.id,
        first.line.id,
        {
          allocatedBase: '8',
          cancelledBase: '0',
          deliveredBase: '4',
          promisedBase: '8',
          shippedBase: '5',
          sourceVersion: 2,
          shortageDisposition: 'SUBSTITUTE',
        },
        context,
        command(),
      );
      expect(progress).toMatchObject({ applied: true, shortageBase: '4' });
      await expect(
        service.progress(
          first.order.id,
          first.line.id,
          {
            allocatedBase: '8',
            cancelledBase: '0',
            deliveredBase: '6',
            promisedBase: '8',
            shippedBase: '5',
            sourceVersion: 3,
          },
          context,
          command(),
        ),
      ).rejects.toMatchObject({
        code: 'ORDER_PROGRESS_CONSERVATION_VIOLATION',
      });
      await expect(
        service.progress(
          first.order.id,
          first.line.id,
          {
            allocatedBase: '1',
            cancelledBase: '0',
            deliveredBase: '0',
            promisedBase: '1',
            shippedBase: '0',
            sourceVersion: 1,
          },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ applied: false, sourceVersion: 2 });

      const proposal = await service.proposeSubstitution(
        first.order.id,
        first.line.id,
        {
          compatibility: { compatible: true },
          partnerId: customerId,
          quantityBase: '4',
          quantityOriginal: '4',
          replacementProductId: randomUUID(),
          respondBy: new Date(Date.now() + 60_000).toISOString(),
          timeoutPolicy: 'WAIT',
        },
        context,
        command(),
      );
      await expect(
        service.decideSubstitution(
          proposal.proposalId,
          { accepted: true, partnerId: randomUUID() },
          context,
          command(),
        ),
      ).rejects.toMatchObject({ code: 'ORDER_PARTNER_SCOPE_DENIED' });
      await expect(
        service.decideSubstitution(
          proposal.proposalId,
          { accepted: true, partnerId: customerId },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ status: 'CONFIRMED', version: 2 });

      await prisma.substitutionProposal.create({
        data: {
          baseUom: 'EA',
          businessOrderId: first.order.id,
          compatibilitySnapshot: {},
          createdBy: actorId,
          orderLineId: first.line.id,
          originalProductId: productId,
          originalUom: 'EA',
          partnerId: customerId,
          quantityBase: '4',
          quantityOriginal: '4',
          replacementProductId: randomUUID(),
          respondBy: new Date(Date.now() - 60_000),
          tenantId,
          timeoutPolicy: 'CANCEL',
          updatedBy: actorId,
        },
      });
      await expect(
        service.expireSubstitutions({}, context, command()),
      ).resolves.toMatchObject({ cancelled: 1, expired: 1 });
      expect(
        (
          await prisma.backorder.findFirstOrThrow({
            where: { orderLineId: first.line.id },
          })
        ).status,
      ).toBe('CANCELLED');

      const rmaInput = {
        lines: [
          {
            itemCondition: 'UNOPENED',
            quantityBase: '3',
            quantityOriginal: '3',
            sourceOrderLineId: first.line.id,
          },
        ],
        partnerId: customerId,
        reason: 'customer return',
        returnBy: new Date(Date.now() + 86_400_000).toISOString(),
      } as const;
      const attempts = await Promise.allSettled([
        service.createRma(first.order.id, rmaInput, context, command()),
        service.createRma(first.order.id, rmaInput, context, command()),
      ]);
      expect(
        attempts.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        attempts.filter(({ status }) => status === 'rejected'),
      ).toHaveLength(1);
      const rma = await prisma.returnMerchandiseAuthorization.findFirstOrThrow({
        where: { businessOrderId: first.order.id },
      });
      const authorized = await service.transitionRma(
        rma.id,
        { expectedVersion: 1, targetStatus: 'AUTHORIZED' },
        context,
        command(),
      );
      expect(authorized.reverseShipmentRequestId).toMatch(/^[0-9a-f-]{36}$/);
      const received = await service.transitionRma(
        rma.id,
        { expectedVersion: 2, targetStatus: 'RECEIVED' },
        context,
        command(),
      );
      const resolved = await service.transitionRma(
        rma.id,
        {
          expectedVersion: received.version,
          resolution: 'REFUND',
          targetStatus: 'RESOLVED',
        },
        context,
        command(),
      );
      await expect(
        service.transitionRma(
          rma.id,
          { expectedVersion: resolved.version, targetStatus: 'CLOSED' },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ status: 'CLOSED' });
      await expect(
        service.transitionRma(
          rma.id,
          { expectedVersion: 5, targetStatus: 'RECEIVED' },
          context,
          command(),
        ),
      ).rejects.toMatchObject({ code: 'RMA_TRANSITION_INVALID' });

      expect(
        await prisma.platformOutbox.count({ where: { aggregateId: rma.id } }),
      ).toBe(5);
    });

    it('releases reserved inventory on cancellation and refuses irreversible execution', async () => {
      const tenantId = randomUUID();
      const actorId = randomUUID();
      const customerId = randomUUID();
      const productId = randomUUID();
      const warehouseId = randomUUID();
      const context: TenantContext = {
        accountId: actorId,
        accountKind: 'TENANT_ADMIN',
        deviceId: 'cancel-db',
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
      const service = new ChangeReverseService(prisma as never);
      async function order(status: 'ALLOCATED' | 'RELEASED') {
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
        const row = await prisma.businessOrder.create({
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
            status,
            tenantId,
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
            quantityBase: '5',
            quantityOriginal: '5',
            tenantId,
            updatedBy: actorId,
          },
        });
        return { line, row };
      }
      const allocated = await order('ALLOCATED');
      const projection = await prisma.inventoryAvailabilityProjection.create({
        data: {
          allocated: '5',
          baseUom: 'EA',
          createdBy: actorId,
          onHand: '10',
          ownerId: customerId,
          productId,
          snapshotAt: new Date(),
          sourceVersion: 1,
          tenantId,
          updatedBy: actorId,
          warehouseId,
        },
      });
      await prisma.orderAllocation.create({
        data: {
          baseUom: 'EA',
          businessOrderId: allocated.row.id,
          createdBy: actorId,
          decisionId: randomUUID(),
          orderLineId: allocated.line.id,
          originalUom: 'EA',
          ownerId: customerId,
          productId,
          projectionId: projection.id,
          quantityBase: '5',
          quantityOriginal: '5',
          reservationKey: randomUUID(),
          reservedAt: new Date(),
          status: 'RESERVED',
          tenantId,
          updatedBy: actorId,
          warehouseId,
        },
      });
      await expect(
        service.cancel(
          allocated.row.id,
          { expectedVersion: 1, reason: 'customer request' },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ status: 'CANCELLED', version: 2 });
      expect(
        (
          await prisma.inventoryAvailabilityProjection.findUniqueOrThrow({
            where: { id: projection.id },
          })
        ).allocated.toString(),
      ).toBe('0');

      const released = await order('RELEASED');
      await prisma.fulfillmentOrder.create({
        data: {
          businessOrderId: released.row.id,
          createdBy: actorId,
          fulfillmentNo: `FUL-${randomUUID()}`,
          orderVersion: 1,
          ownerId: customerId,
          status: 'EXECUTING',
          tenantId,
          type: 'OUTBOUND',
          updatedBy: actorId,
          warehouseId,
        },
      });
      await expect(
        service.cancel(
          released.row.id,
          { expectedVersion: 1, reason: 'too late' },
          context,
          command(),
        ),
      ).rejects.toMatchObject({ code: 'ORDER_CANCEL_IRREVERSIBLE' });
    });
  },
);

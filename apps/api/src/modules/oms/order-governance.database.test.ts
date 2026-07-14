import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { OrderGovernanceService } from './order-governance.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('order review adjustment and hold persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('keeps review, merge, split, priority and hold decisions traceable and conservative', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'order-governance-db-test',
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
    const customerId = randomUUID();
    const addressId = randomUUID();
    const productId = randomUUID();

    async function createOpenOrder(suffix: string) {
      return prisma.$transaction(async (transaction) => {
        const rawId = randomUUID();
        await transaction.rawMessageRef.create({
          data: {
            channel: 'API',
            contentHash: 'a'.repeat(64),
            createdBy: actorId,
            externalOrderNo: `SO-${suffix}`,
            externalVersion: '1',
            id: rawId,
            mappingVersion: 'test-v1',
            rawPayload: { suffix },
            tenantId,
            updatedBy: actorId,
          },
        });
        const order = await transaction.businessOrder.create({
          data: {
            channel: 'API',
            createdBy: actorId,
            currency: 'CNY',
            customerId,
            customerSnapshot: { id: customerId },
            deliveryAddressId: addressId,
            deliveryAddressSnapshot: { id: addressId },
            externalOrderNo: `SO-${suffix}`,
            externalVersion: '1',
            id: randomUUID(),
            mappingVersion: 'test-v1',
            orderNo: `ORD-${suffix}`,
            rawMessageRefId: rawId,
            requestedFrom: new Date('2026-08-01T01:00:00Z'),
            requestedUntil: new Date('2026-08-01T09:00:00Z'),
            sourcePayloadHash: 'a'.repeat(64),
            status: 'OPEN',
            tenantId,
            totalAmount: '100',
            type: 'SALES',
            updatedBy: actorId,
          },
        });
        const line = await transaction.businessOrderLine.create({
          data: {
            baseUom: 'EA',
            createdBy: actorId,
            executedQuantityBase: '2',
            id: randomUUID(),
            lineNo: 1,
            lineVersion: 1,
            orderId: order.id,
            originalUom: 'EA',
            productId,
            productSnapshot: { id: productId },
            quantityBase: '10',
            quantityOriginal: '10',
            tenantId,
            updatedBy: actorId,
          },
        });
        await transaction.orderVersion.create({
          data: {
            businessOrderId: order.id,
            changeReason: 'TEST_OPEN',
            createdBy: actorId,
            id: randomUUID(),
            snapshot: { lines: [{ id: line.id }], order: { id: order.id, status: 'OPEN' } },
            tenantId,
            updatedBy: actorId,
            versionNumber: 1,
          },
        });
        return { line, order };
      });
    }

    const first = await createOpenOrder(randomUUID().slice(0, 8));
    const second = await createOpenOrder(randomUUID().slice(0, 8));
    const third = await createOpenOrder(randomUUID().slice(0, 8));
    const service = new OrderGovernanceService(prisma as never);

    const auto = await service.review(
      first.order.id,
      { autoApproveLimit: '1000', expectedVersion: 1 },
      context,
      command(),
    );
    expect(auto).toMatchObject({ reviewStatus: 'AUTO_APPROVED', status: 'APPROVED', version: 2 });
    const held = await service.hold(
      first.order.id,
      { expectedVersion: 2, holdType: 'CUSTOMER_REQUEST', reason: '客户要求暂停' },
      context,
      command(),
    );
    expect(held.status).toBe('HOLD');
    const released = await service.releaseHold(
      held.holdId,
      { expectedVersion: held.version, reason: '客户确认继续' },
      context,
      command(),
    );
    expect(released).toMatchObject({ status: 'APPROVED', version: 4 });
    const priority = await service.setPriority(
      first.order.id,
      {
        expectedVersion: 4,
        factors: { slaMinutes: 60 },
        lineId: first.line.id,
        priority: 90,
        ruleVersion: 'priority-v1',
      },
      context,
      command(),
    );
    expect(priority).toMatchObject({ reallocationEligibleQuantity: '8', version: 5 });

    const approvalId = randomUUID();
    const pending = await service.review(
      second.order.id,
      {
        approvalInstanceId: approvalId,
        autoApproveLimit: '10',
        expectedVersion: 1,
      },
      context,
      command(),
    );
    expect(pending).toMatchObject({ reviewStatus: 'PENDING_APPROVAL', status: 'HOLD' });
    const approved = await service.decideReview(
      pending.reviewId,
      { approvalInstanceId: approvalId, approved: true, expectedVersion: 2 },
      context,
      command(),
    );
    expect(approved).toMatchObject({ status: 'APPROVED', version: 3 });

    const rejectedApproval = randomUUID();
    const rejectedPending = await service.review(
      third.order.id,
      {
        approvalInstanceId: rejectedApproval,
        expectedVersion: 1,
        prohibited: true,
      },
      context,
      command(),
    );
    await expect(
      service.decideReview(
        rejectedPending.reviewId,
        { approvalInstanceId: rejectedApproval, approved: false, expectedVersion: 2 },
        context,
        command(),
      ),
    ).resolves.toMatchObject({ status: 'REJECTED', version: 3 });

    const merge = await service.merge(
      {
        members: [
          { expectedVersion: 5, orderId: first.order.id },
          { expectedVersion: 3, orderId: second.order.id },
        ],
      },
      context,
      command(),
    );
    expect(merge).toMatchObject({ aggregateAmount: '200', currency: 'CNY', memberCount: 2 });

    const split = await service.split(
      first.order.id,
      {
        allocations: [
          {
            amount: '40',
            childBusinessRef: 'CHILD-A',
            quantityBase: '4',
            quantityOriginal: '4',
            sourceLineId: first.line.id,
          },
          {
            amount: '60',
            childBusinessRef: 'CHILD-B',
            quantityBase: '6',
            quantityOriginal: '6',
            sourceLineId: first.line.id,
          },
        ],
        expectedVersion: 5,
      },
      context,
      command(),
    );
    expect(split.allocationCount).toBe(2);
    await expect(
      service.split(
        first.order.id,
        {
          allocations: [
            { amount: '50', childBusinessRef: 'BAD-A', quantityBase: '5', quantityOriginal: '5', sourceLineId: first.line.id },
            { amount: '50', childBusinessRef: 'BAD-B', quantityBase: '6', quantityOriginal: '6', sourceLineId: first.line.id },
          ],
          expectedVersion: 5,
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'ORDER_SPLIT_QUANTITY_MISMATCH', statusCode: 409 });
    await expect(
      prisma.orderSplitRelation.create({
        data: {
          baseUom: 'EA',
          childBusinessRef: 'DIRECT-OVER',
          createdBy: actorId,
          id: randomUUID(),
          originalUom: 'EA',
          quantityBase: '11',
          quantityOriginal: '11',
          sourceLineId: first.line.id,
          sourceOrderId: first.order.id,
          sourceOrderVersion: 5,
          splitGroupId: randomUUID(),
          tenantId,
          updatedBy: actorId,
        },
      }),
    ).rejects.toThrow();
  });
});

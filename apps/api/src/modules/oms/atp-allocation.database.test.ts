import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { IdempotencyService } from '../platform/idempotency.service';
import { RuleEvaluationFacade } from '../platform/public/rule-evaluation.facade';
import { RuleEngineService } from '../platform/rule-engine.service';
import { AtpAllocationService } from './atp-allocation.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('ATP snapshots and concurrent reservation', () => {
  afterAll(() => prisma.$disconnect());

  it('keeps snapshots traceable and prevents two orders from overselling one projection', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const ownerId = randomUUID();
    const productId = randomUUID();
    const warehouseId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'atp-db-test',
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
    const ruleSetId = randomUUID();
    await prisma.ruleSet.create({
      data: {
        code: 'ALLOCATE_TEST',
        createdBy: actorId,
        id: ruleSetId,
        name: 'Allocation test',
        publishedAt: new Date(),
        scenario: 'ALLOCATION',
        status: 'PUBLISHED',
        tenantId,
        updatedBy: actorId,
        versionNumber: 1,
      },
    });
    await prisma.ruleDefinition.create({
      data: {
        code: 'INCLUDE_ALL',
        conditions: [],
        createdBy: actorId,
        id: randomUUID(),
        name: 'Include all candidates',
        priority: 1,
        result: { effect: 'INCLUDE', score: 1 },
        ruleSetId,
        tenantId,
        updatedBy: actorId,
      },
    });
    const facade = new RuleEvaluationFacade(
      new RuleEngineService(
        new IdempotencyService(prisma as never),
        prisma as never,
      ),
    );
    const service = new AtpAllocationService(prisma as never, facade);

    const projected = await service.project(
      {
        baseUom: 'EA',
        expectedInbound: '4',
        onHand: '10',
        ownerId,
        productId,
        safetyStock: '0',
        snapshotAt: '2026-07-14T01:00:00Z',
        sourceVersion: 2,
        uncertainty: 'CONFIRMED',
        warehouseId,
      },
      context,
      command(),
    );
    expect(projected).toMatchObject({ applied: true, sourceVersion: 2 });
    const ignored = await service.project(
      {
        baseUom: 'EA',
        onHand: '1',
        ownerId,
        productId,
        snapshotAt: '2026-07-14T00:00:00Z',
        sourceVersion: 1,
        warehouseId,
      },
      context,
      command(),
    );
    expect(ignored).toMatchObject({ applied: false, sourceVersion: 2 });
    const promise = await service.promise(
      { baseUom: 'EA', ownerId, productId, quantity: '12' },
      context,
      command(),
    );
    expect(promise).toMatchObject({ uncertainty: 'CONFIRMED' });
    expect(promise.availableNow.toString()).toBe('10');
    expect(promise.projectedAvailable.toString()).toBe('14');
    expect(promise.snapshotAt.toISOString()).toBe('2026-07-14T01:00:00.000Z');

    async function approvedOrder(suffix: string) {
      const rawId = randomUUID();
      await prisma.rawMessageRef.create({
        data: {
          channel: 'API',
          contentHash: suffix.padEnd(64, 'a').slice(0, 64),
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
      const order = await prisma.businessOrder.create({
        data: {
          channel: 'API',
          createdBy: actorId,
          customerId: ownerId,
          externalOrderNo: `SO-${suffix}`,
          externalVersion: '1',
          id: randomUUID(),
          mappingVersion: 'test-v1',
          orderNo: `ORD-${suffix}`,
          rawMessageRefId: rawId,
          sourcePayloadHash: suffix.padEnd(64, 'b').slice(0, 64),
          status: 'APPROVED',
          tenantId,
          type: 'SALES',
          updatedBy: actorId,
        },
      });
      await prisma.businessOrderLine.create({
        data: {
          baseUom: 'EA',
          createdBy: actorId,
          id: randomUUID(),
          lineNo: 1,
          lineVersion: 1,
          orderId: order.id,
          originalUom: 'BOX',
          productId,
          quantityBase: '6',
          quantityOriginal: '1',
          tenantId,
          updatedBy: actorId,
        },
      });
      return order;
    }
    const first = await approvedOrder(randomUUID().slice(0, 8));
    const second = await approvedOrder(randomUUID().slice(0, 8));
    const [left, right] = await Promise.all([
      service.allocate(
        first.id,
        { expectedVersion: 1, ownerId, ruleSetCode: 'ALLOCATE_TEST' },
        context,
        command(),
      ),
      service.allocate(
        second.id,
        { expectedVersion: 1, ownerId, ruleSetCode: 'ALLOCATE_TEST' },
        context,
        command(),
      ),
    ]);
    expect([left.status, right.status].sort()).toEqual(['ALLOCATED', 'FAILED']);
    const projection =
      await prisma.inventoryAvailabilityProjection.findUniqueOrThrow({
        where: { id: projected.projectionId },
      });
    expect(projection.allocated.toString()).toBe('6');
    expect(await prisma.sourcingDecision.count({ where: { tenantId } })).toBe(
      2,
    );
    expect(await prisma.evaluationTrace.count({ where: { tenantId } })).toBe(2);
    const winningOrder = left.status === 'ALLOCATED' ? first : second;
    const reserved = await prisma.orderAllocation.findFirstOrThrow({
      where: { businessOrderId: winningOrder.id, status: 'RESERVED', tenantId },
    });
    expect(reserved.version).toBe(2);
    expect(
      await prisma.orderAllocation.count({
        where: { status: 'FAILED', tenantId, version: 2 },
      }),
    ).toBe(1);
    await expect(
      service.allocate(
        winningOrder.id,
        { expectedVersion: 2, ownerId, ruleSetCode: 'ALLOCATE_TEST' },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'ORDER_ALLOCATION_STATE_INVALID' });
    const released = await service.release(
      reserved.id,
      { expectedVersion: reserved.version },
      context,
      command(),
    );
    expect(released.status).toBe('RELEASED');
    expect(
      (
        await prisma.inventoryAvailabilityProjection.findUniqueOrThrow({
          where: { id: projected.projectionId },
        })
      ).allocated.toString(),
    ).toBe('0');
    expect(
      (
        await prisma.businessOrder.findUniqueOrThrow({
          where: { id: winningOrder.id },
        })
      ).status,
    ).toBe('APPROVED');
    await expect(
      service.release(
        reserved.id,
        { expectedVersion: released.version },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'ALLOCATION_TRANSITION_INVALID' });
  });
});

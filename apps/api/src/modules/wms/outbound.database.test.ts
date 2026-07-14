import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import { InventoryService } from './inventory.service';
import { OutboundService } from './outbound.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('WMS outbound planning and allocation persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('simulates waves, prevents concurrent over-allocation and resolves shortages', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const ownerId = randomUUID();
    const productId = randomUUID();
    const warehouseId = randomUUID();
    const locationId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'outbound-db-test',
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
    await prisma.product.create({
      data: {
        baseUom: 'EA',
        createdBy: actorId,
        currentVersionNumber: 1,
        id: productId,
        name: '出库分配测试商品',
        sku: `OUT-${randomUUID().slice(0, 8)}`,
        status: 'ACTIVE',
        tenantId,
        updatedBy: actorId,
      },
    });
    await prisma.productVersion.create({
      data: {
        createdBy: actorId,
        productId,
        sku: `OUT-V-${randomUUID().slice(0, 8)}`,
        snapshot: { baseUom: 'EA' },
        tenantId,
        updatedBy: actorId,
        versionNumber: 1,
      },
    });
    await prisma.warehouse.create({
      data: {
        code: `OUT-${randomUUID().slice(0, 8)}`,
        createdBy: actorId,
        id: warehouseId,
        name: '出库分配测试仓',
        status: 'ACTIVE',
        tenantId,
        timeZone: 'Asia/Shanghai',
        updatedBy: actorId,
      },
    });
    await prisma.warehouseLocation.create({
      data: {
        code: 'OUT-01',
        createdBy: actorId,
        id: locationId,
        name: '出库储位',
        status: 'ACTIVE',
        tenantId,
        type: 'LOCATION',
        updatedBy: actorId,
        warehouseId,
      },
    });
    const mdm = new MdmReferenceService(prisma as never);
    const inventory = new InventoryService(prisma as never, mdm);
    const service = new OutboundService(prisma as never, mdm, inventory);
    const stock = await inventory.receive(
      {
        baseUom: 'EA',
        businessRef: 'OUTBOUND-OPENING',
        businessType: 'OPENING',
        handlingUnitId: randomUUID(),
        locationId,
        originalUom: 'EA',
        ownerId,
        productId,
        quantityBase: '5',
        quantityOriginal: '5',
        status: 'AVAILABLE',
        warehouseId,
      },
      context,
      command(),
    );
    await expect(
      service.createOutbound(
        {
          cutoffAt: new Date(Date.now() + 3_600_000).toISOString(),
          destinationSnapshot: {},
          lines: [],
          ownerId,
          serviceLevel: 'NEXT_DAY',
          sourceRef: 'OMS-INVALID',
          type: 'SALES',
          warehouseId,
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'OUTBOUND_INPUT_INVALID' });
    const orders = await Promise.all(
      [1, 2].map((index) =>
        service.createOutbound(
          {
            carrierMode: 'ROAD',
            cutoffAt: new Date(Date.now() + 3_600_000).toISOString(),
            destinationSnapshot: {
              address: `测试目的地 ${index}`,
              countryCode: 'CN',
            },
            lines: [
              {
                baseUom: 'EA',
                lineNo: 1,
                originalUom: 'EA',
                productId,
                quantityBase: '4',
                quantityOriginal: '4',
              },
            ],
            ownerId,
            routeCode: 'R-01',
            serviceLevel: 'NEXT_DAY',
            sourceRef: `OMS-OUT-${index}`,
            temperatureZone: 'AMBIENT',
            type: 'SALES',
            warehouseId,
          },
          context,
          command(),
        ),
      ),
    );
    for (const order of orders)
      await expect(
        service.releaseOutbound(
          order.outboundId,
          { expectedVersion: order.version },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ status: 'RELEASED' });
    const template = await service.saveWaveTemplate(
      {
        capacitySnapshot: {
          maxLines: 10,
          maxOrders: 10,
          maxQuantityBase: '100',
        },
        criteria: {
          carrierMode: 'ROAD',
          orderType: 'SALES',
          routeCode: 'R-01',
          temperatureZone: 'AMBIENT',
        },
        name: '道路常温波次',
        strategy: {
          issueMethod: 'FEFO',
          minimumSplits: true,
          wholeHandlingUnitFirst: true,
        },
        warehouseId,
        workloadFactors: { perBase: '0.1', perLine: '1', perOrder: '2' },
      },
      context,
      command(),
    );
    await expect(
      service.simulateWave(template.templateId, context),
    ).resolves.toMatchObject({
      lineCount: 2,
      orderCount: 2,
      quantityBase: '8',
    });
    const waves = await Promise.all(
      orders.map((order) =>
        service.createWave(
          {
            cutoffAt: new Date(Date.now() + 2_000_000).toISOString(),
            orderIds: [order.outboundId],
            templateId: template.templateId,
          },
          context,
          command(),
        ),
      ),
    );
    await expect(
      service.transitionWave(
        waves[0]!.waveId,
        { expectedVersion: waves[0]!.version, targetStatus: 'RELEASED' },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'WAVE_TRANSITION_INVALID' });
    const planned = await Promise.all(
      waves.map((wave) =>
        service.transitionWave(
          wave.waveId,
          { expectedVersion: wave.version, targetStatus: 'PLANNED' },
          context,
          command(),
        ),
      ),
    );
    const released = await Promise.all(
      waves.map((wave, index) =>
        service.transitionWave(
          wave.waveId,
          {
            expectedVersion: planned[index]!.version,
            targetStatus: 'RELEASED',
          },
          context,
          command(),
        ),
      ),
    );
    expect(released.every(({ status }) => status === 'RELEASED')).toBe(true);
    const allocationTotal = await prisma.outboundAllocation.aggregate({
      _sum: { quantityBase: true },
      where: { tenantId },
    });
    expect(allocationTotal._sum.quantityBase?.lessThanOrEqualTo(5)).toBe(true);
    const balance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { id: stock.balanceId },
    });
    expect(balance.allocatedBase.toString()).toBe(
      allocationTotal._sum.quantityBase?.toString(),
    );
    expect(balance.availableBase.add(balance.allocatedBase).toString()).toBe(
      '5',
    );
    const lines = await prisma.outboundLine.findMany({ where: { tenantId } });
    expect(
      lines
        .reduce(
          (sum, line) => sum.add(line.allocatedBase).add(line.shortageBase),
          balance.onHandBase.mul(0),
        )
        .toString(),
    ).toBe('8');
    const shortages = await prisma.outboundShortageCase.findMany({
      where: { status: 'OPEN', tenantId },
    });
    expect(shortages.length).toBeGreaterThan(0);
    for (const shortage of shortages)
      await service.resolveShortage(
        shortage.id,
        {
          expectedVersion: shortage.version,
          resolutionSnapshot: {
            approvedShortShipBase: shortage.shortageBase.toString(),
          },
          type: 'SHORT_SHIP',
        },
        context,
        command(),
      );
    for (const [index, wave] of waves.entries())
      await expect(
        service.transitionWave(
          wave.waveId,
          {
            expectedVersion: released[index]!.version,
            targetStatus: 'COMPLETED',
          },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ status: 'COMPLETED' });
    const allocation = await prisma.outboundAllocation.findFirstOrThrow({
      where: { tenantId },
    });
    expect(allocation.strategyTrace).toMatchObject({
      strategy: expect.objectContaining({ issueMethod: 'FEFO' }),
      templateVersion: 1,
    });
    await expect(
      prisma.outboundAllocation.update({
        data: { quantityBase: '999' },
        where: { id: allocation.id },
      }),
    ).rejects.toBeTruthy();
    expect(
      await prisma.platformOutbox.count({
        where: { eventName: 'outbound.shortage-resolved.v1', tenantId },
      }),
    ).toBe(shortages.length);
  });
});

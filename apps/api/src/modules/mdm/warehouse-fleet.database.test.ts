import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { IdempotencyService } from '../platform/idempotency.service';
import { WarehouseFleetService } from './warehouse-fleet.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();
databaseDescribe('warehouse and fleet persistence', () => {
  afterAll(() => prisma.$disconnect());
  it('blocks warehouse deactivation and rejects assignment with expired credentials', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'warehouse-db-test',
      organizationIds: [],
      permissionVersion: 1,
      tenantId,
      tokenId: randomUUID(),
    };
    const other: TenantContext = { ...context, tenantId: randomUUID() };
    const command = (key = randomUUID()) => ({
      correlationId: randomUUID(),
      idempotencyKey: key,
      ipAddress: '127.0.0.1',
    });
    const service = new WarehouseFleetService(
      new IdempotencyService(prisma as never),
      prisma as never,
    );
    try {
      const createKey = randomUUID();
      const warehouseInput = {
        code: `WH-${randomUUID().slice(0, 8).toUpperCase()}`,
        name: '测试中心仓',
        temperatureCapabilities: ['AMBIENT', 'CHILLED'],
        timeZone: 'Asia/Shanghai',
      };
      const warehouse = await service.createWarehouse(
        warehouseInput,
        context,
        command(createKey),
      );
      await expect(
        service.createWarehouse(warehouseInput, context, command(createKey)),
      ).resolves.toEqual(warehouse);
      await expect(
        service.createWarehouse(
          { ...warehouseInput, name: '异内容' },
          context,
          command(createKey),
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
      const active = await service.transitionWarehouse(
        warehouse.warehouseId,
        'ACTIVE',
        { expectedVersion: warehouse.version },
        context,
        command(),
      );
      await service.createLocation(
        {
          code: 'ZONE-A',
          name: '常温区',
          temperatureZone: 'AMBIENT',
          type: 'ZONE',
          warehouseId: warehouse.warehouseId,
        },
        context,
        command(),
      );
      await service.createDock(
        { code: 'D-01', name: '一号月台', warehouseId: warehouse.warehouseId },
        context,
        command(),
      );
      await service.createGate(
        {
          code: 'G-01',
          direction: 'BOTH',
          name: '主门岗',
          warehouseId: warehouse.warehouseId,
        },
        context,
        command(),
      );

      for (const usage of [
        { inventoryQuantity: '1', openTaskCount: 0, futureAppointmentCount: 0 },
        { inventoryQuantity: '0', openTaskCount: 1, futureAppointmentCount: 0 },
        { inventoryQuantity: '0', openTaskCount: 0, futureAppointmentCount: 1 },
      ]) {
        await service.updateUsage(
          warehouse.warehouseId,
          { ...usage, sourceVersions: { wms: 1 } },
          context,
          command(),
        );
        await expect(
          service.transitionWarehouse(
            warehouse.warehouseId,
            'INACTIVE',
            { expectedVersion: active.version },
            context,
            command(),
          ),
        ).rejects.toMatchObject({
          code: 'WAREHOUSE_DEACTIVATION_BLOCKED',
          statusCode: 409,
        });
      }
      await service.updateUsage(
        warehouse.warehouseId,
        {
          futureAppointmentCount: 0,
          inventoryQuantity: '0',
          openTaskCount: 0,
          sourceVersions: { ams: 2, wms: 2 },
        },
        context,
        command(),
      );
      await expect(
        service.getWarehouse(warehouse.warehouseId, other),
      ).rejects.toMatchObject({ code: 'WAREHOUSE_NOT_FOUND' });

      const equipment = await service.createEquipmentType(
        {
          code: `VAN-${randomUUID().slice(0, 6).toUpperCase()}`,
          maxPayload: '2000',
          maxVolume: '20',
          name: '冷藏厢式车',
          payloadUom: 'KG',
          temperatureControlled: true,
          volumeUom: 'M3',
        },
        context,
        command(),
      );
      const vehicle = await service.createVehicle(
        {
          equipmentTypeId: equipment.id,
          maxPayload: '1800',
          maxVolume: '18',
          payloadUom: 'KG',
          plateNumber: `TEST-${randomUUID().slice(0, 6)}`,
          temperatureControlled: true,
          temperatureMax: '8',
          temperatureMin: '2',
          volumeUom: 'M3',
        },
        context,
        command(),
      );
      const driver = await service.createDriver(
        {
          driverNo: `D-${randomUUID().slice(0, 8)}`,
          name: '测试司机',
          phone: '13800000000',
        },
        context,
        command(),
      );
      await service.addDriverCertificate(
        {
          certificateNo: 'OLD-001',
          certificateType: 'LICENSE',
          driverId: driver.id,
          requiredForAssignment: true,
          validFrom: '2020-01-01',
          validUntil: '2025-01-01',
        },
        context,
        command(),
      );
      await expect(
        service.transitionFleet(
          'driver',
          driver.id,
          { expectedVersion: driver.version, targetStatus: 'AVAILABLE' },
          context,
          command(),
        ),
      ).rejects.toMatchObject({ code: 'DRIVER_CERTIFICATE_REQUIRED' });
      const expiredDecision = await service.checkAssignment(
        {
          driverId: driver.id,
          requiredCertificateTypes: ['LICENSE'],
          vehicleId: vehicle.id,
        },
        context,
      );
      expect(expiredDecision).toMatchObject({ allowed: false });
      expect(expiredDecision.reasons).toContain(
        'DRIVER_CERTIFICATE_INVALID:LICENSE',
      );
      const validCertificate = await service.addDriverCertificate(
        {
          certificateNo: 'VALID-001',
          certificateType: 'LICENSE',
          driverId: driver.id,
          requiredForAssignment: true,
          validFrom: '2026-01-01',
          validUntil: '2030-01-01',
        },
        context,
        command(),
      );
      const availableDriver = await service.transitionFleet(
        'driver',
        driver.id,
        { expectedVersion: driver.version, targetStatus: 'AVAILABLE' },
        context,
        command(),
      );
      const availableVehicle = await service.transitionFleet(
        'vehicle',
        vehicle.id,
        { expectedVersion: vehicle.version, targetStatus: 'AVAILABLE' },
        context,
        command(),
      );
      await expect(
        service.checkAssignment(
          {
            driverId: driver.id,
            payload: '1000',
            requiredCertificateTypes: ['LICENSE'],
            requiredTemperatureMax: '6',
            requiredTemperatureMin: '3',
            vehicleId: vehicle.id,
            volume: '10',
          },
          context,
        ),
      ).resolves.toMatchObject({ allowed: true });
      await service.transitionDriverCertificate(
        validCertificate.id,
        'REVOKED',
        { expectedVersion: validCertificate.version },
        context,
        command(),
      );
      await expect(
        service.checkAssignment(
          {
            driverId: driver.id,
            requiredCertificateTypes: ['LICENSE'],
            vehicleId: vehicle.id,
          },
          context,
        ),
      ).resolves.toMatchObject({ allowed: false });
      await service.transitionFleet(
        'driver',
        driver.id,
        {
          expectedVersion: availableDriver.version,
          reason: '休假',
          targetStatus: 'UNAVAILABLE',
        },
        context,
        command(),
      );
      await service.transitionFleet(
        'vehicle',
        vehicle.id,
        { expectedVersion: availableVehicle.version, targetStatus: 'INACTIVE' },
        context,
        command(),
      );
      await service.transitionWarehouse(
        warehouse.warehouseId,
        'INACTIVE',
        { expectedVersion: active.version },
        context,
        command(),
      );
    } finally {
      await prisma.driverCertificate.deleteMany({ where: { tenantId } });
      await prisma.driver.deleteMany({ where: { tenantId } });
      await prisma.vehicle.deleteMany({ where: { tenantId } });
      await prisma.equipmentType.deleteMany({ where: { tenantId } });
      await prisma.warehouseLocation.deleteMany({ where: { tenantId } });
      await prisma.warehouseDock.deleteMany({ where: { tenantId } });
      await prisma.warehouseGate.deleteMany({ where: { tenantId } });
      await prisma.warehouseUsageProjection.deleteMany({ where: { tenantId } });
      await prisma.warehouse.deleteMany({ where: { tenantId } });
      await prisma.platformOutbox.deleteMany({ where: { tenantId } });
      await prisma.idempotencyRecord.deleteMany({ where: { tenantId } });
    }
  });
});

import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import { OperationsService } from './operations.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe(
  'WMS value-added, labor, offline RF and device persistence',
  () => {
    afterAll(() => prisma.$disconnect());

    it('preserves conservation, immutable facts and offline replay semantics', async () => {
      const tenantId = randomUUID();
      const actorId = randomUUID();
      const warehouseId = randomUUID();
      const context: TenantContext = {
        accountId: actorId,
        accountKind: 'TENANT_ADMIN',
        deviceId: 'operations-db-test',
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
      await prisma.warehouse.create({
        data: {
          code: `OPS-${randomUUID().slice(0, 8)}`,
          createdBy: actorId,
          id: warehouseId,
          name: '增值劳务测试仓',
          status: 'ACTIVE',
          tenantId,
          timeZone: 'Asia/Shanghai',
          updatedBy: actorId,
        },
      });
      await prisma.warehouseLocation.create({
        data: {
          code: 'OPS-01',
          createdBy: actorId,
          name: '增值作业区',
          status: 'ACTIVE',
          tenantId,
          type: 'ZONE',
          updatedBy: actorId,
          warehouseId,
        },
      });
      const service = new OperationsService(
        prisma as never,
        new MdmReferenceService(prisma as never),
      );
      const created = await service.createValueAddedOrder(
        {
          assigneeRef: actorId,
          inputSnapshot: { handlingUnitRef: 'LPN-OLD' },
          instructionSnapshot: {
            preserveTrace: true,
            steps: ['SCAN', 'RELABEL'],
          },
          processVersion: 'RELABEL-V1',
          sourceRef: 'LPN-OLD',
          type: 'RELABEL',
          warehouseId,
          workcellRef: 'VAS-01',
        },
        context,
        command(),
      );
      const started = await service.transitionValueAddedOrder(
        created.valueAddedOrderId,
        { expectedVersion: created.version, targetStatus: 'IN_PROGRESS' },
        context,
        command(),
      );
      await expect(
        service.transitionValueAddedOrder(
          created.valueAddedOrderId,
          {
            expectedVersion: started.version,
            inputQuantityBase: '2',
            inputSnapshot: { handlingUnits: ['LPN-OLD'] },
            outputQuantityBase: '1',
            outputSnapshot: { handlingUnits: ['LPN-NEW'], uom: 'EA' },
            qualitySnapshot: { passed: true },
            targetStatus: 'COMPLETED',
          },
          context,
          command(),
        ),
      ).rejects.toMatchObject({ code: 'VAS_QUANTITY_NOT_CONSERVED' });
      const completed = await service.transitionValueAddedOrder(
        created.valueAddedOrderId,
        {
          expectedVersion: started.version,
          inputQuantityBase: '2',
          inputSnapshot: { handlingUnits: ['LPN-OLD'] },
          labelChange: {
            handlingUnitRef: 'HU-OPS-01',
            newLabel: `LPN-NEW-${randomUUID()}`,
            oldLabel: 'LPN-OLD',
            reasonCode: 'CUSTOMER_RELABEL',
          },
          outputQuantityBase: '2',
          outputSnapshot: { handlingUnits: ['LPN-NEW'], uom: 'EA' },
          processTrace: { operatorId: actorId, steps: ['SCAN', 'RELABEL'] },
          qualitySnapshot: { passed: true },
          targetStatus: 'COMPLETED',
        },
        context,
        command(),
      );
      expect(completed.status).toBe('COMPLETED');
      expect(
        await prisma.warehouseChargeFact.count({
          where: { businessRef: created.valueAddedOrderId, tenantId },
        }),
      ).toBe(1);

      const kit = await service.createValueAddedOrder(
        {
          inputSnapshot: {},
          instructionSnapshot: {
            bom: [
              { productId: 'COMP-A', quantityPerOutput: '2' },
              { productId: 'COMP-B', quantityPerOutput: '1' },
            ],
            bomVersion: 'BOM-1',
          },
          processVersion: 'KIT-V1',
          sourceRef: 'KIT-DEMAND-01',
          type: 'KITTING',
          warehouseId,
        },
        context,
        command(),
      );
      const kitStarted = await service.transitionValueAddedOrder(
        kit.valueAddedOrderId,
        { expectedVersion: kit.version, targetStatus: 'IN_PROGRESS' },
        context,
        command(),
      );
      await expect(
        service.transitionValueAddedOrder(
          kit.valueAddedOrderId,
          {
            expectedVersion: kitStarted.version,
            inputQuantityBase: '3',
            inputSnapshot: {
              components: [
                { productId: 'COMP-A', quantityBase: '1' },
                { productId: 'COMP-B', quantityBase: '1' },
              ],
            },
            outputQuantityBase: '1',
            outputSnapshot: { productId: 'KIT-A', uom: 'EA' },
            qualitySnapshot: { passed: true },
            targetStatus: 'COMPLETED',
          },
          context,
          command(),
        ),
      ).rejects.toMatchObject({ code: 'VAS_BOM_CONSERVATION_FAILED' });

      const standard = await service.saveLaborStandard(
        {
          effectiveFrom: new Date(Date.now() - 1000).toISOString(),
          minutesPerUnit: '2',
          ruleSnapshot: { qualityWeight: 1 },
          standardVersion: 'VAS-STANDARD-V1',
          taskType: 'VAS_RELABEL',
        },
        context,
        command(),
      );
      const assignment = await service.createLaborAssignment(
        {
          assigneeRef: actorId,
          assigneeType: 'PERSON',
          businessRef: created.valueAddedOrderId,
          quantityBase: '2',
          standardId: standard.laborStandardId,
          taskType: 'VAS_RELABEL',
        },
        context,
        command(),
      );
      const laborStarted = await service.transitionLaborAssignment(
        assignment.laborAssignmentId,
        { expectedVersion: assignment.version, targetStatus: 'IN_PROGRESS' },
        context,
        command(),
      );
      const laborCompleted = await service.transitionLaborAssignment(
        assignment.laborAssignmentId,
        {
          actualMinutes: '5',
          completedQuantityBase: '2',
          exceptionCount: 0,
          expectedVersion: laborStarted.version,
          qualityScore: '100',
          targetStatus: 'COMPLETED',
          waitMinutes: '1',
        },
        context,
        command(),
      );
      expect(Number(laborCompleted.performanceScore)).toBeGreaterThan(0);

      const offlineCommand = {
        businessRef: created.valueAddedOrderId,
        businessVersion: completed.version,
        commandType: 'VAS_CONFIRM',
        deviceSequence: '1',
        idempotencyKey: `offline-${randomUUID()}`,
        payload: { barcode: 'LPN-NEW', quantity: '2' },
      };
      const synced = await service.syncOfflineCommands(
        'RF-OPS-01',
        [offlineCommand],
        context,
        command(),
      );
      expect(synced.results[0]).toMatchObject({
        replayed: false,
        status: 'APPLIED',
      });
      const replayed = await service.syncOfflineCommands(
        'RF-OPS-01',
        [offlineCommand],
        context,
        command(),
      );
      expect(replayed.results[0]).toMatchObject({
        replayed: true,
        status: 'APPLIED',
      });
      const conflicting = await service.syncOfflineCommands(
        'RF-OPS-01',
        [{ ...offlineCommand, payload: { barcode: 'DIFFERENT' } }],
        context,
        command(),
      );
      expect(conflicting.results[0]).toMatchObject({ status: 'CONFLICT' });
      const stale = await service.syncOfflineCommands(
        'RF-OPS-01',
        [
          {
            ...offlineCommand,
            businessVersion: 1,
            deviceSequence: '2',
            idempotencyKey: `offline-${randomUUID()}`,
          },
        ],
        context,
        command(),
      );
      expect(stale.results[0]).toMatchObject({ status: 'CONFLICT' });
      const openConflict = await prisma.offlineSyncConflict.findFirstOrThrow({
        where: { status: 'OPEN', tenantId },
      });
      await service.resolveOfflineConflict(
        openConflict.id,
        {
          expectedVersion: openConflict.version,
          resolutionSnapshot: { action: 'discard incoming duplicate' },
        },
        context,
        command(),
      );

      const device = await service.issueDeviceCommand(
        {
          adapterType: 'PRINT',
          businessRef: created.valueAddedOrderId,
          commandType: 'PRINT_NEW_LABEL',
          deviceRef: 'PRINTER-OPS-01',
          payload: { copies: 1, label: 'LPN-NEW' },
          timeoutAt: new Date(Date.now() + 60_000).toISOString(),
        },
        context,
        command(),
      );
      const acknowledged = await service.recordDeviceEvent(
        device.deviceCommandId,
        {
          eventType: 'ACKNOWLEDGED',
          expectedVersion: device.version,
          occurredAt: new Date().toISOString(),
          payload: { printerJobId: 'JOB-01', status: 'PRINTED' },
        },
        context,
        command(),
      );
      expect(acknowledged.status).toBe('ACKNOWLEDGED');
      const dashboard = await service.dashboard(context);
      expect(dashboard.labor.completedQuantityBase).toBe('2');
      expect(dashboard.exceptions.offlineConflicts).toBeGreaterThan(0);
      await expect(
        prisma.valueAddedOperationFact.update({
          data: { outputQuantityBase: '999' },
          where: { id: completed.operationFactId! },
        }),
      ).rejects.toBeTruthy();
      await expect(
        prisma.valueAddedLabelEvent.update({
          data: { oldLabel: 'MUTATED' },
          where: {
            id: (
              await prisma.valueAddedLabelEvent.findFirstOrThrow({
                where: { valueAddedOrderId: created.valueAddedOrderId },
              })
            ).id,
          },
        }),
      ).rejects.toBeTruthy();
      await expect(
        prisma.laborMetric.update({
          data: { performanceScore: '999' },
          where: { id: laborCompleted.laborMetricId! },
        }),
      ).rejects.toBeTruthy();
      await expect(
        prisma.offlineCommand.update({
          data: { payloadHash: '0'.repeat(64) },
          where: { id: String(synced.results[0]!.commandId) },
        }),
      ).rejects.toBeTruthy();
      await expect(
        prisma.deviceEvent.update({
          data: { eventType: 'MUTATED' },
          where: { id: acknowledged.deviceEventId },
        }),
      ).rejects.toBeTruthy();
      await expect(
        prisma.warehouseChargeFact.update({
          data: { quantity: '999' },
          where: { id: completed.chargeFactId! },
        }),
      ).rejects.toBeTruthy();
    });
  },
);

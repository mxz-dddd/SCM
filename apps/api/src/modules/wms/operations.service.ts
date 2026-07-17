import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type ValueAddedType } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import { businessNumber } from '../platform/public/numbering.facade';
import type { CommandMetadata } from '../platform/tenant.service';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};

interface OfflineInput {
  readonly businessRef: string;
  readonly businessVersion: number;
  readonly commandType: string;
  readonly deviceSequence: string;
  readonly idempotencyKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

@Injectable()
export class OperationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MdmReferenceService) private readonly mdm: MdmReferenceService,
  ) {}

  async workbench(context: TenantContext) {
    const [
      valueAddedOrders,
      laborStandards,
      laborAssignments,
      laborMetrics,
      offlineCommands,
      syncConflicts,
      deviceCommands,
      chargeFacts,
    ] = await Promise.all([
      this.prisma.valueAddedOrder.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.laborStandard.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.laborWorkAssignment.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.laborMetric.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.offlineCommand.findMany({
        orderBy: [{ deviceId: 'asc' }, { deviceSequence: 'desc' }],
        take: 200,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.offlineSyncConflict.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.deviceCommand.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.warehouseChargeFact.findMany({
        orderBy: { occurredAt: 'desc' },
        take: 100,
        where: { tenantId: context.tenantId },
      }),
    ]);
    return toHttpJson({
      chargeFacts,
      deviceCommands,
      laborAssignments,
      laborMetrics,
      laborStandards,
      offlineCommands,
      snapshotAt: new Date(),
      syncConflicts,
      valueAddedOrders,
    });
  }

  async dashboard(context: TenantContext) {
    const [
      inboundOpen,
      pickOpen,
      packOpen,
      loadOpen,
      vasOpen,
      offlineConflicts,
      inventory,
      labor,
      weightExceptions,
      staging,
    ] = await Promise.all([
      this.prisma.inboundOrder.count({
        where: {
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          tenantId: context.tenantId,
        },
      }),
      this.prisma.pickTask.count({
        where: {
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          tenantId: context.tenantId,
        },
      }),
      this.prisma.packTask.count({
        where: {
          status: { notIn: ['PACKED', 'CANCELLED'] },
          tenantId: context.tenantId,
        },
      }),
      this.prisma.loadTask.count({
        where: {
          status: { notIn: ['SHIPPED', 'CANCELLED'] },
          tenantId: context.tenantId,
        },
      }),
      this.prisma.valueAddedOrder.count({
        where: {
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          tenantId: context.tenantId,
        },
      }),
      this.prisma.offlineSyncConflict.count({
        where: { status: 'OPEN', tenantId: context.tenantId },
      }),
      this.prisma.inventoryBalance.aggregate({
        _sum: {
          allocatedBase: true,
          availableBase: true,
          holdBase: true,
          onHandBase: true,
        },
        where: { tenantId: context.tenantId },
      }),
      this.prisma.laborMetric.aggregate({
        _avg: { performanceScore: true, qualityScore: true },
        _sum: {
          actualMinutes: true,
          completedQuantityBase: true,
          waitMinutes: true,
        },
        where: { tenantId: context.tenantId },
      }),
      this.prisma.weightException.count({
        where: { status: 'OPEN', tenantId: context.tenantId },
      }),
      this.prisma.stagingTask.count({
        where: { status: 'STAGED', tenantId: context.tenantId },
      }),
    ]);
    return {
      exceptions: { offlineConflicts, weightExceptions },
      inventory: {
        allocatedBase: inventory._sum.allocatedBase?.toString() ?? '0',
        availableBase: inventory._sum.availableBase?.toString() ?? '0',
        holdBase: inventory._sum.holdBase?.toString() ?? '0',
        onHandBase: inventory._sum.onHandBase?.toString() ?? '0',
      },
      labor: {
        actualMinutes: labor._sum.actualMinutes?.toString() ?? '0',
        completedQuantityBase:
          labor._sum.completedQuantityBase?.toString() ?? '0',
        performanceScore: labor._avg.performanceScore?.toString() ?? '0',
        qualityScore: labor._avg.qualityScore?.toString() ?? '0',
        waitMinutes: labor._sum.waitMinutes?.toString() ?? '0',
      },
      snapshotAt: new Date(),
      tasks: { inboundOpen, loadOpen, packOpen, pickOpen, staging, vasOpen },
    };
  }

  async createValueAddedOrder(
    input: {
      assigneeRef?: string;
      inputSnapshot: Readonly<Record<string, unknown>>;
      instructionSnapshot: Readonly<Record<string, unknown>>;
      processVersion: string;
      sourceRef: string;
      type: ValueAddedType;
      warehouseId: string;
      workcellRef?: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.warehouseId, 'warehouseId');
    if (
      !input.sourceRef?.trim() ||
      !input.processVersion?.trim() ||
      !Object.keys(input.instructionSnapshot ?? {}).length
    )
      this.invalid('Source, process version and instructions are required');
    if (
      !(await this.mdm.listWarehouseLocations(input.warehouseId, context))
        .length
    )
      throw new AppError(
        'VAS_WAREHOUSE_INVALID',
        'Active warehouse is required',
        400,
      );
    const id = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.valueAddedOrder.create({
        data: {
          assigneeRef: input.assigneeRef?.trim() ?? null,
          createdBy: context.accountId,
          id,
          inputSnapshot: json(input.inputSnapshot),
          instructionSnapshot: json(input.instructionSnapshot),
          orderNo: await businessNumber(
            this.prisma,
            'WMS_VALUE_ADDED_ORDER',
            context,
            metadata,
            `value-added-order:${input.sourceRef}`,
          ),
          processVersion: input.processVersion.trim(),
          sourceRef: input.sourceRef.trim(),
          tenantId: context.tenantId,
          type: input.type,
          updatedBy: context.accountId,
          warehouseId: input.warehouseId,
          workcellRef: input.workcellRef?.trim() ?? null,
        },
      });
      await this.emit(
        tx,
        id,
        order.version,
        'wms.vas-created.v1',
        context,
        metadata,
        { type: order.type, valueAddedOrderId: id },
      );
      return {
        status: order.status,
        valueAddedOrderId: id,
        version: order.version,
      };
    });
  }

  transitionValueAddedOrder(
    id: string,
    input: {
      expectedVersion: number;
      inputQuantityBase?: string;
      inputSnapshot?: Readonly<Record<string, unknown>>;
      labelChange?: {
        handlingUnitRef: string;
        newLabel: string;
        oldLabel: string;
        reasonCode: string;
      };
      outputQuantityBase?: string;
      outputSnapshot?: Readonly<Record<string, unknown>>;
      processTrace?: Readonly<Record<string, unknown>>;
      qualitySnapshot?: Readonly<Record<string, unknown>>;
      targetStatus: 'IN_PROGRESS' | 'COMPLETED';
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'valueAddedOrderId');
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.valueAddedOrder.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!order || order.version !== input.expectedVersion)
        throw this.conflict('VAS_ORDER_CONFLICT');
      if (input.targetStatus === 'IN_PROGRESS') {
        if (order.status !== 'OPEN') throw this.conflict('VAS_ORDER_CONFLICT');
        const changed = await tx.valueAddedOrder.update({
          data: {
            startedAt: new Date(),
            status: 'IN_PROGRESS',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id },
        });
        await this.emit(
          tx,
          id,
          changed.version,
          'wms.vas-started.v1',
          context,
          metadata,
          { valueAddedOrderId: id },
        );
        return { status: changed.status, version: changed.version };
      }
      if (!['IN_PROGRESS', 'QUALITY_HOLD'].includes(order.status))
        throw this.conflict('VAS_ORDER_CONFLICT');
      const inputQuantity = this.nonNegative(input.inputQuantityBase);
      const outputQuantity = this.nonNegative(input.outputQuantityBase);
      const inputSnapshot = record(input.inputSnapshot);
      const outputSnapshot = record(input.outputSnapshot);
      const quality = record(input.qualitySnapshot);
      this.validateVasConservation(
        order.type,
        record(order.instructionSnapshot),
        inputQuantity,
        outputQuantity,
        inputSnapshot,
        outputSnapshot,
      );
      if (order.type === 'RELABEL') {
        const change = input.labelChange;
        if (
          !change ||
          !change.handlingUnitRef?.trim() ||
          !change.oldLabel?.trim() ||
          !change.newLabel?.trim() ||
          !change.reasonCode?.trim() ||
          change.oldLabel === change.newLabel
        )
          this.invalid(
            'Relabel requires distinct old/new labels, handling unit and reason code',
          );
        await tx.valueAddedLabelEvent.create({
          data: {
            createdBy: context.accountId,
            eventSnapshot: json({
              oldStatus: 'VOID',
              processVersion: order.processVersion,
            }),
            handlingUnitRef: change.handlingUnitRef.trim(),
            newLabel: change.newLabel.trim(),
            oldLabel: change.oldLabel.trim(),
            reasonCode: change.reasonCode.trim(),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            valueAddedOrderId: id,
          },
        });
      }
      const qualityPassed = quality.passed === true;
      if (order.type === 'ASSEMBLY' && !qualityPassed) {
        const held = await tx.valueAddedOrder.update({
          data: {
            status: 'QUALITY_HOLD',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id },
        });
        await this.emit(
          tx,
          id,
          held.version,
          'wms.vas-quality-held.v1',
          context,
          metadata,
          { valueAddedOrderId: id },
        );
        return { status: held.status, version: held.version };
      }
      const fact = await tx.valueAddedOperationFact.create({
        data: {
          createdBy: context.accountId,
          inputQuantityBase: inputQuantity,
          inputSnapshot: json(inputSnapshot),
          occurredAt: new Date(),
          outputQuantityBase: outputQuantity,
          outputSnapshot: json(outputSnapshot),
          processTrace: json({
            ...record(input.processTrace),
            assigneeRef: order.assigneeRef,
            processVersion: order.processVersion,
            workcellRef: order.workcellRef,
          }),
          qualitySnapshot: json(quality),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          valueAddedOrderId: id,
        },
      });
      const charge = await tx.warehouseChargeFact.create({
        data: {
          businessRef: id,
          createdBy: context.accountId,
          factSnapshot: json({
            operationFactId: fact.id,
            processVersion: order.processVersion,
            sourceRef: order.sourceRef,
            type: order.type,
          }),
          factType: `VAS_${order.type}`,
          occurredAt: fact.occurredAt,
          quantity: outputQuantity,
          tenantId: context.tenantId,
          uom: String(outputSnapshot.uom ?? 'EA')
            .trim()
            .toUpperCase(),
          updatedBy: context.accountId,
        },
      });
      const changed = await tx.valueAddedOrder.update({
        data: {
          completedAt: new Date(),
          status: 'COMPLETED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.emit(
        tx,
        id,
        changed.version,
        'wms.vas-completed.v1',
        context,
        metadata,
        {
          chargeFactId: charge.id,
          operationFactId: fact.id,
          valueAddedOrderId: id,
        },
      );
      return {
        chargeFactId: charge.id,
        operationFactId: fact.id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  saveLaborStandard(
    input: {
      effectiveFrom: string;
      effectiveTo?: string;
      minutesPerUnit: string;
      ruleSnapshot?: Readonly<Record<string, unknown>>;
      standardVersion: string;
      taskType: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!input.taskType?.trim() || !input.standardVersion?.trim())
      this.invalid('Task type and standard version are required');
    const effectiveFrom = new Date(input.effectiveFrom);
    const effectiveTo = input.effectiveTo
      ? new Date(input.effectiveTo)
      : undefined;
    const minutes = this.positive(input.minutesPerUnit);
    if (
      Number.isNaN(effectiveFrom.getTime()) ||
      (effectiveTo &&
        (Number.isNaN(effectiveTo.getTime()) || effectiveTo <= effectiveFrom))
    )
      this.invalid('Labor standard effective interval is invalid');
    return this.prisma.$transaction(async (tx) => {
      const overlap = await tx.laborStandard.count({
        where: {
          effectiveFrom: { lt: effectiveTo ?? new Date('9999-12-31') },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
          status: 'ACTIVE',
          taskType: input.taskType.trim(),
          tenantId: context.tenantId,
        },
      });
      if (overlap)
        throw new AppError(
          'LABOR_STANDARD_OVERLAP',
          'Labor standard effective interval overlaps',
          409,
        );
      const row = await tx.laborStandard.create({
        data: {
          createdBy: context.accountId,
          effectiveFrom,
          effectiveTo: effectiveTo ?? null,
          minutesPerUnit: minutes,
          ruleSnapshot: json(input.ruleSnapshot),
          standardVersion: input.standardVersion.trim(),
          taskType: input.taskType.trim(),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        row.id,
        row.version,
        'wms.labor-standard-saved.v1',
        context,
        metadata,
        { laborStandardId: row.id, taskType: row.taskType },
      );
      return { laborStandardId: row.id, version: row.version };
    });
  }

  createLaborAssignment(
    input: {
      assigneeRef: string;
      assigneeType: 'PERSON' | 'TEAM' | 'VENDOR';
      businessRef: string;
      quantityBase: string;
      standardId: string;
      taskType: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.standardId, 'standardId');
    const quantity = this.positive(input.quantityBase);
    if (
      !input.assigneeRef?.trim() ||
      !input.businessRef?.trim() ||
      !input.taskType?.trim()
    )
      this.invalid('Assignee, business reference and task type are required');
    return this.prisma.$transaction(async (tx) => {
      const standard = await tx.laborStandard.findFirst({
        where: {
          id: input.standardId,
          status: 'ACTIVE',
          taskType: input.taskType.trim(),
          tenantId: context.tenantId,
        },
      });
      if (!standard)
        throw new AppError(
          'LABOR_STANDARD_INVALID',
          'Active matching labor standard is required',
          400,
        );
      const id = randomUUID();
      const row = await tx.laborWorkAssignment.create({
        data: {
          assigneeRef: input.assigneeRef.trim(),
          assigneeType: input.assigneeType,
          assignmentNo: await businessNumber(
            this.prisma,
            'WMS_LABOR_ASSIGNMENT',
            context,
            metadata,
            `labor-assignment:${input.businessRef}:${input.assigneeRef}`,
          ),
          businessRef: input.businessRef.trim(),
          createdBy: context.accountId,
          id,
          quantityBase: quantity,
          standardId: standard.id,
          taskType: input.taskType.trim(),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        id,
        row.version,
        'wms.labor-assigned.v1',
        context,
        metadata,
        { laborAssignmentId: id },
      );
      return {
        laborAssignmentId: id,
        status: row.status,
        version: row.version,
      };
    });
  }

  transitionLaborAssignment(
    id: string,
    input: {
      actualMinutes?: string;
      completedQuantityBase?: string;
      exceptionCount?: number;
      expectedVersion: number;
      qualityScore?: string;
      targetStatus: 'IN_PROGRESS' | 'COMPLETED';
      waitMinutes?: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'laborAssignmentId');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.laborWorkAssignment.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!row || row.version !== input.expectedVersion)
        throw this.conflict('LABOR_ASSIGNMENT_CONFLICT');
      if (input.targetStatus === 'IN_PROGRESS') {
        if (row.status !== 'OPEN')
          throw this.conflict('LABOR_ASSIGNMENT_CONFLICT');
        const changed = await tx.laborWorkAssignment.update({
          data: {
            startedAt: new Date(),
            status: 'IN_PROGRESS',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id },
        });
        return { status: changed.status, version: changed.version };
      }
      if (row.status !== 'IN_PROGRESS')
        throw this.conflict('LABOR_ASSIGNMENT_CONFLICT');
      const actual = this.positive(input.actualMinutes);
      const completed = this.positive(input.completedQuantityBase);
      const wait = this.nonNegative(input.waitMinutes);
      const quality = this.nonNegative(input.qualityScore);
      const exceptions = input.exceptionCount ?? 0;
      if (
        quality.greaterThan(100) ||
        !Number.isInteger(exceptions) ||
        exceptions < 0 ||
        completed.greaterThan(row.quantityBase)
      )
        this.invalid('Labor completion metrics are invalid');
      const standard = await tx.laborStandard.findUniqueOrThrow({
        where: { id: row.standardId },
      });
      const standardMinutes = standard.minutesPerUnit.mul(completed);
      const productiveMinutes = Prisma.Decimal.max(
        actual.sub(wait),
        new Prisma.Decimal('0.000001'),
      );
      const efficiency = standardMinutes.mul(100).div(productiveMinutes);
      const performance = Prisma.Decimal.max(
        efficiency
          .mul(quality)
          .div(100)
          .sub(new Prisma.Decimal(exceptions).mul(5)),
        0,
      );
      const metric = await tx.laborMetric.create({
        data: {
          actualMinutes: actual,
          completedQuantityBase: completed,
          createdBy: context.accountId,
          exceptionCount: exceptions,
          laborAssignmentId: id,
          metricSnapshot: json({
            efficiency: efficiency.toString(),
            standardVersion: standard.standardVersion,
          }),
          performanceScore: performance,
          qualityScore: quality,
          standardMinutes,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          waitMinutes: wait,
        },
      });
      const changed = await tx.laborWorkAssignment.update({
        data: {
          completedAt: new Date(),
          status: 'COMPLETED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.emit(
        tx,
        id,
        changed.version,
        'wms.labor-completed.v1',
        context,
        metadata,
        {
          laborAssignmentId: id,
          laborMetricId: metric.id,
          performanceScore: performance.toString(),
        },
      );
      return {
        laborMetricId: metric.id,
        performanceScore: performance.toString(),
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async syncOfflineCommands(
    deviceId: string,
    commands: readonly OfflineInput[],
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!deviceId?.trim() || !commands.length)
      this.invalid('Device and offline commands are required');
    const ordered = [...commands].sort((left, right) =>
      Number(BigInt(left.deviceSequence) - BigInt(right.deviceSequence)),
    );
    const results = [];
    for (const command of ordered) {
      const sequence = this.sequence(command.deviceSequence);
      if (
        !command.idempotencyKey?.trim() ||
        !command.commandType?.trim() ||
        !command.businessRef?.trim() ||
        command.businessVersion < 1
      )
        this.invalid('Offline command metadata is invalid');
      const fingerprint = this.hash({
        businessRef: command.businessRef,
        businessVersion: command.businessVersion,
        commandType: command.commandType,
        payload: command.payload,
      });
      results.push(
        await this.prisma.$transaction(async (tx) => {
          const existing = await tx.offlineCommand.findFirst({
            where: {
              tenantId: context.tenantId,
              OR: [
                { deviceId: deviceId.trim(), deviceSequence: sequence },
                { idempotencyKey: command.idempotencyKey.trim() },
              ],
            },
          });
          if (existing) {
            if (existing.payloadHash === fingerprint)
              return {
                commandId: existing.id,
                deviceSequence: command.deviceSequence,
                replayed: true,
                result: existing.resultSnapshot,
                status: existing.status,
              };
            const conflict = await tx.offlineSyncConflict.create({
              data: {
                businessRef: command.businessRef.trim(),
                conflictSnapshot: json({
                  existingCommandId: existing.id,
                  existingHash: existing.payloadHash,
                  incomingHash: fingerprint,
                }),
                createdBy: context.accountId,
                deviceId: deviceId.trim(),
                deviceSequence: sequence,
                reasonCode: 'DEVICE_SEQUENCE_CONTENT_CONFLICT',
                tenantId: context.tenantId,
                updatedBy: context.accountId,
              },
            });
            return {
              conflictId: conflict.id,
              deviceSequence: command.deviceSequence,
              replayed: false,
              status: 'CONFLICT' as const,
            };
          }
          const currentVersion = await this.businessVersion(
            tx,
            command.commandType,
            command.businessRef,
            context.tenantId,
          );
          const conflictReason =
            currentVersion !== undefined &&
            currentVersion !== command.businessVersion
              ? 'BUSINESS_VERSION_CONFLICT'
              : undefined;
          const resultSnapshot = conflictReason
            ? {
                currentVersion,
                expectedVersion: command.businessVersion,
                requiresManualReview: true,
              }
            : {
                accepted: true,
                appliedInDeviceOrder: true,
                commandType: command.commandType,
              };
          const row = await tx.offlineCommand.create({
            data: {
              businessRef: command.businessRef.trim(),
              businessVersion: command.businessVersion,
              commandType: command.commandType.trim(),
              createdBy: context.accountId,
              deviceId: deviceId.trim(),
              deviceSequence: sequence,
              idempotencyKey: command.idempotencyKey.trim(),
              payload: json(command.payload),
              payloadHash: fingerprint,
              resultSnapshot: json(resultSnapshot),
              status: conflictReason ? 'CONFLICT' : 'APPLIED',
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          let conflictId: string | undefined;
          if (conflictReason) {
            const conflict = await tx.offlineSyncConflict.create({
              data: {
                businessRef: command.businessRef.trim(),
                conflictSnapshot: json(resultSnapshot),
                createdBy: context.accountId,
                deviceId: deviceId.trim(),
                deviceSequence: sequence,
                reasonCode: conflictReason,
                tenantId: context.tenantId,
                updatedBy: context.accountId,
              },
            });
            conflictId = conflict.id;
          }
          await this.emit(
            tx,
            row.id,
            row.version,
            conflictReason
              ? 'wms.offline-conflict.v1'
              : 'wms.offline-applied.v1',
            context,
            metadata,
            {
              commandId: row.id,
              conflictId,
              deviceId: row.deviceId,
              deviceSequence: row.deviceSequence.toString(),
            },
          );
          return {
            commandId: row.id,
            conflictId,
            deviceSequence: command.deviceSequence,
            replayed: false,
            result: resultSnapshot,
            status: row.status,
          };
        }),
      );
    }
    return { deviceId: deviceId.trim(), results };
  }

  resolveOfflineConflict(
    id: string,
    input: {
      expectedVersion: number;
      resolutionSnapshot: Readonly<Record<string, unknown>>;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'conflictId');
    if (!Object.keys(input.resolutionSnapshot ?? {}).length)
      this.invalid('Conflict resolution is required');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.offlineSyncConflict.findFirst({
        where: {
          id,
          status: 'OPEN',
          tenantId: context.tenantId,
          version: input.expectedVersion,
        },
      });
      if (!row) throw this.conflict('OFFLINE_CONFLICT_STATE_CHANGED');
      const changed = await tx.offlineSyncConflict.update({
        data: {
          resolutionSnapshot: json(input.resolutionSnapshot),
          resolvedAt: new Date(),
          status: 'RESOLVED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.emit(
        tx,
        id,
        changed.version,
        'wms.offline-conflict-resolved.v1',
        context,
        metadata,
        { conflictId: id },
      );
      return { status: changed.status, version: changed.version };
    });
  }

  issueDeviceCommand(
    input: {
      adapterType: string;
      businessRef: string;
      commandType: string;
      deviceRef: string;
      payload: Readonly<Record<string, unknown>>;
      timeoutAt: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const adapters = [
      'PRINT',
      'SCALE',
      'CONVEYOR',
      'ELECTRONIC_LABEL',
      'GATE',
      'SORTER',
    ];
    const timeoutAt = new Date(input.timeoutAt);
    if (
      !adapters.includes(input.adapterType) ||
      !input.businessRef?.trim() ||
      !input.commandType?.trim() ||
      !input.deviceRef?.trim() ||
      Number.isNaN(timeoutAt.getTime()) ||
      timeoutAt <= new Date()
    )
      this.invalid('Device command adapter, references or timeout are invalid');
    const id = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.deviceCommand.create({
        data: {
          adapterType: input.adapterType,
          businessRef: input.businessRef.trim(),
          commandNo: await businessNumber(
            this.prisma,
            'WMS_DEVICE_COMMAND',
            context,
            metadata,
            `device-command:${input.businessRef}:${input.deviceRef}:${input.commandType}`,
          ),
          commandType: input.commandType.trim(),
          createdBy: context.accountId,
          deviceRef: input.deviceRef.trim(),
          id,
          payload: json(input.payload),
          sentAt: new Date(),
          status: 'SENT',
          tenantId: context.tenantId,
          timeoutAt,
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        id,
        row.version,
        'wms.device-command-sent.v1',
        context,
        metadata,
        {
          adapterType: row.adapterType,
          deviceCommandId: id,
          deviceRef: row.deviceRef,
        },
      );
      return { deviceCommandId: id, status: row.status, version: row.version };
    });
  }

  recordDeviceEvent(
    id: string,
    input: {
      eventType: 'ACKNOWLEDGED' | 'FAILED';
      expectedVersion: number;
      occurredAt: string;
      payload: Readonly<Record<string, unknown>>;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'deviceCommandId');
    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime()))
      this.invalid('Device event time is invalid');
    return this.prisma.$transaction(async (tx) => {
      const command = await tx.deviceCommand.findFirst({
        where: {
          id,
          status: 'SENT',
          tenantId: context.tenantId,
          version: input.expectedVersion,
        },
      });
      if (!command) throw this.conflict('DEVICE_COMMAND_CONFLICT');
      const event = await tx.deviceEvent.create({
        data: {
          createdBy: context.accountId,
          deviceCommandId: id,
          eventType: input.eventType,
          occurredAt,
          payload: json(input.payload),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const changed = await tx.deviceCommand.update({
        data: {
          completedAt: occurredAt,
          resultSnapshot: json(input.payload),
          status: input.eventType,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.emit(
        tx,
        id,
        changed.version,
        `wms.device-${input.eventType.toLowerCase()}.v1`,
        context,
        metadata,
        { deviceCommandId: id, deviceEventId: event.id },
      );
      return {
        deviceEventId: event.id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async timeoutDeviceCommands(
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const ids = await this.prisma.deviceCommand.findMany({
      select: { id: true },
      where: {
        status: { in: ['PENDING', 'SENT'] },
        tenantId: context.tenantId,
        timeoutAt: { lte: new Date() },
      },
    });
    const timedOut: string[] = [];
    for (const { id } of ids)
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.deviceCommand.updateMany({
          data: {
            completedAt: new Date(),
            resultSnapshot: json({ reason: 'ACK_TIMEOUT' }),
            status: 'TIMED_OUT',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id, status: { in: ['PENDING', 'SENT'] } },
        });
        if (!changed.count) return;
        const event = await tx.deviceEvent.create({
          data: {
            createdBy: context.accountId,
            deviceCommandId: id,
            eventType: 'TIMED_OUT',
            occurredAt: new Date(),
            payload: json({ reason: 'ACK_TIMEOUT' }),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        timedOut.push(id);
        await this.emit(
          tx,
          id,
          1,
          'wms.device-timed-out.v1',
          context,
          metadata,
          { deviceCommandId: id, deviceEventId: event.id },
        );
      });
    return { timedOut };
  }

  private validateVasConservation(
    type: ValueAddedType,
    instructions: Record<string, unknown>,
    inputQuantity: Prisma.Decimal,
    outputQuantity: Prisma.Decimal,
    inputSnapshot: Record<string, unknown>,
    outputSnapshot: Record<string, unknown>,
  ) {
    if (
      ['RELABEL', 'REPACK'].includes(type) &&
      !inputQuantity.equals(outputQuantity)
    )
      throw new AppError(
        'VAS_QUANTITY_NOT_CONSERVED',
        'Relabel and repack input/output quantities must be equal',
        409,
      );
    if (type === 'KITTING' || type === 'DISASSEMBLY') {
      const bom = Array.isArray(instructions.bom)
        ? instructions.bom.map(record)
        : [];
      const components = Array.isArray(inputSnapshot.components)
        ? inputSnapshot.components.map(record)
        : [];
      if (!String(instructions.bomVersion ?? '').trim() || !bom.length)
        this.invalid(
          'Kitting/disassembly requires a BOM version and components',
        );
      for (const definition of bom) {
        const actual = components.find(
          (component) => component.productId === definition.productId,
        );
        const required = this.nonNegative(definition.quantityPerOutput).mul(
          outputQuantity,
        );
        if (!actual || !this.nonNegative(actual.quantityBase).equals(required))
          throw new AppError(
            'VAS_BOM_CONSERVATION_FAILED',
            `Component ${String(definition.productId)} does not match BOM`,
            409,
          );
      }
    }
    if (type === 'ASSEMBLY') {
      if (
        !Array.isArray(record(outputSnapshot).steps) &&
        !Array.isArray(instructions.steps)
      )
        this.invalid('Assembly requires versioned process steps');
    }
  }

  private async businessVersion(
    tx: Prisma.TransactionClient,
    commandType: string,
    businessRef: string,
    tenantId: string,
  ) {
    if (!isUuid(businessRef)) return undefined;
    if (commandType.startsWith('PICK_'))
      return (
        await tx.pickTask.findFirst({
          select: { version: true },
          where: { id: businessRef, tenantId },
        })
      )?.version;
    if (commandType.startsWith('PACKAGE_'))
      return (
        await tx.packageUnit.findFirst({
          select: { version: true },
          where: { id: businessRef, tenantId },
        })
      )?.version;
    if (commandType.startsWith('VAS_'))
      return (
        await tx.valueAddedOrder.findFirst({
          select: { version: true },
          where: { id: businessRef, tenantId },
        })
      )?.version;
    return undefined;
  }

  private hash(value: unknown) {
    return createHash('sha256').update(canonical(value)).digest('hex');
  }

  private positive(value: unknown) {
    const number = this.nonNegative(value);
    if (!number.greaterThan(0)) this.invalid('Value must be positive');
    return number;
  }

  private nonNegative(value: unknown) {
    try {
      const number = new Prisma.Decimal(String(value ?? ''));
      if (!number.isFinite() || number.isNegative()) throw new Error();
      return number;
    } catch {
      this.invalid('Value must be a non-negative decimal');
    }
  }

  private sequence(value: string) {
    try {
      const sequence = BigInt(value);
      if (sequence <= 0n) throw new Error();
      return sequence;
    } catch {
      this.invalid('Device sequence must be a positive integer');
    }
  }

  private uuid(value: string, field: string) {
    if (!isUuid(value)) this.invalid(`${field} is invalid`);
  }

  private invalid(message: string): never {
    throw new AppError('WMS_OPERATIONS_INPUT_INVALID', message, 400);
  }

  private conflict(code: string) {
    return new AppError(code, 'Resource version or state changed', 409, {
      retryable: true,
    });
  }

  private async emit(
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
    event: string,
    context: TenantContext,
    metadata: CommandMetadata,
    payload: Prisma.InputJsonObject,
  ) {
    await Promise.all([
      tx.platformAuditLog.create({
        data: {
          action: event,
          after: payload,
          category: 'BUSINESS_CHANGE',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: id,
          resourceType: 'WarehouseOperation',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      tx.platformOutbox.create({
        data: {
          aggregateId: id,
          aggregateType: 'WarehouseOperation',
          aggregateVersion: version,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName: event,
          partitionKey: id,
          payload: { ...payload, tenantId: context.tenantId },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }
}

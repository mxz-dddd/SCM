import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type InspectionPlanMode,
  type QualityDispositionType,
  type QualityInspectionStatus,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import { RuleEvaluationFacade } from '../platform/public/rule-evaluation.facade';
import type { CommandMetadata } from '../platform/tenant.service';
import { InventoryService } from './inventory.service';

export interface CreateInspectionInput {
  readonly attachmentRefs?: readonly { readonly attachmentId: string }[];
  readonly inventoryLotId?: string;
  readonly planMode: InspectionPlanMode;
  readonly planSnapshot: Readonly<Record<string, unknown>>;
  readonly receiptLineId: string;
  readonly riskScore: string;
  readonly sampleSize: number;
}
export interface TransitionInspectionInput {
  readonly attachmentRefs?: readonly { readonly attachmentId: string }[];
  readonly expectedVersion: number;
  readonly results?: readonly {
    readonly attachmentRefs?: readonly { readonly attachmentId: string }[];
    readonly expectedSnapshot: Readonly<Record<string, unknown>>;
    readonly itemCode: string;
    readonly measuredSnapshot: Readonly<Record<string, unknown>>;
    readonly passed: boolean;
    readonly sampleRef: string;
  }[];
  readonly resultSummary?: Readonly<Record<string, unknown>>;
  readonly targetStatus: QualityInspectionStatus;
}
export interface DispositionInput {
  readonly approvalReference?: string;
  readonly expectedInspectionVersion: number;
  readonly quantityBase: string;
  readonly quantityOriginal: string;
  readonly reason: string;
  readonly type: QualityDispositionType;
}
export interface DecidePutawayInput {
  readonly handlingUnitId: string;
  readonly inventoryLotId?: string;
  readonly productId: string;
  readonly ruleSetCode: string;
}
export interface CreatePutawayTaskInput {
  readonly assignedTo?: string;
  readonly decisionExpectedVersion: number;
  readonly pathSequence?: number;
  readonly quantityBase: string;
  readonly quantityOriginal: string;
  readonly sourceLocationId?: string;
}
export interface ConfirmPutawayInput {
  readonly expectedVersion: number;
  readonly scannedLpn: string;
  readonly scannedSourceCode?: string;
  readonly scannedTargetCode: string;
}
export interface CreateCrossDockInput {
  readonly demandRef: string;
  readonly demandSnapshot: Readonly<Record<string, unknown>>;
  readonly inventoryLotId?: string;
  readonly productId: string;
  readonly quantityBase: string;
  readonly quantityOriginal: string;
  readonly receiptLineId: string;
  readonly stagingLocationId: string;
  readonly windowEnd: string;
  readonly windowStart: string;
}

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
function decimal(value: string, field: string, zero = false) {
  try {
    const result = new Prisma.Decimal(value);
    if (!result.isFinite() || result.isNegative() || (!zero && result.isZero()))
      throw new Error();
    return result;
  } catch {
    throw new AppError(
      'QUALITY_PUTAWAY_DECIMAL_INVALID',
      `${field} must be a ${zero ? 'non-negative' : 'positive'} decimal`,
      400,
    );
  }
}
function instant(value: string, field: string) {
  const result = new Date(value);
  if (Number.isNaN(result.valueOf()))
    throw new AppError(
      'QUALITY_PUTAWAY_DATE_INVALID',
      `${field} is invalid`,
      400,
    );
  return result;
}

@Injectable()
export class QualityPutawayService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MdmReferenceService) private readonly mdm: MdmReferenceService,
    @Inject(RuleEvaluationFacade) private readonly rules: RuleEvaluationFacade,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  async get(inboundId: string, context: TenantContext) {
    this.uuid(inboundId, 'inboundId');
    const exists = await this.prisma.inboundOrder.count({
      where: { id: inboundId, tenantId: context.tenantId },
    });
    if (!exists)
      throw new AppError(
        'INBOUND_NOT_FOUND',
        'Inbound order was not found',
        404,
      );
    const [inspections, dispositions, decisions, tasks, movements, crossDocks] =
      await Promise.all([
        this.prisma.qualityInspection.findMany({
          orderBy: { createdAt: 'asc' },
          where: { inboundOrderId: inboundId, tenantId: context.tenantId },
        }),
        this.prisma.qualityDisposition.findMany({
          orderBy: { occurredAt: 'asc' },
          where: { inboundOrderId: inboundId, tenantId: context.tenantId },
        }),
        this.prisma.putawayDecision.findMany({
          orderBy: { createdAt: 'asc' },
          where: { inboundOrderId: inboundId, tenantId: context.tenantId },
        }),
        this.prisma.putawayTask.findMany({
          orderBy: [{ pathSequence: 'asc' }, { createdAt: 'asc' }],
          where: { inboundOrderId: inboundId, tenantId: context.tenantId },
        }),
        this.prisma.putawayMovement.findMany({
          orderBy: { occurredAt: 'asc' },
          where: { inboundOrderId: inboundId, tenantId: context.tenantId },
        }),
        this.prisma.crossDockAllocation.findMany({
          orderBy: { createdAt: 'asc' },
          where: { inboundOrderId: inboundId, tenantId: context.tenantId },
        }),
      ]);
    const results = await this.prisma.qualityInspectionResult.findMany({
      where: {
        inspectionId: { in: inspections.map(({ id }) => id) },
        tenantId: context.tenantId,
      },
    });
    return {
      crossDocks,
      decisions,
      dispositions,
      inspections,
      movements,
      results,
      tasks,
    };
  }

  async createInspection(
    inboundId: string,
    input: CreateInspectionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(inboundId, 'inboundId');
    this.uuid(input.receiptLineId, 'receiptLineId');
    if (input.inventoryLotId) this.uuid(input.inventoryLotId, 'inventoryLotId');
    this.attachments(input.attachmentRefs);
    const risk = decimal(input.riskScore, 'riskScore', true);
    if (
      risk.greaterThan(100) ||
      !Number.isInteger(input.sampleSize) ||
      input.sampleSize < 0
    )
      throw new AppError(
        'QUALITY_PLAN_INVALID',
        'Risk and sample size are invalid',
        400,
      );
    if (
      (input.planMode === 'EXEMPT' && input.sampleSize !== 0) ||
      (input.planMode !== 'EXEMPT' && input.sampleSize < 1)
    )
      throw new AppError(
        'QUALITY_SAMPLE_SIZE_INVALID',
        'Sample size does not match plan mode',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const [order, receipt, lot] = await Promise.all([
        tx.inboundOrder.findFirst({
          where: {
            id: inboundId,
            status: 'RECEIVING',
            tenantId: context.tenantId,
          },
        }),
        tx.receiptLine.findFirst({
          where: {
            id: input.receiptLineId,
            inboundOrderId: inboundId,
            status: 'CONFIRMED',
            tenantId: context.tenantId,
          },
        }),
        input.inventoryLotId
          ? tx.inventoryLot.findFirst({
              where: {
                id: input.inventoryLotId,
                inboundOrderId: inboundId,
                receiptLineId: input.receiptLineId,
                tenantId: context.tenantId,
              },
            })
          : null,
      ]);
      if (!order || !receipt || (input.inventoryLotId && !lot))
        throw new AppError(
          'QUALITY_INSPECTION_SOURCE_INVALID',
          'Receiving order, receipt or lot is invalid',
          409,
        );
      if (!lot) {
        const receiptLotCount = await tx.inventoryLot.count({
          where: { receiptLineId: receipt.id, tenantId: context.tenantId },
        });
        if (receiptLotCount)
          throw new AppError(
            'QUALITY_INSPECTION_SOURCE_INVALID',
            'Lot-controlled receipt requires an inventory lot inspection',
            409,
          );
      }
      const id = randomUUID();
      const row = await tx.qualityInspection.create({
        data: {
          attachmentRefs: json(input.attachmentRefs ?? []),
          createdBy: context.accountId,
          id,
          inboundOrderId: inboundId,
          inspectionNo: `QI-${Date.now()}-${id.slice(0, 6)}`,
          inventoryLotId: lot?.id ?? null,
          planMode: input.planMode,
          planSnapshot: json(input.planSnapshot),
          productId: receipt.productId,
          receiptLineId: receipt.id,
          riskScore: risk,
          sampleSize: input.sampleSize,
          supplierId: order.supplierId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        id,
        'QualityInspection',
        row.version,
        'quality.inspection-created.v1',
        context,
        metadata,
        {
          inboundId,
          inspectionId: id,
          planMode: row.planMode,
          receiptLineId: receipt.id,
        },
      );
      return { inspectionId: id, status: row.status, version: row.version };
    });
  }

  async transitionInspection(
    id: string,
    input: TransitionInspectionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'inspectionId');
    this.attachments(input.attachmentRefs);
    for (const result of input.results ?? [])
      this.attachments(result.attachmentRefs);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.qualityInspection.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!row || row.version !== input.expectedVersion)
        throw this.conflict('QUALITY_INSPECTION_CONFLICT');
      const allowed =
        (row.status === 'PENDING' && input.targetStatus === 'INSPECTING') ||
        (row.status === 'PENDING' &&
          row.planMode === 'EXEMPT' &&
          input.targetStatus === 'ACCEPTED') ||
        (row.status === 'INSPECTING' &&
          ['ACCEPTED', 'REJECTED', 'HOLD'].includes(input.targetStatus)) ||
        (row.status === 'HOLD' && input.targetStatus === 'INSPECTING');
      if (!allowed)
        throw new AppError(
          'QUALITY_INSPECTION_TRANSITION_INVALID',
          `Inspection transition ${row.status} -> ${input.targetStatus} is not allowed`,
          409,
        );
      const terminal = ['ACCEPTED', 'REJECTED', 'HOLD'].includes(
        input.targetStatus,
      );
      const results = input.results ?? [];
      const existingSamples = terminal
        ? await tx.qualityInspectionResult.findMany({
            select: { sampleRef: true },
            where: { inspectionId: id, tenantId: context.tenantId },
          })
        : [];
      const sampleCount = new Set([
        ...existingSamples.map(({ sampleRef }) => sampleRef),
        ...results.map(({ sampleRef }) => sampleRef.trim()),
      ]).size;
      if (
        terminal &&
        row.planMode !== 'EXEMPT' &&
        (!results.length ||
          new Set(results.map((x) => `${x.itemCode}:${x.sampleRef}`)).size !==
            results.length ||
          sampleCount < row.sampleSize)
      )
        throw new AppError(
          'QUALITY_RESULTS_REQUIRED',
          'Unique inspection item/sample results are required',
          400,
        );
      if (
        input.targetStatus === 'ACCEPTED' &&
        results.some(({ passed }) => !passed)
      )
        throw new AppError(
          'QUALITY_ACCEPT_WITH_FAILURE',
          'Failed result cannot be accepted',
          409,
        );
      for (const result of results)
        await tx.qualityInspectionResult.create({
          data: {
            attachmentRefs: json(result.attachmentRefs ?? []),
            createdBy: context.accountId,
            expectedSnapshot: json(result.expectedSnapshot),
            inspectionId: id,
            itemCode: result.itemCode.trim().toUpperCase(),
            measuredSnapshot: json(result.measuredSnapshot),
            passed: result.passed,
            sampleRef: result.sampleRef.trim(),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      const changed = await tx.qualityInspection.updateMany({
        data: {
          attachmentRefs: input.attachmentRefs
            ? json(input.attachmentRefs)
            : json(row.attachmentRefs),
          completedAt: terminal ? new Date() : row.completedAt,
          resultSummary: json(input.resultSummary ?? {}),
          startedAt:
            input.targetStatus === 'INSPECTING'
              ? (row.startedAt ?? new Date())
              : row.startedAt,
          status: input.targetStatus,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id, status: row.status, version: input.expectedVersion },
      });
      if (changed.count !== 1)
        throw this.conflict('QUALITY_INSPECTION_CONFLICT');
      if (terminal) {
        const lotStatus =
          input.targetStatus === 'ACCEPTED' ? 'RELEASED' : 'QUALITY_HOLD';
        if (row.inventoryLotId) {
          const inventoryLot = await tx.inventoryLot.findUniqueOrThrow({
            where: { id: row.inventoryLotId },
          });
          if (
            input.targetStatus !== 'ACCEPTED' ||
            inventoryLot.status !== 'QUARANTINED'
          )
            await tx.inventoryLot.update({
              data: {
                status: lotStatus,
                updatedBy: context.accountId,
                version: { increment: 1 },
              },
              where: { id: row.inventoryLotId },
            });
        }
        await tx.serialNumber.updateMany({
          data: {
            status: lotStatus,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            receiptLineId: row.receiptLineId,
            ...(input.targetStatus === 'ACCEPTED'
              ? { status: { not: 'QUARANTINED' as const } }
              : {}),
            tenantId: context.tenantId,
          },
        });
      }
      await this.record(
        tx,
        id,
        'QualityInspection',
        row.version + 1,
        'quality.inspection-transitioned.v1',
        context,
        metadata,
        {
          from: row.status,
          inboundId: row.inboundOrderId,
          inspectionId: id,
          to: input.targetStatus,
        },
      );
      return { status: input.targetStatus, version: row.version + 1 };
    });
  }

  async dispose(
    inspectionId: string,
    input: DispositionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(inspectionId, 'inspectionId');
    if (
      !input.reason?.trim() ||
      (input.type === 'CONCESSION' && !input.approvalReference?.trim())
    )
      throw new AppError(
        'QUALITY_DISPOSITION_REASON_OR_APPROVAL_REQUIRED',
        'Disposition reason and concession approval are required',
        400,
      );
    const original = decimal(input.quantityOriginal, 'quantityOriginal');
    const base = decimal(input.quantityBase, 'quantityBase');
    return this.prisma.$transaction(async (tx) => {
      const inspection = await tx.qualityInspection.findFirst({
        where: { id: inspectionId, tenantId: context.tenantId },
      });
      if (
        !inspection ||
        inspection.version !== input.expectedInspectionVersion ||
        !['REJECTED', 'HOLD'].includes(inspection.status)
      )
        throw new AppError(
          'QUALITY_DISPOSITION_STATE_INVALID',
          'Inspection is not eligible for disposition',
          409,
        );
      const receipt = await tx.receiptLine.findFirstOrThrow({
        where: { id: inspection.receiptLineId, tenantId: context.tenantId },
      });
      if (
        !original.equals(receipt.receivedQuantityOriginal) ||
        !base.equals(receipt.receivedQuantityBase) ||
        !original
          .mul(receipt.receivedQuantityBase)
          .equals(base.mul(receipt.receivedQuantityOriginal))
      )
        throw new AppError(
          'QUALITY_DISPOSITION_QUANTITY_INVALID',
          'Disposition must cover the full receipt quantity',
          409,
        );
      const id = randomUUID();
      const target = {
        CONCESSION: 'RELEASED',
        DOWNGRADE: 'DOWNGRADED',
        RETURN_SUPPLIER: 'RETURNED',
        REWORK: 'REWORK',
        SCRAP: 'SCRAPPED',
      }[input.type] as
        'RELEASED' | 'DOWNGRADED' | 'RETURNED' | 'REWORK' | 'SCRAPPED';
      await tx.qualityDisposition.create({
        data: {
          approvalReference: input.approvalReference?.trim() ?? null,
          baseUom: receipt.receivedBaseUom,
          chargeFactSnapshot: {
            chargeType: `QUALITY_${input.type}`,
            quantityBase: base.toString(),
            source: 'WMS_QUALITY',
          },
          createdBy: context.accountId,
          dispositionNo: `QD-${Date.now()}-${id.slice(0, 6)}`,
          id,
          inboundOrderId: inspection.inboundOrderId,
          inspectionId,
          inventoryLotId: inspection.inventoryLotId,
          originalUom: receipt.receivedOriginalUom,
          quantityBase: base,
          quantityOriginal: original,
          reason: input.reason.trim(),
          tenantId: context.tenantId,
          type: input.type,
          updatedBy: context.accountId,
        },
      });
      if (inspection.inventoryLotId)
        await tx.inventoryLot.update({
          data: {
            status: target,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: inspection.inventoryLotId },
        });
      await tx.serialNumber.updateMany({
        data: {
          status: target,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { receiptLineId: receipt.id, tenantId: context.tenantId },
      });
      await this.record(
        tx,
        id,
        'QualityDisposition',
        1,
        'quality.disposition-recorded.v1',
        context,
        metadata,
        {
          dispositionId: id,
          inboundId: inspection.inboundOrderId,
          inventoryLotId: inspection.inventoryLotId,
          type: input.type,
        },
      );
      return { dispositionId: id, inventoryStatus: target };
    });
  }

  async decidePutaway(
    inboundId: string,
    input: DecidePutawayInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(inboundId, 'inboundId');
    this.uuid(input.handlingUnitId, 'handlingUnitId');
    this.uuid(input.productId, 'productId');
    if (input.inventoryLotId) this.uuid(input.inventoryLotId, 'inventoryLotId');
    const [order, unit, content, lot] = await Promise.all([
      this.prisma.inboundOrder.findFirst({
        where: {
          id: inboundId,
          status: 'RECEIVING',
          tenantId: context.tenantId,
        },
      }),
      this.prisma.handlingUnit.findFirst({
        where: {
          id: input.handlingUnitId,
          inboundOrderId: inboundId,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      }),
      this.prisma.handlingUnitContent.findFirst({
        where: {
          handlingUnitId: input.handlingUnitId,
          productId: input.productId,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      }),
      input.inventoryLotId
        ? this.prisma.inventoryLot.findFirst({
            where: {
              id: input.inventoryLotId,
              inboundOrderId: inboundId,
              productId: input.productId,
              status: 'RELEASED',
              tenantId: context.tenantId,
            },
          })
        : null,
    ]);
    if (!order || !unit || !content || (input.inventoryLotId && !lot))
      throw new AppError(
        'PUTAWAY_SOURCE_NOT_RELEASED',
        'Receiving content and quality-released lot are required',
        409,
      );
    const receipt = await this.prisma.receiptLine.findFirstOrThrow({
      where: { id: content.receiptLineId, tenantId: context.tenantId },
    });
    if (lot && lot.receiptLineId !== receipt.id)
      throw new AppError(
        'PUTAWAY_SOURCE_NOT_RELEASED',
        'Released lot does not belong to the handling unit receipt',
        409,
      );
    if (!lot) {
      const [acceptedInspection, receiptLotCount] = await Promise.all([
        this.prisma.qualityInspection.count({
          where: {
            receiptLineId: receipt.id,
            status: 'ACCEPTED',
            tenantId: context.tenantId,
          },
        }),
        this.prisma.inventoryLot.count({
          where: { receiptLineId: receipt.id, tenantId: context.tenantId },
        }),
      ]);
      if (!acceptedInspection || receiptLotCount)
        throw new AppError(
          'PUTAWAY_SOURCE_NOT_RELEASED',
          'Receiving content must pass quality inspection before putaway',
          409,
        );
    }
    const product = receipt.productSnapshot as Prisma.JsonObject;
    const allLocations = await this.mdm.listWarehouseLocations(
      order.warehouseId,
      context,
    );
    const hardExclusions: { candidateId: string; reason: string }[] = [];
    const eligible = allLocations.filter((location) => {
      let reason: string | undefined;
      if (location.type !== 'LOCATION') reason = 'NOT_STORAGE_LOCATION';
      else if (
        product.temperatureZone &&
        location.temperatureZone &&
        product.temperatureZone !== location.temperatureZone
      )
        reason = 'TEMPERATURE_INCOMPATIBLE';
      else if (product.hazardous === true && !location.hazardousAllowed)
        reason = 'HAZARDOUS_NOT_ALLOWED';
      else if (
        unit.type === 'PALLET' &&
        location.palletCapacity !== null &&
        new Prisma.Decimal(location.palletCapacity).lessThan(1)
      )
        reason = 'PALLET_CAPACITY_EXCEEDED';
      if (reason) hardExclusions.push({ candidateId: location.id, reason });
      return !reason;
    });
    if (!eligible.length)
      throw new AppError(
        'PUTAWAY_NO_ELIGIBLE_LOCATION',
        'No location satisfies hard constraints',
        409,
      );
    const result = await this.rules.evaluatePutaway(
      {
        candidates: eligible.map((location) => ({
          hazardousAllowed: location.hazardousAllowed,
          id: location.id,
          sequence: location.sequence,
          temperatureZone: location.temperatureZone,
          type: location.type,
        })),
        facts: {
          hazardous: product.hazardous === true,
          handlingUnitType: unit.type,
          productId: input.productId,
          quantityBase: Number(content.quantityBase),
          temperatureZone: product.temperatureZone ?? null,
        },
        ruleSetCode: input.ruleSetCode,
      },
      context,
      {
        ...metadata,
        idempotencyKey: `${metadata.idempotencyKey ?? metadata.correlationId}:putaway-rule`,
      },
    );
    const selected = eligible.find(
      ({ id }) => id === result.decision.selectedCandidateId,
    );
    if (!selected)
      throw new AppError(
        'PUTAWAY_RULE_NO_SELECTION',
        'Putaway rules did not select an eligible location',
        409,
      );
    return this.prisma.$transaction(async (tx) => {
      const id = randomUUID();
      const decision = await tx.putawayDecision.create({
        data: {
          candidateSnapshot: json(eligible),
          createdBy: context.accountId,
          evaluationTraceId: result.evaluationTraceId,
          exclusionSnapshot: json([...hardExclusions, ...result.exclusions]),
          handlingUnitId: unit.id,
          id,
          inboundOrderId: inboundId,
          inventoryLotId: lot?.id ?? null,
          productId: input.productId,
          ruleSetCode: result.ruleSetCode,
          selectedLocationId: selected.id,
          selectedLocationSnapshot: json(selected),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        id,
        'PutawayDecision',
        decision.version,
        'putaway.decision-created.v1',
        context,
        metadata,
        {
          evaluationTraceId: result.evaluationTraceId,
          handlingUnitId: unit.id,
          inboundId,
          selectedLocationId: selected.id,
        },
      );
      return {
        decisionId: id,
        evaluationTraceId: result.evaluationTraceId,
        exclusions: [...hardExclusions, ...result.exclusions],
        selectedLocationId: selected.id,
        version: decision.version,
      };
    });
  }

  async createPutawayTask(
    decisionId: string,
    input: CreatePutawayTaskInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(decisionId, 'decisionId');
    if (input.assignedTo) this.uuid(input.assignedTo, 'assignedTo');
    if (input.sourceLocationId)
      this.uuid(input.sourceLocationId, 'sourceLocationId');
    const original = decimal(input.quantityOriginal, 'quantityOriginal');
    const base = decimal(input.quantityBase, 'quantityBase');
    return this.prisma.$transaction(async (tx) => {
      const decision = await tx.putawayDecision.findFirst({
        where: { id: decisionId, tenantId: context.tenantId },
      });
      if (
        !decision ||
        decision.status !== 'PROPOSED' ||
        decision.version !== input.decisionExpectedVersion
      )
        throw this.conflict('PUTAWAY_DECISION_CONFLICT');
      await tx.$queryRaw`
        SELECT id FROM wms.handling_unit
        WHERE id = ${decision.handlingUnitId}::uuid
          AND tenant_id = ${context.tenantId}::uuid
        FOR UPDATE
      `;
      const content = await tx.handlingUnitContent.findFirst({
        where: {
          handlingUnitId: decision.handlingUnitId,
          productId: decision.productId,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      const assigned = await tx.putawayTask.aggregate({
        _sum: { quantityBase: true, quantityOriginal: true },
        where: {
          handlingUnitId: decision.handlingUnitId,
          status: { not: 'CANCELLED' },
          tenantId: context.tenantId,
        },
      });
      if (
        !content ||
        original
          .add(assigned._sum.quantityOriginal ?? 0)
          .greaterThan(content.quantityOriginal) ||
        base
          .add(assigned._sum.quantityBase ?? 0)
          .greaterThan(content.quantityBase) ||
        !original
          .mul(content.quantityBase)
          .equals(base.mul(content.quantityOriginal))
      )
        throw new AppError(
          'PUTAWAY_TASK_QUANTITY_INVALID',
          'Putaway quantity is invalid',
          409,
        );
      const selectedSnapshot =
        decision.selectedLocationSnapshot as Prisma.JsonObject;
      const selectedSequence = Number(selectedSnapshot.sequence ?? 0);
      const id = randomUUID();
      const task = await tx.putawayTask.create({
        data: {
          assignedTo: input.assignedTo ?? null,
          baseUom: content.baseUom,
          createdBy: context.accountId,
          handlingUnitId: decision.handlingUnitId,
          id,
          inboundOrderId: decision.inboundOrderId,
          originalUom: content.originalUom,
          pathSequence:
            input.pathSequence ??
            (Number.isInteger(selectedSequence) ? selectedSequence : 0),
          putawayDecisionId: decision.id,
          quantityBase: base,
          quantityOriginal: original,
          sourceLocationId: input.sourceLocationId ?? null,
          status: input.assignedTo ? 'ASSIGNED' : 'OPEN',
          targetLocationId: decision.selectedLocationId,
          taskNo: `PUT-${Date.now()}-${id.slice(0, 6)}`,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const changed = await tx.putawayDecision.updateMany({
        data: {
          status: 'CONFIRMED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          id: decision.id,
          status: 'PROPOSED',
          version: input.decisionExpectedVersion,
        },
      });
      if (changed.count !== 1) throw this.conflict('PUTAWAY_DECISION_CONFLICT');
      await this.record(
        tx,
        id,
        'PutawayTask',
        task.version,
        'putaway.task-created.v1',
        context,
        metadata,
        {
          handlingUnitId: task.handlingUnitId,
          inboundId: task.inboundOrderId,
          targetLocationId: task.targetLocationId,
          taskId: id,
        },
      );
      return { status: task.status, taskId: id, version: task.version };
    });
  }

  async startPutawayTask(
    id: string,
    input: { assignedTo?: string; expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'taskId');
    if (input.assignedTo) this.uuid(input.assignedTo, 'assignedTo');
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.putawayTask.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !task ||
        task.version !== input.expectedVersion ||
        !['OPEN', 'ASSIGNED'].includes(task.status)
      )
        throw this.conflict('PUTAWAY_TASK_CONFLICT');
      await tx.$queryRaw`
        SELECT id FROM wms.handling_unit
        WHERE id = ${task.handlingUnitId}::uuid
          AND tenant_id = ${context.tenantId}::uuid
        FOR UPDATE
      `;
      const assignedTo =
        input.assignedTo ?? task.assignedTo ?? context.accountId;
      const changed = await tx.putawayTask.updateMany({
        data: {
          assignedTo,
          startedAt: new Date(),
          status: 'IN_PROGRESS',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id, status: task.status, version: input.expectedVersion },
      });
      if (changed.count !== 1) throw this.conflict('PUTAWAY_TASK_CONFLICT');
      await this.record(
        tx,
        id,
        'PutawayTask',
        task.version + 1,
        'putaway.task-started.v1',
        context,
        metadata,
        {
          assignedTo,
          inboundId: task.inboundOrderId,
          taskId: id,
        },
      );
      return { assignedTo, status: 'IN_PROGRESS', version: task.version + 1 };
    });
  }

  async confirmPutaway(
    id: string,
    input: ConfirmPutawayInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'taskId');
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.putawayTask.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !task ||
        task.status !== 'IN_PROGRESS' ||
        task.version !== input.expectedVersion
      )
        throw this.conflict('PUTAWAY_TASK_CONFLICT');
      const [order, unit, decision] = await Promise.all([
        tx.inboundOrder.findFirstOrThrow({
          where: { id: task.inboundOrderId, tenantId: context.tenantId },
        }),
        tx.handlingUnit.findFirstOrThrow({
          where: { id: task.handlingUnitId, tenantId: context.tenantId },
        }),
        tx.putawayDecision.findFirstOrThrow({
          where: { id: task.putawayDecisionId, tenantId: context.tenantId },
        }),
      ]);
      const locations = await this.mdm.listWarehouseLocations(
        order.warehouseId,
        context,
      );
      const target = locations.find(
        ({ id: locationId }) => locationId === task.targetLocationId,
      );
      const source = task.sourceLocationId
        ? locations.find(
            ({ id: locationId }) => locationId === task.sourceLocationId,
          )
        : null;
      if (
        input.scannedLpn.trim().toUpperCase() !== unit.lpn.toUpperCase() ||
        input.scannedTargetCode.trim().toUpperCase() !==
          target?.code.toUpperCase() ||
        (source &&
          input.scannedSourceCode?.trim().toUpperCase() !==
            source.code.toUpperCase())
      )
        throw new AppError(
          'PUTAWAY_SCAN_MISMATCH',
          'Source, target or LPN scan does not match task',
          409,
        );
      const movement = await tx.putawayMovement.create({
        data: {
          baseUom: task.baseUom,
          createdBy: context.accountId,
          handlingUnitId: task.handlingUnitId,
          inboundOrderId: task.inboundOrderId,
          originalUom: task.originalUom,
          putawayTaskId: task.id,
          quantityBase: task.quantityBase,
          quantityOriginal: task.quantityOriginal,
          scannedLpn: input.scannedLpn.trim().toUpperCase(),
          scannedSourceCode:
            input.scannedSourceCode?.trim().toUpperCase() ?? null,
          scannedTargetCode: input.scannedTargetCode.trim().toUpperCase(),
          sourceLocationId: task.sourceLocationId,
          targetLocationId: task.targetLocationId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const changed = await tx.putawayTask.updateMany({
        data: {
          completedAt: new Date(),
          status: 'COMPLETED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id, status: 'IN_PROGRESS', version: input.expectedVersion },
      });
      if (changed.count !== 1) throw this.conflict('PUTAWAY_TASK_CONFLICT');
      await this.inventory.postPutaway(
        tx,
        {
          baseUom: task.baseUom,
          businessRef: task.id,
          businessType: 'PUTAWAY_TASK',
          handlingUnitId: task.handlingUnitId,
          ...(decision.inventoryLotId
            ? { inventoryLotId: decision.inventoryLotId }
            : {}),
          locationId: task.targetLocationId,
          originalUom: task.originalUom,
          ownerId: order.ownerId,
          productId: decision.productId,
          quantityBase: task.quantityBase.toString(),
          quantityOriginal: task.quantityOriginal.toString(),
          status: 'AVAILABLE',
          warehouseId: order.warehouseId,
        },
        context,
        metadata,
      );
      const completed = await tx.putawayMovement.aggregate({
        _sum: { quantityBase: true, quantityOriginal: true },
        where: {
          handlingUnitId: task.handlingUnitId,
          tenantId: context.tenantId,
        },
      });
      const content = await tx.handlingUnitContent.aggregate({
        _sum: { quantityBase: true, quantityOriginal: true },
        where: {
          handlingUnitId: task.handlingUnitId,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      if (
        new Prisma.Decimal(
          completed._sum.quantityBase ?? 0,
        ).greaterThanOrEqualTo(content._sum.quantityBase ?? 0) &&
        new Prisma.Decimal(
          completed._sum.quantityOriginal ?? 0,
        ).greaterThanOrEqualTo(content._sum.quantityOriginal ?? 0)
      )
        await tx.handlingUnit.update({
          data: {
            status: 'CLOSED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: unit.id },
        });
      await this.record(
        tx,
        movement.id,
        'PutawayMovement',
        movement.version,
        'putaway.confirmed.v1',
        context,
        metadata,
        {
          inboundId: task.inboundOrderId,
          movementId: movement.id,
          targetLocationId: task.targetLocationId,
          taskId: id,
        },
      );
      return {
        movementId: movement.id,
        status: 'COMPLETED',
        version: task.version + 1,
      };
    });
  }

  async createCrossDock(
    inboundId: string,
    input: CreateCrossDockInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(inboundId, 'inboundId');
    this.uuid(input.receiptLineId, 'receiptLineId');
    this.uuid(input.stagingLocationId, 'stagingLocationId');
    if (input.inventoryLotId) this.uuid(input.inventoryLotId, 'inventoryLotId');
    const original = decimal(input.quantityOriginal, 'quantityOriginal');
    const base = decimal(input.quantityBase, 'quantityBase');
    const windowStart = instant(input.windowStart, 'windowStart');
    const windowEnd = instant(input.windowEnd, 'windowEnd');
    if (windowStart >= windowEnd || windowEnd <= new Date())
      throw new AppError(
        'CROSS_DOCK_WINDOW_INVALID',
        'Cross-dock window is invalid or expired',
        409,
      );
    return this.prisma.$transaction(async (tx) => {
      const [order, receipt, lot] = await Promise.all([
        tx.inboundOrder.findFirst({
          where: {
            id: inboundId,
            status: 'RECEIVING',
            tenantId: context.tenantId,
          },
        }),
        tx.receiptLine.findFirst({
          where: {
            id: input.receiptLineId,
            inboundOrderId: inboundId,
            productId: input.productId,
            status: 'CONFIRMED',
            tenantId: context.tenantId,
          },
        }),
        input.inventoryLotId
          ? tx.inventoryLot.findFirst({
              where: {
                id: input.inventoryLotId,
                inboundOrderId: inboundId,
                productId: input.productId,
                receiptLineId: input.receiptLineId,
                status: 'RELEASED',
                tenantId: context.tenantId,
              },
            })
          : null,
      ]);
      if (!order || !receipt || (input.inventoryLotId && !lot))
        throw new AppError(
          'CROSS_DOCK_SOURCE_INVALID',
          'Quality-released receipt is required',
          409,
        );
      if (!lot) {
        const [acceptedInspection, receiptLotCount] = await Promise.all([
          tx.qualityInspection.count({
            where: {
              receiptLineId: receipt.id,
              status: 'ACCEPTED',
              tenantId: context.tenantId,
            },
          }),
          tx.inventoryLot.count({
            where: { receiptLineId: receipt.id, tenantId: context.tenantId },
          }),
        ]);
        if (!acceptedInspection || receiptLotCount)
          throw new AppError(
            'CROSS_DOCK_SOURCE_INVALID',
            'Receipt must pass quality inspection before cross-dock',
            409,
          );
      }
      const demandProduct = String(input.demandSnapshot.productId ?? '');
      const demandLot = input.demandSnapshot.inventoryLotId;
      if (
        demandProduct !== input.productId ||
        (demandLot !== undefined && demandLot !== input.inventoryLotId)
      )
        throw new AppError(
          'CROSS_DOCK_DEMAND_MISMATCH',
          'Demand product or lot does not match',
          409,
        );
      const allocated = await tx.crossDockAllocation.aggregate({
        _sum: { quantityBase: true, quantityOriginal: true },
        where: {
          receiptLineId: receipt.id,
          status: { in: ['PROPOSED', 'RESERVED', 'COMPLETED'] },
          tenantId: context.tenantId,
        },
      });
      if (
        base
          .add(allocated._sum.quantityBase ?? 0)
          .greaterThan(receipt.acceptedQuantityBase) ||
        original
          .add(allocated._sum.quantityOriginal ?? 0)
          .greaterThan(receipt.acceptedQuantityOriginal)
      )
        throw new AppError(
          'CROSS_DOCK_QUANTITY_EXCEEDED',
          'Cross-dock exceeds accepted receipt',
          409,
        );
      const locations = await this.mdm.listWarehouseLocations(
        order.warehouseId,
        context,
      );
      const staging = locations.find(
        ({ id: locationId, type }) =>
          locationId === input.stagingLocationId && type === 'STAGING',
      );
      if (!staging)
        throw new AppError(
          'CROSS_DOCK_STAGING_INVALID',
          'Active staging location is required',
          400,
        );
      const id = randomUUID();
      const row = await tx.crossDockAllocation.create({
        data: {
          baseUom: receipt.receivedBaseUom,
          createdBy: context.accountId,
          demandRef: input.demandRef.trim(),
          demandSnapshot: json(input.demandSnapshot),
          id,
          inboundOrderId: inboundId,
          inventoryLotId: lot?.id ?? null,
          originalUom: receipt.receivedOriginalUom,
          productId: input.productId,
          quantityBase: base,
          quantityOriginal: original,
          receiptLineId: receipt.id,
          stagingLocationId: staging.id,
          stagingLocationSnapshot: json(staging),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          windowEnd,
          windowStart,
        },
      });
      await this.record(
        tx,
        id,
        'CrossDockAllocation',
        row.version,
        'cross-dock.proposed.v1',
        context,
        metadata,
        {
          allocationId: id,
          demandRef: row.demandRef,
          inboundId,
        },
      );
      return { allocationId: id, status: row.status, version: row.version };
    });
  }

  async transitionCrossDock(
    id: string,
    input: {
      expectedVersion: number;
      targetStatus: 'RESERVED' | 'COMPLETED' | 'CANCELLED';
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'allocationId');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.crossDockAllocation.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      const allowed =
        row &&
        row.version === input.expectedVersion &&
        ((row.status === 'PROPOSED' &&
          ['RESERVED', 'CANCELLED'].includes(input.targetStatus)) ||
          (row.status === 'RESERVED' &&
            ['COMPLETED', 'CANCELLED'].includes(input.targetStatus)));
      if (!allowed) throw this.conflict('CROSS_DOCK_TRANSITION_INVALID');
      const changed = await tx.crossDockAllocation.updateMany({
        data: {
          status: input.targetStatus,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id, status: row.status, version: input.expectedVersion },
      });
      if (changed.count !== 1)
        throw this.conflict('CROSS_DOCK_TRANSITION_INVALID');
      await this.record(
        tx,
        id,
        'CrossDockAllocation',
        row.version + 1,
        'cross-dock.transitioned.v1',
        context,
        metadata,
        {
          allocationId: id,
          from: row.status,
          inboundId: row.inboundOrderId,
          to: input.targetStatus,
        },
      );
      return { status: input.targetStatus, version: row.version + 1 };
    });
  }

  private attachments(
    refs: readonly { readonly attachmentId: string }[] | undefined,
  ) {
    for (const ref of refs ?? []) this.uuid(ref.attachmentId, 'attachmentId');
  }
  private uuid(value: string, field: string) {
    if (!isUuid(value))
      throw new AppError('WMS_INPUT_INVALID', `${field} is invalid`, 400);
  }
  private conflict(code: string) {
    return new AppError(code, 'Resource changed or state is invalid', 409, {
      retryable: true,
    });
  }
  private async record(
    tx: Prisma.TransactionClient,
    id: string,
    type: string,
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
          resourceType: type,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      tx.platformOutbox.create({
        data: {
          aggregateId: id,
          aggregateType: type,
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

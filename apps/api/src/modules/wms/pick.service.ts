import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import type { CommandMetadata } from '../platform/tenant.service';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> =>
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

export interface PickScanInput {
  readonly deviceId: string;
  readonly deviceSequence: string;
  readonly handlingUnitId?: string;
  readonly productId: string;
  readonly quantityBase: string;
  readonly scannedAt: string;
  readonly sourceLocationId: string;
  readonly targetContainerCode: string;
  readonly taskLineId: string;
}

@Injectable()
export class PickService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MdmReferenceService) private readonly mdm: MdmReferenceService,
  ) {}

  async workbench(context: TenantContext) {
    const [tasks, lines, routes, scans, shortPicks, verifications] =
      await Promise.all([
        this.prisma.pickTask.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 100,
          where: { tenantId: context.tenantId },
        }),
        this.prisma.pickTaskLine.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 300,
          where: { tenantId: context.tenantId },
        }),
        this.prisma.pickRouteVersion.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 100,
          where: { tenantId: context.tenantId },
        }),
        this.prisma.pickScanEvent.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 200,
          where: { tenantId: context.tenantId },
        }),
        this.prisma.shortPickCase.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 100,
          where: { tenantId: context.tenantId },
        }),
        this.prisma.pickVerificationResult.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 100,
          where: { tenantId: context.tenantId },
        }),
      ]);
    return {
      lines,
      routes,
      scans,
      shortPicks,
      snapshotAt: new Date(),
      tasks,
      verifications,
    };
  }

  assignTask(
    id: string,
    input: {
      assigneeId: string;
      containerCode: string;
      expectedVersion: number;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'taskId');
    this.uuid(input.assigneeId, 'assigneeId');
    if (!input.containerCode?.trim()) this.invalid('Container is required');
    return this.changeTask(
      id,
      input.expectedVersion,
      ['OPEN'],
      {
        assignedTo: input.assigneeId,
        containerCode: input.containerCode.trim(),
        status: 'ASSIGNED',
      },
      'picking.task-assigned.v1',
      context,
      metadata,
    );
  }

  startTask(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'taskId');
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.pickTask.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!task || task.status !== 'ASSIGNED' || task.version !== input.expectedVersion)
        throw this.conflict('PICK_TASK_CONFLICT');
      const changed = await tx.pickTask.update({
        data: {
          startedAt: new Date(),
          status: 'IN_PROGRESS',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      const orderIds = await tx.pickTaskLine.findMany({
        distinct: ['outboundOrderId'],
        select: { outboundOrderId: true },
        where: { taskId: id, tenantId: context.tenantId },
      });
      await tx.outboundOrder.updateMany({
        data: { status: 'PICKING', updatedBy: context.accountId, version: { increment: 1 } },
        where: {
          id: { in: orderIds.map(({ outboundOrderId }) => outboundOrderId) },
          status: 'ALLOCATED',
          tenantId: context.tenantId,
        },
      });
      await this.emit(tx, id, changed.version, 'picking.task-started.v1', context, metadata, { taskId: id });
      return { status: changed.status, version: changed.version };
    });
  }

  async replanRoute(
    id: string,
    input: {
      aisleDirection?: 'FORWARD' | 'REVERSE';
      congestionSnapshot?: Readonly<Record<string, number>>;
      expectedVersion: number;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'taskId');
    const task = await this.prisma.pickTask.findFirst({
      where: { id, tenantId: context.tenantId },
    });
    if (!task) throw this.conflict('PICK_TASK_CONFLICT');
    const wave = await this.prisma.wavePlan.findFirstOrThrow({
      where: { id: task.waveId, tenantId: context.tenantId },
    });
    const locations = await this.mdm.listWarehouseLocations(wave.warehouseId, context);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.pickTask.findFirst({ where: { id, tenantId: context.tenantId } });
      if (
        !current ||
        !['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(current.status) ||
        current.version !== input.expectedVersion
      )
        throw this.conflict('PICK_TASK_CONFLICT');
      const lines = await tx.pickTaskLine.findMany({
        where: { taskId: id, tenantId: context.tenantId },
      });
      const locationById = new Map(locations.map((row) => [row.id, row]));
      const congestion = input.congestionSnapshot ?? {};
      const ordered = [...lines].sort((left, right) => {
        const leftLocation = locationById.get(left.sourceLocationId);
        const rightLocation = locationById.get(right.sourceLocationId);
        const direction = input.aisleDirection === 'REVERSE' ? -1 : 1;
        return (
          (Number(congestion[left.sourceLocationId] ?? 0) - Number(congestion[right.sourceLocationId] ?? 0)) ||
          direction * ((leftLocation?.sequence ?? 999999) - (rightLocation?.sequence ?? 999999)) ||
          left.id.localeCompare(right.id)
        );
      });
      const routeVersion = current.routeVersion + 1;
      await tx.pickRouteVersion.create({
        data: {
          createdBy: context.accountId,
          inputSnapshot: json({
            aisleDirection: input.aisleDirection ?? 'FORWARD',
            congestion,
            source: 'DYNAMIC_REPLAN',
          }),
          routeSnapshot: json({
            stops: ordered.map((line, index) => ({
              locationCode: locationById.get(line.sourceLocationId)?.code,
              locationId: line.sourceLocationId,
              sequence: index + 1,
              taskLineId: line.id,
            })),
          }),
          routeVersion,
          taskId: id,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const changed = await tx.pickTask.update({
        data: { routeVersion, updatedBy: context.accountId, version: { increment: 1 } },
        where: { id },
      });
      await this.emit(tx, id, changed.version, 'picking.route-replanned.v1', context, metadata, { routeVersion, taskId: id });
      return { routeVersion, version: changed.version };
    });
  }

  async scan(
    id: string,
    input: PickScanInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'taskId');
    this.uuid(input.taskLineId, 'taskLineId');
    this.uuid(input.sourceLocationId, 'sourceLocationId');
    this.uuid(input.productId, 'productId');
    if (input.handlingUnitId) this.uuid(input.handlingUnitId, 'handlingUnitId');
    const quantity = this.quantity(input.quantityBase);
    const sequence = this.sequence(input.deviceSequence);
    const scannedAt = new Date(input.scannedAt);
    if (!input.deviceId?.trim() || !input.targetContainerCode?.trim() || Number.isNaN(scannedAt.getTime()))
      this.invalid('Device, sequence, target container and scan time are required');
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.pickScanEvent.findUnique({
        where: {
          tenantId_deviceId_deviceSequence: {
            deviceId: input.deviceId.trim(),
            deviceSequence: sequence,
            tenantId: context.tenantId,
          },
        },
      });
      if (existing) {
        const prior = this.scanFingerprint(existing);
        const incoming = this.scanFingerprint({
          ...input,
          deviceSequence: sequence,
          quantityBase: quantity,
          scannedAt,
          taskId: id,
        });
        if (canonical(prior) !== canonical(incoming))
          throw new AppError(
            'PICK_DEVICE_SEQUENCE_CONFLICT',
            'Device sequence was already used with different scan content',
            409,
          );
        const confirmation = await tx.pickConfirmation.findFirst({
          where: { scanEventId: existing.id, tenantId: context.tenantId },
        });
        return {
          confirmationId: confirmation?.id,
          outcome: existing.outcome,
          rejectionCode: existing.rejectionCode,
          replayed: true,
          scanEventId: existing.id,
        };
      }
      const [task, line] = await Promise.all([
        tx.pickTask.findFirst({ where: { id, tenantId: context.tenantId } }),
        tx.pickTaskLine.findFirst({
          where: { id: input.taskLineId, taskId: id, tenantId: context.tenantId },
        }),
      ]);
      let rejectionCode: string | undefined;
      if (!task || task.status !== 'IN_PROGRESS') rejectionCode = 'PICK_TASK_NOT_EXECUTING';
      else if (!line) rejectionCode = 'PICK_TASK_LINE_INVALID';
      else if (line.sourceLocationId !== input.sourceLocationId) rejectionCode = 'PICK_SOURCE_LOCATION_MISMATCH';
      else if (line.productId !== input.productId) rejectionCode = 'PICK_PRODUCT_MISMATCH';
      else if ((line.handlingUnitId ?? null) !== (input.handlingUnitId ?? null)) rejectionCode = 'PICK_HANDLING_UNIT_MISMATCH';
      else if (task.containerCode !== input.targetContainerCode.trim()) rejectionCode = 'PICK_TARGET_CONTAINER_MISMATCH';
      else if (line.pickedBase.add(line.shortBase).add(quantity).greaterThan(line.requiredBase)) rejectionCode = 'PICK_QUANTITY_EXCEEDED';
      const scan = await tx.pickScanEvent.create({
        data: {
          createdBy: context.accountId,
          deviceId: input.deviceId.trim(),
          deviceSequence: sequence,
          handlingUnitId: input.handlingUnitId ?? null,
          outcome: rejectionCode ? 'REJECTED' : 'ACCEPTED',
          productId: input.productId,
          quantityBase: quantity,
          rejectionCode: rejectionCode ?? null,
          scannedAt,
          sourceLocationId: input.sourceLocationId,
          targetContainerCode: input.targetContainerCode.trim(),
          taskId: id,
          taskLineId: input.taskLineId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      if (rejectionCode) {
        await this.emit(
          tx,
          id,
          task?.version ?? 1,
          'picking.scan-rejected.v1',
          context,
          metadata,
          {
            rejectionCode,
            scanEventId: scan.id,
            taskId: id,
          },
        );
        return { outcome: 'REJECTED' as const, rejectionCode, replayed: false, scanEventId: scan.id };
      }
      const confirmation = await tx.pickConfirmation.create({
        data: {
          confirmationSnapshot: json({
            deviceId: input.deviceId.trim(),
            deviceSequence: sequence.toString(),
            handlingUnitId: input.handlingUnitId,
            productId: input.productId,
            scannedAt,
            sourceLocationId: input.sourceLocationId,
            targetContainerCode: input.targetContainerCode.trim(),
          }),
          createdBy: context.accountId,
          quantityBase: quantity,
          scanEventId: scan.id,
          taskId: id,
          taskLineId: input.taskLineId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await tx.pickTaskLine.update({
        data: { pickedBase: { increment: quantity }, updatedBy: context.accountId, version: { increment: 1 } },
        where: { id: input.taskLineId },
      });
      const taskLines = await tx.pickTaskLine.findMany({
        where: { taskId: id, tenantId: context.tenantId },
      });
      const accounted = taskLines.every((row) =>
        row.pickedBase.add(row.shortBase).equals(row.requiredBase),
      );
      const changedTask = accounted
        ? await tx.pickTask.update({
            data: {
              status: 'REVIEWING',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id },
          })
        : task!;
      await this.emit(tx, id, changedTask.version, 'picking.scan-accepted.v1', context, metadata, {
        confirmationId: confirmation.id,
        quantityBase: quantity.toString(),
        scanEventId: scan.id,
        taskId: id,
      });
      return { confirmationId: confirmation.id, outcome: 'ACCEPTED' as const, replayed: false, scanEventId: scan.id };
    });
    if (result.outcome === 'REJECTED')
      throw new AppError(
        result.rejectionCode!,
        `RF scan was rejected and recorded (${result.scanEventId})`,
        409,
        { businessRef: result.scanEventId, retryable: result.replayed },
      );
    return result;
  }

  shortPick(
    taskLineId: string,
    input: { expectedLineVersion: number; reason: string; reasonCode: string; shortBase: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(taskLineId, 'taskLineId');
    const quantity = this.quantity(input.shortBase);
    if (!input.reasonCode?.trim() || !input.reason?.trim())
      this.invalid('Short-pick reason code and explanation are required');
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.pickTaskLine.findFirst({ where: { id: taskLineId, tenantId: context.tenantId } });
      if (!line || line.version !== input.expectedLineVersion) throw this.conflict('PICK_TASK_LINE_CONFLICT');
      const task = await tx.pickTask.findFirstOrThrow({ where: { id: line.taskId, tenantId: context.tenantId } });
      if (task.status !== 'IN_PROGRESS' || line.pickedBase.add(line.shortBase).add(quantity).greaterThan(line.requiredBase))
        throw this.conflict('PICK_SHORT_QUANTITY_CONFLICT');
      const caseId = randomUUID();
      const row = await tx.shortPickCase.create({
        data: {
          caseNo: `SPK-${Date.now()}-${caseId.slice(0, 6)}`,
          createdBy: context.accountId,
          id: caseId,
          optionsSnapshot: json({ allowed: ['REVIEW', 'FREEZE', 'CYCLE_COUNT', 'REALLOCATE', 'SHORT_SHIP'] }),
          reason: input.reason.trim(),
          reasonCode: input.reasonCode.trim(),
          shortBase: quantity,
          taskId: task.id,
          taskLineId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await tx.pickTaskLine.update({
        data: { shortBase: { increment: quantity }, updatedBy: context.accountId, version: { increment: 1 } },
        where: { id: taskLineId },
      });
      const changed = await tx.pickTask.update({
        data: { status: 'SHORT_PICK', updatedBy: context.accountId, version: { increment: 1 } },
        where: { id: task.id },
      });
      await this.emit(tx, task.id, changed.version, 'picking.short-pick-recorded.v1', context, metadata, {
        reasonCode: row.reasonCode,
        shortBase: quantity.toString(),
        shortPickId: row.id,
        taskId: task.id,
      });
      return { shortPickId: row.id, status: row.status, taskVersion: changed.version, version: row.version };
    });
  }

  resolveShortPick(
    id: string,
    input: { expectedVersion: number; resolutionSnapshot: Readonly<Record<string, unknown>>; type: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'shortPickId');
    const allowed = ['REVIEW', 'FREEZE', 'CYCLE_COUNT', 'REALLOCATE', 'SHORT_SHIP'];
    if (!allowed.includes(input.type) || !Object.keys(input.resolutionSnapshot ?? {}).length)
      this.invalid('Valid resolution type and detail are required');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.shortPickCase.findFirst({ where: { id, tenantId: context.tenantId } });
      if (!row || row.status !== 'OPEN' || row.version !== input.expectedVersion)
        throw this.conflict('PICK_SHORT_CASE_CONFLICT');
      const changed = await tx.shortPickCase.update({
        data: {
          resolutionSnapshot: json(input.resolutionSnapshot),
          resolutionType: input.type,
          resolvedAt: new Date(),
          status: 'RESOLVED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      const lines = await tx.pickTaskLine.findMany({ where: { taskId: row.taskId, tenantId: context.tenantId } });
      const complete = lines.every((line) => line.pickedBase.add(line.shortBase).equals(line.requiredBase));
      const task = await tx.pickTask.update({
        data: {
          status: complete ? 'REVIEWING' : 'IN_PROGRESS',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: row.taskId },
      });
      await this.emit(tx, row.taskId, task.version, 'picking.short-pick-resolved.v1', context, metadata, {
        resolutionType: input.type,
        shortPickId: id,
        taskId: row.taskId,
      });
      return { status: changed.status, taskStatus: task.status, taskVersion: task.version, version: changed.version };
    });
  }

  verifyTask(
    id: string,
    input: {
      actualSnapshot: Readonly<Record<string, unknown>>;
      expectedVersion: number;
      scopeRef: string;
      scopeType: 'ORDER' | 'CONTAINER' | 'PACKAGE';
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'taskId');
    if (!input.scopeRef?.trim() || !Object.keys(input.actualSnapshot ?? {}).length)
      this.invalid('Verification scope and actual snapshot are required');
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.pickTask.findFirst({ where: { id, tenantId: context.tenantId } });
      if (!task || task.status !== 'REVIEWING' || task.version !== input.expectedVersion)
        throw this.conflict('PICK_TASK_CONFLICT');
      if (await tx.shortPickCase.count({ where: { status: 'OPEN', taskId: id, tenantId: context.tenantId } }))
        throw new AppError('PICK_SHORT_CASE_OPEN', 'Open short picks block verification', 409);
      const lines = await tx.pickTaskLine.findMany({ where: { taskId: id, tenantId: context.tenantId } });
      if (!lines.every((line) => line.pickedBase.add(line.shortBase).equals(line.requiredBase)))
        throw new AppError('PICK_TASK_UNACCOUNTED', 'Every required quantity must be picked or shorted', 409);
      const expectedSnapshot = {
        containerCode: task.containerCode,
        lines: lines.map((line) => ({
          productId: line.productId,
          quantityBase: line.pickedBase.toString(),
          taskLineId: line.id,
        })),
      };
      const actual = object(input.actualSnapshot);
      const expectedLines = expectedSnapshot.lines
        .map((line) => `${line.taskLineId}:${line.productId}:${line.quantityBase}`)
        .sort();
      const actualLines = Array.isArray(actual.lines)
        ? actual.lines
            .map((value) => object(value))
            .map((line) => `${String(line.taskLineId)}:${String(line.productId)}:${this.decimalText(line.quantityBase)}`)
            .sort()
        : [];
      const variances: string[] = [];
      if (task.containerCode !== String(actual.containerCode ?? '')) variances.push('CONTAINER_MISMATCH');
      if (canonical(expectedLines) !== canonical(actualLines)) variances.push('LINE_MISMATCH');
      const status = variances.length ? 'FAILED' : 'PASSED';
      const verification = await tx.pickVerificationResult.create({
        data: {
          actualSnapshot: json(input.actualSnapshot),
          createdBy: context.accountId,
          expectedSnapshot: json(expectedSnapshot),
          scopeRef: input.scopeRef.trim(),
          scopeType: input.scopeType,
          status,
          taskId: id,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          varianceSnapshot: json({ variances }),
        },
      });
      let taskVersion = task.version;
      if (status === 'PASSED') {
        const changed = await tx.pickTask.update({
          data: { completedAt: new Date(), status: 'COMPLETED', updatedBy: context.accountId, version: { increment: 1 } },
          where: { id },
        });
        taskVersion = changed.version;
      }
      await this.emit(tx, id, taskVersion, `picking.verification-${status.toLowerCase()}.v1`, context, metadata, {
        taskId: id,
        verificationId: verification.id,
        variances,
      });
      return { status, taskVersion, verificationId: verification.id };
    });
  }

  correctVerification(
    id: string,
    input: { actualSnapshot: Readonly<Record<string, unknown>>; correctionType: 'RETURN' | 'SUPPLEMENT' | 'REALLOCATE' },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'verificationId');
    if (!Object.keys(input.actualSnapshot ?? {}).length) this.invalid('Correction detail is required');
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.pickVerificationResult.findFirst({ where: { id, tenantId: context.tenantId } });
      if (!original || original.status !== 'FAILED') throw this.conflict('PICK_VERIFICATION_CONFLICT');
      const corrected = await tx.pickVerificationResult.create({
        data: {
          actualSnapshot: json(input.actualSnapshot),
          correctedAt: new Date(),
          correctionType: input.correctionType,
          createdBy: context.accountId,
          expectedSnapshot: json(original.expectedSnapshot),
          scopeRef: original.scopeRef,
          scopeType: original.scopeType,
          status: 'CORRECTED',
          taskId: original.taskId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          varianceSnapshot: json({ correctsVerificationId: original.id }),
        },
      });
      await this.emit(tx, original.taskId, corrected.version, 'picking.verification-corrected.v1', context, metadata, {
        correctionType: input.correctionType,
        correctionVerificationId: corrected.id,
        originalVerificationId: original.id,
        taskId: original.taskId,
      });
      return { correctionVerificationId: corrected.id, status: corrected.status };
    });
  }

  private async changeTask(
    id: string,
    expectedVersion: number,
    statuses: readonly string[],
    data: Prisma.PickTaskUpdateInput,
    event: string,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.pickTask.findFirst({ where: { id, tenantId: context.tenantId } });
      if (!row || !statuses.includes(row.status) || row.version !== expectedVersion)
        throw this.conflict('PICK_TASK_CONFLICT');
      const changed = await tx.pickTask.update({
        data: { ...data, updatedBy: context.accountId, version: { increment: 1 } },
        where: { id },
      });
      await this.emit(tx, id, changed.version, event, context, metadata, { taskId: id });
      return { status: changed.status, version: changed.version };
    });
  }

  private scanFingerprint(value: {
    deviceId: string;
    deviceSequence: bigint | string;
    handlingUnitId?: string | null;
    productId: string;
    quantityBase: Prisma.Decimal | string;
    scannedAt: Date | string;
    sourceLocationId: string;
    targetContainerCode: string;
    taskId?: string;
    taskLineId: string;
  }) {
    return {
      deviceId: value.deviceId.trim(),
      deviceSequence: String(value.deviceSequence),
      handlingUnitId: value.handlingUnitId ?? null,
      productId: value.productId,
      quantityBase: new Prisma.Decimal(value.quantityBase).toString(),
      scannedAt: new Date(value.scannedAt).toISOString(),
      sourceLocationId: value.sourceLocationId,
      targetContainerCode: value.targetContainerCode.trim(),
      taskId: value.taskId,
      taskLineId: value.taskLineId,
    };
  }

  private decimalText(value: unknown) {
    try {
      return new Prisma.Decimal(String(value)).toString();
    } catch {
      return 'INVALID';
    }
  }

  private quantity(value: string) {
    try {
      const quantity = new Prisma.Decimal(value);
      if (!quantity.isFinite() || !quantity.greaterThan(0)) throw new Error();
      return quantity;
    } catch {
      this.invalid('Quantity must be a positive decimal');
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
    throw new AppError('PICK_INPUT_INVALID', message, 400);
  }

  private conflict(code: string) {
    return new AppError(code, 'Resource version or state changed', 409, { retryable: true });
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
          resourceType: 'PickTask',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      tx.platformOutbox.create({
        data: {
          aggregateId: id,
          aggregateType: 'PickTask',
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

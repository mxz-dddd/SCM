import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import type { CommandMetadata } from '../platform/tenant.service';
import { InventoryService } from './inventory.service';

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

interface BoxCandidate {
  readonly code: string;
  readonly excludedProductIds?: readonly string[];
  readonly maxVolume: string;
  readonly maxWeight: string;
}

@Injectable()
export class PackShipService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MdmReferenceService) private readonly mdm: MdmReferenceService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  async workbench(context: TenantContext) {
    const [packTasks, packages, exceptions, labels, staging, loads, dispatches, cancellations] =
      await Promise.all([
        this.prisma.packTask.findMany({ orderBy: { createdAt: 'desc' }, take: 100, where: { tenantId: context.tenantId } }),
        this.prisma.packageUnit.findMany({ orderBy: { createdAt: 'desc' }, take: 200, where: { tenantId: context.tenantId } }),
        this.prisma.weightException.findMany({ orderBy: { createdAt: 'desc' }, take: 100, where: { tenantId: context.tenantId } }),
        this.prisma.shippingLabel.findMany({ orderBy: { createdAt: 'desc' }, take: 200, where: { tenantId: context.tenantId } }),
        this.prisma.stagingTask.findMany({ orderBy: { createdAt: 'desc' }, take: 200, where: { tenantId: context.tenantId } }),
        this.prisma.loadTask.findMany({ orderBy: { createdAt: 'desc' }, take: 100, where: { tenantId: context.tenantId } }),
        this.prisma.outboundDispatch.findMany({ orderBy: { createdAt: 'desc' }, take: 100, where: { tenantId: context.tenantId } }),
        this.prisma.cancellationPlan.findMany({ orderBy: { createdAt: 'desc' }, take: 100, where: { tenantId: context.tenantId } }),
      ]);
    return toHttpJson({ cancellations, dispatches, exceptions, labels, loads, packTasks, packages, snapshotAt: new Date(), staging });
  }

  async createPackTask(
    outboundId: string,
    input: {
      boxes: readonly BoxCandidate[];
      materialSnapshot?: Readonly<Record<string, unknown>>;
      nested?: boolean;
      ruleSnapshot: Readonly<Record<string, unknown>>;
      serviceSnapshot?: Readonly<Record<string, unknown>>;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(outboundId, 'outboundId');
    if (!input.boxes?.length) this.invalid('At least one box candidate is required');
    const order = await this.prisma.outboundOrder.findFirst({ where: { id: outboundId, tenantId: context.tenantId } });
    if (!order || order.status !== 'PICKING') throw this.conflict('PACK_ORDER_STATE_CONFLICT');
    const pickTasks = await this.prisma.pickTask.findMany({ where: { tenantId: context.tenantId, waveId: { in: (await this.prisma.waveOrder.findMany({ select: { waveId: true }, where: { outboundOrderId: outboundId, tenantId: context.tenantId } })).map(({ waveId }) => waveId) } } });
    const relevantTaskIds = pickTasks.filter((task) => task.outboundOrderId === outboundId || task.outboundOrderId === null).map(({ id }) => id);
    const lines = await this.prisma.pickTaskLine.findMany({ where: { outboundOrderId: outboundId, pickedBase: { gt: 0 }, taskId: { in: relevantTaskIds }, tenantId: context.tenantId } });
    if (!lines.length || pickTasks.some((task) => relevantTaskIds.includes(task.id) && task.status !== 'COMPLETED'))
      throw new AppError('PACK_PICKING_INCOMPLETE', 'Every picking task must be completed before packing', 409);
    const references = await this.mdm.resolveOrderReferences({ lines: lines.map(({ productId }) => ({ productId })) }, context);
    const productById = new Map(references.products.map((product) => [product.id, product]));
    const unitFacts = lines.map((line) => {
      const snapshot = record(productById.get(line.productId)?.versionSnapshot);
      const weight = this.nonNegative(snapshot.grossWeight ?? snapshot.netWeight ?? input.ruleSnapshot.defaultUnitWeight ?? '0');
      const volume = this.nonNegative(snapshot.volume ?? input.ruleSnapshot.defaultUnitVolume ?? '0');
      return { line, unitVolume: volume, unitWeight: weight };
    });
    const totalWeight = unitFacts.reduce((sum, row) => sum.add(row.unitWeight.mul(row.line.pickedBase)), new Prisma.Decimal(0));
    const totalVolume = unitFacts.reduce((sum, row) => sum.add(row.unitVolume.mul(row.line.pickedBase)), new Prisma.Decimal(0));
    const productIds = new Set(lines.map(({ productId }) => productId));
    const boxes = input.boxes
      .map((box) => ({ ...box, volume: this.positive(box.maxVolume), weight: this.positive(box.maxWeight) }))
      .filter((box) => !(box.excludedProductIds ?? []).some((id) => productIds.has(id)))
      .sort((left, right) => left.volume.comparedTo(right.volume) || left.weight.comparedTo(right.weight));
    if (!boxes.length) throw new AppError('PACK_BOX_INCOMPATIBLE', 'Every box candidate violates product compatibility', 409);
    const selected = boxes.find((box) => box.weight.greaterThanOrEqualTo(totalWeight) && box.volume.greaterThanOrEqualTo(totalVolume)) ?? boxes.at(-1)!;
    const packageCount = Math.max(1, Math.ceil(Math.max(totalWeight.div(selected.weight).toNumber(), totalVolume.div(selected.volume).toNumber())));
    const taskId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      if (await tx.packTask.count({ where: { outboundOrderId: outboundId, tenantId: context.tenantId } }))
        throw this.conflict('PACK_TASK_EXISTS');
      const task = await tx.packTask.create({
        data: {
          createdBy: context.accountId,
          id: taskId,
          outboundOrderId: outboundId,
          recommendationSnapshot: json({ boxTypeCode: selected.code, packageCount, totalVolume: totalVolume.toString(), totalWeight: totalWeight.toString() }),
          ruleSnapshot: json(input.ruleSnapshot),
          startedAt: new Date(),
          status: 'PACKING',
          taskNo: `PKT-${Date.now()}-${taskId.slice(0, 6)}`,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const packageIds: string[] = [];
      for (let index = 0; index < packageCount; index += 1) {
        const packageId = randomUUID();
        packageIds.push(packageId);
        const portions = unitFacts.map(({ line, unitVolume, unitWeight }) => {
          const even = line.pickedBase.div(packageCount).toDecimalPlaces(12, Prisma.Decimal.ROUND_DOWN);
          const quantity = index === packageCount - 1 ? line.pickedBase.sub(even.mul(packageCount - 1)) : even;
          return { line, quantity, unitVolume, unitWeight };
        }).filter(({ quantity }) => quantity.greaterThan(0));
        await tx.packageUnit.create({
          data: {
            boxTypeCode: selected.code,
            createdBy: context.accountId,
            id: packageId,
            materialSnapshot: json(input.materialSnapshot),
            outboundOrderId: outboundId,
            packageNo: `PKG-${Date.now()}-${index + 1}-${packageId.slice(0, 6)}`,
            packTaskId: task.id,
            parentPackageId: input.nested && index > 0 ? packageIds[0]! : null,
            routeCode: order.routeCode,
            serviceSnapshot: json(input.serviceSnapshot),
            temperatureZone: order.temperatureZone,
            tenantId: context.tenantId,
            theoreticalVolume: portions.reduce((sum, row) => sum.add(row.unitVolume.mul(row.quantity)), new Prisma.Decimal(0)),
            theoreticalWeight: portions.reduce((sum, row) => sum.add(row.unitWeight.mul(row.quantity)), new Prisma.Decimal(0)),
            updatedBy: context.accountId,
          },
        });
        for (const { line, quantity } of portions)
          await tx.packageItem.create({
            data: {
              allocationId: line.allocationId,
              createdBy: context.accountId,
              inventoryLotId: line.inventoryLotId,
              packageId,
              pickTaskLineId: line.id,
              productId: line.productId,
              quantityBase: quantity,
              serialNumberId: line.serialNumberId,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
      }
      await this.emit(tx, outboundId, task.version, 'outbound.pack-created.v1', context, metadata, { outboundId, packageCount, packageIds, packTaskId: task.id });
      return { packageIds, packTaskId: task.id, status: task.status, version: task.version };
    });
  }

  async measurePackage(
    packageId: string,
    input: { deviceId: string; deviceSequence: string; height: string; length: string; measuredAt: string; rawSnapshot?: Readonly<Record<string, unknown>>; source: string; volume?: string; weight: string; width: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(packageId, 'packageId');
    const values = { height: this.positive(input.height), length: this.positive(input.length), weight: this.positive(input.weight), width: this.positive(input.width) };
    const volume = input.volume ? this.positive(input.volume) : values.length.mul(values.width).mul(values.height);
    const sequence = this.sequence(input.deviceSequence);
    const measuredAt = new Date(input.measuredAt);
    if (!input.deviceId?.trim() || !input.source?.trim() || Number.isNaN(measuredAt.getTime())) this.invalid('Measurement device, source and time are required');
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.packageMeasurement.findUnique({ where: { tenantId_deviceId_deviceSequence: { deviceId: input.deviceId.trim(), deviceSequence: sequence, tenantId: context.tenantId } } });
      const fingerprint = { height: values.height.toString(), length: values.length.toString(), measuredAt: measuredAt.toISOString(), packageId, source: input.source.trim(), volume: volume.toString(), weight: values.weight.toString(), width: values.width.toString() };
      if (existing) {
        const prior = { height: existing.height.toString(), length: existing.length.toString(), measuredAt: existing.measuredAt.toISOString(), packageId: existing.packageId, source: existing.source, volume: existing.volume.toString(), weight: existing.weight.toString(), width: existing.width.toString() };
        if (canonical(prior) !== canonical(fingerprint)) throw new AppError('MEASUREMENT_DEVICE_SEQUENCE_CONFLICT', 'Device sequence has different measurement content', 409);
        const weightException = await tx.weightException.findFirst({ where: { measurementId: existing.id, tenantId: context.tenantId } });
        return { exceptionId: weightException?.id, measurementId: existing.id, replayed: true, status: weightException ? 'EXCEPTION' : 'ACCEPTED' };
      }
      const unit = await tx.packageUnit.findFirst({ where: { id: packageId, status: 'OPEN', tenantId: context.tenantId } });
      if (!unit) throw this.conflict('PACKAGE_MEASUREMENT_STATE_CONFLICT');
      const task = await tx.packTask.findFirstOrThrow({ where: { id: unit.packTaskId, tenantId: context.tenantId } });
      const measurement = await tx.packageMeasurement.create({ data: { createdBy: context.accountId, deviceId: input.deviceId.trim(), deviceSequence: sequence, height: values.height, length: values.length, measuredAt, packageId, rawSnapshot: json(input.rawSnapshot), source: input.source.trim(), tenantId: context.tenantId, updatedBy: context.accountId, volume, weight: values.weight, width: values.width } });
      const rules = record(task.ruleSnapshot);
      const weightTolerance = this.nonNegative(rules.weightTolerancePct ?? '10');
      const volumeTolerance = this.nonNegative(rules.volumeTolerancePct ?? '10');
      const weightVariance = unit.theoreticalWeight.equals(0) ? new Prisma.Decimal(0) : values.weight.sub(unit.theoreticalWeight).abs().mul(100).div(unit.theoreticalWeight);
      const volumeVariance = unit.theoreticalVolume.equals(0) ? new Prisma.Decimal(0) : volume.sub(unit.theoreticalVolume).abs().mul(100).div(unit.theoreticalVolume);
      await tx.packageUnit.update({ data: { actualVolume: volume, actualWeight: values.weight, updatedBy: context.accountId, version: { increment: 1 } }, where: { id: packageId } });
      let exceptionId: string | undefined;
      if (weightVariance.greaterThan(weightTolerance) || volumeVariance.greaterThan(volumeTolerance)) {
        exceptionId = randomUUID();
        await tx.weightException.create({ data: { createdBy: context.accountId, exceptionNo: `WEX-${Date.now()}-${exceptionId.slice(0, 6)}`, id: exceptionId, measurementId: measurement.id, packageId, tenantId: context.tenantId, updatedBy: context.accountId, varianceSnapshot: json({ theoreticalVolume: unit.theoreticalVolume.toString(), theoreticalWeight: unit.theoreticalWeight.toString(), volumeTolerancePct: volumeTolerance.toString(), volumeVariancePct: volumeVariance.toString(), weightTolerancePct: weightTolerance.toString(), weightVariancePct: weightVariance.toString() }) } });
        await tx.packTask.update({ data: { status: 'EXCEPTION', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: task.id } });
      }
      await this.emit(tx, packageId, measurement.version, exceptionId ? 'outbound.measurement-exception.v1' : 'outbound.measurement-recorded.v1', context, metadata, { exceptionId, measurementId: measurement.id, packageId });
      return { exceptionId, measurementId: measurement.id, replayed: false, status: exceptionId ? 'EXCEPTION' : 'ACCEPTED' };
    });
  }

  resolveWeightException(id: string, input: { expectedVersion: number; resolutionSnapshot: Readonly<Record<string, unknown>> }, context: TenantContext, metadata: CommandMetadata) {
    this.uuid(id, 'exceptionId');
    if (!Object.keys(input.resolutionSnapshot ?? {}).length) this.invalid('Resolution detail is required');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.weightException.findFirst({ where: { id, tenantId: context.tenantId } });
      if (!row || row.status !== 'OPEN' || row.version !== input.expectedVersion) throw this.conflict('WEIGHT_EXCEPTION_CONFLICT');
      const changed = await tx.weightException.update({ data: { resolutionSnapshot: json(input.resolutionSnapshot), resolvedAt: new Date(), status: 'RESOLVED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
      const unit = await tx.packageUnit.findUniqueOrThrow({ where: { id: row.packageId } });
      if (!(await tx.weightException.count({ where: { packageId: row.packageId, status: 'OPEN', tenantId: context.tenantId } })))
        await tx.packTask.update({ data: { status: 'PACKING', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: unit.packTaskId } });
      await this.emit(tx, row.packageId, changed.version, 'outbound.measurement-exception-resolved.v1', context, metadata, { exceptionId: id, packageId: row.packageId });
      return { status: changed.status, version: changed.version };
    });
  }

  sealPackage(packageId: string, input: { expectedVersion: number }, context: TenantContext, metadata: CommandMetadata) {
    this.uuid(packageId, 'packageId');
    return this.prisma.$transaction(async (tx) => {
      const unit = await tx.packageUnit.findFirst({ where: { id: packageId, tenantId: context.tenantId } });
      if (!unit || unit.status !== 'OPEN' || unit.version !== input.expectedVersion || !unit.actualWeight || !unit.actualVolume) throw this.conflict('PACKAGE_SEAL_CONFLICT');
      if (await tx.weightException.count({ where: { packageId, status: 'OPEN', tenantId: context.tenantId } })) throw new AppError('PACKAGE_WEIGHT_EXCEPTION_OPEN', 'Open measurement exception blocks sealing', 409);
      const changed = await tx.packageUnit.update({ data: { sealedAt: new Date(), status: 'SEALED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: packageId } });
      const open = await tx.packageUnit.count({ where: { packTaskId: unit.packTaskId, status: 'OPEN', tenantId: context.tenantId } });
      if (!open) {
        await tx.packTask.update({ data: { completedAt: new Date(), status: 'PACKED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: unit.packTaskId } });
        await tx.outboundOrder.update({ data: { status: 'PACKED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: unit.outboundOrderId } });
      }
      await this.emit(tx, packageId, changed.version, 'outbound.package-sealed.v1', context, metadata, { outboundId: unit.outboundOrderId, packageId });
      return { status: changed.status, version: changed.version };
    });
  }

  issueLabel(packageId: string, input: { contentRef: string; labelType: string; reason?: string; replaceLabelId?: string; templateVersion: string }, context: TenantContext, metadata: CommandMetadata) {
    this.uuid(packageId, 'packageId');
    if (!input.contentRef?.trim() || !input.labelType?.trim() || !input.templateVersion?.trim()) this.invalid('Label type, template version and content reference are required');
    if (input.replaceLabelId) this.uuid(input.replaceLabelId, 'replaceLabelId');
    return this.prisma.$transaction(async (tx) => {
      const unit = await tx.packageUnit.findFirst({ where: { id: packageId, status: { in: ['SEALED', 'LABELLED'] }, tenantId: context.tenantId } });
      if (!unit) throw this.conflict('PACKAGE_LABEL_STATE_CONFLICT');
      if (input.replaceLabelId && !input.reason?.trim()) this.invalid('Reprint reason is required');
      const previous = input.replaceLabelId ? await tx.shippingLabel.findFirst({ where: { id: input.replaceLabelId, packageId, tenantId: context.tenantId } }) : null;
      if (input.replaceLabelId && !previous) throw this.conflict('SHIPPING_LABEL_CONFLICT');
      const latest = await tx.shippingLabel.findFirst({ orderBy: { labelVersion: 'desc' }, where: { labelType: input.labelType.trim(), packageId, tenantId: context.tenantId } });
      const row = await tx.shippingLabel.create({ data: { action: previous ? 'REPRINT' : 'ISSUE', contentRef: input.contentRef.trim(), createdBy: context.accountId, labelType: input.labelType.trim(), labelVersion: (latest?.labelVersion ?? 0) + 1, packageId, reason: input.reason?.trim() ?? null, status: 'ACTIVE', supersedesId: previous?.id ?? null, templateVersion: input.templateVersion.trim(), tenantId: context.tenantId, updatedBy: context.accountId } });
      await tx.packageUnit.update({ data: { status: 'LABELLED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: packageId } });
      await this.emit(tx, packageId, row.labelVersion, previous ? 'outbound.label-reprinted.v1' : 'outbound.label-issued.v1', context, metadata, { labelId: row.id, labelVersion: row.labelVersion, packageId });
      return { labelId: row.id, labelVersion: row.labelVersion, status: row.status };
    });
  }

  voidLabel(id: string, input: { reason: string }, context: TenantContext, metadata: CommandMetadata) {
    this.uuid(id, 'labelId');
    if (!input.reason?.trim()) this.invalid('Void reason is required');
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.shippingLabel.findFirst({ where: { id, status: 'ACTIVE', tenantId: context.tenantId } });
      if (!previous) throw this.conflict('SHIPPING_LABEL_CONFLICT');
      const latest = await tx.shippingLabel.findFirst({ orderBy: { labelVersion: 'desc' }, where: { labelType: previous.labelType, packageId: previous.packageId, tenantId: context.tenantId } });
      const row = await tx.shippingLabel.create({ data: { action: 'VOID', contentRef: previous.contentRef, createdBy: context.accountId, labelType: previous.labelType, labelVersion: (latest?.labelVersion ?? 0) + 1, packageId: previous.packageId, reason: input.reason.trim(), status: 'VOID', supersedesId: previous.id, templateVersion: previous.templateVersion, tenantId: context.tenantId, updatedBy: context.accountId } });
      await this.emit(tx, previous.packageId, row.labelVersion, 'outbound.label-voided.v1', context, metadata, { labelId: row.id, packageId: previous.packageId, supersedesId: id });
      return { labelId: row.id, labelVersion: row.labelVersion, status: row.status };
    });
  }

  stagePackage(packageId: string, input: { loadSequence: number; maxVolume: string; routeCode: string; shipmentRef: string; stagingLocationId: string; tripRef: string }, context: TenantContext, metadata: CommandMetadata) {
    this.uuid(packageId, 'packageId');
    this.uuid(input.stagingLocationId, 'stagingLocationId');
    const maxVolume = this.positive(input.maxVolume);
    if (!input.routeCode?.trim() || !input.shipmentRef?.trim() || !input.tripRef?.trim() || !Number.isInteger(input.loadSequence) || input.loadSequence < 1) this.invalid('Route, shipment, trip and positive load sequence are required');
    return this.prisma.$transaction(async (tx) => {
      const unit = await tx.packageUnit.findFirst({ where: { id: packageId, status: 'LABELLED', tenantId: context.tenantId } });
      if (!unit || (unit.routeCode && unit.routeCode !== input.routeCode.trim())) throw new AppError('STAGING_ROUTE_MISMATCH', 'Package route does not match staging route', 409);
      const latestLabels = await tx.shippingLabel.findMany({ orderBy: { labelVersion: 'desc' }, where: { packageId, tenantId: context.tenantId } });
      if (!latestLabels.length || latestLabels[0]!.status !== 'ACTIVE') throw new AppError('STAGING_ACTIVE_LABEL_REQUIRED', 'An active latest label is required', 409);
      await tx.$queryRaw`
        SELECT 1::int AS locked
        FROM (
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`${context.tenantId}:${input.stagingLocationId}`}, 0)
          )
        ) AS capacity_lock
      `;
      const staged = await tx.stagingTask.findMany({ where: { stagingLocationId: input.stagingLocationId, status: 'STAGED', tenantId: context.tenantId } });
      const stagedPackages = await tx.packageUnit.findMany({ where: { id: { in: staged.map(({ packageId: id }) => id) }, tenantId: context.tenantId } });
      const usedVolume = stagedPackages.reduce((sum, row) => sum.add(row.actualVolume ?? 0), new Prisma.Decimal(0));
      if (usedVolume.add(unit.actualVolume ?? 0).greaterThan(maxVolume)) throw new AppError('STAGING_CAPACITY_EXCEEDED', 'Staging location volume capacity would be exceeded', 409);
      const taskId = randomUUID();
      const task = await tx.stagingTask.create({ data: { capacitySnapshot: json({ maxVolume: maxVolume.toString(), usedBefore: usedVolume.toString() }), createdBy: context.accountId, id: taskId, loadSequence: input.loadSequence, outboundOrderId: unit.outboundOrderId, packageId, routeCode: input.routeCode.trim(), shipmentRef: input.shipmentRef.trim(), stagedAt: new Date(), stagingLocationId: input.stagingLocationId, status: 'STAGED', taskNo: `STG-${Date.now()}-${taskId.slice(0, 6)}`, tenantId: context.tenantId, tripRef: input.tripRef.trim(), updatedBy: context.accountId } });
      await tx.packageUnit.update({ data: { status: 'STAGED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: packageId } });
      const remaining = await tx.packageUnit.count({ where: { outboundOrderId: unit.outboundOrderId, status: { not: 'STAGED' }, tenantId: context.tenantId } });
      if (!remaining) {
        const order = await tx.outboundOrder.update({ data: { status: 'STAGED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: unit.outboundOrderId } });
        const packages = await tx.packageUnit.findMany({ where: { outboundOrderId: unit.outboundOrderId, tenantId: context.tenantId } });
        await this.emit(tx, unit.outboundOrderId, order.version, 'outbound.ready.v1', context, metadata, { dock: input.stagingLocationId, outboundId: unit.outboundOrderId, outboundNo: order.outboundNo, packages: packages.map((row) => row.id), shipmentRef: input.shipmentRef.trim(), sourceRef: order.sourceRef, sourceVersion: order.sourceVersion, volume: packages.reduce((sum, row) => sum.add(row.actualVolume ?? 0), new Prisma.Decimal(0)).toString(), weight: packages.reduce((sum, row) => sum.add(row.actualWeight ?? 0), new Prisma.Decimal(0)).toString() });
      }
      return { stagingTaskId: task.id, status: task.status, version: task.version };
    });
  }

  createLoadTask(outboundId: string, input: { dockRef: string; maxVolume: string; maxWeight: string; sealNo: string; shipmentRef: string; vehicleRef: string }, context: TenantContext, metadata: CommandMetadata) {
    this.uuid(outboundId, 'outboundId');
    const maxWeight = this.positive(input.maxWeight);
    const maxVolume = this.positive(input.maxVolume);
    if (![input.dockRef, input.sealNo, input.shipmentRef, input.vehicleRef].every((value) => value?.trim())) this.invalid('Dock, vehicle, shipment and seal are required');
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.outboundOrder.findFirst({ where: { id: outboundId, status: 'STAGED', tenantId: context.tenantId } });
      if (!order) throw this.conflict('LOAD_ORDER_STATE_CONFLICT');
      const packages = await tx.packageUnit.findMany({ where: { outboundOrderId: outboundId, status: 'STAGED', tenantId: context.tenantId } });
      const staging = await tx.stagingTask.findMany({ where: { outboundOrderId: outboundId, status: 'STAGED', tenantId: context.tenantId } });
      if (!packages.length || staging.length !== packages.length || staging.some((row) => row.shipmentRef !== input.shipmentRef.trim())) throw new AppError('LOAD_EXPECTED_PACKAGE_MISMATCH', 'Every staged package must belong to the shipment', 409);
      const totalWeight = packages.reduce((sum, row) => sum.add(row.actualWeight ?? 0), new Prisma.Decimal(0));
      const totalVolume = packages.reduce((sum, row) => sum.add(row.actualVolume ?? 0), new Prisma.Decimal(0));
      if (totalWeight.greaterThan(maxWeight) || totalVolume.greaterThan(maxVolume)) throw new AppError('LOAD_VEHICLE_CAPACITY_EXCEEDED', 'Package weight or volume exceeds vehicle capacity', 409);
      const id = randomUUID();
      const task = await tx.loadTask.create({ data: { createdBy: context.accountId, dockRef: input.dockRef.trim(), expectedSnapshot: json({ maxVolume: maxVolume.toString(), maxWeight: maxWeight.toString(), packageIds: staging.sort((left, right) => left.loadSequence - right.loadSequence).map(({ packageId }) => packageId), totalVolume: totalVolume.toString(), totalWeight: totalWeight.toString() }), id, outboundOrderId: outboundId, sealNo: input.sealNo.trim(), shipmentRef: input.shipmentRef.trim(), taskNo: `LOD-${Date.now()}-${id.slice(0, 6)}`, temperatureZone: order.temperatureZone, tenantId: context.tenantId, updatedBy: context.accountId, vehicleRef: input.vehicleRef.trim() } });
      await this.emit(tx, outboundId, task.version, 'outbound.load-created.v1', context, metadata, { loadTaskId: task.id, outboundId, shipmentRef: task.shipmentRef });
      return { loadTaskId: task.id, status: task.status, version: task.version };
    });
  }

  confirmLoad(id: string, input: { deviceId: string; deviceSequence: string; dockRef: string; packageId: string; sealNo: string; vehicleRef: string }, context: TenantContext, metadata: CommandMetadata) {
    this.uuid(id, 'loadTaskId');
    this.uuid(input.packageId, 'packageId');
    const sequence = this.sequence(input.deviceSequence);
    if (!input.deviceId?.trim()) this.invalid('Device is required');
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.loadConfirmation.findUnique({ where: { tenantId_deviceId_deviceSequence: { deviceId: input.deviceId.trim(), deviceSequence: sequence, tenantId: context.tenantId } } });
      const fingerprint = { dockRef: input.dockRef, loadTaskId: id, packageId: input.packageId, sealNo: input.sealNo, vehicleRef: input.vehicleRef };
      if (existing) {
        if (canonical(record(existing.scanSnapshot)) !== canonical(fingerprint)) throw new AppError('LOAD_DEVICE_SEQUENCE_CONFLICT', 'Device sequence has different load content', 409);
        return { confirmationId: existing.id, replayed: true };
      }
      const task = await tx.loadTask.findFirst({ where: { id, status: { in: ['OPEN', 'LOADING'] }, tenantId: context.tenantId } });
      if (!task)
        throw new AppError(
          'LOAD_SCAN_MISMATCH',
          'Package, dock, vehicle, temperature or seal does not match load task',
          409,
        );
      const unit = await tx.packageUnit.findFirst({ where: { id: input.packageId, outboundOrderId: task.outboundOrderId, status: 'STAGED', tenantId: context.tenantId } });
      const expected = task ? record(task.expectedSnapshot) : {};
      if (!unit || !Array.isArray(expected.packageIds) || !expected.packageIds.includes(input.packageId) || task.dockRef !== input.dockRef || task.vehicleRef !== input.vehicleRef || task.sealNo !== input.sealNo || task.temperatureZone !== unit.temperatureZone)
        throw new AppError('LOAD_SCAN_MISMATCH', 'Package, dock, vehicle, temperature or seal does not match load task', 409);
      const confirmation = await tx.loadConfirmation.create({ data: { confirmedAt: new Date(), createdBy: context.accountId, deviceId: input.deviceId.trim(), deviceSequence: sequence, loadTaskId: id, packageId: input.packageId, scanSnapshot: json(fingerprint), tenantId: context.tenantId, updatedBy: context.accountId } });
      await tx.packageUnit.update({ data: { status: 'LOADED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: input.packageId } });
      const count = await tx.loadConfirmation.count({ where: { loadTaskId: id, tenantId: context.tenantId } });
      if (count === expected.packageIds.length) {
        await tx.loadTask.update({ data: { loadedAt: new Date(), status: 'LOADED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
        await tx.outboundOrder.update({ data: { status: 'LOADED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: task.outboundOrderId } });
      } else if (task.status === 'OPEN') await tx.loadTask.update({ data: { status: 'LOADING', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
      await this.emit(tx, task.outboundOrderId, task.version, 'outbound.package-loaded.v1', context, metadata, { confirmationId: confirmation.id, loadTaskId: id, packageId: input.packageId });
      return { confirmationId: confirmation.id, loaded: count === expected.packageIds.length, replayed: false };
    });
  }

  async ship(id: string, input: { actualAt: string; expectedVersion: number }, context: TenantContext, metadata: CommandMetadata) {
    this.uuid(id, 'loadTaskId');
    const actualAt = new Date(input.actualAt);
    if (Number.isNaN(actualAt.getTime())) this.invalid('Shipment time is invalid');
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.loadTask.findFirst({ where: { id, tenantId: context.tenantId } });
      if (!task) throw this.conflict('LOAD_TASK_CONFLICT');
      await tx.$queryRaw`
        SELECT 1::int AS locked
        FROM (
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`${context.tenantId}:${task.outboundOrderId}:ship`}, 0)
          )
        ) AS shipment_lock
      `;
      const existing = await tx.outboundDispatch.findUnique({ where: { tenantId_outboundOrderId: { outboundOrderId: task.outboundOrderId, tenantId: context.tenantId } } });
      if (existing) {
        if (existing.shipmentRef !== task.shipmentRef) throw new AppError('OUTBOUND_DISPATCH_CONFLICT', 'Outbound was shipped with a different shipment', 409);
        return { dispatchId: existing.id, replayed: true, status: 'SHIPPED' as const };
      }
      if (task.status !== 'LOADED' || task.version !== input.expectedVersion) throw this.conflict('LOAD_TASK_CONFLICT');
      const packages = await tx.packageUnit.findMany({ where: { outboundOrderId: task.outboundOrderId, status: 'LOADED', tenantId: context.tenantId } });
      const confirmations = await tx.loadConfirmation.count({ where: { loadTaskId: id, tenantId: context.tenantId } });
      if (!packages.length || confirmations !== packages.length) throw new AppError('SHIPMENT_LOAD_INCOMPLETE', 'Every expected package must be loaded', 409);
      const items = await tx.packageItem.findMany({ where: { packageId: { in: packages.map(({ id: packageId }) => packageId) }, tenantId: context.tenantId } });
      const allocations = await tx.outboundAllocation.findMany({ where: { outboundOrderId: task.outboundOrderId, tenantId: context.tenantId } });
      const inventorySnapshot = [];
      for (const allocation of allocations) {
        const shippedBase = items.filter(({ allocationId }) => allocationId === allocation.id).reduce((sum, row) => sum.add(row.quantityBase), new Prisma.Decimal(0));
        inventorySnapshot.push(await this.inventory.finalizeOutboundReservation(tx, allocation.reservationId, shippedBase.toString(), task.shipmentRef, context, metadata));
      }
      const dispatch = await tx.outboundDispatch.create({ data: { actualAt, createdBy: context.accountId, inventorySnapshot: json({ allocations: inventorySnapshot }), loadTaskId: id, outboundOrderId: task.outboundOrderId, packageSnapshot: json({ packages: packages.map((row) => ({ id: row.id, packageNo: row.packageNo, volume: row.actualVolume?.toString(), weight: row.actualWeight?.toString() })) }), shipmentRef: task.shipmentRef, tenantId: context.tenantId, updatedBy: context.accountId } });
      const changed = await tx.loadTask.update({ data: { shippedAt: actualAt, status: 'SHIPPED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
      await tx.packageUnit.updateMany({ data: { status: 'SHIPPED', updatedBy: context.accountId, version: { increment: 1 } }, where: { outboundOrderId: task.outboundOrderId, tenantId: context.tenantId } });
      await tx.outboundOrder.update({ data: { status: 'SHIPPED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: task.outboundOrderId } });
      await this.emit(tx, task.outboundOrderId, changed.version, 'outbound.shipped.v1', context, metadata, { actualAt, outboundId: task.outboundOrderId, packages: packages.map(({ id: packageId }) => packageId), shipmentId: task.shipmentRef });
      return { dispatchId: dispatch.id, replayed: false, status: changed.status };
    });
  }

  async cancelOutbound(outboundId: string, input: { reason: string; reasonCode: string }, context: TenantContext, metadata: CommandMetadata) {
    this.uuid(outboundId, 'outboundId');
    if (!input.reason?.trim() || !input.reasonCode?.trim()) this.invalid('Cancellation reason code and explanation are required');
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.outboundOrder.findFirst({ where: { id: outboundId, tenantId: context.tenantId } });
      if (!order) throw this.conflict('OUTBOUND_CANCELLATION_CONFLICT');
      const id = randomUUID();
      if (order.status === 'SHIPPED') {
        const plan = await tx.cancellationPlan.create({ data: { compensationSteps: json({ requiredFlow: ['RETURN', 'RECALL'], reversible: false }), createdBy: context.accountId, fromStatus: order.status, id, outboundOrderId: outboundId, planNo: `CAN-${Date.now()}-${id.slice(0, 6)}`, reason: input.reason.trim(), reasonCode: input.reasonCode.trim(), status: 'REJECTED', tenantId: context.tenantId, updatedBy: context.accountId } });
        return { planId: plan.id, rejected: true };
      }
      const allocations = await tx.outboundAllocation.findMany({ where: { outboundOrderId: outboundId, tenantId: context.tenantId } });
      for (const allocation of allocations) await this.inventory.cancelOutboundReservation(tx, allocation.reservationId, outboundId, context, metadata);
      const steps = { cancelLoadTasks: true, cancelPackAndPickTasks: true, releaseReservationIds: allocations.map(({ reservationId }) => reservationId), returnStagedPackages: order.status === 'STAGED' || order.status === 'LOADED' };
      const plan = await tx.cancellationPlan.create({ data: { compensationSteps: json(steps), completedAt: new Date(), createdBy: context.accountId, fromStatus: order.status, id, outboundOrderId: outboundId, planNo: `CAN-${Date.now()}-${id.slice(0, 6)}`, reason: input.reason.trim(), reasonCode: input.reasonCode.trim(), status: 'COMPLETED', tenantId: context.tenantId, updatedBy: context.accountId } });
      await Promise.all([
        tx.pickTask.updateMany({ data: { status: 'CANCELLED', updatedBy: context.accountId, version: { increment: 1 } }, where: { outboundOrderId: outboundId, status: { not: 'COMPLETED' }, tenantId: context.tenantId } }),
        tx.packTask.updateMany({ data: { status: 'CANCELLED', updatedBy: context.accountId, version: { increment: 1 } }, where: { outboundOrderId: outboundId, status: { not: 'PACKED' }, tenantId: context.tenantId } }),
        tx.stagingTask.updateMany({ data: { returnedAt: new Date(), status: 'RETURNED', updatedBy: context.accountId, version: { increment: 1 } }, where: { outboundOrderId: outboundId, status: 'STAGED', tenantId: context.tenantId } }),
        tx.loadTask.updateMany({ data: { status: 'CANCELLED', updatedBy: context.accountId, version: { increment: 1 } }, where: { outboundOrderId: outboundId, status: { not: 'SHIPPED' }, tenantId: context.tenantId } }),
        tx.packageUnit.updateMany({ data: { status: 'CANCELLED', updatedBy: context.accountId, version: { increment: 1 } }, where: { outboundOrderId: outboundId, tenantId: context.tenantId } }),
        tx.outboundOrder.update({ data: { status: 'CANCELLED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: outboundId } }),
      ]);
      await this.emit(tx, outboundId, plan.version, 'outbound.cancelled.v1', context, metadata, { cancellationPlanId: plan.id, outboundId, steps });
      return { planId: plan.id, rejected: false };
    });
    if (result.rejected) throw new AppError('OUTBOUND_SHIPPED_IRREVERSIBLE', `Shipped outbound requires return or recall (${result.planId})`, 409, { businessRef: result.planId });
    return { cancellationPlanId: result.planId, status: 'CANCELLED' as const };
  }

  private positive(value: unknown) {
    const number = this.nonNegative(value);
    if (!number.greaterThan(0)) this.invalid('Value must be a positive decimal');
    return number;
  }

  private nonNegative(value: unknown) {
    try {
      const number = new Prisma.Decimal(String(value));
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
    throw new AppError('PACK_SHIP_INPUT_INVALID', message, 400);
  }

  private conflict(code: string) {
    return new AppError(code, 'Resource version or state changed', 409, { retryable: true });
  }

  private async emit(tx: Prisma.TransactionClient, id: string, version: number, event: string, context: TenantContext, metadata: CommandMetadata, payload: Prisma.InputJsonObject) {
    await Promise.all([
      tx.platformAuditLog.create({ data: { action: event, after: payload, category: 'BUSINESS_CHANGE', correlationId: metadata.correlationId, createdBy: context.accountId, deviceId: context.deviceId, ipAddress: metadata.ipAddress ?? null, resourceId: id, resourceType: 'OutboundOrder', tenantId: context.tenantId, updatedBy: context.accountId } }),
      tx.platformOutbox.create({ data: { aggregateId: id, aggregateType: 'OutboundOrder', aggregateVersion: version, correlationId: metadata.correlationId, createdBy: context.accountId, eventName: event, partitionKey: id, payload: { ...payload, tenantId: context.tenantId }, tenantId: context.tenantId, updatedBy: context.accountId } }),
    ]);
  }
}

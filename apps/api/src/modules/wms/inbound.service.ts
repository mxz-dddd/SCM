import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type InboundAsnMode,
  type InboundSourceType,
  type ReceiptTaskStatus,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import type { CommandMetadata } from '../platform/tenant.service';

export interface CreateInboundInput {
  readonly asnMode?: InboundAsnMode;
  readonly expectedArrival?: string;
  readonly lines: readonly {
    readonly baseUom: string;
    readonly batchRequired?: boolean;
    readonly lineNo: number;
    readonly originalUom: string;
    readonly packageSpecId?: string;
    readonly productId: string;
    readonly quantityBase: string;
    readonly quantityOriginal: string;
    readonly serialRequired?: boolean;
    readonly sourceLineRef?: string;
  }[];
  readonly ownerId: string;
  readonly sourceRef: string;
  readonly sourceType: InboundSourceType;
  readonly sourceVersion: number;
  readonly supplierId?: string;
  readonly warehouseId: string;
}
export interface VersionInput {
  readonly expectedVersion: number;
}
export interface ParsePackagesInput extends VersionInput {
  readonly packages: readonly {
    readonly clientRef: string;
    readonly contents: readonly {
      readonly baseUom: string;
      readonly batchNo?: string;
      readonly inboundLineId: string;
      readonly originalUom: string;
      readonly quantityBase: string;
      readonly quantityOriginal: string;
    }[];
    readonly lpn: string;
    readonly packageSnapshot?: Readonly<Record<string, unknown>>;
    readonly packageType: 'CARTON' | 'PALLET';
    readonly parentRef?: string;
  }[];
}
export interface ProjectAppointmentInput {
  readonly appointmentId: string;
  readonly appointmentSnapshot: Readonly<Record<string, unknown>>;
  readonly dockId?: string;
  readonly expectedArrival?: string;
  readonly sourceVersion: number;
  readonly status: 'PENDING' | 'CONFIRMED' | 'RESCHEDULED' | 'CANCELLED';
  readonly vehicleSnapshot?: Readonly<Record<string, unknown>>;
}
export interface CheckInInput extends VersionInput {
  readonly appointmentId?: string;
  readonly approvalReference?: string;
  readonly gateId?: string;
  readonly occurredAt: string;
  readonly temporaryRegistration?: boolean;
  readonly vehicleSnapshot?: Readonly<Record<string, unknown>>;
}
export interface CreateReceiptTasksInput extends VersionInput {
  readonly tasks: readonly {
    readonly assignedTo?: string;
    readonly dockId?: string;
    readonly priority?: number;
    readonly teamId?: string;
    readonly workload: string;
    readonly workloadUom: string;
  }[];
}
export interface AssignTaskInput extends VersionInput {
  readonly assignedTo: string;
  readonly reason: string;
}
export interface TransitionTaskInput extends VersionInput {
  readonly reason?: string;
  readonly targetStatus: ReceiptTaskStatus;
}
export interface ScanBarcodeInput {
  readonly customerId?: string;
  readonly deviceId: string;
  readonly deviceSequence: number;
  readonly inboundOrderId?: string;
  readonly rawBarcode: string;
  readonly scannedAt: string;
}
export interface ManualResolveInput {
  readonly objectId: string;
  readonly objectType: 'ORDER' | 'PRODUCT' | 'PACKAGE' | 'LOCATION';
  readonly reason: string;
}

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
function quantity(value: string, field: string) {
  try {
    const result = new Prisma.Decimal(value);
    if (!result.isFinite() || !result.isPositive()) throw new Error();
    return result;
  } catch {
    throw new AppError(
      'INBOUND_QUANTITY_INVALID',
      `${field} must be a positive decimal`,
      400,
    );
  }
}
function instant(value: string | undefined, field: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()))
    throw new AppError('INBOUND_DATE_INVALID', `${field} is invalid`, 400);
  return date;
}
function uom(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_.-]{0,19}$/.test(normalized))
    throw new AppError(
      'INBOUND_UOM_INVALID',
      'Unit of measure is invalid',
      400,
    );
  return normalized;
}
function parseGs1(raw: string) {
  const normalized = raw.trim().replaceAll('\u001d', '');
  const snapshot: Record<string, string> = {};
  for (const [ai, key, length] of [
    ['01', 'gtin', 14],
    ['17', 'expiry', 6],
  ] as const) {
    const match = normalized.match(
      new RegExp(`(?:\\(${ai}\\)|^${ai})(\\d{${length}})`),
    );
    if (match?.[1]) snapshot[key] = match[1];
  }
  const batch = normalized.match(/(?:\(10\)|10)([A-Z0-9._-]{1,20})/i);
  if (batch?.[1]) snapshot.batch = batch[1];
  return { normalized: snapshot.gtin ?? normalized, snapshot };
}

@Injectable()
export class InboundService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MdmReferenceService) private readonly mdm: MdmReferenceService,
  ) {}

  async list(
    input: {
      page?: string;
      pageSize?: string;
      status?: string;
      warehouseId?: string;
      query?: string;
    },
    context: TenantContext,
  ) {
    const page = Math.max(Number.parseInt(input.page ?? '1', 10) || 1, 1),
      pageSize = Math.min(
        Math.max(Number.parseInt(input.pageSize ?? '50', 10) || 50, 1),
        200,
      ),
      query = input.query?.trim();
    const where: Prisma.InboundOrderWhereInput = {
      ...(input.status ? { status: input.status as never } : {}),
      ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}),
      ...(query
        ? {
            OR: [
              { inboundNo: { contains: query, mode: 'insensitive' } },
              { sourceRef: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
      tenantId: context.tenantId,
    };
    const [items, total] = await Promise.all([
      this.prisma.inboundOrder.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
      this.prisma.inboundOrder.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }
  async get(id: string, context: TenantContext) {
    const order = await this.order(id, context);
    const [
      lines,
      packages,
      contents,
      appointments,
      arrivals,
      tasks,
      assignments,
      scans,
    ] = await Promise.all([
      this.prisma.inboundLine.findMany({
        orderBy: { lineNo: 'asc' },
        where: { inboundOrderId: id, tenantId: context.tenantId },
      }),
      this.prisma.inboundPackage.findMany({
        orderBy: { createdAt: 'asc' },
        where: { inboundOrderId: id, tenantId: context.tenantId },
      }),
      this.prisma.inboundPackageContent.findMany({
        where: {
          inboundLineId: {
            in: (
              await this.prisma.inboundLine.findMany({
                select: { id: true },
                where: { inboundOrderId: id, tenantId: context.tenantId },
              })
            ).map((x) => x.id),
          },
          tenantId: context.tenantId,
        },
      }),
      this.prisma.appointmentOrderLink.findMany({
        where: { inboundOrderId: id, tenantId: context.tenantId },
      }),
      this.prisma.arrivalEvent.findMany({
        orderBy: { occurredAt: 'asc' },
        where: { inboundOrderId: id, tenantId: context.tenantId },
      }),
      this.prisma.receiptTask.findMany({
        where: { inboundOrderId: id, tenantId: context.tenantId },
      }),
      this.prisma.laborAssignment.findMany({
        where: {
          receiptTaskId: {
            in: (
              await this.prisma.receiptTask.findMany({
                select: { id: true },
                where: { inboundOrderId: id, tenantId: context.tenantId },
              })
            ).map((x) => x.id),
          },
          tenantId: context.tenantId,
        },
      }),
      this.prisma.scanEvent.findMany({
        where: { inboundOrderId: id, tenantId: context.tenantId },
      }),
    ]);
    return {
      ...order,
      appointments,
      arrivals,
      assignments,
      contents,
      lines,
      packages,
      scans,
      tasks,
    };
  }

  async create(
    input: CreateInboundInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.warehouseId, 'warehouseId');
    this.uuid(input.ownerId, 'ownerId');
    if (input.supplierId) this.uuid(input.supplierId, 'supplierId');
    if (
      !input.sourceRef?.trim() ||
      !Number.isInteger(input.sourceVersion) ||
      input.sourceVersion < 1 ||
      !input.lines.length ||
      new Set(input.lines.map((x) => x.lineNo)).size !== input.lines.length
    )
      throw new AppError(
        'INBOUND_INPUT_INVALID',
        'Source, version and unique lines are required',
        400,
      );
    const references = await this.mdm.resolveOrderReferences(
      {
        lines: input.lines.map(({ packageSpecId, productId }) => ({
          ...(packageSpecId ? { packageSpecId } : {}),
          productId,
        })),
      },
      context,
    );
    if (
      references.products.length !==
      new Set(input.lines.map((x) => x.productId)).size
    )
      throw new AppError(
        'INBOUND_PRODUCT_INVALID',
        'Active published product was not found',
        400,
      );
    const expectedArrival = instant(input.expectedArrival, 'expectedArrival');
    return this.prisma.$transaction(async (tx) => {
      const id = randomUUID();
      const row = await tx.inboundOrder.create({
        data: {
          asnMode: input.asnMode ?? 'NONE',
          createdBy: context.accountId,
          expectedArrival,
          id,
          inboundNo: `INB-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${id.slice(0, 8)}`,
          ownerId: input.ownerId,
          sourceRef: input.sourceRef.trim(),
          sourceType: input.sourceType,
          sourceVersion: input.sourceVersion,
          supplierId: input.supplierId ?? null,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          warehouseId: input.warehouseId,
        },
      });
      for (const line of input.lines) {
        const product = references.products.find(
          (x) => x.id === line.productId,
        )!;
        const specification = references.packageSpecs.find(
          (x) => x.id === line.packageSpecId,
        );
        const original = quantity(line.quantityOriginal, 'quantityOriginal'),
          base = quantity(line.quantityBase, 'quantityBase');
        if (specification) {
          if (
            specification.productId !== product.id ||
            !original.mul(specification.quantityInBase).equals(base)
          )
            throw new AppError(
              'INBOUND_PACKAGE_CONVERSION_INVALID',
              'Package conversion does not match base quantity',
              409,
            );
        } else if (
          uom(line.originalUom) !== uom(line.baseUom) ||
          !original.equals(base)
        )
          throw new AppError(
            'INBOUND_QUANTITY_CONVERSION_REQUIRED',
            'Package specification is required for unit conversion',
            400,
          );
        await tx.inboundLine.create({
          data: {
            baseUom: uom(line.baseUom),
            batchRequired: line.batchRequired ?? false,
            createdBy: context.accountId,
            id: randomUUID(),
            inboundOrderId: id,
            lineNo: line.lineNo,
            originalUom: uom(line.originalUom),
            packageSpecId: specification?.id ?? null,
            packageSpecSnapshot: json(specification),
            packageSpecVersion: specification?.versionNumber ?? null,
            productId: product.id,
            productSnapshot: json(product),
            quantityBase: base,
            quantityOriginal: original,
            serialRequired: line.serialRequired ?? false,
            sourceLineRef: line.sourceLineRef?.trim() ?? null,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      }
      await this.record(
        tx,
        id,
        'InboundOrder',
        row.version,
        'inbound.created.v1',
        context,
        metadata,
        {
          inboundId: id,
          inboundNo: row.inboundNo,
          sourceRef: row.sourceRef,
          warehouseId: row.warehouseId,
        },
      );
      return {
        inboundId: id,
        inboundNo: row.inboundNo,
        status: row.status,
        version: row.version,
      };
    });
  }

  async publish(
    id: string,
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.transitionOrder(
      id,
      input.expectedVersion,
      'EXPECTED',
      context,
      metadata,
    );
  }

  async parsePackages(
    id: string,
    input: ParsePackagesInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const order = await this.order(id, context);
    if (order.version !== input.expectedVersion) throw this.conflict();
    if (!['DRAFT', 'EXPECTED'].includes(order.status))
      throw new AppError(
        'INBOUND_PACKAGE_STATE_INVALID',
        'Packages cannot be parsed in this state',
        409,
      );
    if (order.asnMode === 'FULL' && !input.packages.length)
      throw new AppError(
        'INBOUND_FULL_ASN_PACKAGES_REQUIRED',
        'Full ASN requires packages',
        400,
      );
    const refs = new Set(input.packages.map((x) => x.clientRef));
    if (
      refs.size !== input.packages.length ||
      new Set(input.packages.map((x) => x.lpn.trim().toUpperCase())).size !==
        input.packages.length ||
      input.packages.some((x) => x.parentRef && !refs.has(x.parentRef))
    )
      throw new AppError(
        'INBOUND_PACKAGE_TREE_INVALID',
        'Package references, LPNs or parents are invalid',
        400,
      );
    for (const item of input.packages) {
      let cursor = item.parentRef,
        depth = 0;
      while (cursor) {
        if (cursor === item.clientRef || depth++ > 20)
          throw new AppError(
            'INBOUND_PACKAGE_CYCLE',
            'Package hierarchy contains a cycle',
            409,
          );
        cursor = input.packages.find((x) => x.clientRef === cursor)?.parentRef;
      }
    }
    const depth = (item: (typeof input.packages)[number]) => {
      let value = 0;
      let parent = item.parentRef;
      while (parent) {
        value++;
        parent = input.packages.find(
          ({ clientRef }) => clientRef === parent,
        )?.parentRef;
      }
      return value;
    };
    const orderedPackages = [...input.packages].sort(
      (left, right) => depth(left) - depth(right),
    );
    const lines = await this.prisma.inboundLine.findMany({
      where: {
        inboundOrderId: id,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    const totals = new Map<string, Prisma.Decimal>();
    for (const item of input.packages)
      for (const content of item.contents) {
        const line = lines.find((x) => x.id === content.inboundLineId);
        if (!line)
          throw new AppError(
            'INBOUND_PACKAGE_LINE_INVALID',
            'Package content line is invalid',
            400,
          );
        const base = quantity(content.quantityBase, 'quantityBase'),
          original = quantity(content.quantityOriginal, 'quantityOriginal');
        if (
          uom(content.baseUom) !== line.baseUom ||
          uom(content.originalUom) !== line.originalUom
        )
          throw new AppError(
            'INBOUND_PACKAGE_UOM_MISMATCH',
            'Package content UOM does not match line',
            409,
          );
        if (
          !original
            .mul(line.quantityBase)
            .equals(base.mul(line.quantityOriginal))
        )
          throw new AppError(
            'INBOUND_PACKAGE_CONVERSION_INVALID',
            'Package content original and base quantities are inconsistent',
            409,
          );
        totals.set(
          line.id,
          (totals.get(line.id) ?? new Prisma.Decimal(0)).add(base),
        );
        if (original.isNegative())
          throw new AppError(
            'INBOUND_QUANTITY_INVALID',
            'Package content quantity is invalid',
            400,
          );
      }
    for (const line of lines)
      if (
        (totals.get(line.id) ?? new Prisma.Decimal(0)).greaterThan(
          line.quantityBase,
        )
      )
        throw new AppError(
          'INBOUND_PACKAGE_OVERAGE',
          'Package quantity exceeds inbound line',
          409,
        );
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${id}:packages`}, 0))`;
      for (const line of lines) {
        const existing = await tx.inboundPackageContent.aggregate({
          _sum: { quantityBase: true },
          where: { inboundLineId: line.id, tenantId: context.tenantId },
        });
        const combined = (
          existing._sum.quantityBase ?? new Prisma.Decimal(0)
        ).add(totals.get(line.id) ?? new Prisma.Decimal(0));
        if (combined.greaterThan(line.quantityBase))
          throw new AppError(
            'INBOUND_PACKAGE_OVERAGE',
            'Cumulative package quantity exceeds inbound line',
            409,
          );
        if (order.asnMode === 'FULL' && !combined.equals(line.quantityBase))
          throw new AppError(
            'INBOUND_PACKAGE_QUANTITY_NOT_CONSERVED',
            'Full ASN package quantity must equal every inbound line',
            409,
          );
      }
      const ids = new Map<string, string>();
      for (const item of orderedPackages) {
        const packageId = randomUUID();
        ids.set(item.clientRef, packageId);
        await tx.inboundPackage.create({
          data: {
            createdBy: context.accountId,
            id: packageId,
            inboundOrderId: id,
            lpn: item.lpn.trim().toUpperCase(),
            packageSnapshot: json(item.packageSnapshot),
            packageType: item.packageType,
            parentPackageId: item.parentRef
              ? (ids.get(item.parentRef) ?? null)
              : null,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        for (const content of item.contents)
          await tx.inboundPackageContent.create({
            data: {
              baseUom: uom(content.baseUom),
              batchNo: content.batchNo?.trim() || null,
              createdBy: context.accountId,
              id: randomUUID(),
              inboundLineId: content.inboundLineId,
              inboundPackageId: packageId,
              originalUom: uom(content.originalUom),
              quantityBase: quantity(content.quantityBase, 'quantityBase'),
              quantityOriginal: quantity(
                content.quantityOriginal,
                'quantityOriginal',
              ),
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
      }
      const changed = await tx.inboundOrder.update({
        data: { updatedBy: context.accountId, version: { increment: 1 } },
        where: { id },
      });
      await this.record(
        tx,
        id,
        'InboundOrder',
        changed.version,
        'inbound.packages-parsed.v1',
        context,
        metadata,
        { inboundId: id, packageCount: input.packages.length },
      );
      return {
        packageCount: input.packages.length,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async projectAppointment(
    id: string,
    input: ProjectAppointmentInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.appointmentId, 'appointmentId');
    if (!Number.isInteger(input.sourceVersion) || input.sourceVersion < 1)
      throw new AppError(
        'INBOUND_APPOINTMENT_VERSION_INVALID',
        'Appointment source version must be a positive integer',
        400,
      );
    const order = await this.order(id, context);
    if (['COMPLETED', 'CANCELLED'].includes(order.status))
      throw new AppError(
        'INBOUND_APPOINTMENT_STATE_INVALID',
        'Terminal inbound cannot change appointment',
        409,
      );
    const expectedArrival = instant(input.expectedArrival, 'expectedArrival');
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.appointmentOrderLink.findUnique({
        where: {
          tenantId_inboundOrderId_appointmentId: {
            appointmentId: input.appointmentId,
            inboundOrderId: id,
            tenantId: context.tenantId,
          },
        },
      });
      if (existing && existing.sourceVersion >= input.sourceVersion)
        return {
          applied: false,
          sourceVersion: existing.sourceVersion,
          status: existing.status,
          version: existing.version,
        };
      const data = {
        appointmentSnapshot: json(input.appointmentSnapshot),
        dockId: input.dockId ?? null,
        expectedArrival,
        sourceVersion: input.sourceVersion,
        status: input.status,
        updatedBy: context.accountId,
        vehicleSnapshot: json(input.vehicleSnapshot),
      };
      const link = existing
        ? await tx.appointmentOrderLink.update({
            data: { ...data, version: { increment: 1 } },
            where: { id: existing.id },
          })
        : await tx.appointmentOrderLink.create({
            data: {
              ...data,
              appointmentId: input.appointmentId,
              createdBy: context.accountId,
              id: randomUUID(),
              inboundOrderId: id,
              tenantId: context.tenantId,
            },
          });
      await tx.inboundOrder.update({
        data: {
          appointmentSnapshot: json(input.appointmentSnapshot),
          expectedArrival: expectedArrival ?? order.expectedArrival,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        link.id,
        'AppointmentOrderLink',
        link.version,
        'inbound.appointment-projected.v1',
        context,
        metadata,
        {
          appointmentId: input.appointmentId,
          inboundId: id,
          status: link.status,
        },
      );
      return {
        applied: true,
        linkId: link.id,
        sourceVersion: link.sourceVersion,
        status: link.status,
        version: link.version,
      };
    });
  }

  async checkIn(
    id: string,
    input: CheckInInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const order = await this.order(id, context);
    if (order.version !== input.expectedVersion) throw this.conflict();
    if (order.status !== 'EXPECTED')
      throw new AppError(
        'INBOUND_ARRIVAL_STATE_INVALID',
        'Inbound is not expected for arrival',
        409,
      );
    const temporary = input.temporaryRegistration ?? false;
    if (temporary && !input.approvalReference?.trim())
      throw new AppError(
        'INBOUND_TEMPORARY_APPROVAL_REQUIRED',
        'Temporary arrival requires approval reference',
        403,
      );
    if (!temporary) {
      if (!input.appointmentId)
        throw new AppError(
          'INBOUND_APPOINTMENT_REQUIRED',
          'Confirmed appointment is required',
          400,
        );
      const link = await this.prisma.appointmentOrderLink.findFirst({
        where: {
          appointmentId: input.appointmentId,
          inboundOrderId: id,
          status: { in: ['CONFIRMED', 'RESCHEDULED'] },
          tenantId: context.tenantId,
        },
      });
      if (!link)
        throw new AppError(
          'INBOUND_APPOINTMENT_NOT_CONFIRMED',
          'Confirmed appointment was not found',
          409,
        );
    }
    const occurredAt = instant(input.occurredAt, 'occurredAt')!;
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.arrivalEvent.create({
        data: {
          appointmentId: input.appointmentId ?? null,
          approvalReference: input.approvalReference?.trim() ?? null,
          createdBy: context.accountId,
          eventType: 'CHECK_IN',
          gateId: input.gateId ?? null,
          id: randomUUID(),
          inboundOrderId: id,
          occurredAt,
          temporaryRegistration: temporary,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          vehicleSnapshot: json(input.vehicleSnapshot),
        },
      });
      const changed = await tx.inboundOrder.update({
        data: {
          arrivalSnapshot: json({
            arrivalEventId: event.id,
            occurredAt,
            temporary,
          }),
          status: 'ARRIVED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        'InboundOrder',
        changed.version,
        'inbound.arrived.v1',
        context,
        metadata,
        {
          arrivalEventId: event.id,
          inboundId: id,
          temporaryRegistration: temporary,
        },
      );
      return {
        arrivalEventId: event.id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async createTasks(
    id: string,
    input: CreateReceiptTasksInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const order = await this.order(id, context);
    if (order.version !== input.expectedVersion) throw this.conflict();
    if (!['ARRIVED', 'RECEIVING'].includes(order.status) || !input.tasks.length)
      throw new AppError(
        'RECEIPT_TASK_STATE_INVALID',
        'Arrived inbound and tasks are required',
        409,
      );
    return this.prisma.$transaction(async (tx) => {
      const taskIds: string[] = [];
      for (const [index, item] of input.tasks.entries()) {
        if (item.assignedTo) this.uuid(item.assignedTo, 'assignedTo');
        const taskId = randomUUID();
        const task = await tx.receiptTask.create({
          data: {
            assignedTo: item.assignedTo ?? null,
            claimedAt: item.assignedTo ? new Date() : null,
            createdBy: context.accountId,
            dockId: item.dockId ?? null,
            id: taskId,
            inboundOrderId: id,
            priority: item.priority ?? 50,
            status: item.assignedTo ? 'ASSIGNED' : 'OPEN',
            taskNo: `RCT-${order.inboundNo}-${index + 1}-${taskId.slice(0, 4)}`,
            teamId: item.teamId ?? null,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            workload: quantity(item.workload, 'workload'),
            workloadUom: uom(item.workloadUom),
          },
        });
        if (item.assignedTo)
          await tx.laborAssignment.create({
            data: {
              createdBy: context.accountId,
              mode: 'AUTO',
              reason: 'AUTO_ASSIGN',
              receiptTaskId: task.id,
              tenantId: context.tenantId,
              toAssignee: item.assignedTo,
              updatedBy: context.accountId,
            },
          });
        taskIds.push(task.id);
      }
      const changed = await tx.inboundOrder.update({
        data: {
          status: 'RECEIVING',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        'InboundOrder',
        changed.version,
        'inbound.receiving-started.v1',
        context,
        metadata,
        { inboundId: id, taskIds },
      );
      return { status: changed.status, taskIds, version: changed.version };
    });
  }

  async assignTask(
    id: string,
    input: AssignTaskInput,
    context: TenantContext,
    metadata: CommandMetadata,
    mode: 'AUTO' | 'CLAIM' | 'TRANSFER' = 'AUTO',
  ) {
    this.uuid(id, 'taskId');
    this.uuid(input.assignedTo, 'assignedTo');
    if (!input.reason?.trim())
      throw new AppError(
        'RECEIPT_ASSIGN_REASON_REQUIRED',
        'Assignment reason is required',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.receiptTask.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!task)
        throw new AppError(
          'RECEIPT_TASK_NOT_FOUND',
          'Receipt task was not found',
          404,
        );
      if (task.version !== input.expectedVersion) throw this.conflict();
      const allowed =
        mode === 'TRANSFER'
          ? ['ASSIGNED', 'IN_PROGRESS', 'PAUSED'].includes(task.status)
          : task.status === 'OPEN';
      if (!allowed)
        throw new AppError(
          'RECEIPT_ASSIGN_STATE_INVALID',
          'Receipt task cannot be assigned',
          409,
        );
      const result = await tx.receiptTask.updateMany({
        data: {
          assignedTo: input.assignedTo,
          claimedAt: new Date(),
          status: 'ASSIGNED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          id,
          status:
            mode === 'TRANSFER'
              ? { in: ['ASSIGNED', 'IN_PROGRESS', 'PAUSED'] }
              : 'OPEN',
          version: input.expectedVersion,
        },
      });
      if (result.count !== 1) throw this.conflict();
      const changed = await tx.receiptTask.findUniqueOrThrow({ where: { id } });
      await tx.laborAssignment.create({
        data: {
          createdBy: context.accountId,
          fromAssignee: task.assignedTo,
          mode,
          reason: input.reason.trim(),
          receiptTaskId: id,
          tenantId: context.tenantId,
          toAssignee: input.assignedTo,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        id,
        'ReceiptTask',
        changed.version,
        'receipt.task-assigned.v1',
        context,
        metadata,
        {
          assignedTo: input.assignedTo,
          inboundId: task.inboundOrderId,
          mode,
          taskId: id,
        },
      );
      return {
        assignedTo: changed.assignedTo,
        status: changed.status,
        version: changed.version,
      };
    });
  }
  claimTask(
    id: string,
    input: AssignTaskInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.assignTask(id, input, context, metadata, 'CLAIM');
  }
  transferTask(
    id: string,
    input: AssignTaskInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.assignTask(id, input, context, metadata, 'TRANSFER');
  }

  async transitionTask(
    id: string,
    input: TransitionTaskInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'taskId');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.receiptTask.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!row)
        throw new AppError(
          'RECEIPT_TASK_NOT_FOUND',
          'Receipt task was not found',
          404,
        );
      if (row.version !== input.expectedVersion) throw this.conflict();
      const allowed =
        (row.status === 'ASSIGNED' && input.targetStatus === 'IN_PROGRESS') ||
        (row.status === 'IN_PROGRESS' &&
          ['PAUSED', 'COMPLETED'].includes(input.targetStatus)) ||
        (row.status === 'PAUSED' && input.targetStatus === 'IN_PROGRESS') ||
        (['OPEN', 'ASSIGNED', 'PAUSED'].includes(row.status) &&
          input.targetStatus === 'CANCELLED');
      if (!allowed)
        throw new AppError(
          'RECEIPT_TASK_TRANSITION_INVALID',
          `Task transition ${row.status} -> ${input.targetStatus} is not allowed`,
          409,
        );
      if (input.targetStatus === 'PAUSED' && !input.reason?.trim())
        throw new AppError(
          'RECEIPT_PAUSE_REASON_REQUIRED',
          'Pause requires reason',
          400,
        );
      const changed = await tx.receiptTask.update({
        data: {
          completedAt:
            input.targetStatus === 'COMPLETED' ? new Date() : row.completedAt,
          pausedReason:
            input.targetStatus === 'PAUSED'
              ? input.reason!.trim()
              : input.targetStatus === 'IN_PROGRESS'
                ? null
                : row.pausedReason,
          status: input.targetStatus,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        'ReceiptTask',
        changed.version,
        'receipt.task-transitioned.v1',
        context,
        metadata,
        {
          from: row.status,
          inboundId: row.inboundOrderId,
          taskId: id,
          to: changed.status,
        },
      );
      return { status: changed.status, version: changed.version };
    });
  }

  async complete(
    id: string,
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const order = await this.order(id, context);
    if (order.version !== input.expectedVersion) throw this.conflict();
    if (order.status !== 'RECEIVING')
      throw new AppError(
        'INBOUND_COMPLETE_PRECONDITION_FAILED',
        'Inbound must be receiving',
        409,
      );
    const [openReceiptTasks, inboundLines, receiptLines, pendingVariances] =
      await Promise.all([
        this.prisma.receiptTask.count({
          where: {
            inboundOrderId: id,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
            tenantId: context.tenantId,
          },
        }),
        this.prisma.inboundLine.findMany({
          select: { id: true },
          where: {
            inboundOrderId: id,
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        }),
        this.prisma.receiptLine.findMany({
          where: {
            inboundOrderId: id,
            status: 'CONFIRMED',
            tenantId: context.tenantId,
          },
        }),
        this.prisma.receivingVariance.count({
          where: {
            inboundOrderId: id,
            status: 'PENDING',
            tenantId: context.tenantId,
          },
        }),
      ]);
    if (
      openReceiptTasks ||
      pendingVariances ||
      new Set(receiptLines.map(({ inboundLineId }) => inboundLineId)).size !==
        inboundLines.length
    )
      throw new AppError(
        'INBOUND_COMPLETE_PRECONDITION_FAILED',
        'Receipt tasks, lines and variances must be terminal',
        409,
      );
    const [
      inspections,
      dispositions,
      openPutawayTasks,
      activeUnits,
      openCrossDocks,
    ] = await Promise.all([
      this.prisma.qualityInspection.findMany({
        where: { inboundOrderId: id, tenantId: context.tenantId },
      }),
      this.prisma.qualityDisposition.findMany({
        where: { inboundOrderId: id, tenantId: context.tenantId },
      }),
      this.prisma.putawayTask.count({
        where: {
          inboundOrderId: id,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          tenantId: context.tenantId,
        },
      }),
      this.prisma.handlingUnit.count({
        where: {
          inboundOrderId: id,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      }),
      this.prisma.crossDockAllocation.count({
        where: {
          inboundOrderId: id,
          status: { in: ['PROPOSED', 'RESERVED'] },
          tenantId: context.tenantId,
        },
      }),
    ]);
    const qualityIncomplete = receiptLines.some((receipt) => {
      const related = inspections.filter(
        ({ receiptLineId }) => receiptLineId === receipt.id,
      );
      return (
        !related.length ||
        related.some(
          (inspection) =>
            ['PENDING', 'INSPECTING'].includes(inspection.status) ||
            (['REJECTED', 'HOLD'].includes(inspection.status) &&
              !dispositions.some(
                ({ inspectionId }) => inspectionId === inspection.id,
              )),
        )
      );
    });
    if (qualityIncomplete || openPutawayTasks || activeUnits || openCrossDocks)
      throw new AppError(
        'INBOUND_COMPLETE_PRECONDITION_FAILED',
        'Quality, putaway or cross-dock work is incomplete',
        409,
      );
    const routedReceiptIds = new Set<string>();
    const completedCrossDocks = await this.prisma.crossDockAllocation.findMany({
      select: { id: true, receiptLineId: true },
      where: {
        inboundOrderId: id,
        status: 'COMPLETED',
        tenantId: context.tenantId,
      },
    });
    completedCrossDocks.forEach(({ receiptLineId }) =>
      routedReceiptIds.add(receiptLineId),
    );
    const completedMovements = await this.prisma.putawayMovement.findMany({
      select: { handlingUnitId: true, id: true },
      where: { inboundOrderId: id, tenantId: context.tenantId },
    });
    const movedUnitIds = completedMovements.map(
      ({ handlingUnitId }) => handlingUnitId,
    );
    if (movedUnitIds.length) {
      const contents = await this.prisma.handlingUnitContent.findMany({
        where: {
          handlingUnitId: { in: movedUnitIds },
          tenantId: context.tenantId,
        },
      });
      contents.forEach(({ receiptLineId }) =>
        routedReceiptIds.add(receiptLineId),
      );
    }
    if (
      receiptLines.some(
        (receipt) =>
          receipt.acceptedQuantityBase
            .add(receipt.pendingQuantityBase)
            .isPositive() && !routedReceiptIds.has(receipt.id),
      )
    )
      throw new AppError(
        'INBOUND_COMPLETE_PRECONDITION_FAILED',
        'Every accepted receipt must be put away or cross-docked',
        409,
      );
    const totals = receiptLines.reduce(
      (sum, receipt) => ({
        accepted: sum.accepted.add(receipt.acceptedQuantityBase),
        pending: sum.pending.add(receipt.pendingQuantityBase),
        received: sum.received.add(receipt.receivedQuantityBase),
        rejected: sum.rejected.add(receipt.rejectedQuantityBase),
      }),
      {
        accepted: new Prisma.Decimal(0),
        pending: new Prisma.Decimal(0),
        received: new Prisma.Decimal(0),
        rejected: new Prisma.Decimal(0),
      },
    );
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.inboundOrder.updateMany({
        data: {
          completedAt: new Date(),
          status: 'COMPLETED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          id,
          status: 'RECEIVING',
          tenantId: context.tenantId,
          version: input.expectedVersion,
        },
      });
      if (changed.count !== 1) throw this.conflict();
      const payload = {
        accepted: totals.accepted.toString(),
        inboundId: id,
        inventoryRefs: [
          ...completedMovements.map(({ id: movementId }) => ({ movementId })),
          ...completedCrossDocks.map(({ id: crossDockAllocationId }) => ({
            crossDockAllocationId,
          })),
        ],
        pending: totals.pending.toString(),
        received: totals.received.toString(),
        rejected: totals.rejected.toString(),
      };
      await this.record(
        tx,
        id,
        'InboundOrder',
        order.version + 1,
        'inbound.completed.v1',
        context,
        metadata,
        payload,
      );
      return { ...payload, status: 'COMPLETED', version: order.version + 1 };
    });
  }

  async scan(
    input: ScanBarcodeInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      !input.rawBarcode?.trim() ||
      !input.deviceId?.trim() ||
      !Number.isInteger(input.deviceSequence) ||
      input.deviceSequence < 1
    )
      throw new AppError(
        'SCAN_INPUT_INVALID',
        'Barcode, device and sequence are required',
        400,
      );
    if (input.inboundOrderId) await this.order(input.inboundOrderId, context);
    const parsed = parseGs1(input.rawBarcode);
    const [order, pack, product] = await Promise.all([
      this.prisma.inboundOrder.findFirst({
        where: { inboundNo: parsed.normalized, tenantId: context.tenantId },
      }),
      this.prisma.inboundPackage.findFirst({
        where: {
          lpn: parsed.normalized.toUpperCase(),
          tenantId: context.tenantId,
        },
      }),
      this.mdm.resolveBarcode(parsed.normalized, input.customerId, context),
    ]);
    const resolution = order
      ? {
          id: order.id,
          snapshot: { inboundNo: order.inboundNo },
          type: 'ORDER' as const,
        }
      : pack
        ? { id: pack.id, snapshot: { lpn: pack.lpn }, type: 'PACKAGE' as const }
        : product
          ? {
              id: product.product.id,
              snapshot: product,
              type: 'PRODUCT' as const,
            }
          : null;
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.scanEvent.create({
        data: {
          createdBy: context.accountId,
          customerId: input.customerId ?? null,
          deviceId: input.deviceId.trim(),
          deviceSequence: input.deviceSequence,
          gs1Snapshot: json(parsed.snapshot),
          id: randomUUID(),
          inboundOrderId: input.inboundOrderId ?? null,
          normalizedBarcode: parsed.normalized,
          rawBarcode: input.rawBarcode,
          resolvedAt: resolution ? new Date() : null,
          resolvedBy: resolution ? context.accountId : null,
          resolvedObjectId: resolution?.id ?? null,
          resolvedObjectType: resolution?.type ?? null,
          scannedAt: instant(input.scannedAt, 'scannedAt')!,
          status: resolution ? 'RESOLVED' : 'UNRESOLVED',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      if (resolution)
        await tx.barcodeResolution.create({
          data: {
            createdBy: context.accountId,
            objectId: resolution.id,
            objectType: resolution.type,
            reason: 'AUTOMATIC_RESOLUTION',
            resolutionSnapshot: json(resolution.snapshot),
            resolutionStatus: 'RESOLVED',
            resolvedBy: context.accountId,
            scanEventId: event.id,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      await this.record(
        tx,
        event.id,
        'ScanEvent',
        event.version,
        'wms.barcode-scanned.v1',
        context,
        metadata,
        {
          objectId: resolution?.id ?? null,
          objectType: resolution?.type ?? null,
          scanEventId: event.id,
          status: event.status,
        },
      );
      return {
        objectId: resolution?.id ?? null,
        objectType: resolution?.type ?? null,
        scanEventId: event.id,
        status: event.status,
      };
    });
  }

  async manualResolve(
    scanId: string,
    input: ManualResolveInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(scanId, 'scanId');
    this.uuid(input.objectId, 'objectId');
    if (!input.reason?.trim())
      throw new AppError(
        'SCAN_RESOLUTION_REASON_REQUIRED',
        'Manual resolution reason is required',
        400,
      );
    const publicObjectExists =
      input.objectType === 'PRODUCT' || input.objectType === 'LOCATION'
        ? await this.mdm.scanObjectExists(
            input.objectType,
            input.objectId,
            context,
          )
        : null;
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.scanEvent.findFirst({
        where: { id: scanId, status: 'UNRESOLVED', tenantId: context.tenantId },
      });
      if (!event)
        throw new AppError(
          'SCAN_NOT_UNRESOLVED',
          'Unresolved scan event was not found',
          404,
        );
      const exists =
        input.objectType === 'ORDER'
          ? await tx.inboundOrder.count({
              where: { id: input.objectId, tenantId: context.tenantId },
            })
          : input.objectType === 'PACKAGE'
            ? await tx.inboundPackage.count({
                where: { id: input.objectId, tenantId: context.tenantId },
              })
            : publicObjectExists
              ? 1
              : 0;
      if (!exists)
        throw new AppError(
          'SCAN_RESOLUTION_OBJECT_NOT_FOUND',
          'Resolution object was not found',
          404,
        );
      const resolution = await tx.barcodeResolution.create({
        data: {
          createdBy: context.accountId,
          objectId: input.objectId,
          objectType: input.objectType,
          reason: input.reason.trim(),
          resolutionSnapshot: json({ rawBarcode: event.rawBarcode }),
          resolutionStatus: 'MANUAL',
          resolvedBy: context.accountId,
          scanEventId: event.id,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        event.id,
        'ScanEvent',
        event.version,
        'wms.barcode-manually-resolved.v1',
        context,
        metadata,
        {
          objectId: input.objectId,
          objectType: input.objectType,
          resolutionId: resolution.id,
          scanEventId: event.id,
        },
      );
      return {
        objectId: resolution.objectId,
        objectType: resolution.objectType,
        resolutionId: resolution.id,
        status: resolution.resolutionStatus,
      };
    });
  }

  private async transitionOrder(
    id: string,
    expectedVersion: number,
    target: 'EXPECTED' | 'COMPLETED',
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.inboundOrder.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!row)
        throw new AppError(
          'INBOUND_NOT_FOUND',
          'Inbound order was not found',
          404,
        );
      if (row.version !== expectedVersion) throw this.conflict();
      const allowed =
        (row.status === 'DRAFT' && target === 'EXPECTED') ||
        (row.status === 'RECEIVING' && target === 'COMPLETED');
      if (!allowed)
        throw new AppError(
          'INBOUND_TRANSITION_INVALID',
          `Inbound transition ${row.status} -> ${target} is not allowed`,
          409,
        );
      const changed = await tx.inboundOrder.update({
        data: {
          completedAt: target === 'COMPLETED' ? new Date() : null,
          status: target,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        'InboundOrder',
        changed.version,
        target === 'EXPECTED' ? 'inbound.expected.v1' : 'inbound.completed.v1',
        context,
        metadata,
        { inboundId: id, status: target },
      );
      return { status: changed.status, version: changed.version };
    });
  }
  private async order(id: string, context: TenantContext) {
    this.uuid(id, 'inboundId');
    const row = await this.prisma.inboundOrder.findFirst({
      where: { id, tenantId: context.tenantId },
    });
    if (!row)
      throw new AppError(
        'INBOUND_NOT_FOUND',
        'Inbound order was not found',
        404,
      );
    return row;
  }
  private uuid(value: string, field: string) {
    if (!isUuid(value))
      throw new AppError('WMS_INPUT_INVALID', `${field} is invalid`, 400);
  }
  private conflict() {
    return new AppError(
      'WMS_VERSION_CONFLICT',
      'Resource changed; refresh and retry',
      409,
      { retryable: true },
    );
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

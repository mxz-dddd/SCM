import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type OrderChannel,
  type OrderStatus,
  type OrderType,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError, type AppFieldError } from '../../common/app-error';
import { isPrismaErrorCode } from '../../common/prisma-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import { hashIdempotencyRequest } from '../platform/idempotency.service';
import type { CommandMetadata } from '../platform/tenant.service';

export interface SaveOrderLineInput {
  readonly lineNo: number;
  readonly packageSpecId?: string;
  readonly priority?: number;
  readonly productId?: string;
  readonly quantity?: string;
  readonly rawData?: Readonly<Record<string, unknown>>;
  readonly requestedFrom?: string;
  readonly requestedUntil?: string;
  readonly uom?: string;
}

export interface SaveOrderInput {
  readonly channel: OrderChannel;
  readonly currency?: string;
  readonly customerId?: string;
  readonly deliveryAddressId?: string;
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly expedited?: boolean;
  readonly externalOrderNo?: string;
  readonly externalVersion?: string;
  readonly fileObjectId?: string;
  readonly lines?: readonly SaveOrderLineInput[];
  readonly mappingVersion: string;
  readonly rawPayload?: Readonly<Record<string, unknown>>;
  readonly requestedFrom?: string;
  readonly requestedUntil?: string;
  readonly requiredExtensionFields?: readonly string[];
  readonly type: OrderType;
  readonly totalAmount?: string;
  readonly vip?: boolean;
}

export interface UpdateOrderInput extends SaveOrderInput {
  readonly expectedVersion: number;
}

export interface SubmitOrderInput {
  readonly expectedVersion: number;
}

export interface ListOrdersInput {
  readonly channel?: OrderChannel;
  readonly page?: string;
  readonly pageSize?: string;
  readonly query?: string;
  readonly status?: OrderStatus;
}

interface ResolvedLine {
  readonly baseQuantity: Prisma.Decimal | null;
  readonly baseUom: string | null;
  readonly packageSnapshot: Prisma.InputJsonObject;
  readonly packageVersion: number | null;
  readonly productSnapshot: Prisma.InputJsonObject;
}

const ORDER_TYPES: readonly OrderType[] = ['SALES', 'PURCHASE', 'TRANSFER', 'RETURN'];
const CHANNELS: readonly OrderChannel[] = ['API', 'EDI', 'FILE', 'PORTAL', 'MANUAL'];
const UOM = /^[A-Z][A-Z0-9_.-]{0,19}$/;

export function assertOrderSubmissionTransition(
  current: OrderStatus,
  target: 'INVALID' | 'OPEN',
): void {
  const allowed =
    (current === 'DRAFT' && (target === 'INVALID' || target === 'OPEN')) ||
    (current === 'INVALID' && target === 'OPEN');
  if (!allowed)
    throw new AppError(
      'ORDER_TRANSITION_INVALID',
      `Order transition ${current} -> ${target} is not allowed`,
      409,
    );
}

function text(value: string | undefined, field: string, max: number): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > max)
    throw new AppError('ORDER_INPUT_INVALID', `${field} is required`, 400);
  return normalized;
}

function optionalText(value: string | undefined, max: number): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (normalized.length > max)
    throw new AppError('ORDER_INPUT_INVALID', 'Order input is too long', 400);
  return normalized;
}

function optionalDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function optionalDecimal(value: string | undefined): Prisma.Decimal | null {
  if (!value) return null;
  try {
    const parsed = new Prisma.Decimal(value);
    return parsed.isFinite() && parsed.isPositive() ? parsed : null;
  } catch {
    return null;
  }
}

function optionalMoney(value: string | undefined): Prisma.Decimal | null {
  if (value === undefined) return null;
  try {
    const parsed = new Prisma.Decimal(value);
    return parsed.isFinite() && !parsed.isNegative() ? parsed : null;
  } catch {
    return null;
  }
}

function jsonObject(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonObject;
}

function jsonArray(value: unknown): Prisma.InputJsonArray {
  return JSON.parse(JSON.stringify(value ?? [])) as Prisma.InputJsonArray;
}

@Injectable()
export class OrderIntakeService {
  constructor(
    @Inject(MdmReferenceService) private readonly mdm: MdmReferenceService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async list(input: ListOrdersInput, context: TenantContext) {
    const page = Math.max(1, Number.parseInt(input.page ?? '1', 10) || 1);
    const pageSize = Math.min(
      300,
      Math.max(1, Number.parseInt(input.pageSize ?? '50', 10) || 50),
    );
    const query = input.query?.trim();
    const where: Prisma.BusinessOrderWhereInput = {
      ...(input.channel && CHANNELS.includes(input.channel)
        ? { channel: input.channel }
        : {}),
      ...(query
        ? {
            OR: [
              { orderNo: { contains: query, mode: 'insensitive' } },
              { externalOrderNo: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(input.status ? { status: input.status } : {}),
      tenantId: context.tenantId,
    };
    const [items, total] = await Promise.all([
      this.prisma.businessOrder.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
      this.prisma.businessOrder.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }

  async get(orderId: string, context: TenantContext) {
    this.uuid(orderId);
    const order = await this.prisma.businessOrder.findFirst({
      where: { id: orderId, tenantId: context.tenantId },
    });
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order was not found', 404);
    const [lines, versions, changeSets, duplicateCases, rawMessages, reviews, holds, priorityDecisions, mergeMemberships, splitRelations, allocations, sourcingDecisions] = await Promise.all([
      this.prisma.businessOrderLine.findMany({
        orderBy: { lineNo: 'asc' },
        where: { orderId, status: 'ACTIVE', tenantId: context.tenantId },
      }),
      this.prisma.orderVersion.findMany({
        orderBy: { versionNumber: 'desc' },
        where: { businessOrderId: orderId, tenantId: context.tenantId },
      }),
      this.prisma.changeSet.findMany({
        orderBy: { toVersion: 'desc' },
        where: { businessOrderId: orderId, tenantId: context.tenantId },
      }),
      this.prisma.duplicateCase.findMany({
        orderBy: { createdAt: 'desc' },
        where: { businessOrderId: orderId, tenantId: context.tenantId },
      }),
      this.prisma.rawMessageRef.findMany({
        orderBy: { createdAt: 'desc' },
        where: {
          id: {
            in: await this.rawMessageIds(orderId, context),
          },
          tenantId: context.tenantId,
        },
      }),
      this.prisma.orderReview.findMany({
        orderBy: { createdAt: 'desc' },
        where: { businessOrderId: orderId, tenantId: context.tenantId },
      }),
      this.prisma.orderHold.findMany({
        orderBy: { createdAt: 'desc' },
        where: { businessOrderId: orderId, tenantId: context.tenantId },
      }),
      this.prisma.priorityDecision.findMany({
        orderBy: { createdAt: 'desc' },
        where: { businessOrderId: orderId, tenantId: context.tenantId },
      }),
      this.prisma.orderMergeMember.findMany({
        orderBy: { createdAt: 'desc' },
        where: { businessOrderId: orderId, tenantId: context.tenantId },
      }),
      this.prisma.orderSplitRelation.findMany({
        orderBy: { createdAt: 'desc' },
        where: { sourceOrderId: orderId, tenantId: context.tenantId },
      }),
      this.prisma.orderAllocation.findMany({ orderBy: { createdAt: 'desc' }, where: { businessOrderId: orderId, tenantId: context.tenantId } }),
      this.prisma.sourcingDecision.findMany({ orderBy: { createdAt: 'desc' }, where: { businessOrderId: orderId, tenantId: context.tenantId } }),
    ]);
    return { ...order, allocations, changeSets, duplicateCases, holds, lines, mergeMemberships, priorityDecisions, rawMessages, reviews, sourcingDecisions, splitRelations, versions };
  }

  async create(
    input: SaveOrderInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.basic(input);
    const externalOrderNo = optionalText(input.externalOrderNo, 200);
    const externalVersion = optionalText(input.externalVersion, 100) ?? '1';
    const sourcePayload = jsonObject(input.rawPayload ?? input);
    const sourcePayloadHash = hashIdempotencyRequest(sourcePayload);
    const outcome = await this.prisma.$transaction(async (transaction) => {
      const existing = externalOrderNo
        ? await transaction.businessOrder.findUnique({
            where: {
              tenantId_channel_externalOrderNo_externalVersion: {
                channel: input.channel,
                externalOrderNo,
                externalVersion,
                tenantId: context.tenantId,
              },
            },
          })
        : null;
      if (existing) {
        if (existing.sourcePayloadHash === sourcePayloadHash)
          return {
            kind: 'success' as const,
            result: {
              accepted: existing.status === 'OPEN',
              orderId: existing.id,
              orderNo: existing.orderNo,
              replayed: true,
              status: existing.status,
              version: existing.version,
            },
          };
        const duplicate = await transaction.duplicateCase.create({
          data: {
            businessOrderId: existing.id,
            channel: input.channel,
            createdBy: context.accountId,
            existingContentHash: existing.sourcePayloadHash,
            externalOrderNo: externalOrderNo!,
            externalVersion,
            id: randomUUID(),
            incomingContentHash: sourcePayloadHash,
            incomingPayload: sourcePayload,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await this.record(
          transaction,
          existing,
          'order.duplicate-detected.v1',
          context,
          metadata,
          { duplicateCaseId: duplicate.id },
        );
        return {
          businessRef: existing.orderNo,
          duplicateCaseId: duplicate.id,
          kind: 'conflict' as const,
        };
      }

      const raw = await transaction.rawMessageRef.create({
        data: {
          channel: input.channel,
          contentHash: sourcePayloadHash,
          createdBy: context.accountId,
          externalOrderNo,
          externalVersion,
          fileObjectId: input.fileObjectId ?? null,
          id: randomUUID(),
          mappingVersion: text(input.mappingVersion, 'mappingVersion', 100),
          rawPayload: sourcePayload,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const order = await transaction.businessOrder.create({
        data: {
          channel: input.channel,
          createdBy: context.accountId,
          currency: input.currency?.trim().toUpperCase() ?? null,
          customerId: input.customerId ?? null,
          deliveryAddressId: input.deliveryAddressId ?? null,
          extensions: jsonObject(input.extensions),
          expedited: input.expedited ?? false,
          externalOrderNo,
          externalVersion,
          id: randomUUID(),
          mappingVersion: text(input.mappingVersion, 'mappingVersion', 100),
          orderNo: `ORD-${randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`,
          rawMessageRefId: raw.id,
          requestedFrom: optionalDate(input.requestedFrom),
          requestedUntil: optionalDate(input.requestedUntil),
          requiredExtensionFields: jsonArray(input.requiredExtensionFields),
          sourcePayloadHash,
          tenantId: context.tenantId,
          totalAmount: optionalMoney(input.totalAmount),
          type: input.type,
          updatedBy: context.accountId,
          vip: input.vip ?? false,
        },
      });
      const lines = await this.createLines(transaction, order.id, 1, input.lines ?? [], context);
      await transaction.orderVersion.create({
        data: {
          businessOrderId: order.id,
          changeReason: 'ORDER_INTAKE_CREATED',
          createdBy: context.accountId,
          id: randomUUID(),
          snapshot: jsonObject({ order, lines }),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          versionNumber: 1,
        },
      });
      await this.record(transaction, order, 'order.created.v1', context, metadata, {
        channel: order.channel,
        customer: order.customerId,
        lines: lines.map(({ id, lineNo, productId, quantityOriginal }) => ({
          id,
          lineNo,
          productId,
          quantity: quantityOriginal?.toString() ?? null,
        })),
        requestedWindow: {
          from: order.requestedFrom?.toISOString() ?? null,
          until: order.requestedUntil?.toISOString() ?? null,
        },
      });
      return {
        kind: 'success' as const,
        result: {
          accepted: false,
          orderId: order.id,
          orderNo: order.orderNo,
          replayed: false,
          status: order.status,
          version: order.version,
        },
      };
    });
    if (outcome.kind === 'conflict')
      throw new AppError(
        'ORDER_EXTERNAL_CONTENT_CONFLICT',
        `External order content conflicts with the existing order; duplicate case ${outcome.duplicateCaseId} was created`,
        409,
        { businessRef: outcome.businessRef },
      );
    return outcome.result;
  }

  async update(
    orderId: string,
    input: UpdateOrderInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(orderId);
    this.basic(input);
    return this.prisma
      .$transaction(async (transaction) => {
        const before = await transaction.businessOrder.findFirst({
          where: { id: orderId, tenantId: context.tenantId },
        });
        if (!before) throw new AppError('ORDER_NOT_FOUND', 'Order was not found', 404);
        this.mutable(before.status);
        this.expected(before.version, input.expectedVersion);
        const externalOrderNo = optionalText(input.externalOrderNo, 200);
        const externalVersion = optionalText(input.externalVersion, 100) ?? '1';
        const sourcePayload = jsonObject(input.rawPayload ?? input);
        const sourcePayloadHash = hashIdempotencyRequest(sourcePayload);
        const raw = await transaction.rawMessageRef.create({
          data: {
            channel: input.channel,
            contentHash: sourcePayloadHash,
            createdBy: context.accountId,
            externalOrderNo,
            externalVersion,
            fileObjectId: input.fileObjectId ?? null,
            id: randomUUID(),
            mappingVersion: text(input.mappingVersion, 'mappingVersion', 100),
            rawPayload: sourcePayload,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await transaction.businessOrderLine.updateMany({
          data: {
            status: 'INACTIVE',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { orderId, status: 'ACTIVE', tenantId: context.tenantId },
        });
        const changed = await transaction.businessOrder.update({
          data: {
            channel: input.channel,
            currency: input.currency?.trim().toUpperCase() ?? null,
            customerId: input.customerId ?? null,
            customerSnapshot: {},
            deliveryAddressId: input.deliveryAddressId ?? null,
            deliveryAddressSnapshot: {},
            extensions: jsonObject(input.extensions),
            expedited: input.expedited ?? false,
            externalOrderNo,
            externalVersion,
            mappingVersion: text(input.mappingVersion, 'mappingVersion', 100),
            rawMessageRefId: raw.id,
            requestedFrom: optionalDate(input.requestedFrom),
            requestedUntil: optionalDate(input.requestedUntil),
            requiredExtensionFields: jsonArray(input.requiredExtensionFields),
            sourcePayloadHash,
            totalAmount: optionalMoney(input.totalAmount),
            type: input.type,
            updatedBy: context.accountId,
            validationErrors: [],
            version: { increment: 1 },
            warningOverrides: [],
            vip: input.vip ?? false,
          },
          where: { id: orderId },
        });
        const lines = await this.createLines(
          transaction,
          orderId,
          changed.version,
          input.lines ?? [],
          context,
        );
        await Promise.all([
          transaction.orderVersion.create({
            data: {
              businessOrderId: orderId,
              changeReason: 'ORDER_DRAFT_REPLACED',
              createdBy: context.accountId,
              id: randomUUID(),
              snapshot: jsonObject({ order: changed, lines }),
              tenantId: context.tenantId,
              updatedBy: context.accountId,
              versionNumber: changed.version,
            },
          }),
          transaction.changeSet.create({
            data: {
              businessOrderId: orderId,
              changes: jsonObject({ after: input, before }),
              createdBy: context.accountId,
              fromVersion: before.version,
              id: randomUUID(),
              source: input.channel,
              tenantId: context.tenantId,
              toVersion: changed.version,
              updatedBy: context.accountId,
            },
          }),
        ]);
        await this.record(transaction, changed, 'order.changed.v1', context, metadata, {
          status: changed.status,
        });
        return {
          accepted: false,
          orderId,
          orderNo: changed.orderNo,
          status: changed.status,
          version: changed.version,
        };
      })
      .catch((error: unknown) => {
        if (isPrismaErrorCode(error, 'P2002'))
          throw new AppError(
            'ORDER_EXTERNAL_CONTENT_CONFLICT',
            'External order number and version are already in use',
            409,
          );
        throw error;
      });
  }

  async submit(
    orderId: string,
    input: SubmitOrderInput,
    overrideWarnings: boolean,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(orderId);
    const order = await this.prisma.businessOrder.findFirst({
      where: { id: orderId, tenantId: context.tenantId },
    });
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order was not found', 404);
    this.mutable(order.status);
    this.expected(order.version, input.expectedVersion);
    const lines = await this.prisma.businessOrderLine.findMany({
      orderBy: { lineNo: 'asc' },
      where: { orderId, status: 'ACTIVE', tenantId: context.tenantId },
    });
    const references = await this.mdm.resolveOrderReferences(
      {
        ...(order.deliveryAddressId ? { addressId: order.deliveryAddressId } : {}),
        ...(order.customerId ? { customerId: order.customerId } : {}),
        lines: lines.map(({ packageSpecId, productId }) => ({
          ...(packageSpecId ? { packageSpecId } : {}),
          ...(productId ? { productId } : {}),
        })),
      },
      context,
    );
    const validation = this.validate(order, lines, references);
    const blocked = validation.errors.length > 0 ||
      (validation.warnings.length > 0 && !overrideWarnings);
    const target: 'INVALID' | 'OPEN' = blocked ? 'INVALID' : 'OPEN';
    if (target !== order.status) assertOrderSubmissionTransition(order.status, target);

    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.businessOrder.findFirst({
        where: { id: orderId, tenantId: context.tenantId },
      });
      if (!current) throw new AppError('ORDER_NOT_FOUND', 'Order was not found', 404);
      this.expected(current.version, input.expectedVersion);
      const changed = await transaction.businessOrder.update({
        data: {
          customerSnapshot: jsonObject(references.customer),
          deliveryAddressSnapshot: jsonObject(references.address),
          status: target,
          updatedBy: context.accountId,
          validationErrors: jsonArray(validation.errors),
          version: { increment: 1 },
          warningOverrides: jsonArray(overrideWarnings ? validation.warnings : []),
        },
        where: { id: orderId },
      });
      for (const [index, line] of lines.entries()) {
        const resolved = validation.lines[index];
        if (!resolved) continue;
        await transaction.businessOrderLine.update({
          data: {
            baseUom: resolved.baseUom,
            packageSpecSnapshot: resolved.packageSnapshot,
            packageSpecVersion: resolved.packageVersion,
            productSnapshot: resolved.productSnapshot,
            quantityBase: resolved.baseQuantity,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: line.id },
        });
      }
      const snapshotLines = await transaction.businessOrderLine.findMany({
        orderBy: { lineNo: 'asc' },
        where: { orderId, status: 'ACTIVE', tenantId: context.tenantId },
      });
      await Promise.all([
        transaction.orderVersion.create({
          data: {
            businessOrderId: orderId,
            changeReason: target === 'OPEN' ? 'ORDER_SUBMITTED' : 'ORDER_VALIDATION_FAILED',
            createdBy: context.accountId,
            id: randomUUID(),
            snapshot: jsonObject({ order: changed, lines: snapshotLines }),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            versionNumber: changed.version,
          },
        }),
        transaction.changeSet.create({
          data: {
            businessOrderId: orderId,
            changes: jsonObject({
              fieldErrors: validation.errors,
              status: { from: order.status, to: target },
              warnings: validation.warnings,
            }),
            createdBy: context.accountId,
            fromVersion: order.version,
            id: randomUUID(),
            source: order.channel,
            tenantId: context.tenantId,
            toVersion: changed.version,
            updatedBy: context.accountId,
          },
        }),
      ]);
      await this.record(
        transaction,
        changed,
        target === 'OPEN' ? 'order.opened.v1' : 'order.validation-failed.v1',
        context,
        metadata,
        { status: target },
      );
      return {
        accepted: target === 'OPEN',
        fieldErrors: validation.errors,
        orderId,
        orderNo: changed.orderNo,
        status: changed.status,
        version: changed.version,
        warnings: validation.warnings,
      };
    });
  }

  private validate(
    order: {
      readonly customerId: string | null;
      readonly deliveryAddressId: string | null;
      readonly extensions: Prisma.JsonValue;
      readonly externalOrderNo: string | null;
      readonly requestedFrom: Date | null;
      readonly requestedUntil: Date | null;
      readonly requiredExtensionFields: Prisma.JsonValue;
    },
    lines: readonly {
      readonly originalUom: string | null;
      readonly packageSpecId: string | null;
      readonly productId: string | null;
      readonly quantityOriginal: Prisma.Decimal | null;
    }[],
    references: Awaited<ReturnType<MdmReferenceService['resolveOrderReferences']>>,
  ) {
    const errors: AppFieldError[] = [];
    const warnings: AppFieldError[] = [];
    if (!order.externalOrderNo)
      errors.push({ field: 'externalOrderNo', message: 'External order number is required' });
    if (!order.customerId)
      errors.push({ field: 'customerId', message: 'Customer is required' });
    else if (!references.customer)
      errors.push({ field: 'customerId', message: 'Active customer was not found' });
    if (!order.deliveryAddressId)
      errors.push({ field: 'deliveryAddressId', message: 'Delivery address is required' });
    else if (!references.address || references.address.partnerId !== order.customerId)
      errors.push({
        field: 'deliveryAddressId',
        message: 'Active delivery address for this customer was not found',
      });
    else if (references.address.geocodeStatus !== 'VERIFIED')
      warnings.push({
        field: 'deliveryAddressId',
        message: 'Delivery address geocode has not been verified',
      });
    if (!order.requestedFrom)
      errors.push({ field: 'requestedFrom', message: 'Requested window start is required' });
    if (!order.requestedUntil)
      errors.push({ field: 'requestedUntil', message: 'Requested window end is required' });
    if (
      order.requestedFrom &&
      order.requestedUntil &&
      order.requestedUntil <= order.requestedFrom
    )
      errors.push({ field: 'requestedUntil', message: 'Requested window is invalid' });
    if (!lines.length) errors.push({ field: 'lines', message: 'At least one order line is required' });
    const extensions = order.extensions as Record<string, unknown>;
    const requiredFields = Array.isArray(order.requiredExtensionFields)
      ? order.requiredExtensionFields
      : [];
    for (const field of requiredFields) {
      if (typeof field === 'string' && extensions[field] === undefined)
        errors.push({
          field: `extensions.${field}`,
          message: `Required extension field ${field} is missing`,
        });
    }

    const resolvedLines: ResolvedLine[] = lines.map((line, index) => {
      const path = `lines[${index}]`;
      const product = references.products.find(({ id }) => id === line.productId);
      if (!line.productId)
        errors.push({ field: `${path}.productId`, message: 'Product is required' });
      else if (!product)
        errors.push({ field: `${path}.productId`, message: 'Active published product was not found' });
      if (!line.quantityOriginal)
        errors.push({ field: `${path}.quantity`, message: 'Positive decimal quantity is required' });
      if (!line.originalUom || !UOM.test(line.originalUom))
        errors.push({ field: `${path}.uom`, message: 'Valid unit of measure is required' });
      if (product?.hazardous && extensions.allowHazardous !== true)
        errors.push({
          field: `${path}.productId`,
          message: 'Hazardous product is blocked by the order shipping policy',
        });
      const specification = references.packageSpecs.find(
        ({ id }) => id === line.packageSpecId,
      );
      let baseQuantity: Prisma.Decimal | null = null;
      let baseUom: string | null = product?.baseUom ?? null;
      if (product && line.quantityOriginal && line.originalUom === product.baseUom) {
        baseQuantity = line.quantityOriginal;
      } else if (product && line.quantityOriginal && line.originalUom) {
        if (
          !specification ||
          specification.productId !== product.id ||
          specification.originalUom !== line.originalUom
        )
          errors.push({
            field: `${path}.packageSpecId`,
            message: 'Published package specification for this product and unit is required',
          });
        else {
          baseQuantity = line.quantityOriginal.mul(specification.quantityInBase);
          baseUom = specification.baseUom;
        }
      }
      return {
        baseQuantity,
        baseUom,
        packageSnapshot: jsonObject(specification),
        packageVersion: specification?.versionNumber ?? null,
        productSnapshot: jsonObject(product),
      };
    });
    return { errors, lines: resolvedLines, warnings };
  }

  private async createLines(
    transaction: Prisma.TransactionClient,
    orderId: string,
    lineVersion: number,
    inputs: readonly SaveOrderLineInput[],
    context: TenantContext,
  ) {
    const lineNumbers = new Set<number>();
    for (const line of inputs) {
      if (!Number.isInteger(line.lineNo) || line.lineNo <= 0 || lineNumbers.has(line.lineNo))
        throw new AppError(
          'ORDER_LINE_NUMBER_INVALID',
          'Order line numbers must be unique positive integers',
          400,
        );
      lineNumbers.add(line.lineNo);
    }
    const rows = [];
    for (const input of inputs) {
      rows.push(
        await transaction.businessOrderLine.create({
          data: {
            createdBy: context.accountId,
            id: randomUUID(),
            lineNo: input.lineNo,
            lineVersion,
            orderId,
            originalUom: input.uom?.trim().toUpperCase() ?? null,
            packageSpecId: input.packageSpecId ?? null,
            priority: input.priority ?? 50,
            productId: input.productId ?? null,
            quantityOriginal: optionalDecimal(input.quantity),
            rawData: jsonObject(input.rawData ?? input),
            requestedFrom: optionalDate(input.requestedFrom),
            requestedUntil: optionalDate(input.requestedUntil),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        }),
      );
    }
    return rows;
  }

  private basic(input: SaveOrderInput): void {
    if (!ORDER_TYPES.includes(input.type) || !CHANNELS.includes(input.channel))
      throw new AppError('ORDER_INPUT_INVALID', 'Order type or channel is invalid', 400);
    text(input.mappingVersion, 'mappingVersion', 100);
    const amount = optionalMoney(input.totalAmount);
    const currency = input.currency?.trim().toUpperCase();
    if (
      (input.totalAmount === undefined) !== (currency === undefined) ||
      (input.totalAmount !== undefined && amount === null) ||
      (currency !== undefined && !/^[A-Z]{3}$/.test(currency))
    )
      throw new AppError(
        'ORDER_MONEY_INVALID',
        'totalAmount and ISO currency must be provided together',
        400,
      );
    if (input.customerId && !isUuid(input.customerId))
      throw new AppError('ORDER_INPUT_INVALID', 'customerId is invalid', 400);
    if (input.deliveryAddressId && !isUuid(input.deliveryAddressId))
      throw new AppError('ORDER_INPUT_INVALID', 'deliveryAddressId is invalid', 400);
    if (input.fileObjectId && !isUuid(input.fileObjectId))
      throw new AppError('ORDER_INPUT_INVALID', 'fileObjectId is invalid', 400);
    for (const [index, line] of (input.lines ?? []).entries()) {
      if (line.productId && !isUuid(line.productId))
        throw new AppError('ORDER_INPUT_INVALID', `lines[${index}].productId is invalid`, 400);
      if (line.packageSpecId && !isUuid(line.packageSpecId))
        throw new AppError('ORDER_INPUT_INVALID', `lines[${index}].packageSpecId is invalid`, 400);
      if (
        line.priority !== undefined &&
        (!Number.isInteger(line.priority) || line.priority < 1 || line.priority > 100)
      )
        throw new AppError('ORDER_INPUT_INVALID', `lines[${index}].priority is invalid`, 400);
    }
  }

  private mutable(status: OrderStatus): void {
    if (!['DRAFT', 'INVALID'].includes(status))
      throw new AppError(
        'ORDER_NOT_MUTABLE',
        'Only draft or invalid orders can be changed or submitted',
        409,
      );
  }

  private expected(actual: number, expected: number): void {
    if (!Number.isInteger(expected) || actual !== expected)
      throw new AppError(
        'ORDER_VERSION_CONFLICT',
        'Order changed; refresh and retry with the latest version',
        409,
        { retryable: true },
      );
  }

  private uuid(id: string): void {
    if (!isUuid(id)) throw new AppError('ORDER_NOT_FOUND', 'Order was not found', 404);
  }

  private async rawMessageIds(orderId: string, context: TenantContext) {
    const versions = await this.prisma.orderVersion.findMany({
      select: { snapshot: true },
      where: { businessOrderId: orderId, tenantId: context.tenantId },
    });
    const ids = versions.flatMap(({ snapshot }) => {
      const value = snapshot as { order?: { rawMessageRefId?: unknown } };
      return typeof value.order?.rawMessageRefId === 'string'
        ? [value.order.rawMessageRefId]
        : [];
    });
    return [...new Set(ids)];
  }

  private async record(
    transaction: Prisma.TransactionClient,
    order: { readonly id: string; readonly orderNo: string; readonly version: number },
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    after: Prisma.InputJsonObject,
  ) {
    await Promise.all([
      transaction.platformAuditLog.create({
        data: {
          action: eventName,
          after,
          businessRef: order.orderNo,
          category: 'BUSINESS_CHANGE',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: order.id,
          resourceType: 'BusinessOrder',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      transaction.platformOutbox.create({
        data: {
          aggregateId: order.id,
          aggregateType: 'BusinessOrder',
          aggregateVersion: order.version,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName,
          partitionKey: order.id,
          payload: { orderId: order.id, orderNo: order.orderNo, ...after },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }
}

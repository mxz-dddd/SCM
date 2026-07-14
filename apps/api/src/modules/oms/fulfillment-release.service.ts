import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type FulfillmentStatus, type FulfillmentType, type ShipmentMode } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { CalendarReleaseFacade } from '../mdm/public/calendar-release.facade';
import type { CommandMetadata } from '../platform/tenant.service';

export interface ShipmentLegInput { readonly fromAddressId?: string; readonly fromAddressSnapshot?: Readonly<Record<string, unknown>>; readonly toAddressId?: string; readonly toAddressSnapshot?: Readonly<Record<string, unknown>>; readonly windowFrom?: string; readonly windowUntil?: string }
export interface ReleaseOrderInput { readonly calendarCode: string; readonly directShip?: boolean; readonly expectedVersion: number; readonly legs?: readonly ShipmentLegInput[]; readonly mode?: ShipmentMode; readonly originWarehouseId?: string; readonly serviceLevel?: string; readonly serviceType?: string; readonly temperatureMax?: string; readonly temperatureMin?: string; readonly volume?: string; readonly volumeUom?: string; readonly weight?: string; readonly weightUom?: string }
export interface ReleaseBatchInput { readonly calendarCode: string; readonly members: readonly { readonly expectedVersion: number; readonly orderId: string }[]; readonly mode?: 'AUTOMATIC' | 'BATCH'; readonly serviceLevel?: string; readonly serviceType?: string }
export interface AutoReleaseInput { readonly calendarCode: string; readonly limit?: number; readonly serviceLevel?: string; readonly serviceType?: string }
export interface FulfillmentProgressInput { readonly externalReference?: string; readonly progress?: Readonly<Record<string, unknown>>; readonly sourceVersion: number; readonly targetStatus: FulfillmentStatus }

const json = (value: unknown) => JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
function decimal(value: string | undefined, field: string) { if (value === undefined) return null; try { const result = new Prisma.Decimal(value); if (!result.isFinite() || result.isNegative()) throw new Error(); return result; } catch { throw new AppError('SHIPMENT_MEASUREMENT_INVALID', `${field} must be a non-negative decimal`, 400); } }
function date(value: string | undefined, field: string) { if (!value) return null; const result = new Date(value); if (Number.isNaN(result.valueOf())) throw new AppError('SHIPMENT_WINDOW_INVALID', `${field} is invalid`, 400); return result; }

export function assertFulfillmentTransition(current: FulfillmentStatus, target: FulfillmentStatus) {
  const allowed = (current === 'DRAFT' && target === 'RELEASED') || (current === 'RELEASED' && ['ACCEPTED', 'FAILED', 'CANCELLED'].includes(target)) || (current === 'ACCEPTED' && ['EXECUTING', 'FAILED', 'CANCELLED'].includes(target)) || (current === 'EXECUTING' && ['COMPLETED', 'FAILED'].includes(target));
  if (!allowed) throw new AppError('FULFILLMENT_TRANSITION_INVALID', `Fulfillment transition ${current} -> ${target} is not allowed`, 409);
}

@Injectable()
export class FulfillmentReleaseService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(CalendarReleaseFacade) private readonly calendars: CalendarReleaseFacade) {}

  async release(orderId: string, input: ReleaseOrderInput, context: TenantContext, metadata: CommandMetadata, releaseBatchId?: string) {
    this.uuid(orderId, 'ORDER_NOT_FOUND'); this.validateRelease(input);
    const order = await this.prisma.businessOrder.findFirst({ where: { id: orderId, tenantId: context.tenantId } });
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order was not found', 404);
    if (order.version !== input.expectedVersion) throw new AppError('ORDER_VERSION_CONFLICT', 'Order changed; refresh and retry', 409, { retryable: true });
    const direct = input.directShip === true;
    if (!((order.status === 'ALLOCATED' && !direct) || (order.status === 'APPROVED' && direct))) throw new AppError('ORDER_RELEASE_STATE_INVALID', 'Release requires an allocated order or an approved direct-ship order', 409);
    if (await this.prisma.orderHold.count({ where: { businessOrderId: orderId, status: 'ACTIVE', tenantId: context.tenantId } })) throw new AppError('ORDER_RELEASE_HELD', 'Held orders cannot be released', 409);
    const lines = await this.prisma.businessOrderLine.findMany({ orderBy: { lineNo: 'asc' }, where: { orderId, status: 'ACTIVE', tenantId: context.tenantId } });
    if (!lines.length) throw new AppError('ORDER_RELEASE_LINES_REQUIRED', 'Release requires at least one active order line', 409);
    const allocations = direct ? [] : await this.prisma.orderAllocation.findMany({ orderBy: { createdAt: 'asc' }, where: { businessOrderId: orderId, status: 'RESERVED', tenantId: context.tenantId } });
    if (!direct) {
      if (!allocations.length || allocations.some(({ projectionId, warehouseId }) => !projectionId || !warehouseId)) throw new AppError('ORDER_RELEASE_RESERVATION_REQUIRED', 'All fulfillment quantities require active reservations', 409);
      for (const line of lines) { const allocated = allocations.filter(({ orderLineId }) => orderLineId === line.id).reduce((sum, row) => sum.add(row.quantityBase), new Prisma.Decimal(0)); if (!line.quantityBase || !allocated.equals(line.quantityBase)) throw new AppError('ORDER_RELEASE_QUANTITY_MISMATCH', 'Reserved quantity must equal every order line quantity', 409); }
    }
    const warehouseIds = direct ? [input.originWarehouseId!] : [...new Set(allocations.map(({ warehouseId }) => warehouseId!))];
    const calendarSnapshots: (Awaited<ReturnType<CalendarReleaseFacade['evaluate']>> & { warehouseId: string })[] = [];
    for (const warehouseId of warehouseIds) { const result = await this.calendars.evaluate(input.calendarCode, warehouseId, input.serviceType, new Date(), context); if (!result.withinCutoff) throw new AppError('ORDER_RELEASE_CUTOFF_PASSED', 'Release calendar is closed or cutoff time has passed', 409); calendarSnapshots.push({ ...result, warehouseId }); }
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.businessOrder.findFirst({ where: { id: orderId, tenantId: context.tenantId } });
      if (!current || current.version !== input.expectedVersion || current.status !== order.status) throw new AppError('ORDER_VERSION_CONFLICT', 'Order changed during release', 409, { retryable: true });
      const fulfillmentIds: string[] = []; const shipmentRequestIds: string[] = [];
      const grouped = new Map<string, typeof allocations>();
      for (const allocation of allocations) grouped.set(allocation.warehouseId!, [...(grouped.get(allocation.warehouseId!) ?? []), allocation]);
      for (const [warehouseId, group] of grouped) {
        const fulfillmentId = randomUUID(); const fulfillmentNo = `FUL-${current.orderNo}-${fulfillmentIds.length + 1}-${fulfillmentId.slice(0, 8)}`; const ownerId = group[0]!.ownerId;
        const fulfillment = await transaction.fulfillmentOrder.create({ data: { businessOrderId: orderId, createdBy: context.accountId, fulfillmentNo, id: fulfillmentId, orderVersion: current.version, ownerId, plannedDate: current.requestedFrom, progressSnapshot: {}, releaseBatchId: releaseBatchId ?? null, status: 'DRAFT', tenantId: context.tenantId, type: this.fulfillmentType(current.type), updatedBy: context.accountId, warehouseId } });
        let lineNo = 0;
        for (const allocation of group) { const source = lines.find(({ id }) => id === allocation.orderLineId)!; await transaction.fulfillmentLine.create({ data: { allocationId: allocation.id, baseUom: allocation.baseUom, createdBy: context.accountId, fulfillmentOrderId: fulfillment.id, id: randomUUID(), lineNo: ++lineNo, originalUom: allocation.originalUom, productId: allocation.productId, productSnapshot: json(source.productSnapshot), quantityBase: allocation.quantityBase, quantityOriginal: allocation.quantityOriginal, sourceOrderLineId: source.id, tenantId: context.tenantId, updatedBy: context.accountId } }); }
        assertFulfillmentTransition(fulfillment.status, 'RELEASED');
        const released = await transaction.fulfillmentOrder.update({ data: { status: 'RELEASED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: fulfillment.id } }); fulfillmentIds.push(released.id);
        shipmentRequestIds.push(await this.createShipment(transaction, current, input, warehouseId, released.id, releaseBatchId, shipmentRequestIds.length + 1, context));
      }
      if (direct) shipmentRequestIds.push(await this.createShipment(transaction, current, input, input.originWarehouseId!, null, releaseBatchId, 1, context));
      const changed = await transaction.businessOrder.update({ data: { status: 'RELEASED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: orderId } });
      await this.record(transaction, orderId, 'BusinessOrder', changed.version, 'order.released.v1', context, metadata, { calendarSnapshots: json(calendarSnapshots), fulfillmentRequests: fulfillmentIds, shipmentRequests: shipmentRequestIds });
      for (const id of fulfillmentIds) await this.record(transaction, id, 'FulfillmentOrder', 2, 'fulfillment.released.v1', context, metadata, { fulfillmentId: id, orderId });
      for (const id of shipmentRequestIds) await this.record(transaction, id, 'ShipmentRequest', 2, 'shipment.requested.v1', context, metadata, { orderId, shipmentRequestId: id });
      return { fulfillmentIds, orderId, shipmentRequestIds, status: changed.status, version: changed.version };
    });
  }

  async batch(input: ReleaseBatchInput, context: TenantContext, metadata: CommandMetadata) {
    if (!input.members.length || input.members.length > 300 || new Set(input.members.map(({ orderId }) => orderId)).size !== input.members.length) throw new AppError('ORDER_RELEASE_BATCH_INVALID', 'Batch members must be unique and contain 1 to 300 orders', 400);
    for (const member of input.members) this.uuid(member.orderId, 'ORDER_NOT_FOUND');
    const batchId = randomUUID(); const batch = await this.prisma.orderReleaseBatch.create({ data: { batchNo: `REL-${batchId.slice(0, 12)}`, calendarCode: input.calendarCode.trim().toUpperCase(), createdBy: context.accountId, id: batchId, mode: input.mode ?? 'BATCH', requestedCount: input.members.length, tenantId: context.tenantId, updatedBy: context.accountId } });
    const results: Record<string, unknown>[] = [];
    for (const member of input.members) { try { const result = await this.release(member.orderId, { calendarCode: input.calendarCode, expectedVersion: member.expectedVersion, mode: 'DIRECT', ...(input.serviceLevel ? { serviceLevel: input.serviceLevel } : {}), ...(input.serviceType ? { serviceType: input.serviceType } : {}) }, context, { ...metadata, correlationId: `${metadata.correlationId}:${member.orderId}` }, batch.id); results.push({ orderId: member.orderId, status: result.status, version: result.version }); } catch (error) { results.push({ code: error instanceof AppError ? error.code : 'ORDER_RELEASE_FAILED', orderId: member.orderId, status: 'FAILED' }); } }
    const failedCount = results.filter(({ status }) => status === 'FAILED').length; const processedCount = results.length - failedCount; const status = failedCount === 0 ? 'COMPLETED' : processedCount === 0 ? 'FAILED' : 'PARTIAL';
    const changed = await this.prisma.$transaction(async (transaction) => {
      const completed = await transaction.orderReleaseBatch.update({ data: { failedCount, processedCount, results: json(results), status, updatedBy: context.accountId, version: { increment: 1 } }, where: { id: batch.id } });
      await this.record(transaction, completed.id, 'OrderReleaseBatch', completed.version, 'order.release-batch-completed.v1', context, metadata, { failedCount, processedCount, status });
      return completed;
    });
    return { batchId, failedCount, processedCount, results, status: changed.status, version: changed.version };
  }

  async automatic(input: AutoReleaseInput, context: TenantContext, metadata: CommandMetadata) {
    const limit = Math.min(300, Math.max(1, input.limit ?? 100)); const orders = await this.prisma.businessOrder.findMany({ orderBy: [{ priority: 'desc' }, { requestedUntil: 'asc' }, { id: 'asc' }], take: limit, where: { status: 'ALLOCATED', tenantId: context.tenantId } });
    if (!orders.length) return { failedCount: 0, processedCount: 0, results: [], status: 'COMPLETED', version: 1 };
    return this.batch({ calendarCode: input.calendarCode, members: orders.map(({ id, version }) => ({ expectedVersion: version, orderId: id })), mode: 'AUTOMATIC', ...(input.serviceLevel ? { serviceLevel: input.serviceLevel } : {}), ...(input.serviceType ? { serviceType: input.serviceType } : {}) }, context, metadata);
  }

  async projectProgress(fulfillmentId: string, input: FulfillmentProgressInput, context: TenantContext, metadata: CommandMetadata) {
    this.uuid(fulfillmentId, 'FULFILLMENT_NOT_FOUND'); if (!Number.isInteger(input.sourceVersion) || input.sourceVersion < 1) throw new AppError('FULFILLMENT_SOURCE_VERSION_INVALID', 'sourceVersion must be positive', 400);
    return this.prisma.$transaction(async (transaction) => { const current = await transaction.fulfillmentOrder.findFirst({ where: { id: fulfillmentId, tenantId: context.tenantId } }); if (!current) throw new AppError('FULFILLMENT_NOT_FOUND', 'Fulfillment order was not found', 404); if (input.sourceVersion <= current.sourceVersion) return { applied: false, fulfillmentId, sourceVersion: current.sourceVersion, status: current.status, version: current.version }; assertFulfillmentTransition(current.status, input.targetStatus); const changed = await transaction.fulfillmentOrder.update({ data: { externalReference: input.externalReference?.trim() ?? current.externalReference, progressSnapshot: json(input.progress), sourceVersion: input.sourceVersion, status: input.targetStatus, updatedBy: context.accountId, version: { increment: 1 } }, where: { id: current.id } }); await this.record(transaction, changed.id, 'FulfillmentOrder', changed.version, 'fulfillment.progressed.v1', context, metadata, { sourceVersion: changed.sourceVersion, status: changed.status }); return { applied: true, fulfillmentId, sourceVersion: changed.sourceVersion, status: changed.status, version: changed.version }; });
  }

  private async createShipment(transaction: Prisma.TransactionClient, order: { id: string; orderNo: string; deliveryAddressId: string | null; deliveryAddressSnapshot: Prisma.JsonValue; requestedFrom: Date | null; requestedUntil: Date | null }, input: ReleaseOrderInput, warehouseId: string, fulfillmentOrderId: string | null, releaseBatchId: string | undefined, sequence: number, context: TenantContext) {
    const id = randomUUID(); const mode = input.mode ?? 'DIRECT';
    const legs: readonly ShipmentLegInput[] = mode === 'MULTI_LEG' ? input.legs! : [{ fromAddressSnapshot: { warehouseId }, ...(order.deliveryAddressId ? { toAddressId: order.deliveryAddressId } : {}), toAddressSnapshot: order.deliveryAddressSnapshot as Record<string, unknown>, ...(order.requestedFrom ? { windowFrom: order.requestedFrom.toISOString() } : {}), ...(order.requestedUntil ? { windowUntil: order.requestedUntil.toISOString() } : {}) }]; const first = legs[0]!; const last = legs.at(-1)!;
    const request = await transaction.shipmentRequest.create({ data: { businessOrderId: order.id, createdBy: context.accountId, deliveryFrom: order.requestedFrom, deliveryUntil: order.requestedUntil, destinationAddressId: last.toAddressId ?? order.deliveryAddressId, destinationAddressSnapshot: json(last.toAddressSnapshot ?? order.deliveryAddressSnapshot), fulfillmentOrderId, id, mode, originAddressId: first.fromAddressId ?? null, originAddressSnapshot: json(first.fromAddressSnapshot ?? { warehouseId }), pickupFrom: date(first.windowFrom, 'windowFrom'), pickupUntil: date(first.windowUntil, 'windowUntil'), releaseBatchId: releaseBatchId ?? null, requestNo: `SHP-${order.orderNo}-${sequence}-${id.slice(0, 8)}`, requestSnapshot: json(input), serviceLevel: input.serviceLevel?.trim().toUpperCase() ?? null, status: 'OPEN', temperatureMax: decimal(input.temperatureMax, 'temperatureMax'), temperatureMin: decimal(input.temperatureMin, 'temperatureMin'), tenantId: context.tenantId, updatedBy: context.accountId, volume: decimal(input.volume, 'volume'), volumeUom: input.volumeUom?.trim().toUpperCase() ?? null, weight: decimal(input.weight, 'weight'), weightUom: input.weightUom?.trim().toUpperCase() ?? null } });
    for (const [index, leg] of legs.entries()) await transaction.shipmentLeg.create({ data: { createdBy: context.accountId, fromAddressId: leg.fromAddressId ?? null, fromAddressSnapshot: json(leg.fromAddressSnapshot), id: randomUUID(), sequence: index + 1, shipmentRequestId: request.id, tenantId: context.tenantId, toAddressId: leg.toAddressId ?? null, toAddressSnapshot: json(leg.toAddressSnapshot), updatedBy: context.accountId, windowFrom: date(leg.windowFrom, 'windowFrom'), windowUntil: date(leg.windowUntil, 'windowUntil') } });
    await transaction.shipmentRequest.update({ data: { status: 'SUBMITTED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: request.id } }); return request.id;
  }

  private validateRelease(input: ReleaseOrderInput) {
    if (!Number.isInteger(input.expectedVersion) || !input.calendarCode?.trim()) throw new AppError('ORDER_RELEASE_INPUT_INVALID', 'expectedVersion and calendarCode are required', 400);
    if (input.directShip && (!input.originWarehouseId || !isUuid(input.originWarehouseId))) throw new AppError('ORDER_RELEASE_INPUT_INVALID', 'Direct shipment requires originWarehouseId', 400);
    if (input.mode === 'MULTI_LEG' && (!input.legs || input.legs.length < 2)) throw new AppError('SHIPMENT_LEGS_INVALID', 'Multi-leg shipment requires at least two legs', 400);
    for (const leg of input.legs ?? []) { if (leg.fromAddressId && !isUuid(leg.fromAddressId)) throw new AppError('SHIPMENT_LEGS_INVALID', 'fromAddressId is invalid', 400); if (leg.toAddressId && !isUuid(leg.toAddressId)) throw new AppError('SHIPMENT_LEGS_INVALID', 'toAddressId is invalid', 400); }
    const weight = decimal(input.weight, 'weight'); const volume = decimal(input.volume, 'volume'); if ((weight === null) !== (input.weightUom === undefined) || (volume === null) !== (input.volumeUom === undefined)) throw new AppError('SHIPMENT_MEASUREMENT_INVALID', 'weight/volume require matching units', 400);
    const min = decimal(input.temperatureMin, 'temperatureMin'); const max = decimal(input.temperatureMax, 'temperatureMax'); if ((min === null) !== (max === null) || (min && max && min.greaterThan(max))) throw new AppError('SHIPMENT_TEMPERATURE_INVALID', 'Temperature range is invalid', 400);
  }

  private fulfillmentType(type: string): FulfillmentType { return type === 'SALES' ? 'OUTBOUND' : type === 'TRANSFER' ? 'TRANSFER' : 'INBOUND'; }
  private uuid(value: string, code: string) { if (!isUuid(value)) throw new AppError(code, 'Resource was not found', 404); }
  private async record(transaction: Prisma.TransactionClient, aggregateId: string, aggregateType: string, aggregateVersion: number, eventName: string, context: TenantContext, metadata: CommandMetadata, payload: Prisma.InputJsonObject) { await Promise.all([transaction.platformAuditLog.create({ data: { action: eventName, after: payload, category: 'BUSINESS_CHANGE', correlationId: metadata.correlationId, createdBy: context.accountId, deviceId: context.deviceId, ipAddress: metadata.ipAddress ?? null, resourceId: aggregateId, resourceType: aggregateType, tenantId: context.tenantId, updatedBy: context.accountId } }), transaction.platformOutbox.create({ data: { aggregateId, aggregateType, aggregateVersion, correlationId: metadata.correlationId, createdBy: context.accountId, eventName, partitionKey: aggregateId, payload: { ...payload, tenantId: context.tenantId }, tenantId: context.tenantId, updatedBy: context.accountId } })]); }
}

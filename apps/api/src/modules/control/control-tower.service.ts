import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { PrismaService } from '../../database/prisma.service';
import type { BusinessEventInput } from '../platform/event.service';
import { EventConsumptionFacade } from '../platform/public/event-consumption.facade';
import type { CommandMetadata } from '../platform/tenant.service';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;

@Injectable()
export class ControlTowerService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventConsumptionFacade)
    private readonly events: EventConsumptionFacade,
  ) {}

  consume(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.events.consumeControlProjection(
      event,
      context,
      metadata,
      async (message, tx) => {
        const payload = object(message.payload);
        const view = object(payload.controlView);
        const businessRef = this.text(
          payload.businessRef ?? view.businessRef ?? message.aggregateId,
          'businessRef',
          200,
        );
        const existingCursor = await tx.controlProjectionCursor.findUnique({
          where: {
            tenantId_aggregateType_aggregateId: {
              aggregateId: message.aggregateId,
              aggregateType: message.aggregateType,
              tenantId: context.tenantId,
            },
          },
        });
        if (
          existingCursor &&
          existingCursor.lastAggregateVersion >= message.aggregateVersion
        )
          return {
            businessRef,
            ignored: true,
            lastVersion: existingCursor.lastAggregateVersion,
          };
        await tx.controlTimelineEvent.create({
          data: {
            aggregateId: message.aggregateId,
            aggregateType: message.aggregateType,
            aggregateVersion: message.aggregateVersion,
            attachmentSnapshot: json({
              attachments: array(payload.attachments),
            }),
            businessRef,
            ...(this.optionalUuid(payload.causationId)
              ? { causationId: String(payload.causationId) }
              : {}),
            createdBy: context.accountId,
            eventId: message.eventId,
            eventType: message.eventType,
            occurredAt: new Date(message.occurredAt),
            payload: json(message.payload),
            replayStatus: this.optionalText(payload.replayStatus, 30) ?? 'LIVE',
            sourceDomain: message.eventType.split('.')[0]!.toUpperCase(),
            summary:
              this.optionalText(payload.summary, 500) ?? message.eventType,
            tenantId: context.tenantId,
            traceId: message.traceId,
            updatedBy: context.accountId,
          },
        });
        await tx.controlProjectionCursor.upsert({
          create: {
            aggregateId: message.aggregateId,
            aggregateType: message.aggregateType,
            businessRef,
            createdBy: context.accountId,
            lastAggregateVersion: message.aggregateVersion,
            lastEventId: message.eventId,
            lastEventType: message.eventType,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
          update: {
            businessRef,
            lastAggregateVersion: message.aggregateVersion,
            lastEventId: message.eventId,
            lastEventType: message.eventType,
            projectedAt: new Date(),
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            tenantId_aggregateType_aggregateId: {
              aggregateId: message.aggregateId,
              aggregateType: message.aggregateType,
              tenantId: context.tenantId,
            },
          },
        });
        const viewType = this.optionalText(view.type, 30)?.toUpperCase();
        if (viewType === 'ORDER')
          await this.projectOrder(tx, businessRef, view, message, context);
        else if (viewType === 'INVENTORY')
          await this.projectInventory(tx, view, message, context);
        else if (viewType === 'TRANSPORT')
          await this.projectTransport(tx, businessRef, view, message, context);
        else if (viewType === 'YARD')
          await this.projectYard(tx, view, message, context);
        return {
          businessRef,
          eventId: message.eventId,
          projectedView: viewType ?? null,
          version: message.aggregateVersion,
        };
      },
    );
  }

  async timeline(businessRef: string, context: TenantContext) {
    const ref = this.text(businessRef, 'businessRef', 200);
    const items = await this.prisma.controlTimelineEvent.findMany({
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: 1000,
      where: { businessRef: ref, tenantId: context.tenantId },
    });
    return toHttpJson({
      businessRef: ref,
      items,
      refreshedAt: items.at(-1)?.createdAt ?? null,
    });
  }

  async workbench(context: TenantContext, exactLocation = false) {
    const where = { tenantId: context.tenantId };
    const [orders, inventory, transportRows, yards, timelines] =
      await Promise.all([
        this.prisma.orderControlView.findMany({
          orderBy: [{ refreshedAt: 'desc' }, { businessRef: 'asc' }],
          take: 500,
          where,
        }),
        this.prisma.inventoryNetworkView.findMany({
          orderBy: [
            { stockoutRisk: 'desc' },
            { warehouseRef: 'asc' },
            { productRef: 'asc' },
          ],
          take: 1000,
          where,
        }),
        this.prisma.transportNetworkView.findMany({
          orderBy: [
            { delayed: 'desc' },
            { temperatureAlert: 'desc' },
            { refreshedAt: 'desc' },
          ],
          take: 1000,
          where,
        }),
        this.prisma.yardControlView.findMany({
          orderBy: [
            { queueCount: 'desc' },
            { warehouseRef: 'asc' },
            { dockRef: 'asc' },
          ],
          take: 500,
          where,
        }),
        this.prisma.controlTimelineEvent.findMany({
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: 500,
          where,
        }),
      ]);
    const transport = transportRows.map((row) => ({
      ...row,
      latitude: exactLocation ? row.latitude : this.mask(row.latitude),
      longitude: exactLocation ? row.longitude : this.mask(row.longitude),
      locationPrecision: exactLocation ? 'EXACT' : 'APPROXIMATE',
    }));
    const heat = new Map<string, number>();
    for (const row of transportRows)
      heat.set(
        row.routeRef,
        (heat.get(row.routeRef) ?? 0) + Number(row.heatWeight),
      );
    return toHttpJson({
      inventory,
      orders,
      refreshedAt: new Date(),
      timeline: timelines,
      transport,
      transportHeat: [...heat].map(([routeRef, weight]) => ({
        routeRef,
        weight,
      })),
      yards,
    });
  }

  private async projectOrder(
    tx: Prisma.TransactionClient,
    businessRef: string,
    view: Record<string, unknown>,
    message: BusinessEventInput,
    context: TenantContext,
  ) {
    const completionRate = this.decimal(
      view.completionRate ?? 0,
      'completionRate',
    );
    if (completionRate.lt(0) || completionRate.gt(1))
      this.invalid('completionRate must be between 0 and 1');
    const data = {
      blockingSnapshot: json({ blockers: array(view.blockers) }),
      completionRate,
      currentStage: this.text(
        view.currentStage ?? 'CONFIRMATION',
        'currentStage',
        50,
      ),
      currentStatus: this.text(
        view.currentStatus ?? 'OPEN',
        'currentStatus',
        100,
      ),
      orderRef: this.text(view.orderRef ?? businessRef, 'orderRef', 200),
      ...(view.promisedAt
        ? { promisedAt: this.date(view.promisedAt, 'promisedAt') }
        : {}),
      refreshedAt: new Date(),
      sourceVersions: json({
        ...object(view.sourceVersions),
        [message.aggregateType]: message.aggregateVersion,
      }),
      stageSnapshot: json({ stages: array(view.stages) }),
      updatedBy: context.accountId,
    };
    await tx.orderControlView.upsert({
      create: {
        ...data,
        businessRef,
        createdBy: context.accountId,
        tenantId: context.tenantId,
      },
      update: { ...data, version: { increment: 1 } },
      where: {
        tenantId_businessRef: { businessRef, tenantId: context.tenantId },
      },
    });
  }

  private async projectInventory(
    tx: Prisma.TransactionClient,
    view: Record<string, unknown>,
    message: BusinessEventInput,
    context: TenantContext,
  ) {
    const availableQuantity = this.nonnegative(
      view.availableQuantity,
      'availableQuantity',
    );
    const holdQuantity = this.nonnegative(view.holdQuantity, 'holdQuantity');
    const inTransitQuantity = this.nonnegative(
      view.inTransitQuantity,
      'inTransitQuantity',
    );
    const stockoutRisk = this.decimal(view.stockoutRisk ?? 0, 'stockoutRisk');
    if (stockoutRisk.lt(0) || stockoutRisk.gt(1))
      this.invalid('stockoutRisk must be between 0 and 1');
    const warehouseRef = this.text(view.warehouseRef, 'warehouseRef', 200);
    const ownerRef = this.text(view.ownerRef, 'ownerRef', 200);
    const productRef = this.text(view.productRef, 'productRef', 200);
    const regionRef = this.text(view.regionRef, 'regionRef', 200);
    const data = {
      agingDays: this.integer(view.agingDays ?? 0, 'agingDays'),
      availableQuantity,
      baseUom: this.text(view.baseUom ?? 'EA', 'baseUom', 20).toUpperCase(),
      holdQuantity,
      inTransitQuantity,
      refreshedAt: new Date(),
      sourceVersion: message.aggregateVersion,
      stockoutRisk,
      turnoverDays: this.nonnegative(view.turnoverDays ?? 0, 'turnoverDays'),
      updatedBy: context.accountId,
    };
    await tx.inventoryNetworkView.upsert({
      create: {
        ...data,
        createdBy: context.accountId,
        ownerRef,
        productRef,
        regionRef,
        tenantId: context.tenantId,
        warehouseRef,
      },
      update: { ...data, version: { increment: 1 } },
      where: {
        tenantId_warehouseRef_ownerRef_productRef_regionRef: {
          ownerRef,
          productRef,
          regionRef,
          tenantId: context.tenantId,
          warehouseRef,
        },
      },
    });
  }

  private async projectTransport(
    tx: Prisma.TransactionClient,
    businessRef: string,
    view: Record<string, unknown>,
    message: BusinessEventInput,
    context: TenantContext,
  ) {
    const shipmentRef = this.text(view.shipmentRef, 'shipmentRef', 200);
    const data = {
      businessRef,
      currentNodeRef: this.optionalText(view.currentNodeRef, 200) ?? null,
      delayed: Boolean(view.delayed),
      etaAt: view.etaAt ? this.date(view.etaAt, 'etaAt') : null,
      heatWeight: this.nonnegative(view.heatWeight ?? 0, 'heatWeight'),
      latitude:
        view.latitude === undefined
          ? null
          : this.coordinate(view.latitude, 'latitude', -90, 90),
      longitude:
        view.longitude === undefined
          ? null
          : this.coordinate(view.longitude, 'longitude', -180, 180),
      nodeSnapshot: json({ nodes: array(view.nodes) }),
      refreshedAt: new Date(),
      routeRef: this.text(view.routeRef, 'routeRef', 200),
      sourceVersion: message.aggregateVersion,
      temperatureAlert: Boolean(view.temperatureAlert),
      updatedBy: context.accountId,
      vehicleRef: this.optionalText(view.vehicleRef, 200) ?? null,
    };
    await tx.transportNetworkView.upsert({
      create: {
        ...data,
        createdBy: context.accountId,
        shipmentRef,
        tenantId: context.tenantId,
      },
      update: { ...data, version: { increment: 1 } },
      where: {
        tenantId_shipmentRef: { shipmentRef, tenantId: context.tenantId },
      },
    });
  }

  private async projectYard(
    tx: Prisma.TransactionClient,
    view: Record<string, unknown>,
    message: BusinessEventInput,
    context: TenantContext,
  ) {
    const warehouseRef = this.text(view.warehouseRef, 'warehouseRef', 200);
    const dockRef = this.text(view.dockRef, 'dockRef', 200);
    const data = {
      arrivedToday: this.integer(view.arrivedToday ?? 0, 'arrivedToday'),
      futureCapacity: this.nonnegative(
        view.futureCapacity ?? 0,
        'futureCapacity',
      ),
      lateCount: this.integer(view.lateCount ?? 0, 'lateCount'),
      noShowCount: this.integer(view.noShowCount ?? 0, 'noShowCount'),
      occupied: Boolean(view.occupied),
      operationMinutes: this.integer(
        view.operationMinutes ?? 0,
        'operationMinutes',
      ),
      queueCount: this.integer(view.queueCount ?? 0, 'queueCount'),
      refreshedAt: new Date(),
      sourceVersion: message.aggregateVersion,
      tmsReferenceSnapshot: json({ references: array(view.tmsReferences) }),
      updatedBy: context.accountId,
      wmsReferenceSnapshot: json({ references: array(view.wmsReferences) }),
    };
    await tx.yardControlView.upsert({
      create: {
        ...data,
        createdBy: context.accountId,
        dockRef,
        tenantId: context.tenantId,
        warehouseRef,
      },
      update: { ...data, version: { increment: 1 } },
      where: {
        tenantId_warehouseRef_dockRef: {
          dockRef,
          tenantId: context.tenantId,
          warehouseRef,
        },
      },
    });
  }

  private mask(value: Prisma.Decimal | null) {
    return value ? value.toDecimalPlaces(2) : null;
  }

  private coordinate(value: unknown, field: string, min: number, max: number) {
    const result = this.decimal(value, field);
    if (result.lt(min) || result.gt(max))
      this.invalid(`${field} is out of range`);
    return result;
  }

  private nonnegative(value: unknown, field: string) {
    const result = this.decimal(value, field);
    if (result.lt(0)) this.invalid(`${field} cannot be negative`);
    return result;
  }

  private decimal(value: unknown, field: string) {
    try {
      const result = new Prisma.Decimal(String(value ?? ''));
      if (!result.isFinite()) throw new Error('not finite');
      return result;
    } catch {
      this.invalid(`${field} is invalid`);
    }
  }

  private integer(value: unknown, field: string) {
    const result = Number(value);
    if (!Number.isInteger(result) || result < 0)
      this.invalid(`${field} is invalid`);
    return result;
  }

  private date(value: unknown, field: string) {
    const result = new Date(String(value));
    if (Number.isNaN(result.getTime())) this.invalid(`${field} is invalid`);
    return result;
  }

  private text(value: unknown, field: string, maximum: number) {
    const result = typeof value === 'string' ? value.trim() : '';
    if (!result || result.length > maximum) this.invalid(`${field} is invalid`);
    return result;
  }

  private optionalText(value: unknown, maximum: number) {
    const result = typeof value === 'string' ? value.trim() : '';
    return result && result.length <= maximum ? result : undefined;
  }

  private optionalUuid(value: unknown) {
    return (
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    );
  }

  private invalid(message: string): never {
    throw new AppError('CONTROL_PROJECTION_INPUT_INVALID', message, 400);
  }
}

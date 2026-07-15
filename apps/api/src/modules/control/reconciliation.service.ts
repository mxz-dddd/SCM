import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type ControlReconciliationOutcome,
  type ControlReconciliationType,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { PrismaService } from '../../database/prisma.service';
import type { BusinessEventInput } from '../platform/event.service';
import { hashIdempotencyRequest } from '../platform/idempotency.service';
import { EventConsumptionFacade } from '../platform/public/event-consumption.facade';
import { JobSchedulingFacade } from '../platform/public/job-scheduling.facade';
import type { CommandMetadata } from '../platform/tenant.service';

type JsonObject = Record<string, unknown>;

export interface RunReconciliationInput {
  readonly periodEnd: string;
  readonly periodStart: string;
  readonly triggerRef: string;
  readonly type: ControlReconciliationType;
}

const TYPES: readonly ControlReconciliationType[] = [
  'ORDER_FULFILLMENT',
  'INVENTORY_MOVEMENT',
  'SHIPMENT_POD',
  'BILLING_VOUCHER',
];
const SCHEDULES = [
  ['ORDER_FULFILLMENT', '订单-履约每日对账'],
  ['INVENTORY_MOVEMENT', '库存-流水每日对账'],
  ['SHIPMENT_POD', '运单-POD 每日对账'],
  ['BILLING_VOUCHER', '计费-凭证每日对账'],
] as const;

const object = (value: unknown): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;

@Injectable()
export class ReconciliationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventConsumptionFacade)
    private readonly events: EventConsumptionFacade,
    @Inject(JobSchedulingFacade)
    private readonly scheduling: JobSchedulingFacade,
  ) {}

  consumeObservation(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.events.consumeControlReconciliation(
      event,
      context,
      metadata,
      async (message, tx) => {
        const reconciliation = object(object(message.payload).reconciliation);
        const type = this.type(reconciliation.type);
        const side = String(reconciliation.side).toUpperCase();
        if (!['SOURCE', 'TARGET'].includes(side))
          this.invalid('reconciliation.side is invalid');
        const businessRef = this.text(
          reconciliation.businessRef ?? object(message.payload).businessRef,
          'businessRef',
          200,
        );
        const sourceDomain = this.text(
          reconciliation.sourceDomain,
          'sourceDomain',
          30,
        ).toUpperCase();
        const metrics = object(reconciliation.metrics);
        if (Object.keys(metrics).length === 0)
          this.invalid('reconciliation.metrics are required');
        const sourceVersion = Number(
          reconciliation.sourceVersion ?? message.aggregateVersion,
        );
        if (!Number.isInteger(sourceVersion) || sourceVersion < 1)
          this.invalid('reconciliation.sourceVersion is invalid');
        const snapshotHash = hashIdempotencyRequest(metrics);
        await this.lock(
          tx,
          `${context.tenantId}:reconciliation-observation:${type}:${businessRef}:${side}:${sourceVersion}`,
        );
        const existing = await tx.controlReconciliationObservation.findUnique({
          where: {
            tenantId_reconciliationType_businessRef_side_sourceVersion: {
              businessRef,
              reconciliationType: type,
              side: side as 'SOURCE' | 'TARGET',
              sourceVersion,
              tenantId: context.tenantId,
            },
          },
        });
        if (existing) {
          if (
            existing.snapshotHash !== snapshotHash ||
            existing.sourceDomain !== sourceDomain
          )
            throw new AppError(
              'CONTROL_RECONCILIATION_OBSERVATION_CONFLICT',
              'The reconciliation observation version has different content',
              409,
            );
          return { duplicateObservation: true, observationId: existing.id };
        }
        const observation = await tx.controlReconciliationObservation.create({
          data: {
            businessRef,
            createdBy: context.accountId,
            eventId: message.eventId,
            metricSnapshot: json(metrics),
            occurredAt: new Date(message.occurredAt),
            reconciliationType: type,
            side: side as 'SOURCE' | 'TARGET',
            snapshotHash,
            sourceDomain,
            sourceVersion,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        return { duplicateObservation: false, observationId: observation.id };
      },
    );
  }

  async bootstrapSchedules(context: TenantContext, metadata: CommandMetadata) {
    const definitions = await this.scheduling.ensureDailyReconciliations(
      SCHEDULES.map(([type, name]) => ({
        code: `CONTROL.DAILY_RECONCILIATION.${type}`,
        name,
        payload: { type },
      })),
      context,
      metadata,
    );
    return toHttpJson({ definitions, scheduleCount: definitions.length });
  }

  async run(
    input: RunReconciliationInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const type = this.type(input.type);
    const periodStart = this.date(input.periodStart, 'periodStart');
    const periodEnd = this.date(input.periodEnd, 'periodEnd');
    const triggerRef = this.text(input.triggerRef, 'triggerRef', 200);
    if (periodEnd <= periodStart)
      this.invalid('Reconciliation period is invalid');
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:reconciliation-run:${type}`);
      const existing = await tx.controlReconciliationRun.findUnique({
        where: {
          tenantId_reconciliationType_triggerRef: {
            reconciliationType: type,
            tenantId: context.tenantId,
            triggerRef,
          },
        },
      });
      if (existing) {
        if (
          existing.periodStart.getTime() !== periodStart.getTime() ||
          existing.periodEnd.getTime() !== periodEnd.getTime()
        )
          throw new AppError(
            'CONTROL_RECONCILIATION_TRIGGER_CONFLICT',
            'The trigger reference was reused for a different period',
            409,
          );
        return {
          differenceCount: existing.differenceCount,
          duplicate: true,
          matchedCount: existing.matchedCount,
          reconciliationRunId: existing.id,
          status: existing.status,
        };
      }
      const run = await tx.controlReconciliationRun.create({
        data: {
          createdBy: context.accountId,
          periodEnd,
          periodStart,
          reconciliationType: type,
          tenantId: context.tenantId,
          triggerRef,
          updatedBy: context.accountId,
        },
      });
      const observations = await tx.controlReconciliationObservation.findMany({
        orderBy: [
          { businessRef: 'asc' },
          { side: 'asc' },
          { sourceVersion: 'desc' },
          { id: 'desc' },
        ],
        where: {
          occurredAt: { gte: periodStart, lt: periodEnd },
          reconciliationType: type,
          tenantId: context.tenantId,
        },
      });
      const latest = new Map<string, (typeof observations)[number]>();
      for (const observation of observations) {
        const key = `${observation.businessRef}:${observation.side}`;
        if (!latest.has(key)) latest.set(key, observation);
      }
      const businessRefs = [
        ...new Set(observations.map(({ businessRef }) => businessRef)),
      ].sort();
      let matchedCount = 0;
      let differenceCount = 0;
      for (const [index, businessRef] of businessRefs.entries()) {
        const source = latest.get(`${businessRef}:SOURCE`);
        const target = latest.get(`${businessRef}:TARGET`);
        const outcome: ControlReconciliationOutcome = !source
          ? 'MISSING_SOURCE'
          : !target
            ? 'MISSING_TARGET'
            : source.snapshotHash === target.snapshotHash
              ? 'MATCHED'
              : 'MISMATCH';
        const difference = this.difference(
          object(source?.metricSnapshot),
          object(target?.metricSnapshot),
        );
        const item = await tx.controlReconciliationItem.create({
          data: {
            businessRef,
            createdBy: context.accountId,
            differenceSnapshot: json(difference),
            outcome,
            reconciliationRunId: run.id,
            sourceObservationId: source?.id ?? null,
            sourceSnapshot: json(source?.metricSnapshot),
            targetObservationId: target?.id ?? null,
            targetSnapshot: json(target?.metricSnapshot),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        if (outcome === 'MATCHED') matchedCount += 1;
        else {
          differenceCount += 1;
          const activeCase = await tx.controlReconciliationCase.findFirst({
            where: {
              businessRef,
              reconciliationType: type,
              status: 'OPEN',
              tenantId: context.tenantId,
            },
          });
          if (!activeCase)
            await tx.controlReconciliationCase.create({
              data: {
                businessRef,
                caseNo: `REC-${type}-${run.id.slice(0, 8)}-${index + 1}`,
                createdBy: context.accountId,
                differenceSnapshot: json(difference),
                reasonCode: outcome,
                reconciliationItemId: item.id,
                reconciliationRunId: run.id,
                reconciliationType: type,
                tenantId: context.tenantId,
                updatedBy: context.accountId,
              },
            });
        }
      }
      const completed = await tx.controlReconciliationRun.update({
        data: {
          completedAt: new Date(),
          differenceCount,
          matchedCount,
          observationCount: latest.size,
          status: 'COMPLETED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: run.id },
      });
      await this.record(
        tx,
        run.id,
        completed.version,
        'control.reconciliation-completed.v1',
        { differenceCount, matchedCount, periodEnd, periodStart, type },
        context,
        metadata,
      );
      return {
        differenceCount,
        duplicate: false,
        matchedCount,
        reconciliationRunId: run.id,
        status: completed.status,
      };
    });
    return toHttpJson(result);
  }

  async resolveCase(
    id: string,
    input: { expectedVersion: number; resolution: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const resolution = this.text(input.resolution, 'resolution', 1000);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.controlReconciliationCase.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!current)
        throw new AppError(
          'CONTROL_RECONCILIATION_CASE_NOT_FOUND',
          'Reconciliation case was not found',
          404,
        );
      if (current.status !== 'OPEN')
        throw new AppError(
          'CONTROL_RECONCILIATION_CASE_TRANSITION_INVALID',
          `Reconciliation case ${current.status} -> RESOLVED is not allowed`,
          409,
        );
      if (current.version !== input.expectedVersion)
        throw new AppError(
          'CONTROL_RECONCILIATION_CASE_VERSION_CONFLICT',
          'Reconciliation case version changed',
          409,
        );
      const resolved = await tx.controlReconciliationCase.update({
        data: {
          resolution,
          resolvedAt: new Date(),
          resolvedBy: context.accountId,
          status: 'RESOLVED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        resolved.version,
        'control.reconciliation-case-resolved.v1',
        { businessRef: resolved.businessRef, resolution },
        context,
        metadata,
      );
      return { caseId: id, status: resolved.status, version: resolved.version };
    });
  }

  async workbench(context: TenantContext) {
    const where = { tenantId: context.tenantId };
    const [schedules, observations, runs, items, cases] = await Promise.all([
      this.scheduling.listDailyReconciliations(context),
      this.prisma.controlReconciliationObservation.findMany({
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 1000,
        where,
      }),
      this.prisma.controlReconciliationRun.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
        where,
      }),
      this.prisma.controlReconciliationItem.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1000,
        where,
      }),
      this.prisma.controlReconciliationCase.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
        where,
      }),
    ]);
    return toHttpJson({
      cases,
      items,
      observations,
      refreshedAt: new Date(),
      runs,
      schedules,
    });
  }

  private difference(source: JsonObject, target: JsonObject) {
    const fields = [
      ...new Set([...Object.keys(source), ...Object.keys(target)]),
    ]
      .sort()
      .filter(
        (field) =>
          hashIdempotencyRequest(source[field]) !==
          hashIdempotencyRequest(target[field]),
      )
      .map((field) => ({
        field,
        source: source[field] ?? null,
        target: target[field] ?? null,
      }));
    return { fields };
  }

  private async record(
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
    eventName: string,
    payload: Readonly<Record<string, unknown>>,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const after = json(payload) as Prisma.InputJsonObject;
    await Promise.all([
      tx.platformAuditLog.create({
        data: {
          action: eventName,
          after,
          category: 'BUSINESS_CHANGE',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: id,
          resourceType: 'ControlReconciliation',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      tx.platformOutbox.create({
        data: {
          aggregateId: id,
          aggregateType: 'ControlReconciliation',
          aggregateVersion: version,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName,
          partitionKey: id,
          payload: { ...after, tenantId: context.tenantId },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }

  private type(value: unknown): ControlReconciliationType {
    const type = String(value ?? '').toUpperCase() as ControlReconciliationType;
    if (!TYPES.includes(type)) this.invalid('Reconciliation type is invalid');
    return type;
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

  private lock(tx: Prisma.TransactionClient, key: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  private invalid(message: string): never {
    throw new AppError('CONTROL_RECONCILIATION_INPUT_INVALID', message, 400);
  }
}

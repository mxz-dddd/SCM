import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type OrderExceptionSeverity,
  type SlaStage,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { CalendarReleaseFacade } from '../mdm/public/calendar-release.facade';
import { PermissionDecisionFacade } from '../platform/public/permission-decision.facade';
import { businessNumber } from '../platform/public/numbering.facade';
import type { CommandMetadata } from '../platform/tenant.service';
import {
  ChangeReverseService,
  type CreateOrderChangeInput,
  type CreateRmaInput,
} from './change-reverse.service';
import { FulfillmentReleaseService } from './fulfillment-release.service';
import { OrderGovernanceService } from './order-governance.service';

export interface DetectExceptionsInput {
  readonly limit?: number;
  readonly now?: string;
  readonly stalledMinutes?: number;
}
export interface ListExceptionsInput {
  readonly assignedTo?: string;
  readonly page?: string;
  readonly pageSize?: string;
  readonly severity?: OrderExceptionSeverity;
  readonly status?: string;
  readonly type?: string;
}
export interface AssignExceptionInput {
  readonly assignedTo: string;
  readonly expectedVersion: number;
}
export interface BatchExceptionInput {
  readonly action: 'ASSIGN' | 'RETRY' | 'COMPENSATE';
  readonly assignedTo?: string;
  readonly members: readonly {
    readonly caseId: string;
    readonly expectedVersion: number;
  }[];
  readonly reason?: string;
}
export interface ReportExceptionInput {
  readonly description: string;
  readonly exceptionType: string;
  readonly orderId: string;
  readonly responsibleDomain: string;
  readonly severity: OrderExceptionSeverity;
  readonly sourceRef: string;
}
export interface ExceptionActionInput {
  readonly expectedVersion: number;
  readonly reason: string;
}
export interface StartSlaInput {
  readonly calendarCode: string;
  readonly durationMinutes: number;
  readonly responsibleDomain: string;
  readonly sourceVersion: number;
  readonly stage: SlaStage;
  readonly startedAt?: string;
  readonly warningLeadMinutes: number;
}
export interface TransitionSlaInput {
  readonly expectedVersion: number;
  readonly reason?: string;
  readonly sourceVersion: number;
  readonly targetStatus: 'PAUSED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}
export interface MonitorSlaInput {
  readonly limit?: number;
  readonly now?: string;
}
export interface CreateSettlementInput {
  readonly chargeFacts: readonly {
    readonly factId: string;
    readonly factSnapshot: Readonly<Record<string, unknown>>;
    readonly factType: string;
    readonly sourceDomain: string;
  }[];
  readonly commercialAmount?: string;
  readonly currency?: string;
  readonly discountAmount?: string;
  readonly expectedVersion: number;
  readonly serviceAmount?: string;
}
export interface ProjectSettlementInput {
  readonly billingReference?: string;
  readonly rejectionReason?: string;
  readonly sourceVersion: number;
  readonly status: 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
}
export interface BatchOrderCommandInput {
  readonly action: 'REVIEW' | 'HOLD' | 'RELEASE';
  readonly calendarCode?: string;
  readonly members: readonly {
    readonly expectedVersion: number;
    readonly orderId: string;
  }[];
  readonly reason?: string;
}
export interface PortalPartnerInput {
  readonly partnerId: string;
}

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
function instant(value: string | undefined, field: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.valueOf()))
    throw new AppError(
      'ORDER_OPERATIONS_DATE_INVALID',
      `${field} is invalid`,
      400,
    );
  return date;
}
function decimal(
  value: string | undefined,
  fallback: Prisma.Decimal | number = 0,
) {
  try {
    const result =
      value === undefined
        ? new Prisma.Decimal(fallback)
        : new Prisma.Decimal(value);
    if (!result.isFinite() || result.isNegative()) throw new Error();
    return result;
  } catch {
    throw new AppError(
      'SETTLEMENT_AMOUNT_INVALID',
      'Settlement amount is invalid',
      400,
    );
  }
}

@Injectable()
export class OrderOperationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CalendarReleaseFacade)
    private readonly calendars: CalendarReleaseFacade,
    @Inject(PermissionDecisionFacade)
    private readonly permissions: PermissionDecisionFacade,
    @Inject(OrderGovernanceService)
    private readonly governance: OrderGovernanceService,
    @Inject(FulfillmentReleaseService)
    private readonly fulfillment: FulfillmentReleaseService,
    @Inject(ChangeReverseService)
    private readonly reverse: ChangeReverseService,
  ) {}

  async listExceptions(input: ListExceptionsInput, context: TenantContext) {
    const page = Math.max(Number.parseInt(input.page ?? '1', 10) || 1, 1);
    const pageSize = Math.min(
      Math.max(Number.parseInt(input.pageSize ?? '50', 10) || 50, 1),
      200,
    );
    const where: Prisma.OrderExceptionCaseWhereInput = {
      ...(input.assignedTo ? { assignedTo: input.assignedTo } : {}),
      ...(input.severity ? { severity: input.severity } : {}),
      ...(input.status ? { status: input.status as never } : {}),
      ...(input.type ? { exceptionType: input.type.trim().toUpperCase() } : {}),
      tenantId: context.tenantId,
    };
    const [items, total] = await Promise.all([
      this.prisma.orderExceptionCase.findMany({
        orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
      this.prisma.orderExceptionCase.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }

  async detectExceptions(
    input: DetectExceptionsInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const now = instant(input.now, 'now');
    const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
    const cutoff = new Date(
      now.getTime() - Math.max(input.stalledMinutes ?? 240, 1) * 60_000,
    );
    const [invalid, failedAllocations, backorders, stalled] = await Promise.all(
      [
        this.prisma.businessOrder.findMany({
          take: limit,
          where: { status: 'INVALID', tenantId: context.tenantId },
        }),
        this.prisma.orderAllocation.findMany({
          take: limit,
          where: { status: 'FAILED', tenantId: context.tenantId },
        }),
        this.prisma.backorder.findMany({
          take: limit,
          where: { status: 'OPEN', tenantId: context.tenantId },
        }),
        this.prisma.businessOrder.findMany({
          take: limit,
          where: {
            status: { in: ['APPROVED', 'ALLOCATED'] },
            tenantId: context.tenantId,
            updatedAt: { lte: cutoff },
          },
        }),
      ],
    );
    const candidates = [
      ...invalid.map((row) => ({
        description: 'Order validation failed',
        domain: 'OMS',
        orderId: row.id,
        ref: row.id,
        severity: 'HIGH' as const,
        type: 'VALIDATION_FAILED',
      })),
      ...failedAllocations.map((row) => ({
        description: row.failureCode ?? 'Allocation failed',
        domain: 'WMS',
        orderId: row.businessOrderId,
        ref: row.id,
        severity: 'HIGH' as const,
        type: 'ALLOCATION_FAILED',
      })),
      ...backorders.map((row) => ({
        description: `Backorder ${row.quantityBase.toString()} ${row.baseUom}`,
        domain: 'OMS',
        orderId: row.businessOrderId,
        ref: row.id,
        severity: 'HIGH' as const,
        type: 'FULFILLMENT_SHORTAGE',
      })),
      ...stalled.map((row) => ({
        description: 'Order has not been released within threshold',
        domain: 'OMS',
        orderId: row.id,
        ref: row.id,
        severity: 'MEDIUM' as const,
        type: 'RELEASE_STALLED',
      })),
    ];
    let created = 0;
    for (const candidate of candidates) {
      const key = `${candidate.type}:${candidate.ref}`;
      const exists = await this.prisma.orderExceptionCase.findUnique({
        where: {
          tenantId_dedupeKey: { dedupeKey: key, tenantId: context.tenantId },
        },
      });
      if (exists) continue;
      await this.prisma.$transaction(async (tx) => {
        const row = await tx.orderExceptionCase.create({
          data: {
            businessOrderId: candidate.orderId,
            createdBy: context.accountId,
            dedupeKey: key,
            description: candidate.description,
            exceptionType: candidate.type,
            responsibleDomain: candidate.domain,
            retryCommand: json({
              orderId: candidate.orderId,
              type: candidate.type,
            }),
            severity: candidate.severity,
            sourceRef: candidate.ref,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await this.record(
          tx,
          row.id,
          'OrderExceptionCase',
          row.version,
          'order.exception-opened.v1',
          context,
          metadata,
          { caseId: row.id, orderId: candidate.orderId, type: candidate.type },
        );
      });
      created++;
    }
    return {
      created,
      detected: candidates.length,
      existing: candidates.length - created,
    };
  }

  async assignException(
    id: string,
    input: AssignExceptionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'ORDER_EXCEPTION_NOT_FOUND');
    this.uuid(input.assignedTo, 'ORDER_EXCEPTION_ASSIGNEE_INVALID');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.orderExceptionCase.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!row)
        throw new AppError(
          'ORDER_EXCEPTION_NOT_FOUND',
          'Exception case was not found',
          404,
        );
      if (row.version !== input.expectedVersion) throw this.conflict();
      if (!['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(row.status))
        throw new AppError(
          'ORDER_EXCEPTION_ASSIGN_STATE_INVALID',
          'Exception case cannot be assigned',
          409,
        );
      const changed = await tx.orderExceptionCase.update({
        data: {
          assignedTo: input.assignedTo,
          status: 'ASSIGNED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        'OrderExceptionCase',
        changed.version,
        'order.exception-assigned.v1',
        context,
        metadata,
        {
          assignedTo: input.assignedTo,
          caseId: id,
          orderId: row.businessOrderId,
        },
      );
      return { caseId: id, status: changed.status, version: changed.version };
    });
  }

  async batchExceptions(
    input: BatchExceptionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      !input.members.length ||
      input.members.length > 200 ||
      new Set(input.members.map(({ caseId }) => caseId)).size !==
        input.members.length
    )
      throw new AppError(
        'ORDER_EXCEPTION_BATCH_INVALID',
        'Exception batch requires 1-200 unique cases',
        400,
      );
    const items: unknown[] = [];
    let succeeded = 0;
    for (const member of input.members) {
      try {
        const result =
          input.action === 'ASSIGN'
            ? await this.assignException(
                member.caseId,
                {
                  assignedTo: input.assignedTo ?? '',
                  expectedVersion: member.expectedVersion,
                },
                context,
                metadata,
              )
            : await this.requestExceptionAction(
                member.caseId,
                input.action,
                {
                  expectedVersion: member.expectedVersion,
                  reason: input.reason ?? 'BATCH_ACTION',
                },
                context,
                metadata,
              );
        items.push({ caseId: member.caseId, result, succeeded: true });
        succeeded++;
      } catch (error) {
        items.push({
          caseId: member.caseId,
          errorCode:
            error instanceof AppError
              ? error.code
              : 'ORDER_EXCEPTION_BATCH_ITEM_FAILED',
          errorMessage:
            error instanceof Error ? error.message : 'Batch item failed',
          succeeded: false,
        });
      }
    }
    return {
      failedCount: input.members.length - succeeded,
      items,
      processedCount: succeeded,
      status:
        succeeded === input.members.length
          ? 'COMPLETED'
          : succeeded === 0
            ? 'FAILED'
            : 'PARTIAL',
    };
  }

  async reportException(
    input: ReportExceptionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    await this.order(input.orderId, context);
    if (
      !input.description?.trim() ||
      !input.exceptionType?.trim() ||
      !input.responsibleDomain?.trim() ||
      !input.sourceRef?.trim()
    )
      throw new AppError(
        'ORDER_EXCEPTION_REPORT_INVALID',
        'Exception report fields are required',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const row = await this.upsertException(
        tx,
        {
          description: input.description.trim(),
          domain: input.responsibleDomain.trim().toUpperCase(),
          key: `${input.exceptionType.trim().toUpperCase()}:${input.sourceRef.trim()}`,
          orderId: input.orderId,
          ref: input.sourceRef.trim(),
          severity: input.severity,
          type: input.exceptionType.trim().toUpperCase(),
        },
        context,
      );
      await this.record(
        tx,
        row.id,
        'OrderExceptionCase',
        row.version,
        'order.exception-reported.v1',
        context,
        metadata,
        {
          caseId: row.id,
          orderId: input.orderId,
          sourceRef: input.sourceRef,
          type: row.exceptionType,
        },
      );
      return { caseId: row.id, status: row.status, version: row.version };
    });
  }

  async requestExceptionAction(
    id: string,
    action: 'RETRY' | 'COMPENSATE' | 'RESOLVE' | 'CLOSE',
    input: ExceptionActionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'ORDER_EXCEPTION_NOT_FOUND');
    if (!input.reason?.trim())
      throw new AppError(
        'ORDER_EXCEPTION_REASON_REQUIRED',
        'Action reason is required',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.orderExceptionCase.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!row)
        throw new AppError(
          'ORDER_EXCEPTION_NOT_FOUND',
          'Exception case was not found',
          404,
        );
      if (row.version !== input.expectedVersion) throw this.conflict();
      const terminal = ['RESOLVED', 'CLOSED'].includes(row.status);
      if (
        (action === 'CLOSE' && row.status !== 'RESOLVED') ||
        (action !== 'CLOSE' && terminal)
      )
        throw new AppError(
          'ORDER_EXCEPTION_TRANSITION_INVALID',
          `Exception action ${action} is not allowed from ${row.status}`,
          409,
        );
      const target =
        action === 'RETRY'
          ? 'RETRYING'
          : action === 'COMPENSATE'
            ? 'COMPENSATING'
            : action === 'RESOLVE'
              ? 'RESOLVED'
              : 'CLOSED';
      const changed = await tx.orderExceptionCase.update({
        data: {
          attemptCount: {
            increment: action === 'RETRY' || action === 'COMPENSATE' ? 1 : 0,
          },
          lastAttemptAt:
            action === 'RETRY' || action === 'COMPENSATE'
              ? new Date()
              : row.lastAttemptAt,
          resolution:
            action === 'RESOLVE' || action === 'CLOSE'
              ? input.reason.trim()
              : row.resolution,
          resolvedAt: action === 'RESOLVE' ? new Date() : row.resolvedAt,
          status: target,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        'OrderExceptionCase',
        changed.version,
        `order.exception-${action.toLowerCase()}-requested.v1`,
        context,
        metadata,
        {
          action,
          caseId: id,
          command:
            action === 'COMPENSATE'
              ? row.compensationCommand
              : row.retryCommand,
          orderId: row.businessOrderId,
          reason: input.reason,
        },
      );
      return { caseId: id, status: changed.status, version: changed.version };
    });
  }

  async startSla(
    orderId: string,
    input: StartSlaInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(orderId, 'ORDER_NOT_FOUND');
    if (
      !Number.isInteger(input.durationMinutes) ||
      input.durationMinutes < 1 ||
      !Number.isInteger(input.warningLeadMinutes) ||
      input.warningLeadMinutes < 0 ||
      input.warningLeadMinutes > input.durationMinutes ||
      !Number.isInteger(input.sourceVersion) ||
      input.sourceVersion < 1
    )
      throw new AppError(
        'SLA_INPUT_INVALID',
        'SLA duration, warning and source version are invalid',
        400,
      );
    const order = await this.order(orderId, context);
    const startedAt = instant(input.startedAt, 'startedAt');
    const deadline = await this.calendars.computeSlaDeadline(
      input.calendarCode,
      startedAt,
      input.durationMinutes,
      input.warningLeadMinutes,
      context,
    );
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.slaClock.findUnique({
        where: {
          tenantId_businessOrderId_stage: {
            businessOrderId: orderId,
            stage: input.stage,
            tenantId: context.tenantId,
          },
        },
      });
      if (existing && existing.sourceVersion >= input.sourceVersion)
        return {
          applied: false,
          clockId: existing.id,
          sourceVersion: existing.sourceVersion,
          status: existing.status,
          version: existing.version,
        };
      if (
        existing &&
        !['ACTIVE', 'PAUSED', 'WARNING'].includes(existing.status)
      )
        throw new AppError(
          'SLA_CLOCK_TERMINAL',
          'Terminal SLA clock cannot be replaced',
          409,
        );
      const data = {
        calendarCode: input.calendarCode.trim().toUpperCase(),
        calendarSnapshot: json(deadline.calendarSnapshot),
        dueAt: deadline.dueAt,
        responsibleDomain: input.responsibleDomain.trim().toUpperCase(),
        sourceVersion: input.sourceVersion,
        startedAt,
        warningAt: deadline.warningAt,
        updatedBy: context.accountId,
      };
      const clock = existing
        ? await tx.slaClock.update({
            data: { ...data, status: 'ACTIVE', version: { increment: 1 } },
            where: { id: existing.id },
          })
        : await tx.slaClock.create({
            data: {
              ...data,
              businessOrderId: order.id,
              createdBy: context.accountId,
              stage: input.stage,
              tenantId: context.tenantId,
            },
          });
      await this.record(
        tx,
        clock.id,
        'SlaClock',
        clock.version,
        'order.sla-started.v1',
        context,
        metadata,
        {
          clockId: clock.id,
          dueAt: clock.dueAt.toISOString(),
          orderId,
          stage: clock.stage,
        },
      );
      return {
        applied: true,
        clockId: clock.id,
        dueAt: clock.dueAt,
        status: clock.status,
        version: clock.version,
      };
    });
  }

  async transitionSla(
    id: string,
    input: TransitionSlaInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'SLA_CLOCK_NOT_FOUND');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.slaClock.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!row)
        throw new AppError(
          'SLA_CLOCK_NOT_FOUND',
          'SLA clock was not found',
          404,
        );
      if (row.version !== input.expectedVersion) throw this.conflict();
      if (input.sourceVersion <= row.sourceVersion)
        return {
          applied: false,
          sourceVersion: row.sourceVersion,
          status: row.status,
          version: row.version,
        };
      const allowed =
        (input.targetStatus === 'PAUSED' &&
          ['ACTIVE', 'WARNING'].includes(row.status)) ||
        (input.targetStatus === 'ACTIVE' && row.status === 'PAUSED') ||
        (['COMPLETED', 'CANCELLED'].includes(input.targetStatus) &&
          ['ACTIVE', 'WARNING', 'PAUSED'].includes(row.status));
      if (!allowed)
        throw new AppError(
          'SLA_TRANSITION_INVALID',
          `SLA transition ${row.status} -> ${input.targetStatus} is not allowed`,
          409,
        );
      if (input.targetStatus === 'PAUSED' && !input.reason?.trim())
        throw new AppError(
          'SLA_PAUSE_REASON_REQUIRED',
          'Pause reason is required',
          400,
        );
      const now = new Date();
      const pauseDeltaSeconds =
        input.targetStatus === 'ACTIVE' && row.pausedAt
          ? Math.max(
              0,
              Math.floor((now.getTime() - row.pausedAt.getTime()) / 1000),
            )
          : 0;
      const pausedSeconds =
        pauseDeltaSeconds > 0
          ? row.pausedSeconds + pauseDeltaSeconds
          : row.pausedSeconds;
      const changed = await tx.slaClock.update({
        data: {
          completedAt:
            input.targetStatus === 'COMPLETED' ? now : row.completedAt,
          dueAt:
            pauseDeltaSeconds > 0
              ? new Date(row.dueAt.getTime() + pauseDeltaSeconds * 1000)
              : row.dueAt,
          pauseReason:
            input.targetStatus === 'PAUSED'
              ? input.reason!.trim()
              : input.targetStatus === 'ACTIVE'
                ? null
                : row.pauseReason,
          pausedAt:
            input.targetStatus === 'PAUSED'
              ? now
              : input.targetStatus === 'ACTIVE'
                ? null
                : row.pausedAt,
          pausedSeconds,
          sourceVersion: input.sourceVersion,
          status: input.targetStatus,
          updatedBy: context.accountId,
          version: { increment: 1 },
          warningAt:
            pauseDeltaSeconds > 0
              ? new Date(row.warningAt.getTime() + pauseDeltaSeconds * 1000)
              : row.warningAt,
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        'SlaClock',
        changed.version,
        'order.sla-transitioned.v1',
        context,
        metadata,
        {
          clockId: id,
          from: row.status,
          orderId: row.businessOrderId,
          to: changed.status,
        },
      );
      return {
        applied: true,
        sourceVersion: changed.sourceVersion,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async monitorSla(
    input: MonitorSlaInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const now = instant(input.now, 'now');
    const rows = await this.prisma.slaClock.findMany({
      orderBy: { dueAt: 'asc' },
      take: Math.min(Math.max(input.limit ?? 200, 1), 500),
      where: {
        status: { in: ['ACTIVE', 'WARNING'] },
        tenantId: context.tenantId,
        warningAt: { lte: now },
      },
    });
    let breached = 0,
      warning = 0;
    for (const row of rows)
      await this.prisma.$transaction(async (tx) => {
        if (now >= row.dueAt) {
          const overdue = Math.max(
            0,
            Math.floor((now.getTime() - row.dueAt.getTime()) / 1000),
          );
          const changed = await tx.slaClock.update({
            data: {
              breachedAt: now,
              status: 'BREACHED',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: row.id },
          });
          const event = await tx.slaBreachEvent.create({
            data: {
              breachedAt: now,
              businessOrderId: row.businessOrderId,
              createdBy: context.accountId,
              escalationLevel: overdue > 86400 ? 3 : overdue > 3600 ? 2 : 1,
              overdueSeconds: overdue,
              responsibleDomain: row.responsibleDomain,
              slaClockId: row.id,
              stage: row.stage,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          await this.upsertException(
            tx,
            {
              description: `${row.stage} SLA breached`,
              domain: row.responsibleDomain,
              key: `SLA_BREACH:${row.id}`,
              orderId: row.businessOrderId,
              ref: event.id,
              severity: overdue > 3600 ? 'CRITICAL' : 'HIGH',
              type: 'SLA_BREACH',
            },
            context,
          );
          await this.record(
            tx,
            row.id,
            'SlaClock',
            changed.version,
            'order.sla-breached.v1',
            context,
            metadata,
            {
              breachEventId: event.id,
              clockId: row.id,
              orderId: row.businessOrderId,
              overdueSeconds: overdue,
              responsibleDomain: row.responsibleDomain,
            },
          );
          breached++;
        } else if (row.status === 'ACTIVE') {
          const changed = await tx.slaClock.update({
            data: {
              status: 'WARNING',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: row.id },
          });
          await this.record(
            tx,
            row.id,
            'SlaClock',
            changed.version,
            'order.sla-warning.v1',
            context,
            metadata,
            {
              clockId: row.id,
              dueAt: row.dueAt.toISOString(),
              orderId: row.businessOrderId,
            },
          );
          warning++;
        }
      });
    return { breached, warning };
  }

  async createSettlement(
    orderId: string,
    input: CreateSettlementInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(orderId, 'ORDER_NOT_FOUND');
    const order = await this.order(orderId, context);
    if (order.version !== input.expectedVersion) throw this.conflict();
    if (!['RELEASED', 'CANCELLED'].includes(order.status))
      throw new AppError(
        'SETTLEMENT_ORDER_STATE_INVALID',
        'Order is not ready for settlement request',
        409,
      );
    const currency = (input.currency ?? order.currency)?.trim().toUpperCase();
    if (!currency || !/^[A-Z]{3}$/.test(currency))
      throw new AppError(
        'SETTLEMENT_CURRENCY_REQUIRED',
        'Settlement currency is required',
        400,
      );
    const commercial = decimal(input.commercialAmount, order.totalAmount ?? 0),
      discount = decimal(input.discountAmount),
      service = decimal(input.serviceAmount);
    if (discount.greaterThan(commercial.add(service)))
      throw new AppError(
        'SETTLEMENT_AMOUNT_INVALID',
        'Discount exceeds charge amount',
        400,
      );
    const requested = commercial.add(service).sub(discount);
    const [fulfillments, shipments, progress] = await Promise.all([
      this.prisma.fulfillmentOrder.findMany({
        where: { businessOrderId: orderId, tenantId: context.tenantId },
      }),
      this.prisma.shipmentRequest.findMany({
        where: { businessOrderId: orderId, tenantId: context.tenantId },
      }),
      this.prisma.orderLineProgress.findMany({
        where: { businessOrderId: orderId, tenantId: context.tenantId },
      }),
    ]);
    return this.prisma.$transaction(async (tx) => {
      const id = randomUUID();
      const row = await tx.settlementRequest.create({
        data: {
          businessOrderId: orderId,
          commercialAmount: commercial,
          commercialSnapshot: json({
            discount: discount.toString(),
            orderTotal: order.totalAmount?.toString() ?? null,
            service: service.toString(),
          }),
          createdBy: context.accountId,
          currency,
          discountAmount: discount,
          fulfillmentSnapshot: json({ fulfillments, progress, shipments }),
          id,
          orderVersion: order.version,
          requestNo: await businessNumber(
            this.prisma,
            'OMS_SETTLEMENT_REQUEST',
            context,
            metadata,
            `settlement-request:${orderId}:${order.version}`,
          ),
          requestedAmount: requested,
          serviceAmount: service,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      for (const fact of input.chargeFacts)
        await tx.chargeFactRef.create({
          data: {
            createdBy: context.accountId,
            factId: fact.factId.trim(),
            factSnapshot: json(fact.factSnapshot),
            factType: fact.factType.trim().toUpperCase(),
            id: randomUUID(),
            settlementRequestId: row.id,
            sourceDomain: fact.sourceDomain.trim().toUpperCase(),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      await this.record(
        tx,
        row.id,
        'SettlementRequest',
        row.version,
        'settlement.requested.v1',
        context,
        metadata,
        {
          amount: row.requestedAmount.toString(),
          currency,
          rowId: row.id,
          orderId,
        },
      );
      return {
        requestId: row.id,
        requestNo: row.requestNo,
        requestedAmount: row.requestedAmount,
        status: row.status,
        version: row.version,
      };
    });
  }

  async projectSettlement(
    id: string,
    input: ProjectSettlementInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'SETTLEMENT_REQUEST_NOT_FOUND');
    if (!Number.isInteger(input.sourceVersion) || input.sourceVersion < 1)
      throw new AppError(
        'SETTLEMENT_SOURCE_VERSION_INVALID',
        'Settlement source version is invalid',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.settlementRequest.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!row)
        throw new AppError(
          'SETTLEMENT_REQUEST_NOT_FOUND',
          'Settlement request was not found',
          404,
        );
      if (input.sourceVersion <= row.sourceVersion)
        return {
          applied: false,
          sourceVersion: row.sourceVersion,
          status: row.status,
          version: row.version,
        };
      if (row.status !== 'REQUESTED')
        throw new AppError(
          'SETTLEMENT_TRANSITION_INVALID',
          `Settlement request is already ${row.status}`,
          409,
        );
      if (input.status === 'ACCEPTED' && !input.billingReference?.trim())
        throw new AppError(
          'SETTLEMENT_BILLING_REFERENCE_REQUIRED',
          'Accepted settlement requires billing reference',
          400,
        );
      if (input.status === 'REJECTED' && !input.rejectionReason?.trim())
        throw new AppError(
          'SETTLEMENT_REJECTION_REASON_REQUIRED',
          'Rejected settlement requires reason',
          400,
        );
      const changed = await tx.settlementRequest.update({
        data: {
          billingReference:
            input.billingReference?.trim() ?? row.billingReference,
          rejectionReason: input.rejectionReason?.trim() ?? row.rejectionReason,
          sourceVersion: input.sourceVersion,
          status: input.status,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        'SettlementRequest',
        changed.version,
        'settlement.status-projected.v1',
        context,
        metadata,
        {
          billingReference: changed.billingReference,
          orderId: row.businessOrderId,
          requestId: id,
          status: changed.status,
        },
      );
      return {
        applied: true,
        sourceVersion: changed.sourceVersion,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async batch(
    input: BatchOrderCommandInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      !input.members.length ||
      input.members.length > 200 ||
      new Set(input.members.map((x) => x.orderId)).size !== input.members.length
    )
      throw new AppError(
        'ORDER_BATCH_INPUT_INVALID',
        'Batch requires 1-200 unique orders',
        400,
      );
    const permission = {
      HOLD: 'oms.order.hold',
      RELEASE: 'oms.order.release',
      REVIEW: 'oms.order.review',
    }[input.action];
    const batch = await this.prisma.batchCommandResult.create({
      data: {
        action: input.action,
        createdBy: context.accountId,
        requestedCount: input.members.length,
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
    const items: unknown[] = [];
    let succeeded = 0;
    for (const member of input.members) {
      let result: unknown,
        errorCode: string | null = null,
        errorMessage: string | null = null;
      try {
        this.uuid(member.orderId, 'ORDER_NOT_FOUND');
        const decision = await this.permissions.decideOrder(
          permission,
          member.orderId,
          context,
          metadata.correlationId,
        );
        if (!decision.allowed)
          throw new AppError(
            'AUTH_PERMISSION_DENIED',
            'Permission denied for order',
            403,
          );
        result =
          input.action === 'HOLD'
            ? await this.governance.hold(
                member.orderId,
                {
                  expectedVersion: member.expectedVersion,
                  holdType: 'OPERATIONS',
                  reason: input.reason?.trim() ?? 'BATCH_HOLD',
                },
                context,
                {
                  ...metadata,
                  correlationId: `${metadata.correlationId}:${member.orderId}`,
                },
              )
            : input.action === 'REVIEW'
              ? await this.governance.review(
                  member.orderId,
                  {
                    autoApproveLimit: '0',
                    expectedVersion: member.expectedVersion,
                  },
                  context,
                  {
                    ...metadata,
                    correlationId: `${metadata.correlationId}:${member.orderId}`,
                  },
                )
              : await this.fulfillment.release(
                  member.orderId,
                  {
                    calendarCode: input.calendarCode ?? '',
                    expectedVersion: member.expectedVersion,
                    mode: 'DIRECT',
                  },
                  context,
                  {
                    ...metadata,
                    correlationId: `${metadata.correlationId}:${member.orderId}`,
                  },
                );
        succeeded++;
      } catch (error) {
        errorCode =
          error instanceof AppError ? error.code : 'ORDER_BATCH_ITEM_FAILED';
        errorMessage =
          error instanceof Error ? error.message : 'Batch item failed';
        result = {};
      }
      await this.prisma.batchCommandItem.create({
        data: {
          batchCommandResultId: batch.id,
          businessOrderId: member.orderId,
          createdBy: context.accountId,
          errorCode,
          errorMessage,
          resultSnapshot: json(result),
          succeeded: !errorCode,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      items.push({
        businessOrderId: member.orderId,
        errorCode,
        errorMessage,
        result,
        succeeded: !errorCode,
      });
    }
    const failed = input.members.length - succeeded,
      status =
        succeeded === input.members.length
          ? 'COMPLETED'
          : succeeded === 0
            ? 'FAILED'
            : 'PARTIAL';
    const changed = await this.prisma.batchCommandResult.update({
      data: {
        failedCount: failed,
        status,
        succeededCount: succeeded,
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: { id: batch.id },
    });
    return {
      batchId: batch.id,
      failedCount: failed,
      items,
      processedCount: succeeded,
      status: changed.status,
      version: changed.version,
    };
  }

  async portalView(
    orderId: string,
    input: PortalPartnerInput,
    context: TenantContext,
  ) {
    this.uuid(input.partnerId, 'ORDER_PARTNER_SCOPE_DENIED');
    const order = await this.order(orderId, context);
    if (order.customerId !== input.partnerId)
      throw new AppError(
        'ORDER_PARTNER_SCOPE_DENIED',
        'Customer cannot view this order',
        403,
      );
    const [
      lines,
      promises,
      allocations,
      fulfillments,
      shipments,
      timeline,
      settlements,
      rmas,
      progress,
    ] = await Promise.all([
      this.prisma.businessOrderLine.findMany({
        orderBy: { lineNo: 'asc' },
        where: { orderId, status: 'ACTIVE', tenantId: context.tenantId },
      }),
      this.prisma.availabilityPromise.findMany({
        where: { ownerId: input.partnerId, tenantId: context.tenantId },
      }),
      this.prisma.orderAllocation.findMany({
        where: { businessOrderId: orderId, tenantId: context.tenantId },
      }),
      this.prisma.fulfillmentOrder.findMany({
        where: { businessOrderId: orderId, tenantId: context.tenantId },
      }),
      this.prisma.shipmentRequest.findMany({
        where: { businessOrderId: orderId, tenantId: context.tenantId },
      }),
      this.prisma.orderTimelineProjection.findMany({
        orderBy: { occurredAt: 'asc' },
        where: { businessOrderId: orderId, tenantId: context.tenantId },
      }),
      this.prisma.settlementRequest.findMany({
        where: { businessOrderId: orderId, tenantId: context.tenantId },
      }),
      this.prisma.returnMerchandiseAuthorization.findMany({
        where: {
          businessOrderId: orderId,
          partnerId: input.partnerId,
          tenantId: context.tenantId,
        },
      }),
      this.prisma.orderLineProgress.findMany({
        where: { businessOrderId: orderId, tenantId: context.tenantId },
      }),
    ]);
    return {
      allocations,
      availabilityPromises: promises,
      fulfillments,
      lines,
      order,
      progress,
      rmas,
      settlements,
      shipments,
      timeline,
    };
  }

  async portalChange(
    orderId: string,
    partnerId: string,
    input: CreateOrderChangeInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    await this.assertPartner(orderId, partnerId, context);
    return this.reverse.createChange(orderId, input, context, metadata);
  }
  async portalCancel(
    orderId: string,
    partnerId: string,
    input: { expectedVersion: number; reason: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    await this.assertPartner(orderId, partnerId, context);
    return this.reverse.cancel(orderId, input, context, metadata);
  }
  async portalRma(
    orderId: string,
    input: CreateRmaInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    await this.assertPartner(orderId, input.partnerId, context);
    return this.reverse.createRma(orderId, input, context, metadata);
  }

  private async assertPartner(
    orderId: string,
    partnerId: string,
    context: TenantContext,
  ) {
    this.uuid(partnerId, 'ORDER_PARTNER_SCOPE_DENIED');
    const order = await this.order(orderId, context);
    if (order.customerId !== partnerId)
      throw new AppError(
        'ORDER_PARTNER_SCOPE_DENIED',
        'Customer cannot access this order',
        403,
      );
  }
  private async order(id: string, context: TenantContext) {
    this.uuid(id, 'ORDER_NOT_FOUND');
    const row = await this.prisma.businessOrder.findFirst({
      where: { id, tenantId: context.tenantId },
    });
    if (!row) throw new AppError('ORDER_NOT_FOUND', 'Order was not found', 404);
    return row;
  }
  private uuid(id: string, code: string) {
    if (!isUuid(id)) throw new AppError(code, 'Resource was not found', 404);
  }
  private conflict() {
    return new AppError(
      'ORDER_VERSION_CONFLICT',
      'Resource changed; refresh and retry',
      409,
      { retryable: true },
    );
  }
  private async upsertException(
    tx: Prisma.TransactionClient,
    input: {
      description: string;
      domain: string;
      key: string;
      orderId: string;
      ref: string;
      severity: OrderExceptionSeverity;
      type: string;
    },
    context: TenantContext,
  ) {
    return tx.orderExceptionCase.upsert({
      create: {
        businessOrderId: input.orderId,
        createdBy: context.accountId,
        dedupeKey: input.key,
        description: input.description,
        exceptionType: input.type,
        responsibleDomain: input.domain,
        severity: input.severity,
        sourceRef: input.ref,
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
      update: {
        severity: input.severity,
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: {
        tenantId_dedupeKey: {
          dedupeKey: input.key,
          tenantId: context.tenantId,
        },
      },
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

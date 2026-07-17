import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type ControlAlertCaseStatus,
  type ControlAlertSeverity,
  type ControlSlaClockStatus,
  type ControlSlaMilestone,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { CalendarReleaseFacade } from '../mdm/public/calendar-release.facade';
import { businessNumber } from '../platform/public/numbering.facade';
import type { BusinessEventInput } from '../platform/event.service';
import { EventConsumptionFacade } from '../platform/public/event-consumption.facade';
import type { CommandMetadata } from '../platform/tenant.service';

type JsonObject = Record<string, unknown>;
type MetricOperator = 'EQ' | 'GTE' | 'GT' | 'LTE' | 'LT' | 'NE';

export interface StartControlSlaInput {
  readonly businessRef: string;
  readonly calendarCode: string;
  readonly customerRef?: string;
  readonly durationMinutes: number;
  readonly milestone: ControlSlaMilestone;
  readonly organizationRef?: string;
  readonly responsibleDomain: string;
  readonly sourceVersion: number;
  readonly startedAt?: string;
  readonly warningLeadMinutes: number;
}

export interface TransitionControlSlaInput {
  readonly expectedVersion: number;
  readonly reason?: string;
  readonly sourceVersion: number;
  readonly targetStatus: 'ACTIVE' | 'CANCELLED' | 'COMPLETED' | 'PAUSED';
}

export interface PublishAlertRuleInput {
  readonly channels: readonly string[];
  readonly code: string;
  readonly condition: {
    readonly attributes?: Readonly<Record<string, boolean | number | string>>;
    readonly eventTypes?: readonly string[];
    readonly metrics?: readonly {
      readonly field: string;
      readonly operator: MetricOperator;
      readonly value: string;
    }[];
    readonly minimumDurationSeconds?: number;
    readonly statuses?: readonly string[];
  };
  readonly customerRef?: string;
  readonly debounceSeconds: number;
  readonly dueMinutes: number;
  readonly escalationMinutes: number;
  readonly mergeWindowSeconds: number;
  readonly name: string;
  readonly organizationRef?: string;
  readonly ownerRef?: string;
  readonly responsibleDomain: string;
  readonly severity: ControlAlertSeverity;
  readonly shiftCode?: string;
  readonly supervisorRef?: string;
  readonly suppressionSeconds: number;
}

export interface AlertCaseActionInput {
  readonly action: 'ACKNOWLEDGE' | 'CLOSE' | 'REOPEN' | 'RESOLVE' | 'START';
  readonly expectedVersion: number;
  readonly improvement?: Readonly<Record<string, unknown>>;
  readonly reason?: string;
  readonly resolution?: string;
  readonly responsibleParty?: string;
  readonly rootCauseCode?: string;
  readonly solution?: string;
  readonly verification?: Readonly<Record<string, unknown>>;
  readonly verified?: boolean;
}

const object = (value: unknown): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;

@Injectable()
export class AlertGovernanceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CalendarReleaseFacade)
    private readonly calendars: CalendarReleaseFacade,
    @Inject(EventConsumptionFacade)
    private readonly events: EventConsumptionFacade,
  ) {}

  async startSla(
    input: StartControlSlaInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.assertSlaInput(input);
    const startedAt = this.date(input.startedAt ?? new Date(), 'startedAt');
    const deadline = await this.calendars.computeSlaDeadline(
      this.text(input.calendarCode, 'calendarCode', 100).toUpperCase(),
      startedAt,
      input.durationMinutes,
      input.warningLeadMinutes,
      context,
    );
    return this.prisma.$transaction(async (tx) => {
      await this.lock(
        tx,
        `${context.tenantId}:sla:${input.businessRef}:${input.milestone}`,
      );
      const existing = await tx.controlSlaClock.findUnique({
        where: {
          tenantId_businessRef_milestone: {
            businessRef: input.businessRef,
            milestone: input.milestone,
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
        ['BREACHED', 'CANCELLED', 'COMPLETED'].includes(existing.status)
      )
        throw new AppError(
          'CONTROL_SLA_REOPEN_REQUIRED',
          'A terminal SLA clock must be reopened explicitly',
          409,
        );
      const data = {
        calendarCode: input.calendarCode.trim().toUpperCase(),
        calendarSnapshot: json(deadline.calendarSnapshot),
        customerRef: this.optionalText(input.customerRef, 200) ?? null,
        dueAt: deadline.dueAt,
        durationMinutes: input.durationMinutes,
        organizationRef: this.optionalText(input.organizationRef, 200) ?? null,
        responsibleDomain: this.domain(input.responsibleDomain),
        sourceVersion: input.sourceVersion,
        startedAt,
        status: 'ACTIVE' as const,
        updatedBy: context.accountId,
        warningAt: deadline.warningAt,
        warningLeadMinutes: input.warningLeadMinutes,
      };
      const clock = existing
        ? await tx.controlSlaClock.update({
            data: { ...data, version: { increment: 1 } },
            where: { id: existing.id },
          })
        : await tx.controlSlaClock.create({
            data: {
              ...data,
              businessRef: this.text(input.businessRef, 'businessRef', 200),
              createdBy: context.accountId,
              milestone: input.milestone,
              tenantId: context.tenantId,
            },
          });
      await this.slaEvent(
        tx,
        clock,
        existing?.status ?? null,
        'STARTED',
        undefined,
        context,
      );
      await this.record(
        tx,
        clock.id,
        'ControlSlaClock',
        clock.version,
        'control.sla-started.v1',
        { businessRef: clock.businessRef, milestone: clock.milestone },
        context,
        metadata,
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
    input: TransitionControlSlaInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'CONTROL_SLA_NOT_FOUND');
    if (!Number.isInteger(input.sourceVersion) || input.sourceVersion < 1)
      this.invalid('sourceVersion is invalid');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:sla-id:${id}`);
      const row = await tx.controlSlaClock.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!row)
        throw new AppError(
          'CONTROL_SLA_NOT_FOUND',
          'SLA clock was not found',
          404,
        );
      if (row.version !== input.expectedVersion) this.conflict();
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
        (['CANCELLED', 'COMPLETED'].includes(input.targetStatus) &&
          ['ACTIVE', 'BREACHED', 'PAUSED', 'WARNING'].includes(row.status));
      if (!allowed)
        throw new AppError(
          'CONTROL_SLA_TRANSITION_INVALID',
          `SLA transition ${row.status} -> ${input.targetStatus} is not allowed`,
          409,
        );
      if (input.targetStatus === 'PAUSED' && !input.reason?.trim())
        throw new AppError(
          'CONTROL_SLA_PAUSE_REASON_REQUIRED',
          'Pause reason is required',
          400,
        );
      const now = new Date();
      const resumeSeconds =
        input.targetStatus === 'ACTIVE' && row.pausedAt
          ? Math.max(
              0,
              Math.floor((now.getTime() - row.pausedAt.getTime()) / 1000),
            )
          : 0;
      const changed = await tx.controlSlaClock.update({
        data: {
          completedAt:
            input.targetStatus === 'COMPLETED' ? now : row.completedAt,
          dueAt:
            resumeSeconds > 0
              ? new Date(row.dueAt.getTime() + resumeSeconds * 1000)
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
          pausedSeconds: row.pausedSeconds + resumeSeconds,
          sourceVersion: input.sourceVersion,
          status: input.targetStatus,
          updatedBy: context.accountId,
          version: { increment: 1 },
          warningAt:
            resumeSeconds > 0
              ? new Date(row.warningAt.getTime() + resumeSeconds * 1000)
              : row.warningAt,
        },
        where: { id },
      });
      await this.slaEvent(
        tx,
        changed,
        row.status,
        input.targetStatus === 'ACTIVE' ? 'RESUMED' : input.targetStatus,
        input.reason,
        context,
      );
      await this.record(
        tx,
        id,
        'ControlSlaClock',
        changed.version,
        'control.sla-transitioned.v1',
        { from: row.status, to: changed.status },
        context,
        metadata,
      );
      return {
        applied: true,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async reopenSla(
    id: string,
    input: {
      calendarCode: string;
      durationMinutes: number;
      expectedVersion: number;
      reason: string;
      sourceVersion: number;
      warningLeadMinutes: number;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'CONTROL_SLA_NOT_FOUND');
    const startedAt = new Date();
    if (
      !Number.isInteger(input.durationMinutes) ||
      input.durationMinutes < 1 ||
      !Number.isInteger(input.warningLeadMinutes) ||
      input.warningLeadMinutes < 0 ||
      input.warningLeadMinutes > input.durationMinutes ||
      !Number.isInteger(input.sourceVersion) ||
      input.sourceVersion < 1 ||
      !input.reason?.trim()
    )
      this.invalid('SLA reopen input is invalid');
    const deadline = await this.calendars.computeSlaDeadline(
      input.calendarCode,
      startedAt,
      input.durationMinutes,
      input.warningLeadMinutes,
      context,
    );
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:sla-id:${id}`);
      const row = await tx.controlSlaClock.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!row)
        throw new AppError(
          'CONTROL_SLA_NOT_FOUND',
          'SLA clock was not found',
          404,
        );
      if (row.version !== input.expectedVersion) this.conflict();
      if (!['BREACHED', 'CANCELLED', 'COMPLETED'].includes(row.status))
        throw new AppError(
          'CONTROL_SLA_REOPEN_INVALID',
          'Only a terminal or breached SLA clock can be reopened',
          409,
        );
      if (input.sourceVersion <= row.sourceVersion)
        return { applied: false, status: row.status, version: row.version };
      const changed = await tx.controlSlaClock.update({
        data: {
          breachedAt: null,
          calendarCode: input.calendarCode.trim().toUpperCase(),
          calendarSnapshot: json(deadline.calendarSnapshot),
          completedAt: null,
          dueAt: deadline.dueAt,
          durationMinutes: input.durationMinutes,
          pauseReason: null,
          pausedAt: null,
          reopenedCount: { increment: 1 },
          sourceVersion: input.sourceVersion,
          startedAt,
          status: 'ACTIVE',
          updatedBy: context.accountId,
          version: { increment: 1 },
          warningAt: deadline.warningAt,
          warningLeadMinutes: input.warningLeadMinutes,
        },
        where: { id },
      });
      await this.slaEvent(
        tx,
        changed,
        row.status,
        'REOPENED',
        input.reason,
        context,
      );
      await this.record(
        tx,
        id,
        'ControlSlaClock',
        changed.version,
        'control.sla-reopened.v1',
        { from: row.status, reason: input.reason },
        context,
        metadata,
      );
      return {
        applied: true,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async monitorSla(
    input: { limit?: number; now?: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const now = this.date(input.now ?? new Date(), 'now');
    const rows = await this.prisma.controlSlaClock.findMany({
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: Math.min(Math.max(input.limit ?? 200, 1), 500),
      where: {
        status: { in: ['ACTIVE', 'WARNING'] },
        tenantId: context.tenantId,
        warningAt: { lte: now },
      },
    });
    let breached = 0;
    let warned = 0;
    for (const candidate of rows)
      await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, `${context.tenantId}:sla-id:${candidate.id}`);
        const row = await tx.controlSlaClock.findUnique({
          where: { id: candidate.id },
        });
        if (!row || !['ACTIVE', 'WARNING'].includes(row.status)) return;
        if (now >= row.dueAt) {
          const changed = await tx.controlSlaClock.update({
            data: {
              breachedAt: now,
              status: 'BREACHED',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: row.id },
          });
          await this.slaEvent(
            tx,
            changed,
            row.status,
            'BREACHED',
            undefined,
            context,
          );
          await this.openSlaCase(tx, changed, now, context, metadata);
          breached++;
        } else if (row.status === 'ACTIVE') {
          const changed = await tx.controlSlaClock.update({
            data: {
              status: 'WARNING',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: row.id },
          });
          await this.slaEvent(
            tx,
            changed,
            row.status,
            'WARNING',
            undefined,
            context,
          );
          warned++;
        }
      });
    return { breached, warned };
  }

  async publishRule(
    input: PublishAlertRuleInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.assertRuleInput(input);
    const code = this.text(input.code, 'code', 100).toUpperCase();
    const customerRef = this.optionalText(input.customerRef, 200) ?? null;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(
        tx,
        `${context.tenantId}:alert-rule:${code}:${customerRef ?? '*'}`,
      );
      let rule = await tx.controlAlertRule.findFirst({
        where: { code, customerRef, tenantId: context.tenantId },
      });
      const last = rule
        ? await tx.controlAlertRuleVersion.aggregate({
            _max: { versionNumber: true },
            where: { ruleId: rule.id, tenantId: context.tenantId },
          })
        : null;
      const versionNumber = (last?._max.versionNumber ?? 0) + 1;
      if (!rule)
        rule = await tx.controlAlertRule.create({
          data: {
            code,
            createdBy: context.accountId,
            customerRef,
            name: this.text(input.name, 'name', 200),
            status: 'DRAFT',
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      const ruleVersion = await tx.controlAlertRuleVersion.create({
        data: {
          channelSnapshot: json({ channels: this.channels(input.channels) }),
          conditionSnapshot: json(input.condition),
          createdBy: context.accountId,
          debounceSeconds: input.debounceSeconds,
          dueMinutes: input.dueMinutes,
          escalationMinutes: input.escalationMinutes,
          mergeWindowSeconds: input.mergeWindowSeconds,
          organizationRef:
            this.optionalText(input.organizationRef, 200) ?? null,
          ownerRef: this.optionalUuid(input.ownerRef),
          responsibleDomain: this.domain(input.responsibleDomain),
          ruleId: rule.id,
          severity: input.severity,
          shiftCode: this.optionalText(input.shiftCode, 100) ?? null,
          supervisorRef: this.optionalUuid(input.supervisorRef),
          suppressionSeconds: input.suppressionSeconds,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          versionNumber,
        },
      });
      const published = await tx.controlAlertRule.update({
        data: {
          activeVersionNumber: versionNumber,
          name: input.name.trim(),
          status: 'PUBLISHED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: rule.id },
      });
      await this.record(
        tx,
        rule.id,
        'ControlAlertRule',
        published.version,
        'control.alert-rule-published.v1',
        { code, customerRef, ruleVersionId: ruleVersion.id, versionNumber },
        context,
        metadata,
      );
      return {
        code,
        ruleId: rule.id,
        ruleVersionId: ruleVersion.id,
        status: published.status,
        version: published.version,
        versionNumber,
      };
    });
  }

  consumeAlertEvent(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.events.consumeControlAlert(
      event,
      context,
      metadata,
      async (message, tx) => {
        const payload = object(message.payload);
        const alertContext = object(payload.alertContext);
        const businessRef = this.text(
          alertContext.businessRef ??
            payload.businessRef ??
            message.aggregateId,
          'businessRef',
          200,
        );
        const customerRef = this.optionalText(alertContext.customerRef, 200);
        const rules = await tx.controlAlertRule.findMany({
          orderBy: [{ customerRef: 'desc' }, { code: 'asc' }],
          where: {
            OR: customerRef
              ? [{ customerRef }, { customerRef: null }]
              : [{ customerRef: null }],
            status: 'PUBLISHED',
            tenantId: context.tenantId,
          },
        });
        const selected = new Map<string, (typeof rules)[number]>();
        for (const rule of rules) {
          const current = selected.get(rule.code);
          if (!current || rule.customerRef === customerRef)
            selected.set(rule.code, rule);
        }
        const outcomes: JsonObject[] = [];
        for (const rule of selected.values()) {
          const version = await tx.controlAlertRuleVersion.findFirst({
            where: {
              ruleId: rule.id,
              tenantId: context.tenantId,
              versionNumber: rule.activeVersionNumber!,
            },
          });
          if (
            !version ||
            !this.matches(version.conditionSnapshot, message, alertContext)
          )
            continue;
          outcomes.push(
            await this.processSignal(
              tx,
              rule.code,
              version,
              message,
              alertContext,
              businessRef,
              customerRef,
              context,
              metadata,
            ),
          );
        }
        return { businessRef, matchedRules: outcomes.length, outcomes };
      },
    );
  }

  async assignCase(
    id: string,
    input: { expectedVersion: number; ownerRef: string; reason: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'CONTROL_ALERT_CASE_NOT_FOUND');
    this.uuid(input.ownerRef, 'CONTROL_ALERT_OWNER_INVALID');
    const reason = this.text(input.reason, 'reason', 500);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:alert-case:${id}`);
      const row = await this.case(tx, id, context);
      if (row.version !== input.expectedVersion) this.conflict();
      if (row.status === 'CLOSED') this.caseTransition(row.status, 'ASSIGN');
      const changed = await tx.controlAlertCase.update({
        data: {
          ownerRef: input.ownerRef,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await tx.controlAlertAssignmentHistory.create({
        data: {
          alertCaseId: id,
          createdBy: context.accountId,
          fromOwnerRef: row.ownerRef,
          reason,
          routeSnapshot: json({
            customerRef: row.customerRef,
            organizationRef: row.organizationRef,
            severity: row.severity,
            shiftCode: row.shiftCode,
            sourceDomain: row.sourceDomain,
          }),
          tenantId: context.tenantId,
          toOwnerRef: input.ownerRef,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        id,
        'ControlAlertCase',
        changed.version,
        'control.alert-assigned.v1',
        { fromOwnerRef: row.ownerRef, reason, toOwnerRef: input.ownerRef },
        context,
        metadata,
      );
      return {
        caseId: id,
        ownerRef: changed.ownerRef,
        version: changed.version,
      };
    });
  }

  async actionCase(
    id: string,
    input: AlertCaseActionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'CONTROL_ALERT_CASE_NOT_FOUND');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:alert-case:${id}`);
      const row = await this.case(tx, id, context);
      if (row.version !== input.expectedVersion) this.conflict();
      const target = this.caseTarget(row.status, input.action);
      if (
        input.action === 'RESOLVE' &&
        (!input.resolution?.trim() || !input.verified)
      )
        throw new AppError(
          'CONTROL_ALERT_RESOLUTION_REQUIRED',
          'A verified resolution is required before resolving the case',
          400,
        );
      if (
        input.action === 'CLOSE' &&
        (!input.rootCauseCode?.trim() ||
          !input.responsibleParty?.trim() ||
          !input.solution?.trim() ||
          !input.verification ||
          Object.keys(input.verification).length === 0)
      )
        throw new AppError(
          'CONTROL_ALERT_ROOT_CAUSE_REQUIRED',
          'Root cause, responsibility, solution and verification are required',
          400,
        );
      const now = new Date();
      const changed = await tx.controlAlertCase.update({
        data: {
          acknowledgedAt:
            input.action === 'ACKNOWLEDGE' ? now : row.acknowledgedAt,
          closedAt: input.action === 'CLOSE' ? now : null,
          resolution:
            input.action === 'RESOLVE'
              ? input.resolution!.trim()
              : input.action === 'REOPEN'
                ? null
                : row.resolution,
          resolutionVerified:
            input.action === 'RESOLVE'
              ? true
              : input.action === 'REOPEN'
                ? false
                : row.resolutionVerified,
          resolvedAt:
            input.action === 'RESOLVE'
              ? now
              : input.action === 'REOPEN'
                ? null
                : row.resolvedAt,
          status: target,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      if (input.action === 'CLOSE')
        await tx.controlRootCauseRecord.create({
          data: {
            alertCaseId: id,
            closedAt: now,
            closureVersion: changed.version,
            createdBy: context.accountId,
            improvementSnapshot: json(input.improvement),
            responsibleParty: input.responsibleParty!.trim(),
            rootCauseCode: input.rootCauseCode!.trim().toUpperCase(),
            solution: input.solution!.trim(),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            verificationSnapshot: json(input.verification),
          },
        });
      await this.record(
        tx,
        id,
        'ControlAlertCase',
        changed.version,
        `control.alert-${input.action.toLowerCase()}.v1`,
        { from: row.status, reason: input.reason ?? null, to: target },
        context,
        metadata,
      );
      return { caseId: id, status: changed.status, version: changed.version };
    });
  }

  async requestRemediation(
    id: string,
    input: {
      command: Readonly<Record<string, unknown>>;
      commandType: string;
      reason: string;
      targetDomain: string;
      targetRef: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'CONTROL_ALERT_CASE_NOT_FOUND');
    const targetDomain = this.domain(input.targetDomain);
    if (!['AMS', 'BILLING', 'OMS', 'TMS', 'WMS'].includes(targetDomain))
      this.invalid('targetDomain is invalid');
    const commandType = this.text(input.commandType, 'commandType', 150);
    if (!/^[a-z][a-z0-9.-]+\.v\d+$/.test(commandType))
      this.invalid('commandType is invalid');
    return this.prisma.$transaction(async (tx) => {
      const row = await this.case(tx, id, context);
      if (row.status === 'CLOSED') this.caseTransition(row.status, 'REMEDIATE');
      const request = await tx.controlRemediationRequest.create({
        data: {
          alertCaseId: id,
          commandSnapshot: json(input.command),
          commandType,
          createdBy: context.accountId,
          reason: this.text(input.reason, 'reason', 500),
          targetDomain,
          targetRef: this.text(input.targetRef, 'targetRef', 200),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        request.id,
        'ControlRemediationRequest',
        request.version,
        'control.remediation-requested.v1',
        {
          alertCaseId: id,
          command: input.command,
          commandType,
          targetDomain,
          targetRef: input.targetRef,
        },
        context,
        metadata,
      );
      return {
        alertCaseId: id,
        requestId: request.id,
        status: request.status,
      };
    });
  }

  async monitorEscalations(
    input: { limit?: number; now?: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const now = this.date(input.now ?? new Date(), 'now');
    const rows = await this.prisma.controlAlertCase.findMany({
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: Math.min(Math.max(input.limit ?? 200, 1), 500),
      where: {
        dueAt: { lte: now },
        status: { in: ['ACKNOWLEDGED', 'IN_PROGRESS', 'OPEN'] },
        tenantId: context.tenantId,
      },
    });
    let escalated = 0;
    for (const candidate of rows)
      await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, `${context.tenantId}:alert-case:${candidate.id}`);
        const row = await tx.controlAlertCase.findUnique({
          where: { id: candidate.id },
        });
        if (
          !row ||
          !['ACKNOWLEDGED', 'IN_PROGRESS', 'OPEN'].includes(row.status)
        )
          return;
        const ruleVersion = row.ruleVersionId
          ? await tx.controlAlertRuleVersion.findUnique({
              where: { id: row.ruleVersionId },
            })
          : null;
        const interval = (ruleVersion?.escalationMinutes ?? 60) * 60_000;
        const desired =
          Math.floor(
            Math.max(0, now.getTime() - row.dueAt.getTime()) / interval,
          ) + 1;
        if (desired <= row.escalationLevel) return;
        const toLevel = row.escalationLevel + 1;
        const changed = await tx.controlAlertCase.update({
          data: {
            escalationLevel: toLevel,
            ownerRef: row.supervisorRef ?? row.ownerRef,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: row.id },
        });
        await tx.controlEscalationEvent.create({
          data: {
            alertCaseId: row.id,
            createdBy: context.accountId,
            fromLevel: row.escalationLevel,
            reason: row.status === 'OPEN' ? 'UNACKNOWLEDGED' : 'UNRESOLVED',
            tenantId: context.tenantId,
            toLevel,
            updatedBy: context.accountId,
          },
        });
        await this.notification(
          tx,
          changed,
          toLevel,
          ruleVersion
            ? strings(object(ruleVersion.channelSnapshot).channels)
            : ['IN_APP'],
          context,
          metadata,
        );
        escalated++;
      });
    return { escalated };
  }

  async publishKnowledge(
    input: {
      articleCode: string;
      content: Readonly<Record<string, unknown>>;
      recommendations: Readonly<Record<string, unknown>>;
      rootCauseCode: string;
      sourceCaseIds: readonly string[];
      title: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const articleCode = this.text(
      input.articleCode,
      'articleCode',
      100,
    ).toUpperCase();
    const rootCauseCode = this.text(
      input.rootCauseCode,
      'rootCauseCode',
      100,
    ).toUpperCase();
    if (
      input.sourceCaseIds.length === 0 ||
      input.sourceCaseIds.some((id) => !isUuid(id))
    )
      this.invalid('sourceCaseIds are invalid');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:knowledge:${articleCode}`);
      const sources = await tx.controlRootCauseRecord.findMany({
        where: {
          alertCaseId: { in: [...new Set(input.sourceCaseIds)] },
          rootCauseCode,
          tenantId: context.tenantId,
        },
      });
      if (
        new Set(sources.map(({ alertCaseId }) => alertCaseId)).size !==
        new Set(input.sourceCaseIds).size
      )
        throw new AppError(
          'CONTROL_KNOWLEDGE_SOURCE_INVALID',
          'Every source case must have a matching closed root cause',
          409,
        );
      const latest = await tx.controlKnowledgeArticle.aggregate({
        _max: { versionNumber: true },
        where: { articleCode, tenantId: context.tenantId },
      });
      const versionNumber = (latest._max.versionNumber ?? 0) + 1;
      const article = await tx.controlKnowledgeArticle.create({
        data: {
          articleCode,
          contentSnapshot: json(input.content),
          createdBy: context.accountId,
          recommendationSnapshot: json(input.recommendations),
          rootCauseCode,
          sourceCaseRefs: json(input.sourceCaseIds),
          tenantId: context.tenantId,
          title: this.text(input.title, 'title', 300),
          updatedBy: context.accountId,
          versionNumber,
        },
      });
      await this.record(
        tx,
        article.id,
        'ControlKnowledgeArticle',
        article.version,
        'control.knowledge-published.v1',
        { articleCode, rootCauseCode, versionNumber },
        context,
        metadata,
      );
      return {
        articleId: article.id,
        articleCode,
        versionNumber,
      };
    });
  }

  async workbench(context: TenantContext, query?: string) {
    const tenantId = context.tenantId;
    const normalized = query?.trim();
    const [
      clocks,
      rules,
      cases,
      assignments,
      notifications,
      escalations,
      remediations,
      rootCauses,
      knowledge,
    ] = await Promise.all([
      this.prisma.controlSlaClock.findMany({
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        take: 500,
        where: { tenantId },
      }),
      this.prisma.controlAlertRule.findMany({
        orderBy: [{ code: 'asc' }, { customerRef: 'asc' }],
        take: 500,
        where: { tenantId },
      }),
      this.prisma.controlAlertCase.findMany({
        orderBy: [{ severity: 'desc' }, { dueAt: 'asc' }, { id: 'asc' }],
        take: 1000,
        where: {
          ...(normalized
            ? {
                OR: [
                  {
                    businessRef: {
                      contains: normalized,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    caseNo: {
                      contains: normalized,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    title: {
                      contains: normalized,
                      mode: 'insensitive' as const,
                    },
                  },
                ],
              }
            : {}),
          tenantId,
        },
      }),
      this.prisma.controlAlertAssignmentHistory.findMany({
        orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
        take: 1000,
        where: { tenantId },
      }),
      this.prisma.controlAlertNotification.findMany({
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        take: 1000,
        where: { tenantId },
      }),
      this.prisma.controlEscalationEvent.findMany({
        orderBy: [{ escalatedAt: 'desc' }, { id: 'desc' }],
        take: 1000,
        where: { tenantId },
      }),
      this.prisma.controlRemediationRequest.findMany({
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        take: 1000,
        where: { tenantId },
      }),
      this.prisma.controlRootCauseRecord.findMany({
        orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
        take: 1000,
        where: { tenantId },
      }),
      this.prisma.controlKnowledgeArticle.findMany({
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        take: 500,
        where: {
          ...(normalized
            ? {
                OR: [
                  {
                    articleCode: {
                      contains: normalized,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    rootCauseCode: {
                      contains: normalized,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    title: {
                      contains: normalized,
                      mode: 'insensitive' as const,
                    },
                  },
                ],
              }
            : {}),
          tenantId,
        },
      }),
    ]);
    return toHttpJson({
      assignments,
      cases,
      clocks,
      escalations,
      knowledge,
      notifications,
      refreshedAt: new Date(),
      remediations,
      rootCauses,
      rules,
    });
  }

  private async processSignal(
    tx: Prisma.TransactionClient,
    ruleCode: string,
    version: {
      channelSnapshot: Prisma.JsonValue;
      debounceSeconds: number;
      dueMinutes: number;
      id: string;
      mergeWindowSeconds: number;
      organizationRef: string | null;
      ownerRef: string | null;
      responsibleDomain: string;
      severity: ControlAlertSeverity;
      shiftCode: string | null;
      supervisorRef: string | null;
      suppressionSeconds: number;
    },
    event: BusinessEventInput,
    alertContext: JsonObject,
    businessRef: string,
    customerRef: string | undefined,
    context: TenantContext,
    metadata: CommandMetadata,
  ): Promise<JsonObject> {
    const dedupeKey = this.text(
      alertContext.dedupeKey ?? `${ruleCode}:${businessRef}`,
      'dedupeKey',
      300,
    );
    await this.lock(
      tx,
      `${context.tenantId}:alert-signal:${version.id}:${dedupeKey}`,
    );
    const observedAt = this.date(event.occurredAt, 'occurredAt');
    let signal = await tx.controlAlertSignal.findUnique({
      where: {
        tenantId_ruleVersionId_dedupeKey: {
          dedupeKey,
          ruleVersionId: version.id,
          tenantId: context.tenantId,
        },
      },
    });
    if (!signal)
      signal = await tx.controlAlertSignal.create({
        data: {
          createdBy: context.accountId,
          dedupeKey,
          firstObservedAt: observedAt,
          lastObservedAt: observedAt,
          ruleVersionId: version.id,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
    else
      signal = await tx.controlAlertSignal.update({
        data: {
          lastObservedAt:
            observedAt > signal.lastObservedAt
              ? observedAt
              : signal.lastObservedAt,
          occurrenceCount: { increment: 1 },
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: signal.id },
      });
    const sinceFirstObserved =
      observedAt.getTime() - signal.firstObservedAt.getTime();
    if (
      version.debounceSeconds > 0 &&
      sinceFirstObserved >= 0 &&
      sinceFirstObserved < version.debounceSeconds * 1000
    )
      return { outcome: 'DEBOUNCED', ruleCode };
    const sinceLastAlert = signal.lastAlertAt
      ? observedAt.getTime() - signal.lastAlertAt.getTime()
      : undefined;
    if (
      version.suppressionSeconds > 0 &&
      sinceLastAlert !== undefined &&
      sinceLastAlert >= 0 &&
      sinceLastAlert < version.suppressionSeconds * 1000
    )
      return { outcome: 'SUPPRESSED', ruleCode };
    const mergeAfter = new Date(
      observedAt.getTime() - version.mergeWindowSeconds * 1000,
    );
    const merge = await tx.controlAlertCase.findFirst({
      orderBy: [{ lastTriggeredAt: 'desc' }, { id: 'desc' }],
      where: {
        dedupeKey,
        lastTriggeredAt: { gte: mergeAfter },
        ruleVersionId: version.id,
        status: { in: ['ACKNOWLEDGED', 'IN_PROGRESS', 'OPEN'] },
        tenantId: context.tenantId,
      },
    });
    if (merge) {
      const changed = await tx.controlAlertCase.update({
        data: {
          lastTriggeredAt:
            observedAt > merge.lastTriggeredAt
              ? observedAt
              : merge.lastTriggeredAt,
          sourceSnapshot: json({ event, mergedFrom: merge.sourceSnapshot }),
          triggerCount: { increment: 1 },
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: merge.id },
      });
      await tx.controlAlertSignal.update({
        data: {
          lastAlertAt:
            !signal.lastAlertAt || observedAt > signal.lastAlertAt
              ? observedAt
              : signal.lastAlertAt,
          lastCaseId: merge.id,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: signal.id },
      });
      await this.record(
        tx,
        merge.id,
        'ControlAlertCase',
        changed.version,
        'alert.merged.v1',
        {
          dedupeKey,
          eventId: event.eventId,
          triggerCount: changed.triggerCount,
        },
        context,
        metadata,
      );
      return { caseId: merge.id, outcome: 'MERGED', ruleCode };
    }
    const now = observedAt;
    const created = await tx.controlAlertCase.create({
      data: {
        businessRef,
        caseNo: await businessNumber(
          this.prisma,
          'CONTROL_ALERT_CASE',
          context,
          metadata,
          `control-alert:${ruleCode}:${dedupeKey}`,
        ),
        createdBy: context.accountId,
        customerRef: customerRef ?? null,
        dedupeKey,
        description:
          this.optionalText(alertContext.description, 1000) ??
          `${event.eventType} matched ${ruleCode}`,
        dueAt: new Date(now.getTime() + version.dueMinutes * 60_000),
        lastTriggeredAt: now,
        organizationRef:
          this.optionalText(alertContext.organizationRef, 200) ??
          version.organizationRef,
        ownerRef: version.ownerRef,
        responsibleDomain: version.responsibleDomain,
        ruleVersionId: version.id,
        severity: version.severity,
        shiftCode: version.shiftCode,
        sourceDomain: event.eventType.split('.')[0]!.toUpperCase(),
        sourceSnapshot: json({ event, ruleCode }),
        supervisorRef: version.supervisorRef,
        tenantId: context.tenantId,
        title:
          this.optionalText(alertContext.title, 300) ??
          `${ruleCode} · ${businessRef}`,
        updatedBy: context.accountId,
      },
    });
    await tx.controlAlertAssignmentHistory.create({
      data: {
        alertCaseId: created.id,
        createdBy: context.accountId,
        reason: 'RULE_ROUTE',
        routeSnapshot: json({
          customerRef,
          organizationRef: created.organizationRef,
          severity: created.severity,
          shiftCode: created.shiftCode,
          sourceDomain: created.sourceDomain,
        }),
        tenantId: context.tenantId,
        toOwnerRef: created.ownerRef,
        updatedBy: context.accountId,
      },
    });
    await tx.controlAlertSignal.update({
      data: {
        lastAlertAt: now,
        lastCaseId: created.id,
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: { id: signal.id },
    });
    await this.record(
      tx,
      created.id,
      'ControlAlertCase',
      created.version,
      'alert.opened.v1',
      {
        alertCaseId: created.id,
        businessRef,
        dueAt: created.dueAt.toISOString(),
        owner: created.ownerRef,
        severity: created.severity,
      },
      context,
      metadata,
    );
    await this.notification(
      tx,
      created,
      0,
      strings(object(version.channelSnapshot).channels),
      context,
      metadata,
    );
    return { caseId: created.id, outcome: 'OPENED', ruleCode };
  }

  private matches(
    raw: Prisma.JsonValue,
    event: BusinessEventInput,
    alertContext: JsonObject,
  ) {
    const condition = object(raw);
    const eventTypes = strings(condition.eventTypes);
    if (eventTypes.length > 0 && !eventTypes.includes(event.eventType))
      return false;
    const statuses = strings(condition.statuses);
    if (
      statuses.length > 0 &&
      !statuses.includes(String(alertContext.status ?? '').toUpperCase())
    )
      return false;
    const minimum = Number(condition.minimumDurationSeconds ?? 0);
    if (Number(alertContext.durationSeconds ?? 0) < minimum) return false;
    const expectedAttributes = object(condition.attributes);
    const actualAttributes = object(alertContext.attributes);
    if (
      Object.entries(expectedAttributes).some(
        ([key, value]) => actualAttributes[key] !== value,
      )
    )
      return false;
    const actualMetrics = object(alertContext.metrics);
    const metrics = Array.isArray(condition.metrics) ? condition.metrics : [];
    return metrics.every((rawMetric) => {
      const metric = object(rawMetric);
      const left = new Prisma.Decimal(
        String(actualMetrics[String(metric.field)] ?? 'NaN'),
      );
      const right = new Prisma.Decimal(String(metric.value ?? 'NaN'));
      const operator = String(metric.operator) as MetricOperator;
      if (!left.isFinite() || !right.isFinite()) return false;
      if (operator === 'EQ') return left.eq(right);
      if (operator === 'NE') return !left.eq(right);
      if (operator === 'GT') return left.gt(right);
      if (operator === 'GTE') return left.gte(right);
      if (operator === 'LT') return left.lt(right);
      if (operator === 'LTE') return left.lte(right);
      return false;
    });
  }

  private async openSlaCase(
    tx: Prisma.TransactionClient,
    clock: {
      businessRef: string;
      customerRef: string | null;
      id: string;
      milestone: ControlSlaMilestone;
      organizationRef: string | null;
      responsibleDomain: string;
    },
    now: Date,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const dedupeKey = `SLA:${clock.id}`;
    const existing = await tx.controlAlertCase.findFirst({
      where: {
        dedupeKey,
        status: { in: ['ACKNOWLEDGED', 'IN_PROGRESS', 'OPEN'] },
        tenantId: context.tenantId,
      },
    });
    if (existing) return existing;
    const alert = await tx.controlAlertCase.create({
      data: {
        businessRef: clock.businessRef,
        caseNo: await businessNumber(
          this.prisma,
          'CONTROL_ALERT_CASE',
          context,
          metadata,
          `control-alert:${dedupeKey}`,
        ),
        createdBy: context.accountId,
        customerRef: clock.customerRef,
        dedupeKey,
        description: `${clock.milestone} SLA breached`,
        dueAt: new Date(now.getTime() + 60 * 60_000),
        lastTriggeredAt: now,
        organizationRef: clock.organizationRef,
        responsibleDomain: clock.responsibleDomain,
        severity: 'HIGH',
        slaClockId: clock.id,
        sourceDomain: clock.responsibleDomain,
        sourceSnapshot: json({ clockId: clock.id, milestone: clock.milestone }),
        tenantId: context.tenantId,
        title: `${clock.milestone} SLA 超时`,
        updatedBy: context.accountId,
      },
    });
    await tx.controlAlertAssignmentHistory.create({
      data: {
        alertCaseId: alert.id,
        createdBy: context.accountId,
        reason: 'SLA_RESPONSIBILITY_ROUTE',
        routeSnapshot: json({ responsibleDomain: clock.responsibleDomain }),
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
    await this.record(
      tx,
      alert.id,
      'ControlAlertCase',
      alert.version,
      'alert.opened.v1',
      {
        alertCaseId: alert.id,
        businessRef: alert.businessRef,
        dueAt: alert.dueAt.toISOString(),
        owner: null,
        severity: alert.severity,
      },
      context,
      metadata,
    );
    await this.notification(tx, alert, 0, ['IN_APP'], context, metadata);
    return alert;
  }

  private async notification(
    tx: Prisma.TransactionClient,
    alert: {
      businessRef: string;
      id: string;
      ownerRef: string | null;
      severity: ControlAlertSeverity;
      supervisorRef: string | null;
      title: string;
      version: number;
    },
    level: number,
    channels: readonly string[],
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const recipientRef =
      level > 0 ? (alert.supervisorRef ?? alert.ownerRef) : alert.ownerRef;
    const requested = await tx.controlAlertNotification.create({
      data: {
        alertCaseId: alert.id,
        channelSnapshot: json({
          channels: channels.length > 0 ? channels : ['IN_APP'],
        }),
        createdBy: context.accountId,
        escalationLevel: level,
        recipientRef,
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
    await tx.platformOutbox.create({
      data: {
        aggregateId: alert.id,
        aggregateType: 'ControlAlertCase',
        aggregateVersion: alert.version,
        correlationId: metadata.correlationId,
        createdBy: context.accountId,
        eventName: 'notification.requested.v1',
        partitionKey: alert.id,
        payload: {
          alertCaseId: alert.id,
          businessRef: alert.businessRef,
          channels: channels.length > 0 ? channels : ['IN_APP'],
          escalationLevel: level,
          notificationRequestId: requested.id,
          recipientRef,
          severity: alert.severity,
          tenantId: context.tenantId,
          title: alert.title,
        },
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
  }

  private async slaEvent(
    tx: Prisma.TransactionClient,
    clock: {
      dueAt: Date;
      id: string;
      sourceVersion: number;
      status: ControlSlaClockStatus;
      version: number;
      warningAt: Date;
    },
    fromStatus: ControlSlaClockStatus | null,
    eventType: string,
    reason: string | undefined,
    context: TenantContext,
  ) {
    await tx.controlSlaEvent.create({
      data: {
        createdBy: context.accountId,
        eventType,
        fromStatus,
        reason: this.optionalText(reason, 500) ?? null,
        slaClockId: clock.id,
        snapshot: json({
          dueAt: clock.dueAt,
          version: clock.version,
          warningAt: clock.warningAt,
        }),
        sourceVersion: clock.sourceVersion,
        tenantId: context.tenantId,
        toStatus: clock.status,
        updatedBy: context.accountId,
      },
    });
  }

  private async record(
    tx: Prisma.TransactionClient,
    id: string,
    type: string,
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
          eventName,
          partitionKey: id,
          payload: { ...after, tenantId: context.tenantId },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }

  private async case(
    tx: Prisma.TransactionClient,
    id: string,
    context: TenantContext,
  ) {
    const row = await tx.controlAlertCase.findFirst({
      where: { id, tenantId: context.tenantId },
    });
    if (!row)
      throw new AppError(
        'CONTROL_ALERT_CASE_NOT_FOUND',
        'Alert case was not found',
        404,
      );
    return row;
  }

  private caseTarget(
    current: ControlAlertCaseStatus,
    action: AlertCaseActionInput['action'],
  ): ControlAlertCaseStatus {
    const target = {
      ACKNOWLEDGE: 'ACKNOWLEDGED',
      CLOSE: 'CLOSED',
      REOPEN: 'OPEN',
      RESOLVE: 'RESOLVED',
      START: 'IN_PROGRESS',
    }[action] as ControlAlertCaseStatus;
    const allowed =
      (action === 'ACKNOWLEDGE' && current === 'OPEN') ||
      (action === 'START' && ['ACKNOWLEDGED', 'OPEN'].includes(current)) ||
      (action === 'RESOLVE' &&
        ['ACKNOWLEDGED', 'IN_PROGRESS', 'OPEN'].includes(current)) ||
      (action === 'CLOSE' && current === 'RESOLVED') ||
      (action === 'REOPEN' && current === 'CLOSED');
    if (!allowed) this.caseTransition(current, action);
    return target;
  }

  private caseTransition(current: string, action: string): never {
    throw new AppError(
      'CONTROL_ALERT_TRANSITION_INVALID',
      `Alert case action ${action} is not allowed from ${current}`,
      409,
    );
  }

  private assertSlaInput(input: StartControlSlaInput) {
    this.text(input.businessRef, 'businessRef', 200);
    if (
      !Number.isInteger(input.durationMinutes) ||
      input.durationMinutes < 1 ||
      !Number.isInteger(input.warningLeadMinutes) ||
      input.warningLeadMinutes < 0 ||
      input.warningLeadMinutes > input.durationMinutes ||
      !Number.isInteger(input.sourceVersion) ||
      input.sourceVersion < 1
    )
      this.invalid('SLA duration, warning and source version are invalid');
  }

  private assertRuleInput(input: PublishAlertRuleInput) {
    this.text(input.code, 'code', 100);
    this.text(input.name, 'name', 200);
    this.domain(input.responsibleDomain);
    this.channels(input.channels);
    for (const value of [
      input.debounceSeconds,
      input.suppressionSeconds,
      input.mergeWindowSeconds,
    ])
      if (!Number.isInteger(value) || value < 0)
        this.invalid('Alert rule windows are invalid');
    if (
      !Number.isInteger(input.dueMinutes) ||
      input.dueMinutes < 1 ||
      !Number.isInteger(input.escalationMinutes) ||
      input.escalationMinutes < 1
    )
      this.invalid('Alert rule SLA is invalid');
    if (input.ownerRef)
      this.uuid(input.ownerRef, 'CONTROL_ALERT_OWNER_INVALID');
    if (input.supervisorRef)
      this.uuid(input.supervisorRef, 'CONTROL_ALERT_SUPERVISOR_INVALID');
    if (
      input.condition.minimumDurationSeconds !== undefined &&
      (!Number.isInteger(input.condition.minimumDurationSeconds) ||
        input.condition.minimumDurationSeconds < 0)
    )
      this.invalid('minimumDurationSeconds is invalid');
  }

  private channels(input: readonly string[]) {
    const allowed = new Set(['EMAIL', 'IN_APP', 'PUSH', 'SMS', 'WECHAT']);
    const result = [...new Set(input.map((item) => item.trim().toUpperCase()))];
    if (result.length === 0 || result.some((item) => !allowed.has(item)))
      this.invalid('Notification channels are invalid');
    return result;
  }

  private domain(value: unknown) {
    return this.text(value, 'responsibleDomain', 50).toUpperCase();
  }

  private date(value: unknown, field: string) {
    const result = value instanceof Date ? value : new Date(String(value));
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
    if (value === undefined || value === null || value === '') return null;
    this.uuid(String(value), 'CONTROL_UUID_INVALID');
    return String(value);
  }

  private uuid(value: string, code: string) {
    if (!isUuid(value)) throw new AppError(code, 'UUID is invalid', 400);
  }

  private lock(tx: Prisma.TransactionClient, key: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  private conflict(): never {
    throw new AppError(
      'CONTROL_VERSION_CONFLICT',
      'The record changed; refresh and retry',
      409,
    );
  }

  private invalid(message: string): never {
    throw new AppError('CONTROL_ALERT_INPUT_INVALID', message, 400);
  }
}

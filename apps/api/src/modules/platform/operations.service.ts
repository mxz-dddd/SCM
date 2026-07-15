import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type OpsArchiveStatus,
  type OpsBackupStatus,
  type OpsDefinitionStatus,
  type OpsDrDrillStatus,
  type OpsMigrationRunStatus,
  type OpsPrivacyRequestStatus,
  type OpsReleaseStatus,
  type OpsTenantMigrationStatus,
  Prisma,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { ObservabilityService } from './observability.service';
import { ChangeRecordingFacade } from './public/change-recording.facade';
import { JobSchedulingFacade } from './public/job-scheduling.facade';
import type { CommandMetadata } from './tenant.service';

type JsonObject = Record<string, unknown>;
type OpsJobKind = 'ARCHIVE' | 'DR_DRILL' | 'PRIVACY' | 'TENANT_MIGRATION';

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const object = (value: unknown): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const DEF: Readonly<
  Record<OpsDefinitionStatus, readonly OpsDefinitionStatus[]>
> = {
  ACTIVE: ['PAUSED', 'RETIRED'],
  DRAFT: ['ACTIVE', 'RETIRED'],
  PAUSED: ['ACTIVE', 'RETIRED'],
  RETIRED: [],
};
const ALERT = {
  ACKNOWLEDGED: ['RESOLVED'],
  OPEN: ['ACKNOWLEDGED', 'RESOLVED'],
  RESOLVED: [],
} as const;
const BACKUP: Readonly<Record<OpsBackupStatus, readonly OpsBackupStatus[]>> = {
  EXPIRED: [],
  FAILED: [],
  PLANNED: ['RUNNING'],
  RUNNING: ['FAILED', 'VERIFIED'],
  VERIFIED: ['EXPIRED'],
};
const DR: Readonly<Record<OpsDrDrillStatus, readonly OpsDrDrillStatus[]>> = {
  DRAFT: ['QUEUED'],
  FAILED: [],
  PASSED: [],
  QUEUED: ['RUNNING'],
  RUNNING: ['FAILED', 'PASSED'],
};
const RELEASE: Readonly<Record<OpsReleaseStatus, readonly OpsReleaseStatus[]>> =
  {
    CANARY: ['FAILED', 'ROLLED_BACK', 'ROLLED_OUT'],
    DRAFT: ['VALIDATED'],
    FAILED: ['ROLLED_BACK'],
    ROLLED_BACK: [],
    ROLLED_OUT: ['ROLLED_BACK'],
    VALIDATED: ['CANARY', 'FAILED'],
  };
const MIGRATION: Readonly<
  Record<OpsMigrationRunStatus, readonly OpsMigrationRunStatus[]>
> = {
  COMPLETED: [],
  FAILED: ['ROLLED_BACK'],
  PLANNED: ['RUNNING'],
  ROLLED_BACK: [],
  RUNNING: ['COMPLETED', 'FAILED'],
};
const ARCHIVE: Readonly<Record<OpsArchiveStatus, readonly OpsArchiveStatus[]>> =
  {
    BLOCKED: [],
    COMPLETED: [],
    FAILED: [],
    QUEUED: ['BLOCKED', 'RUNNING'],
    RUNNING: ['COMPLETED', 'FAILED'],
  };
const PRIVACY: Readonly<
  Record<OpsPrivacyRequestStatus, readonly OpsPrivacyRequestStatus[]>
> = {
  FULFILLED: [],
  PARTIALLY_FULFILLED: [],
  QUEUED: ['RUNNING'],
  RECEIVED: ['REJECTED', 'VERIFIED'],
  REJECTED: [],
  RUNNING: ['FULFILLED', 'PARTIALLY_FULFILLED'],
  VERIFIED: ['QUEUED'],
};
const TENANT_MIGRATION: Readonly<
  Record<OpsTenantMigrationStatus, readonly OpsTenantMigrationStatus[]>
> = {
  COMPLETED: [],
  DRAFT: ['VALIDATED'],
  FAILED: ['ROLLED_BACK'],
  QUEUED: ['RUNNING'],
  RECONCILING: ['COMPLETED', 'FAILED'],
  ROLLED_BACK: [],
  RUNNING: ['FAILED', 'RECONCILING'],
  VALIDATED: ['QUEUED'],
};

export const OPS_STATE_TRANSITIONS: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  alert: ALERT,
  archive: ARCHIVE,
  backup: BACKUP,
  definition: DEF,
  drill: DR,
  migration: MIGRATION,
  privacy: PRIVACY,
  release: RELEASE,
  tenantMigration: TENANT_MIGRATION,
};

export function assertOpsTransition(
  machine: string,
  current: string,
  target: string,
): void {
  if (!OPS_STATE_TRANSITIONS[machine]?.[current]?.includes(target))
    throw new AppError(
      'OPS_TRANSITION_INVALID',
      `${machine} transition ${current} -> ${target} is not allowed`,
      409,
    );
}

export interface MonitorRuleInput extends JsonObject {
  code: string;
  dedupSeconds: number;
  dimensionFilter?: JsonObject;
  durationSeconds: number;
  name: string;
  operator: 'GT' | 'GTE' | 'LT' | 'LTE';
  ownerRef: string;
  severity: 'CRITICAL' | 'INFO' | 'WARNING';
  signal: string;
  threshold: number;
}
export interface SignalInput extends JsonObject {
  dimensions?: JsonObject;
  domain: string;
  observedAt?: string;
  signal: string;
  traceId: string;
  unit: string;
  value: number;
}
export interface BackupInput extends JsonObject {
  backupNo: string;
  environment: string;
  policy: JsonObject;
  targetRpoMinutes: number;
  targetRtoMinutes: number;
}
export interface ReleaseInput extends JsonObject {
  artifacts: JsonObject;
  commitSha: string;
  environment: string;
  imageDigest: string;
  releaseNo: string;
}
export interface RetentionInput extends JsonObject {
  archiveAfterDays: number;
  archiveTier: 'COLD' | 'GLACIER' | 'WARM';
  category: string;
  contract: JsonObject;
  deleteAllowed: boolean;
  legalHold: boolean;
  retainDays: number;
}
export interface CapacityInput extends JsonObject {
  code: string;
  domain: string;
  effectiveFrom: string;
  quota: JsonObject;
  scaling: JsonObject;
  tiering: JsonObject;
}
export interface PrivacyInput extends JsonObject {
  dueAt: string;
  legalBasis: JsonObject;
  requestNo: string;
  requestType: 'ACCESS' | 'CORRECT' | 'DELETE';
  scope: JsonObject;
  subjectRef: string;
}
export interface TenantMigrationInput extends JsonObject {
  dependencies: JsonObject;
  planNo: string;
  rollback: JsonObject;
  scope: JsonObject;
  sourceEnvironment: string;
  sourceTotals: JsonObject;
  targetEnvironment: string;
  targetTotals: JsonObject;
}

@Injectable()
export class OperationsService {
  constructor(
    @Inject(ChangeRecordingFacade)
    private readonly changes: ChangeRecordingFacade,
    @Inject(JobSchedulingFacade)
    private readonly scheduling: JobSchedulingFacade,
    @Inject(ObservabilityService)
    private readonly telemetry: ObservabilityService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async workbench(context: TenantContext) {
    const where = { tenantId: context.tenantId };
    const take = 300;
    const [
      monitorRules,
      alerts,
      backups,
      drills,
      releases,
      migrationRuns,
      retentionPolicies,
      archiveJobs,
      privacyRequests,
      redactionRecords,
      capacityPlans,
      usageMetrics,
      tenantMigrations,
      reconciliationReports,
    ] = await Promise.all([
      this.prisma.opsMonitorRule.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        where,
      }),
      this.prisma.opsMonitorAlert.findMany({
        orderBy: { lastTriggeredAt: 'desc' },
        take,
        where,
      }),
      this.prisma.opsBackupSet.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        where,
      }),
      this.prisma.opsDrDrillReport.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        where,
      }),
      this.prisma.opsRelease.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        where,
      }),
      this.prisma.opsMigrationRun.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        where,
      }),
      this.prisma.opsRetentionPolicy.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        where,
      }),
      this.prisma.opsArchiveJob.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        where,
      }),
      this.prisma.opsPrivacyRequest.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        where,
      }),
      this.prisma.opsRedactionRecord.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        where,
      }),
      this.prisma.opsCapacityPlan.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        where,
      }),
      this.prisma.opsUsageMetric.findMany({
        orderBy: { observedAt: 'desc' },
        take,
        where,
      }),
      this.prisma.opsTenantMigrationPlan.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        where,
      }),
      this.prisma.opsMigrationReconciliationReport.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        where,
      }),
    ]);
    return toHttpJson({
      alerts,
      archiveJobs,
      backups,
      capacityPlans,
      drills,
      migrationRuns,
      monitorRules,
      privacyRequests,
      reconciliationReports,
      redactionRecords,
      releases,
      retentionPolicies,
      telemetry: this.telemetry.snapshot(),
      tenantMigrations,
      usageMetrics,
    });
  }

  createMonitorRule(
    input: MonitorRuleInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.monitorRuleInput(input);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.opsMonitorRule.create({
        data: {
          code: input.code.trim().toUpperCase(),
          createdBy: context.accountId,
          dedupSeconds: input.dedupSeconds,
          dimensionFilter: json(input.dimensionFilter),
          durationSeconds: input.durationSeconds,
          name: input.name.trim(),
          operator: input.operator,
          ownerRef: input.ownerRef.trim(),
          severity: input.severity,
          signal: input.signal.trim(),
          tenantId: context.tenantId,
          threshold: input.threshold,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        row.id,
        'OpsMonitorRule',
        row.version,
        'platform.ops-monitor-rule-created.v1',
        { code: row.code },
        context,
        metadata,
      );
      return toHttpJson(row);
    });
  }

  transitionDefinition(
    kind: 'CAPACITY' | 'MONITOR' | 'RETENTION',
    id: string,
    input: { expectedVersion: number; status: OpsDefinitionStatus },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id);
    this.integer(input.expectedVersion, 'expectedVersion', 1);
    return this.prisma.$transaction(async (tx) => {
      const delegate =
        kind === 'MONITOR'
          ? tx.opsMonitorRule
          : kind === 'RETENTION'
            ? tx.opsRetentionPolicy
            : tx.opsCapacityPlan;
      const current = await (delegate as typeof tx.opsMonitorRule).findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!current) this.notFound(kind);
      this.version(current.version, input.expectedVersion);
      this.transition(DEF, current.status, input.status, kind);
      const changed = await (delegate as typeof tx.opsMonitorRule).update({
        data: {
          status: input.status,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        `Ops${kind}`,
        changed.version,
        `platform.ops-${kind.toLowerCase()}-${input.status.toLowerCase()}.v1`,
        { status: input.status },
        context,
        metadata,
      );
      return toHttpJson(changed);
    });
  }

  async ingestSignal(
    input: SignalInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.text(input.signal, 'signal', 100);
    this.text(input.domain, 'domain', 50);
    this.text(input.unit, 'unit', 30);
    if (
      !Number.isFinite(input.value) ||
      !/^[a-f0-9-]{16,100}$/i.test(input.traceId)
    )
      this.invalid('Signal value or traceId is invalid');
    const observedAt = this.date(
      input.observedAt ?? new Date().toISOString(),
      'observedAt',
    );
    const dimensions = object(input.dimensions);
    return this.prisma.$transaction(async (tx) => {
      const metric = await tx.opsUsageMetric.create({
        data: {
          createdBy: context.accountId,
          dimensionSnapshot: json(dimensions),
          domain: input.domain.trim().toUpperCase(),
          metricName: input.signal.trim(),
          observedAt,
          tenantId: context.tenantId,
          traceId: input.traceId,
          unit: input.unit.trim(),
          updatedBy: context.accountId,
          value: input.value,
        },
      });
      const rules = await tx.opsMonitorRule.findMany({
        where: {
          signal: input.signal.trim(),
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      const alerts = [];
      for (const rule of rules) {
        const threshold = Number(rule.threshold);
        if (!this.compare(input.value, rule.operator, threshold)) continue;
        const dedupKey = this.hash({ dimensions, ruleId: rule.id });
        const recent = await tx.opsMonitorAlert.findFirst({
          orderBy: { lastTriggeredAt: 'desc' },
          where: {
            dedupKey,
            status: { in: ['OPEN', 'ACKNOWLEDGED'] },
            tenantId: context.tenantId,
          },
        });
        const alert =
          recent &&
          observedAt.getTime() - recent.lastTriggeredAt.getTime() <=
            rule.dedupSeconds * 1000
            ? await tx.opsMonitorAlert.update({
                data: {
                  lastTriggeredAt: observedAt,
                  observedValue: input.value,
                  triggerCount: { increment: 1 },
                  updatedBy: context.accountId,
                  version: { increment: 1 },
                },
                where: { id: recent.id },
              })
            : await tx.opsMonitorAlert.create({
                data: {
                  createdBy: context.accountId,
                  dedupKey,
                  dimensionSnapshot: json(dimensions),
                  firstTriggeredAt: observedAt,
                  lastTriggeredAt: observedAt,
                  observedValue: input.value,
                  ruleId: rule.id,
                  severity: rule.severity,
                  signal: rule.signal,
                  tenantId: context.tenantId,
                  threshold: rule.threshold,
                  unit: input.unit,
                  updatedBy: context.accountId,
                },
              });
        alerts.push(alert);
        await this.record(
          tx,
          alert.id,
          'OpsMonitorAlert',
          alert.version,
          'platform.ops-monitor-alert-triggered.v1',
          { signal: input.signal, status: alert.status },
          context,
          metadata,
        );
      }
      this.telemetry.increment('ops_signals_total');
      return toHttpJson({ alerts, metric });
    });
  }

  transitionAlert(
    id: string,
    input: {
      expectedVersion: number;
      resolution?: string;
      status: 'ACKNOWLEDGED' | 'RESOLVED';
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.transitionRow(
      'alert',
      id,
      input,
      ALERT,
      context,
      metadata,
      async (tx, current) =>
        tx.opsMonitorAlert.update({
          data: {
            ...(input.status === 'ACKNOWLEDGED'
              ? {
                  acknowledgedAt: new Date(),
                  acknowledgedBy: context.accountId,
                }
              : {
                  resolution: this.text(input.resolution, 'resolution', 1000),
                  resolvedAt: new Date(),
                  resolvedBy: context.accountId,
                }),
            status: input.status,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: current.id },
        }),
    );
  }

  createBackup(
    input: BackupInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.text(input.backupNo, 'backupNo', 100);
    this.text(input.environment, 'environment', 100);
    this.integer(input.targetRpoMinutes, 'targetRpoMinutes', 1, 10080);
    this.integer(input.targetRtoMinutes, 'targetRtoMinutes', 1, 10080);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.opsBackupSet.create({
        data: {
          backupNo: input.backupNo.trim(),
          createdBy: context.accountId,
          environment: input.environment.trim(),
          policySnapshot: json(input.policy),
          targetRpoMinutes: input.targetRpoMinutes,
          targetRtoMinutes: input.targetRtoMinutes,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        row.id,
        'OpsBackupSet',
        row.version,
        'platform.ops-backup-planned.v1',
        { backupNo: row.backupNo },
        context,
        metadata,
      );
      return toHttpJson(row);
    });
  }

  transitionBackup(
    id: string,
    input: {
      artifact?: JsonObject;
      expectedVersion: number;
      failureCode?: string;
      status: OpsBackupStatus;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.transitionRow(
      'backup',
      id,
      input,
      BACKUP,
      context,
      metadata,
      async (tx, current) =>
        tx.opsBackupSet.update({
          data: {
            ...(input.status === 'RUNNING' ? { startedAt: new Date() } : {}),
            ...(['VERIFIED', 'FAILED'].includes(input.status)
              ? {
                  artifactSnapshot: json(input.artifact),
                  completedAt: new Date(),
                  failureCode: input.failureCode ?? null,
                }
              : {}),
            status: input.status,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: current.id },
        }),
    );
  }

  async queueDrill(
    input: {
      backupSetId: string;
      drillNo: string;
      exercise: JsonObject;
      singleWriterFence: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.backupSetId);
    this.text(input.drillNo, 'drillNo', 100);
    this.text(input.singleWriterFence, 'singleWriterFence', 200);
    const drill = await this.prisma.$transaction(async (tx) => {
      const backup = await tx.opsBackupSet.findFirst({
        where: {
          id: input.backupSetId,
          status: 'VERIFIED',
          tenantId: context.tenantId,
        },
      });
      if (!backup)
        throw new AppError(
          'OPS_BACKUP_NOT_VERIFIED',
          'A verified backup set is required',
          409,
        );
      const row = await tx.opsDrDrillReport.create({
        data: {
          backupSetId: backup.id,
          createdBy: context.accountId,
          drillNo: input.drillNo.trim(),
          exerciseSnapshot: json(input.exercise),
          singleWriterFence: input.singleWriterFence.trim(),
          status: 'QUEUED',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        row.id,
        'OpsDrDrillReport',
        row.version,
        'platform.ops-dr-drill-queued.v1',
        { status: row.status },
        context,
        metadata,
      );
      return row;
    });
    return this.attachJob('DR_DRILL', drill.id, context, metadata);
  }

  createRelease(
    input: ReleaseInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.text(input.releaseNo, 'releaseNo', 100);
    this.text(input.environment, 'environment', 100);
    if (
      !/^[a-f0-9]{40}$/i.test(input.commitSha) ||
      !/^sha256:[a-f0-9]{64}$/i.test(input.imageDigest)
    )
      this.invalid('Release commit or image digest is invalid');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.opsRelease.create({
        data: {
          artifactSnapshot: json(input.artifacts),
          commitSha: input.commitSha.toLowerCase(),
          createdBy: context.accountId,
          environment: input.environment.trim(),
          imageDigest: input.imageDigest.toLowerCase(),
          releaseNo: input.releaseNo.trim(),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        row.id,
        'OpsRelease',
        row.version,
        'platform.ops-release-created.v1',
        { releaseNo: row.releaseNo },
        context,
        metadata,
      );
      return toHttpJson(row);
    });
  }

  transitionRelease(
    id: string,
    input: {
      canary?: JsonObject;
      expectedVersion: number;
      rollback?: JsonObject;
      status: OpsReleaseStatus;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.transitionRow(
      'release',
      id,
      input,
      RELEASE,
      context,
      metadata,
      async (tx, current) => {
        const artifacts = object(
          (current as unknown as { artifactSnapshot: unknown })
            .artifactSnapshot,
        );
        if (
          input.status === 'VALIDATED' &&
          (!artifacts.testsPassed ||
            !artifacts.imageScanPassed ||
            !artifacts.migrationSafetyPassed)
        )
          throw new AppError(
            'OPS_RELEASE_EVIDENCE_MISSING',
            'Tests, image scan and migration safety evidence must pass',
            409,
          );
        if (input.status === 'CANARY' && !object(input.canary).trafficPercent)
          this.invalid('Canary evidence and trafficPercent are required');
        if (input.status === 'ROLLED_BACK' && !object(input.rollback).reason)
          this.invalid('Rollback evidence and reason are required');
        return tx.opsRelease.update({
          data: {
            ...(input.canary ? { canarySnapshot: json(input.canary) } : {}),
            ...(['ROLLED_OUT', 'ROLLED_BACK', 'FAILED'].includes(input.status)
              ? { completedAt: new Date() }
              : {}),
            ...(input.rollback
              ? { rollbackSnapshot: json(input.rollback) }
              : {}),
            status: input.status,
            updatedBy: context.accountId,
            ...(input.status === 'VALIDATED'
              ? { validatedAt: new Date() }
              : {}),
            version: { increment: 1 },
          },
          where: { id: current.id },
        });
      },
    );
  }

  createMigrationRun(
    input: {
      compatibility: JsonObject;
      lockRisk: JsonObject;
      migrationName: string;
      phase: 'CONTRACT' | 'EXPAND' | 'MIGRATE';
      releaseId: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.releaseId);
    this.text(input.migrationName, 'migrationName', 200);
    return this.prisma.$transaction(async (tx) => {
      const release = await tx.opsRelease.findFirst({
        where: {
          id: input.releaseId,
          status: { in: ['VALIDATED', 'CANARY'] },
          tenantId: context.tenantId,
        },
      });
      if (!release)
        throw new AppError(
          'OPS_RELEASE_NOT_VALIDATED',
          'Validated release is required',
          409,
        );
      if (
        input.phase === 'CONTRACT' &&
        object(input.compatibility).oldReadersActive !== false
      )
        throw new AppError(
          'OPS_CONTRACT_NOT_SAFE',
          'Contract requires proof that old readers are inactive',
          409,
        );
      if (object(input.lockRisk).peakLargeTableLock === true)
        throw new AppError(
          'OPS_MIGRATION_LOCK_RISK',
          'Peak large-table lock is forbidden',
          409,
        );
      const row = await tx.opsMigrationRun.create({
        data: {
          compatibilitySnapshot: json(input.compatibility),
          createdBy: context.accountId,
          lockRiskSnapshot: json(input.lockRisk),
          migrationName: input.migrationName.trim(),
          phase: input.phase,
          releaseId: release.id,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        row.id,
        'OpsMigrationRun',
        row.version,
        'platform.ops-migration-planned.v1',
        { phase: row.phase },
        context,
        metadata,
      );
      return toHttpJson(row);
    });
  }

  transitionMigrationRun(
    id: string,
    input: {
      evidence?: JsonObject;
      expectedVersion: number;
      status: OpsMigrationRunStatus;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.transitionRow(
      'migration',
      id,
      input,
      MIGRATION,
      context,
      metadata,
      async (tx, current) =>
        tx.opsMigrationRun.update({
          data: {
            ...(['COMPLETED', 'FAILED', 'ROLLED_BACK'].includes(input.status)
              ? { completedAt: new Date() }
              : {}),
            ...(input.evidence
              ? { executionSnapshot: json(input.evidence) }
              : {}),
            ...(input.status === 'RUNNING' ? { startedAt: new Date() } : {}),
            status: input.status,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: current.id },
        }),
    );
  }

  createRetention(
    input: RetentionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.text(input.category, 'category', 100);
    this.integer(input.retainDays, 'retainDays', 1, 36500);
    this.integer(
      input.archiveAfterDays,
      'archiveAfterDays',
      1,
      input.retainDays,
    );
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.opsRetentionPolicy.create({
        data: {
          archiveAfterDays: input.archiveAfterDays,
          archiveTier: input.archiveTier,
          category: input.category.trim().toUpperCase(),
          contractSnapshot: json(input.contract),
          createdBy: context.accountId,
          deleteAllowed: input.deleteAllowed,
          legalHold: input.legalHold,
          retainDays: input.retainDays,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        row.id,
        'OpsRetentionPolicy',
        row.version,
        'platform.ops-retention-created.v1',
        { category: row.category },
        context,
        metadata,
      );
      return toHttpJson(row);
    });
  }

  async queueArchive(
    input: { candidates: JsonObject; cutoffAt: string; policyId: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.policyId);
    const cutoffAt = this.date(input.cutoffAt, 'cutoffAt');
    const job = await this.prisma.$transaction(async (tx) => {
      const policy = await tx.opsRetentionPolicy.findFirst({
        where: {
          id: input.policyId,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      if (!policy)
        throw new AppError(
          'OPS_RETENTION_NOT_ACTIVE',
          'Active retention policy is required',
          409,
        );
      const status: OpsArchiveStatus = policy.legalHold ? 'BLOCKED' : 'QUEUED';
      const row = await tx.opsArchiveJob.create({
        data: {
          candidateSnapshot: json(input.candidates),
          createdBy: context.accountId,
          cutoffAt,
          policyId: policy.id,
          status,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        row.id,
        'OpsArchiveJob',
        row.version,
        `platform.ops-archive-${status.toLowerCase()}.v1`,
        { status },
        context,
        metadata,
      );
      return row;
    });
    return job.status === 'BLOCKED'
      ? toHttpJson(job)
      : this.attachJob('ARCHIVE', job.id, context, metadata);
  }

  createPrivacyRequest(
    input: PrivacyInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.text(input.subjectRef, 'subjectRef', 500);
    this.text(input.requestNo, 'requestNo', 100);
    const dueAt = this.date(input.dueAt, 'dueAt');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.opsPrivacyRequest.create({
        data: {
          createdBy: context.accountId,
          dueAt,
          legalBasisSnapshot: json(input.legalBasis),
          requestNo: input.requestNo.trim(),
          requestType: input.requestType,
          scopeSnapshot: json(input.scope),
          subjectRefHash: this.hash(input.subjectRef),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        row.id,
        'OpsPrivacyRequest',
        row.version,
        'platform.ops-privacy-requested.v1',
        { requestType: row.requestType },
        context,
        metadata,
      );
      return toHttpJson(row);
    });
  }

  async transitionPrivacy(
    id: string,
    input: {
      expectedVersion: number;
      reason?: string;
      status: OpsPrivacyRequestStatus;
      verification?: JsonObject;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const changed = await this.transitionRow(
      'privacy',
      id,
      input,
      PRIVACY,
      context,
      metadata,
      async (tx, current) =>
        tx.opsPrivacyRequest.update({
          data: {
            ...(input.status === 'REJECTED'
              ? { rejectionReason: this.text(input.reason, 'reason', 1000) }
              : {}),
            status: input.status,
            updatedBy: context.accountId,
            ...(input.verification
              ? { verificationSnapshot: json(input.verification) }
              : {}),
            version: { increment: 1 },
          },
          where: { id: current.id },
        }),
    );
    return input.status === 'QUEUED'
      ? this.attachJob('PRIVACY', id, context, metadata)
      : changed;
  }

  createCapacity(
    input: CapacityInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.text(input.code, 'code', 100);
    this.text(input.domain, 'domain', 50);
    const effectiveFrom = this.date(input.effectiveFrom, 'effectiveFrom');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.opsCapacityPlan.create({
        data: {
          code: input.code.trim().toUpperCase(),
          createdBy: context.accountId,
          domain: input.domain.trim().toUpperCase(),
          effectiveFrom,
          quotaSnapshot: json(input.quota),
          scalingSnapshot: json(input.scaling),
          tenantId: context.tenantId,
          tieringSnapshot: json(input.tiering),
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        row.id,
        'OpsCapacityPlan',
        row.version,
        'platform.ops-capacity-created.v1',
        { code: row.code },
        context,
        metadata,
      );
      return toHttpJson(row);
    });
  }

  createTenantMigration(
    input: TenantMigrationInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.text(input.planNo, 'planNo', 100);
    this.text(input.sourceEnvironment, 'sourceEnvironment', 100);
    this.text(input.targetEnvironment, 'targetEnvironment', 100);
    if (input.sourceEnvironment.trim() === input.targetEnvironment.trim())
      this.invalid('Source and target environments must differ');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.opsTenantMigrationPlan.create({
        data: {
          createdBy: context.accountId,
          dependencySnapshot: json(input.dependencies),
          planNo: input.planNo.trim(),
          rollbackSnapshot: json(input.rollback),
          scopeSnapshot: json(input.scope),
          sourceEnvironment: input.sourceEnvironment.trim(),
          sourceTotalSnapshot: json(input.sourceTotals),
          targetEnvironment: input.targetEnvironment.trim(),
          targetTotalSnapshot: json(input.targetTotals),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        row.id,
        'OpsTenantMigrationPlan',
        row.version,
        'platform.ops-tenant-migration-created.v1',
        { planNo: row.planNo },
        context,
        metadata,
      );
      return toHttpJson(row);
    });
  }

  async transitionTenantMigration(
    id: string,
    input: {
      expectedVersion: number;
      status: OpsTenantMigrationStatus;
      targetTotals?: JsonObject;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const changed = await this.transitionRow(
      'tenant-migration',
      id,
      input,
      TENANT_MIGRATION,
      context,
      metadata,
      async (tx, current) => {
        if (
          input.status === 'VALIDATED' &&
          object(
            (current as unknown as { dependencySnapshot: unknown })
              .dependencySnapshot,
          ).satisfied !== true
        )
          throw new AppError(
            'OPS_MIGRATION_DEPENDENCY_UNSATISFIED',
            'Migration dependencies are not satisfied',
            409,
          );
        return tx.opsTenantMigrationPlan.update({
          data: {
            status: input.status,
            ...(input.targetTotals
              ? { targetTotalSnapshot: json(input.targetTotals) }
              : {}),
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: current.id },
        });
      },
    );
    return input.status === 'QUEUED'
      ? this.attachJob('TENANT_MIGRATION', id, context, metadata)
      : changed;
  }

  async executeJob(
    input: { aggregateId: string; jobRunId: string; kind: OpsJobKind },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.aggregateId);
    this.uuid(input.jobRunId);
    if (
      !['ARCHIVE', 'DR_DRILL', 'PRIVACY', 'TENANT_MIGRATION'].includes(
        input.kind,
      )
    )
      this.invalid('OPS job kind is invalid');
    if (input.kind === 'DR_DRILL')
      return this.executeDrill(input.aggregateId, context, metadata);
    if (input.kind === 'ARCHIVE')
      return this.executeArchive(input.aggregateId, context, metadata);
    if (input.kind === 'PRIVACY')
      return this.executePrivacy(input.aggregateId, context, metadata);
    return this.executeTenantMigration(input.aggregateId, context, metadata);
  }

  telemetrySnapshot() {
    return this.telemetry.snapshot();
  }
  prometheus() {
    return this.telemetry.prometheus();
  }

  private async executeDrill(
    id: string,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.opsDrDrillReport.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!row) this.notFound('drill');
      this.transition(DR, row.status, 'RUNNING', 'drill');
      const backup = await tx.opsBackupSet.findFirst({
        where: {
          id: row.backupSetId,
          status: 'VERIFIED',
          tenantId: context.tenantId,
        },
      });
      const exercise = object(row.exerciseSnapshot);
      const singleWriter = exercise.secondaryWriterEnabled !== true;
      const achievedRpo = Number(exercise.achievedRpoMinutes ?? 0);
      const achievedRto = Number(exercise.achievedRtoMinutes ?? 0);
      const passed = Boolean(
        backup &&
        singleWriter &&
        achievedRpo <= backup.targetRpoMinutes &&
        achievedRto <= backup.targetRtoMinutes,
      );
      const changed = await tx.opsDrDrillReport.update({
        data: {
          achievedRpoMinutes: achievedRpo,
          achievedRtoMinutes: achievedRto,
          completedAt: new Date(),
          resultSnapshot: json({
            backupVerified: Boolean(backup),
            passed,
            singleWriter,
          }),
          startedAt: new Date(),
          status: passed ? 'PASSED' : 'FAILED',
          updatedBy: context.accountId,
          version: { increment: 2 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        'OpsDrDrillReport',
        changed.version,
        `platform.ops-dr-drill-${changed.status.toLowerCase()}.v1`,
        { status: changed.status },
        context,
        metadata,
      );
      return toHttpJson(changed);
    });
  }

  private async executeArchive(
    id: string,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.opsArchiveJob.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!row) this.notFound('archive');
      this.transition(ARCHIVE, row.status, 'RUNNING', 'archive');
      const candidates = object(row.candidateSnapshot);
      const count = Array.isArray(candidates.records)
        ? candidates.records.length
        : Number(candidates.count ?? 0);
      const policy = await tx.opsRetentionPolicy.findFirst({
        where: { id: row.policyId, tenantId: context.tenantId },
      });
      if (!policy || policy.legalHold)
        throw new AppError(
          'OPS_ARCHIVE_LEGAL_HOLD',
          'Archive cannot run while legal hold applies',
          409,
        );
      const changed = await tx.opsArchiveJob.update({
        data: {
          archivedCount: count,
          completedAt: new Date(),
          deletedCount: policy.deleteAllowed ? count : 0,
          manifestSnapshot: json({
            candidateHash: this.hash(candidates),
            count,
            searchable: true,
            tier: policy.archiveTier,
          }),
          startedAt: new Date(),
          status: 'COMPLETED',
          updatedBy: context.accountId,
          version: { increment: 2 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        'OpsArchiveJob',
        changed.version,
        'platform.ops-archive-completed.v1',
        { archivedCount: count, status: changed.status },
        context,
        metadata,
      );
      return toHttpJson(changed);
    });
  }

  private async executePrivacy(
    id: string,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.opsPrivacyRequest.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!row) this.notFound('privacy');
      this.transition(PRIVACY, row.status, 'RUNNING', 'privacy');
      const scope = object(row.scopeSnapshot);
      const domains = Array.isArray(scope.domains)
        ? scope.domains.map(String).slice(0, 30)
        : [];
      for (const domain of domains) {
        const record = await tx.opsRedactionRecord.create({
          data: {
            action: row.requestType,
            createdBy: context.accountId,
            domain,
            evidenceSnapshot: json({
              commandEvent: `${domain.toLowerCase()}.privacy-subject-requested.v1`,
              retainedTransactionalEvidence: true,
            }),
            fieldClassification: 'PII',
            outcome: 'COMMAND_EMITTED',
            privacyRequestId: id,
            reasonCode: 'SUBJECT_REQUEST',
            recordRefHash: row.subjectRefHash,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await this.record(
          tx,
          record.id,
          'OpsRedactionRecord',
          record.version,
          `${domain.toLowerCase()}.privacy-subject-requested.v1`,
          { privacyRequestId: id, requestType: row.requestType },
          context,
          metadata,
        );
      }
      const status: OpsPrivacyRequestStatus = domains.length
        ? 'FULFILLED'
        : 'PARTIALLY_FULFILLED';
      const changed = await tx.opsPrivacyRequest.update({
        data: {
          completedAt: new Date(),
          status,
          updatedBy: context.accountId,
          version: { increment: 2 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        'OpsPrivacyRequest',
        changed.version,
        `platform.ops-privacy-${status.toLowerCase()}.v1`,
        { status },
        context,
        metadata,
      );
      return toHttpJson(changed);
    });
  }

  private async executeTenantMigration(
    id: string,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.opsTenantMigrationPlan.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!row) this.notFound('tenant migration');
      this.transition(
        TENANT_MIGRATION,
        row.status,
        'RUNNING',
        'tenant migration',
      );
      const source = object(row.sourceTotalSnapshot);
      const target = object(row.targetTotalSnapshot);
      const comparisons = this.reconcile(source, target);
      const differenceCount = comparisons.filter((item) => !item.equal).length;
      const reportPayload = {
        count: comparisons.filter((x) => x.kind === 'COUNT'),
        money: comparisons.filter((x) => x.kind === 'MONEY'),
        status: comparisons.filter((x) => x.kind === 'STATUS'),
      };
      const report = await tx.opsMigrationReconciliationReport.create({
        data: {
          countComparison: json(reportPayload.count),
          createdBy: context.accountId,
          differenceCount,
          migrationPlanId: id,
          moneyComparison: json(reportPayload.money),
          reportHash: this.hash(reportPayload),
          statusComparison: json(reportPayload.status),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const status: OpsTenantMigrationStatus =
        differenceCount === 0 ? 'COMPLETED' : 'FAILED';
      const changed = await tx.opsTenantMigrationPlan.update({
        data: {
          completedAt: new Date(),
          failureCode: differenceCount ? 'RECONCILIATION_DIFFERENCE' : null,
          startedAt: new Date(),
          status,
          updatedBy: context.accountId,
          version: { increment: 3 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        'OpsTenantMigrationPlan',
        changed.version,
        `platform.ops-tenant-migration-${status.toLowerCase()}.v1`,
        { differenceCount, reconciliationReportId: report.id, status },
        context,
        metadata,
      );
      return toHttpJson({
        jobId: row.jobRunId,
        migration: changed,
        reconciliation: report,
      });
    });
  }

  private async attachJob(
    kind: OpsJobKind,
    aggregateId: string,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const queued = await this.scheduling.enqueueOpsOperation(
      { aggregateId, kind },
      context,
      metadata,
    );
    const jobId = String(
      (queued as { jobRunId?: string }).jobRunId ??
        (queued as { id?: string }).id ??
        '',
    );
    this.uuid(jobId);
    const delegate =
      kind === 'DR_DRILL'
        ? this.prisma.opsDrDrillReport
        : kind === 'ARCHIVE'
          ? this.prisma.opsArchiveJob
          : kind === 'PRIVACY'
            ? this.prisma.opsPrivacyRequest
            : this.prisma.opsTenantMigrationPlan;
    const changed = await (delegate as typeof this.prisma.opsArchiveJob).update(
      {
        data: {
          jobRunId: jobId,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: aggregateId },
      },
    );
    return toHttpJson({ ...changed, jobId });
  }

  private transitionRow<
    TStatus extends string,
    TCurrent extends { id: string; status: TStatus; version: number },
    TResult,
  >(
    kind: string,
    id: string,
    input: { expectedVersion: number; status: TStatus },
    map: Readonly<Record<TStatus, readonly TStatus[]>>,
    context: TenantContext,
    metadata: CommandMetadata,
    update: (
      tx: Prisma.TransactionClient,
      current: TCurrent,
    ) => Promise<TResult & { version: number; status: TStatus }>,
  ) {
    this.uuid(id);
    this.integer(input.expectedVersion, 'expectedVersion', 1);
    return this.prisma.$transaction(async (tx) => {
      const delegate =
        kind === 'alert'
          ? tx.opsMonitorAlert
          : kind === 'backup'
            ? tx.opsBackupSet
            : kind === 'release'
              ? tx.opsRelease
              : kind === 'migration'
                ? tx.opsMigrationRun
                : kind === 'privacy'
                  ? tx.opsPrivacyRequest
                  : tx.opsTenantMigrationPlan;
      const current = (await (delegate as typeof tx.opsBackupSet).findFirst({
        where: { id, tenantId: context.tenantId },
      })) as unknown as TCurrent | null;
      if (!current) this.notFound(kind);
      this.version(current.version, input.expectedVersion);
      this.transition(map, current.status, input.status, kind);
      const changed = await update(tx, current);
      await this.record(
        tx,
        id,
        `Ops${kind}`,
        changed.version,
        `platform.ops-${kind}-${input.status.toLowerCase()}.v1`,
        { status: input.status },
        context,
        metadata,
      );
      return toHttpJson(changed);
    });
  }

  private async record(
    tx: Prisma.TransactionClient,
    aggregateId: string,
    aggregateType: string,
    aggregateVersion: number,
    eventName: string,
    payload: JsonObject,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    await this.changes.record(
      tx,
      {
        aggregateId,
        aggregateType,
        aggregateVersion,
        eventName,
        payload: json(payload) as Prisma.InputJsonObject,
      },
      context,
      metadata,
    );
  }
  private transition<T extends string>(
    map: Readonly<Record<T, readonly T[]>>,
    current: T,
    target: T,
    name: string,
  ) {
    if (!map[current]?.includes(target))
      throw new AppError(
        'OPS_TRANSITION_INVALID',
        `${name} transition ${current} -> ${target} is not allowed`,
        409,
      );
  }
  private version(actual: number, expected: number) {
    if (actual !== expected)
      throw new AppError('OPS_VERSION_CONFLICT', 'Version conflict', 409);
  }
  private notFound(name: string): never {
    throw new AppError('OPS_NOT_FOUND', `${name} was not found`, 404);
  }
  private invalid(message: string): never {
    throw new AppError('OPS_INPUT_INVALID', message, 400);
  }
  private uuid(value: string) {
    if (!isUuid(value)) this.invalid('Identifier is invalid');
  }
  private text(value: unknown, field: string, max: number): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
      this.invalid(`${field} is invalid`);
    return value.trim();
  }
  private integer(
    value: number,
    field: string,
    min: number,
    max = Number.MAX_SAFE_INTEGER,
  ) {
    if (!Number.isInteger(value) || value < min || value > max)
      this.invalid(`${field} is invalid`);
  }
  private date(value: string, field: string): Date {
    const result = new Date(value);
    if (Number.isNaN(result.getTime())) this.invalid(`${field} is invalid`);
    return result;
  }
  private hash(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
  private compare(value: number, operator: string, threshold: number) {
    return operator === 'GT'
      ? value > threshold
      : operator === 'GTE'
        ? value >= threshold
        : operator === 'LT'
          ? value < threshold
          : value <= threshold;
  }
  private monitorRuleInput(input: MonitorRuleInput) {
    this.text(input.code, 'code', 100);
    this.text(input.name, 'name', 200);
    this.text(input.signal, 'signal', 100);
    this.text(input.ownerRef, 'ownerRef', 200);
    this.integer(input.durationSeconds, 'durationSeconds', 0, 86400);
    this.integer(input.dedupSeconds, 'dedupSeconds', 1, 86400);
    if (!Number.isFinite(input.threshold)) this.invalid('threshold is invalid');
  }
  private reconcile(source: JsonObject, target: JsonObject) {
    return [...new Set([...Object.keys(source), ...Object.keys(target)])]
      .sort()
      .map((key) => ({
        equal: JSON.stringify(source[key]) === JSON.stringify(target[key]),
        key,
        kind:
          key.toLowerCase().includes('amount') ||
          key.toLowerCase().includes('money')
            ? 'MONEY'
            : key.toLowerCase().includes('status')
              ? 'STATUS'
              : 'COUNT',
        source: source[key] ?? null,
        target: target[key] ?? null,
      }));
  }
}

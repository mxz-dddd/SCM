import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { IdempotencyService } from './idempotency.service';
import { JobService } from './job.service';
import { ObservabilityService } from './observability.service';
import { OperationsService } from './operations.service';
import { ChangeRecordingFacade } from './public/change-recording.facade';
import { JobSchedulingFacade } from './public/job-scheduling.facade';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();
type OpsRow = Record<string, unknown> & {
  id: string;
  jobId?: string;
  status: string;
  version: number;
};

databaseDescribe('platform production operations governance', () => {
  afterAll(() => prisma.$disconnect());

  it('governs monitoring, recovery, delivery, retention, privacy, capacity and tenant migration evidence', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'operations-database-test',
      organizationIds: [randomUUID()],
      permissionVersion: 1,
      tenantId,
      tokenId: randomUUID(),
    };
    const command = () => ({
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      ipAddress: '127.0.0.1',
    });
    const queue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      scheduleDefinition: vi.fn().mockResolvedValue(undefined),
    };
    const scheduling = new JobSchedulingFacade(
      new JobService(
        new IdempotencyService(prisma as never),
        queue as never,
        prisma as never,
      ),
    );
    const service = new OperationsService(
      new ChangeRecordingFacade(),
      scheduling,
      new ObservabilityService(),
      prisma as never,
    );

    const draftRule = await service.createMonitorRule(
      {
        code: 'QUEUE.BACKLOG',
        dedupSeconds: 300,
        dimensionFilter: {},
        durationSeconds: 60,
        name: 'Queue backlog',
        operator: 'GT',
        ownerRef: 'SRE',
        severity: 'CRITICAL',
        signal: 'queue.backlog',
        threshold: 100,
      },
      context,
      command(),
    );
    await service.transitionDefinition(
      'MONITOR',
      String(draftRule.id),
      { expectedVersion: Number(draftRule.version), status: 'ACTIVE' },
      context,
      command(),
    );
    const firstSignal = await service.ingestSignal(
      {
        dimensions: { queue: 'job-run' },
        domain: 'PLATFORM',
        signal: 'queue.backlog',
        traceId: randomUUID(),
        unit: 'jobs',
        value: 150,
      },
      context,
      command(),
    );
    const secondSignal = await service.ingestSignal(
      {
        dimensions: { queue: 'job-run' },
        domain: 'PLATFORM',
        signal: 'queue.backlog',
        traceId: randomUUID(),
        unit: 'jobs',
        value: 175,
      },
      context,
      command(),
    );
    expect(firstSignal.alerts).toHaveLength(1);
    expect(secondSignal.alerts[0]).toMatchObject({ triggerCount: 2 });
    let alert = await prisma.opsMonitorAlert.findFirstOrThrow({
      where: { tenantId },
    });
    alert = (await service.transitionAlert(
      alert.id,
      { expectedVersion: alert.version, status: 'ACKNOWLEDGED' },
      context,
      command(),
    )) as typeof alert;
    alert = (await service.transitionAlert(
      alert.id,
      {
        expectedVersion: alert.version,
        resolution: 'Worker scaled out',
        status: 'RESOLVED',
      },
      context,
      command(),
    )) as typeof alert;
    await expect(
      service.transitionAlert(
        alert.id,
        { expectedVersion: alert.version, status: 'ACKNOWLEDGED' },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'OPS_TRANSITION_INVALID' });

    let backup = await service.createBackup(
      {
        backupNo: `B-${randomUUID()}`,
        environment: 'prod-cn',
        policy: {
          databasePitr: true,
          objectVersioning: true,
          crossRegion: 'cn-north',
          walArchive: true,
        },
        targetRpoMinutes: 15,
        targetRtoMinutes: 60,
      },
      context,
      command(),
    );
    backup = await service.transitionBackup(
      String(backup.id),
      { expectedVersion: Number(backup.version), status: 'RUNNING' },
      context,
      command(),
    );
    backup = await service.transitionBackup(
      String(backup.id),
      {
        artifact: {
          baseBackup: 's3://redacted/base',
          objectManifest: 'sha256:test',
          verified: true,
        },
        expectedVersion: Number(backup.version),
        status: 'VERIFIED',
      },
      context,
      command(),
    );
    const drill = await service.queueDrill(
      {
        backupSetId: String(backup.id),
        drillNo: `DR-${randomUUID()}`,
        exercise: {
          achievedRpoMinutes: 5,
          achievedRtoMinutes: 25,
          secondaryWriterEnabled: false,
        },
        singleWriterFence: `fence-${randomUUID()}`,
      },
      context,
      command(),
    );
    expect(drill).toMatchObject({
      jobId: expect.any(String),
      status: 'QUEUED',
    });
    const drillResult = await service.executeJob(
      {
        aggregateId: String(drill.id),
        jobRunId: String(drill.jobId),
        kind: 'DR_DRILL',
      },
      context,
      command(),
    );
    expect(drillResult).toMatchObject({
      achievedRpoMinutes: 5,
      achievedRtoMinutes: 25,
      status: 'PASSED',
    });

    let release = await service.createRelease(
      {
        artifacts: {
          imageScanPassed: true,
          migrationSafetyPassed: true,
          testsPassed: true,
        },
        commitSha: 'a'.repeat(40),
        environment: 'prod-cn',
        imageDigest: `sha256:${'b'.repeat(64)}`,
        releaseNo: `REL-${randomUUID()}`,
      },
      context,
      command(),
    );
    release = await service.transitionRelease(
      String(release.id),
      { expectedVersion: Number(release.version), status: 'VALIDATED' },
      context,
      command(),
    );
    const migration = await service.createMigrationRun(
      {
        compatibility: { dualRead: true, dualWrite: true },
        lockRisk: { peakLargeTableLock: false },
        migrationName: 'expand-ops-index',
        phase: 'EXPAND',
        releaseId: String(release.id),
      },
      context,
      command(),
    );
    let migrationRunning = await service.transitionMigrationRun(
      String(migration.id),
      {
        evidence: { online: true },
        expectedVersion: Number(migration.version),
        status: 'RUNNING',
      },
      context,
      command(),
    );
    migrationRunning = await service.transitionMigrationRun(
      String(migration.id),
      {
        evidence: { checksum: 'ok' },
        expectedVersion: Number(migrationRunning.version),
        status: 'COMPLETED',
      },
      context,
      command(),
    );
    expect(migrationRunning).toMatchObject({
      phase: 'EXPAND',
      status: 'COMPLETED',
    });
    release = await service.transitionRelease(
      String(release.id),
      {
        canary: { errorBudgetHealthy: true, trafficPercent: 5 },
        expectedVersion: Number(release.version),
        status: 'CANARY',
      },
      context,
      command(),
    );
    release = await service.transitionRelease(
      String(release.id),
      { expectedVersion: Number(release.version), status: 'ROLLED_OUT' },
      context,
      command(),
    );
    expect(release).toMatchObject({ status: 'ROLLED_OUT' });
    await expect(
      service.createMigrationRun(
        {
          compatibility: { oldReadersActive: true },
          lockRisk: { peakLargeTableLock: false },
          migrationName: 'drop-old-column',
          phase: 'CONTRACT',
          releaseId: String(release.id),
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'OPS_RELEASE_NOT_VALIDATED' });

    const draftRetention = await service.createRetention(
      {
        archiveAfterDays: 30,
        archiveTier: 'COLD',
        category: 'TELEMETRY',
        contract: { searchable: true },
        deleteAllowed: true,
        legalHold: false,
        retainDays: 365,
      },
      context,
      command(),
    );
    const retention = (await service.transitionDefinition(
      'RETENTION',
      String(draftRetention.id),
      { expectedVersion: Number(draftRetention.version), status: 'ACTIVE' },
      context,
      command(),
    )) as unknown as OpsRow;
    const archive = (await service.queueArchive(
      {
        candidates: {
          records: [
            { domain: 'INTEGRATION', refHash: 'one' },
            { domain: 'TMS', refHash: 'two' },
          ],
        },
        cutoffAt: '2030-01-01T00:00:00.000Z',
        policyId: String(retention.id),
      },
      context,
      command(),
    )) as unknown as OpsRow;
    expect(archive.jobId).toEqual(expect.any(String));
    const archived = await service.executeJob(
      {
        aggregateId: String(archive.id),
        jobRunId: String(archive.jobId),
        kind: 'ARCHIVE',
      },
      context,
      command(),
    );
    expect(archived).toMatchObject({
      archivedCount: 2,
      deletedCount: 2,
      status: 'COMPLETED',
    });
    await expect(
      prisma.opsArchiveJob.update({
        data: { candidateSnapshot: { count: 999 } },
        where: { id: String(archive.id) },
      }),
    ).rejects.toThrow(/OPS_ARCHIVE_INPUT_IMMUTABLE/);

    const receivedPrivacy = await service.createPrivacyRequest(
      {
        dueAt: '2035-01-01T00:00:00.000Z',
        legalBasis: { retainAudit: true },
        requestNo: `DSR-${randomUUID()}`,
        requestType: 'DELETE',
        scope: { domains: ['OMS', 'TMS'] },
        subjectRef: 'person@example.invalid',
      },
      context,
      command(),
    );
    const verifiedPrivacy = (await service.transitionPrivacy(
      String(receivedPrivacy.id),
      {
        expectedVersion: Number(receivedPrivacy.version),
        status: 'VERIFIED',
        verification: { factor: 'SIGNED_ASSERTION' },
      },
      context,
      command(),
    )) as unknown as OpsRow;
    const privacy = (await service.transitionPrivacy(
      String(verifiedPrivacy.id),
      { expectedVersion: Number(verifiedPrivacy.version), status: 'QUEUED' },
      context,
      command(),
    )) as unknown as OpsRow;
    const fulfilled = await service.executeJob(
      {
        aggregateId: String(privacy.id),
        jobRunId: String(privacy.jobId),
        kind: 'PRIVACY',
      },
      context,
      command(),
    );
    expect(fulfilled).toMatchObject({ status: 'FULFILLED' });
    expect(
      await prisma.opsRedactionRecord.count({
        where: { privacyRequestId: String(privacy.id), tenantId },
      }),
    ).toBe(2);
    const redaction = await prisma.opsRedactionRecord.findFirstOrThrow({
      where: { tenantId },
    });
    await expect(
      prisma.opsRedactionRecord.update({
        data: { outcome: 'TAMPERED' },
        where: { id: redaction.id },
      }),
    ).rejects.toThrow(/OPS_IMMUTABLE_RECORD/);

    const draftCapacity = await service.createCapacity(
      {
        code: 'API.REQUESTS',
        domain: 'PLATFORM',
        effectiveFrom: '2030-01-01T00:00:00.000Z',
        quota: { daily: 100000, exportsConcurrent: 3 },
        scaling: { maxReplicas: 20, targetCpu: 65 },
        tiering: { hotDays: 30, warmDays: 180 },
      },
      context,
      command(),
    );
    const capacity = (await service.transitionDefinition(
      'CAPACITY',
      String(draftCapacity.id),
      { expectedVersion: Number(draftCapacity.version), status: 'ACTIVE' },
      context,
      command(),
    )) as unknown as OpsRow;
    expect(capacity).toMatchObject({ status: 'ACTIVE' });

    const draftPlan = await service.createTenantMigration(
      {
        dependencies: { satisfied: true },
        planNo: `TM-${randomUUID()}`,
        rollback: { tested: true },
        scope: { domains: ['MDM', 'OMS'] },
        sourceEnvironment: 'pilot',
        sourceTotals: {
          orderCount: 12,
          orderStatus: { OPEN: 12 },
          totalAmount: '100.00 CNY',
        },
        targetEnvironment: 'prod',
        targetTotals: {
          orderCount: 12,
          orderStatus: { OPEN: 12 },
          totalAmount: '100.00 CNY',
        },
      },
      context,
      command(),
    );
    const validatedPlan = (await service.transitionTenantMigration(
      String(draftPlan.id),
      { expectedVersion: Number(draftPlan.version), status: 'VALIDATED' },
      context,
      command(),
    )) as unknown as OpsRow;
    const plan = (await service.transitionTenantMigration(
      String(validatedPlan.id),
      { expectedVersion: Number(validatedPlan.version), status: 'QUEUED' },
      context,
      command(),
    )) as unknown as OpsRow;
    const migrated = await service.executeJob(
      {
        aggregateId: String(plan.id),
        jobRunId: String(plan.jobId),
        kind: 'TENANT_MIGRATION',
      },
      context,
      command(),
    );
    expect(migrated).toMatchObject({
      migration: { status: 'COMPLETED' },
      reconciliation: { differenceCount: 0 },
    });
    const report =
      await prisma.opsMigrationReconciliationReport.findFirstOrThrow({
        where: { tenantId },
      });
    await expect(
      prisma.opsMigrationReconciliationReport.update({
        data: { differenceCount: 9 },
        where: { id: report.id },
      }),
    ).rejects.toThrow(/OPS_IMMUTABLE_RECORD/);

    expect(
      await prisma.platformAuditLog.count({ where: { tenantId } }),
    ).toBeGreaterThan(20);
    expect(
      await prisma.platformOutbox.count({ where: { tenantId } }),
    ).toBeGreaterThan(20);
    expect(queue.enqueue).toHaveBeenCalledTimes(4);
  });
});

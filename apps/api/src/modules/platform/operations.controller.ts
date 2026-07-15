import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { TenantRequest } from './auth/tenant-context.middleware';
import { RequirePermission } from './auth/permission.decorator';
import { PermissionGuard } from './auth/permission.guard';
import { WorkerAccessible } from './auth/worker-access.decorator';
import { Idempotent } from './idempotent.decorator';
import {
  type BackupInput,
  type CapacityInput,
  type MonitorRuleInput,
  OperationsService,
  type PrivacyInput,
  type ReleaseInput,
  type RetentionInput,
  type SignalInput,
  type TenantMigrationInput,
} from './operations.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  idempotencyKey?: string,
) => ({
  correlationId,
  idempotencyKey,
  ipAddress: request.ip,
});

@Controller('api/v1/platform/operations')
@UseGuards(PermissionGuard)
export class OperationsController {
  constructor(
    @Inject(OperationsService) private readonly operations: OperationsService,
  ) {}

  @Get('workbench')
  @RequirePermission('platform.operations.read')
  workbench(@Req() request: TenantRequest) {
    return this.operations.workbench(request.tenantContext);
  }

  @Get('telemetry')
  @RequirePermission('platform.operations.telemetry.read')
  telemetry() {
    return this.operations.telemetrySnapshot();
  }

  @Get('metrics')
  @RequirePermission('platform.operations.telemetry.read')
  metrics(@Res() response: Response) {
    response
      .type('text/plain; version=0.0.4')
      .send(this.operations.prometheus());
  }

  @Post('monitor-rules')
  @Idempotent('platform.ops.monitor-rule.create.v1')
  @RequirePermission('platform.operations.monitor.manage')
  createMonitorRule(
    @Body() input: MonitorRuleInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.createMonitorRule(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('definitions/:kind/:id/transition')
  @Idempotent('platform.ops.definition.transition.v1')
  @RequirePermission('platform.operations.policy.manage')
  transitionDefinition(
    @Param('kind') kind: 'CAPACITY' | 'MONITOR' | 'RETENTION',
    @Param('id') id: string,
    @Body() input: Parameters<OperationsService['transitionDefinition']>[2],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.transitionDefinition(
      kind,
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('signals')
  @Idempotent('platform.ops.signal.ingest.v1')
  @RequirePermission('platform.operations.signal.ingest')
  signal(
    @Body() input: SignalInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.ingestSignal(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('alerts/:id/transition')
  @Idempotent('platform.ops.alert.transition.v1')
  @RequirePermission('platform.operations.alert.manage')
  alert(
    @Param('id') id: string,
    @Body() input: Parameters<OperationsService['transitionAlert']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.transitionAlert(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('backups')
  @Idempotent('platform.ops.backup.create.v1')
  @RequirePermission('platform.operations.recovery.manage')
  backup(
    @Body() input: BackupInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.createBackup(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('backups/:id/transition')
  @Idempotent('platform.ops.backup.transition.v1')
  @RequirePermission('platform.operations.recovery.manage')
  backupTransition(
    @Param('id') id: string,
    @Body() input: Parameters<OperationsService['transitionBackup']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.transitionBackup(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('dr-drills')
  @Idempotent('platform.ops.dr-drill.queue.v1')
  @RequirePermission('platform.operations.recovery.manage')
  drill(
    @Body() input: Parameters<OperationsService['queueDrill']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.queueDrill(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('releases')
  @Idempotent('platform.ops.release.create.v1')
  @RequirePermission('platform.operations.release.manage')
  release(
    @Body() input: ReleaseInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.createRelease(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('releases/:id/transition')
  @Idempotent('platform.ops.release.transition.v1')
  @RequirePermission('platform.operations.release.manage')
  releaseTransition(
    @Param('id') id: string,
    @Body() input: Parameters<OperationsService['transitionRelease']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.transitionRelease(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('migration-runs')
  @Idempotent('platform.ops.migration-run.create.v1')
  @RequirePermission('platform.operations.release.manage')
  migrationRun(
    @Body() input: Parameters<OperationsService['createMigrationRun']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.createMigrationRun(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('migration-runs/:id/transition')
  @Idempotent('platform.ops.migration-run.transition.v1')
  @RequirePermission('platform.operations.release.manage')
  migrationRunTransition(
    @Param('id') id: string,
    @Body() input: Parameters<OperationsService['transitionMigrationRun']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.transitionMigrationRun(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('retention-policies')
  @Idempotent('platform.ops.retention.create.v1')
  @RequirePermission('platform.operations.policy.manage')
  retention(
    @Body() input: RetentionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.createRetention(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('archive-jobs')
  @Idempotent('platform.ops.archive.queue.v1')
  @RequirePermission('platform.operations.archive.manage')
  archive(
    @Body() input: Parameters<OperationsService['queueArchive']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.queueArchive(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('privacy-requests')
  @Idempotent('platform.ops.privacy.create.v1')
  @RequirePermission('platform.operations.privacy.manage')
  privacy(
    @Body() input: PrivacyInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.createPrivacyRequest(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('privacy-requests/:id/transition')
  @Idempotent('platform.ops.privacy.transition.v1')
  @RequirePermission('platform.operations.privacy.manage')
  privacyTransition(
    @Param('id') id: string,
    @Body() input: Parameters<OperationsService['transitionPrivacy']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.transitionPrivacy(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('capacity-plans')
  @Idempotent('platform.ops.capacity.create.v1')
  @RequirePermission('platform.operations.capacity.manage')
  capacity(
    @Body() input: CapacityInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.createCapacity(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('tenant-migrations')
  @Idempotent('platform.ops.tenant-migration.create.v1')
  @RequirePermission('platform.operations.migration.manage')
  tenantMigration(
    @Body() input: TenantMigrationInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.createTenantMigration(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('tenant-migrations/:id/transition')
  @Idempotent('platform.ops.tenant-migration.transition.v1')
  @RequirePermission('platform.operations.migration.manage')
  tenantMigrationTransition(
    @Param('id') id: string,
    @Body()
    input: Parameters<OperationsService['transitionTenantMigration']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.transitionTenantMigration(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('jobs/execute')
  @WorkerAccessible('OPERATIONS_JOB_EXECUTE')
  @Idempotent('platform.ops.job.execute.v1')
  @RequirePermission('platform.operations.job.process')
  execute(
    @Body() input: Parameters<OperationsService['executeJob']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.operations.executeJob(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}

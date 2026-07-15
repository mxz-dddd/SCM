import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { TenantRequest } from './auth/tenant-context.middleware';
import { RequirePermission } from './auth/permission.decorator';
import { PermissionGuard } from './auth/permission.guard';
import { WorkerAccessible } from './auth/worker-access.decorator';
import {
  JobService,
  type CancelJobInput,
  type CompleteJobInput,
  type HeartbeatJobInput,
  type LeaseJobInput,
  type ProgressJobInput,
  type SaveJobDefinitionInput,
  type TriggerJobInput,
} from './job.service';

@Controller('api/v1/platform/jobs')
@UseGuards(PermissionGuard)
export class JobController {
  constructor(@Inject(JobService) private readonly jobs: JobService) {}

  @Get('definitions')
  @RequirePermission('platform.job.read')
  listDefinitions(@Req() request: TenantRequest) {
    return this.jobs.listDefinitions(request.tenantContext);
  }

  @Post('definitions')
  @RequirePermission('platform.job.write')
  saveDefinition(
    @Body() input: SaveJobDefinitionInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.jobs.saveDefinition(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Get('runs')
  @RequirePermission('platform.job.read')
  listRuns(
    @Query('status') status: string | undefined,
    @Req() request: TenantRequest,
  ) {
    return this.jobs.listRuns(request.tenantContext, status);
  }

  @Get('runs/:jobRunId')
  @WorkerAccessible('JOB_GET')
  @RequirePermission('platform.job.read')
  getRun(@Param('jobRunId') jobRunId: string, @Req() request: TenantRequest) {
    return this.jobs.getRun(jobRunId, request.tenantContext);
  }

  @Get('runs/:jobRunId/logs')
  @RequirePermission('platform.job.read')
  listLogs(@Param('jobRunId') jobRunId: string, @Req() request: TenantRequest) {
    return this.jobs.listLogs(jobRunId, request.tenantContext);
  }

  @Post('definitions/:jobDefinitionId/runs')
  @WorkerAccessible('JOB_TRIGGER')
  @HttpCode(202)
  @RequirePermission('platform.job.trigger')
  trigger(
    @Param('jobDefinitionId') jobDefinitionId: string,
    @Body() input: TriggerJobInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.jobs.trigger(jobDefinitionId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('events/:eventName')
  @HttpCode(202)
  @RequirePermission('platform.job.trigger')
  triggerEvent(
    @Param('eventName') eventName: string,
    @Body() input: TriggerJobInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.jobs.triggerEvent(eventName, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('runs/:jobRunId/claim')
  @WorkerAccessible('JOB_RUN_CLAIM')
  @HttpCode(200)
  @RequirePermission('platform.job.process')
  claim(
    @Param('jobRunId') jobRunId: string,
    @Body() input: LeaseJobInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.jobs.claim(jobRunId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('runs/:jobRunId/heartbeat')
  @WorkerAccessible('JOB_HEARTBEAT')
  @HttpCode(200)
  @RequirePermission('platform.job.process')
  heartbeat(
    @Param('jobRunId') jobRunId: string,
    @Body() input: HeartbeatJobInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.jobs.heartbeat(jobRunId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('runs/:jobRunId/progress')
  @WorkerAccessible('JOB_PROGRESS')
  @HttpCode(200)
  @RequirePermission('platform.job.process')
  progress(
    @Param('jobRunId') jobRunId: string,
    @Body() input: ProgressJobInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.jobs.progress(jobRunId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('runs/:jobRunId/complete')
  @WorkerAccessible('JOB_COMPLETE')
  @HttpCode(200)
  @RequirePermission('platform.job.process')
  complete(
    @Param('jobRunId') jobRunId: string,
    @Body() input: CompleteJobInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.jobs.complete(jobRunId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('runs/:jobRunId/cancel')
  @HttpCode(200)
  @RequirePermission('platform.job.cancel')
  cancel(
    @Param('jobRunId') jobRunId: string,
    @Body() input: CancelJobInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.jobs.cancel(jobRunId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }
}

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
import {
  WorkflowService,
  type ApprovalCommandInput,
  type BatchApprovalInput,
  type SaveWorkflowDefinitionInput,
  type StartWorkflowInput,
  type VersionInput,
} from './workflow.service';

@Controller('api/v1/platform')
@UseGuards(PermissionGuard)
export class WorkflowController {
  constructor(
    @Inject(WorkflowService) private readonly workflows: WorkflowService,
  ) {}

  @Get('workflow-definitions')
  @RequirePermission('platform.workflow-definition.read')
  listDefinitions(@Req() request: TenantRequest) {
    return this.workflows.listDefinitions(request.tenantContext);
  }

  @Post('workflow-definitions')
  @RequirePermission('platform.workflow-definition.write')
  saveDefinition(
    @Body() input: SaveWorkflowDefinitionInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.workflows.saveDefinition(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('workflow-definitions/:definitionId/publish')
  @HttpCode(200)
  @RequirePermission('platform.workflow-definition.write')
  publishDefinition(
    @Param('definitionId') definitionId: string,
    @Body() input: VersionInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.workflows.publishDefinition(
      definitionId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Post('workflow-instances')
  @HttpCode(202)
  @RequirePermission('platform.workflow.start')
  start(
    @Body() input: StartWorkflowInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.workflows.start(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Get('workflow-instances/:workflowInstanceId')
  @RequirePermission('platform.approval.read')
  getInstance(
    @Param('workflowInstanceId') workflowInstanceId: string,
    @Req() request: TenantRequest,
  ) {
    return this.workflows.getInstance(
      workflowInstanceId,
      request.tenantContext,
    );
  }

  @Post('workflow-instances/:workflowInstanceId/withdraw')
  @HttpCode(200)
  @RequirePermission('platform.workflow.start')
  withdraw(
    @Param('workflowInstanceId') workflowInstanceId: string,
    @Body() input: VersionInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.workflows.withdraw(
      workflowInstanceId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Get('approval-tasks')
  @RequirePermission('platform.approval.read')
  listTasks(
    @Query('status') status: string | undefined,
    @Req() request: TenantRequest,
  ) {
    return this.workflows.listTasks(request.tenantContext, status);
  }

  @Post('approval-tasks/batch')
  @HttpCode(200)
  @RequirePermission('platform.approval.act')
  batch(
    @Body() input: BatchApprovalInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.workflows.batch(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('approval-tasks/:approvalTaskId/actions')
  @HttpCode(200)
  @RequirePermission('platform.approval.act')
  command(
    @Param('approvalTaskId') approvalTaskId: string,
    @Body() input: ApprovalCommandInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.workflows.command(
      approvalTaskId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }
}

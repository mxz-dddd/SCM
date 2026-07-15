import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import type { BusinessEventInput } from '../platform/event.service';
import { Idempotent } from '../platform/idempotent.decorator';
import {
  type AlertCaseActionInput,
  AlertGovernanceService,
  type PublishAlertRuleInput,
  type StartControlSlaInput,
  type TransitionControlSlaInput,
} from './alert-governance.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/control')
@UseGuards(PermissionGuard)
export class AlertGovernanceController {
  constructor(
    @Inject(AlertGovernanceService)
    private readonly service: AlertGovernanceService,
  ) {}

  @Post('slas')
  @Idempotent('control.sla.start.v1')
  @RequirePermission('control.sla.manage')
  startSla(
    @Body() input: StartControlSlaInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.startSla(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('slas/:id/transition')
  @Idempotent('control.sla.transition.v1')
  @RequirePermission('control.sla.manage')
  transitionSla(
    @Param('id') id: string,
    @Body() input: TransitionControlSlaInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionSla(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('slas/:id/reopen')
  @Idempotent('control.sla.reopen.v1')
  @RequirePermission('control.sla.reopen')
  reopenSla(
    @Param('id') id: string,
    @Body()
    input: {
      calendarCode: string;
      durationMinutes: number;
      expectedVersion: number;
      reason: string;
      sourceVersion: number;
      warningLeadMinutes: number;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.reopenSla(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('slas/monitor')
  @Idempotent('control.sla.monitor.v1')
  @RequirePermission('control.sla.manage')
  monitorSla(
    @Body() input: { limit?: number; now?: string },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.monitorSla(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('alert-rules')
  @Idempotent('control.alert-rule.publish.v1')
  @RequirePermission('control.alert.rule.manage')
  publishRule(
    @Body() input: PublishAlertRuleInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.publishRule(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('alert-events/consume')
  @Idempotent('control.alert-event.consume.v1')
  @RequirePermission('control.alert.consume')
  consumeAlertEvent(
    @Body() event: BusinessEventInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.consumeAlertEvent(
      event,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('alerts/:id/assign')
  @Idempotent('control.alert.assign.v1')
  @RequirePermission('control.alert.assign')
  assignCase(
    @Param('id') id: string,
    @Body()
    input: { expectedVersion: number; ownerRef: string; reason: string },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.assignCase(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('alerts/:id/actions')
  @Idempotent('control.alert.action.v1')
  @RequirePermission('control.alert.manage')
  actionCase(
    @Param('id') id: string,
    @Body() input: AlertCaseActionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.actionCase(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('alerts/:id/remediation')
  @Idempotent('control.alert.remediation.v1')
  @RequirePermission('control.alert.remediate')
  requestRemediation(
    @Param('id') id: string,
    @Body()
    input: {
      command: Readonly<Record<string, unknown>>;
      commandType: string;
      reason: string;
      targetDomain: string;
      targetRef: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.requestRemediation(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('alert-escalations/monitor')
  @Idempotent('control.alert-escalation.monitor.v1')
  @RequirePermission('control.alert.escalate')
  monitorEscalations(
    @Body() input: { limit?: number; now?: string },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.monitorEscalations(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('knowledge')
  @Idempotent('control.knowledge.publish.v1')
  @RequirePermission('control.knowledge.manage')
  publishKnowledge(
    @Body()
    input: {
      articleCode: string;
      content: Readonly<Record<string, unknown>>;
      recommendations: Readonly<Record<string, unknown>>;
      rootCauseCode: string;
      sourceCaseIds: readonly string[];
      title: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.publishKnowledge(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Get('alerts/workbench')
  @RequirePermission('control.alert.read')
  workbench(
    @Query('query') query: string | undefined,
    @Req() request: TenantRequest,
  ) {
    return this.service.workbench(request.tenantContext, query);
  }
}

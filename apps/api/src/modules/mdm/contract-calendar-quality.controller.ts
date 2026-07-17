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
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import {
  ContractCalendarQualityService,
  type ApprovalDecisionInput,
  type ApprovalSubmitInput,
  type AssessQualityInput,
  type EvaluateCalendarInput,
  type ResolveIssueInput,
  type SaveCalendarDateInput,
  type SaveCalendarInput,
  type SaveContractInput,
  type SaveRateCardInput,
  type SaveRateVersionInput,
  type SaveShiftInput,
  type SaveWorkingWindowInput,
  type VersionInput,
} from './contract-calendar-quality.service';
function meta(request: TenantRequest, correlationId: string, key?: string) {
  return { correlationId, idempotencyKey: key, ipAddress: request.ip };
}
@Controller('api/v1/mdm')
@UseGuards(PermissionGuard)
export class ContractCalendarQualityController {
  constructor(
    @Inject(ContractCalendarQualityService)
    private readonly service: ContractCalendarQualityService,
  ) {}
  @Get('contracts') @RequirePermission('mdm.contract.read') listContracts(
    @Req() request: TenantRequest,
  ) {
    return this.service.listContracts(request.tenantContext);
  }
  @Get('contracts/:id') @RequirePermission('mdm.contract.read') getContract(
    @Param('id') id: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.getContract(id, request.tenantContext);
  }
  @Post('contracts') @RequirePermission('mdm.contract.write') createContract(
    @Body() input: SaveContractInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createContract(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('contracts/:id/submit')
  @HttpCode(200)
  @RequirePermission('mdm.contract.write')
  submitContract(
    @Param('id') id: string,
    @Body() input: ApprovalSubmitInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.submitContract(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('contracts/:id/decision')
  @HttpCode(200)
  @RequirePermission('mdm.contract.approve')
  decideContract(
    @Param('id') id: string,
    @Body() input: ApprovalDecisionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.decideContract(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('contracts/:id/:target')
  @HttpCode(200)
  @RequirePermission('mdm.contract.write')
  changeContract(
    @Param('id') id: string,
    @Param('target') target: string,
    @Body() input: VersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    if (!['ACTIVE', 'SUSPENDED', 'EXPIRED', 'INACTIVE'].includes(target))
      throw new Error('Unsupported contract target');
    return this.service.changeContract(
      id,
      target as 'ACTIVE' | 'EXPIRED' | 'INACTIVE' | 'SUSPENDED',
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('rate-cards') @RequirePermission('mdm.contract.write') createRateCard(
    @Body() input: SaveRateCardInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createRateCard(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('rate-versions')
  @RequirePermission('mdm.contract.write')
  createRateVersion(
    @Body() input: SaveRateVersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createRateVersion(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('rate-versions/:id/:target')
  @HttpCode(200)
  @RequirePermission('mdm.contract.approve')
  transitionRate(
    @Param('id') id: string,
    @Param('target') target: string,
    @Body() input: VersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    if (!['PUBLISHED', 'RETIRED'].includes(target))
      throw new Error('Unsupported rate target');
    return this.service.transitionRate(
      id,
      target as 'PUBLISHED' | 'RETIRED',
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Get('calendars') @RequirePermission('mdm.calendar.read') listCalendars(
    @Req() request: TenantRequest,
  ) {
    return this.service.listCalendars(request.tenantContext);
  }
  @Post('calendars') @RequirePermission('mdm.calendar.write') createCalendar(
    @Body() input: SaveCalendarInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createCalendar(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('calendar-dates') @RequirePermission('mdm.calendar.write') addDate(
    @Body() input: SaveCalendarDateInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.addCalendarDate(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('shifts') @RequirePermission('mdm.calendar.write') addShift(
    @Body() input: SaveShiftInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.addShift(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('working-windows') @RequirePermission('mdm.calendar.write') addWindow(
    @Body() input: SaveWorkingWindowInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.addWorkingWindow(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('calendars/:id/:target')
  @HttpCode(200)
  @RequirePermission('mdm.calendar.write')
  transitionCalendar(
    @Param('id') id: string,
    @Param('target') target: string,
    @Body() input: VersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    if (!['ACTIVE', 'INACTIVE'].includes(target))
      throw new Error('Unsupported calendar target');
    return this.service.transitionCalendar(
      id,
      target as 'ACTIVE' | 'INACTIVE',
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Get('calendars/evaluate') @RequirePermission('mdm.calendar.read') evaluate(
    @Query() input: EvaluateCalendarInput,
    @Req() request: TenantRequest,
  ) {
    return this.service.evaluateCalendar(input, request.tenantContext);
  }
  @Get('quality-assessments')
  @RequirePermission('mdm.quality.read')
  listQuality(@Req() request: TenantRequest) {
    return this.service.listQuality(request.tenantContext);
  }
  @Post('quality-assessments') @RequirePermission('mdm.quality.write') assess(
    @Body() input: AssessQualityInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.assessQuality(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('quality-assessments/:id/submit')
  @HttpCode(200)
  @RequirePermission('mdm.quality.write')
  submitQuality(
    @Param('id') id: string,
    @Body() input: ApprovalSubmitInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.submitQuality(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('quality-assessments/:id/decision')
  @HttpCode(200)
  @RequirePermission('mdm.quality.approve')
  decideQuality(
    @Param('id') id: string,
    @Body() input: ApprovalDecisionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.decideQuality(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('quality-issues/:id/resolve')
  @HttpCode(200)
  @RequirePermission('mdm.quality.write')
  resolveIssue(
    @Param('id') id: string,
    @Body() input: ResolveIssueInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.resolveIssue(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
}

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
import { Idempotent } from '../platform/idempotent.decorator';
import { AppointmentIntakeService } from './appointment-intake.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/ams')
@UseGuards(PermissionGuard)
export class AppointmentIntakeController {
  constructor(
    @Inject(AppointmentIntakeService)
    private readonly service: AppointmentIntakeService,
  ) {}

  @Get('appointments/workbench')
  @RequirePermission('ams.appointment.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Get('slot-availability')
  @RequirePermission('ams.appointment.read')
  availability(
    @Query() query: Parameters<AppointmentIntakeService['availability']>[0],
    @Req() request: TenantRequest,
  ) {
    return this.service.availability(query, request.tenantContext);
  }

  @Post('appointment-drafts')
  @Idempotent('ams.appointment.draft-save.v1')
  @RequirePermission('ams.appointment.create')
  saveDraft(
    @Body() input: Parameters<AppointmentIntakeService['saveDraft']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.saveDraft(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('appointments')
  @Idempotent('ams.appointment.create-submit.v1')
  @RequirePermission('ams.appointment.create')
  createAndSubmit(
    @Body()
    input: Parameters<AppointmentIntakeService['createAndSubmit']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createAndSubmit(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('appointments/:id/submit')
  @HttpCode(200)
  @Idempotent('ams.appointment.submit.v1')
  @RequirePermission('ams.appointment.create')
  submit(
    @Param('id') id: string,
    @Body() input: Parameters<AppointmentIntakeService['submit']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.submit(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('appointments/:id/decide')
  @HttpCode(200)
  @Idempotent('ams.appointment.decision.v1')
  @RequirePermission('ams.appointment.approve')
  decide(
    @Param('id') id: string,
    @Body() input: Parameters<AppointmentIntakeService['decide']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.decide(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('recurring-appointments')
  @Idempotent('ams.appointment.recurring-create.v1')
  @RequirePermission('ams.appointment.recurring')
  createRecurring(
    @Body()
    input: Parameters<AppointmentIntakeService['createRecurring']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createRecurring(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}

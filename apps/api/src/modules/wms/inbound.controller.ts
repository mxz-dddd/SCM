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
import {
  type AssignTaskInput,
  type CheckInInput,
  type CreateInboundInput,
  type CreateReceiptTasksInput,
  InboundService,
  type ManualResolveInput,
  type ParsePackagesInput,
  type ProjectAppointmentInput,
  type ScanBarcodeInput,
  type TransitionTaskInput,
  type VersionInput,
} from './inbound.service';
function metadata(request: TenantRequest, correlationId: string, key?: string) {
  return { correlationId, idempotencyKey: key, ipAddress: request.ip };
}
@Controller('api/v1/wms')
@UseGuards(PermissionGuard)
export class InboundController {
  constructor(
    @Inject(InboundService) private readonly service: InboundService,
  ) {}
  @Get('inbounds') @RequirePermission('wms.inbound.read') list(
    @Query()
    input: {
      page?: string;
      pageSize?: string;
      query?: string;
      status?: string;
      warehouseId?: string;
    },
    @Req() request: TenantRequest,
  ) {
    return this.service.list(input, request.tenantContext);
  }
  @Get('inbounds/:id') @RequirePermission('wms.inbound.read') get(
    @Param('id') id: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.get(id, request.tenantContext);
  }
  @Post('inbounds')
  @Idempotent('wms.inbound.create.v1')
  @RequirePermission('wms.inbound.write')
  create(
    @Body() input: CreateInboundInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.create(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('inbounds/:id/publish')
  @HttpCode(200)
  @Idempotent('wms.inbound.publish.v1')
  @RequirePermission('wms.inbound.publish')
  publish(
    @Param('id') id: string,
    @Body() input: VersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.publish(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('inbounds/:id/packages/parse')
  @HttpCode(200)
  @Idempotent('wms.inbound.packages.v1')
  @RequirePermission('wms.inbound.package')
  packages(
    @Param('id') id: string,
    @Body() input: ParsePackagesInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.parsePackages(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('inbounds/:id/appointment-projections')
  @HttpCode(200)
  @Idempotent('wms.inbound.appointment.v1')
  @RequirePermission('wms.inbound.appointment.project')
  appointment(
    @Param('id') id: string,
    @Body() input: ProjectAppointmentInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.projectAppointment(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('inbounds/:id/check-in')
  @HttpCode(200)
  @Idempotent('wms.inbound.check-in.v1')
  @RequirePermission('wms.inbound.checkin')
  checkIn(
    @Param('id') id: string,
    @Body() input: CheckInInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.checkIn(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('inbounds/:id/receipt-tasks')
  @Idempotent('wms.receipt-task.create.v1')
  @RequirePermission('wms.receipt.task.write')
  tasks(
    @Param('id') id: string,
    @Body() input: CreateReceiptTasksInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createTasks(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('receipt-tasks/:id/assign')
  @HttpCode(200)
  @Idempotent('wms.receipt-task.assign.v1')
  @RequirePermission('wms.receipt.task.assign')
  assign(
    @Param('id') id: string,
    @Body() input: AssignTaskInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.assignTask(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('receipt-tasks/:id/claim')
  @HttpCode(200)
  @Idempotent('wms.receipt-task.claim.v1')
  @RequirePermission('wms.receipt.task.claim')
  claim(
    @Param('id') id: string,
    @Body() input: AssignTaskInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.claimTask(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('receipt-tasks/:id/transfer')
  @HttpCode(200)
  @Idempotent('wms.receipt-task.transfer.v1')
  @RequirePermission('wms.receipt.task.transfer')
  transfer(
    @Param('id') id: string,
    @Body() input: AssignTaskInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transferTask(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('receipt-tasks/:id/transition')
  @HttpCode(200)
  @Idempotent('wms.receipt-task.transition.v1')
  @RequirePermission('wms.receipt.task.execute')
  transition(
    @Param('id') id: string,
    @Body() input: TransitionTaskInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionTask(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('inbounds/:id/complete')
  @HttpCode(200)
  @Idempotent('wms.inbound.complete.v1')
  @RequirePermission('wms.inbound.complete')
  complete(
    @Param('id') id: string,
    @Body() input: VersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.complete(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('scans')
  @Idempotent('wms.scan.create.v1')
  @RequirePermission('wms.scan.write')
  scan(
    @Body() input: ScanBarcodeInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.scan(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('scans/:id/manual-resolution')
  @HttpCode(200)
  @Idempotent('wms.scan.resolve.v1')
  @RequirePermission('wms.scan.resolve')
  resolve(
    @Param('id') id: string,
    @Body() input: ManualResolveInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.manualResolve(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}

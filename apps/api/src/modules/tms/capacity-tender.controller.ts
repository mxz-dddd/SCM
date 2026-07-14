import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { Idempotent } from '../platform/idempotent.decorator';
import { CapacityTenderService } from './capacity-tender.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/tms/capacity-tender')
@UseGuards(PermissionGuard)
export class CapacityTenderController {
  constructor(
    @Inject(CapacityTenderService)
    private readonly service: CapacityTenderService,
  ) {}

  @Get('workbench')
  @RequirePermission('tms.capacity-tender.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Post('capacity-pools')
  @Idempotent('tms.capacity-tender.pool-create.v1')
  @RequirePermission('tms.capacity.manage')
  createCapacityPool(
    @Body() input: Parameters<CapacityTenderService['createCapacityPool']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createCapacityPool(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('capacity-reservations')
  @Idempotent('tms.capacity-tender.capacity-reserve.v1')
  @RequirePermission('tms.capacity.reserve')
  reserveCapacity(
    @Body() input: Parameters<CapacityTenderService['reserveCapacity']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.reserveCapacity(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('capacity-reservations/:id/release')
  @HttpCode(200)
  @Idempotent('tms.capacity-tender.capacity-release.v1')
  @RequirePermission('tms.capacity.reserve')
  releaseCapacity(
    @Param('id') id: string,
    @Body() input: Parameters<CapacityTenderService['releaseCapacity']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.releaseCapacity(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('capacity-reservations/expire-scan')
  @HttpCode(200)
  @Idempotent('tms.capacity-tender.capacity-expire.v1')
  @RequirePermission('tms.capacity.manage')
  expireReservations(
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.expireReservations(
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('plans/:id/approve')
  @HttpCode(200)
  @Idempotent('tms.capacity-tender.plan-approve.v1')
  @RequirePermission('tms.plan.approve')
  approvePlan(
    @Param('id') id: string,
    @Body() input: Parameters<CapacityTenderService['approvePlan']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.approvePlan(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('shipments/:shipmentId/reservations/:reservationId/tenders')
  @Idempotent('tms.capacity-tender.tender-create.v1')
  @RequirePermission('tms.tender.manage')
  createTender(
    @Param('shipmentId') shipmentId: string,
    @Param('reservationId') reservationId: string,
    @Body() input: Parameters<CapacityTenderService['createTender']>[2],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createTender(
      shipmentId,
      reservationId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('tenders/:id/respond')
  @HttpCode(200)
  @Idempotent('tms.capacity-tender.tender-respond.v1')
  @RequirePermission('tms.tender.respond')
  respondTender(
    @Param('id') id: string,
    @Body() input: Parameters<CapacityTenderService['respondTender']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.respondTender(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('tenders/:id/revoke')
  @HttpCode(200)
  @Idempotent('tms.capacity-tender.tender-revoke.v1')
  @RequirePermission('tms.tender.revoke')
  revokeTender(
    @Param('id') id: string,
    @Body() input: Parameters<CapacityTenderService['revokeTender']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.revokeTender(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('tenders/expire-scan')
  @HttpCode(200)
  @Idempotent('tms.capacity-tender.tender-expire.v1')
  @RequirePermission('tms.tender.manage')
  expireTenders(
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.expireTenders(
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('shipments/:id/quote-requests')
  @Idempotent('tms.capacity-tender.quote-create.v1')
  @RequirePermission('tms.quote.manage')
  createQuoteRequest(
    @Param('id') id: string,
    @Body() input: Parameters<CapacityTenderService['createQuoteRequest']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createQuoteRequest(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('quote-requests/:id/bids')
  @Idempotent('tms.capacity-tender.bid-submit.v1')
  @RequirePermission('tms.quote.bid')
  submitBid(
    @Param('id') id: string,
    @Body() input: Parameters<CapacityTenderService['submitBid']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.submitBid(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('quote-requests/:id/recommend')
  @HttpCode(200)
  @Idempotent('tms.capacity-tender.award-recommend.v1')
  @RequirePermission('tms.quote.award')
  recommendAward(
    @Param('id') id: string,
    @Body() input: Parameters<CapacityTenderService['recommendAward']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.recommendAward(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('award-decisions/:id/decide')
  @HttpCode(200)
  @Idempotent('tms.capacity-tender.award-decide.v1')
  @RequirePermission('tms.quote.award')
  decideAward(
    @Param('id') id: string,
    @Body() input: Parameters<CapacityTenderService['decideAward']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.decideAward(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('retender-cases/:id/retender')
  @HttpCode(200)
  @Idempotent('tms.capacity-tender.retender.v1')
  @RequirePermission('tms.tender.manage')
  retender(
    @Param('id') id: string,
    @Body() input: Parameters<CapacityTenderService['retender']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.retender(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('shipments/:id/subcontracts')
  @Idempotent('tms.capacity-tender.subcontract-create.v1')
  @RequirePermission('tms.subcontract.manage')
  createSubcontract(
    @Param('id') id: string,
    @Body() input: Parameters<CapacityTenderService['createSubcontract']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createSubcontract(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('subcontracts/:id/respond')
  @HttpCode(200)
  @Idempotent('tms.capacity-tender.subcontract-respond.v1')
  @RequirePermission('tms.subcontract.respond')
  respondSubcontract(
    @Param('id') id: string,
    @Body() input: Parameters<CapacityTenderService['respondSubcontract']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.respondSubcontract(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}

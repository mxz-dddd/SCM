import {
  Body,
  Controller,
  Headers,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { Idempotent } from '../platform/idempotent.decorator';
import {
  ChargeCalculationService,
  type CalculateChargeInput,
} from './charge-calculation.service';

@Controller('api/v1/billing')
@UseGuards(PermissionGuard)
export class ChargeCalculationController {
  constructor(
    @Inject(ChargeCalculationService)
    private readonly service: ChargeCalculationService,
  ) {}

  @Post('calculations')
  @Idempotent('billing.charge.calculate.v1')
  @RequirePermission('billing.calculation.execute')
  calculate(
    @Body() input: CalculateChargeInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.calculate(input, request.tenantContext, {
      correlationId,
      idempotencyKey: key,
      ipAddress: request.ip,
    });
  }
}

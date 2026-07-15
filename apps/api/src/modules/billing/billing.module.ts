import { Module } from '@nestjs/common';
import { MdmModule } from '../mdm/mdm.module';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { PlatformModule } from '../platform/platform.module';
import { ChargeFactRateController } from './charge-fact-rate.controller';
import { ChargeFactRateService } from './charge-fact-rate.service';
import { SettlementVoucherController } from './settlement-voucher.controller';
import { SettlementVoucherService } from './settlement-voucher.service';
import { ChargeCalculationController } from './charge-calculation.controller';
import { ChargeCalculationService } from './charge-calculation.service';

@Module({
  controllers: [
    ChargeCalculationController,
    ChargeFactRateController,
    SettlementVoucherController,
  ],
  imports: [MdmModule, PlatformModule],
  providers: [
    ChargeCalculationService,
    ChargeFactRateService,
    SettlementVoucherService,
    PermissionGuard,
    PermissionService,
  ],
})
export class BillingModule {}

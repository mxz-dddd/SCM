import { Module } from '@nestjs/common';
import { MdmModule } from '../mdm/mdm.module';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { PlatformModule } from '../platform/platform.module';
import { ChargeFactRateController } from './charge-fact-rate.controller';
import { ChargeFactRateService } from './charge-fact-rate.service';
import { FinancialCloseController } from './financial-close.controller';
import { FinancialCloseService } from './financial-close.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { SettlementVoucherController } from './settlement-voucher.controller';
import { SettlementVoucherService } from './settlement-voucher.service';
import { ChargeCalculationController } from './charge-calculation.controller';
import { ChargeCalculationService } from './charge-calculation.service';

@Module({
  controllers: [
    ChargeCalculationController,
    ChargeFactRateController,
    FinancialCloseController,
    ReconciliationController,
    SettlementVoucherController,
  ],
  imports: [MdmModule, PlatformModule],
  providers: [
    ChargeCalculationService,
    ChargeFactRateService,
    FinancialCloseService,
    ReconciliationService,
    SettlementVoucherService,
    PermissionGuard,
    PermissionService,
  ],
})
export class BillingModule {}

import { Module } from '@nestjs/common';
import { MdmModule } from '../mdm/mdm.module';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { PlatformModule } from '../platform/platform.module';
import { ChargeFactRateController } from './charge-fact-rate.controller';
import { ChargeFactRateService } from './charge-fact-rate.service';
import { ChargeCalculationController } from './charge-calculation.controller';
import { ChargeCalculationService } from './charge-calculation.service';

@Module({
  controllers: [ChargeCalculationController, ChargeFactRateController],
  imports: [MdmModule, PlatformModule],
  providers: [
    ChargeCalculationService,
    ChargeFactRateService,
    PermissionGuard,
    PermissionService,
  ],
})
export class BillingModule {}

import { Module } from '@nestjs/common';
import { MdmModule } from '../mdm/mdm.module';
import { PlatformModule } from '../platform/platform.module';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { OrderIntakeController } from './order-intake.controller';
import { OrderIntakeService } from './order-intake.service';
import { OrderGovernanceController } from './order-governance.controller';
import { OrderGovernanceService } from './order-governance.service';
import { AtpAllocationController } from './atp-allocation.controller';
import { AtpAllocationService } from './atp-allocation.service';

@Module({
  controllers: [
    AtpAllocationController,
    OrderGovernanceController,
    OrderIntakeController,
  ],
  imports: [MdmModule, PlatformModule],
  providers: [
    AtpAllocationService,
    OrderGovernanceService,
    OrderIntakeService,
    PermissionGuard,
    PermissionService,
  ],
})
export class OmsModule {}

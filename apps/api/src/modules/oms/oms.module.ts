import { Module } from '@nestjs/common';
import { MdmModule } from '../mdm/mdm.module';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { OrderIntakeController } from './order-intake.controller';
import { OrderIntakeService } from './order-intake.service';
import { OrderGovernanceController } from './order-governance.controller';
import { OrderGovernanceService } from './order-governance.service';

@Module({
  controllers: [OrderGovernanceController, OrderIntakeController],
  imports: [MdmModule],
  providers: [OrderGovernanceService, OrderIntakeService, PermissionGuard, PermissionService],
})
export class OmsModule {}

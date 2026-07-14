import { Module } from '@nestjs/common';
import { MdmModule } from '../mdm/mdm.module';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { OrderIntakeController } from './order-intake.controller';
import { OrderIntakeService } from './order-intake.service';

@Module({
  controllers: [OrderIntakeController],
  imports: [MdmModule],
  providers: [OrderIntakeService, PermissionGuard, PermissionService],
})
export class OmsModule {}

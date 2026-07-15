import { Module } from '@nestjs/common';
import { MdmModule } from '../mdm/mdm.module';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { CapacityWorkloadController } from './capacity-workload.controller';
import { CapacityWorkloadService } from './capacity-workload.service';
import { AppointmentIntakeController } from './appointment-intake.controller';
import { AppointmentIntakeService } from './appointment-intake.service';

@Module({
  controllers: [AppointmentIntakeController, CapacityWorkloadController],
  imports: [MdmModule],
  providers: [
    AppointmentIntakeService,
    CapacityWorkloadService,
    PermissionGuard,
    PermissionService,
  ],
})
export class AmsModule {}

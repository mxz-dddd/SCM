import { Module } from '@nestjs/common';
import { MdmModule } from '../mdm/mdm.module';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { CapacityWorkloadController } from './capacity-workload.controller';
import { CapacityWorkloadService } from './capacity-workload.service';

@Module({
  controllers: [CapacityWorkloadController],
  imports: [MdmModule],
  providers: [CapacityWorkloadService, PermissionGuard, PermissionService],
})
export class AmsModule {}

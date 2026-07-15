import { Module } from '@nestjs/common';
import { MdmModule } from '../mdm/mdm.module';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { PlatformModule } from '../platform/platform.module';
import { ControlTowerController } from './control-tower.controller';
import { ControlTowerService } from './control-tower.service';
import { AlertGovernanceController } from './alert-governance.controller';
import { AlertGovernanceService } from './alert-governance.service';

@Module({
  controllers: [AlertGovernanceController, ControlTowerController],
  imports: [MdmModule, PlatformModule],
  providers: [
    AlertGovernanceService,
    ControlTowerService,
    PermissionGuard,
    PermissionService,
  ],
})
export class ControlModule {}

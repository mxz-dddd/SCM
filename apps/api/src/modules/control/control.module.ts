import { Module } from '@nestjs/common';
import { MdmModule } from '../mdm/mdm.module';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { PlatformModule } from '../platform/platform.module';
import { ControlTowerController } from './control-tower.controller';
import { ControlTowerService } from './control-tower.service';
import { AlertGovernanceController } from './alert-governance.controller';
import { AlertGovernanceService } from './alert-governance.service';
import { BiAnalyticsController } from './bi-analytics.controller';
import { BiAnalyticsService } from './bi-analytics.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';

@Module({
  controllers: [
    AlertGovernanceController,
    BiAnalyticsController,
    ControlTowerController,
    ReconciliationController,
  ],
  imports: [MdmModule, PlatformModule],
  providers: [
    AlertGovernanceService,
    BiAnalyticsService,
    ControlTowerService,
    PermissionGuard,
    PermissionService,
    ReconciliationService,
  ],
})
export class ControlModule {}

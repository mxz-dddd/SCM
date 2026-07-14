import { Module } from '@nestjs/common';
import { MdmModule } from '../mdm/mdm.module';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { PlatformModule } from '../platform/platform.module';
import { InboundController } from './inbound.controller';
import { InboundService } from './inbound.service';
import { InventoryGovernanceController } from './inventory-governance.controller';
import { InventoryGovernanceService } from './inventory-governance.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { QualityPutawayController } from './quality-putaway.controller';
import { QualityPutawayService } from './quality-putaway.service';
import { ReceivingDetailController } from './receiving-detail.controller';
import { ReceivingDetailService } from './receiving-detail.service';
@Module({
  controllers: [
    InboundController,
    ReceivingDetailController,
    QualityPutawayController,
    InventoryController,
    InventoryGovernanceController,
  ],
  imports: [MdmModule, PlatformModule],
  providers: [
    InboundService,
    ReceivingDetailService,
    QualityPutawayService,
    InventoryService,
    InventoryGovernanceService,
    PermissionGuard,
    PermissionService,
  ],
})
export class WmsModule {}

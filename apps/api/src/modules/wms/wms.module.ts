import { Module } from '@nestjs/common';
import { MdmModule } from '../mdm/mdm.module';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { PlatformModule } from '../platform/platform.module';
import { InboundController } from './inbound.controller';
import { InboundService } from './inbound.service';
import { QualityPutawayController } from './quality-putaway.controller';
import { QualityPutawayService } from './quality-putaway.service';
import { ReceivingDetailController } from './receiving-detail.controller';
import { ReceivingDetailService } from './receiving-detail.service';
@Module({
  controllers: [
    InboundController,
    ReceivingDetailController,
    QualityPutawayController,
  ],
  imports: [MdmModule, PlatformModule],
  providers: [
    InboundService,
    ReceivingDetailService,
    QualityPutawayService,
    PermissionGuard,
    PermissionService,
  ],
})
export class WmsModule {}

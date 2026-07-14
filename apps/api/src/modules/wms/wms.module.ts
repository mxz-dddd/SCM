import { Module } from '@nestjs/common';
import { MdmModule } from '../mdm/mdm.module';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { InboundController } from './inbound.controller';
import { InboundService } from './inbound.service';
import { ReceivingDetailController } from './receiving-detail.controller';
import { ReceivingDetailService } from './receiving-detail.service';
@Module({
  controllers: [InboundController, ReceivingDetailController],
  imports: [MdmModule],
  providers: [
    InboundService,
    ReceivingDetailService,
    PermissionGuard,
    PermissionService,
  ],
})
export class WmsModule {}

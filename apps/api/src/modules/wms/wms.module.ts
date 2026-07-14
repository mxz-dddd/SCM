import { Module } from '@nestjs/common';
import { MdmModule } from '../mdm/mdm.module';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { InboundController } from './inbound.controller';
import { InboundService } from './inbound.service';
@Module({
  controllers: [InboundController],
  imports: [MdmModule],
  providers: [InboundService, PermissionGuard, PermissionService],
})
export class WmsModule {}

import { Module } from '@nestjs/common';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { PlatformModule } from '../platform/platform.module';
import { TransportOrderController } from './transport-order.controller';
import { TransportOrderService } from './transport-order.service';

@Module({
  controllers: [TransportOrderController],
  imports: [PlatformModule],
  providers: [TransportOrderService, PermissionGuard, PermissionService],
})
export class TmsModule {}

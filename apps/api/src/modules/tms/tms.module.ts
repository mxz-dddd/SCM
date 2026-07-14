import { Module } from '@nestjs/common';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { PlatformModule } from '../platform/platform.module';
import { LoadRouteController } from './load-route.controller';
import { LoadRouteService } from './load-route.service';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';
import { TransportOrderController } from './transport-order.controller';
import { TransportOrderService } from './transport-order.service';

@Module({
  controllers: [
    LoadRouteController,
    PlanningController,
    TransportOrderController,
  ],
  imports: [PlatformModule],
  providers: [
    LoadRouteService,
    PlanningService,
    TransportOrderService,
    PermissionGuard,
    PermissionService,
  ],
})
export class TmsModule {}

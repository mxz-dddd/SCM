import { Module } from '@nestjs/common';
import { MdmModule } from '../mdm/mdm.module';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { PlatformModule } from '../platform/platform.module';
import { CapacityTenderController } from './capacity-tender.controller';
import { CapacityTenderService } from './capacity-tender.service';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';
import { LoadRouteController } from './load-route.controller';
import { LoadRouteService } from './load-route.service';
import { InTransitOperationsController } from './in-transit-operations.controller';
import { InTransitOperationsService } from './in-transit-operations.service';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { TransportOrderController } from './transport-order.controller';
import { TransportOrderService } from './transport-order.service';

@Module({
  controllers: [
    CapacityTenderController,
    DispatchController,
    InTransitOperationsController,
    LoadRouteController,
    PlanningController,
    TrackingController,
    TransportOrderController,
  ],
  imports: [MdmModule, PlatformModule],
  providers: [
    CapacityTenderService,
    DispatchService,
    InTransitOperationsService,
    LoadRouteService,
    PlanningService,
    TrackingService,
    TransportOrderService,
    PermissionGuard,
    PermissionService,
  ],
})
export class TmsModule {}

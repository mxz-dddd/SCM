import { Module } from '@nestjs/common';
import { MdmModule } from '../mdm/mdm.module';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { PlatformModule } from '../platform/platform.module';
import { CapacityTenderController } from './capacity-tender.controller';
import { CapacityTenderService } from './capacity-tender.service';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';
import { DeliveryReverseController } from './delivery-reverse.controller';
import { DeliveryReverseService } from './delivery-reverse.service';
import { FreightBillingController } from './freight-billing.controller';
import { FreightBillingService } from './freight-billing.service';
import {
  FleetInsightsController,
  PublicTrackingController,
} from './fleet-insights.controller';
import { FleetInsightsService } from './fleet-insights.service';
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
    DeliveryReverseController,
    FreightBillingController,
    FleetInsightsController,
    InTransitOperationsController,
    LoadRouteController,
    PlanningController,
    PublicTrackingController,
    TrackingController,
    TransportOrderController,
  ],
  imports: [MdmModule, PlatformModule],
  providers: [
    CapacityTenderService,
    DispatchService,
    DeliveryReverseService,
    FreightBillingService,
    FleetInsightsService,
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

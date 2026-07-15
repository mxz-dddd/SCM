import { Module } from '@nestjs/common';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { IdempotencyService } from '../platform/idempotency.service';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { PartnerController } from './partner.controller';
import { PartnerService } from './partner.service';
import { WarehouseFleetController } from './warehouse-fleet.controller';
import { WarehouseFleetService } from './warehouse-fleet.service';
import { ContractCalendarQualityController } from './contract-calendar-quality.controller';
import { ContractCalendarQualityService } from './contract-calendar-quality.service';
import { MdmReferenceService } from './public/mdm-reference.service';
import { CalendarReleaseFacade } from './public/calendar-release.facade';
import { FleetAssignmentFacade } from './public/fleet-assignment.facade';
import { RateMatchingFacade } from './public/rate-matching.facade';
import { DockSchedulingFacade } from './public/dock-scheduling.facade';

@Module({
  controllers: [
    ContractCalendarQualityController,
    PartnerController,
    ProductController,
    WarehouseFleetController,
  ],
  exports: [
    CalendarReleaseFacade,
    FleetAssignmentFacade,
    MdmReferenceService,
    RateMatchingFacade,
    DockSchedulingFacade,
  ],
  providers: [
    CalendarReleaseFacade,
    ContractCalendarQualityService,
    FleetAssignmentFacade,
    IdempotencyService,
    MdmReferenceService,
    RateMatchingFacade,
    DockSchedulingFacade,
    PartnerService,
    PermissionGuard,
    PermissionService,
    ProductService,
    WarehouseFleetService,
  ],
})
export class MdmModule {}

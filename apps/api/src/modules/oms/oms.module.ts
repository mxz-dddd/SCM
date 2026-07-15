import { Module } from '@nestjs/common';
import { MdmModule } from '../mdm/mdm.module';
import { PlatformModule } from '../platform/platform.module';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { OrderIntakeController } from './order-intake.controller';
import { OrderIntakeService } from './order-intake.service';
import { OrderGovernanceController } from './order-governance.controller';
import { OrderGovernanceService } from './order-governance.service';
import { AtpAllocationController } from './atp-allocation.controller';
import { AtpAllocationService } from './atp-allocation.service';
import { FulfillmentReleaseController } from './fulfillment-release.controller';
import { FulfillmentReleaseService } from './fulfillment-release.service';
import { CollaborationTimelineController } from './collaboration-timeline.controller';
import { CollaborationTimelineService } from './collaboration-timeline.service';
import { ChangeReverseController } from './change-reverse.controller';
import { ChangeReverseService } from './change-reverse.service';
import { OrderOperationsController } from './order-operations.controller';
import { OrderOperationsService } from './order-operations.service';
import { FulfillmentProcessController } from './fulfillment-process.controller';
import { FulfillmentProcessService } from './fulfillment-process.service';

@Module({
  controllers: [
    AtpAllocationController,
    ChangeReverseController,
    CollaborationTimelineController,
    FulfillmentReleaseController,
    OrderGovernanceController,
    OrderIntakeController,
    OrderOperationsController,
    FulfillmentProcessController,
  ],
  imports: [MdmModule, PlatformModule],
  providers: [
    AtpAllocationService,
    ChangeReverseService,
    CollaborationTimelineService,
    FulfillmentReleaseService,
    OrderGovernanceService,
    OrderIntakeService,
    OrderOperationsService,
    FulfillmentProcessService,
    PermissionGuard,
    PermissionService,
  ],
})
export class OmsModule {}

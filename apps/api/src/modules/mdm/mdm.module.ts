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

@Module({
  controllers: [ContractCalendarQualityController, PartnerController, ProductController, WarehouseFleetController],
  providers: [ContractCalendarQualityService, IdempotencyService, PartnerService, PermissionGuard, PermissionService, ProductService, WarehouseFleetService],
})
export class MdmModule {}

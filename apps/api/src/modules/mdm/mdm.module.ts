import { Module } from '@nestjs/common';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { IdempotencyService } from '../platform/idempotency.service';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { PartnerController } from './partner.controller';
import { PartnerService } from './partner.service';

@Module({
  controllers: [PartnerController, ProductController],
  providers: [IdempotencyService, PartnerService, PermissionGuard, PermissionService, ProductService],
})
export class MdmModule {}

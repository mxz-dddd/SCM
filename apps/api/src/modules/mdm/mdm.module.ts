import { Module } from '@nestjs/common';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { IdempotencyService } from '../platform/idempotency.service';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';

@Module({
  controllers: [ProductController],
  providers: [IdempotencyService, PermissionGuard, PermissionService, ProductService],
})
export class MdmModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PermissionGuard } from './auth/permission.guard';
import { PermissionService } from './auth/permission.service';
import { IdempotencyService } from './idempotency.service';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';
import { ServiceAccountController } from './service-account.controller';
import { ServiceAccountService } from './service-account.service';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Module({
  controllers: [
    OrganizationController,
    RoleController,
    ServiceAccountController,
    TenantController,
  ],
  imports: [AuthModule],
  providers: [
    IdempotencyService,
    OrganizationService,
    PermissionGuard,
    PermissionService,
    RoleService,
    ServiceAccountService,
    TenantService,
  ],
})
export class PlatformModule {}

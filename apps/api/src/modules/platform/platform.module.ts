import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PermissionGuard } from './auth/permission.guard';
import { PermissionService } from './auth/permission.service';
import { DataPolicyController } from './data-policy.controller';
import { DataPolicyService } from './data-policy.service';
import { IdempotencyService } from './idempotency.service';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';
import { ServiceAccountController } from './service-account.controller';
import { ServiceAccountService } from './service-account.service';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

@Module({
  controllers: [
    DataPolicyController,
    OrganizationController,
    RoleController,
    ServiceAccountController,
    TenantController,
    WorkspaceController,
  ],
  imports: [AuthModule],
  providers: [
    DataPolicyService,
    IdempotencyService,
    OrganizationService,
    PermissionGuard,
    PermissionService,
    RoleService,
    ServiceAccountService,
    TenantService,
    WorkspaceService,
  ],
})
export class PlatformModule {}

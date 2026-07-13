import { Module } from '@nestjs/common';
import { AttachmentController } from './attachment.controller';
import { AttachmentService } from './attachment.service';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuthModule } from './auth/auth.module';
import { PermissionGuard } from './auth/permission.guard';
import { PermissionService } from './auth/permission.service';
import { DataPolicyController } from './data-policy.controller';
import { DataPolicyService } from './data-policy.service';
import { DataExchangeController } from './data-exchange.controller';
import { ExportService } from './export.service';
import { ImportService } from './import.service';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';
import { IdempotencyService } from './idempotency.service';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { ObjectStorageService } from './object-storage.service';
import { NotificationChannelService } from './notification-channel.service';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { RoleController } from './role.controller';
import { RuleEngineController } from './rule-engine.controller';
import { RuleEngineService } from './rule-engine.service';
import { SearchService } from './search.service';
import { RoleService } from './role.service';
import { ServiceAccountController } from './service-account.controller';
import { ServiceAccountService } from './service-account.service';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { WatermarkService } from './watermark.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

@Module({
  controllers: [
    AttachmentController,
    AuditController,
    ConfigurationController,
    DataPolicyController,
    DataExchangeController,
    NotificationController,
    OrganizationController,
    RoleController,
    RuleEngineController,
    ServiceAccountController,
    TenantController,
    WorkspaceController,
    WorkflowController,
  ],
  imports: [AuthModule],
  providers: [
    AttachmentService,
    AuditService,
    ConfigurationService,
    DataPolicyService,
    ExportService,
    IdempotencyService,
    ImportService,
    NotificationChannelService,
    NotificationService,
    OrganizationService,
    ObjectStorageService,
    PermissionGuard,
    PermissionService,
    RoleService,
    RuleEngineService,
    SearchService,
    ServiceAccountService,
    TenantService,
    WorkspaceService,
    WatermarkService,
    WorkflowService,
  ],
})
export class PlatformModule {}

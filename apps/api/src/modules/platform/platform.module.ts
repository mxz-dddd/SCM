import { Module } from '@nestjs/common';
import { AttachmentController } from './attachment.controller';
import { AttachmentService } from './attachment.service';
import { CollaborationPrintService } from './collaboration-print.service';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuthModule } from './auth/auth.module';
import { PermissionGuard } from './auth/permission.guard';
import { PermissionService } from './auth/permission.service';
import { DataPolicyController } from './data-policy.controller';
import { DataPolicyService } from './data-policy.service';
import { DataExchangeController } from './data-exchange.controller';
import { ExportService } from './export.service';
import { EventController } from './event.controller';
import { EventService } from './event.service';
import { FeatureFlagService } from './feature-flag.service';
import { ImportService } from './import.service';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';
import { IdempotencyService } from './idempotency.service';
import { JobController } from './job.controller';
import { JobQueueService } from './job-queue.service';
import { JobService } from './job.service';
import { LocaleUnitService } from './locale-unit.service';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { PlatformFinishController } from './platform-finish.controller';
import { PrintQueueService } from './print-queue.service';
import { ObjectStorageService } from './object-storage.service';
import { NotificationChannelService } from './notification-channel.service';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { RoleController } from './role.controller';
import { RuleEngineController } from './rule-engine.controller';
import { RuleEngineService } from './rule-engine.service';
import { RuleEvaluationFacade } from './public/rule-evaluation.facade';
import { AttachmentReferenceFacade } from './public/attachment-reference.facade';
import { EventConsumptionFacade } from './public/event-consumption.facade';
import { PermissionDecisionFacade } from './public/permission-decision.facade';
import { JobSchedulingFacade } from './public/job-scheduling.facade';
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
import { ChangeRecordingFacade } from './public/change-recording.facade';
import { IdempotencyExecutionFacade } from './public/idempotency-execution.facade';

@Module({
  controllers: [
    AttachmentController,
    AuditController,
    ConfigurationController,
    DataPolicyController,
    DataExchangeController,
    EventController,
    JobController,
    NotificationController,
    OrganizationController,
    PlatformFinishController,
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
    AttachmentReferenceFacade,
    AuditService,
    CollaborationPrintService,
    ChangeRecordingFacade,
    ConfigurationService,
    DataPolicyService,
    ExportService,
    EventService,
    FeatureFlagService,
    IdempotencyService,
    IdempotencyExecutionFacade,
    ImportService,
    JobQueueService,
    JobSchedulingFacade,
    JobService,
    LocaleUnitService,
    NotificationChannelService,
    NotificationService,
    OrganizationService,
    PrintQueueService,
    ObjectStorageService,
    PermissionGuard,
    PermissionService,
    RoleService,
    RuleEngineService,
    RuleEvaluationFacade,
    EventConsumptionFacade,
    IdempotencyExecutionFacade,
    PermissionDecisionFacade,
    SearchService,
    ServiceAccountService,
    TenantService,
    WorkspaceService,
    WatermarkService,
    WorkflowService,
  ],
  exports: [
    AttachmentReferenceFacade,
    ChangeRecordingFacade,
    EventConsumptionFacade,
    JobSchedulingFacade,
    PermissionDecisionFacade,
    RuleEvaluationFacade,
  ],
})
export class PlatformModule {}

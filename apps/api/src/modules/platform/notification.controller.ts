import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { TenantRequest } from './auth/tenant-context.middleware';
import { RequirePermission } from './auth/permission.decorator';
import { PermissionGuard } from './auth/permission.guard';
import {
  NotificationService,
  type CreateInboxItemInput,
  type CreateNotificationInput,
  type CreateTemplateInput,
  type DispatchNotificationInput,
  type EscalateNotificationInput,
  type InboxListQuery,
  type PublishTemplateInput,
  type TransitionInboxInput,
  type UpsertPreferenceInput,
} from './notification.service';

@Controller('api/v1/platform/notifications')
@UseGuards(PermissionGuard)
export class NotificationController {
  constructor(
    @Inject(NotificationService)
    private readonly notifications: NotificationService,
  ) {}

  @Get('inbox')
  @RequirePermission('platform.inbox.read')
  listInbox(@Query() query: InboxListQuery, @Req() request: TenantRequest) {
    return this.notifications.listInbox(request.tenantContext, query);
  }

  @Post('inbox')
  @RequirePermission('platform.inbox.write')
  createInbox(
    @Body() input: CreateInboxItemInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.notifications.createInboxItem(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('inbox/:inboxItemId/read')
  @RequirePermission('platform.inbox.read')
  markRead(
    @Param('inboxItemId') inboxItemId: string,
    @Body() input: TransitionInboxInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.notifications.transitionInbox(
      inboxItemId,
      'READ',
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Post('inbox/:inboxItemId/archive')
  @RequirePermission('platform.inbox.read')
  archive(
    @Param('inboxItemId') inboxItemId: string,
    @Body() input: TransitionInboxInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.notifications.transitionInbox(
      inboxItemId,
      'ARCHIVED',
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Get('templates')
  @RequirePermission('platform.notification.manage')
  listTemplates(@Req() request: TenantRequest) {
    return this.notifications.listTemplates(request.tenantContext);
  }

  @Post('templates')
  @RequirePermission('platform.notification.manage')
  createTemplate(
    @Body() input: CreateTemplateInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.notifications.createTemplate(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('templates/:templateId/publish')
  @RequirePermission('platform.notification.manage')
  publishTemplate(
    @Param('templateId') templateId: string,
    @Body() input: PublishTemplateInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.notifications.publishTemplate(
      templateId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Get('preferences')
  @RequirePermission('platform.inbox.read')
  listPreferences(@Req() request: TenantRequest) {
    return this.notifications.listPreferences(request.tenantContext);
  }

  @Put('preferences')
  @RequirePermission('platform.inbox.read')
  upsertPreference(
    @Body() input: UpsertPreferenceInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.notifications.upsertPreference(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Get()
  @RequirePermission('platform.notification.manage')
  listNotifications(@Req() request: TenantRequest) {
    return this.notifications.listNotifications(request.tenantContext);
  }

  @Post()
  @RequirePermission('platform.notification.send')
  createNotification(
    @Body() input: CreateNotificationInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.notifications.createNotification(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post(':notificationId/dispatch')
  @RequirePermission('platform.notification.send')
  dispatch(
    @Param('notificationId') notificationId: string,
    @Body() input: DispatchNotificationInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.notifications.dispatch(
      notificationId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Post(':notificationId/escalate')
  @RequirePermission('platform.notification.send')
  escalate(
    @Param('notificationId') notificationId: string,
    @Body() input: EscalateNotificationInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.notifications.escalate(
      notificationId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }
}

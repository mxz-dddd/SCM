import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type InboxItemStatus,
  type InboxItemType,
  type NotificationChannel,
  type NotificationSeverity,
  type NotificationStatus,
  type NotificationTemplateStatus,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import { NotificationChannelService } from './notification-channel.service';
import type { CommandMetadata } from './tenant.service';

type JsonObject = Readonly<Record<string, unknown>>;

interface BusinessTargetInput {
  readonly businessDomain: string;
  readonly businessObjectId: string;
  readonly businessObjectType: string;
  readonly businessRef: string;
  readonly organizationId?: string;
  readonly responsibilityGroup: string;
  readonly route: string;
}

export interface CreateInboxItemInput extends BusinessTargetInput {
  readonly dueAt?: string;
  readonly recipientAccountId: string;
  readonly severity: NotificationSeverity;
  readonly summary: string;
  readonly title: string;
  readonly type: InboxItemType;
}

export interface InboxListQuery {
  readonly businessDomain?: string;
  readonly page?: number | string;
  readonly pageSize?: number | string;
  readonly responsibilityGroup?: string;
  readonly severity?: NotificationSeverity;
  readonly status?: InboxItemStatus;
}

export interface TransitionInboxInput {
  readonly expectedVersion: number;
}

export interface CreateTemplateInput {
  readonly bodyTemplate: string;
  readonly channels: readonly NotificationChannel[];
  readonly code: string;
  readonly locale?: string;
  readonly subjectTemplate: string;
  readonly variableWhitelist: readonly string[];
}

export interface PublishTemplateInput {
  readonly expectedVersion: number;
}

export interface UpsertPreferenceInput {
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
  readonly expectedVersion?: number;
  readonly fallbackChannel?: NotificationChannel;
  readonly minimumSeverity?: NotificationSeverity;
  readonly quietEndMinutes?: number;
  readonly quietStartMinutes?: number;
  readonly timezone?: string;
}

export interface CreateNotificationInput extends BusinessTargetInput {
  readonly channels?: readonly NotificationChannel[];
  readonly escalationAt?: string;
  readonly locale?: string;
  readonly recipientAccountId: string;
  readonly severity: NotificationSeverity;
  readonly templateCode: string;
  readonly variables: JsonObject;
}

export interface DispatchNotificationInput {
  readonly expectedVersion: number;
}

export interface EscalateNotificationInput {
  readonly expectedVersion: number;
  readonly responsibilityGroup: string;
}

const CHANNELS = new Set<NotificationChannel>([
  'IN_APP',
  'EMAIL',
  'SMS',
  'WECHAT',
  'PUSH',
]);
const SEVERITIES = new Set<NotificationSeverity>([
  'INFO',
  'WARNING',
  'ERROR',
  'CRITICAL',
]);
const INBOX_TYPES = new Set<InboxItemType>([
  'APPROVAL',
  'EXCEPTION',
  'EXPIRY',
  'INTEGRATION_FAILURE',
  'NOTIFICATION',
]);
const SEVERITY_RANK: Readonly<Record<NotificationSeverity, number>> = {
  INFO: 0,
  WARNING: 1,
  ERROR: 2,
  CRITICAL: 3,
};
const IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9_-]{1,99}$/;
const TEMPLATE_CODE_PATTERN = /^[A-Z][A-Z0-9_.-]{2,99}$/;
const VARIABLE_PATTERN = /^[a-z][a-zA-Z0-9_.]{0,99}$/;

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function templateVariables(template: string): readonly string[] {
  return unique(
    [...template.matchAll(/{{\s*([a-z][a-zA-Z0-9_.]*)\s*}}/g)].map(
      (match) => match[1]!,
    ),
  ).sort();
}

export function renderNotificationTemplate(
  template: string,
  whitelist: readonly string[],
  variables: JsonObject,
): string {
  const referenced = templateVariables(template);
  const allowed = new Set(whitelist);
  const unknown = referenced.filter((name) => !allowed.has(name));
  const missing = referenced.filter((name) => variables[name] === undefined);
  const extra = Object.keys(variables).filter((name) => !allowed.has(name));
  if (unknown.length || missing.length || extra.length) {
    throw new AppError(
      'NOTIFICATION_TEMPLATE_VARIABLE_INVALID',
      'Notification variables must match the published whitelist',
      400,
      {
        fieldErrors: [
          ...unknown.map((name) => ({
            field: name,
            message: 'Template variable is not whitelisted',
          })),
          ...missing.map((name) => ({
            field: name,
            message: 'Template variable is required',
          })),
          ...extra.map((name) => ({
            field: name,
            message: 'Input variable is not whitelisted',
          })),
        ],
      },
    );
  }
  return template.replace(
    /{{\s*([a-z][a-zA-Z0-9_.]*)\s*}}/g,
    (_whole, name: string) => String(variables[name]),
  );
}

export function isQuietTime(
  startMinutes: number | null,
  endMinutes: number | null,
  localMinutes: number,
): boolean {
  if (startMinutes === null || endMinutes === null) return false;
  if (startMinutes === endMinutes) return true;
  return startMinutes < endMinutes
    ? localMinutes >= startMinutes && localMinutes < endMinutes
    : localMinutes >= startMinutes || localMinutes < endMinutes;
}

export function minutesInTimezone(now: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      timeZone: timezone,
    }).formatToParts(now);
    const hour = Number(parts.find(({ type }) => type === 'hour')?.value);
    const minute = Number(parts.find(({ type }) => type === 'minute')?.value);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error();
    return hour * 60 + minute;
  } catch {
    throw new AppError(
      'SUBSCRIPTION_TIMEZONE_INVALID',
      'Subscription timezone is invalid',
      400,
    );
  }
}

export function notificationOrganizationAllowed(
  organizationId: string | undefined,
  context: TenantContext,
): boolean {
  return (
    context.accountKind !== 'USER' ||
    organizationId === undefined ||
    context.organizationIds.includes(organizationId)
  );
}

export function assertInboxTransition(
  current: InboxItemStatus,
  target: InboxItemStatus,
): void {
  if (!(
    (current === 'UNREAD' && target === 'READ') ||
    (current === 'READ' && target === 'ARCHIVED')
  )) {
    throw new AppError(
      'INBOX_TRANSITION_INVALID',
      `Inbox transition ${current} -> ${target} is not allowed`,
      409,
    );
  }
}

export function assertTemplateTransition(
  current: NotificationTemplateStatus,
  target: NotificationTemplateStatus,
): void {
  if (!(
    (current === 'DRAFT' && target === 'PUBLISHED') ||
    (current === 'PUBLISHED' && target === 'RETIRED')
  )) {
    throw new AppError(
      'NOTIFICATION_TEMPLATE_TRANSITION_INVALID',
      `Template transition ${current} -> ${target} is not allowed`,
      409,
    );
  }
}

export function assertNotificationTransition(
  current: NotificationStatus,
  target: NotificationStatus,
): void {
  const targets: readonly NotificationStatus[] = [
    'DELIVERED',
    'PARTIAL_FAILED',
    'FAILED',
  ];
  if (!(
    (current === 'PENDING' && targets.includes(target)) ||
    ((['PARTIAL_FAILED', 'FAILED'] as NotificationStatus[]).includes(current) &&
      targets.includes(target))
  )) {
    throw new AppError(
      'NOTIFICATION_TRANSITION_INVALID',
      `Notification transition ${current} -> ${target} is not allowed`,
      409,
    );
  }
}

function pagination(query: InboxListQuery) {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw new AppError('PAGINATION_INVALID', 'Invalid page or pageSize', 400);
  }
  return { page, pageSize };
}

@Injectable()
export class NotificationService {
  constructor(
    @Inject(NotificationChannelService)
    private readonly channels: NotificationChannelService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async listInbox(context: TenantContext, query: InboxListQuery) {
    const { page, pageSize } = pagination(query);
    if (
      (query.status &&
        !['UNREAD', 'READ', 'ARCHIVED'].includes(query.status)) ||
      (query.severity && !SEVERITIES.has(query.severity))
    ) {
      throw new AppError(
        'INBOX_FILTER_INVALID',
        'Inbox filter is invalid',
        400,
      );
    }
    const where: Prisma.InboxItemWhereInput = {
      ...(query.businessDomain ? { businessDomain: query.businessDomain } : {}),
      ...(query.responsibilityGroup
        ? { responsibilityGroup: query.responsibilityGroup }
        : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.status ? { status: query.status } : {}),
      recipientAccountId: context.accountId,
      tenantId: context.tenantId,
    };
    const [items, total] = await Promise.all([
      this.prisma.inboxItem.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
      this.prisma.inboxItem.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }

  listTemplates(context: TenantContext) {
    return this.prisma.notificationTemplate.findMany({
      orderBy: [{ code: 'asc' }, { versionNumber: 'desc' }],
      where: { tenantId: context.tenantId },
    });
  }

  listNotifications(context: TenantContext) {
    return this.prisma.notification.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      where: {
        ...(context.accountKind === 'USER'
          ? { recipientAccountId: context.accountId }
          : {}),
        tenantId: context.tenantId,
      },
    });
  }

  createInboxItem(
    input: CreateInboxItemInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.validateBusinessTarget(input);
    this.assertOrganizationScope(input.organizationId, context);
    if (
      !isUuid(input.recipientAccountId) ||
      !INBOX_TYPES.has(input.type) ||
      !SEVERITIES.has(input.severity) ||
      !input.title?.trim() ||
      !input.summary?.trim()
    ) {
      throw new AppError('INBOX_ITEM_INVALID', 'Inbox item is invalid', 400);
    }
    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) {
      throw new AppError('INBOX_DUE_AT_INVALID', 'dueAt is invalid', 400);
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 201,
        scope: 'platform.inbox-item.create.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const id = randomUUID();
        await transaction.inboxItem.create({
          data: {
            ...this.businessTargetData(input),
            createdBy: context.accountId,
            dueAt,
            id,
            recipientAccountId: input.recipientAccountId,
            severity: input.severity,
            summary: input.summary.trim(),
            tenantId: context.tenantId,
            title: input.title.trim(),
            type: input.type,
            updatedBy: context.accountId,
          },
        });
        await this.record(transaction, {
          action: 'inbox.item.created',
          aggregateId: id,
          aggregateType: 'InboxItem',
          aggregateVersion: 1,
          after: { status: 'UNREAD', type: input.type },
          businessRef: input.businessRef,
          context,
          eventName: 'platform.inbox-item-created.v1',
          metadata,
        });
        return {
          accepted: true,
          inboxItemId: id,
          status: 'UNREAD',
          version: 1,
        };
      },
    );
  }

  transitionInbox(
    inboxItemId: string,
    target: 'ARCHIVED' | 'READ',
    input: TransitionInboxInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { inboxItemId, target, ...input },
        responseCode: 200,
        scope: `platform.inbox-item.${target.toLowerCase()}.v1`,
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const item = await transaction.inboxItem.findFirst({
          where: {
            id: inboxItemId,
            recipientAccountId: context.accountId,
            tenantId: context.tenantId,
          },
        });
        if (!item) throw this.notFound('Inbox item');
        assertInboxTransition(item.status, target);
        if (item.version !== input.expectedVersion)
          throw this.versionConflict();
        const now = new Date();
        const changed = await transaction.inboxItem.updateMany({
          data: {
            ...(target === 'READ' ? { readAt: now } : { archivedAt: now }),
            status: target,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: item.id, status: item.status, version: item.version },
        });
        if (changed.count !== 1) throw this.versionConflict();
        if (target === 'READ') {
          await transaction.notificationRead.create({
            data: {
              accountId: context.accountId,
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              inboxItemId: item.id,
              readAt: now,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
        }
        await this.record(transaction, {
          action: `inbox.item.${target.toLowerCase()}`,
          aggregateId: item.id,
          aggregateType: 'InboxItem',
          aggregateVersion: item.version + 1,
          after: { status: target },
          before: { status: item.status },
          businessRef: item.businessRef,
          context,
          eventName: `platform.inbox-item-${target.toLowerCase()}.v1`,
          metadata,
        });
        return {
          inboxItemId: item.id,
          status: target,
          version: item.version + 1,
        };
      },
    );
  }

  createTemplate(
    input: CreateTemplateInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = input.code?.trim().toUpperCase();
    const whitelist = unique(input.variableWhitelist ?? []).sort();
    const channels = unique(input.channels ?? []);
    const referenced = unique([
      ...templateVariables(input.subjectTemplate ?? ''),
      ...templateVariables(input.bodyTemplate ?? ''),
    ]);
    if (
      !TEMPLATE_CODE_PATTERN.test(code) ||
      !input.subjectTemplate?.trim() ||
      !input.bodyTemplate?.trim() ||
      whitelist.some((name) => !VARIABLE_PATTERN.test(name)) ||
      referenced.some((name) => !whitelist.includes(name)) ||
      channels.length === 0 ||
      channels.some((channel) => !CHANNELS.has(channel))
    ) {
      throw new AppError(
        'NOTIFICATION_TEMPLATE_INVALID',
        'Template code, content, channels or variable whitelist is invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 201,
        scope: 'platform.notification-template.create.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const latest = await transaction.notificationTemplate.findFirst({
          orderBy: { versionNumber: 'desc' },
          where: { code, tenantId: context.tenantId },
        });
        const id = randomUUID();
        const versionNumber = (latest?.versionNumber ?? 0) + 1;
        await transaction.notificationTemplate.create({
          data: {
            bodyTemplate: input.bodyTemplate.trim(),
            channels,
            code,
            createdBy: context.accountId,
            id,
            locale: input.locale ?? 'zh-CN',
            subjectTemplate: input.subjectTemplate.trim(),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            variableWhitelist: whitelist,
            versionNumber,
          },
        });
        await this.record(transaction, {
          action: 'notification.template.created',
          aggregateId: id,
          aggregateType: 'NotificationTemplate',
          aggregateVersion: 1,
          after: { code, status: 'DRAFT', versionNumber },
          context,
          eventName: 'platform.notification-template-created.v1',
          metadata,
        });
        return { status: 'DRAFT', templateId: id, version: 1, versionNumber };
      },
    );
  }

  publishTemplate(
    templateId: string,
    input: PublishTemplateInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { templateId, ...input },
        responseCode: 200,
        scope: 'platform.notification-template.publish.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const template = await transaction.notificationTemplate.findFirst({
          where: { id: templateId, tenantId: context.tenantId },
        });
        if (!template) throw this.notFound('Notification template');
        assertTemplateTransition(template.status, 'PUBLISHED');
        if (template.version !== input.expectedVersion)
          throw this.versionConflict();
        const current = await transaction.notificationTemplate.findFirst({
          where: {
            code: template.code,
            id: { not: template.id },
            locale: template.locale,
            status: 'PUBLISHED',
            tenantId: context.tenantId,
          },
        });
        if (current) {
          assertTemplateTransition(current.status, 'RETIRED');
          await transaction.notificationTemplate.update({
            data: {
              retiredAt: new Date(),
              status: 'RETIRED',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: current.id },
          });
          await this.record(transaction, {
            action: 'notification.template.retired',
            aggregateId: current.id,
            aggregateType: 'NotificationTemplate',
            aggregateVersion: current.version + 1,
            after: { status: 'RETIRED' },
            before: { status: current.status },
            context,
            eventName: 'platform.notification-template-retired.v1',
            metadata,
          });
        }
        await transaction.notificationTemplate.update({
          data: {
            publishedAt: new Date(),
            status: 'PUBLISHED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: template.id },
        });
        await this.record(transaction, {
          action: 'notification.template.published',
          aggregateId: template.id,
          aggregateType: 'NotificationTemplate',
          aggregateVersion: template.version + 1,
          after: { status: 'PUBLISHED' },
          before: { status: template.status },
          context,
          eventName: 'platform.notification-template-published.v1',
          metadata,
        });
        return {
          status: 'PUBLISHED',
          templateId: template.id,
          version: template.version + 1,
          versionNumber: template.versionNumber,
        };
      },
    );
  }

  upsertPreference(
    input: UpsertPreferenceInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      !CHANNELS.has(input.channel) ||
      (input.fallbackChannel && !CHANNELS.has(input.fallbackChannel)) ||
      (input.minimumSeverity !== undefined &&
        !SEVERITIES.has(input.minimumSeverity)) ||
      (input.quietStartMinutes !== undefined &&
        (!Number.isInteger(input.quietStartMinutes) ||
          input.quietStartMinutes < 0 ||
          input.quietStartMinutes > 1439)) ||
      (input.quietEndMinutes !== undefined &&
        (!Number.isInteger(input.quietEndMinutes) ||
          input.quietEndMinutes < 0 ||
          input.quietEndMinutes > 1439))
    ) {
      throw new AppError(
        'SUBSCRIPTION_PREFERENCE_INVALID',
        'Subscription channel or quiet hours are invalid',
        400,
      );
    }
    minutesInTimezone(new Date(), input.timezone ?? 'Asia/Shanghai');
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 200,
        scope: 'platform.subscription-preference.upsert.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const existing = await transaction.subscriptionPreference.findUnique({
          where: {
            tenantId_accountId_channel: {
              accountId: context.accountId,
              channel: input.channel,
              tenantId: context.tenantId,
            },
          },
        });
        if (
          existing &&
          input.expectedVersion !== undefined &&
          existing.version !== input.expectedVersion
        ) {
          throw this.versionConflict();
        }
        const preference = await transaction.subscriptionPreference.upsert({
          create: {
            accountId: context.accountId,
            channel: input.channel,
            createdBy: context.accountId,
            enabled: input.enabled,
            fallbackChannel: input.fallbackChannel ?? null,
            minimumSeverity: input.minimumSeverity ?? 'INFO',
            quietEndMinutes: input.quietEndMinutes ?? null,
            quietStartMinutes: input.quietStartMinutes ?? null,
            tenantId: context.tenantId,
            timezone: input.timezone ?? 'Asia/Shanghai',
            updatedBy: context.accountId,
          },
          update: {
            enabled: input.enabled,
            fallbackChannel: input.fallbackChannel ?? null,
            minimumSeverity: input.minimumSeverity ?? 'INFO',
            quietEndMinutes: input.quietEndMinutes ?? null,
            quietStartMinutes: input.quietStartMinutes ?? null,
            timezone: input.timezone ?? 'Asia/Shanghai',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            tenantId_accountId_channel: {
              accountId: context.accountId,
              channel: input.channel,
              tenantId: context.tenantId,
            },
          },
        });
        await this.record(transaction, {
          action: 'notification.preference.saved',
          aggregateId: preference.id,
          aggregateType: 'SubscriptionPreference',
          aggregateVersion: preference.version,
          after: {
            channel: preference.channel,
            enabled: preference.enabled,
            minimumSeverity: preference.minimumSeverity,
          },
          context,
          eventName: 'platform.notification-preference-saved.v1',
          metadata,
        });
        return {
          channel: preference.channel,
          preferenceId: preference.id,
          status: preference.status,
          version: preference.version,
        };
      },
    );
  }

  async listPreferences(context: TenantContext) {
    return this.prisma.subscriptionPreference.findMany({
      orderBy: { channel: 'asc' },
      where: {
        accountId: context.accountId,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
  }

  createNotification(
    input: CreateNotificationInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.validateBusinessTarget(input);
    this.assertOrganizationScope(input.organizationId, context);
    if (!isUuid(input.recipientAccountId) || !SEVERITIES.has(input.severity)) {
      throw new AppError(
        'NOTIFICATION_RECIPIENT_INVALID',
        'recipientAccountId must be a UUID',
        400,
      );
    }
    const code = input.templateCode?.trim().toUpperCase();
    const escalationAt = input.escalationAt
      ? new Date(input.escalationAt)
      : null;
    if (escalationAt && Number.isNaN(escalationAt.getTime())) {
      throw new AppError(
        'NOTIFICATION_ESCALATION_AT_INVALID',
        'escalationAt is invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 201,
        scope: 'platform.notification.create.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const template = await transaction.notificationTemplate.findFirst({
          orderBy: { versionNumber: 'desc' },
          where: {
            code,
            locale: input.locale ?? 'zh-CN',
            status: 'PUBLISHED',
            tenantId: context.tenantId,
          },
        });
        if (!template) throw this.notFound('Published notification template');
        const whitelist = template.variableWhitelist as string[];
        const subject = renderNotificationTemplate(
          template.subjectTemplate,
          whitelist,
          input.variables,
        );
        const body = renderNotificationTemplate(
          template.bodyTemplate,
          whitelist,
          input.variables,
        );
        const requested = unique(
          input.channels ?? (template.channels as NotificationChannel[]),
        );
        if (
          requested.length === 0 ||
          requested.some((channel) => !CHANNELS.has(channel))
        ) {
          throw new AppError(
            'NOTIFICATION_CHANNEL_INVALID',
            'Notification channels are invalid',
            400,
          );
        }
        const preferences = await transaction.subscriptionPreference.findMany({
          where: {
            accountId: input.recipientAccountId,
            channel: { in: requested },
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        });
        const preferenceByChannel = new Map(
          preferences.map(
            (preference) => [preference.channel, preference] as const,
          ),
        );
        const now = new Date();
        const selected = requested.filter((channel) => {
          const preference = preferenceByChannel.get(channel);
          return (
            preference?.enabled !== false &&
            SEVERITY_RANK[input.severity] >=
              SEVERITY_RANK[preference?.minimumSeverity ?? 'INFO'] &&
            (input.severity === 'CRITICAL' ||
              !isQuietTime(
                preference?.quietStartMinutes ?? null,
                preference?.quietEndMinutes ?? null,
                minutesInTimezone(now, preference?.timezone ?? 'Asia/Shanghai'),
              ))
          );
        });
        const fallbackChannels = unique(
          preferences
            .map(({ fallbackChannel }) => fallbackChannel)
            .filter((channel): channel is NotificationChannel =>
              Boolean(channel),
            ),
        );
        const routed = selected.length
          ? selected
          : fallbackChannels.length
            ? fallbackChannels
            : ['IN_APP' as const];
        const id = randomUUID();
        await transaction.notification.create({
          data: {
            ...this.businessTargetData(input),
            createdBy: context.accountId,
            escalationAt,
            id,
            recipientAccountId: input.recipientAccountId,
            renderedBody: body,
            renderedSubject: subject,
            requestedChannels: routed,
            severity: input.severity,
            templateId: template.id,
            templateVersion: template.versionNumber,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            variables: input.variables as Prisma.InputJsonObject,
          },
        });
        await this.record(transaction, {
          action: 'notification.created',
          aggregateId: id,
          aggregateType: 'Notification',
          aggregateVersion: 1,
          after: { channels: routed, status: 'PENDING' },
          businessRef: input.businessRef,
          context,
          eventName: 'platform.notification-created.v1',
          metadata,
        });
        return {
          accepted: true,
          channels: routed,
          notificationId: id,
          status: 'PENDING',
          version: 1,
        };
      },
    );
  }

  dispatch(
    notificationId: string,
    input: DispatchNotificationInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { notificationId, ...input },
        responseCode: 200,
        scope: 'platform.notification.dispatch.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const notification = await transaction.notification.findFirst({
          where: { id: notificationId, tenantId: context.tenantId },
        });
        if (!notification) throw this.notFound('Notification');
        if (notification.version !== input.expectedVersion)
          throw this.versionConflict();
        if (
          !['PENDING', 'PARTIAL_FAILED', 'FAILED'].includes(notification.status)
        ) {
          throw new AppError(
            'NOTIFICATION_DISPATCH_STATE_INVALID',
            'Delivered notifications cannot be dispatched again',
            409,
          );
        }
        const attempts = await transaction.deliveryAttempt.findMany({
          where: { notificationId, tenantId: context.tenantId },
        });
        const delivered = new Set(
          attempts
            .filter(({ status }) => status === 'DELIVERED')
            .map(({ channel }) => channel),
        );
        const requested =
          notification.requestedChannels as NotificationChannel[];
        const targetChannels = requested.filter((channel) => {
          const count = attempts.filter(
            (attempt) => attempt.channel === channel,
          ).length;
          return !delivered.has(channel) && count < 3;
        });
        if (targetChannels.length === 0) {
          throw new AppError(
            'NOTIFICATION_RETRY_EXHAUSTED',
            'No retryable delivery channel remains',
            409,
          );
        }
        const results: Array<{
          channel: NotificationChannel;
          delivered: boolean;
          errorCode?: string;
          providerMessageId?: string;
          retryable: boolean;
        }> = [];
        for (const channel of targetChannels) {
          results.push({
            channel,
            ...(await this.channels.deliver({
              body: notification.renderedBody,
              channel,
              notificationId,
              recipientAccountId: notification.recipientAccountId,
              subject: notification.renderedSubject,
            })),
          });
        }
        const deliveredNow = results.filter((result) => result.delivered);
        if (
          deliveredNow.length === 0 &&
          results.some((result) => !result.delivered) &&
          !delivered.has('IN_APP') &&
          !targetChannels.includes('IN_APP')
        ) {
          results.push({
            channel: 'IN_APP',
            ...(await this.channels.deliver({
              body: notification.renderedBody,
              channel: 'IN_APP',
              notificationId,
              recipientAccountId: notification.recipientAccountId,
              subject: notification.renderedSubject,
            })),
          });
        }
        for (const result of results) {
          const previousCount = attempts.filter(
            (attempt) => attempt.channel === result.channel,
          ).length;
          await transaction.deliveryAttempt.create({
            data: {
              attemptNumber: previousCount + 1,
              channel: result.channel,
              createdBy: context.accountId,
              deliveredAt: result.delivered ? new Date() : null,
              errorCode: result.errorCode ?? null,
              nextRetryAt:
                !result.delivered && result.retryable && previousCount < 2
                  ? new Date(Date.now() + 2 ** previousCount * 60_000)
                  : null,
              notificationId,
              providerMessageId: result.providerMessageId ?? null,
              retryable: result.retryable,
              status: result.delivered ? 'DELIVERED' : 'FAILED',
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          if (result.delivered) delivered.add(result.channel);
        }
        if (
          results.some(
            (result) => result.channel === 'IN_APP' && result.delivered,
          )
        ) {
          await transaction.inboxItem.create({
            data: {
              businessDomain: notification.businessDomain,
              businessObjectId: notification.businessObjectId,
              businessObjectType: notification.businessObjectType,
              businessRef: notification.businessRef,
              createdBy: context.accountId,
              organizationId: notification.organizationId,
              recipientAccountId: notification.recipientAccountId,
              responsibilityGroup: notification.responsibilityGroup,
              route: notification.route,
              severity: notification.severity,
              sourceNotificationId: notification.id,
              summary: notification.renderedBody.slice(0, 2000),
              tenantId: context.tenantId,
              title: notification.renderedSubject,
              type: 'NOTIFICATION',
              updatedBy: context.accountId,
            },
          });
        }
        const allRequestedDelivered = requested.every((channel) =>
          delivered.has(channel),
        );
        const nextStatus: NotificationStatus = allRequestedDelivered
          ? 'DELIVERED'
          : delivered.size > 0
            ? 'PARTIAL_FAILED'
            : 'FAILED';
        assertNotificationTransition(notification.status, nextStatus);
        await transaction.notification.update({
          data: {
            deliveredChannels: [...delivered].sort(),
            status: nextStatus,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: notification.id },
        });
        await this.record(transaction, {
          action: 'notification.dispatched',
          aggregateId: notification.id,
          aggregateType: 'Notification',
          aggregateVersion: notification.version + 1,
          after: { deliveredChannels: [...delivered], status: nextStatus },
          before: { status: notification.status },
          businessRef: notification.businessRef,
          context,
          eventName: 'platform.notification-dispatched.v1',
          metadata,
        });
        return {
          deliveredChannels: [...delivered].sort(),
          notificationId,
          status: nextStatus,
          version: notification.version + 1,
        };
      },
    );
  }

  escalate(
    notificationId: string,
    input: EscalateNotificationInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { notificationId, ...input },
        responseCode: 200,
        scope: 'platform.notification.escalate.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const notification = await transaction.notification.findFirst({
          where: { id: notificationId, tenantId: context.tenantId },
        });
        if (!notification) throw this.notFound('Notification');
        if (notification.version !== input.expectedVersion)
          throw this.versionConflict();
        if (
          notification.escalatedAt ||
          !notification.escalationAt ||
          notification.escalationAt > new Date()
        ) {
          throw new AppError(
            'NOTIFICATION_ESCALATION_NOT_DUE',
            'Notification is not due for escalation',
            409,
          );
        }
        const severities: readonly NotificationSeverity[] = [
          'INFO',
          'WARNING',
          'ERROR',
          'CRITICAL',
        ];
        const nextSeverity =
          severities[
            Math.min(severities.indexOf(notification.severity) + 1, 3)
          ]!;
        await transaction.notification.update({
          data: {
            escalatedAt: new Date(),
            responsibilityGroup: input.responsibilityGroup,
            severity: nextSeverity,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: notification.id },
        });
        await this.record(transaction, {
          action: 'notification.escalated',
          aggregateId: notification.id,
          aggregateType: 'Notification',
          aggregateVersion: notification.version + 1,
          after: {
            responsibilityGroup: input.responsibilityGroup,
            severity: nextSeverity,
          },
          before: {
            responsibilityGroup: notification.responsibilityGroup,
            severity: notification.severity,
          },
          businessRef: notification.businessRef,
          context,
          eventName: 'platform.notification-escalated.v1',
          metadata,
        });
        return {
          notificationId,
          severity: nextSeverity,
          status: notification.status,
          version: notification.version + 1,
        };
      },
    );
  }

  private validateBusinessTarget(input: BusinessTargetInput): void {
    if (
      !IDENTIFIER_PATTERN.test(input.businessDomain) ||
      !IDENTIFIER_PATTERN.test(input.businessObjectType) ||
      !isUuid(input.businessObjectId) ||
      (input.organizationId !== undefined && !isUuid(input.organizationId)) ||
      !input.businessRef?.trim() ||
      !input.responsibilityGroup?.trim() ||
      !input.route?.startsWith('/')
    ) {
      throw new AppError(
        'NOTIFICATION_BUSINESS_TARGET_INVALID',
        'Notification business target is invalid',
        400,
      );
    }
  }

  private assertOrganizationScope(
    organizationId: string | undefined,
    context: TenantContext,
  ): void {
    if (!notificationOrganizationAllowed(organizationId, context)) {
      throw new AppError(
        'NOTIFICATION_SCOPE_DENIED',
        'The notification target is outside the current data scope',
        403,
      );
    }
  }

  private businessTargetData(input: BusinessTargetInput) {
    return {
      businessDomain: input.businessDomain,
      businessObjectId: input.businessObjectId,
      businessObjectType: input.businessObjectType,
      businessRef: input.businessRef.trim(),
      organizationId: input.organizationId ?? null,
      responsibilityGroup: input.responsibilityGroup.trim(),
      route: input.route,
    };
  }

  private async record(
    transaction: Prisma.TransactionClient,
    input: {
      readonly action: string;
      readonly after: Prisma.InputJsonObject;
      readonly aggregateId: string;
      readonly aggregateType: string;
      readonly aggregateVersion: number;
      readonly before?: Prisma.InputJsonObject;
      readonly businessRef?: string;
      readonly context: TenantContext;
      readonly eventName: string;
      readonly metadata: CommandMetadata;
    },
  ) {
    await transaction.platformAuditLog.create({
      data: {
        action: input.action,
        after: input.after,
        ...(input.before ? { before: input.before } : {}),
        businessRef: input.businessRef ?? null,
        correlationId: input.metadata.correlationId,
        createdBy: input.context.accountId,
        deviceId: input.context.deviceId,
        ipAddress: input.metadata.ipAddress ?? null,
        resourceId: input.aggregateId,
        resourceType: input.aggregateType,
        tenantId: input.context.tenantId,
        updatedBy: input.context.accountId,
      },
    });
    await transaction.platformOutbox.create({
      data: {
        aggregateId: input.aggregateId,
        aggregateType: input.aggregateType,
        aggregateVersion: input.aggregateVersion,
        correlationId: input.metadata.correlationId,
        createdBy: input.context.accountId,
        eventName: input.eventName,
        payload: {
          aggregateId: input.aggregateId,
          tenantId: input.context.tenantId,
          version: input.aggregateVersion,
        },
        tenantId: input.context.tenantId,
        updatedBy: input.context.accountId,
      },
    });
  }

  private notFound(resource: string) {
    return new AppError(
      'NOTIFICATION_RESOURCE_NOT_FOUND',
      `${resource} was not found in the current tenant`,
      404,
    );
  }

  private versionConflict() {
    return new AppError(
      'NOTIFICATION_VERSION_CONFLICT',
      'Notification resource version changed; refresh and retry',
      409,
      { retryable: true },
    );
  }
}

import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '@scm/shared';
import type { PrismaService } from '../../database/prisma.service';
import type { IdempotencyService } from './idempotency.service';
import { NotificationChannelService } from './notification-channel.service';
import {
  NotificationService,
  assertInboxTransition,
  assertNotificationTransition,
  assertTemplateTransition,
  isQuietTime,
  notificationOrganizationAllowed,
  renderNotificationTemplate,
  templateVariables,
} from './notification.service';

const context: TenantContext = {
  accountId: '10000000-0000-4000-8000-000000000001',
  accountKind: 'USER',
  deviceId: 'test-device',
  organizationIds: ['10000000-0000-4000-8000-000000000010'],
  permissionVersion: 1,
  tenantId: '10000000-0000-4000-8000-000000000002',
  tokenId: 'test-token',
};

const metadata = {
  correlationId: 'notification-test',
  idempotencyKey: 'notification-idem',
  ipAddress: '127.0.0.1',
};

function fakeIdempotency(transaction: object) {
  const cache = new Map<string, { payload: string; response: object }>();
  return {
    execute: vi.fn(
      async (
        input: { key?: string; payload: unknown; scope: string },
        operation: (value: object) => Promise<object>,
      ) => {
        const key = `${input.scope}:${input.key}`;
        const payload = JSON.stringify(input.payload);
        const existing = cache.get(key);
        if (existing) {
          if (existing.payload !== payload)
            throw new Error('different content');
          return existing.response;
        }
        const response = await operation(transaction);
        cache.set(key, { payload, response });
        return response;
      },
    ),
  } as unknown as IdempotencyService;
}

describe('notification template and routing contracts', () => {
  it('renders only whitelisted variables and returns field-level errors', () => {
    expect(
      templateVariables('{{orderNo}} / {{ orderNo }} / {{severity}}'),
    ).toEqual(['orderNo', 'severity']);
    expect(
      renderNotificationTemplate(
        '订单 {{orderNo}}：{{summary}}',
        ['orderNo', 'summary'],
        { orderNo: 'SO-1', summary: '等待处理' },
      ),
    ).toBe('订单 SO-1：等待处理');
    expect(() =>
      renderNotificationTemplate('订单 {{orderNo}}', ['orderNo'], {
        secret: 'not-allowed',
      }),
    ).toThrow(/whitelist/);
  });

  it('enforces every declared state transition', () => {
    expect(() => assertInboxTransition('UNREAD', 'READ')).not.toThrow();
    expect(() => assertInboxTransition('READ', 'ARCHIVED')).not.toThrow();
    expect(() => assertInboxTransition('UNREAD', 'ARCHIVED')).toThrow();
    expect(() => assertTemplateTransition('DRAFT', 'PUBLISHED')).not.toThrow();
    expect(() =>
      assertTemplateTransition('PUBLISHED', 'RETIRED'),
    ).not.toThrow();
    expect(() => assertTemplateTransition('RETIRED', 'PUBLISHED')).toThrow();
    for (const target of ['DELIVERED', 'PARTIAL_FAILED', 'FAILED'] as const) {
      expect(() =>
        assertNotificationTransition('PENDING', target),
      ).not.toThrow();
    }
    expect(() => assertNotificationTransition('DELIVERED', 'FAILED')).toThrow();
  });

  it('applies cross-midnight quiet hours and organization ABAC', () => {
    expect(isQuietTime(22 * 60, 7 * 60, 23 * 60)).toBe(true);
    expect(isQuietTime(22 * 60, 7 * 60, 8 * 60)).toBe(false);
    expect(
      notificationOrganizationAllowed(context.organizationIds[0], context),
    ).toBe(true);
    expect(
      notificationOrganizationAllowed(
        '10000000-0000-4000-8000-000000000099',
        context,
      ),
    ).toBe(false);
  });
});

describe('inbox command contracts', () => {
  it('creates an inbox item once and detects conflicting idempotent replay', async () => {
    const transaction = {
      inboxItem: { create: vi.fn() },
      platformAuditLog: { create: vi.fn() },
      platformOutbox: { create: vi.fn() },
    };
    const service = new NotificationService(
      new NotificationChannelService(),
      fakeIdempotency(transaction),
      {} as PrismaService,
    );
    const input = {
      businessDomain: 'OMS',
      businessObjectId: '10000000-0000-4000-8000-000000000020',
      businessObjectType: 'ORDER',
      businessRef: 'SO-001',
      organizationId: context.organizationIds[0]!,
      recipientAccountId: context.accountId,
      responsibilityGroup: 'ORDER_OPS',
      route: '/oms/orders/10000000-0000-4000-8000-000000000020',
      severity: 'WARNING' as const,
      summary: '等待审批',
      title: '订单待办',
      type: 'APPROVAL' as const,
    };

    const first = await service.createInboxItem(input, context, metadata);
    const replay = await service.createInboxItem(input, context, metadata);
    expect(replay).toEqual(first);
    expect(transaction.inboxItem.create).toHaveBeenCalledTimes(1);
    await expect(
      service.createInboxItem(
        { ...input, title: 'changed' },
        context,
        metadata,
      ),
    ).rejects.toThrow(/different content/);
  });

  it('records the immutable read fact with the state change', async () => {
    const item = {
      businessRef: 'SO-001',
      id: '10000000-0000-4000-8000-000000000030',
      status: 'UNREAD' as const,
      version: 1,
    };
    const transaction = {
      inboxItem: {
        findFirst: vi.fn(async () => item),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      notificationRead: { create: vi.fn() },
      platformAuditLog: { create: vi.fn() },
      platformOutbox: { create: vi.fn() },
    };
    const service = new NotificationService(
      new NotificationChannelService(),
      fakeIdempotency(transaction),
      {} as PrismaService,
    );

    await expect(
      service.transitionInbox(
        item.id,
        'READ',
        { expectedVersion: 1 },
        context,
        metadata,
      ),
    ).resolves.toEqual({ inboxItemId: item.id, status: 'READ', version: 2 });
    expect(transaction.notificationRead.create).toHaveBeenCalledTimes(1);
    expect(transaction.platformOutbox.create).toHaveBeenCalledTimes(1);
  });
});

describe('multi-channel delivery contracts', () => {
  it('falls back to in-app, records a retry, and replays without duplicate delivery', async () => {
    const notification = {
      businessDomain: 'OMS',
      businessObjectId: '10000000-0000-4000-8000-000000000020',
      businessObjectType: 'ORDER',
      businessRef: 'SO-001',
      deliveredChannels: [],
      id: '10000000-0000-4000-8000-000000000040',
      organizationId: context.organizationIds[0],
      recipientAccountId: context.accountId,
      renderedBody: '正文',
      renderedSubject: '主题',
      requestedChannels: ['EMAIL'],
      responsibilityGroup: 'ORDER_OPS',
      route: '/oms/orders/1',
      severity: 'ERROR' as const,
      status: 'PENDING' as const,
      version: 1,
    };
    const attempts: Array<{
      channel: 'EMAIL' | 'IN_APP';
      status: 'DELIVERED' | 'FAILED';
    }> = [];
    const transaction = {
      deliveryAttempt: {
        create: vi.fn(async ({ data }) => {
          attempts.push({ channel: data.channel, status: data.status });
        }),
        findMany: vi.fn(async () => attempts),
      },
      inboxItem: { create: vi.fn() },
      notification: {
        findFirst: vi.fn(async () => ({ ...notification })),
        update: vi.fn(async ({ data }) => {
          notification.status = data.status;
          notification.version += 1;
          notification.deliveredChannels = data.deliveredChannels;
        }),
      },
      platformAuditLog: { create: vi.fn() },
      platformOutbox: { create: vi.fn() },
    };
    const service = new NotificationService(
      new NotificationChannelService(),
      fakeIdempotency(transaction),
      {} as PrismaService,
    );

    const first = await service.dispatch(
      notification.id,
      { expectedVersion: 1 },
      context,
      metadata,
    );
    const replay = await service.dispatch(
      notification.id,
      { expectedVersion: 1 },
      context,
      metadata,
    );
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      deliveredChannels: ['IN_APP'],
      status: 'PARTIAL_FAILED',
      version: 2,
    });
    expect(attempts).toEqual([
      { channel: 'EMAIL', status: 'FAILED' },
      { channel: 'IN_APP', status: 'DELIVERED' },
    ]);
    expect(transaction.inboxItem.create).toHaveBeenCalledTimes(1);

    await service.dispatch(notification.id, { expectedVersion: 2 }, context, {
      ...metadata,
      idempotencyKey: 'notification-retry',
    });
    expect(attempts.filter(({ channel }) => channel === 'EMAIL')).toHaveLength(
      2,
    );
    expect(transaction.inboxItem.create).toHaveBeenCalledTimes(1);
    await service.dispatch(notification.id, { expectedVersion: 3 }, context, {
      ...metadata,
      idempotencyKey: 'notification-retry-final',
    });
    await expect(
      service.dispatch(notification.id, { expectedVersion: 4 }, context, {
        ...metadata,
        idempotencyKey: 'notification-retry-exhausted',
      }),
    ).rejects.toThrow(/No retryable/);
  });
});

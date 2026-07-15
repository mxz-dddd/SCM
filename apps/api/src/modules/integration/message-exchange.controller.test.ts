import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { MessageExchangeController } from './message-exchange.controller';

describe('Integration message exchange HTTP contract', () => {
  it('marks all exchange management and processing writes idempotent', () => {
    const expected = new Map([
      ['receiveFile', 'integration.file.receive.v1'],
      ['completeFile', 'integration.file.complete.v1'],
      ['archiveFile', 'integration.file.archive.v1'],
      ['createMapping', 'integration.mapping.create.v1'],
      ['createMappingVersion', 'integration.mapping-version.create.v1'],
      ['testMapping', 'integration.mapping.test.v1'],
      ['publishMapping', 'integration.mapping.publish.v1'],
      ['transform', 'integration.mapping.transform.v1'],
      ['createWebhook', 'integration.webhook.create.v1'],
      ['disableWebhook', 'integration.webhook.disable.v1'],
      ['publishWebhookEvent', 'integration.webhook.event.publish.v1'],
      ['completeDelivery', 'integration.webhook.delivery.complete.v1'],
      ['claimDeliveries', 'integration.webhook.delivery.claim.v1'],
      ['replayMessage', 'integration.message.replay.v1'],
    ]);
    for (const [method, scope] of expected)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          MessageExchangeController.prototype[
            method as keyof MessageExchangeController
          ],
        ),
      ).toBe(scope);
  });

  it('denies message replay without its dedicated permission', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'message-replay-permission-test',
      originalUrl: '/api/v1/integration/exchange/messages/id/replay',
      tenantContext: {
        accountId: '10000000-0000-4000-8000-000000000001',
        accountKind: 'USER',
        deviceId: 'test',
        organizationIds: [],
        permissionVersion: 1,
        tenantId: '10000000-0000-4000-8000-000000000002',
        tokenId: 'token',
      },
    };
    const execution = {
      getClass: () => MessageExchangeController,
      getHandler: () => MessageExchangeController.prototype.replayMessage,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'integration.message.replay' }),
    );
  });
});

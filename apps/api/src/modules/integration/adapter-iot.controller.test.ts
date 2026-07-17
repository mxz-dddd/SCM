import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { AdapterIotController } from './adapter-iot.controller';

describe('Integration adapter and IoT HTTP contract', () => {
  it('marks every authenticated management write idempotent', () => {
    const expected = new Map([
      ['createAdapter', 'integration.adapter.create.v1'],
      ['createAdapterVersion', 'integration.adapter-version.create.v1'],
      ['testAdapterVersion', 'integration.adapter-version.test.v1'],
      ['publishAdapterVersion', 'integration.adapter-version.publish.v1'],
      ['transitionAdapter', 'integration.adapter.transition.v1'],
      ['submitAdapterCommand', 'integration.adapter-command.submit.v1'],
      ['dispatchAdapterCommand', 'integration.adapter-command.dispatch.v1'],
      [
        'acknowledgeAdapterCommand',
        'integration.adapter-command.acknowledge.v1',
      ],
      ['registerDevice', 'integration.device.register.v1'],
      ['transitionDevice', 'integration.device.transition.v1'],
      ['rotateDeviceCertificate', 'integration.device-certificate.rotate.v1'],
      ['issueDeviceCommand', 'integration.device-command.issue.v1'],
      ['sendDeviceCommand', 'integration.device-command.send.v1'],
    ]);
    for (const [method, scope] of expected)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          AdapterIotController.prototype[method as keyof AdapterIotController],
        ),
      ).toBe(scope);
  });

  it('denies device commands without their dedicated permission', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'adapter-iot-permission-test',
      originalUrl: '/api/v1/integration/adapter-iot/devices/id/commands',
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
      getClass: () => AdapterIotController,
      getHandler: () => AdapterIotController.prototype.issueDeviceCommand,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'integration.device.command' }),
    );
  });
});

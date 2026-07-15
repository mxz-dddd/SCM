import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from './auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from './idempotent.decorator';
import { OperationsController } from './operations.controller';

describe('operations command boundary', () => {
  it('denies release commands without the operations release grant', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: (name: string) =>
        name === 'X-Correlation-Id' ? 'ops-permission-test' : undefined,
      originalUrl: '/api/v1/platform/operations/releases',
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
    const executionContext = {
      getClass: () => OperationsController,
      getHandler: () => OperationsController.prototype.release,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(
      guard.canActivate(executionContext as never),
    ).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionCode: 'platform.operations.release.manage',
      }),
    );
  });

  it('marks every external operations command as idempotent', () => {
    for (const method of [
      'createMonitorRule',
      'transitionDefinition',
      'signal',
      'alert',
      'backup',
      'backupTransition',
      'drill',
      'release',
      'releaseTransition',
      'migrationRun',
      'migrationRunTransition',
      'retention',
      'archive',
      'privacy',
      'privacyTransition',
      'capacity',
      'tenantMigration',
      'tenantMigrationTransition',
      'execute',
    ] as const)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          OperationsController.prototype[method],
        ),
      ).toMatch(/^platform\.ops\..+\.v1$/);
  });
});

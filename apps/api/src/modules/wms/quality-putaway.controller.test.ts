import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { QualityPutawayController } from './quality-putaway.controller';

describe('WMS quality and putaway HTTP contract', () => {
  it('requires idempotency on every write endpoint', () => {
    const methods = [
      'inspection',
      'transitionInspection',
      'disposition',
      'decide',
      'task',
      'start',
      'confirm',
      'crossDock',
      'transitionCrossDock',
    ] as const;
    for (const method of methods)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          QualityPutawayController.prototype[method],
        ),
      ).toMatch(/^wms\./);
  });

  it('denies concession and nonconforming disposition without permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'quality-permission-test',
      originalUrl: '/api/v1/wms/inspections/id/dispositions',
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
      getClass: () => QualityPutawayController,
      getHandler: () => QualityPutawayController.prototype.disposition,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'wms.quality.dispose' }),
    );
  });
});

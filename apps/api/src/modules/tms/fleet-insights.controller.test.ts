import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { FleetInsightsController } from './fleet-insights.controller';

describe('TMS fleet, IoT, KPI and public tracking HTTP contract', () => {
  it('uses generic idempotency for every write command', () => {
    for (const method of [
      'scheduleMaintenance',
      'transitionMaintenance',
      'recordOperatingFact',
      'ingestTelemetry',
      'transitionAlert',
      'generateMetrics',
      'issueTrackingToken',
      'revokeTrackingToken',
    ] as const)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          FleetInsightsController.prototype[method],
        ),
      ).toMatch(/^tms\./);
  });

  it('denies tracking token issue without share permission', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'fleet-insights-permission-test',
      originalUrl: '/api/v1/tms/fleet-insights/shipments/id/tracking-tokens',
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
      getClass: () => FleetInsightsController,
      getHandler: () => FleetInsightsController.prototype.issueTrackingToken,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'tms.tracking.share' }),
    );
  });
});

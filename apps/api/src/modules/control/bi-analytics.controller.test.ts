import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { BiAnalyticsController } from './bi-analytics.controller';

describe('Control BI analytics HTTP contract', () => {
  it('marks every BI, query and lake command idempotent', () => {
    const expected = new Map([
      ['publishMetric', 'control.bi.metric.publish.v1'],
      ['observeMetric', 'control.bi.metric.observe.v1'],
      ['publishDashboard', 'control.bi.dashboard.publish.v1'],
      ['publishReport', 'control.bi.report.publish.v1'],
      ['runQuery', 'control.bi.query.run.v1'],
      ['runSensitiveQuery', 'control.bi.query.sensitive.v1'],
      ['exportReport', 'control.bi.report.export.v1'],
      ['consumeLakeEvent', 'control.bi.lake.consume.v1'],
      ['recomputeLake', 'control.bi.lake.recompute.v1'],
    ]);
    for (const [method, scope] of expected)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          BiAnalyticsController.prototype[
            method as keyof BiAnalyticsController
          ],
        ),
      ).toBe(scope);
  });

  it('denies sensitive results without the dedicated permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'control-bi-permission-test',
      originalUrl: '/api/v1/control/bi/reports/id/query-jobs/sensitive',
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
      getClass: () => BiAnalyticsController,
      getHandler: () => BiAnalyticsController.prototype.runSensitiveQuery,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'control.bi.query.sensitive' }),
    );
  });
});

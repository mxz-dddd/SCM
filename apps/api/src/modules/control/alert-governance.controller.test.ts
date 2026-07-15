import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { AlertGovernanceController } from './alert-governance.controller';

describe('Control alert governance HTTP contract', () => {
  it('marks every alert and SLA command idempotent', () => {
    const expected = new Map([
      ['startSla', 'control.sla.start.v1'],
      ['transitionSla', 'control.sla.transition.v1'],
      ['reopenSla', 'control.sla.reopen.v1'],
      ['monitorSla', 'control.sla.monitor.v1'],
      ['publishRule', 'control.alert-rule.publish.v1'],
      ['consumeAlertEvent', 'control.alert-event.consume.v1'],
      ['assignCase', 'control.alert.assign.v1'],
      ['actionCase', 'control.alert.action.v1'],
      ['requestRemediation', 'control.alert.remediation.v1'],
      ['monitorEscalations', 'control.alert-escalation.monitor.v1'],
      ['publishKnowledge', 'control.knowledge.publish.v1'],
    ]);
    for (const [method, scope] of expected)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          AlertGovernanceController.prototype[
            method as keyof AlertGovernanceController
          ],
        ),
      ).toBe(scope);
  });

  it('denies remediation without the domain-command permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'control-alert-permission-test',
      originalUrl: '/api/v1/control/alerts/id/remediation',
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
      getClass: () => AlertGovernanceController,
      getHandler: () => AlertGovernanceController.prototype.requestRemediation,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'control.alert.remediate' }),
    );
  });
});

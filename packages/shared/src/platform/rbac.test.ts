import { describe, expect, it } from 'vitest';
import {
  ADMIN_PERMISSIONS,
  READ_ONLY_AUDITOR_PERMISSION_CODES,
  buildOrganizationPath,
  collectRoleLineage,
  resolvePermission,
} from './rbac';

describe('organization paths', () => {
  it('builds root and descendant materialized paths', () => {
    expect(buildOrganizationPath(undefined, 'root')).toBe('/root');
    expect(buildOrganizationPath('/root', 'child')).toBe('/root/child');
  });
});

describe('RBAC resolution', () => {
  it('inherits template roles and terminates safely on a malformed cycle', () => {
    const roles = [
      { id: 'operator', templateRoleId: 'template' },
      { id: 'template', templateRoleId: 'base' },
      { id: 'base', templateRoleId: 'template' },
    ];
    expect(collectRoleLineage('operator', roles)).toEqual([
      'operator',
      'template',
      'base',
    ]);
  });

  it('allows inherited organization scope and rejects other branches', () => {
    const grants = [
      {
        effect: 'ALLOW' as const,
        organizationPath: '/root/ops',
        permissionCode: 'platform.organization.read',
      },
    ];
    expect(
      resolvePermission(
        grants,
        'platform.organization.read',
        '/root/ops/warehouse',
      ).allowed,
    ).toBe(true);
    expect(
      resolvePermission(grants, 'platform.organization.read', '/root/finance')
        .allowed,
    ).toBe(false);
    expect(
      resolvePermission(grants, 'platform.organization.read').allowed,
    ).toBe(false);
  });

  it('gives explicit deny precedence over allow', () => {
    expect(
      resolvePermission(
        [
          {
            effect: 'ALLOW',
            organizationPath: undefined,
            permissionCode: 'platform.rbac.export',
          },
          {
            effect: 'DENY',
            organizationPath: undefined,
            permissionCode: 'platform.rbac.export',
          },
        ],
        'platform.rbac.export',
      ),
    ).toEqual({ allowed: false, reason: 'EXPLICIT_DENY' });
  });

  it('defines every required resource granularity', () => {
    expect(
      new Set(ADMIN_PERMISSIONS.map(({ resourceType }) => resourceType)),
    ).toEqual(new Set(['MENU', 'PAGE', 'API', 'BUTTON', 'FIELD', 'EXPORT']));
  });

  it('grants the administrator the implemented module execution surface', () => {
    const codes = new Set(ADMIN_PERMISSIONS.map(({ code }) => code));
    expect(
      [
        'ams.appointment.create',
        'ams.gate.verify',
        'ams.operation.manage',
        'billing.calculation.execute',
        'billing.accrual.manage',
        'billing.adjustment.approve',
        'billing.adjustment.manage',
        'billing.fact.correct',
        'billing.fact.ingest',
        'billing.fact.read',
        'billing.invoice.manage',
        'billing.payment.manage',
        'billing.period.close',
        'billing.period.reopen',
        'billing.reconciliation.manage',
        'billing.reconciliation.respond',
        'billing.report.generate',
        'billing.voucher.approve',
        'billing.voucher.manage',
        'billing.voucher.validate',
        'control.location.precise',
        'control.alert.assign',
        'control.alert.consume',
        'control.alert.escalate',
        'control.alert.manage',
        'control.alert.read',
        'control.alert.remediate',
        'control.alert.rule.manage',
        'control.ai.read',
        'control.ai.route.optimize',
        'control.ai.load.optimize',
        'control.ai.load.confirm',
        'control.ai.load.feedback',
        'control.ai.forecast.manage',
        'control.ai.forecast.publish',
        'control.ai.forecast.feedback',
        'control.ai.inventory.recommend',
        'control.ai.inventory.decide',
        'control.ai.network.manage',
        'control.ai.network.run',
        'control.ai.network.export',
        'control.ai.job.process',
        'control.bi.dashboard.manage',
        'control.bi.dashboard.read',
        'control.bi.export',
        'control.bi.lake.consume',
        'control.bi.lake.recompute',
        'control.bi.metric.manage',
        'control.bi.metric.observe',
        'control.bi.query.execute',
        'control.bi.query.sensitive',
        'control.bi.read',
        'control.bi.report.manage',
        'control.reconciliation.consume',
        'control.reconciliation.read',
        'control.reconciliation.resolve',
        'control.reconciliation.run',
        'control.reconciliation.schedule',
        'control.knowledge.manage',
        'control.projection.consume',
        'control.sla.manage',
        'control.sla.reopen',
        'control.view.read',
        'tms.tender.respond',
        'tms.pod.review',
        'tms.billing.settle',
      ].every((code) => codes.has(code)),
    ).toBe(true);
  });

  it('keeps the security auditor role read-only', () => {
    expect(READ_ONLY_AUDITOR_PERMISSION_CODES).toEqual([
      'platform.audit.read',
      'platform.audit.page',
      'platform.audit.export',
    ]);
    expect(
      READ_ONLY_AUDITOR_PERMISSION_CODES.some((code) =>
        code.endsWith('.write'),
      ),
    ).toBe(false);
  });
});

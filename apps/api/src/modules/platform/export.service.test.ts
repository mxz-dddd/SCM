import { describe, expect, it } from 'vitest';
import type { TenantContext } from '@scm/shared';
import {
  ExportService,
  assertExportTransition,
  redactExportRows,
  renderCsv,
  sortExportRows,
} from './export.service';

describe('permission-aware asynchronous export', () => {
  it('allows only declared job transitions', () => {
    expect(() => assertExportTransition('PENDING', 'PROCESSING')).not.toThrow();
    expect(() =>
      assertExportTransition('PROCESSING', 'COMPLETED'),
    ).not.toThrow();
    expect(() => assertExportTransition('PROCESSING', 'FAILED')).not.toThrow();
    expect(() => assertExportTransition('PENDING', 'COMPLETED')).toThrow(
      /not allowed/,
    );
  });

  it('reuses sort/columns, redacts protected fields and neutralizes formulas', () => {
    const rows = sortExportRows(
      [
        { id: '2', before: { secret: true }, title: '=CMD()' },
        { id: '1', before: {}, title: 'safe' },
      ],
      [{ direction: 'asc', field: 'id' }],
    );
    const safe = redactExportRows(['id', 'before', 'title'], rows);
    expect(safe[0]).toEqual({ id: '1', before: '***', title: 'safe' });
    expect(renderCsv(['id', 'before', 'title'], safe)).toContain('"\'=CMD()"');
  });

  it('denies tenant-wide attachment and audit exports to a scoped user', () => {
    const context: TenantContext = {
      accountId: '10000000-0000-4000-8000-000000000001',
      accountKind: 'USER',
      deviceId: 'test',
      organizationIds: [],
      permissionVersion: 1,
      tenantId: '10000000-0000-4000-8000-000000000002',
      tokenId: 'token',
    };
    const service = new ExportService({} as never, {} as never);
    expect(() =>
      service.create({ columns: ['id'], resourceType: 'AUDIT' }, context, {
        correlationId: 'correlation',
        idempotencyKey: 'key',
        ipAddress: '127.0.0.1',
      }),
    ).toThrow(/tenant-level data scope/);
  });
});

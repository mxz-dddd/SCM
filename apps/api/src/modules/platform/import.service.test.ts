import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '@scm/shared';
import type { IdempotencyService } from './idempotency.service';
import type { ObjectStorageService } from './object-storage.service';
import type { PrismaService } from '../../database/prisma.service';
import {
  ImportService,
  assertImportTransition,
  validateImportRows,
} from './import.service';

const context: TenantContext = {
  accountId: '10000000-0000-4000-8000-000000000001',
  accountKind: 'TENANT_ADMIN',
  deviceId: 'test',
  organizationIds: [],
  permissionVersion: 1,
  tenantId: '10000000-0000-4000-8000-000000000002',
  tokenId: 'token',
};
const metadata = {
  correlationId: 'correlation',
  idempotencyKey: 'import-1',
  ipAddress: '127.0.0.1',
};

function idempotency(transaction: object) {
  const cache = new Map<string, object>();
  return {
    execute: vi.fn(
      async (
        input: { key?: string; payload: unknown },
        operation: (tx: object) => Promise<object>,
      ) => {
        const key = `${input.key}:${JSON.stringify(input.payload)}`;
        if (cache.has(key)) return cache.get(key);
        const result = await operation(transaction);
        cache.set(key, result);
        return result;
      },
    ),
  } as unknown as IdempotencyService;
}

describe('import preflight and lifecycle', () => {
  it('validates required, type, dictionary and duplicate business key errors', () => {
    const errors = validateImportRows(
      ['businessRef', 'quantity', 'status'],
      [
        { businessRef: 'SO-1', quantity: 'bad', status: 'UNKNOWN' },
        { businessRef: 'SO-1', quantity: '2', status: 'READY' },
        { businessRef: '', quantity: '3', status: 'READY' },
      ],
      {
        columnRules: [
          { name: 'businessRef', required: true },
          { name: 'quantity', type: 'NUMBER' },
          { allowedValues: ['READY'], name: 'status' },
        ],
        uniqueColumns: ['businessRef'],
      },
    );
    expect(errors.map(({ code }) => code)).toEqual([
      'VALUE_TYPE_INVALID',
      'DICTIONARY_VALUE_INVALID',
      'DUPLICATE_BUSINESS_KEY',
      'VALUE_REQUIRED',
    ]);
  });

  it('allows only Uploaded→Validating→Ready→Importing→Completed/Failed', () => {
    expect(() =>
      assertImportTransition('UPLOADED', 'VALIDATING'),
    ).not.toThrow();
    expect(() => assertImportTransition('VALIDATING', 'READY')).not.toThrow();
    expect(() => assertImportTransition('READY', 'IMPORTING')).not.toThrow();
    expect(() =>
      assertImportTransition('IMPORTING', 'COMPLETED'),
    ).not.toThrow();
    expect(() => assertImportTransition('UPLOADED', 'COMPLETED')).toThrow(
      /not allowed/,
    );
  });

  it('creates once and replays the same upload command', async () => {
    const transaction = {
      fileObject: {
        findFirst: vi.fn(async () => ({
          id: '10000000-0000-4000-8000-000000000003',
          originalName: 'business.csv',
        })),
      },
      importJob: { create: vi.fn() },
      platformAuditLog: { create: vi.fn() },
      platformOutbox: { create: vi.fn() },
    };
    const service = new ImportService(
      idempotency(transaction),
      {} as ObjectStorageService,
      {} as PrismaService,
    );
    const input = {
      columnRules: [{ name: 'businessRef', required: true }],
      fileObjectId: '10000000-0000-4000-8000-000000000003',
      importType: 'BUSINESS_OBJECT',
      uniqueColumns: ['businessRef'],
    };
    const first = await service.create(input, context, metadata);
    await expect(service.create(input, context, metadata)).resolves.toEqual(
      first,
    );
    expect(transaction.importJob.create).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '@scm/shared';
import type { IdempotencyService } from './idempotency.service';
import {
  AttachmentService,
  assertAttachmentTransition,
  attachmentDownloadScopeAllowed,
} from './attachment.service';
import type { ObjectStorageService } from './object-storage.service';
import type { WatermarkService } from './watermark.service';
import type { PrismaService } from '../../database/prisma.service';

const context: TenantContext = {
  accountId: '10000000-0000-4000-8000-000000000001',
  accountKind: 'USER',
  deviceId: 'test-device',
  organizationIds: ['10000000-0000-4000-8000-000000000010'],
  permissionVersion: 1,
  tenantId: '10000000-0000-4000-8000-000000000002',
  tokenId: 'test-token',
};

const metadata = {
  correlationId: 'correlation-1',
  idempotencyKey: 'idem-1',
  ipAddress: '127.0.0.1',
};

const baseFile = {
  bucket: 'test-bucket',
  checksumSha256: 'a'.repeat(64),
  contentVersion: 3,
  contentType: 'text/plain',
  createdAt: new Date('2026-07-14T00:00:00.000Z'),
  createdBy: context.accountId,
  etag: null,
  id: '10000000-0000-4000-8000-000000000020',
  objectKey: 'tenant/test.txt',
  originalName: 'test.txt',
  retentionUntil: new Date('2027-07-14T00:00:00.000Z'),
  scanDetails: {},
  scanEngine: null,
  scanEngineVersion: null,
  scannedAt: null,
  scanStatus: 'PENDING' as const,
  sensitive: true,
  sizeBytes: 128n,
  status: 'PENDING_UPLOAD' as const,
  supersedesFileObjectId: null,
  tenantId: context.tenantId,
  updatedAt: new Date('2026-07-14T00:00:00.000Z'),
  updatedBy: context.accountId,
  uploadedAt: null,
  uploadExpiresAt: new Date('2026-07-14T00:15:00.000Z'),
  version: 1,
};

function createIdempotency(transaction: object) {
  const cache = new Map<string, { payload: string; response: object }>();
  return {
    execute: vi.fn(
      async (
        input: { key?: string; payload: unknown; scope: string },
        operation: (value: object) => Promise<object>,
      ) => {
        const cacheKey = `${input.scope}:${input.key}`;
        const payload = JSON.stringify(input.payload);
        const existing = cache.get(cacheKey);
        if (existing) {
          if (existing.payload !== payload) throw new Error('different content');
          return existing.response;
        }
        const response = await operation(transaction);
        cache.set(cacheKey, { payload, response });
        return response;
      },
    ),
  } as unknown as IdempotencyService;
}

function createService(input?: {
  readonly file?: object;
  readonly links?: readonly object[];
  readonly transaction?: object;
}) {
  const transaction =
    input?.transaction ??
    ({
      attachmentLink: { create: vi.fn() },
      fileObject: { create: vi.fn() },
      platformAuditLog: { create: vi.fn() },
      platformOutbox: { create: vi.fn() },
    } as const);
  const objects = {
    bucket: 'test-bucket',
    download: vi.fn(async () => Buffer.from('source')),
    ensureBucket: vi.fn(),
    headObject: vi.fn(async () => ({
      checksumSha256: baseFile.checksumSha256,
      contentLength: Number(baseFile.sizeBytes),
      contentType: baseFile.contentType,
      etag: 'test-etag',
    })),
    presign: vi.fn(() => ({
      headers: {
        'content-type': 'text/plain',
        'x-amz-meta-sha256': 'a'.repeat(64),
      },
      url: 'http://object-store/upload?signature=test',
    })),
  };
  const prisma = {
    attachmentLink: {
      findMany: vi.fn(async () => input?.links ?? []),
    },
    fileObject: {
      findFirst: vi.fn(async () => input?.file ?? null),
    },
  };
  return {
    idempotency: createIdempotency(transaction),
    objects,
    service: new AttachmentService(
      createIdempotency(transaction),
      objects as unknown as ObjectStorageService,
      prisma as unknown as PrismaService,
      {} as WatermarkService,
    ),
    transaction,
  };
}

describe('attachment upload and state contracts', () => {
  it('creates a constrained upload and replays the same idempotent result', async () => {
    const fixture = createService();
    const input = {
      checksumSha256: 'a'.repeat(64),
      contentType: 'text/plain',
      originalName: 'packing-list.txt',
      sizeBytes: 128,
    };

    const first = await fixture.service.createUpload(input, context, metadata);
    const replay = await fixture.service.createUpload(input, context, metadata);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      accepted: true,
      status: 'PENDING_UPLOAD',
      version: 1,
    });
    expect(fixture.objects.ensureBucket).toHaveBeenCalledTimes(2);
    expect(
      (fixture.transaction as { fileObject: { create: ReturnType<typeof vi.fn> } })
        .fileObject.create,
    ).toHaveBeenCalledTimes(1);
    await expect(
      fixture.service.createUpload(
        { ...input, originalName: 'different.txt' },
        context,
        metadata,
      ),
    ).rejects.toThrow(/different content/);
  });

  it('rejects unsupported types, oversize files and non-watermarkable sensitive files', async () => {
    const fixture = createService();
    await expect(
      fixture.service.createUpload(
        {
          checksumSha256: 'b'.repeat(64),
          contentType: 'application/x-executable',
          originalName: 'payload.exe',
          sizeBytes: 100,
        },
        context,
        metadata,
      ),
    ).rejects.toThrow(/type, size/);
    await expect(
      fixture.service.createUpload(
        {
          checksumSha256: 'b'.repeat(64),
          contentType: 'text/plain',
          originalName: 'too-large.txt',
          sizeBytes: 30 * 1024 * 1024,
        },
        context,
        metadata,
      ),
    ).rejects.toThrow(/type, size/);
    await expect(
      fixture.service.createUpload(
        {
          checksumSha256: 'b'.repeat(64),
          contentType: 'application/zip',
          originalName: 'secret.zip',
          sensitive: true,
          sizeBytes: 100,
        },
        context,
        metadata,
      ),
    ).rejects.toThrow(/cannot be watermarked/);
  });

  it('creates an explicit content version without a cross-domain foreign key', async () => {
    const transaction = {
      attachmentLink: { create: vi.fn() },
      fileObject: {
        create: vi.fn(),
        findFirst: vi.fn(async () => baseFile),
      },
      platformAuditLog: { create: vi.fn() },
      platformOutbox: { create: vi.fn() },
    };
    const fixture = createService({ transaction });

    await expect(
      fixture.service.createUpload(
        {
          checksumSha256: 'c'.repeat(64),
          contentType: 'text/plain',
          originalName: 'replacement.txt',
          sizeBytes: 64,
          supersedesFileObjectId: baseFile.id,
        },
        context,
        { ...metadata, idempotencyKey: 'version-upload' },
      ),
    ).resolves.toMatchObject({ contentVersion: 4 });
    expect(transaction.fileObject.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contentVersion: 4,
          supersedesFileObjectId: baseFile.id,
        }),
      }),
    );
  });

  it('allows only declared scan lifecycle transitions', () => {
    expect(() =>
      assertAttachmentTransition('PENDING_UPLOAD', 'SCANNING'),
    ).not.toThrow();
    for (const target of ['AVAILABLE', 'QUARANTINED', 'REJECTED'] as const) {
      expect(() => assertAttachmentTransition('SCANNING', target)).not.toThrow();
    }
    expect(() =>
      assertAttachmentTransition('PENDING_UPLOAD', 'AVAILABLE'),
    ).toThrow(/not allowed/);
    expect(() =>
      assertAttachmentTransition('QUARANTINED', 'AVAILABLE'),
    ).toThrow(/not allowed/);
  });

  it('completes a verified object into scanning and replays the command', async () => {
    const transaction = {
      fileObject: {
        findFirst: vi.fn(async () => baseFile),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      platformAuditLog: { create: vi.fn() },
      platformOutbox: { create: vi.fn() },
    };
    const fixture = createService({ file: baseFile, transaction });

    const first = await fixture.service.completeUpload(
      baseFile.id,
      { expectedVersion: 1 },
      context,
      metadata,
    );
    const replay = await fixture.service.completeUpload(
      baseFile.id,
      { expectedVersion: 1 },
      context,
      metadata,
    );

    expect(replay).toEqual(first);
    expect(first).toEqual({
      accepted: true,
      fileObjectId: baseFile.id,
      status: 'SCANNING',
      version: 2,
    });
    expect(transaction.fileObject.updateMany).toHaveBeenCalledTimes(1);
    expect(transaction.platformAuditLog.create).toHaveBeenCalledTimes(1);
    expect(transaction.platformOutbox.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['CLEAN', 'AVAILABLE'],
    ['INFECTED', 'QUARANTINED'],
    ['ERROR', 'REJECTED'],
  ] as const)('records scan result %s as %s', async (result, status) => {
    const scanning = { ...baseFile, status: 'SCANNING' as const, version: 2 };
    const transaction = {
      fileObject: {
        findFirst: vi.fn(async () => scanning),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      platformAuditLog: { create: vi.fn() },
      platformOutbox: { create: vi.fn() },
    };
    const fixture = createService({ transaction });

    await expect(
      fixture.service.recordScan(
        baseFile.id,
        {
          engine: 'test-hook',
          engineVersion: '1',
          expectedVersion: 2,
          result,
        },
        context,
        metadata,
      ),
    ).resolves.toMatchObject({ scanStatus: result, status, version: 3 });
    expect(transaction.fileObject.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status }) }),
    );
  });
});

describe('attachment authorization contracts', () => {
  it('denies regular users outside the linked organization scope', () => {
    expect(
      attachmentDownloadScopeAllowed(
        [{ organizationId: context.organizationIds[0]! }],
        context,
      ),
    ).toBe(true);
    expect(
      attachmentDownloadScopeAllowed(
        [{ organizationId: '10000000-0000-4000-8000-000000000099' }],
        context,
      ),
    ).toBe(false);
    expect(
      attachmentDownloadScopeAllowed([], {
        ...context,
        accountKind: 'TENANT_ADMIN',
      }),
    ).toBe(true);
  });
});

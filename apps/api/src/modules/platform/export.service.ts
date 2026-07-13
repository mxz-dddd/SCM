import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type ExportJobStatus } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import type { CommandMetadata } from './tenant.service';

export interface CreateExportInput {
  readonly columns: readonly string[];
  readonly filters?: Readonly<Record<string, string>>;
  readonly format?: 'CSV';
  readonly resourceType: 'ATTACHMENTS' | 'AUDIT' | 'INBOX' | 'NOTIFICATIONS';
  readonly sort?: readonly {
    readonly direction: 'asc' | 'desc';
    readonly field: string;
  }[];
}

export interface ExportVersionInput {
  readonly expectedVersion: number;
}

export interface FailExportInput extends ExportVersionInput {
  readonly failureCode: string;
}

const RESOURCE_COLUMNS: Readonly<
  Record<CreateExportInput['resourceType'], readonly string[]>
> = {
  ATTACHMENTS: [
    'id',
    'originalName',
    'contentType',
    'sizeBytes',
    'contentVersion',
    'status',
    'scanStatus',
    'sensitive',
    'createdAt',
  ],
  AUDIT: [
    'id',
    'createdAt',
    'category',
    'action',
    'resourceType',
    'businessRef',
    'outcome',
    'correlationId',
    'before',
    'after',
  ],
  INBOX: [
    'id',
    'createdAt',
    'type',
    'severity',
    'title',
    'businessDomain',
    'businessRef',
    'responsibilityGroup',
    'status',
  ],
  NOTIFICATIONS: [
    'id',
    'createdAt',
    'severity',
    'renderedSubject',
    'businessDomain',
    'businessRef',
    'requestedChannels',
    'deliveredChannels',
    'status',
  ],
};

const RESOURCE_FILTERS: Readonly<
  Record<CreateExportInput['resourceType'], readonly string[]>
> = {
  ATTACHMENTS: ['scanStatus', 'status'],
  AUDIT: ['businessRef', 'category', 'outcome', 'resourceType'],
  INBOX: ['businessDomain', 'severity', 'status'],
  NOTIFICATIONS: ['businessDomain', 'businessRef', 'severity', 'status'],
};

const SENSITIVE_EXPORT_COLUMNS = new Set([
  'before',
  'after',
  'variables',
  'renderedBody',
  'objectKey',
  'scanDetails',
]);

export function assertExportTransition(
  current: ExportJobStatus,
  target: ExportJobStatus,
): void {
  const allowed =
    (current === 'PENDING' && target === 'PROCESSING') ||
    (current === 'PROCESSING' && ['COMPLETED', 'FAILED'].includes(target)) ||
    (current === 'COMPLETED' && target === 'EXPIRED');
  if (!allowed) {
    throw new AppError(
      'EXPORT_TRANSITION_INVALID',
      `Export transition ${current} -> ${target} is not allowed`,
      409,
    );
  }
}

function csvCell(value: unknown): string {
  let normalized =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  if (/^[=+\-@]/.test(normalized)) normalized = `'${normalized}`;
  return `"${normalized.replaceAll('"', '""')}"`;
}

export function renderCsv(
  columns: readonly string[],
  rows: readonly Readonly<Record<string, unknown>>[],
): string {
  return [
    columns.map(csvCell).join(','),
    ...rows.map((row) =>
      columns.map((column) => csvCell(row[column])).join(','),
    ),
  ].join('\r\n');
}

export function redactExportRows(
  columns: readonly string[],
  rows: readonly Readonly<Record<string, unknown>>[],
): readonly Readonly<Record<string, unknown>>[] {
  return rows.map((row) =>
    Object.fromEntries(
      columns.map((column) => [
        column,
        SENSITIVE_EXPORT_COLUMNS.has(column) ? '***' : row[column],
      ]),
    ),
  );
}

export function sortExportRows(
  rows: readonly Readonly<Record<string, unknown>>[],
  sort: readonly {
    readonly direction: 'asc' | 'desc';
    readonly field: string;
  }[],
): readonly Readonly<Record<string, unknown>>[] {
  return rows
    .map((row, index) => ({ index, row }))
    .sort((left, right) => {
      for (const rule of sort) {
        const leftValue = left.row[rule.field];
        const rightValue = right.row[rule.field];
        const comparison = String(leftValue ?? '').localeCompare(
          String(rightValue ?? ''),
          undefined,
          { numeric: true },
        );
        if (comparison)
          return rule.direction === 'asc' ? comparison : -comparison;
      }
      return left.index - right.index;
    })
    .map(({ row }) => row);
}

@Injectable()
export class ExportService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async list(context: TenantContext) {
    return this.prisma.exportJob.findMany({
      omit: { resultContent: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      where: {
        requesterId: context.accountId,
        tenantId: context.tenantId,
      },
    });
  }

  create(
    input: CreateExportInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const allowed = RESOURCE_COLUMNS[input.resourceType];
    const allowedFilters = RESOURCE_FILTERS[input.resourceType];
    const columns = [...new Set(input.columns ?? [])];
    if (
      !allowed ||
      columns.length === 0 ||
      columns.some((column) => !allowed.includes(column)) ||
      Object.entries(input.filters ?? {}).some(
        ([key, value]) =>
          !allowedFilters?.includes(key) ||
          typeof value !== 'string' ||
          value.length > 300,
      ) ||
      input.sort?.some(
        ({ direction, field }) =>
          !allowed.includes(field) || !['asc', 'desc'].includes(direction),
      )
    ) {
      throw new AppError(
        'EXPORT_CONFIGURATION_INVALID',
        'Export resource, columns or sort is invalid',
        400,
      );
    }
    if (
      context.accountKind === 'USER' &&
      ['ATTACHMENTS', 'AUDIT'].includes(input.resourceType)
    ) {
      throw new AppError(
        'EXPORT_SCOPE_DENIED',
        'This export resource requires tenant-level data scope',
        403,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 202,
        scope: 'platform.export-job.create.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const id = randomUUID();
        await transaction.exportJob.create({
          data: {
            columns,
            createdBy: context.accountId,
            format: input.format ?? 'CSV',
            id,
            querySpec: (input.filters ?? {}) as Prisma.InputJsonObject,
            requesterId: context.accountId,
            resourceType: input.resourceType,
            sort: (input.sort ?? []) as Prisma.InputJsonArray,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await transaction.platformAuditLog.create({
          data: {
            action: 'export.job.created',
            category: 'EXPORT',
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            deviceId: context.deviceId,
            exportedFields: columns,
            ipAddress: metadata.ipAddress ?? null,
            queryCriteria: (input.filters ?? {}) as Prisma.InputJsonObject,
            resourceId: id,
            resourceType: input.resourceType,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await this.outbox(
          transaction,
          id,
          1,
          'platform.export-requested.v1',
          context,
          metadata,
        );
        return {
          accepted: true,
          exportJobId: id,
          status: 'PENDING',
          version: 1,
        };
      },
    );
  }

  start(
    exportJobId: string,
    input: ExportVersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { exportJobId, ...input },
        responseCode: 202,
        scope: 'platform.export-job.start.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const job = await this.findJob(transaction, exportJobId, context);
        assertExportTransition(job.status, 'PROCESSING');
        if (job.version !== input.expectedVersion) throw this.versionConflict();
        await transaction.exportJob.update({
          data: {
            processingAt: new Date(),
            status: 'PROCESSING',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: job.id },
        });
        await this.outbox(
          transaction,
          job.id,
          job.version + 1,
          'platform.export-processing.v1',
          context,
          metadata,
        );
        return {
          accepted: true,
          exportJobId: job.id,
          status: 'PROCESSING',
          version: job.version + 1,
        };
      },
    );
  }

  process(
    exportJobId: string,
    input: ExportVersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { exportJobId, ...input },
        responseCode: 200,
        scope: 'platform.export-job.process.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const job = await this.findJob(transaction, exportJobId, context);
        if (
          job.status !== 'PROCESSING' ||
          job.version !== input.expectedVersion
        ) {
          throw this.versionConflict();
        }
        const columns = job.columns as string[];
        const rows = await this.queryRows(
          transaction,
          job.resourceType as CreateExportInput['resourceType'],
          job.querySpec as Readonly<Record<string, string>>,
          context,
        );
        const sortedRows = sortExportRows(
          rows,
          (job.sort as unknown as CreateExportInput['sort']) ?? [],
        );
        const safeRows = redactExportRows(columns, sortedRows);
        const resultContent = renderCsv(columns, safeRows);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        assertExportTransition(job.status, 'COMPLETED');
        await transaction.exportJob.update({
          data: {
            completedAt: new Date(),
            contentType: 'text/csv; charset=utf-8',
            expiresAt,
            resultContent,
            rowCount: sortedRows.length,
            status: 'COMPLETED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: job.id },
        });
        await transaction.platformAuditLog.create({
          data: {
            action: 'export.job.completed',
            after: { rowCount: sortedRows.length, status: 'COMPLETED' },
            before: { status: job.status },
            category: 'EXPORT',
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            deviceId: context.deviceId,
            exportedFields: columns,
            ipAddress: metadata.ipAddress ?? null,
            queryCriteria: job.querySpec as Prisma.InputJsonObject,
            resourceId: job.id,
            resourceType: job.resourceType,
            resultCount: sortedRows.length,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await this.outbox(
          transaction,
          job.id,
          job.version + 1,
          'platform.export-completed.v1',
          context,
          metadata,
        );
        return {
          expiresAt: expiresAt.toISOString(),
          exportJobId: job.id,
          rowCount: sortedRows.length,
          status: 'COMPLETED',
          version: job.version + 1,
        };
      },
    );
  }

  fail(
    exportJobId: string,
    input: FailExportInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!/^[A-Z][A-Z0-9_.-]{2,99}$/.test(input.failureCode)) {
      throw new AppError(
        'EXPORT_FAILURE_INVALID',
        'failureCode is invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { exportJobId, ...input },
        responseCode: 200,
        scope: 'platform.export-job.fail.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const job = await this.findJob(transaction, exportJobId, context);
        assertExportTransition(job.status, 'FAILED');
        if (job.version !== input.expectedVersion) throw this.versionConflict();
        await transaction.exportJob.update({
          data: {
            completedAt: new Date(),
            failureCode: input.failureCode,
            status: 'FAILED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: job.id },
        });
        await transaction.platformAuditLog.create({
          data: {
            action: 'export.job.failed',
            after: { failureCode: input.failureCode, status: 'FAILED' },
            before: { status: job.status },
            category: 'EXPORT',
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            deviceId: context.deviceId,
            ipAddress: metadata.ipAddress ?? null,
            resourceId: job.id,
            resourceType: job.resourceType,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await this.outbox(
          transaction,
          job.id,
          job.version + 1,
          'platform.export-failed.v1',
          context,
          metadata,
        );
        return {
          exportJobId: job.id,
          failureCode: input.failureCode,
          status: 'FAILED',
          version: job.version + 1,
        };
      },
    );
  }

  issueDownload(
    exportJobId: string,
    input: ExportVersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { exportJobId, ...input },
        responseCode: 201,
        scope: 'platform.export-download.issue.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const job = await this.findJob(transaction, exportJobId, context);
        if (
          job.status !== 'COMPLETED' ||
          job.version !== input.expectedVersion ||
          !job.resultContent ||
          !job.expiresAt ||
          job.expiresAt <= new Date()
        ) {
          throw new AppError(
            'EXPORT_DOWNLOAD_UNAVAILABLE',
            'Export is not completed or has expired',
            410,
          );
        }
        const token = randomBytes(32).toString('base64url');
        const tokenExpiresAt = new Date(
          Math.min(job.expiresAt.getTime(), Date.now() + 5 * 60 * 1000),
        );
        await transaction.exportDownloadToken.create({
          data: {
            accountId: context.accountId,
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            expiresAt: tokenExpiresAt,
            exportJobId: job.id,
            tenantId: context.tenantId,
            tokenHash: createHash('sha256').update(token).digest('hex'),
            updatedBy: context.accountId,
          },
        });
        await transaction.platformAuditLog.create({
          data: {
            action: 'export.download.issued',
            category: 'EXPORT',
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            deviceId: context.deviceId,
            exportedFields: job.columns as string[],
            ipAddress: metadata.ipAddress ?? null,
            resourceId: job.id,
            resourceType: job.resourceType,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        return {
          downloadUrl: `/api/v1/platform/exports/downloads/${token}`,
          expiresAt: tokenExpiresAt.toISOString(),
          exportJobId: job.id,
          version: job.version,
        };
      },
    );
  }

  async consumeDownload(token: string, context: TenantContext) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const grant = await this.prisma.exportDownloadToken.findFirst({
      where: {
        accountId: context.accountId,
        status: 'ACTIVE',
        tenantId: context.tenantId,
        tokenHash,
      },
    });
    if (!grant || grant.expiresAt <= new Date()) {
      throw new AppError(
        'EXPORT_DOWNLOAD_TOKEN_INVALID',
        'Export download token is invalid, expired or consumed',
        410,
      );
    }
    const job = await this.prisma.exportJob.findFirst({
      where: {
        id: grant.exportJobId,
        requesterId: context.accountId,
        tenantId: context.tenantId,
      },
    });
    if (!job?.resultContent) {
      throw new AppError(
        'EXPORT_DOWNLOAD_UNAVAILABLE',
        'Export content is unavailable',
        410,
      );
    }
    const consumed = await this.prisma.exportDownloadToken.updateMany({
      data: {
        consumedAt: new Date(),
        status: 'CONSUMED',
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: { id: grant.id, status: 'ACTIVE', version: grant.version },
    });
    if (consumed.count !== 1) {
      throw new AppError(
        'EXPORT_DOWNLOAD_TOKEN_CONSUMED',
        'Token was already consumed',
        409,
      );
    }
    await this.prisma.platformAuditLog.create({
      data: {
        action: 'export.download.consumed',
        category: 'EXPORT',
        correlationId: grant.correlationId,
        createdBy: context.accountId,
        exportedFields: job.columns as string[],
        resourceId: job.id,
        resourceType: job.resourceType,
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
    return {
      body: Buffer.from(`\uFEFF${job.resultContent}`, 'utf8'),
      contentType: job.contentType ?? 'text/csv; charset=utf-8',
      fileName: `${job.resourceType.toLowerCase()}-${job.id}.csv`,
    };
  }

  private async queryRows(
    transaction: Prisma.TransactionClient,
    resourceType: CreateExportInput['resourceType'],
    filters: Readonly<Record<string, string>>,
    context: TenantContext,
  ): Promise<Readonly<Record<string, unknown>>[]> {
    if (resourceType === 'INBOX') {
      const status = ['ARCHIVED', 'READ', 'UNREAD'].includes(
        filters.status ?? '',
      )
        ? (filters.status as 'ARCHIVED' | 'READ' | 'UNREAD')
        : undefined;
      return transaction.inboxItem.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10_000,
        where: {
          ...(filters.businessDomain
            ? { businessDomain: filters.businessDomain }
            : {}),
          ...(filters.severity ? { severity: filters.severity as never } : {}),
          ...(status ? { status } : {}),
          recipientAccountId: context.accountId,
          tenantId: context.tenantId,
        },
      });
    }
    if (resourceType === 'NOTIFICATIONS') {
      const status = [
        'DELIVERED',
        'FAILED',
        'PARTIAL_FAILED',
        'PENDING',
      ].includes(filters.status ?? '')
        ? (filters.status as
            'DELIVERED' | 'FAILED' | 'PARTIAL_FAILED' | 'PENDING')
        : undefined;
      return transaction.notification.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10_000,
        where: {
          ...(filters.businessDomain
            ? { businessDomain: filters.businessDomain }
            : {}),
          ...(filters.businessRef ? { businessRef: filters.businessRef } : {}),
          ...(filters.severity ? { severity: filters.severity as never } : {}),
          ...(status ? { status } : {}),
          ...(context.accountKind === 'USER'
            ? { recipientAccountId: context.accountId }
            : {}),
          tenantId: context.tenantId,
        },
      });
    }
    if (resourceType === 'ATTACHMENTS') {
      const rows = await transaction.fileObject.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10_000,
        where: {
          ...(filters.scanStatus
            ? { scanStatus: filters.scanStatus as never }
            : {}),
          ...(filters.status ? { status: filters.status as never } : {}),
          tenantId: context.tenantId,
        },
      });
      return rows.map((row) => ({
        ...row,
        sizeBytes: row.sizeBytes.toString(),
      }));
    }
    return transaction.platformAuditLog.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10_000,
      where: {
        ...(filters.businessRef ? { businessRef: filters.businessRef } : {}),
        ...(filters.category ? { category: filters.category as never } : {}),
        ...(filters.outcome ? { outcome: filters.outcome as never } : {}),
        ...(filters.resourceType ? { resourceType: filters.resourceType } : {}),
        tenantId: context.tenantId,
      },
    });
  }

  private async findJob(
    transaction: Prisma.TransactionClient,
    id: string,
    context: TenantContext,
  ) {
    const job = await transaction.exportJob.findFirst({
      where: {
        id,
        requesterId: context.accountId,
        tenantId: context.tenantId,
      },
    });
    if (!job)
      throw new AppError(
        'EXPORT_JOB_NOT_FOUND',
        'Export job was not found',
        404,
      );
    return job;
  }

  private outbox(
    transaction: Prisma.TransactionClient,
    aggregateId: string,
    aggregateVersion: number,
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return transaction.platformOutbox.create({
      data: {
        aggregateId,
        aggregateType: 'ExportJob',
        aggregateVersion,
        correlationId: metadata.correlationId,
        createdBy: context.accountId,
        eventName,
        payload: {
          exportJobId: aggregateId,
          tenantId: context.tenantId,
          version: aggregateVersion,
        },
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
  }

  private versionConflict() {
    return new AppError(
      'EXPORT_VERSION_CONFLICT',
      'Export job version or state changed; refresh and retry',
      409,
      { retryable: true },
    );
  }
}

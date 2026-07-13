import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type AuditCategory } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import type { CommandMetadata } from './tenant.service';

export interface AuditListQuery {
  readonly action?: string;
  readonly businessRef?: string;
  readonly category?: AuditCategory;
  readonly from?: string;
  readonly page?: number | string;
  readonly pageSize?: number | string;
  readonly resourceType?: string;
  readonly to?: string;
}

export interface ChangeHistoryQuery {
  readonly businessRef?: string;
  readonly page?: number | string;
  readonly pageSize?: number | string;
  readonly resourceId?: string;
  readonly resourceType?: string;
}

export interface RecordExportInput {
  readonly businessRef?: string;
  readonly exportedFields: readonly string[];
  readonly queryCriteria: Readonly<Record<string, unknown>>;
  readonly resourceId?: string;
  readonly resourceType: string;
  readonly resultCount: number;
}

const AUDIT_CATEGORIES = new Set<AuditCategory>([
  'LOGIN',
  'SENSITIVE_QUERY',
  'EXPORT',
  'APPROVAL',
  'API_CALL',
  'BUSINESS_CHANGE',
  'SECURITY',
]);
const SENSITIVE_KEY =
  /(?:authorization|credential|password|secret|token|api[-_]?key)/i;

export function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactAuditValue(child),
      ]),
    );
  }
  return value;
}

export function changedAuditFields(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): readonly string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();
}

function normalizePagination(query: {
  readonly page?: number | string;
  readonly pageSize?: number | string;
}) {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw new AppError(
      'AUDIT_PAGINATION_INVALID',
      'page and pageSize must be bounded positive integers',
      400,
    );
  }
  return { page, pageSize };
}

function parseDate(value: string | undefined, field: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(
      'AUDIT_DATE_INVALID',
      `${field} must be an ISO date`,
      400,
    );
  }
  return parsed;
}

function redactStored<T extends { after?: unknown; before?: unknown }>(row: T) {
  return {
    ...row,
    ...(row.after === null || row.after === undefined
      ? {}
      : { after: redactAuditValue(row.after) }),
    ...(row.before === null || row.before === undefined
      ? {}
      : { before: redactAuditValue(row.before) }),
  };
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async listAuditLogs(
    query: AuditListQuery,
    context: TenantContext,
    metadata: Pick<CommandMetadata, 'correlationId' | 'ipAddress'>,
  ) {
    const { page, pageSize } = normalizePagination(query);
    if (query.category && !AUDIT_CATEGORIES.has(query.category)) {
      throw new AppError(
        'AUDIT_CATEGORY_INVALID',
        'Audit category is invalid',
        400,
      );
    }
    const from = parseDate(query.from, 'from');
    const to = parseDate(query.to, 'to');
    if (from && to && from > to) {
      throw new AppError(
        'AUDIT_DATE_RANGE_INVALID',
        'from must not be later than to',
        400,
      );
    }
    const where: Prisma.PlatformAuditLogWhereInput = {
      ...(query.action?.trim()
        ? { action: { contains: query.action.trim(), mode: 'insensitive' } }
        : {}),
      ...(query.businessRef?.trim()
        ? { businessRef: query.businessRef.trim() }
        : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ...(query.resourceType?.trim()
        ? { resourceType: query.resourceType.trim() }
        : {}),
      tenantId: context.tenantId,
    };
    const [items, total] = await Promise.all([
      this.prisma.platformAuditLog.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
      this.prisma.platformAuditLog.count({ where }),
    ]);
    await this.recordSensitiveQuery(
      'audit.logs.query',
      '/api/v1/platform/audit/logs',
      query,
      items.length,
      context,
      metadata,
    );
    return {
      items: items.map((item) => ({
        ...redactStored(item),
        ...(item.queryCriteria
          ? { queryCriteria: redactAuditValue(item.queryCriteria) }
          : {}),
      })),
      page,
      pageSize,
      total,
    };
  }

  async listChangeHistory(
    query: ChangeHistoryQuery,
    context: TenantContext,
    metadata: Pick<CommandMetadata, 'correlationId' | 'ipAddress'>,
  ) {
    const { page, pageSize } = normalizePagination(query);
    if (query.resourceId && !isUuid(query.resourceId)) {
      throw new AppError(
        'AUDIT_RESOURCE_ID_INVALID',
        'resourceId must be a UUID',
        400,
      );
    }
    const where: Prisma.ChangeHistoryWhereInput = {
      ...(query.businessRef?.trim()
        ? { businessRef: query.businessRef.trim() }
        : {}),
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      ...(query.resourceType?.trim()
        ? { resourceType: query.resourceType.trim() }
        : {}),
      tenantId: context.tenantId,
    };
    const [items, total] = await Promise.all([
      this.prisma.changeHistory.findMany({
        orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
      this.prisma.changeHistory.count({ where }),
    ]);
    await this.recordSensitiveQuery(
      'audit.history.query',
      '/api/v1/platform/audit/change-history',
      query,
      items.length,
      context,
      metadata,
    );
    return {
      items: items.map(redactStored),
      page,
      pageSize,
      total,
    };
  }

  recordExport(
    input: RecordExportInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const fields = [...new Set(input.exportedFields ?? [])].sort();
    if (
      !input.resourceType?.trim() ||
      !input.queryCriteria ||
      typeof input.queryCriteria !== 'object' ||
      Array.isArray(input.queryCriteria) ||
      fields.length === 0 ||
      fields.some((field) => !/^[a-z][a-zA-Z0-9_.-]{0,99}$/.test(field)) ||
      !Number.isInteger(input.resultCount) ||
      input.resultCount < 0 ||
      (input.resourceId !== undefined && !isUuid(input.resourceId))
    ) {
      throw new AppError(
        'AUDIT_EXPORT_INVALID',
        'Export audit metadata is invalid',
        400,
      );
    }
    const sanitizedCriteria = redactAuditValue(
      input.queryCriteria,
    ) as Prisma.InputJsonObject;
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 201,
        scope: 'platform.audit.export-record.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const auditLogId = randomUUID();
        await transaction.platformAuditLog.create({
          data: {
            action: 'data.export',
            businessRef: input.businessRef?.trim() || null,
            category: 'EXPORT',
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            deviceId: context.deviceId,
            exportedFields: fields,
            id: auditLogId,
            ipAddress: metadata.ipAddress ?? null,
            outcome: 'SUCCESS',
            queryCriteria: sanitizedCriteria,
            requestMethod: 'POST',
            requestPath: '/api/v1/platform/audit/exports',
            resourceId: input.resourceId ?? context.accountId,
            resourceType: input.resourceType.trim(),
            resultCount: input.resultCount,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await transaction.platformOutbox.create({
          data: {
            aggregateId: auditLogId,
            aggregateType: 'AuditLog',
            aggregateVersion: 1,
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            eventName: 'platform.audit-export-recorded.v1',
            payload: {
              auditLogId,
              businessRef: input.businessRef ?? null,
              resourceType: input.resourceType.trim(),
              resultCount: input.resultCount,
            },
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        return { accepted: true, auditLogId, status: 'ACTIVE', version: 1 };
      },
    );
  }

  private async recordSensitiveQuery(
    action: string,
    requestPath: string,
    query: object,
    resultCount: number,
    context: TenantContext,
    metadata: Pick<CommandMetadata, 'correlationId' | 'ipAddress'>,
  ) {
    await this.prisma.platformAuditLog.create({
      data: {
        action,
        category: 'SENSITIVE_QUERY',
        correlationId: metadata.correlationId,
        createdBy: context.accountId,
        deviceId: context.deviceId,
        ipAddress: metadata.ipAddress ?? null,
        outcome: 'SUCCESS',
        queryCriteria: redactAuditValue(query) as Prisma.InputJsonObject,
        requestMethod: 'GET',
        requestPath,
        resourceId: context.accountId,
        resourceType: 'AuditLog',
        resultCount,
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
  }
}

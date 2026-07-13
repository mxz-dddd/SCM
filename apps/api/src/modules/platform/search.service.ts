import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type RecordStatus,
  type SavedViewVisibility,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import type { CommandMetadata } from './tenant.service';

type JsonObject = Readonly<Record<string, unknown>>;

export interface IndexSearchDocumentInput {
  readonly businessDomain: string;
  readonly businessRef: string;
  readonly businessStatus: string;
  readonly expectedVersion?: number;
  readonly externalRef?: string;
  readonly objectId: string;
  readonly objectType: string;
  readonly occurredAt: string;
  readonly organizationId?: string;
  readonly partnerName?: string;
  readonly productName?: string;
  readonly route: string;
  readonly snapshot?: JsonObject;
}

export interface SearchInput {
  readonly businessDomain?: string;
  readonly from?: string;
  readonly page?: number | string;
  readonly pageSize?: number | string;
  readonly q?: string;
  readonly status?: string;
  readonly to?: string;
}

export interface SaveViewInput {
  readonly aggregation?: JsonObject;
  readonly columns: readonly JsonObject[];
  readonly expectedVersion?: number;
  readonly filters: JsonObject;
  readonly name: string;
  readonly quickFilters?: readonly JsonObject[];
  readonly resourceType: string;
  readonly savedViewId?: string;
  readonly sort?: readonly JsonObject[];
  readonly visibility?: SavedViewVisibility;
}

export interface ChangeSavedViewStatusInput {
  readonly expectedVersion: number;
  readonly status: RecordStatus;
}

const IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9_.-]{1,99}$/;

function parseDate(value: string | undefined, field: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError('SEARCH_DATE_INVALID', `${field} is invalid`, 400);
  }
  return parsed;
}

function page(input: SearchInput) {
  const number = Number(input.page ?? 1);
  const size = Number(input.pageSize ?? 20);
  if (
    !Number.isInteger(number) ||
    number < 1 ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > 100
  ) {
    throw new AppError('PAGINATION_INVALID', 'Invalid page or pageSize', 400);
  }
  return { number, size };
}

const SENSITIVE_SNAPSHOT_KEYS =
  /credential|password|secret|token|identity|phone|email/i;

export function redactSearchSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSearchSnapshot);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_SNAPSHOT_KEYS.test(key) ? '***' : redactSearchSnapshot(item),
      ]),
    );
  }
  return value;
}

@Injectable()
export class SearchService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  index(
    input: IndexSearchDocumentInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const occurredAt = new Date(input.occurredAt);
    if (
      !IDENTIFIER_PATTERN.test(input.businessDomain) ||
      !IDENTIFIER_PATTERN.test(input.objectType) ||
      !isUuid(input.objectId) ||
      (input.organizationId !== undefined && !isUuid(input.organizationId)) ||
      !input.businessRef?.trim() ||
      !input.businessStatus?.trim() ||
      !input.route?.startsWith('/') ||
      Number.isNaN(occurredAt.getTime())
    ) {
      throw new AppError(
        'SEARCH_DOCUMENT_INVALID',
        'Search document is invalid',
        400,
      );
    }
    if (
      context.accountKind === 'USER' &&
      input.organizationId &&
      !context.organizationIds.includes(input.organizationId)
    ) {
      throw new AppError(
        'SEARCH_SCOPE_DENIED',
        'Search document is outside data scope',
        403,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 200,
        scope: 'platform.search-document.index.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const existing = await transaction.searchDocument.findUnique({
          where: {
            tenantId_businessDomain_objectType_objectId: {
              businessDomain: input.businessDomain,
              objectId: input.objectId,
              objectType: input.objectType,
              tenantId: context.tenantId,
            },
          },
        });
        if (existing && existing.version !== input.expectedVersion) {
          throw this.versionConflict();
        }
        const id = existing?.id ?? randomUUID();
        const document = await transaction.searchDocument.upsert({
          create: {
            businessDomain: input.businessDomain,
            businessRef: input.businessRef.trim(),
            businessStatus: input.businessStatus,
            createdBy: context.accountId,
            externalRef: input.externalRef ?? null,
            id,
            objectId: input.objectId,
            objectType: input.objectType,
            occurredAt,
            organizationId: input.organizationId ?? null,
            partnerName: input.partnerName ?? null,
            productName: input.productName ?? null,
            route: input.route,
            snapshot: (input.snapshot ?? {}) as Prisma.InputJsonObject,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
          update: {
            businessRef: input.businessRef.trim(),
            businessStatus: input.businessStatus,
            externalRef: input.externalRef ?? null,
            occurredAt,
            organizationId: input.organizationId ?? null,
            partnerName: input.partnerName ?? null,
            productName: input.productName ?? null,
            route: input.route,
            snapshot: (input.snapshot ?? {}) as Prisma.InputJsonObject,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            tenantId_businessDomain_objectType_objectId: {
              businessDomain: input.businessDomain,
              objectId: input.objectId,
              objectType: input.objectType,
              tenantId: context.tenantId,
            },
          },
        });
        await Promise.all([
          transaction.platformAuditLog.create({
            data: {
              action: existing
                ? 'search.document.updated'
                : 'search.document.created',
              after: {
                businessRef: document.businessRef,
                businessStatus: document.businessStatus,
              },
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              deviceId: context.deviceId,
              ipAddress: metadata.ipAddress ?? null,
              resourceId: document.id,
              resourceType: 'SearchDocument',
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          }),
          transaction.platformOutbox.create({
            data: {
              aggregateId: document.id,
              aggregateType: 'SearchDocument',
              aggregateVersion: document.version,
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              eventName: 'platform.search-document-indexed.v1',
              payload: {
                businessRef: document.businessRef,
                searchDocumentId: document.id,
                tenantId: context.tenantId,
                version: document.version,
              },
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          }),
        ]);
        return {
          searchDocumentId: document.id,
          status: document.status,
          version: document.version,
        };
      },
    );
  }

  async search(
    input: SearchInput,
    context: TenantContext,
    metadata: Pick<CommandMetadata, 'correlationId' | 'ipAddress'>,
  ) {
    const pagination = page(input);
    const from = parseDate(input.from, 'from');
    const to = parseDate(input.to, 'to');
    if (from && to && from > to) {
      throw new AppError(
        'SEARCH_DATE_RANGE_INVALID',
        'from must precede to',
        400,
      );
    }
    const query = input.q?.trim();
    const and: Prisma.SearchDocumentWhereInput[] = [];
    if (query) {
      and.push({
        OR: [
          { businessRef: { contains: query, mode: 'insensitive' } },
          { externalRef: { contains: query, mode: 'insensitive' } },
          { partnerName: { contains: query, mode: 'insensitive' } },
          { productName: { contains: query, mode: 'insensitive' } },
        ],
      });
    }
    if (context.accountKind === 'USER') {
      and.push({
        OR: [
          { organizationId: null },
          { organizationId: { in: [...context.organizationIds] } },
        ],
      });
    }
    const where: Prisma.SearchDocumentWhereInput = {
      ...(and.length ? { AND: and } : {}),
      ...(input.businessDomain ? { businessDomain: input.businessDomain } : {}),
      ...(input.status ? { businessStatus: input.status } : {}),
      ...(from || to
        ? {
            occurredAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      status: 'ACTIVE',
      tenantId: context.tenantId,
    };
    const [items, total] = await Promise.all([
      this.prisma.searchDocument.findMany({
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (pagination.number - 1) * pagination.size,
        take: pagination.size,
        where,
      }),
      this.prisma.searchDocument.count({ where }),
    ]);
    const criteria = JSON.parse(
      JSON.stringify(input),
    ) as Prisma.InputJsonObject;
    const queryId = randomUUID();
    await this.prisma.$transaction([
      this.prisma.searchQuery.create({
        data: {
          accountId: context.accountId,
          createdBy: context.accountId,
          criteria,
          id: queryId,
          queryText: query ?? null,
          resultCount: total,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      this.prisma.platformAuditLog.create({
        data: {
          action: 'search.query.executed',
          category: 'SENSITIVE_QUERY',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          queryCriteria: criteria,
          requestMethod: 'GET',
          requestPath: '/api/v1/platform/search',
          resourceId: queryId,
          resourceType: 'SearchQuery',
          resultCount: total,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        snapshot:
          context.accountKind === 'USER'
            ? redactSearchSnapshot(item.snapshot)
            : item.snapshot,
      })),
      page: pagination.number,
      pageSize: pagination.size,
      searchQueryId: queryId,
      total,
    };
  }

  listSavedViews(resourceType: string, context: TenantContext) {
    if (!IDENTIFIER_PATTERN.test(resourceType)) {
      throw new AppError(
        'SAVED_VIEW_RESOURCE_INVALID',
        'resourceType is invalid',
        400,
      );
    }
    return this.prisma.savedView.findMany({
      orderBy: [{ visibility: 'asc' }, { name: 'asc' }],
      where: {
        OR: [{ ownerAccountId: context.accountId }, { visibility: 'SHARED' }],
        resourceType,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
  }

  saveView(
    input: SaveViewInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const visibility = input.visibility ?? 'PERSONAL';
    if (
      !input.name?.trim() ||
      input.name.length > 150 ||
      !IDENTIFIER_PATTERN.test(input.resourceType) ||
      (input.savedViewId !== undefined && !isUuid(input.savedViewId)) ||
      (visibility === 'SHARED' && context.accountKind === 'USER')
    ) {
      throw new AppError(
        visibility === 'SHARED'
          ? 'SAVED_VIEW_SHARE_DENIED'
          : 'SAVED_VIEW_INVALID',
        'Saved view input or sharing permission is invalid',
        visibility === 'SHARED' ? 403 : 400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: input.savedViewId ? 200 : 201,
        scope: 'platform.saved-view.save.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const existing = input.savedViewId
          ? await transaction.savedView.findFirst({
              where: {
                id: input.savedViewId,
                ownerAccountId: context.accountId,
                tenantId: context.tenantId,
              },
            })
          : null;
        if (input.savedViewId && !existing) {
          throw new AppError(
            'SAVED_VIEW_NOT_FOUND',
            'Saved view was not found',
            404,
          );
        }
        if (
          existing &&
          (input.expectedVersion === undefined ||
            existing.version !== input.expectedVersion)
        ) {
          throw this.versionConflict();
        }
        const id = existing?.id ?? randomUUID();
        const view = existing
          ? await transaction.savedView.update({
              data: {
                aggregation: (input.aggregation ??
                  existing.aggregation) as Prisma.InputJsonObject,
                columns: input.columns as Prisma.InputJsonArray,
                filters: input.filters as Prisma.InputJsonObject,
                name: input.name.trim(),
                quickFilters: (input.quickFilters ??
                  []) as Prisma.InputJsonArray,
                resourceType: input.resourceType,
                sort: (input.sort ?? []) as Prisma.InputJsonArray,
                updatedBy: context.accountId,
                version: { increment: 1 },
                visibility,
              },
              where: { id },
            })
          : await transaction.savedView.create({
              data: {
                aggregation: (input.aggregation ??
                  {}) as Prisma.InputJsonObject,
                columns: input.columns as Prisma.InputJsonArray,
                createdBy: context.accountId,
                filters: input.filters as Prisma.InputJsonObject,
                id,
                name: input.name.trim(),
                ownerAccountId: context.accountId,
                quickFilters: (input.quickFilters ??
                  []) as Prisma.InputJsonArray,
                resourceType: input.resourceType,
                sort: (input.sort ?? []) as Prisma.InputJsonArray,
                tenantId: context.tenantId,
                updatedBy: context.accountId,
                visibility,
              },
            });
        await Promise.all([
          transaction.platformAuditLog.create({
            data: {
              action: existing ? 'saved-view.updated' : 'saved-view.created',
              after: {
                name: view.name,
                resourceType: view.resourceType,
                visibility: view.visibility,
              },
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              deviceId: context.deviceId,
              ipAddress: metadata.ipAddress ?? null,
              resourceId: view.id,
              resourceType: 'SavedView',
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          }),
          transaction.platformOutbox.create({
            data: {
              aggregateId: view.id,
              aggregateType: 'SavedView',
              aggregateVersion: view.version,
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              eventName: 'platform.saved-view-saved.v1',
              payload: {
                resourceType: view.resourceType,
                savedViewId: view.id,
                tenantId: context.tenantId,
                version: view.version,
              },
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          }),
        ]);
        return {
          savedViewId: view.id,
          status: view.status,
          version: view.version,
          visibility: view.visibility,
        };
      },
    );
  }

  changeViewStatus(
    savedViewId: string,
    input: ChangeSavedViewStatusInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      !isUuid(savedViewId) ||
      !['ACTIVE', 'INACTIVE'].includes(input.status)
    ) {
      throw new AppError(
        'SAVED_VIEW_STATUS_INVALID',
        'Saved view status is invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { savedViewId, ...input },
        responseCode: 200,
        scope: 'platform.saved-view.status.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const existing = await transaction.savedView.findFirst({
          where: {
            id: savedViewId,
            ownerAccountId: context.accountId,
            tenantId: context.tenantId,
          },
        });
        if (!existing)
          throw new AppError(
            'SAVED_VIEW_NOT_FOUND',
            'Saved view was not found',
            404,
          );
        if (existing.version !== input.expectedVersion)
          throw this.versionConflict();
        if (existing.status === input.status) {
          throw new AppError(
            'SAVED_VIEW_STATUS_UNCHANGED',
            'Saved view already has that status',
            409,
          );
        }
        const view = await transaction.savedView.update({
          data: {
            status: input.status,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: existing.id },
        });
        await Promise.all([
          transaction.platformAuditLog.create({
            data: {
              action: 'saved-view.status-changed',
              after: { status: view.status },
              before: { status: existing.status },
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              deviceId: context.deviceId,
              ipAddress: metadata.ipAddress ?? null,
              resourceId: view.id,
              resourceType: 'SavedView',
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          }),
          transaction.platformOutbox.create({
            data: {
              aggregateId: view.id,
              aggregateType: 'SavedView',
              aggregateVersion: view.version,
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              eventName: 'platform.saved-view-status-changed.v1',
              payload: {
                savedViewId: view.id,
                status: view.status,
                tenantId: context.tenantId,
                version: view.version,
              },
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          }),
        ]);
        return {
          savedViewId: view.id,
          status: view.status,
          version: view.version,
        };
      },
    );
  }

  private versionConflict() {
    return new AppError(
      'SAVED_VIEW_VERSION_CONFLICT',
      'Saved view version changed; refresh and retry',
      409,
      { retryable: true },
    );
  }
}

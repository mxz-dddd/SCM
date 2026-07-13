import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  TenantContext,
  WorkspaceContextSelection,
  WorkspaceTab,
} from '@scm/shared';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import type { CommandMetadata } from './tenant.service';

export function workspaceOwnershipWhere(context: TenantContext) {
  return { accountId: context.accountId, tenantId: context.tenantId } as const;
}

export interface SaveWorkspaceInput {
  readonly activeTabId?: string;
  readonly context: WorkspaceContextSelection;
  readonly openTabs: readonly WorkspaceTab[];
}

export interface SavePageSessionInput {
  readonly dirty: boolean;
  readonly draftState?: Readonly<Record<string, unknown>>;
  readonly pageKey: string;
  readonly queryState?: Readonly<Record<string, unknown>>;
  readonly route: string;
  readonly title: string;
}

export interface ToggleFavoriteInput {
  readonly pageKey: string;
  readonly route: string;
  readonly title: string;
}

@Injectable()
export class WorkspaceService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async get(context: TenantContext) {
    const owner = workspaceOwnershipWhere(context);
    const [layout, pageSessions, favorites] = await Promise.all([
      this.prisma.workspaceLayout.findUnique({
        where: { tenantId_accountId: owner },
      }),
      this.prisma.pageSession.findMany({
        orderBy: [{ lastVisitedAt: 'desc' }, { pageKey: 'asc' }],
        take: 20,
        where: owner,
      }),
      this.prisma.favorite.findMany({
        orderBy: [{ createdAt: 'desc' }, { pageKey: 'asc' }],
        where: owner,
      }),
    ]);
    return { favorites, layout, recent: pageSessions };
  }

  saveLayout(
    input: SaveWorkspaceInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      input.context.tenantId !== context.tenantId ||
      input.openTabs.length > 20 ||
      input.openTabs.some(
        (tab) =>
          !tab.id?.trim() || !tab.title?.trim() || !tab.route?.startsWith('/'),
      )
    ) {
      throw new AppError(
        'WORKSPACE_LAYOUT_INVALID',
        'Workspace context or tabs are invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 200,
        scope: `platform.workspace.save.v1:${context.accountId}`,
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const owner = workspaceOwnershipWhere(context);
        const existing = await transaction.workspaceLayout.findUnique({
          where: { tenantId_accountId: owner },
        });
        const version = (existing?.version ?? 0) + 1;
        const id = existing?.id ?? randomUUID();
        await transaction.workspaceLayout.upsert({
          create: {
            accountId: context.accountId,
            activeTabId: input.activeTabId ?? null,
            context: input.context as unknown as Prisma.InputJsonObject,
            createdBy: context.accountId,
            id,
            openTabs: input.openTabs as unknown as Prisma.InputJsonArray,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            version,
          },
          update: {
            activeTabId: input.activeTabId ?? null,
            context: input.context as unknown as Prisma.InputJsonObject,
            openTabs: input.openTabs as unknown as Prisma.InputJsonArray,
            updatedBy: context.accountId,
            version,
          },
          where: { tenantId_accountId: owner },
        });
        await transaction.platformAuditLog.create({
          data: {
            action: 'workspace.layout.save',
            after: {
              activeTabId: input.activeTabId ?? null,
              tabCount: input.openTabs.length,
            },
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            deviceId: context.deviceId,
            ipAddress: metadata.ipAddress ?? null,
            resourceId: id,
            resourceType: 'WorkspaceLayout',
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        return { layoutId: id, version };
      },
    );
  }

  savePage(
    input: SavePageSessionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.validatePage(input);
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 200,
        scope: `platform.page-session.save.v1:${context.accountId}:${input.pageKey}`,
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const owner = workspaceOwnershipWhere(context);
        const existing = await transaction.pageSession.findUnique({
          where: {
            tenantId_accountId_pageKey: { ...owner, pageKey: input.pageKey },
          },
        });
        const pageSessionId = existing?.id ?? randomUUID();
        const version = (existing?.version ?? 0) + 1;
        await transaction.pageSession.upsert({
          create: {
            ...owner,
            createdBy: context.accountId,
            dirty: input.dirty,
            draftState: (input.draftState ?? {}) as Prisma.InputJsonObject,
            id: pageSessionId,
            pageKey: input.pageKey,
            queryState: (input.queryState ?? {}) as Prisma.InputJsonObject,
            route: input.route,
            title: input.title,
            updatedBy: context.accountId,
            version,
          },
          update: {
            dirty: input.dirty,
            draftState: (input.draftState ?? {}) as Prisma.InputJsonObject,
            lastVisitedAt: new Date(),
            queryState: (input.queryState ?? {}) as Prisma.InputJsonObject,
            route: input.route,
            title: input.title,
            updatedBy: context.accountId,
            version,
          },
          where: {
            tenantId_accountId_pageKey: { ...owner, pageKey: input.pageKey },
          },
        });
        return { pageSessionId, version };
      },
    );
  }

  toggleFavorite(
    input: ToggleFavoriteInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.validatePage(input);
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 200,
        scope: `platform.favorite.toggle.v1:${context.accountId}:${input.pageKey}`,
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const owner = workspaceOwnershipWhere(context);
        const existing = await transaction.favorite.findUnique({
          where: {
            tenantId_accountId_pageKey: { ...owner, pageKey: input.pageKey },
          },
        });
        if (existing) {
          await transaction.favorite.delete({ where: { id: existing.id } });
          return { favorite: false, pageKey: input.pageKey };
        }
        const favoriteId = randomUUID();
        await transaction.favorite.create({
          data: {
            ...owner,
            createdBy: context.accountId,
            id: favoriteId,
            pageKey: input.pageKey,
            route: input.route,
            title: input.title,
            updatedBy: context.accountId,
          },
        });
        return { favorite: true, favoriteId, pageKey: input.pageKey };
      },
    );
  }

  private validatePage(input: {
    readonly pageKey: string;
    readonly route: string;
    readonly title: string;
  }): void {
    if (
      !/^[a-z][a-z0-9_.-]{1,149}$/i.test(input.pageKey) ||
      !input.title.trim() ||
      !input.route.startsWith('/')
    ) {
      throw new AppError(
        'PAGE_SESSION_INVALID',
        'Page key, title or route is invalid',
        400,
      );
    }
  }
}

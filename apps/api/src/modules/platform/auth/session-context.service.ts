import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../../common/app-error';
import { isUuid } from '../../../common/validation';
import { PrismaService } from '../../../database/prisma.service';
import { JwtTokenService } from './jwt-token.service';

@Injectable()
export class SessionContextService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtTokenService) private readonly tokens: JwtTokenService,
  ) {}

  async authenticate(
    authorization: string | undefined,
    requestedTenantId: string | undefined,
  ): Promise<TenantContext> {
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined;
    if (!token) {
      throw new AppError('AUTH_REQUIRED', 'Authentication is required', 401);
    }
    if (!requestedTenantId) {
      throw new AppError(
        'TENANT_CONTEXT_REQUIRED',
        'X-Tenant-Id is required',
        400,
      );
    }

    const workerActorId = this.workerActorId(token);
    if (workerActorId) {
      if (!isUuid(requestedTenantId))
        throw new AppError(
          'TENANT_CONTEXT_INVALID',
          'X-Tenant-Id is invalid',
          400,
        );
      const tenant = await this.prisma.tenant.findUnique({
        where: { tenantId: requestedTenantId },
      });
      if (tenant?.status !== 'ACTIVE')
        throw new AppError(
          'WORKER_TENANT_UNAVAILABLE',
          'Worker tenant is not active',
          403,
        );
      return {
        accountId: workerActorId,
        accountKind: 'WORKER',
        deviceId: 'scm-worker',
        organizationIds: [],
        permissionVersion: 0,
        tenantId: requestedTenantId,
        tokenId: `worker:${this.digest(token).slice(0, 24)}`,
      };
    }

    const claims = this.tokens.verify(token);
    if (claims.tenantId !== requestedTenantId) {
      throw new AppError(
        'TENANT_CONTEXT_MISMATCH',
        'Token tenant does not match X-Tenant-Id',
        403,
      );
    }

    const [tenant, account] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { tenantId: claims.tenantId } }),
      this.prisma.account.findFirst({
        where: { id: claims.subject, tenantId: claims.tenantId },
      }),
    ]);
    if (
      tenant?.status !== 'ACTIVE' ||
      account?.status !== 'ACTIVE' ||
      account.permissionVersion !== claims.permissionVersion ||
      account.kind !== claims.accountKind
    ) {
      throw new AppError(
        'AUTH_SESSION_STALE',
        'Session permissions or account status changed; authenticate again',
        401,
      );
    }

    return {
      accountId: claims.subject,
      accountKind: claims.accountKind,
      deviceId: claims.deviceId,
      organizationIds: claims.organizationIds,
      permissionVersion: claims.permissionVersion,
      tenantId: claims.tenantId,
      tokenId: claims.tokenId,
    };
  }

  async discoverActiveTenants(
    authorization: string | undefined,
    input: { cursor?: string; limit?: string },
  ) {
    const token = this.bearer(authorization);
    if (!token || !this.workerActorId(token))
      throw new AppError(
        'WORKER_AUTH_REQUIRED',
        'Valid worker control authentication is required',
        401,
      );
    if (input.cursor && !isUuid(input.cursor))
      throw new AppError(
        'WORKER_TENANT_CURSOR_INVALID',
        'Tenant cursor is invalid',
        400,
      );
    const parsedLimit = input.limit === undefined ? 50 : Number(input.limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100)
      throw new AppError(
        'WORKER_TENANT_LIMIT_INVALID',
        'Tenant page limit must be between 1 and 100',
        400,
      );
    const rows = await this.prisma.tenant.findMany({
      orderBy: { id: 'asc' },
      select: { code: true, id: true, name: true, tenantId: true },
      take: parsedLimit + 1,
      where: {
        status: 'ACTIVE',
        ...(input.cursor ? { id: { gt: input.cursor } } : {}),
      },
    });
    const hasMore = rows.length > parsedLimit;
    const items = rows.slice(0, parsedLimit);
    return {
      items,
      nextCursor: hasMore ? items.at(-1)?.id : undefined,
    };
  }

  private bearer(authorization: string | undefined) {
    return authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined;
  }

  private digest(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private workerActorId(token: string) {
    const configured = process.env.WORKER_CONTROL_TOKEN;
    const actorId = process.env.WORKER_ACTOR_ID;
    if (!configured || configured.length < 32 || !actorId || !isUuid(actorId))
      return undefined;
    const actual = Buffer.from(this.digest(token), 'hex');
    const expected = Buffer.from(this.digest(configured), 'hex');
    return timingSafeEqual(actual, expected) ? actorId : undefined;
  }
}

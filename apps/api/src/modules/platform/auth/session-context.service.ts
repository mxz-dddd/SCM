import { Inject, Injectable } from '@nestjs/common';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../../common/app-error';
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
}

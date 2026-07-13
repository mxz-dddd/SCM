import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/app-error';
import { PrismaService } from '../../../database/prisma.service';
import { PLATFORM_OPERATOR_TENANT_ID } from '../platform.constants';
import { JwtTokenService } from './jwt-token.service';
import { verifyPassword } from './password';

export interface LoginInput {
  readonly deviceId: string;
  readonly password: string;
  readonly tenantCode: string;
  readonly username: string;
}

export interface LoginMetadata {
  readonly correlationId: string;
  readonly ipAddress: string | undefined;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtTokenService) private readonly tokens: JwtTokenService,
  ) {}

  async login(input: LoginInput, metadata: LoginMetadata) {
    const tenantCode = input.tenantCode.trim().toUpperCase();
    const username = input.username.trim().toLowerCase();
    if (!tenantCode || !username || !input.password || !input.deviceId.trim()) {
      throw new AppError(
        'AUTH_LOGIN_INVALID',
        'Tenant, username, password and device are required',
        400,
      );
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { code: tenantCode },
    });
    if (!tenant) {
      await this.recordLogin({
        accountId: null,
        failureCode: 'INVALID_CREDENTIALS',
        input,
        metadata,
        outcome: 'FAILURE',
        tenantId: PLATFORM_OPERATOR_TENANT_ID,
        username,
      });
      throw this.invalidCredentials();
    }

    const account = await this.prisma.account.findUnique({
      where: { tenantId_username: { tenantId: tenant.tenantId, username } },
    });
    const passwordMatches =
      account?.passwordHash !== null &&
      account?.passwordHash !== undefined &&
      (await verifyPassword(input.password, account.passwordHash));
    const now = new Date();
    const accountUsable =
      account?.status === 'ACTIVE' &&
      (!account.validUntil || account.validUntil > now) &&
      (!account.lockedUntil || account.lockedUntil <= now);

    if (
      tenant.status !== 'ACTIVE' ||
      !account ||
      !passwordMatches ||
      !accountUsable
    ) {
      if (account && !passwordMatches) {
        const failedLoginCount = account.failedLoginCount + 1;
        await this.prisma.account.updateMany({
          data: {
            failedLoginCount,
            lockedUntil:
              failedLoginCount >= 5
                ? new Date(Date.now() + 15 * 60 * 1000)
                : account.lockedUntil,
            status: failedLoginCount >= 5 ? 'LOCKED' : account.status,
            updatedBy: account.id,
            version: { increment: 1 },
          },
          where: {
            id: account.id,
            tenantId: tenant.tenantId,
            version: account.version,
          },
        });
      }
      await this.recordLogin({
        accountId: account?.id ?? null,
        failureCode:
          tenant.status !== 'ACTIVE'
            ? 'TENANT_NOT_ACTIVE'
            : 'INVALID_CREDENTIALS',
        input,
        metadata,
        outcome: 'FAILURE',
        tenantId: tenant.tenantId,
        username,
      });
      throw this.invalidCredentials();
    }

    const bindings = await this.prisma.identityBinding.findMany({
      select: { organizationId: true },
      where: {
        accountId: account.id,
        status: 'ACTIVE',
        tenantId: tenant.tenantId,
      },
    });
    await this.prisma.$transaction([
      this.prisma.account.update({
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          updatedBy: account.id,
          version: { increment: 1 },
        },
        where: { id: account.id },
      }),
      this.prisma.loginAudit.create({
        data: {
          accountId: account.id,
          correlationId: metadata.correlationId,
          createdBy: account.id,
          deviceId: input.deviceId,
          factors: ['password'],
          ipAddress: metadata.ipAddress ?? null,
          outcome: 'SUCCESS',
          tenantId: tenant.tenantId,
          updatedBy: account.id,
          username,
        },
      }),
    ]);

    const issued = this.tokens.issue({
      accountKind: account.kind,
      deviceId: input.deviceId,
      organizationIds: bindings.map((binding) => binding.organizationId),
      permissionVersion: account.permissionVersion,
      subject: account.id,
      tenantId: tenant.tenantId,
    });
    return {
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
      session: issued.claims,
    };
  }

  private invalidCredentials(): AppError {
    return new AppError(
      'AUTH_INVALID_CREDENTIALS',
      'Tenant, username or password is invalid',
      401,
    );
  }

  private async recordLogin(input: {
    accountId: string | null;
    failureCode: string;
    input: LoginInput;
    metadata: LoginMetadata;
    outcome: 'FAILURE';
    tenantId: string;
    username: string;
  }): Promise<void> {
    await this.prisma.loginAudit.create({
      data: {
        accountId: input.accountId,
        correlationId: input.metadata.correlationId,
        createdBy: input.accountId ?? input.tenantId,
        deviceId: input.input.deviceId,
        factors: ['password'],
        failureCode: input.failureCode,
        ipAddress: input.metadata.ipAddress ?? null,
        outcome: input.outcome,
        tenantId: input.tenantId,
        updatedBy: input.accountId ?? input.tenantId,
        username: input.username,
      },
    });
  }
}

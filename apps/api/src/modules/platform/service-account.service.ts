import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isPrismaErrorCode } from '../../common/prisma-error';
import { requireAccountKind } from './auth/authorization';
import { IdempotencyService } from './idempotency.service';
import type { CommandMetadata } from './tenant.service';

export function deriveCredentialSecret(
  masterKey: string,
  tenantId: string,
  idempotencyKey: string,
): string {
  if (masterKey.length < 32) {
    throw new AppError(
      'API_CREDENTIAL_MASTER_KEY_INVALID',
      'API_CREDENTIAL_MASTER_KEY must contain at least 32 characters',
      500,
    );
  }
  return `scm_${createHmac('sha256', masterKey)
    .update(`${tenantId}:${idempotencyKey}`)
    .digest('base64url')}`;
}

export interface CreateServiceAccountInput {
  readonly code: string;
  readonly displayName: string;
  readonly expiresAt?: string;
}

@Injectable()
export class ServiceAccountService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  async create(
    input: CreateServiceAccountInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    requireAccountKind(context, ['PLATFORM_ADMIN', 'TENANT_ADMIN']);
    const idempotencyKey = metadata.idempotencyKey?.trim();
    if (!idempotencyKey) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency-Key is required for this command',
        400,
      );
    }
    if (!input.code.trim() || !input.displayName.trim()) {
      throw new AppError(
        'SERVICE_ACCOUNT_INPUT_INVALID',
        'Service account code and display name are required',
        400,
      );
    }
    if (input.expiresAt && Number.isNaN(Date.parse(input.expiresAt))) {
      throw new AppError(
        'SERVICE_ACCOUNT_EXPIRY_INVALID',
        'expiresAt must be an ISO date-time',
        400,
      );
    }
    const secret = deriveCredentialSecret(
      process.env.API_CREDENTIAL_MASTER_KEY ?? '',
      context.tenantId,
      idempotencyKey,
    );
    const secretHash = createHash('sha256').update(secret).digest('hex');

    try {
      const result = await this.idempotency.execute(
        {
          actorId: context.accountId,
          key: idempotencyKey,
          payload: input,
          responseCode: 201,
          scope: 'platform.service-account.create.v1',
          tenantId: context.tenantId,
        },
        async (transaction) => {
          const serviceAccountId = randomUUID();
          const credentialId = randomUUID();
          const keyId = randomUUID();
          await transaction.serviceAccount.create({
            data: {
              code: input.code.trim().toUpperCase(),
              createdBy: context.accountId,
              displayName: input.displayName.trim(),
              id: serviceAccountId,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          await transaction.apiCredential.create({
            data: {
              createdBy: context.accountId,
              expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
              id: credentialId,
              keyId,
              lastFour: secret.slice(-4),
              secretHash,
              serviceAccountId,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          await transaction.platformAuditLog.create({
            data: {
              action: 'service-account.create',
              after: { credentialId, keyId, serviceAccountId },
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              deviceId: context.deviceId,
              ipAddress: metadata.ipAddress ?? null,
              resourceId: serviceAccountId,
              resourceType: 'ServiceAccount',
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          await transaction.platformOutbox.create({
            data: {
              aggregateId: serviceAccountId,
              aggregateType: 'ServiceAccount',
              aggregateVersion: 1,
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              eventName: 'platform.api-credential-created.v1',
              payload: { credentialId, keyId, serviceAccountId },
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          return { credentialId, keyId, serviceAccountId };
        },
      );

      return { ...result, secret };
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2002')) {
        throw new AppError(
          'SERVICE_ACCOUNT_DUPLICATE',
          'Service account code already exists in this tenant',
          409,
        );
      }
      throw error;
    }
  }
}

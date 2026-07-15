import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import type { CommandMetadata } from '../tenant.service';

@Injectable()
export class ChangeRecordingFacade {
  async record(
    transaction: Prisma.TransactionClient,
    input: {
      readonly aggregateId: string;
      readonly aggregateType: string;
      readonly aggregateVersion: number;
      readonly eventName: string;
      readonly payload: Prisma.InputJsonObject;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ): Promise<void> {
    await Promise.all([
      transaction.platformAuditLog.create({
        data: {
          action: input.eventName,
          after: input.payload,
          category: 'BUSINESS_CHANGE',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: input.aggregateId,
          resourceType: input.aggregateType,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      transaction.platformOutbox.create({
        data: {
          aggregateId: input.aggregateId,
          aggregateType: input.aggregateType,
          aggregateVersion: input.aggregateVersion,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName: input.eventName,
          partitionKey: input.aggregateId,
          payload: { ...input.payload, tenantId: context.tenantId },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }
}

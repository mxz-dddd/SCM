import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../database/prisma.service';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function hashIdempotencyRequest(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(payload)))
    .digest('hex');
}

interface IdempotencyInput {
  readonly actorId: string;
  readonly key: string | undefined;
  readonly payload: unknown;
  readonly responseCode: number;
  readonly scope: string;
  readonly tenantId: string;
}

@Injectable()
export class IdempotencyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  execute<T extends Record<string, unknown>>(
    input: IdempotencyInput,
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const key = input.key?.trim();
    if (!key) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency-Key is required for this command',
        400,
      );
    }
    if (key.length > 200) {
      throw new AppError(
        'IDEMPOTENCY_KEY_INVALID',
        'Idempotency-Key must not exceed 200 characters',
        400,
      );
    }

    const requestHash = hashIdempotencyRequest(input.payload);
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.idempotencyRecord.findUnique({
        where: {
          tenantId_scope_key: {
            key,
            scope: input.scope,
            tenantId: input.tenantId,
          },
        },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new AppError(
            'IDEMPOTENCY_KEY_CONFLICT',
            'Idempotency-Key was already used with different content',
            409,
          );
        }
        return existing.responseBody as T;
      }

      const result = await operation(transaction);
      const responseBody = JSON.parse(
        JSON.stringify(result),
      ) as Prisma.InputJsonValue;
      await transaction.idempotencyRecord.create({
        data: {
          createdBy: input.actorId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          key,
          requestHash,
          responseBody,
          responseCode: input.responseCode,
          scope: input.scope,
          tenantId: input.tenantId,
          updatedBy: input.actorId,
        },
      });
      return result;
    });
  }
}

export type TransactionRunner = Pick<PrismaClient, '$transaction'>;

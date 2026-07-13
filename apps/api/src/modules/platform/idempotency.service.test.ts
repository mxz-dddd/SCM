import type { Prisma, PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';

function createHarness() {
  let record:
    | {
        requestHash: string;
        responseBody: Prisma.JsonValue;
      }
    | undefined;
  const transaction = {
    idempotencyRecord: {
      create: ({ data }: { data: Prisma.IdempotencyRecordCreateInput }) => {
        record = {
          requestHash: data.requestHash,
          responseBody: data.responseBody as Prisma.JsonValue,
        };
        return Promise.resolve(data);
      },
      findUnique: () => Promise.resolve(record),
    },
  };
  const prisma = {
    $transaction: <T>(
      callback: (client: Prisma.TransactionClient) => Promise<T>,
    ) => callback(transaction as unknown as Prisma.TransactionClient),
  } as Pick<PrismaClient, '$transaction'>;
  return new IdempotencyService(prisma as unknown as PrismaService);
}

const baseInput = {
  actorId: '10000000-0000-4000-8000-000000000001',
  key: 'tenant-create-1',
  payload: { code: 'ACME', name: 'Acme' },
  responseCode: 201,
  scope: 'platform.tenant.provision.v1',
  tenantId: '10000000-0000-4000-8000-000000000002',
};

describe('external write idempotency', () => {
  it('returns the original response without running the command twice', async () => {
    const service = createHarness();
    let executions = 0;
    const operation = async () => {
      executions += 1;
      return { tenantId: 'tenant-result', version: 1 };
    };

    await expect(service.execute(baseInput, operation)).resolves.toEqual({
      tenantId: 'tenant-result',
      version: 1,
    });
    await expect(service.execute(baseInput, operation)).resolves.toEqual({
      tenantId: 'tenant-result',
      version: 1,
    });
    expect(executions).toBe(1);
  });

  it('rejects reuse of a key with different content', async () => {
    const service = createHarness();
    await service.execute(baseInput, async () => ({
      tenantId: 'tenant-result',
    }));

    await expect(
      service.execute(
        { ...baseInput, payload: { code: 'OTHER', name: 'Other' } },
        async () => ({ tenantId: 'should-not-run' }),
      ),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_CONFLICT',
      statusCode: 409,
    });
  });

  it('requires an Idempotency-Key', () => {
    const service = createHarness();
    expect(() =>
      service.execute({ ...baseInput, key: undefined }, async () => ({
        ok: true,
      })),
    ).toThrow('Idempotency-Key is required');
  });
});

import { describe, expect, it } from 'vitest';
import { AtpAllocationService } from './atp-allocation.service';

describe('ATP allocation validation', () => {
  const context = {
    accountId: '10000000-0000-4000-8000-000000000001',
    accountKind: 'USER',
    deviceId: 'test',
    organizationIds: [],
    permissionVersion: 1,
    tenantId: '10000000-0000-4000-8000-000000000002',
    tokenId: 'token',
  } as const;
  const metadata = {
    correlationId: 'test',
    idempotencyKey: 'test',
    ipAddress: undefined,
  };

  it('rejects an invalid projection before persistence', async () => {
    const service = new AtpAllocationService({} as never, {} as never);
    await expect(
      service.project(
        {
          baseUom: 'EA',
          onHand: '1',
          ownerId: 'bad',
          productId: 'bad',
          snapshotAt: '2026-07-14T00:00:00Z',
          sourceVersion: 1,
          warehouseId: 'bad',
        },
        context,
        metadata,
      ),
    ).rejects.toMatchObject({ code: 'ATP_INPUT_INVALID', statusCode: 400 });
  });

  it('rejects allocation outside the approved state', async () => {
    const prisma = {
      businessOrder: {
        findFirst: () =>
          Promise.resolve({
            id: '10000000-0000-4000-8000-000000000003',
            status: 'OPEN',
            version: 1,
          }),
      },
    };
    const service = new AtpAllocationService(prisma as never, {} as never);
    await expect(
      service.allocate(
        '10000000-0000-4000-8000-000000000003',
        {
          expectedVersion: 1,
          ownerId: '10000000-0000-4000-8000-000000000004',
          ruleSetCode: 'ALLOCATE_TEST',
        },
        context,
        metadata,
      ),
    ).rejects.toMatchObject({
      code: 'ORDER_ALLOCATION_STATE_INVALID',
      statusCode: 409,
    });
  });
});

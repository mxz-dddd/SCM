import { describe, expect, it } from 'vitest';
import { CollaborationTimelineService } from './collaboration-timeline.service';
const context = {
  accountId: '10000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000002',
} as never;
const metadata = {
  correlationId: 'test',
  idempotencyKey: 'test',
  ipAddress: undefined,
};
describe('partner collaboration validation', () => {
  it('rejects a partner outside the order scope', async () => {
    const prisma = {
      businessOrder: {
        findFirst: () =>
          Promise.resolve({
            customerId: '10000000-0000-4000-8000-000000000003',
            status: 'OPEN',
          }),
      },
    };
    const service = new CollaborationTimelineService(
      prisma as never,
      {} as never,
    );
    await expect(
      service.collaborate(
        '10000000-0000-4000-8000-000000000004',
        {
          partnerId: '10000000-0000-4000-8000-000000000005',
          type: 'CUSTOMER_CONFIRMATION',
        },
        context,
        metadata,
      ),
    ).rejects.toMatchObject({
      code: 'ORDER_PARTNER_SCOPE_DENIED',
      statusCode: 403,
    });
  });
});

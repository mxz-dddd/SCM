import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { AttachmentReferenceFacade } from '../platform/public/attachment-reference.facade';
import { DeliveryReverseService } from './delivery-reverse.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('TMS delivery, POD, claim and reverse persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('keeps item quantities, blocks returned POD and creates deduction and return facts', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'delivery-db-test',
      organizationIds: [],
      permissionVersion: 1,
      tenantId,
      tokenId: randomUUID(),
    };
    const command = () => ({
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      ipAddress: '127.0.0.1',
    });
    const now = Date.now();
    const batch = await prisma.planningBatch.create({
      data: {
        batchNo: `PB-${randomUUID()}`,
        createdBy: actorId,
        criteria: {},
        planningDate: new Date(now),
        plannedAt: new Date(),
        regionCode: 'EAST',
        status: 'PLANNED',
        tenantId,
        updatedBy: actorId,
      },
    });
    const plan = await prisma.consolidationPlan.create({
      data: {
        createdBy: actorId,
        planNo: `CP-${randomUUID()}`,
        planningBatchId: batch.id,
        policySnapshot: {},
        publishedAt: new Date(),
        status: 'APPROVED',
        tenantId,
        updatedBy: actorId,
        validatedAt: new Date(),
      },
    });
    const shipment = await prisma.shipment.create({
      data: {
        consolidationPlanId: plan.id,
        createdBy: actorId,
        deliveryWindowTo: new Date(now + 8 * 3_600_000),
        destinationSnapshot: { city: '上海' },
        mode: 'ROAD_FTL',
        originSnapshot: { city: '苏州' },
        pickupWindowFrom: new Date(now - 3_600_000),
        requirementSnapshot: {},
        shipmentNo: `SHP-${randomUUID()}`,
        status: 'TRACKING',
        tenantId,
        totalPallets: 2,
        totalVolumeBase: 5,
        totalWeightBase: 500,
        updatedBy: actorId,
      },
    });
    const items = [];
    for (const [index, quantity] of [10, 5].entries())
      items.push(
        await prisma.shipmentItem.create({
          data: {
            allocationRatio: index ? '0.333333333333' : '0.666666666667',
            createdBy: actorId,
            itemSnapshot: { product: `SKU-${index}` },
            quantity,
            quantityBase: quantity,
            quantityBaseUom: 'EA',
            quantityUom: 'EA',
            shipmentId: shipment.id,
            sourceLineRef: `LINE-${index}`,
            tenantId,
            transportOrderId: randomUUID(),
            updatedBy: actorId,
            volumeBase: 1,
            weightBase: 10,
          },
        }),
      );
    async function file(name: string) {
      return prisma.fileObject.create({
        data: {
          bucket: 'scm',
          checksumSha256: 'a'.repeat(64),
          contentType: 'application/pdf',
          createdBy: actorId,
          objectKey: `${tenantId}/${randomUUID()}`,
          originalName: name,
          retentionUntil: new Date(now + 365 * 86_400_000),
          scanStatus: 'CLEAN',
          scannedAt: new Date(),
          sensitive: true,
          sizeBytes: 1024,
          status: 'AVAILABLE',
          tenantId,
          updatedBy: actorId,
          uploadedAt: new Date(),
          uploadExpiresAt: new Date(now + 3_600_000),
        },
      });
    }
    const firstFile = await file('pod-page-1.pdf');
    const secondFile = await file('pod-page-2.pdf');
    const service = new DeliveryReverseService(
      new AttachmentReferenceFacade(prisma as never),
      prisma as never,
    );
    const confirmation = await service.confirmDelivery(
      shipment.id,
      {
        arrivedAt: new Date(now).toISOString(),
        deliveryLocationSnapshot: { latitude: 31.2, longitude: 121.4 },
        expectedShipmentVersion: shipment.version,
        lines: [
          {
            damagedQuantityBase: '0',
            deliveredQuantityBase: '10',
            evidenceSnapshot: {},
            reason: '数量一致',
            refusedQuantityBase: '0',
            shipmentItemId: items[0]!.id,
          },
          {
            damagedQuantityBase: '1',
            deliveredQuantityBase: '3',
            evidenceSnapshot: { photo: firstFile.id },
            reason: '破损且拒收一件',
            refusedQuantityBase: '1',
            shipmentItemId: items[1]!.id,
          },
        ],
        recipientName: '收货人',
        recipientSnapshot: { role: 'CUSTOMER' },
        signatureSnapshot: { signed: true },
        signedAt: new Date(now + 30 * 60_000).toISOString(),
        unloadingCompletedAt: new Date(now + 25 * 60_000).toISOString(),
        unloadingStartedAt: new Date(now + 5 * 60_000).toISOString(),
      },
      context,
      command(),
    );
    expect(confirmation.shipmentStatus).toBe('DELIVERED');
    expect(confirmation.varianceIds).toHaveLength(3);
    expect(
      await prisma.platformOutbox.count({
        where: { eventName: 'shipment.delivery-variance.v1', tenantId },
      }),
    ).toBe(1);

    const submitted = await service.submitPod(
      shipment.id,
      {
        fileObjectIds: [firstFile.id],
        pageCount: 1,
        signatureSnapshot: { signed: true },
      },
      context,
      command(),
    );
    const reviewing = await service.reviewPod(
      submitted.podId,
      {
        checkSnapshot: {},
        decision: 'START',
        expectedVersion: submitted.version,
        reason: '开始审核',
      },
      context,
      command(),
    );
    const returned = await service.reviewPod(
      submitted.podId,
      {
        checkSnapshot: { clarityConfirmed: false },
        decision: 'RETURN',
        expectedVersion: reviewing.version,
        reason: '第二页缺失',
      },
      context,
      command(),
    );
    expect(returned.status).toBe('RETURNED');
    expect(
      (await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } }))
        .status,
    ).toBe('DELIVERED');
    const supplemented = await service.supplementPod(
      submitted.podId,
      {
        expectedVersion: returned.version,
        fileObjectIds: [secondFile.id],
        notes: '补齐第二页',
        pageCount: 2,
      },
      context,
      command(),
    );
    const reviewingAgain = await service.reviewPod(
      submitted.podId,
      {
        checkSnapshot: {},
        decision: 'START',
        expectedVersion: supplemented.version,
        reason: '重新审核',
      },
      context,
      command(),
    );
    await expect(
      service.reviewPod(
        submitted.podId,
        {
          checkSnapshot: { clarityConfirmed: true },
          decision: 'CONFIRM',
          expectedVersion: reviewingAgain.version,
          reason: '不完整检查',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_POD_CONFIRM_CHECK_FAILED' });
    const confirmed = await service.reviewPod(
      submitted.podId,
      {
        checkSnapshot: {
          clarityConfirmed: true,
          signatureConfirmed: true,
          signedTimeConfirmed: true,
          varianceAcknowledged: true,
        },
        decision: 'CONFIRM',
        expectedVersion: reviewingAgain.version,
        reason: '回单与差异均确认',
      },
      context,
      command(),
    );
    expect(confirmed.status).toBe('CONFIRMED');
    expect(
      (await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } }))
        .status,
    ).toBe('POD');

    const damage = await prisma.deliveryVariance.findFirstOrThrow({
      where: { shipmentId: shipment.id, type: 'DAMAGE' },
    });
    const claim = await service.createClaim(
      shipment.id,
      {
        claimedAmount: '500',
        claimantRef: 'CUSTOMER-1',
        currency: 'CNY',
        deliveryVarianceId: damage.id,
        evidenceFileObjectIds: [firstFile.id],
        liabilitySnapshot: { basis: 'CARRIER' },
      },
      context,
      command(),
    );
    const negotiate = await service.transitionClaim(
      claim.claimId,
      {
        action: 'NEGOTIATE',
        expectedVersion: claim.version,
        negotiationSnapshot: { offer: 450 },
      },
      context,
      command(),
    );
    const pending = await service.transitionClaim(
      claim.claimId,
      {
        action: 'SUBMIT',
        expectedVersion: negotiate.version,
        negotiationSnapshot: { acceptedOffer: 450 },
      },
      context,
      command(),
    );
    const approved = await service.transitionClaim(
      claim.claimId,
      {
        action: 'APPROVE',
        approvalReference: 'WF-APPROVED',
        approvedAmount: '450',
        expectedVersion: pending.version,
        negotiationSnapshot: { acceptedOffer: 450 },
        responsiblePartyRef: 'CARRIER-1',
      },
      context,
      command(),
    );
    expect(approved.deductionFactId).toBeDefined();
    const settled = await service.transitionClaim(
      claim.claimId,
      {
        action: 'SETTLE',
        expectedVersion: approved.version,
        negotiationSnapshot: {},
      },
      context,
      command(),
    );
    const closed = await service.transitionClaim(
      claim.claimId,
      {
        action: 'CLOSE',
        expectedVersion: settled.version,
        negotiationSnapshot: {},
      },
      context,
      command(),
    );
    expect(closed.status).toBe('CLOSED');

    const reverse = await service.createReturn(
      shipment.id,
      {
        deliveryVarianceId: damage.id,
        deliveryWindowTo: new Date(now + 12 * 3_600_000).toISOString(),
        itemSnapshot: [{ quantity: 1, shipmentItemId: items[1]!.id }],
        pickupWindowFrom: new Date(now + 10 * 3_600_000).toISOString(),
        reason: '退回破损货物',
        type: 'RETURN_GOODS',
      },
      context,
      command(),
    );
    expect(reverse).toMatchObject({
      status: 'REQUESTED',
      transportOrderStatus: 'OPEN',
    });
    await expect(
      prisma.podReview.update({
        data: { reason: 'tampered' },
        where: {
          id: (
            await prisma.podReview.findFirstOrThrow({
              where: { proofOfDeliveryId: submitted.podId },
            })
          ).id,
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.deductionFact.update({
        data: { amount: 1 },
        where: { id: approved.deductionFactId! },
      }),
    ).rejects.toBeDefined();
  });
});

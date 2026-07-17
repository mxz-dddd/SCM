import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChangeRecordingFacade } from '../platform/public/change-recording.facade';
import { MessageExchangeService } from './message-exchange.service';
import { WebhookEndpointPolicy } from './webhook-endpoint.policy';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();
const context = (tenantId = randomUUID()): TenantContext => ({
  accountId: randomUUID(),
  accountKind: 'TENANT_ADMIN',
  deviceId: 'message-exchange-database-test',
  organizationIds: [],
  permissionVersion: 1,
  tenantId,
  tokenId: randomUUID(),
});
const command = () => ({
  correlationId: randomUUID(),
  idempotencyKey: randomUUID(),
  ipAddress: '127.0.0.1',
});

databaseDescribe(
  'Integration file, mapping, webhook and replay governance',
  () => {
    let service: MessageExchangeService;

    beforeAll(() => {
      process.env.API_CREDENTIAL_MASTER_KEY =
        'message-exchange-test-master-key-at-least-32-characters';
      service = new MessageExchangeService(
        prisma as never,
        new ChangeRecordingFacade(),
        new WebhookEndpointPolicy(async () => [
          { address: '93.184.216.34', family: 4 },
        ]),
      );
    });
    afterAll(() => prisma.$disconnect());

    it('deduplicates file digests, separates line outcomes and archives immutable evidence', async () => {
      const actor = context();
      const input = {
        businessRef: 'ASN-1001',
        channel: 'SFTP' as const,
        directory: '/inbound/asn',
        encryption: 'PGP' as const,
        fileName: 'asn-1001.json.pgp',
        format: 'JSON' as const,
        lines: [
          {
            businessRef: 'ASN-1001-1',
            payload: { externalSku: 'SKU-A', quantity: 2 },
          },
          {
            businessRef: 'ASN-1001-2',
            payload: { externalSku: 'BAD', quantity: -1 },
          },
        ],
        objectRef: 'private/inbound/asn-1001.json.pgp',
        partnerRef: 'SUPPLIER-1',
      };
      const received = await service.receiveFile(input, actor, command());
      expect(received).toMatchObject({ duplicate: false, status: 'RECEIVED' });
      await expect(
        service.receiveFile(input, actor, command()),
      ).resolves.toMatchObject({
        duplicate: true,
        fileExchangeId: received.fileExchangeId,
      });
      const completed = await service.completeFile(
        received.fileExchangeId,
        {
          expectedVersion: 1,
          results: [
            {
              lineNumber: 1,
              output: { sku: 'SKU-A', quantity: 2 },
              success: true,
            },
            {
              errorCode: 'QUANTITY_INVALID',
              errorMessage: 'Quantity must be positive',
              lineNumber: 2,
              success: false,
            },
          ],
        },
        actor,
        command(),
      );
      expect(completed).toMatchObject({
        outcome: 'PARTIAL',
        status: 'ACKNOWLEDGED',
        version: 2,
      });
      expect(
        await prisma.integrationFileLine.findMany({
          orderBy: { lineNumber: 'asc' },
          select: { lineNumber: true, status: true },
          where: { fileExchangeId: received.fileExchangeId },
        }),
      ).toEqual([
        { lineNumber: 1, status: 'PROCESSED' },
        { lineNumber: 2, status: 'REJECTED' },
      ]);
      await expect(
        service.archiveFile(
          received.fileExchangeId,
          { expectedVersion: 2 },
          actor,
          command(),
        ),
      ).resolves.toMatchObject({ status: 'ARCHIVED', version: 3 });
      const line = await prisma.integrationFileLine.findFirstOrThrow({
        where: { fileExchangeId: received.fileExchangeId, lineNumber: 1 },
      });
      await expect(
        prisma.integrationFileLine.update({
          data: { sourcePayload: { tampered: true } },
          where: { id: line.id },
        }),
      ).rejects.toBeDefined();
      await expect(
        prisma.integrationAckMessage.update({
          data: { payload: { tampered: true } },
          where: { id: completed.ackMessageId },
        }),
      ).rejects.toBeDefined();
    });

    it('requires sample testing before publishing and pins every transform to a mapping version', async () => {
      const actor = context();
      const mapping = await service.createMapping(
        {
          code: `ERP-ORDER-${randomUUID()}`,
          expectedOutput: { quantityBase: 12, sku: 'SKU-001', status: 'NEW' },
          name: 'ERP order mapping',
          rules: [
            { source: 'externalSku', target: 'sku' },
            { factor: 6, source: 'caseQuantity', target: 'quantityBase' },
            { default: 'NEW', source: 'missingStatus', target: 'status' },
          ],
          sampleInput: { caseQuantity: 2, externalSku: 'SKU-001' },
          sourceSystem: 'ERP',
          targetObject: 'Order',
        },
        actor,
        command(),
      );
      await expect(
        service.publishMapping(
          mapping.mappingVersionId,
          { expectedVersion: 1 },
          actor,
          command(),
        ),
      ).rejects.toMatchObject({
        code: 'MAPPING_TRANSITION_INVALID',
        statusCode: 409,
      });
      const tested = await service.testMapping(
        mapping.mappingVersionId,
        { expectedVersion: 1 },
        actor,
        command(),
      );
      expect(tested).toMatchObject({
        passed: true,
        status: 'TESTED',
        version: 2,
      });
      const published = await service.publishMapping(
        mapping.mappingVersionId,
        { expectedVersion: 2 },
        actor,
        command(),
      );
      expect(published).toMatchObject({
        status: 'PUBLISHED',
        version: 3,
        versionNumber: 1,
      });
      const transformed = await service.transform(
        mapping.definitionId,
        { payload: { caseQuantity: 3, externalSku: 'SKU-009' } },
        actor,
        command(),
      );
      expect(transformed).toMatchObject({
        mappingVersionId: mapping.mappingVersionId,
        output: { quantityBase: 18, sku: 'SKU-009', status: 'NEW' },
        success: true,
      });
      const v2 = await service.createMappingVersion(
        mapping.definitionId,
        {
          expectedOutput: { quantityBase: 10, sku: 'SKU-002' },
          rules: [
            { source: 'externalSku', target: 'sku' },
            { factor: 10, source: 'caseQuantity', target: 'quantityBase' },
          ],
          sampleInput: { caseQuantity: 1, externalSku: 'SKU-002' },
        },
        actor,
        command(),
      );
      expect(v2.versionNumber).toBe(2);
      await service.testMapping(
        v2.mappingVersionId,
        { expectedVersion: 1 },
        actor,
        command(),
      );
      await service.publishMapping(
        v2.mappingVersionId,
        { expectedVersion: 2 },
        actor,
        command(),
      );
      await expect(
        service.transform(
          mapping.definitionId,
          { payload: { caseQuantity: 2, externalSku: 'SKU-010' } },
          actor,
          command(),
        ),
      ).resolves.toMatchObject({
        mappingVersionId: v2.mappingVersionId,
        output: { quantityBase: 20, sku: 'SKU-010' },
      });
      await expect(
        prisma.integrationMappingVersion.update({
          data: { rules: [] },
          where: { id: mapping.mappingVersionId },
        }),
      ).rejects.toBeDefined();
      await expect(
        prisma.integrationTransformResult.update({
          data: { success: false },
          where: { id: transformed.transformResultId },
        }),
      ).rejects.toBeDefined();
    });

    it('signs webhook attempts, backs off to dead letter and replays without changing the original message', async () => {
      const actor = context();
      const subscription = await service.createWebhook(
        {
          baseDelaySeconds: 1,
          endpointUrl: 'https://partner.example.test/hooks/scm',
          eventTypes: ['order.released.v1'],
          maxAttempts: 2,
          name: 'Partner order webhook',
          objectScopes: ['CUSTOMER-1'],
        },
        actor,
        command(),
      );
      expect(subscription.secret).toMatch(/^scmw_/);
      const queued = await service.publishWebhookEvent(
        {
          businessRef: 'SO-1001',
          eventType: 'order.released.v1',
          objectScope: 'CUSTOMER-1',
          payload: { orderId: randomUUID(), version: 2 },
        },
        actor,
        command(),
      );
      expect(queued).toMatchObject({ deliveryCount: 1, status: 'PROCESSING' });
      const first = await prisma.integrationDeliveryAttempt.findFirstOrThrow({
        where: { messageId: queued.messageId },
      });
      expect(first.signature).toHaveLength(64);
      const retry = await service.completeDelivery(
        first.id,
        { errorMessage: 'Partner timeout', expectedVersion: 1 },
        actor,
        command(),
      );
      expect(retry).toMatchObject({ status: 'FAILED' });
      const second = await prisma.integrationDeliveryAttempt.findUniqueOrThrow({
        where: { id: retry.nextAttemptId! },
      });
      expect(second.attemptNumber).toBe(2);
      expect(second.availableAt.getTime()).toBeGreaterThan(
        first.availableAt.getTime(),
      );
      const dead = await service.completeDelivery(
        second.id,
        {
          errorMessage: 'Partner unavailable',
          expectedVersion: 1,
          responseStatus: 503,
        },
        actor,
        command(),
      );
      expect(dead.status).toBe('DEAD_LETTER');
      const original = await prisma.integrationMessage.findUniqueOrThrow({
        where: { id: queued.messageId },
      });
      expect(original.status).toBe('DEAD_LETTER');
      const replay = await service.replayMessage(
        queued.messageId,
        {
          expectedVersion: original.version,
          reason: 'Partner endpoint recovered',
        },
        actor,
        command(),
      );
      expect(replay).toMatchObject({
        originalMessageId: queued.messageId,
        status: 'PROCESSING',
      });
      const originalAfter = await prisma.integrationMessage.findUniqueOrThrow({
        where: { id: queued.messageId },
      });
      expect(originalAfter.originalPayload).toEqual(original.originalPayload);
      expect(originalAfter.status).toBe('DEAD_LETTER');
      await expect(
        prisma.integrationReplayRecord.update({
          data: { reason: 'TAMPERED' },
          where: { id: replay.replayRecordId },
        }),
      ).rejects.toBeDefined();
      await expect(
        service.disableWebhook(
          subscription.subscriptionId,
          { expectedVersion: 1 },
          actor,
          command(),
        ),
      ).resolves.toMatchObject({ status: 'DISABLED', version: 2 });
    });

    it('finishes successful deliveries and keeps every monitor view tenant isolated', async () => {
      const tenantA = context();
      const tenantB = context();
      const subscription = await service.createWebhook(
        {
          endpointUrl: 'https://customer.example.test/webhook',
          eventTypes: ['shipment.delivered.v1'],
          name: 'Customer delivery webhook',
        },
        tenantA,
        command(),
      );
      const queued = await service.publishWebhookEvent(
        {
          eventType: 'shipment.delivered.v1',
          payload: { shipmentNo: 'SHP-1' },
        },
        tenantA,
        command(),
      );
      const [claim, racedClaim] = await Promise.all([
        service.claimDeliveries(
          { leaseOwner: 'worker-a', leaseSeconds: 60, limit: 10 },
          tenantA,
        ),
        service.claimDeliveries(
          { leaseOwner: 'worker-b', leaseSeconds: 60, limit: 10 },
          tenantA,
        ),
      ]);
      const winner = claim.deliveries.length === 1 ? claim : racedClaim;
      const loser = claim.deliveries.length === 0 ? claim : racedClaim;
      expect(winner.deliveries).toHaveLength(1);
      expect(loser.deliveries).toHaveLength(0);
      const attempt = winner.deliveries[0]!;
      await expect(
        service.completeDelivery(
          attempt.attemptId,
          {
            expectedVersion: attempt.version,
            leaseOwner: winner.leaseOwner,
            responseBody: 'ok',
            responseStatus: 204,
          },
          tenantA,
          command(),
        ),
      ).resolves.toMatchObject({ status: 'DELIVERED' });
      expect(
        await prisma.integrationMessage.findUnique({
          where: { id: queued.messageId },
        }),
      ).toMatchObject({ status: 'PROCESSED' });
      const viewA = await service.workbench(tenantA);
      const viewB = await service.workbench(tenantB);
      expect(viewA.subscriptions).toContainEqual(
        expect.objectContaining({ id: subscription.subscriptionId }),
      );
      expect(viewB.subscriptions).not.toContainEqual(
        expect.objectContaining({ id: subscription.subscriptionId }),
      );
      expect(JSON.stringify(viewA)).not.toContain('secretHash');
    });
  },
);

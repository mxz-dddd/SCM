import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../database/prisma.service';
import { ChangeRecordingFacade } from '../platform/public/change-recording.facade';
import type { CommandMetadata } from '../platform/tenant.service';

type JsonObject = Readonly<Record<string, unknown>>;
type MappingRule = Readonly<{
  default?: unknown;
  dictionary?: Readonly<Record<string, unknown>>;
  factor?: number;
  source: string;
  target: string;
}>;
interface ClaimedDeliveryRow {
  readonly attempt_number: number;
  readonly endpoint_url: string;
  readonly id: string;
  readonly message_id: string;
  readonly original_payload: Prisma.JsonValue;
  readonly signature: string;
  readonly version: number;
}

export interface ReceiveFileInput {
  readonly businessRef?: string;
  readonly channel: 'EDI' | 'SFTP';
  readonly directory: string;
  readonly encryption: 'NONE' | 'PGP';
  readonly fileName: string;
  readonly format: 'CSV' | 'EDIFACT' | 'JSON' | 'X12' | 'XML';
  readonly lines: readonly Readonly<{
    businessRef?: string;
    payload: JsonObject;
  }>[];
  readonly objectRef: string;
  readonly partnerRef: string;
}

export interface CompleteFileInput {
  readonly expectedVersion: number;
  readonly results: readonly Readonly<{
    errorCode?: string;
    errorMessage?: string;
    lineNumber: number;
    output?: JsonObject;
    success: boolean;
  }>[];
}

export interface SaveMappingInput {
  readonly code: string;
  readonly expectedOutput: JsonObject;
  readonly name: string;
  readonly rules: readonly MappingRule[];
  readonly sampleInput: JsonObject;
  readonly sourceSystem: string;
  readonly targetObject: string;
}

export interface SaveMappingVersionInput {
  readonly expectedOutput: JsonObject;
  readonly rules: readonly MappingRule[];
  readonly sampleInput: JsonObject;
}

export interface CreateWebhookInput {
  readonly baseDelaySeconds?: number;
  readonly endpointUrl: string;
  readonly eventTypes: readonly string[];
  readonly maxAttempts?: number;
  readonly name: string;
  readonly objectScopes?: readonly string[];
}

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
};
const digest = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const array = (value: Prisma.JsonValue): string[] =>
  Array.isArray(value) ? value.map(String) : [];
const object = (value: Prisma.JsonValue): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};

@Injectable()
export class MessageExchangeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChangeRecordingFacade)
    private readonly changes: ChangeRecordingFacade,
  ) {}

  async workbench(context: TenantContext) {
    const where = { tenantId: context.tenantId };
    const [
      files,
      acknowledgements,
      subscriptions,
      deliveries,
      mappings,
      versions,
      transforms,
      messages,
      replays,
    ] = await Promise.all([
      this.prisma.integrationFileExchange.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where,
      }),
      this.prisma.integrationAckMessage.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where,
      }),
      this.prisma.integrationWebhookSubscription.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          baseDelaySeconds: true,
          createdAt: true,
          disabledAt: true,
          endpointUrl: true,
          eventTypes: true,
          id: true,
          maxAttempts: true,
          name: true,
          objectScopes: true,
          status: true,
          version: true,
        },
        where,
      }),
      this.prisma.integrationDeliveryAttempt.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where,
      }),
      this.prisma.integrationMappingDefinition.findMany({
        orderBy: { updatedAt: 'desc' },
        where,
      }),
      this.prisma.integrationMappingVersion.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where,
      }),
      this.prisma.integrationTransformResult.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where,
      }),
      this.prisma.integrationMessage.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        where,
      }),
      this.prisma.integrationReplayRecord.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where,
      }),
    ]);
    return {
      acknowledgements,
      deliveries,
      files,
      mappings,
      messages,
      replays,
      subscriptions,
      transforms,
      versions,
    };
  }

  receiveFile(
    input: ReceiveFileInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.fileInput(input);
    const contentDigest = digest(input.lines.map(({ payload }) => payload));
    return this.prisma.$transaction(async (tx) => {
      await this.lock(
        tx,
        `${context.tenantId}:file:${input.partnerRef}:${contentDigest}`,
      );
      const existing = await tx.integrationFileExchange.findUnique({
        where: {
          tenantId_partnerRef_contentDigest: {
            contentDigest,
            partnerRef: input.partnerRef.trim(),
            tenantId: context.tenantId,
          },
        },
      });
      if (existing)
        return {
          duplicate: true,
          fileExchangeId: existing.id,
          status: existing.status,
          version: existing.version,
        };
      const file = await tx.integrationFileExchange.create({
        data: {
          ...(input.businessRef
            ? { businessRef: input.businessRef.trim() }
            : {}),
          channel: input.channel,
          contentDigest,
          createdBy: context.accountId,
          direction: 'INBOUND',
          directory: input.directory.trim(),
          encryption: input.encryption,
          fileName: input.fileName.trim(),
          format: input.format,
          lineCount: input.lines.length,
          objectRef: input.objectRef.trim(),
          partnerRef: input.partnerRef.trim(),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await tx.integrationFileLine.createMany({
        data: input.lines.map((line, index) => ({
          ...(line.businessRef ? { businessRef: line.businessRef.trim() } : {}),
          createdBy: context.accountId,
          fileExchangeId: file.id,
          lineNumber: index + 1,
          sourcePayload: json(line.payload),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        })),
      });
      const message = await tx.integrationMessage.create({
        data: {
          ...(input.businessRef
            ? { businessRef: input.businessRef.trim() }
            : {}),
          channel: input.channel,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          direction: 'INBOUND',
          messageType: `FILE.${input.format}`,
          originalPayload: json(input),
          sourceRef: file.id,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        file.id,
        1,
        'integration.file-received.v1',
        context,
        metadata,
        {
          contentDigest,
          messageId: message.id,
          partnerRef: input.partnerRef,
        },
      );
      return {
        duplicate: false,
        fileExchangeId: file.id,
        messageId: message.id,
        status: file.status,
        version: file.version,
      };
    });
  }

  completeFile(
    id: string,
    input: CompleteFileInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const file = await tx.integrationFileExchange.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!file) this.notFound('FILE_EXCHANGE_NOT_FOUND', 'File exchange');
      this.version(
        file.version,
        input.expectedVersion,
        'FILE_EXCHANGE_VERSION_CONFLICT',
      );
      if (file.status !== 'RECEIVED')
        this.transition('FILE_EXCHANGE_TRANSITION_INVALID', file.status);
      const lines = await tx.integrationFileLine.findMany({
        orderBy: { lineNumber: 'asc' },
        where: { fileExchangeId: id, tenantId: context.tenantId },
      });
      if (
        input.results.length !== lines.length ||
        new Set(input.results.map(({ lineNumber }) => lineNumber)).size !==
          lines.length
      )
        this.invalid('Every file line must have exactly one result');
      let processedCount = 0;
      let rejectedCount = 0;
      for (const result of input.results) {
        const line = lines.find(
          ({ lineNumber }) => lineNumber === result.lineNumber,
        );
        if (!line) this.invalid('File result lineNumber is invalid');
        if (result.success) processedCount += 1;
        else {
          rejectedCount += 1;
          if (!result.errorCode?.trim() || !result.errorMessage?.trim())
            this.invalid('Rejected lines require errorCode and errorMessage');
        }
        await tx.integrationFileLine.update({
          data: {
            ...(result.errorCode ? { errorCode: result.errorCode.trim() } : {}),
            ...(result.errorMessage
              ? { errorMessage: result.errorMessage.trim() }
              : {}),
            ...(result.output ? { resultPayload: json(result.output) } : {}),
            status: result.success ? 'PROCESSED' : 'REJECTED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: line.id },
        });
      }
      const outcome =
        rejectedCount === 0
          ? 'PROCESSED'
          : processedCount === 0
            ? 'FAILED'
            : 'PARTIAL';
      const ack = await tx.integrationAckMessage.create({
        data: {
          ackType: 'PROCESSING_RESULT',
          createdBy: context.accountId,
          fileExchangeId: id,
          payload: json({
            contentDigest: file.contentDigest,
            outcome,
            processedCount,
            rejectedCount,
          }),
          sentAt: new Date(),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const changed = await tx.integrationFileExchange.update({
        data: {
          acknowledgedAt: new Date(),
          processedCount,
          rejectedCount,
          status: 'ACKNOWLEDGED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await tx.integrationMessage.updateMany({
        data: {
          attemptCount: { increment: 1 },
          completedAt: new Date(),
          processedPayload: json({ outcome, processedCount, rejectedCount }),
          status: outcome === 'FAILED' ? 'FAILED' : 'PROCESSED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { sourceRef: id, tenantId: context.tenantId },
      });
      await this.record(
        tx,
        id,
        changed.version,
        'integration.file-acknowledged.v1',
        context,
        metadata,
        { ackMessageId: ack.id, outcome },
      );
      return {
        ackMessageId: ack.id,
        fileExchangeId: id,
        outcome,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  archiveFile(
    id: string,
    input: { readonly expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const file = await tx.integrationFileExchange.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!file) this.notFound('FILE_EXCHANGE_NOT_FOUND', 'File exchange');
      this.version(
        file.version,
        input.expectedVersion,
        'FILE_EXCHANGE_VERSION_CONFLICT',
      );
      if (file.status !== 'ACKNOWLEDGED')
        this.transition('FILE_EXCHANGE_TRANSITION_INVALID', file.status);
      const changed = await tx.integrationFileExchange.update({
        data: {
          archivedAt: new Date(),
          status: 'ARCHIVED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        changed.version,
        'integration.file-archived.v1',
        context,
        metadata,
        { status: changed.status },
      );
      return {
        fileExchangeId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  createMapping(
    input: SaveMappingInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.mappingInput(input);
    return this.prisma.$transaction(async (tx) => {
      const definition = await tx.integrationMappingDefinition.create({
        data: {
          code: input.code.trim().toUpperCase(),
          createdBy: context.accountId,
          name: input.name.trim(),
          sourceSystem: input.sourceSystem.trim().toUpperCase(),
          targetObject: input.targetObject.trim(),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const version = await tx.integrationMappingVersion.create({
        data: {
          createdBy: context.accountId,
          definitionId: definition.id,
          expectedOutput: json(input.expectedOutput),
          rules: json(input.rules),
          sampleInput: json(input.sampleInput),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          versionNumber: 1,
        },
      });
      await this.record(
        tx,
        definition.id,
        1,
        'integration.mapping-created.v1',
        context,
        metadata,
        { mappingVersionId: version.id },
      );
      return {
        definitionId: definition.id,
        mappingVersionId: version.id,
        status: version.status,
        version: version.version,
        versionNumber: 1,
      };
    });
  }

  createMappingVersion(
    definitionId: string,
    input: SaveMappingVersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      input.rules.length === 0 ||
      input.rules.some(
        ({ source, target }) => !source?.trim() || !target?.trim(),
      )
    )
      this.invalid('Mapping rules are required');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:mapping:${definitionId}`);
      const definition = await tx.integrationMappingDefinition.findFirst({
        where: { id: definitionId, tenantId: context.tenantId },
      });
      if (!definition)
        this.notFound('MAPPING_DEFINITION_NOT_FOUND', 'Mapping definition');
      const latest = await tx.integrationMappingVersion.findFirst({
        orderBy: { versionNumber: 'desc' },
        where: { definitionId, tenantId: context.tenantId },
      });
      const version = await tx.integrationMappingVersion.create({
        data: {
          createdBy: context.accountId,
          definitionId,
          expectedOutput: json(input.expectedOutput),
          rules: json(input.rules),
          sampleInput: json(input.sampleInput),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
        },
      });
      await this.record(
        tx,
        definitionId,
        definition.version,
        'integration.mapping-version-created.v1',
        context,
        metadata,
        { mappingVersionId: version.id, versionNumber: version.versionNumber },
      );
      return {
        definitionId,
        mappingVersionId: version.id,
        status: version.status,
        version: version.version,
        versionNumber: version.versionNumber,
      };
    });
  }

  testMapping(
    id: string,
    input: { readonly expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.integrationMappingVersion.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!version)
        this.notFound('MAPPING_VERSION_NOT_FOUND', 'Mapping version');
      this.version(
        version.version,
        input.expectedVersion,
        'MAPPING_VERSION_CONFLICT',
      );
      if (version.status !== 'DRAFT')
        this.transition('MAPPING_TRANSITION_INVALID', version.status);
      const output = this.applyRules(
        object(version.sampleInput),
        version.rules,
      );
      const passed = digest(output) === digest(version.expectedOutput);
      const changed = await tx.integrationMappingVersion.update({
        data: {
          status: passed ? 'TESTED' : 'DRAFT',
          testResult: json({ output, passed }),
          testedAt: new Date(),
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        version.definitionId,
        changed.version,
        'integration.mapping-tested.v1',
        context,
        metadata,
        { mappingVersionId: id, passed },
      );
      return {
        mappingVersionId: id,
        output,
        passed,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  publishMapping(
    id: string,
    input: { readonly expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.integrationMappingVersion.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!version)
        this.notFound('MAPPING_VERSION_NOT_FOUND', 'Mapping version');
      this.version(
        version.version,
        input.expectedVersion,
        'MAPPING_VERSION_CONFLICT',
      );
      if (version.status !== 'TESTED')
        this.transition('MAPPING_TRANSITION_INVALID', version.status);
      await tx.integrationMappingVersion.updateMany({
        data: {
          status: 'RETIRED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          definitionId: version.definitionId,
          status: 'PUBLISHED',
          tenantId: context.tenantId,
        },
      });
      const changed = await tx.integrationMappingVersion.update({
        data: {
          publishedAt: new Date(),
          status: 'PUBLISHED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await tx.integrationMappingDefinition.update({
        data: {
          activeVersionNumber: changed.versionNumber,
          status: 'PUBLISHED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: version.definitionId },
      });
      await this.record(
        tx,
        version.definitionId,
        changed.version,
        'integration.mapping-published.v1',
        context,
        metadata,
        { mappingVersionId: id, versionNumber: changed.versionNumber },
      );
      return {
        definitionId: version.definitionId,
        mappingVersionId: id,
        status: changed.status,
        version: changed.version,
        versionNumber: changed.versionNumber,
      };
    });
  }

  transform(
    definitionId: string,
    input: { readonly messageId?: string; readonly payload: JsonObject },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const definition = await tx.integrationMappingDefinition.findFirst({
        where: {
          id: definitionId,
          status: 'PUBLISHED',
          tenantId: context.tenantId,
        },
      });
      if (!definition?.activeVersionNumber)
        this.notFound('PUBLISHED_MAPPING_NOT_FOUND', 'Published mapping');
      const version = await tx.integrationMappingVersion.findUniqueOrThrow({
        where: {
          tenantId_definitionId_versionNumber: {
            definitionId,
            tenantId: context.tenantId,
            versionNumber: definition.activeVersionNumber,
          },
        },
      });
      const output = this.applyRules(input.payload, version.rules);
      const result = await tx.integrationTransformResult.create({
        data: {
          createdBy: context.accountId,
          mappingVersionId: version.id,
          ...(input.messageId ? { messageId: input.messageId } : {}),
          outputPayload: json(output),
          sourcePayload: json(input.payload),
          success: true,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      if (input.messageId)
        await tx.integrationMessage.updateMany({
          data: {
            mappingVersionId: version.id,
            processedPayload: json(output),
            status: 'PROCESSED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: input.messageId, tenantId: context.tenantId },
        });
      await this.record(
        tx,
        definitionId,
        version.version,
        'integration.message-transformed.v1',
        context,
        metadata,
        { mappingVersionId: version.id, transformResultId: result.id },
      );
      return {
        mappingVersionId: version.id,
        output,
        success: true,
        transformResultId: result.id,
      };
    });
  }

  createWebhook(
    input: CreateWebhookInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.webhookInput(input);
    return this.prisma.$transaction(async (tx) => {
      const id = randomUUID();
      const secret = this.webhookSecret(context.tenantId, id);
      const subscription = await tx.integrationWebhookSubscription.create({
        data: {
          baseDelaySeconds: input.baseDelaySeconds ?? 30,
          createdBy: context.accountId,
          endpointUrl: input.endpointUrl.trim(),
          eventTypes: json([...new Set(input.eventTypes)]),
          id,
          maxAttempts: input.maxAttempts ?? 5,
          name: input.name.trim(),
          objectScopes: json([...new Set(input.objectScopes ?? [])]),
          secretHash: digest(secret),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        id,
        1,
        'integration.webhook-subscribed.v1',
        context,
        metadata,
        { endpointUrl: subscription.endpointUrl },
      );
      return {
        secret,
        status: subscription.status,
        subscriptionId: id,
        version: 1,
      };
    });
  }

  disableWebhook(
    id: string,
    input: { readonly expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.integrationWebhookSubscription.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!row)
        this.notFound('WEBHOOK_SUBSCRIPTION_NOT_FOUND', 'Webhook subscription');
      this.version(
        row.version,
        input.expectedVersion,
        'WEBHOOK_VERSION_CONFLICT',
      );
      if (row.status !== 'ACTIVE')
        this.transition('WEBHOOK_TRANSITION_INVALID', row.status);
      const changed = await tx.integrationWebhookSubscription.update({
        data: {
          disabledAt: new Date(),
          status: 'DISABLED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        changed.version,
        'integration.webhook-disabled.v1',
        context,
        metadata,
        { status: changed.status },
      );
      return {
        status: changed.status,
        subscriptionId: id,
        version: changed.version,
      };
    });
  }

  publishWebhookEvent(
    input: {
      readonly businessRef?: string;
      readonly eventType: string;
      readonly objectScope?: string;
      readonly payload: JsonObject;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const subscriptions = (
        await tx.integrationWebhookSubscription.findMany({
          where: { status: 'ACTIVE', tenantId: context.tenantId },
        })
      ).filter(
        (row) =>
          array(row.eventTypes).includes(input.eventType) &&
          (array(row.objectScopes).length === 0 ||
            (input.objectScope
              ? array(row.objectScopes).includes(input.objectScope)
              : false)),
      );
      const message = await tx.integrationMessage.create({
        data: {
          ...(input.businessRef
            ? { businessRef: input.businessRef.trim() }
            : {}),
          channel: 'WEBHOOK',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          direction: 'OUTBOUND',
          messageType: input.eventType,
          originalPayload: json(input.payload),
          status: subscriptions.length === 0 ? 'PROCESSED' : 'PROCESSING',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      for (const subscription of subscriptions) {
        const signature = this.signature(
          subscription.tenantId,
          subscription.id,
          message.id,
          input.payload,
        );
        await tx.integrationDeliveryAttempt.create({
          data: {
            attemptNumber: 1,
            createdBy: context.accountId,
            messageId: message.id,
            signature,
            subscriptionId: subscription.id,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      }
      await this.record(
        tx,
        message.id,
        1,
        'integration.webhook-event-queued.v1',
        context,
        metadata,
        { deliveryCount: subscriptions.length, eventType: input.eventType },
      );
      return {
        deliveryCount: subscriptions.length,
        messageId: message.id,
        status: message.status,
      };
    });
  }

  claimDeliveries(
    input: {
      readonly leaseOwner: string;
      readonly leaseSeconds?: number;
      readonly limit?: number;
    },
    context: TenantContext,
  ) {
    const leaseOwner = this.text(input.leaseOwner, 'leaseOwner', 200);
    const leaseSeconds = input.leaseSeconds ?? 60;
    const limit = input.limit ?? 20;
    if (
      !Number.isInteger(leaseSeconds) ||
      leaseSeconds < 10 ||
      leaseSeconds > 3600 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      this.invalid('Delivery lease input is invalid');
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimedDeliveryRow[]>`
        WITH candidates AS (
          SELECT attempt.id
          FROM "integration"."delivery_attempt" attempt
          WHERE attempt.tenant_id = ${context.tenantId}::uuid
            AND attempt.available_at <= CURRENT_TIMESTAMP
            AND (
              attempt.status = 'PENDING'
              OR (attempt.status = 'PROCESSING' AND attempt.lease_expires_at <= CURRENT_TIMESTAMP)
            )
          ORDER BY attempt.available_at ASC, attempt.created_at ASC, attempt.id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE "integration"."delivery_attempt" target
        SET status = 'PROCESSING',
            lease_owner = ${leaseOwner},
            lease_expires_at = CURRENT_TIMESTAMP + make_interval(secs => ${leaseSeconds}),
            updated_at = CURRENT_TIMESTAMP,
            updated_by = ${context.accountId}::uuid,
            version = target.version + 1
        FROM candidates,
             "integration"."webhook_subscription" subscription,
             "integration"."integration_message" message
        WHERE target.id = candidates.id
          AND subscription.id = target.subscription_id
          AND subscription.tenant_id = target.tenant_id
          AND subscription.status = 'ACTIVE'
          AND message.id = target.message_id
          AND message.tenant_id = target.tenant_id
        RETURNING target.id,
          target.message_id,
          target.attempt_number,
          target.signature,
          target.version,
          subscription.endpoint_url,
          message.original_payload
      `;
      return {
        deliveries: rows.map((row) => ({
          attemptId: row.id,
          attemptNumber: row.attempt_number,
          endpointUrl: row.endpoint_url,
          messageId: row.message_id,
          payload: row.original_payload,
          signature: row.signature,
          version: row.version,
        })),
        leaseOwner,
      };
    });
  }

  completeDelivery(
    id: string,
    input: {
      readonly errorMessage?: string;
      readonly expectedVersion: number;
      readonly leaseOwner?: string;
      readonly responseBody?: string;
      readonly responseStatus?: number;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.integrationDeliveryAttempt.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!attempt)
        this.notFound('DELIVERY_ATTEMPT_NOT_FOUND', 'Delivery attempt');
      this.version(
        attempt.version,
        input.expectedVersion,
        'DELIVERY_VERSION_CONFLICT',
      );
      if (attempt.status !== 'PENDING' && attempt.status !== 'PROCESSING')
        this.transition('DELIVERY_TRANSITION_INVALID', attempt.status);
      if (
        attempt.status === 'PROCESSING' &&
        (!input.leaseOwner ||
          input.leaseOwner !== attempt.leaseOwner ||
          !attempt.leaseExpiresAt ||
          attempt.leaseExpiresAt <= new Date())
      )
        throw new AppError(
          'DELIVERY_LEASE_LOST',
          'Webhook delivery lease is stale or owned by another worker',
          409,
          { retryable: true },
        );
      const subscription =
        await tx.integrationWebhookSubscription.findFirstOrThrow({
          where: { id: attempt.subscriptionId, tenantId: context.tenantId },
        });
      const success = Boolean(
        input.responseStatus &&
        input.responseStatus >= 200 &&
        input.responseStatus < 300,
      );
      if (success) {
        const changed = await tx.integrationDeliveryAttempt.update({
          data: {
            deliveredAt: new Date(),
            leaseExpiresAt: null,
            leaseOwner: null,
            responseDigest: digest(input.responseBody ?? ''),
            responseStatus: input.responseStatus!,
            status: 'DELIVERED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id },
        });
        const pending = await tx.integrationDeliveryAttempt.count({
          where: {
            messageId: attempt.messageId,
            status: { in: ['PENDING', 'PROCESSING', 'RETRY_WAIT'] },
            tenantId: context.tenantId,
          },
        });
        if (pending === 0)
          await tx.integrationMessage.update({
            data: {
              attemptCount: attempt.attemptNumber,
              completedAt: new Date(),
              durationMs: Math.max(0, Date.now() - attempt.createdAt.getTime()),
              status: 'PROCESSED',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: attempt.messageId },
          });
        return {
          attemptId: id,
          status: changed.status,
          version: changed.version,
        };
      }
      if (attempt.attemptNumber >= subscription.maxAttempts) {
        const changed = await tx.integrationDeliveryAttempt.update({
          data: {
            errorMessage:
              input.errorMessage?.trim() ?? 'Webhook delivery failed',
            leaseExpiresAt: null,
            leaseOwner: null,
            responseStatus: input.responseStatus ?? null,
            status: 'DEAD_LETTER',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id },
        });
        await tx.integrationMessage.update({
          data: {
            attemptCount: attempt.attemptNumber,
            errorCode: 'WEBHOOK_DELIVERY_DEAD_LETTER',
            errorMessage: changed.errorMessage,
            status: 'DEAD_LETTER',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: attempt.messageId },
        });
        await this.record(
          tx,
          attempt.messageId,
          changed.version,
          'integration.webhook-dead-lettered.v1',
          context,
          metadata,
          { attemptId: id },
        );
        return {
          attemptId: id,
          status: changed.status,
          version: changed.version,
        };
      }
      const availableAt = new Date(
        Date.now() +
          subscription.baseDelaySeconds *
            2 ** (attempt.attemptNumber - 1) *
            1000,
      );
      const changed = await tx.integrationDeliveryAttempt.update({
        data: {
          errorMessage: input.errorMessage?.trim() ?? 'Webhook delivery failed',
          leaseExpiresAt: null,
          leaseOwner: null,
          responseStatus: input.responseStatus ?? null,
          status: 'FAILED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      const next = await tx.integrationDeliveryAttempt.create({
        data: {
          attemptNumber: attempt.attemptNumber + 1,
          availableAt,
          createdBy: context.accountId,
          messageId: attempt.messageId,
          signature: attempt.signature,
          subscriptionId: attempt.subscriptionId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await tx.integrationMessage.update({
        data: {
          attemptCount: attempt.attemptNumber,
          errorCode: 'WEBHOOK_DELIVERY_RETRY',
          errorMessage: changed.errorMessage,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: attempt.messageId },
      });
      return {
        attemptId: id,
        nextAttemptId: next.id,
        nextAvailableAt: availableAt,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  replayMessage(
    id: string,
    input: {
      readonly expectedVersion: number;
      readonly mappingVersionId?: string;
      readonly reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.integrationMessage.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!original)
        this.notFound('INTEGRATION_MESSAGE_NOT_FOUND', 'Integration message');
      this.version(
        original.version,
        input.expectedVersion,
        'INTEGRATION_MESSAGE_VERSION_CONFLICT',
      );
      if (!['FAILED', 'DEAD_LETTER'].includes(original.status))
        this.transition('INTEGRATION_MESSAGE_REPLAY_INVALID', original.status);
      const reason = this.text(input.reason, 'reason', 1000);
      if (input.mappingVersionId) {
        const mapping = await tx.integrationMappingVersion.findFirst({
          where: {
            id: input.mappingVersionId,
            status: 'PUBLISHED',
            tenantId: context.tenantId,
          },
        });
        if (!mapping)
          this.notFound('PUBLISHED_MAPPING_NOT_FOUND', 'Published mapping');
      }
      const replay = await tx.integrationMessage.create({
        data: {
          ...(original.businessRef
            ? { businessRef: original.businessRef }
            : {}),
          channel: original.channel,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          direction: original.direction,
          ...(input.mappingVersionId
            ? { mappingVersionId: input.mappingVersionId }
            : {}),
          messageType: original.messageType,
          originalPayload: json(original.originalPayload),
          replayOfMessageId: original.id,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      if (original.channel === 'WEBHOOK') {
        const previous = await tx.integrationDeliveryAttempt.findMany({
          distinct: ['subscriptionId'],
          where: { messageId: original.id, tenantId: context.tenantId },
        });
        const active = await tx.integrationWebhookSubscription.findMany({
          where: {
            id: { in: previous.map(({ subscriptionId }) => subscriptionId) },
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        });
        for (const subscription of active)
          await tx.integrationDeliveryAttempt.create({
            data: {
              attemptNumber: 1,
              createdBy: context.accountId,
              messageId: replay.id,
              signature: this.signature(
                context.tenantId,
                subscription.id,
                replay.id,
                object(original.originalPayload),
              ),
              subscriptionId: subscription.id,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
        if (active.length > 0)
          await tx.integrationMessage.update({
            data: {
              status: 'PROCESSING',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: replay.id },
          });
      }
      const record = await tx.integrationReplayRecord.create({
        data: {
          createdBy: context.accountId,
          ...(input.mappingVersionId
            ? { mappingVersionId: input.mappingVersionId }
            : {}),
          originalMessageId: original.id,
          reason,
          replayMessageId: replay.id,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        original.id,
        original.version,
        'integration.message-replayed.v1',
        context,
        metadata,
        { replayMessageId: replay.id, replayRecordId: record.id },
      );
      return {
        originalMessageId: original.id,
        replayMessageId: replay.id,
        replayRecordId: record.id,
        status: original.channel === 'WEBHOOK' ? 'PROCESSING' : replay.status,
      };
    });
  }

  private applyRules(
    source: JsonObject,
    rulesValue: Prisma.JsonValue,
  ): JsonObject {
    if (!Array.isArray(rulesValue)) this.invalid('Mapping rules are invalid');
    const output: Record<string, unknown> = {};
    for (const value of rulesValue) {
      const rule = value as MappingRule;
      if (!rule.source || !rule.target)
        this.invalid('Mapping rule source and target are required');
      let mapped = source[rule.source] ?? rule.default;
      if (rule.dictionary && mapped !== undefined)
        mapped = rule.dictionary[String(mapped)] ?? mapped;
      if (rule.factor !== undefined && mapped !== undefined) {
        const number = Number(mapped);
        if (!Number.isFinite(number))
          this.invalid(`Mapping source ${rule.source} is not numeric`);
        mapped = number * rule.factor;
      }
      if (mapped !== undefined) output[rule.target] = mapped;
    }
    return output;
  }

  private fileInput(input: ReceiveFileInput): void {
    this.text(input.partnerRef, 'partnerRef', 200);
    this.text(input.fileName, 'fileName', 255);
    this.text(input.directory, 'directory', 500);
    this.text(input.objectRef, 'objectRef', 500);
    if (input.lines.length === 0 || input.lines.length > 10_000)
      this.invalid('File lines must contain 1 to 10000 items');
    if (input.channel === 'SFTP' && !input.directory.startsWith('/'))
      this.invalid('SFTP directory must be absolute');
    if (input.encryption === 'PGP' && !input.fileName.endsWith('.pgp'))
      this.invalid('PGP files must use the .pgp suffix');
  }

  private mappingInput(input: SaveMappingInput): void {
    this.text(input.code, 'code', 100);
    this.text(input.name, 'name', 200);
    this.text(input.sourceSystem, 'sourceSystem', 100);
    this.text(input.targetObject, 'targetObject', 100);
    if (
      input.rules.length === 0 ||
      input.rules.some(
        ({ source, target }) => !source?.trim() || !target?.trim(),
      )
    )
      this.invalid('Mapping rules are required');
  }

  private webhookInput(input: CreateWebhookInput): void {
    this.text(input.name, 'name', 200);
    try {
      if (new URL(input.endpointUrl).protocol !== 'https:') throw new Error();
    } catch {
      this.invalid('Webhook endpoint must be a valid HTTPS URL');
    }
    if (
      input.eventTypes.length === 0 ||
      input.eventTypes.some((value) => !value.trim())
    )
      this.invalid('Webhook eventTypes are required');
    const max = input.maxAttempts ?? 5;
    const delay = input.baseDelaySeconds ?? 30;
    if (
      !Number.isInteger(max) ||
      max < 1 ||
      max > 20 ||
      !Number.isInteger(delay) ||
      delay < 1 ||
      delay > 86_400
    )
      this.invalid('Webhook retry policy is invalid');
  }

  private webhookSecret(tenantId: string, subscriptionId: string): string {
    const master = process.env.API_CREDENTIAL_MASTER_KEY ?? '';
    if (master.length < 32)
      throw new AppError(
        'WEBHOOK_MASTER_KEY_INVALID',
        'API_CREDENTIAL_MASTER_KEY must contain at least 32 characters',
        500,
      );
    return `scmw_${createHmac('sha256', master).update(`${tenantId}:${subscriptionId}:webhook`).digest('base64url')}`;
  }

  private signature(
    tenantId: string,
    subscriptionId: string,
    messageId: string,
    payload: JsonObject,
  ): string {
    return createHmac('sha256', this.webhookSecret(tenantId, subscriptionId))
      .update(`${messageId}.${JSON.stringify(canonical(payload))}`)
      .digest('hex');
  }

  private lock(tx: Prisma.TransactionClient, key: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }

  private record(
    tx: Prisma.TransactionClient,
    aggregateId: string,
    aggregateVersion: number,
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    payload: JsonObject,
  ) {
    return this.changes.record(
      tx,
      {
        aggregateId,
        aggregateType: 'IntegrationExchange',
        aggregateVersion,
        eventName,
        payload: json(payload) as Prisma.InputJsonObject,
      },
      context,
      metadata,
    );
  }

  private version(actual: number, expected: number, code: string): void {
    if (!Number.isSafeInteger(expected) || actual !== expected)
      throw new AppError(code, 'Integration aggregate version conflict', 409);
  }

  private transition(code: string, status: string): never {
    throw new AppError(code, `Operation is not allowed from ${status}`, 409);
  }

  private text(value: string, field: string, maximum: number): string {
    const normalized = value?.trim();
    if (!normalized || normalized.length > maximum)
      this.invalid(`${field} is invalid`);
    return normalized;
  }

  private invalid(message: string): never {
    throw new AppError('INTEGRATION_EXCHANGE_INPUT_INVALID', message, 400);
  }

  private notFound(code: string, label: string): never {
    throw new AppError(code, `${label} was not found`, 404);
  }
}

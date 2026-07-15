import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../database/prisma.service';
import { ChangeRecordingFacade } from '../platform/public/change-recording.facade';
import { IdempotencyExecutionFacade } from '../platform/public/idempotency-execution.facade';
import type { CommandMetadata } from '../platform/tenant.service';

type JsonObject = Readonly<Record<string, unknown>>;
type AdapterRule = Readonly<{ source: string; target: string }>;

export interface CreateAdapterInput {
  readonly adapterType: 'ERP' | 'FINANCE';
  readonly capabilities: readonly AdapterCapability[];
  readonly code: string;
  readonly expectedCanonical: JsonObject;
  readonly name: string;
  readonly rules: readonly AdapterRule[];
  readonly sampleInput: JsonObject;
  readonly vendor: string;
}

export interface CreateAdapterVersionInput {
  readonly expectedCanonical: JsonObject;
  readonly rules: readonly AdapterRule[];
  readonly sampleInput: JsonObject;
}

export interface SubmitAdapterCommandInput {
  readonly businessRef: string;
  readonly capability: AdapterCapability;
  readonly definitionId: string;
  readonly direction: 'INBOUND' | 'OUTBOUND';
  readonly externalRef: string;
  readonly vendorPayload: JsonObject;
}

export interface RegisterDeviceInput {
  readonly capabilities: readonly string[];
  readonly certificateFingerprint: string;
  readonly certificateValidUntil: string;
  readonly deviceType:
    'RF' | 'PRINTER' | 'SCALE' | 'GATE' | 'GPS' | 'TEMPERATURE';
  readonly hardwareId: string;
  readonly heartbeatTimeoutSeconds?: number;
  readonly name: string;
  readonly telemetryPerMinuteLimit?: number;
}

export interface DeviceIdentityInput {
  readonly certificateFingerprint: string;
  readonly hardwareId: string;
  readonly tenantId: string;
}

export interface DeviceHeartbeatInput extends DeviceIdentityInput {
  readonly firmwareVersion?: string;
  readonly health: JsonObject;
  readonly occurredAt: string;
}

export interface DeviceTelemetryInput extends DeviceIdentityInput {
  readonly occurredAt: string;
  readonly sequence: string;
  readonly telemetryType: string;
  readonly values: JsonObject;
}

export interface DeviceCommandAckInput extends DeviceIdentityInput {
  readonly commandId: string;
  readonly occurredAt: string;
  readonly outcome: 'ACKNOWLEDGED' | 'FAILED';
  readonly payload: JsonObject;
}

type AdapterCapability =
  'MASTER_DATA' | 'ORDER' | 'INVENTORY' | 'VOUCHER' | 'INVOICE' | 'PAYMENT';

const CAPABILITY_FIELDS: Readonly<
  Record<AdapterCapability, readonly string[]>
> = {
  MASTER_DATA: [
    'id',
    'code',
    'name',
    'type',
    'status',
    'attributes',
    'effectiveAt',
  ],
  ORDER: [
    'orderId',
    'orderNo',
    'customerId',
    'lines',
    'requestedWindow',
    'status',
  ],
  INVENTORY: [
    'balanceKey',
    'productId',
    'locationId',
    'quantity',
    'uom',
    'status',
  ],
  VOUCHER: [
    'voucherNo',
    'businessRef',
    'amount',
    'currency',
    'status',
    'lines',
  ],
  INVOICE: ['invoiceNo', 'businessRef', 'amount', 'tax', 'currency', 'status'],
  PAYMENT: [
    'paymentNo',
    'businessRef',
    'amount',
    'currency',
    'paidAt',
    'status',
  ],
};

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
const object = (value: Prisma.JsonValue): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
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

@Injectable()
export class AdapterIotService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChangeRecordingFacade)
    private readonly changes: ChangeRecordingFacade,
    @Inject(IdempotencyExecutionFacade)
    private readonly idempotency: IdempotencyExecutionFacade,
  ) {}

  async workbench(context: TenantContext) {
    const where = { tenantId: context.tenantId };
    const [
      adapters,
      versions,
      adapterCommands,
      adapterEvents,
      devices,
      certificates,
      heartbeats,
      deviceCommands,
      acknowledgements,
      telemetry,
    ] = await Promise.all([
      this.prisma.integrationAdapterDefinition.findMany({
        orderBy: { updatedAt: 'desc' },
        where,
      }),
      this.prisma.integrationAdapterVersion.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where,
      }),
      this.prisma.integrationAdapterCommand.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where,
      }),
      this.prisma.integrationAdapterEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where,
      }),
      this.prisma.integrationDevice.findMany({
        orderBy: { updatedAt: 'desc' },
        where,
      }),
      this.prisma.integrationDeviceCertificate.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where,
      }),
      this.prisma.integrationDeviceHeartbeat.findMany({
        orderBy: { occurredAt: 'desc' },
        take: 100,
        where,
      }),
      this.prisma.integrationDeviceCommand.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where,
      }),
      this.prisma.integrationDeviceCommandAck.findMany({
        orderBy: { occurredAt: 'desc' },
        take: 100,
        where,
      }),
      this.prisma.integrationDeviceTelemetry.findMany({
        orderBy: { occurredAt: 'desc' },
        take: 200,
        where,
      }),
    ]);
    return {
      acknowledgements,
      adapterCommands,
      adapterEvents,
      adapters,
      certificates,
      deviceCommands,
      devices,
      heartbeats,
      telemetry,
      versions,
    };
  }

  createAdapter(
    input: CreateAdapterInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.adapterInput(input);
    return this.prisma.$transaction(async (tx) => {
      const definitionId = randomUUID();
      const versionId = randomUUID();
      const definition = await tx.integrationAdapterDefinition.create({
        data: {
          adapterType: input.adapterType,
          capabilities: json(input.capabilities),
          code: this.text(input.code, 'code', 100).toUpperCase(),
          createdBy: context.accountId,
          id: definitionId,
          name: this.text(input.name, 'name', 200),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          vendor: this.text(input.vendor, 'vendor', 100),
        },
      });
      await tx.integrationAdapterVersion.create({
        data: {
          createdBy: context.accountId,
          definitionId,
          expectedCanonical: json(input.expectedCanonical),
          id: versionId,
          rules: json(input.rules),
          sampleInput: json(input.sampleInput),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          versionNumber: 1,
        },
      });
      await this.record(
        tx,
        'AdapterDefinition',
        definition.id,
        definition.version,
        'integration.adapter-created.v1',
        context,
        metadata,
        {
          adapterType: definition.adapterType,
          capabilities: input.capabilities,
          code: definition.code,
          vendor: definition.vendor,
        },
      );
      return {
        adapterId: definition.id,
        adapterVersionId: versionId,
        status: definition.status,
        version: definition.version,
        versionNumber: 1,
      };
    });
  }

  createAdapterVersion(
    definitionId: string,
    input: CreateAdapterVersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(definitionId, 'ADAPTER_NOT_FOUND');
    this.rules(input.rules);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(
        tx,
        `${context.tenantId}:adapter-version:${definitionId}`,
      );
      const definition = await tx.integrationAdapterDefinition.findFirst({
        where: {
          id: definitionId,
          status: { not: 'RETIRED' },
          tenantId: context.tenantId,
        },
      });
      if (!definition) this.notFound('ADAPTER_NOT_FOUND', 'Adapter');
      const latest = await tx.integrationAdapterVersion.aggregate({
        _max: { versionNumber: true },
        where: { definitionId, tenantId: context.tenantId },
      });
      const version = await tx.integrationAdapterVersion.create({
        data: {
          createdBy: context.accountId,
          definitionId,
          expectedCanonical: json(input.expectedCanonical),
          rules: json(input.rules),
          sampleInput: json(input.sampleInput),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          versionNumber: (latest._max.versionNumber ?? 0) + 1,
        },
      });
      await this.record(
        tx,
        'AdapterVersion',
        version.id,
        version.version,
        'integration.adapter-version-created.v1',
        context,
        metadata,
        {
          adapterId: definitionId,
          versionNumber: version.versionNumber,
        },
      );
      return {
        adapterVersionId: version.id,
        status: version.status,
        version: version.version,
        versionNumber: version.versionNumber,
      };
    });
  }

  testAdapterVersion(
    id: string,
    input: { readonly expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.integrationAdapterVersion.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!version)
        this.notFound('ADAPTER_VERSION_NOT_FOUND', 'Adapter version');
      this.version(
        version.version,
        input.expectedVersion,
        'ADAPTER_VERSION_CONFLICT',
      );
      if (version.status !== 'DRAFT')
        this.transition('ADAPTER_VERSION_TRANSITION_INVALID', version.status);
      const definition = await tx.integrationAdapterDefinition.findFirstOrThrow(
        { where: { id: version.definitionId, tenantId: context.tenantId } },
      );
      const capability = this.firstCapability(definition.capabilities);
      const output = this.transform(
        capability,
        version.rules,
        object(version.sampleInput),
      );
      const passed =
        JSON.stringify(canonical(output)) ===
        JSON.stringify(canonical(version.expectedCanonical));
      const changed = await tx.integrationAdapterVersion.update({
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
        'AdapterVersion',
        id,
        changed.version,
        'integration.adapter-version-tested.v1',
        context,
        metadata,
        {
          adapterId: definition.id,
          passed,
          versionNumber: changed.versionNumber,
        },
      );
      return {
        adapterVersionId: id,
        output,
        passed,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  publishAdapterVersion(
    id: string,
    input: { readonly expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.integrationAdapterVersion.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!version)
        this.notFound('ADAPTER_VERSION_NOT_FOUND', 'Adapter version');
      this.version(
        version.version,
        input.expectedVersion,
        'ADAPTER_VERSION_CONFLICT',
      );
      if (version.status !== 'TESTED' || !object(version.testResult).passed)
        this.transition('ADAPTER_VERSION_TRANSITION_INVALID', version.status);
      await tx.integrationAdapterVersion.updateMany({
        data: {
          status: 'RETIRED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          definitionId: version.definitionId,
          id: { not: id },
          status: 'PUBLISHED',
          tenantId: context.tenantId,
        },
      });
      const changed = await tx.integrationAdapterVersion.update({
        data: {
          publishedAt: new Date(),
          status: 'PUBLISHED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      const definition = await tx.integrationAdapterDefinition.update({
        data: {
          activeVersionNumber: changed.versionNumber,
          status: 'ACTIVE',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: changed.definitionId },
      });
      await this.record(
        tx,
        'AdapterDefinition',
        definition.id,
        definition.version,
        'integration.adapter-version-published.v1',
        context,
        metadata,
        { adapterVersionId: id, versionNumber: changed.versionNumber },
      );
      return {
        adapterId: definition.id,
        adapterVersionId: id,
        status: changed.status,
        version: changed.version,
        versionNumber: changed.versionNumber,
      };
    });
  }

  transitionAdapter(
    id: string,
    input: {
      readonly expectedVersion: number;
      readonly target: 'ACTIVE' | 'SUSPENDED' | 'RETIRED';
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const transitions: Readonly<Record<string, readonly string[]>> = {
      ACTIVE: ['SUSPENDED', 'RETIRED'],
      DRAFT: [],
      RETIRED: [],
      SUSPENDED: ['ACTIVE', 'RETIRED'],
    };
    return this.prisma.$transaction(async (tx) => {
      const adapter = await tx.integrationAdapterDefinition.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!adapter) this.notFound('ADAPTER_NOT_FOUND', 'Adapter');
      this.version(
        adapter.version,
        input.expectedVersion,
        'ADAPTER_VERSION_CONFLICT',
      );
      if (!transitions[adapter.status]?.includes(input.target))
        this.transition('ADAPTER_TRANSITION_INVALID', adapter.status);
      if (input.target === 'ACTIVE' && adapter.activeVersionNumber === null)
        throw new AppError(
          'ADAPTER_VERSION_NOT_PUBLISHED',
          'A published adapter version is required',
          409,
        );
      const changed = await tx.integrationAdapterDefinition.update({
        data: {
          status: input.target,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      if (input.target === 'RETIRED')
        await tx.integrationAdapterVersion.updateMany({
          data: {
            status: 'RETIRED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            definitionId: id,
            status: 'PUBLISHED',
            tenantId: context.tenantId,
          },
        });
      await this.record(
        tx,
        'AdapterDefinition',
        id,
        changed.version,
        `integration.adapter-${input.target.toLowerCase()}.v1`,
        context,
        metadata,
        { previousStatus: adapter.status, status: changed.status },
      );
      return {
        adapterId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  submitAdapterCommand(
    input: SubmitAdapterCommandInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.definitionId, 'ADAPTER_NOT_FOUND');
    this.text(input.businessRef, 'businessRef', 200);
    this.text(input.externalRef, 'externalRef', 200);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(
        tx,
        `${context.tenantId}:adapter-command:${input.definitionId}:${input.externalRef}`,
      );
      const definition = await tx.integrationAdapterDefinition.findFirst({
        where: {
          id: input.definitionId,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      if (!definition) this.notFound('ADAPTER_NOT_ACTIVE', 'Active adapter');
      if (
        !this.capabilities(definition.capabilities).includes(input.capability)
      )
        this.invalid('Adapter does not support the requested capability');
      const version = await tx.integrationAdapterVersion.findFirst({
        where: {
          definitionId: definition.id,
          status: 'PUBLISHED',
          tenantId: context.tenantId,
          versionNumber: definition.activeVersionNumber ?? -1,
        },
      });
      if (!version)
        this.notFound(
          'ADAPTER_VERSION_NOT_PUBLISHED',
          'Published adapter version',
        );
      const contentHash = digest(input.vendorPayload);
      const existing = await tx.integrationAdapterCommand.findFirst({
        where: {
          definitionId: definition.id,
          externalRef: input.externalRef.trim(),
          tenantId: context.tenantId,
        },
      });
      if (existing) {
        if (existing.contentHash !== contentHash)
          throw new AppError(
            'ADAPTER_EXTERNAL_REF_CONFLICT',
            'External reference was already used with different content',
            409,
          );
        return {
          adapterCommandId: existing.id,
          canonicalPayload: object(existing.canonicalPayload),
          duplicate: true,
          status: existing.status,
          version: existing.version,
        };
      }
      const canonicalPayload = this.transform(
        input.capability,
        version.rules,
        input.vendorPayload,
      );
      const command = await tx.integrationAdapterCommand.create({
        data: {
          adapterVersionId: version.id,
          businessRef: input.businessRef.trim(),
          canonicalPayload: json(canonicalPayload),
          capability: input.capability,
          contentHash,
          createdBy: context.accountId,
          definitionId: definition.id,
          direction: input.direction,
          externalRef: input.externalRef.trim(),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          vendorPayload: json(input.vendorPayload),
        },
      });
      await this.record(
        tx,
        'AdapterCommand',
        command.id,
        command.version,
        'integration.adapter-command-normalized.v1',
        context,
        metadata,
        {
          adapterId: definition.id,
          businessRef: command.businessRef,
          canonicalPayload,
          capability: command.capability,
          externalRef: command.externalRef,
        },
      );
      return {
        adapterCommandId: command.id,
        canonicalPayload,
        duplicate: false,
        status: command.status,
        version: command.version,
      };
    });
  }

  dispatchAdapterCommand(
    id: string,
    input: { readonly expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.adapterTransition(
      id,
      input.expectedVersion,
      context,
      metadata,
      'DISPATCHED',
    );
  }

  acknowledgeAdapterCommand(
    id: string,
    input: {
      readonly errorCode?: string;
      readonly errorMessage?: string;
      readonly expectedVersion: number;
      readonly outcome: 'ACKNOWLEDGED' | 'FAILED';
      readonly vendorResponse?: JsonObject;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const command = await tx.integrationAdapterCommand.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!command)
        this.notFound('ADAPTER_COMMAND_NOT_FOUND', 'Adapter command');
      this.version(
        command.version,
        input.expectedVersion,
        'ADAPTER_COMMAND_VERSION_CONFLICT',
      );
      if (command.status !== 'DISPATCHED')
        this.transition('ADAPTER_COMMAND_TRANSITION_INVALID', command.status);
      if (input.outcome === 'FAILED' && !input.errorCode?.trim())
        this.invalid('errorCode is required for failed adapter commands');
      const changed = await tx.integrationAdapterCommand.update({
        data: {
          completedAt: new Date(),
          errorCode:
            input.outcome === 'FAILED' ? input.errorCode!.trim() : null,
          errorMessage: input.errorMessage?.trim() ?? null,
          status: input.outcome,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await tx.integrationAdapterEvent.create({
        data: {
          canonicalPayload: json(command.canonicalPayload),
          commandId: id,
          createdBy: context.accountId,
          eventType: `adapter.command.${input.outcome.toLowerCase()}`,
          sourceVersion: changed.version,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          ...(input.vendorResponse
            ? { vendorResponse: json(input.vendorResponse) }
            : {}),
        },
      });
      await this.record(
        tx,
        'AdapterCommand',
        id,
        changed.version,
        `integration.adapter-command-${input.outcome.toLowerCase()}.v1`,
        context,
        metadata,
        {
          businessRef: command.businessRef,
          canonicalPayload: object(command.canonicalPayload),
          capability: command.capability,
          status: changed.status,
        },
      );
      return {
        adapterCommandId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  registerDevice(
    input: RegisterDeviceInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const validUntil = this.future(
      input.certificateValidUntil,
      'certificateValidUntil',
    );
    const fingerprint = this.fingerprint(input.certificateFingerprint);
    const heartbeatTimeoutSeconds = input.heartbeatTimeoutSeconds ?? 300;
    const telemetryPerMinuteLimit = input.telemetryPerMinuteLimit ?? 60;
    if (
      !Number.isInteger(heartbeatTimeoutSeconds) ||
      heartbeatTimeoutSeconds < 10 ||
      heartbeatTimeoutSeconds > 86_400 ||
      !Number.isInteger(telemetryPerMinuteLimit) ||
      telemetryPerMinuteLimit < 1 ||
      telemetryPerMinuteLimit > 10_000
    )
      this.invalid('Device heartbeat or telemetry policy is invalid');
    return this.prisma.$transaction(async (tx) => {
      const device = await tx.integrationDevice.create({
        data: {
          activeCertificateFingerprint: fingerprint,
          capabilities: json(
            input.capabilities.map((item) =>
              this.text(item, 'capability', 100),
            ),
          ),
          certificateValidUntil: validUntil,
          createdBy: context.accountId,
          deviceType: input.deviceType,
          hardwareId: this.text(input.hardwareId, 'hardwareId', 150),
          heartbeatTimeoutSeconds,
          name: this.text(input.name, 'name', 200),
          telemetryPerMinuteLimit,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await tx.integrationDeviceCertificate.create({
        data: {
          createdBy: context.accountId,
          deviceId: device.id,
          fingerprint,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          validFrom: new Date(),
          validUntil,
        },
      });
      await this.record(
        tx,
        'Device',
        device.id,
        device.version,
        'integration.device-registered.v1',
        context,
        metadata,
        {
          deviceType: device.deviceType,
          hardwareId: device.hardwareId,
          status: device.status,
        },
      );
      return {
        deviceId: device.id,
        status: device.status,
        version: device.version,
      };
    });
  }

  transitionDevice(
    id: string,
    input: {
      readonly expectedVersion: number;
      readonly target: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const transitions: Readonly<Record<string, readonly string[]>> = {
      ACTIVE: ['SUSPENDED', 'REVOKED'],
      PENDING: ['ACTIVE', 'REVOKED'],
      REVOKED: [],
      SUSPENDED: ['ACTIVE', 'REVOKED'],
    };
    return this.prisma.$transaction(async (tx) => {
      const device = await tx.integrationDevice.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!device) this.notFound('DEVICE_NOT_FOUND', 'Device');
      this.version(
        device.version,
        input.expectedVersion,
        'DEVICE_VERSION_CONFLICT',
      );
      if (!transitions[device.status]?.includes(input.target))
        this.transition('DEVICE_TRANSITION_INVALID', device.status);
      if (
        input.target === 'ACTIVE' &&
        device.certificateValidUntil <= new Date()
      )
        throw new AppError(
          'DEVICE_CERTIFICATE_EXPIRED',
          'Device certificate has expired',
          409,
        );
      const changed = await tx.integrationDevice.update({
        data: {
          status: input.target,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      if (input.target === 'REVOKED')
        await tx.integrationDeviceCertificate.updateMany({
          data: {
            status: 'REVOKED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { deviceId: id, status: 'ACTIVE', tenantId: context.tenantId },
        });
      await this.record(
        tx,
        'Device',
        id,
        changed.version,
        `integration.device-${input.target.toLowerCase()}.v1`,
        context,
        metadata,
        { previousStatus: device.status, status: changed.status },
      );
      return { deviceId: id, status: changed.status, version: changed.version };
    });
  }

  rotateDeviceCertificate(
    id: string,
    input: {
      readonly certificateFingerprint: string;
      readonly expectedVersion: number;
      readonly validUntil: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const fingerprint = this.fingerprint(input.certificateFingerprint);
    const validUntil = this.future(input.validUntil, 'validUntil');
    return this.prisma.$transaction(async (tx) => {
      const device = await tx.integrationDevice.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!device) this.notFound('DEVICE_NOT_FOUND', 'Device');
      this.version(
        device.version,
        input.expectedVersion,
        'DEVICE_VERSION_CONFLICT',
      );
      if (device.status === 'REVOKED')
        this.transition('DEVICE_CERTIFICATE_ROTATION_INVALID', device.status);
      const current = await tx.integrationDeviceCertificate.findFirst({
        where: {
          deviceId: id,
          fingerprint: device.activeCertificateFingerprint,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      if (!current)
        this.notFound(
          'DEVICE_CERTIFICATE_NOT_FOUND',
          'Active device certificate',
        );
      const next = await tx.integrationDeviceCertificate.create({
        data: {
          createdBy: context.accountId,
          deviceId: id,
          fingerprint,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          validFrom: new Date(),
          validUntil,
        },
      });
      await tx.integrationDeviceCertificate.update({
        data: {
          rotatedToCertificateId: next.id,
          status: 'ROTATED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: current.id },
      });
      const changed = await tx.integrationDevice.update({
        data: {
          activeCertificateFingerprint: fingerprint,
          certificateValidUntil: validUntil,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        'Device',
        id,
        changed.version,
        'integration.device-certificate-rotated.v1',
        context,
        metadata,
        { certificateId: next.id, validUntil: validUntil.toISOString() },
      );
      return {
        certificateId: next.id,
        deviceId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  issueDeviceCommand(
    id: string,
    input: {
      readonly commandType: string;
      readonly expiresAt: string;
      readonly payload: JsonObject;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const expiresAt = this.future(input.expiresAt, 'expiresAt');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:device-command:${id}`);
      const device = await tx.integrationDevice.findFirst({
        where: { id, status: 'ACTIVE', tenantId: context.tenantId },
      });
      if (!device) this.notFound('ACTIVE_DEVICE_NOT_FOUND', 'Active device');
      const latest = await tx.integrationDeviceCommand.aggregate({
        _max: { sequence: true },
        where: { deviceId: id, tenantId: context.tenantId },
      });
      const command = await tx.integrationDeviceCommand.create({
        data: {
          commandType: this.text(input.commandType, 'commandType', 100),
          createdBy: context.accountId,
          deviceId: id,
          expiresAt,
          payload: json(input.payload),
          sequence: (latest._max.sequence ?? 0) + 1,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        'DeviceCommand',
        command.id,
        command.version,
        'integration.device-command-queued.v1',
        context,
        metadata,
        {
          commandType: command.commandType,
          deviceId: id,
          expiresAt: expiresAt.toISOString(),
          sequence: command.sequence,
        },
      );
      return {
        deviceCommandId: command.id,
        sequence: command.sequence,
        status: command.status,
        version: command.version,
      };
    });
  }

  sendDeviceCommand(
    id: string,
    input: { readonly expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const command = await tx.integrationDeviceCommand.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!command) this.notFound('DEVICE_COMMAND_NOT_FOUND', 'Device command');
      this.version(
        command.version,
        input.expectedVersion,
        'DEVICE_COMMAND_VERSION_CONFLICT',
      );
      if (command.status !== 'QUEUED')
        this.transition('DEVICE_COMMAND_TRANSITION_INVALID', command.status);
      const target = command.expiresAt <= new Date() ? 'EXPIRED' : 'SENT';
      const changed = await tx.integrationDeviceCommand.update({
        data: {
          ...(target === 'SENT' ? { sentAt: new Date() } : {}),
          status: target,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        'DeviceCommand',
        id,
        changed.version,
        `integration.device-command-${target.toLowerCase()}.v1`,
        context,
        metadata,
        {
          deviceId: command.deviceId,
          sequence: command.sequence,
          status: target,
        },
      );
      return {
        deviceCommandId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  heartbeat(
    input: DeviceHeartbeatInput,
    key: string | undefined,
    correlationId: string,
    ipAddress?: string,
  ) {
    return this.external(
      input,
      key,
      'integration.device.heartbeat.v1',
      200,
      correlationId,
      ipAddress,
      async (tx, device, context, metadata) => {
        const occurredAt = this.date(input.occurredAt, 'occurredAt');
        if (device.lastHeartbeatAt && occurredAt < device.lastHeartbeatAt)
          throw new AppError(
            'DEVICE_HEARTBEAT_OUT_OF_ORDER',
            'Heartbeat time cannot move backwards',
            409,
          );
        const heartbeat = await tx.integrationDeviceHeartbeat.create({
          data: {
            createdBy: device.id,
            deviceId: device.id,
            firmwareVersion: input.firmwareVersion?.trim() ?? null,
            healthSnapshot: json(input.health),
            occurredAt,
            tenantId: device.tenantId,
            updatedBy: device.id,
          },
        });
        const changed = await tx.integrationDevice.update({
          data: {
            firmwareVersion:
              input.firmwareVersion?.trim() ?? device.firmwareVersion,
            lastHeartbeatAt: occurredAt,
            updatedBy: device.id,
            version: { increment: 1 },
          },
          where: { id: device.id },
        });
        await this.record(
          tx,
          'Device',
          device.id,
          changed.version,
          'integration.device-heartbeat.v1',
          context,
          metadata,
          { heartbeatId: heartbeat.id, occurredAt: occurredAt.toISOString() },
        );
        return {
          deviceId: device.id,
          heartbeatId: heartbeat.id,
          status: changed.status,
          version: changed.version,
        };
      },
    );
  }

  ingestTelemetry(
    input: DeviceTelemetryInput,
    key: string | undefined,
    correlationId: string,
    ipAddress?: string,
  ) {
    this.text(input.sequence, 'sequence', 100);
    this.text(input.telemetryType, 'telemetryType', 100);
    return this.external(
      input,
      key,
      'integration.device.telemetry.v1',
      202,
      correlationId,
      ipAddress,
      async (tx, device, context, metadata) => {
        const occurredAt = this.date(input.occurredAt, 'occurredAt');
        const bucketStart = new Date(
          Math.floor(occurredAt.getTime() / 60_000) * 60_000,
        );
        await this.lock(
          tx,
          `${device.tenantId}:telemetry:${device.id}:${bucketStart.toISOString()}`,
        );
        const bucket = await tx.integrationTelemetryUsageBucket.findUnique({
          where: {
            tenantId_deviceId_bucketStart: {
              bucketStart,
              deviceId: device.id,
              tenantId: device.tenantId,
            },
          },
        });
        const nextCount = (bucket?.sampleCount ?? 0) + 1;
        if (nextCount > device.telemetryPerMinuteLimit)
          throw new AppError(
            'DEVICE_TELEMETRY_RATE_LIMITED',
            'Device telemetry rate limit exceeded',
            429,
            { retryable: true },
          );
        if (bucket)
          await tx.integrationTelemetryUsageBucket.update({
            data: {
              sampleCount: nextCount,
              updatedBy: device.id,
              version: { increment: 1 },
            },
            where: { id: bucket.id },
          });
        else
          await tx.integrationTelemetryUsageBucket.create({
            data: {
              bucketStart,
              createdBy: device.id,
              deviceId: device.id,
              sampleCount: 1,
              tenantId: device.tenantId,
              updatedBy: device.id,
            },
          });
        const telemetry = await tx.integrationDeviceTelemetry.create({
          data: {
            contentHash: digest(input.values),
            createdBy: device.id,
            deviceId: device.id,
            occurredAt,
            sequence: input.sequence.trim(),
            telemetryType: input.telemetryType.trim().toUpperCase(),
            tenantId: device.tenantId,
            updatedBy: device.id,
            valueSnapshot: json(input.values),
          },
        });
        await this.record(
          tx,
          'DeviceTelemetry',
          telemetry.id,
          telemetry.version,
          'integration.device-telemetry-received.v1',
          context,
          metadata,
          {
            deviceId: device.id,
            occurredAt: occurredAt.toISOString(),
            sequence: telemetry.sequence,
            telemetryType: telemetry.telemetryType,
          },
        );
        return {
          accepted: true,
          deviceId: device.id,
          sampleCount: nextCount,
          status: telemetry.status,
          telemetryId: telemetry.id,
          version: telemetry.version,
        };
      },
    );
  }

  acknowledgeDeviceCommand(
    input: DeviceCommandAckInput,
    key: string | undefined,
    correlationId: string,
    ipAddress?: string,
  ) {
    return this.external(
      input,
      key,
      'integration.device.command-ack.v1',
      200,
      correlationId,
      ipAddress,
      async (tx, device, context, metadata) => {
        const command = await tx.integrationDeviceCommand.findFirst({
          where: {
            deviceId: device.id,
            id: input.commandId,
            tenantId: device.tenantId,
          },
        });
        if (!command)
          this.notFound('DEVICE_COMMAND_NOT_FOUND', 'Device command');
        if (command.status !== 'SENT')
          this.transition('DEVICE_COMMAND_TRANSITION_INVALID', command.status);
        const occurredAt = this.date(input.occurredAt, 'occurredAt');
        const ack = await tx.integrationDeviceCommandAck.create({
          data: {
            commandId: command.id,
            createdBy: device.id,
            deviceId: device.id,
            occurredAt,
            outcome: input.outcome,
            payload: json(input.payload),
            tenantId: device.tenantId,
            updatedBy: device.id,
          },
        });
        const changed = await tx.integrationDeviceCommand.update({
          data: {
            acknowledgedAt: occurredAt,
            errorCode:
              input.outcome === 'FAILED'
                ? this.text(
                    String(input.payload.errorCode ?? 'DEVICE_COMMAND_FAILED'),
                    'errorCode',
                    100,
                  )
                : null,
            status: input.outcome,
            updatedBy: device.id,
            version: { increment: 1 },
          },
          where: { id: command.id },
        });
        await this.record(
          tx,
          'DeviceCommand',
          command.id,
          changed.version,
          `integration.device-command-${input.outcome.toLowerCase()}.v1`,
          context,
          metadata,
          {
            acknowledgementId: ack.id,
            deviceId: device.id,
            sequence: command.sequence,
            status: changed.status,
          },
        );
        return {
          acknowledgementId: ack.id,
          deviceCommandId: command.id,
          status: changed.status,
          version: changed.version,
        };
      },
    );
  }

  private adapterTransition(
    id: string,
    expectedVersion: number,
    context: TenantContext,
    metadata: CommandMetadata,
    target: 'DISPATCHED',
  ) {
    return this.prisma.$transaction(async (tx) => {
      const command = await tx.integrationAdapterCommand.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!command)
        this.notFound('ADAPTER_COMMAND_NOT_FOUND', 'Adapter command');
      this.version(
        command.version,
        expectedVersion,
        'ADAPTER_COMMAND_VERSION_CONFLICT',
      );
      if (command.status !== 'NORMALIZED')
        this.transition('ADAPTER_COMMAND_TRANSITION_INVALID', command.status);
      const changed = await tx.integrationAdapterCommand.update({
        data: {
          dispatchedAt: new Date(),
          status: target,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await tx.integrationAdapterEvent.create({
        data: {
          canonicalPayload: json(command.canonicalPayload),
          commandId: id,
          createdBy: context.accountId,
          eventType: 'adapter.command.dispatched',
          sourceVersion: changed.version,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        'AdapterCommand',
        id,
        changed.version,
        'integration.adapter-command-dispatched.v1',
        context,
        metadata,
        {
          businessRef: command.businessRef,
          canonicalPayload: object(command.canonicalPayload),
          capability: command.capability,
          externalRef: command.externalRef,
        },
      );
      return {
        adapterCommandId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  private async external<T extends Record<string, unknown>>(
    input: DeviceIdentityInput,
    key: string | undefined,
    scope: string,
    responseCode: number,
    correlationId: string,
    ipAddress: string | undefined,
    operation: (
      tx: Prisma.TransactionClient,
      device: Awaited<ReturnType<AdapterIotService['authenticate']>>,
      context: TenantContext,
      metadata: CommandMetadata,
    ) => Promise<T>,
  ): Promise<T> {
    const identity = await this.authenticate(this.prisma, input);
    return this.idempotency.execute(
      {
        actorId: identity.id,
        key,
        payload: input,
        responseCode,
        scope,
        tenantId: identity.tenantId,
      },
      async (tx) => {
        const device = await this.authenticate(tx, input);
        const context: TenantContext = {
          accountId: device.id,
          accountKind: 'TENANT_ADMIN',
          deviceId: device.hardwareId,
          organizationIds: [],
          permissionVersion: 1,
          tenantId: device.tenantId,
          tokenId: device.id,
        };
        return operation(tx, device, context, {
          correlationId: correlationId || randomUUID(),
          idempotencyKey: key,
          ipAddress,
        });
      },
    );
  }

  private async authenticate(
    client: Pick<Prisma.TransactionClient, 'integrationDevice'>,
    input: DeviceIdentityInput,
  ) {
    this.uuid(input.tenantId, 'DEVICE_IDENTITY_INVALID');
    const device = await client.integrationDevice.findUnique({
      where: {
        tenantId_hardwareId: {
          hardwareId: this.text(input.hardwareId, 'hardwareId', 150),
          tenantId: input.tenantId,
        },
      },
    });
    if (
      !device ||
      device.status !== 'ACTIVE' ||
      device.activeCertificateFingerprint !==
        this.fingerprint(input.certificateFingerprint)
    )
      throw new AppError(
        'DEVICE_AUTHENTICATION_FAILED',
        'Device identity or certificate is invalid',
        401,
      );
    if (device.certificateValidUntil <= new Date())
      throw new AppError(
        'DEVICE_CERTIFICATE_EXPIRED',
        'Device certificate has expired',
        401,
      );
    return device;
  }

  private transform(
    capability: AdapterCapability,
    rulesValue: Prisma.JsonValue,
    source: JsonObject,
  ): JsonObject {
    const rules = Array.isArray(rulesValue)
      ? (rulesValue as unknown as AdapterRule[])
      : [];
    const allowed = new Set(CAPABILITY_FIELDS[capability]);
    const output: Record<string, unknown> = {};
    for (const rule of rules) {
      const sourceKey = this.text(rule.source, 'rule.source', 200);
      const target = this.text(rule.target, 'rule.target', 100);
      if (target.includes('.') || !allowed.has(target))
        throw new AppError(
          'ADAPTER_SEMANTIC_LEAKAGE',
          `Canonical field ${target} is not allowed for ${capability}`,
          400,
        );
      if (Object.prototype.hasOwnProperty.call(source, sourceKey))
        output[target] = source[sourceKey];
    }
    this.noVendorKeys(output);
    return output;
  }

  private noVendorKeys(value: unknown): void {
    if (Array.isArray(value))
      return value.forEach((item) => this.noVendorKeys(item));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (/^(sap|oracle|erp|vendor)[_.-]/i.test(key))
        throw new AppError(
          'ADAPTER_SEMANTIC_LEAKAGE',
          `Vendor field ${key} cannot enter the canonical model`,
          400,
        );
      this.noVendorKeys(child);
    }
  }

  private adapterInput(input: CreateAdapterInput): void {
    if (
      !input.capabilities.length ||
      input.capabilities.some((capability) => !CAPABILITY_FIELDS[capability])
    )
      this.invalid('Adapter capabilities are invalid');
    this.rules(input.rules);
  }

  private rules(rules: readonly AdapterRule[]): void {
    if (
      !rules.length ||
      rules.some((rule) => !rule.source?.trim() || !rule.target?.trim())
    )
      this.invalid('Adapter mapping rules are required');
  }

  private capabilities(value: Prisma.JsonValue): AdapterCapability[] {
    return Array.isArray(value)
      ? value
          .map(String)
          .filter(
            (item): item is AdapterCapability => item in CAPABILITY_FIELDS,
          )
      : [];
  }

  private firstCapability(value: Prisma.JsonValue): AdapterCapability {
    const capability = this.capabilities(value)[0];
    if (!capability) this.invalid('Adapter has no supported capability');
    return capability;
  }

  private record(
    tx: Prisma.TransactionClient,
    aggregateType: string,
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
        aggregateType,
        aggregateVersion,
        eventName,
        payload: json(payload) as Prisma.InputJsonObject,
      },
      context,
      metadata,
    );
  }

  private lock(tx: Prisma.TransactionClient, key: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }

  private version(actual: number, expected: number, code: string): void {
    if (!Number.isSafeInteger(expected) || actual !== expected)
      throw new AppError(code, 'Integration aggregate version conflict', 409);
  }

  private date(value: string, field: string): Date {
    const result = new Date(value);
    if (Number.isNaN(result.getTime())) this.invalid(`${field} is invalid`);
    return result;
  }

  private future(value: string, field: string): Date {
    const result = this.date(value, field);
    if (result <= new Date()) this.invalid(`${field} must be in the future`);
    return result;
  }

  private fingerprint(value: string): string {
    const normalized = value?.replaceAll(':', '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized))
      this.invalid('certificateFingerprint must be a SHA-256 fingerprint');
    return normalized;
  }

  private uuid(value: string, code: string): void {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
      throw new AppError(code, 'Identifier is invalid', 400);
  }

  private text(value: string, field: string, maximum: number): string {
    const normalized = value?.trim();
    if (!normalized || normalized.length > maximum)
      this.invalid(`${field} is invalid`);
    return normalized;
  }

  private invalid(message: string): never {
    throw new AppError('INTEGRATION_ADAPTER_IOT_INPUT_INVALID', message, 400);
  }

  private notFound(code: string, label: string): never {
    throw new AppError(code, `${label} was not found`, 404);
  }

  private transition(code: string, status: string): never {
    throw new AppError(code, `Operation is not allowed from ${status}`, 409);
  }
}

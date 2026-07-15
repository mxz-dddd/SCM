import { Inject, Injectable } from '@nestjs/common';
import {
  type IntegrationPortalPrincipalType,
  type IntegrationPortalProjectionType,
  Prisma,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../database/prisma.service';
import type { BusinessEventInput } from '../platform/event.service';
import { ChangeRecordingFacade } from '../platform/public/change-recording.facade';
import { EventConsumptionFacade } from '../platform/public/event-consumption.facade';
import type { CommandMetadata } from '../platform/tenant.service';

type JsonObject = Readonly<Record<string, unknown>>;

export interface SavePortalGrantInput {
  readonly accountId: string;
  readonly displayName: string;
  readonly permissions: readonly string[];
  readonly principalRef: string;
  readonly principalType: IntegrationPortalPrincipalType;
}

export interface ProjectPortalEventInput {
  readonly businessRef: string;
  readonly event: BusinessEventInput;
  readonly principalRef: string;
  readonly principalType: IntegrationPortalPrincipalType;
  readonly projectionKey: string;
  readonly projectionType: IntegrationPortalProjectionType;
  readonly snapshot: JsonObject;
}

export interface CreatePortalCommandInput {
  readonly businessRef: string;
  readonly commandType: PortalCommandType;
  readonly payload: JsonObject;
  readonly principalRef: string;
  readonly principalType: IntegrationPortalPrincipalType;
}

type PortalCommandType =
  | 'CUSTOMER_CONFIRM'
  | 'CUSTOMER_CANCEL'
  | 'CUSTOMER_RETURN'
  | 'MESSAGE_SEND'
  | 'ATTACHMENT_ADD'
  | 'SUPPLIER_ORDER_RESPONSE'
  | 'SUPPLIER_ASN_SUBMIT'
  | 'SUPPLIER_APPOINTMENT_REQUEST'
  | 'CARRIER_TENDER_RESPONSE'
  | 'CARRIER_RESOURCE_ASSIGN'
  | 'CARRIER_TRACKING_REPORT'
  | 'CARRIER_POD_SUBMIT'
  | 'CARRIER_RECONCILIATION_RESPONSE';

const PROJECTION_PERMISSIONS: Readonly<Record<IntegrationPortalProjectionType, string>> = {
  APPOINTMENT: 'VIEW_APPOINTMENT',
  ASN: 'VIEW_ASN',
  ATTACHMENT: 'VIEW_ATTACHMENT',
  DELIVERY: 'VIEW_DELIVERY',
  DRIVER: 'VIEW_DRIVER',
  INVENTORY: 'VIEW_INVENTORY',
  MESSAGE: 'VIEW_MESSAGE',
  ORDER: 'VIEW_ORDER',
  POD: 'VIEW_POD',
  RECONCILIATION: 'VIEW_RECONCILIATION',
  SHIPMENT: 'VIEW_SHIPMENT',
  TENDER: 'VIEW_TENDER',
  TRACKING: 'VIEW_TRACKING',
  VEHICLE: 'VIEW_VEHICLE',
};

const COMMANDS: Readonly<
  Record<
    PortalCommandType,
    Readonly<{
      permission: string;
      principals: readonly IntegrationPortalPrincipalType[];
      targetDomain: 'ams' | 'billing' | 'oms' | 'platform' | 'tms';
    }>
  >
> = {
  ATTACHMENT_ADD: { permission: 'ATTACHMENT_ADD', principals: ['CUSTOMER', 'SUPPLIER', 'CARRIER'], targetDomain: 'platform' },
  CARRIER_POD_SUBMIT: { permission: 'POD_SUBMIT', principals: ['CARRIER'], targetDomain: 'tms' },
  CARRIER_RECONCILIATION_RESPONSE: { permission: 'RECONCILIATION_RESPOND', principals: ['CARRIER'], targetDomain: 'billing' },
  CARRIER_RESOURCE_ASSIGN: { permission: 'RESOURCE_ASSIGN', principals: ['CARRIER'], targetDomain: 'tms' },
  CARRIER_TENDER_RESPONSE: { permission: 'TENDER_RESPOND', principals: ['CARRIER'], targetDomain: 'tms' },
  CARRIER_TRACKING_REPORT: { permission: 'TRACKING_REPORT', principals: ['CARRIER'], targetDomain: 'tms' },
  CUSTOMER_CANCEL: { permission: 'ORDER_CANCEL', principals: ['CUSTOMER'], targetDomain: 'oms' },
  CUSTOMER_CONFIRM: { permission: 'ORDER_CONFIRM', principals: ['CUSTOMER'], targetDomain: 'oms' },
  CUSTOMER_RETURN: { permission: 'RETURN_CREATE', principals: ['CUSTOMER'], targetDomain: 'oms' },
  MESSAGE_SEND: { permission: 'MESSAGE_SEND', principals: ['CUSTOMER', 'SUPPLIER', 'CARRIER'], targetDomain: 'platform' },
  SUPPLIER_APPOINTMENT_REQUEST: { permission: 'APPOINTMENT_REQUEST', principals: ['SUPPLIER'], targetDomain: 'ams' },
  SUPPLIER_ASN_SUBMIT: { permission: 'ASN_SUBMIT', principals: ['SUPPLIER'], targetDomain: 'oms' },
  SUPPLIER_ORDER_RESPONSE: { permission: 'ORDER_RESPOND', principals: ['SUPPLIER'], targetDomain: 'oms' },
};

const PRINCIPAL_PROJECTIONS: Readonly<
  Record<IntegrationPortalPrincipalType, readonly IntegrationPortalProjectionType[]>
> = {
  CARRIER: ['TENDER', 'VEHICLE', 'DRIVER', 'SHIPMENT', 'TRACKING', 'POD', 'RECONCILIATION', 'MESSAGE', 'ATTACHMENT'],
  CUSTOMER: ['ORDER', 'INVENTORY', 'APPOINTMENT', 'SHIPMENT', 'DELIVERY', 'RECONCILIATION', 'MESSAGE', 'ATTACHMENT'],
  SUPPLIER: ['ORDER', 'ASN', 'APPOINTMENT', 'MESSAGE', 'ATTACHMENT'],
};

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
const values = (value: Prisma.JsonValue): string[] =>
  Array.isArray(value) ? value.map(String) : [];

@Injectable()
export class MobilePortalService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChangeRecordingFacade)
    private readonly changes: ChangeRecordingFacade,
    @Inject(EventConsumptionFacade)
    private readonly eventConsumption: EventConsumptionFacade,
  ) {}

  async administration(context: TenantContext) {
    const where = { tenantId: context.tenantId };
    const [grants, projections, commands] = await Promise.all([
      this.prisma.integrationPortalAccessGrant.findMany({ orderBy: { updatedAt: 'desc' }, where }),
      this.prisma.integrationPortalProjection.findMany({ orderBy: { occurredAt: 'desc' }, take: 300, where }),
      this.prisma.integrationPortalCommand.findMany({ orderBy: { createdAt: 'desc' }, take: 300, where }),
    ]);
    return { commands, grants, projections };
  }

  async portal(context: TenantContext, filter?: { readonly principalRef?: string; readonly principalType?: IntegrationPortalPrincipalType; readonly query?: string }) {
    const grants = await this.prisma.integrationPortalAccessGrant.findMany({
      orderBy: [{ principalType: 'asc' }, { displayName: 'asc' }],
      where: {
        accountId: context.accountId,
        ...(filter?.principalRef ? { principalRef: filter.principalRef } : {}),
        ...(filter?.principalType ? { principalType: filter.principalType } : {}),
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    if (!grants.length) throw new AppError('PORTAL_SCOPE_DENIED', 'No active customer or partner scope is assigned', 403);
    const rows = await this.prisma.integrationPortalProjection.findMany({
      orderBy: [{ sourceVersion: 'desc' }, { occurredAt: 'desc' }, { id: 'desc' }],
      take: 1000,
      where: {
        OR: grants.map(({ principalRef, principalType }) => ({ principalRef, principalType })),
        tenantId: context.tenantId,
      },
    });
    const allowed = new Map(grants.map((grant) => [`${grant.principalType}:${grant.principalRef}`, new Set(values(grant.permissions))]));
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const permissions = allowed.get(`${row.principalType}:${row.principalRef}`);
      if (!permissions || (!permissions.has('VIEW_ALL') && !permissions.has(PROJECTION_PERMISSIONS[row.projectionType]))) continue;
      const key = `${row.principalType}:${row.principalRef}:${row.projectionType}:${row.projectionKey}`;
      if (!latest.has(key)) latest.set(key, row);
    }
    const query = filter?.query?.trim().toLowerCase();
    const projections = [...latest.values()].filter((row) => !query || `${row.businessRef} ${row.projectionKey} ${JSON.stringify(row.snapshot)}`.toLowerCase().includes(query));
    const commands = await this.prisma.integrationPortalCommand.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      where: { accountId: context.accountId, tenantId: context.tenantId },
    });
    return {
      commands,
      grants: grants.map(({ displayName, id, permissions, principalRef, principalType }) => ({ displayName, id, permissions, principalRef, principalType })),
      projections,
    };
  }

  saveGrant(input: SavePortalGrantInput, context: TenantContext, metadata: CommandMetadata) {
    this.uuid(input.accountId, 'PORTAL_ACCOUNT_INVALID');
    this.principal(input.principalType, input.principalRef);
    this.permissions(input.permissions);
    return this.prisma.$transaction(async (tx) => {
      const grant = await tx.integrationPortalAccessGrant.upsert({
        create: {
          accountId: input.accountId,
          createdBy: context.accountId,
          displayName: this.text(input.displayName, 'displayName', 200),
          permissions: json([...new Set(input.permissions)]),
          principalRef: input.principalRef.trim(),
          principalType: input.principalType,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
        update: {
          displayName: this.text(input.displayName, 'displayName', 200),
          permissions: json([...new Set(input.permissions)]),
          status: 'ACTIVE',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          tenantId_accountId_principalType_principalRef: {
            accountId: input.accountId,
            principalRef: input.principalRef.trim(),
            principalType: input.principalType,
            tenantId: context.tenantId,
          },
        },
      });
      await this.record(tx, 'PortalAccessGrant', grant.id, grant.version, 'integration.portal-access-granted.v1', context, metadata, {
        accountId: grant.accountId,
        principalRef: grant.principalRef,
        principalType: grant.principalType,
      });
      return { grantId: grant.id, status: grant.status, version: grant.version };
    });
  }

  transitionGrant(id: string, input: { readonly expectedVersion: number; readonly target: 'ACTIVE' | 'INACTIVE' }, context: TenantContext, metadata: CommandMetadata) {
    return this.prisma.$transaction(async (tx) => {
      const grant = await tx.integrationPortalAccessGrant.findFirst({ where: { id, tenantId: context.tenantId } });
      if (!grant) this.notFound('PORTAL_GRANT_NOT_FOUND', 'Portal access grant');
      this.version(grant.version, input.expectedVersion, 'PORTAL_GRANT_VERSION_CONFLICT');
      if (grant.status === input.target) this.transition('PORTAL_GRANT_TRANSITION_INVALID', grant.status);
      const changed = await tx.integrationPortalAccessGrant.update({ data: { status: input.target, updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
      await this.record(tx, 'PortalAccessGrant', id, changed.version, `integration.portal-access-${input.target.toLowerCase()}.v1`, context, metadata, { accountId: grant.accountId, principalRef: grant.principalRef, principalType: grant.principalType, status: changed.status });
      return { grantId: id, status: changed.status, version: changed.version };
    });
  }

  async project(input: ProjectPortalEventInput, context: TenantContext, metadata: CommandMetadata) {
    this.principal(input.principalType, input.principalRef);
    if (!PRINCIPAL_PROJECTIONS[input.principalType].includes(input.projectionType)) this.invalid('Projection type is not allowed for the principal');
    this.text(input.projectionKey, 'projectionKey', 200);
    this.text(input.businessRef, 'businessRef', 200);
    this.safeSnapshot(input.snapshot);
    return this.eventConsumption.consumePortalProjection(input.event, context, metadata, async (event, tx) => {
      const latest = await tx.integrationPortalProjection.findFirst({
        orderBy: { sourceVersion: 'desc' },
        where: {
          principalRef: input.principalRef.trim(),
          principalType: input.principalType,
          projectionKey: input.projectionKey.trim(),
          projectionType: input.projectionType,
          tenantId: context.tenantId,
        },
      });
      if (latest && latest.sourceVersion >= event.aggregateVersion)
        return { ignored: true, projectionId: latest.id, sourceVersion: latest.sourceVersion };
      const projection = await tx.integrationPortalProjection.create({
        data: {
          businessRef: input.businessRef.trim(),
          createdBy: context.accountId,
          occurredAt: new Date(event.occurredAt),
          principalRef: input.principalRef.trim(),
          principalType: input.principalType,
          projectionKey: input.projectionKey.trim(),
          projectionType: input.projectionType,
          snapshot: json(input.snapshot),
          sourceAggregateId: event.aggregateId,
          sourceDomain: event.eventType.split('.')[0]!,
          sourceEventId: event.eventId,
          sourceVersion: event.aggregateVersion,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      return { ignored: false, projectionId: projection.id, sourceVersion: projection.sourceVersion };
    });
  }

  createCommand(input: CreatePortalCommandInput, context: TenantContext, metadata: CommandMetadata) {
    const specification = COMMANDS[input.commandType];
    if (!specification || !specification.principals.includes(input.principalType)) this.invalid('Portal command is not allowed for the principal');
    this.principal(input.principalType, input.principalRef);
    this.text(input.businessRef, 'businessRef', 200);
    this.commandPayload(input.commandType, input.payload);
    return this.prisma.$transaction(async (tx) => {
      const grant = await tx.integrationPortalAccessGrant.findUnique({
        where: {
          tenantId_accountId_principalType_principalRef: {
            accountId: context.accountId,
            principalRef: input.principalRef.trim(),
            principalType: input.principalType,
            tenantId: context.tenantId,
          },
        },
      });
      if (!grant || grant.status !== 'ACTIVE' || (!values(grant.permissions).includes('COMMAND_ALL') && !values(grant.permissions).includes(specification.permission)))
        throw new AppError('PORTAL_SCOPE_DENIED', 'Portal command is outside the assigned principal scope', 403);
      const visible = await tx.integrationPortalProjection.count({ where: { businessRef: input.businessRef.trim(), principalRef: grant.principalRef, principalType: grant.principalType, tenantId: context.tenantId } });
      if (!visible) throw new AppError('PORTAL_BUSINESS_SCOPE_DENIED', 'Business reference is not visible in this portal scope', 403);
      const portalCommand = await tx.integrationPortalCommand.create({
        data: {
          accountId: context.accountId,
          businessRef: input.businessRef.trim(),
          commandType: input.commandType,
          createdBy: context.accountId,
          payloadSnapshot: json(input.payload),
          principalRef: grant.principalRef,
          principalType: grant.principalType,
          targetDomain: specification.targetDomain,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(tx, 'PortalCommand', portalCommand.id, portalCommand.version, 'integration.portal-command-requested.v1', context, metadata, {
        businessRef: portalCommand.businessRef,
        commandType: portalCommand.commandType,
        payload: input.payload,
        principalRef: portalCommand.principalRef,
        principalType: portalCommand.principalType,
        targetDomain: portalCommand.targetDomain,
      });
      return { accepted: true, portalCommandId: portalCommand.id, status: portalCommand.status, version: portalCommand.version };
    });
  }

  dispatchCommand(id: string, input: { readonly expectedVersion: number }, context: TenantContext, metadata: CommandMetadata) {
    return this.commandTransition(id, input.expectedVersion, 'DISPATCHED', undefined, context, metadata);
  }

  completeCommand(id: string, input: { readonly errorCode?: string; readonly errorMessage?: string; readonly expectedVersion: number; readonly outcome: 'ACKNOWLEDGED' | 'FAILED' }, context: TenantContext, metadata: CommandMetadata) {
    if (input.outcome === 'FAILED' && !input.errorCode?.trim()) this.invalid('errorCode is required for failed portal commands');
    return this.commandTransition(id, input.expectedVersion, input.outcome, input, context, metadata);
  }

  private commandTransition(id: string, expectedVersion: number, target: 'ACKNOWLEDGED' | 'DISPATCHED' | 'FAILED', outcome: { readonly errorCode?: string; readonly errorMessage?: string } | undefined, context: TenantContext, metadata: CommandMetadata) {
    return this.prisma.$transaction(async (tx) => {
      const command = await tx.integrationPortalCommand.findFirst({ where: { id, tenantId: context.tenantId } });
      if (!command) this.notFound('PORTAL_COMMAND_NOT_FOUND', 'Portal command');
      this.version(command.version, expectedVersion, 'PORTAL_COMMAND_VERSION_CONFLICT');
      const allowed = command.status === 'ACCEPTED' ? ['DISPATCHED'] : command.status === 'DISPATCHED' ? ['ACKNOWLEDGED', 'FAILED'] : [];
      if (!allowed.includes(target)) this.transition('PORTAL_COMMAND_TRANSITION_INVALID', command.status);
      const changed = await tx.integrationPortalCommand.update({
        data: {
          ...(target === 'DISPATCHED' ? { dispatchedAt: new Date() } : { completedAt: new Date() }),
          errorCode: target === 'FAILED' ? (outcome?.errorCode?.trim() ?? null) : null,
          errorMessage: target === 'FAILED' ? (outcome?.errorMessage?.trim() ?? null) : null,
          status: target,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(tx, 'PortalCommand', id, changed.version, `integration.portal-command-${target.toLowerCase()}.v1`, context, metadata, { businessRef: command.businessRef, commandType: command.commandType, status: changed.status, targetDomain: command.targetDomain });
      return { portalCommandId: id, status: changed.status, version: changed.version };
    });
  }

  private commandPayload(type: PortalCommandType, payload: JsonObject): void {
    this.safeSnapshot(payload);
    if (!Object.keys(payload).length) this.invalid('Portal command payload is required');
    if (type === 'CUSTOMER_CANCEL' && !String(payload.reason ?? '').trim()) this.invalid('Cancellation reason is required');
    if (type === 'CUSTOMER_RETURN' && !Array.isArray(payload.lines)) this.invalid('Return lines are required');
    if (type === 'MESSAGE_SEND' && !String(payload.message ?? '').trim()) this.invalid('Message content is required');
    if (type === 'ATTACHMENT_ADD') this.uuid(String(payload.attachmentId ?? ''), 'PORTAL_ATTACHMENT_INVALID');
    if (type === 'SUPPLIER_ASN_SUBMIT' && !Array.isArray(payload.lines)) this.invalid('ASN lines are required');
    if (type === 'CARRIER_TRACKING_REPORT' && !String(payload.occurredAt ?? '').trim()) this.invalid('Tracking event time is required');
    if (type === 'CARRIER_POD_SUBMIT') this.uuid(String(payload.attachmentId ?? ''), 'PORTAL_ATTACHMENT_INVALID');
  }

  private safeSnapshot(value: unknown): void {
    if (Array.isArray(value)) return value.forEach((item) => this.safeSnapshot(item));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|credential|accessToken|refreshToken|internalCost|preciseLocation/i.test(key))
        throw new AppError('PORTAL_SENSITIVE_FIELD_REJECTED', `Sensitive field ${key} cannot enter a portal snapshot`, 400);
      this.safeSnapshot(child);
    }
  }

  private permissions(input: readonly string[]): void {
    const allowed = new Set(['VIEW_ALL', 'COMMAND_ALL', ...Object.values(PROJECTION_PERMISSIONS), ...Object.values(COMMANDS).map(({ permission }) => permission)]);
    if (!input.length || input.some((permission) => !allowed.has(permission))) this.invalid('Portal permissions are invalid');
  }

  private principal(type: IntegrationPortalPrincipalType, reference: string): void {
    if (!PRINCIPAL_PROJECTIONS[type]) this.invalid('Portal principal type is invalid');
    this.text(reference, 'principalRef', 200);
  }

  private record(tx: Prisma.TransactionClient, aggregateType: string, aggregateId: string, aggregateVersion: number, eventName: string, context: TenantContext, metadata: CommandMetadata, payload: JsonObject) {
    return this.changes.record(tx, { aggregateId, aggregateType, aggregateVersion, eventName, payload: json(payload) as Prisma.InputJsonObject }, context, metadata);
  }

  private version(actual: number, expected: number, code: string): void {
    if (!Number.isSafeInteger(expected) || actual !== expected) throw new AppError(code, 'Portal aggregate version conflict', 409);
  }

  private uuid(value: string, code: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new AppError(code, 'Identifier is invalid', 400);
  }

  private text(value: string, field: string, maximum: number): string {
    const normalized = value?.trim();
    if (!normalized || normalized.length > maximum) this.invalid(`${field} is invalid`);
    return normalized;
  }

  private invalid(message: string): never {
    throw new AppError('MOBILE_PORTAL_INPUT_INVALID', message, 400);
  }

  private notFound(code: string, label: string): never {
    throw new AppError(code, `${label} was not found`, 404);
  }

  private transition(code: string, status: string): never {
    throw new AppError(code, `Operation is not allowed from ${status}`, 409);
  }
}

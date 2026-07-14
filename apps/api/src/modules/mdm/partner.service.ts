import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type GeocodeStatus, type PartnerCertificateStatus, type PartnerStatus, type ServiceZoneStatus } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isPrismaErrorCode } from '../../common/prisma-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from '../platform/idempotency.service';
import type { CommandMetadata } from '../platform/tenant.service';

export interface SavePartnerInput {
  readonly code: string;
  readonly creditCurrency?: string;
  readonly creditLimit?: string;
  readonly expectedVersion?: number;
  readonly legalName: string;
  readonly paymentTerms?: string;
  readonly registrationNo?: string;
  readonly serviceCapabilities?: Readonly<Record<string, unknown>>;
  readonly shortName?: string;
  readonly taxId?: string;
}

export interface PartnerVersionInput { readonly expectedVersion: number }

export interface AddPartnerRoleInput {
  readonly capabilities?: Readonly<Record<string, unknown>>;
  readonly partnerId: string;
  readonly roleType: 'CUSTOMER' | 'SUPPLIER' | 'CARRIER';
}

export interface AddPartnerContactInput {
  readonly email?: string;
  readonly isPrimary?: boolean;
  readonly name: string;
  readonly partnerId: string;
  readonly phone?: string;
  readonly title?: string;
}

export interface AddPartnerCertificateInput {
  readonly attachmentId?: string;
  readonly certificateNo: string;
  readonly certificateType: string;
  readonly issuedBy?: string;
  readonly partnerId: string;
  readonly validFrom?: string;
  readonly validUntil?: string;
}

export interface SaveAddressInput {
  readonly accessInstructions?: string;
  readonly addressType: string;
  readonly administrativeCode?: string;
  readonly city?: string;
  readonly code: string;
  readonly countryCode: string;
  readonly district?: string;
  readonly geoFence?: Readonly<Record<string, unknown>>;
  readonly line1?: string;
  readonly line2?: string;
  readonly partnerId: string;
  readonly postalCode?: string;
  readonly province?: string;
  readonly rawText: string;
  readonly timeWindowFrom?: string;
  readonly timeWindowUntil?: string;
}

export interface GeocodeAddressInput {
  readonly administrativeCode?: string;
  readonly city?: string;
  readonly district?: string;
  readonly expectedVersion: number;
  readonly failureReason?: string;
  readonly latitude?: string;
  readonly line1?: string;
  readonly line2?: string;
  readonly longitude?: string;
  readonly postalCode?: string;
  readonly provider?: string;
  readonly providerReference?: string;
  readonly province?: string;
  readonly targetStatus: 'VERIFIED' | 'FAILED' | 'MANUAL_CORRECTION';
}

export interface SaveServiceZoneInput {
  readonly centerLatitude?: string;
  readonly centerLongitude?: string;
  readonly code: string;
  readonly geometry?: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly partnerId?: string;
  readonly postalPrefixes?: readonly string[];
  readonly radiusKm?: string;
  readonly serviceCapabilities?: Readonly<Record<string, unknown>>;
  readonly zoneType: 'POSTAL_PREFIX' | 'POLYGON' | 'RADIUS';
}

export interface SaveExternalCodeInput {
  readonly externalCode: string;
  readonly objectId: string;
  readonly objectType: 'PARTNER';
  readonly sourceSystem: string;
}

const CODE = /^[A-Z0-9][A-Z0-9_.-]{0,99}$/;
const COUNTRY = /^[A-Z]{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertPartnerTransition(current: PartnerStatus, target: PartnerStatus): void {
  const allowed = (current === 'DRAFT' && target === 'ACTIVE') || (current === 'ACTIVE' && ['SUSPENDED', 'INACTIVE'].includes(target)) || (current === 'SUSPENDED' && ['ACTIVE', 'INACTIVE'].includes(target));
  if (!allowed) throw new AppError('PARTNER_TRANSITION_INVALID', `Partner transition ${current} -> ${target} is not allowed`, 409);
}

export function assertGeocodeTransition(current: GeocodeStatus, target: GeocodeStatus): void {
  const allowed = (current === 'PENDING' && ['VERIFIED', 'FAILED', 'MANUAL_CORRECTION'].includes(target)) || (current === 'FAILED' && ['VERIFIED', 'MANUAL_CORRECTION'].includes(target)) || (current === 'VERIFIED' && target === 'MANUAL_CORRECTION');
  if (!allowed) throw new AppError('ADDRESS_GEOCODE_TRANSITION_INVALID', `Address geocode transition ${current} -> ${target} is not allowed`, 409);
}

export function assertServiceZoneTransition(current: ServiceZoneStatus, target: ServiceZoneStatus): void {
  if (!((current === 'DRAFT' && target === 'ACTIVE') || (current === 'ACTIVE' && target === 'INACTIVE'))) throw new AppError('SERVICE_ZONE_TRANSITION_INVALID', `Service zone transition ${current} -> ${target} is not allowed`, 409);
}

export function assertPartnerCertificateTransition(current: PartnerCertificateStatus, target: PartnerCertificateStatus): void {
  if (!(current === 'ACTIVE' && ['INACTIVE', 'EXPIRED'].includes(target))) throw new AppError('PARTNER_CERTIFICATE_TRANSITION_INVALID', `Partner certificate transition ${current} -> ${target} is not allowed`, 409);
}

function required(value: string | undefined, field: string, max: number): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > max) throw new AppError('MDM_INPUT_INVALID', `${field} is required and must not exceed ${max} characters`, 400);
  return normalized;
}

function optional(value: string | undefined, max: number): string | null {
  if (value === undefined || !value.trim()) return null;
  const normalized = value.trim();
  if (normalized.length > max) throw new AppError('MDM_INPUT_INVALID', `Value must not exceed ${max} characters`, 400);
  return normalized;
}

function decimal(value: string | undefined, field: string, minimum?: number): Prisma.Decimal | null {
  if (value === undefined) return null;
  try {
    const parsed = new Prisma.Decimal(value);
    if (!parsed.isFinite() || (minimum !== undefined && parsed.lessThan(minimum))) throw new Error('range');
    return parsed;
  } catch { throw new AppError('MDM_DECIMAL_INVALID', `${field} is invalid`, 400); }
}

function dateOnly(value: string | undefined, field: string): Date | null {
  if (value === undefined) return null;
  if (!DATE.test(value)) throw new AppError('MDM_DATE_INVALID', `${field} must use YYYY-MM-DD`, 400);
  const result = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(result.getTime())) throw new AppError('MDM_DATE_INVALID', `${field} is invalid`, 400);
  return result;
}

function json(value: Readonly<Record<string, unknown>> | undefined): Prisma.InputJsonObject { return (value ?? {}) as Prisma.InputJsonObject; }

@Injectable()
export class PartnerService {
  constructor(@Inject(IdempotencyService) private readonly idempotency: IdempotencyService, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  list(context: TenantContext, status?: PartnerStatus) {
    return this.prisma.partner.findMany({ orderBy: [{ code: 'asc' }, { id: 'asc' }], take: 500, where: { ...(status ? { status } : {}), tenantId: context.tenantId } });
  }

  async get(partnerId: string, context: TenantContext) {
    this.id(partnerId, 'PARTNER_NOT_FOUND');
    const partner = await this.prisma.partner.findFirst({ where: { id: partnerId, tenantId: context.tenantId } });
    if (!partner) throw new AppError('PARTNER_NOT_FOUND', 'Partner was not found', 404);
    const [roles, contacts, certificates, addresses, serviceZones, externalCodes] = await Promise.all([
      this.prisma.partnerRole.findMany({ orderBy: { roleType: 'asc' }, where: { partnerId, tenantId: context.tenantId } }),
      this.prisma.partnerContact.findMany({ orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }], where: { partnerId, tenantId: context.tenantId } }),
      this.prisma.partnerCertificate.findMany({ orderBy: [{ certificateType: 'asc' }, { validUntil: 'desc' }], where: { partnerId, tenantId: context.tenantId } }),
      this.prisma.partnerAddress.findMany({ orderBy: { code: 'asc' }, where: { partnerId, tenantId: context.tenantId } }),
      this.prisma.serviceZone.findMany({ orderBy: { code: 'asc' }, where: { partnerId, tenantId: context.tenantId } }),
      this.prisma.externalCodeMap.findMany({ orderBy: [{ sourceSystem: 'asc' }, { versionNumber: 'desc' }], where: { objectId: partnerId, objectType: 'PARTNER', tenantId: context.tenantId } }),
    ]);
    return { ...partner, addresses, certificates, contacts, externalCodes, roles, serviceZones };
  }

  save(partnerId: string | undefined, input: SavePartnerInput, context: TenantContext, metadata: CommandMetadata) {
    const code = required(input.code, 'code', 100).toUpperCase();
    const legalName = required(input.legalName, 'legalName', 300);
    const currency = input.creditCurrency?.trim().toUpperCase();
    const creditLimit = decimal(input.creditLimit, 'creditLimit', 0);
    if (!CODE.test(code) || ((creditLimit === null) !== (currency === undefined)) || (currency !== undefined && !CURRENCY.test(currency))) throw new AppError('PARTNER_INVALID', 'Partner code or credit fields are invalid', 400);
    return this.idempotency.execute({ actorId: context.accountId, key: metadata.idempotencyKey, payload: { partnerId, ...input }, responseCode: partnerId ? 200 : 201, scope: partnerId ? 'mdm.partner.update.v1' : 'mdm.partner.create.v1', tenantId: context.tenantId }, async (transaction) => {
      if (!partnerId) {
        const partner = await transaction.partner.create({ data: { code, createdBy: context.accountId, creditCurrency: currency ?? null, creditLimit, id: randomUUID(), legalName, paymentTerms: optional(input.paymentTerms, 200), registrationNo: optional(input.registrationNo, 100), serviceCapabilities: json(input.serviceCapabilities), shortName: optional(input.shortName, 200), taxId: optional(input.taxId, 100), tenantId: context.tenantId, updatedBy: context.accountId } });
        await this.record(transaction, 'Partner', partner.id, partner.version, 'mdm.partner-created.v1', 'partner.create', context, metadata, { code, status: partner.status });
        return { partnerId: partner.id, status: partner.status, version: partner.version };
      }
      this.id(partnerId, 'PARTNER_NOT_FOUND');
      const existing = await transaction.partner.findFirst({ where: { id: partnerId, tenantId: context.tenantId } });
      if (!existing) throw new AppError('PARTNER_NOT_FOUND', 'Partner was not found', 404);
      this.expected(existing.version, input.expectedVersion, 'PARTNER_VERSION_CONFLICT');
      if (existing.status === 'INACTIVE') throw new AppError('PARTNER_INACTIVE', 'Inactive partner cannot be changed', 409);
      if (existing.code !== code) throw new AppError('PARTNER_CODE_IMMUTABLE', 'Partner code cannot be changed', 409);
      const partner = await transaction.partner.update({ data: { creditCurrency: currency ?? null, creditLimit, legalName, paymentTerms: optional(input.paymentTerms, 200), registrationNo: optional(input.registrationNo, 100), serviceCapabilities: json(input.serviceCapabilities), shortName: optional(input.shortName, 200), taxId: optional(input.taxId, 100), updatedBy: context.accountId, version: { increment: 1 } }, where: { id: partnerId } });
      await this.record(transaction, 'Partner', partner.id, partner.version, 'mdm.partner-updated.v1', 'partner.update', context, metadata, { legalName, status: partner.status }, { legalName: existing.legalName, status: existing.status });
      return { partnerId: partner.id, status: partner.status, version: partner.version };
    }).catch((error: unknown) => { throw this.unique(error, 'PARTNER_CODE_CONFLICT', 'Partner code already exists'); });
  }

  transition(partnerId: string, target: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE', input: PartnerVersionInput, context: TenantContext, metadata: CommandMetadata) {
    this.id(partnerId, 'PARTNER_NOT_FOUND');
    return this.idempotency.execute({ actorId: context.accountId, key: metadata.idempotencyKey, payload: { partnerId, target, ...input }, responseCode: 200, scope: 'mdm.partner.transition.v1', tenantId: context.tenantId }, async (transaction) => {
      const partner = await transaction.partner.findFirst({ where: { id: partnerId, tenantId: context.tenantId } });
      if (!partner) throw new AppError('PARTNER_NOT_FOUND', 'Partner was not found', 404);
      this.expected(partner.version, input.expectedVersion, 'PARTNER_VERSION_CONFLICT');
      assertPartnerTransition(partner.status, target);
      if (target === 'ACTIVE' && !(await transaction.partnerRole.count({ where: { partnerId, status: 'ACTIVE', tenantId: context.tenantId } }))) throw new AppError('PARTNER_ROLE_REQUIRED', 'At least one active partner role is required', 409);
      const changed = await transaction.partner.update({ data: { status: target, updatedBy: context.accountId, version: { increment: 1 } }, where: { id: partnerId } });
      await this.record(transaction, 'Partner', changed.id, changed.version, `mdm.partner-${target.toLowerCase()}.v1`, 'partner.transition', context, metadata, { status: changed.status }, { status: partner.status });
      return { partnerId: changed.id, status: changed.status, version: changed.version };
    });
  }

  addRole(input: AddPartnerRoleInput, context: TenantContext, metadata: CommandMetadata) {
    this.id(input.partnerId, 'PARTNER_NOT_FOUND');
    return this.childCreate('PartnerRole', 'mdm.partner-role-created.v1', 'mdm.partner-role.create.v1', input, context, metadata, async (transaction) => {
      await this.partnerMutable(transaction, input.partnerId, context);
      const role = await transaction.partnerRole.create({ data: { capabilities: json(input.capabilities), createdBy: context.accountId, id: randomUUID(), partnerId: input.partnerId, roleType: input.roleType, tenantId: context.tenantId, updatedBy: context.accountId } });
      return { aggregateId: role.id, result: { partnerRoleId: role.id, status: role.status, version: role.version }, version: role.version };
    }, 'PARTNER_ROLE_CONFLICT', 'Partner already has this role');
  }

  addContact(input: AddPartnerContactInput, context: TenantContext, metadata: CommandMetadata) {
    this.id(input.partnerId, 'PARTNER_NOT_FOUND');
    const name = required(input.name, 'name', 200);
    const email = optional(input.email, 320);
    const phone = optional(input.phone, 50);
    if (!email && !phone) throw new AppError('PARTNER_CONTACT_INVALID', 'Contact requires email or phone', 400);
    return this.childCreate('PartnerContact', 'mdm.partner-contact-created.v1', 'mdm.partner-contact.create.v1', input, context, metadata, async (transaction) => {
      await this.partnerMutable(transaction, input.partnerId, context);
      if (input.isPrimary) await transaction.partnerContact.updateMany({ data: { isPrimary: false, updatedBy: context.accountId, version: { increment: 1 } }, where: { partnerId: input.partnerId, status: 'ACTIVE', tenantId: context.tenantId } });
      const contact = await transaction.partnerContact.create({ data: { createdBy: context.accountId, email, id: randomUUID(), isPrimary: input.isPrimary ?? false, name, partnerId: input.partnerId, phone, tenantId: context.tenantId, title: optional(input.title, 100), updatedBy: context.accountId } });
      return { aggregateId: contact.id, result: { contactId: contact.id, status: contact.status, version: contact.version }, version: contact.version };
    });
  }

  addCertificate(input: AddPartnerCertificateInput, context: TenantContext, metadata: CommandMetadata) {
    this.id(input.partnerId, 'PARTNER_NOT_FOUND');
    if (input.attachmentId !== undefined && !isUuid(input.attachmentId)) throw new AppError('PARTNER_CERTIFICATE_INVALID', 'attachmentId is invalid', 400);
    const validFrom = dateOnly(input.validFrom, 'validFrom');
    const validUntil = dateOnly(input.validUntil, 'validUntil');
    if (validFrom && validUntil && validUntil < validFrom) throw new AppError('PARTNER_CERTIFICATE_DATE_INVALID', 'Certificate validity range is invalid', 400);
    const certificateType = required(input.certificateType, 'certificateType', 100).toUpperCase();
    const certificateNo = required(input.certificateNo, 'certificateNo', 150);
    return this.childCreate('PartnerCertificate', 'mdm.partner-certificate-created.v1', 'mdm.partner-certificate.create.v1', input, context, metadata, async (transaction) => {
      await this.partnerMutable(transaction, input.partnerId, context);
      const certificate = await transaction.partnerCertificate.create({ data: { attachmentId: input.attachmentId ?? null, certificateNo, certificateType, createdBy: context.accountId, id: randomUUID(), issuedBy: optional(input.issuedBy, 200), partnerId: input.partnerId, tenantId: context.tenantId, updatedBy: context.accountId, validFrom, validUntil } });
      return { aggregateId: certificate.id, result: { certificateId: certificate.id, status: certificate.status, version: certificate.version }, version: certificate.version };
    }, 'PARTNER_CERTIFICATE_CONFLICT', 'Certificate already exists');
  }

  deactivateChild(kind: 'role' | 'contact' | 'certificate' | 'address', childId: string, input: PartnerVersionInput, context: TenantContext, metadata: CommandMetadata) {
    this.id(childId, 'PARTNER_CHILD_NOT_FOUND');
    return this.idempotency.execute({ actorId: context.accountId, key: metadata.idempotencyKey, payload: { childId, kind, ...input }, responseCode: 200, scope: `mdm.partner-${kind}.deactivate.v1`, tenantId: context.tenantId }, async (transaction) => {
      if (kind === 'role') {
        const row = await transaction.partnerRole.findFirst({ where: { id: childId, tenantId: context.tenantId } });
        if (!row) throw new AppError('PARTNER_ROLE_NOT_FOUND', 'Partner role was not found', 404);
        this.expected(row.version, input.expectedVersion, 'PARTNER_ROLE_VERSION_CONFLICT');
        if (row.status !== 'ACTIVE') throw new AppError('PARTNER_ROLE_TRANSITION_INVALID', 'Only active role can be deactivated', 409);
        const changed = await transaction.partnerRole.update({ data: { status: 'INACTIVE', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: childId } });
        await this.record(transaction, 'PartnerRole', childId, changed.version, 'mdm.partner-role-inactivated.v1', 'partner-role.inactivate', context, metadata, { status: changed.status }, { status: row.status });
        return { id: childId, status: changed.status, version: changed.version };
      }
      if (kind === 'contact') {
        const row = await transaction.partnerContact.findFirst({ where: { id: childId, tenantId: context.tenantId } });
        if (!row) throw new AppError('PARTNER_CONTACT_NOT_FOUND', 'Partner contact was not found', 404);
        this.expected(row.version, input.expectedVersion, 'PARTNER_CONTACT_VERSION_CONFLICT');
        if (row.status !== 'ACTIVE') throw new AppError('PARTNER_CONTACT_TRANSITION_INVALID', 'Only active contact can be deactivated', 409);
        const changed = await transaction.partnerContact.update({ data: { status: 'INACTIVE', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: childId } });
        await this.record(transaction, 'PartnerContact', childId, changed.version, 'mdm.partner-contact-inactivated.v1', 'partner-contact.inactivate', context, metadata, { status: changed.status }, { status: row.status });
        return { id: childId, status: changed.status, version: changed.version };
      }
      if (kind === 'certificate') {
        const row = await transaction.partnerCertificate.findFirst({ where: { id: childId, tenantId: context.tenantId } });
        if (!row) throw new AppError('PARTNER_CERTIFICATE_NOT_FOUND', 'Partner certificate was not found', 404);
        this.expected(row.version, input.expectedVersion, 'PARTNER_CERTIFICATE_VERSION_CONFLICT');
        assertPartnerCertificateTransition(row.status, 'INACTIVE');
        const changed = await transaction.partnerCertificate.update({ data: { status: 'INACTIVE', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: childId } });
        await this.record(transaction, 'PartnerCertificate', childId, changed.version, 'mdm.partner-certificate-inactivated.v1', 'partner-certificate.inactivate', context, metadata, { status: changed.status }, { status: row.status });
        return { id: childId, status: changed.status, version: changed.version };
      }
      const row = await transaction.partnerAddress.findFirst({ where: { id: childId, tenantId: context.tenantId } });
      if (!row) throw new AppError('PARTNER_ADDRESS_NOT_FOUND', 'Partner address was not found', 404);
      this.expected(row.version, input.expectedVersion, 'PARTNER_ADDRESS_VERSION_CONFLICT');
      if (row.status !== 'ACTIVE') throw new AppError('PARTNER_ADDRESS_TRANSITION_INVALID', 'Only active address can be deactivated', 409);
      const changed = await transaction.partnerAddress.update({ data: { status: 'INACTIVE', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: childId } });
      await this.record(transaction, 'PartnerAddress', childId, changed.version, 'mdm.partner-address-inactivated.v1', 'partner-address.inactivate', context, metadata, { status: changed.status }, { status: row.status });
      return { id: childId, status: changed.status, version: changed.version };
    });
  }

  expireCertificate(certificateId: string, input: PartnerVersionInput, context: TenantContext, metadata: CommandMetadata) {
    this.id(certificateId, 'PARTNER_CERTIFICATE_NOT_FOUND');
    return this.idempotency.execute({ actorId: context.accountId, key: metadata.idempotencyKey, payload: { certificateId, ...input }, responseCode: 200, scope: 'mdm.partner-certificate.expire.v1', tenantId: context.tenantId }, async (transaction) => {
      const certificate = await transaction.partnerCertificate.findFirst({ where: { id: certificateId, tenantId: context.tenantId } });
      if (!certificate) throw new AppError('PARTNER_CERTIFICATE_NOT_FOUND', 'Partner certificate was not found', 404);
      this.expected(certificate.version, input.expectedVersion, 'PARTNER_CERTIFICATE_VERSION_CONFLICT');
      assertPartnerCertificateTransition(certificate.status, 'EXPIRED');
      if (!certificate.validUntil || certificate.validUntil >= new Date()) throw new AppError('PARTNER_CERTIFICATE_NOT_EXPIRED', 'Certificate validity has not ended', 409);
      const changed = await transaction.partnerCertificate.update({ data: { status: 'EXPIRED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: certificateId } });
      await this.record(transaction, 'PartnerCertificate', changed.id, changed.version, 'mdm.partner-certificate-expired.v1', 'partner-certificate.expire', context, metadata, { status: changed.status }, { status: certificate.status });
      return { certificateId: changed.id, status: changed.status, version: changed.version };
    });
  }

  saveAddress(input: SaveAddressInput, context: TenantContext, metadata: CommandMetadata) {
    this.id(input.partnerId, 'PARTNER_NOT_FOUND');
    const code = required(input.code, 'code', 100).toUpperCase();
    const rawText = required(input.rawText, 'rawText', 2000);
    const countryCode = required(input.countryCode, 'countryCode', 2).toUpperCase();
    if (!CODE.test(code) || !COUNTRY.test(countryCode) || ((input.timeWindowFrom === undefined) !== (input.timeWindowUntil === undefined)) || (input.timeWindowFrom !== undefined && (!TIME.test(input.timeWindowFrom) || !TIME.test(input.timeWindowUntil!)))) throw new AppError('PARTNER_ADDRESS_INVALID', 'Address code, country or time window is invalid', 400);
    return this.childCreate('PartnerAddress', 'mdm.partner-address-created.v1', 'mdm.partner-address.create.v1', input, context, metadata, async (transaction) => {
      await this.partnerMutable(transaction, input.partnerId, context);
      const address = await transaction.partnerAddress.create({ data: { accessInstructions: optional(input.accessInstructions, 2000), addressType: required(input.addressType, 'addressType', 50).toUpperCase(), administrativeCode: optional(input.administrativeCode, 50), city: optional(input.city, 100), code, countryCode, createdBy: context.accountId, district: optional(input.district, 100), geoFence: json(input.geoFence), id: randomUUID(), line1: optional(input.line1, 500), line2: optional(input.line2, 500), partnerId: input.partnerId, postalCode: optional(input.postalCode, 30), province: optional(input.province, 100), rawText, tenantId: context.tenantId, timeWindowFrom: input.timeWindowFrom ?? null, timeWindowUntil: input.timeWindowUntil ?? null, updatedBy: context.accountId } });
      return { aggregateId: address.id, result: { addressId: address.id, geocodeStatus: address.geocodeStatus, status: address.status, version: address.version }, version: address.version };
    }, 'PARTNER_ADDRESS_CODE_CONFLICT', 'Address code already exists for this partner');
  }

  geocode(addressId: string, input: GeocodeAddressInput, context: TenantContext, metadata: CommandMetadata) {
    this.id(addressId, 'PARTNER_ADDRESS_NOT_FOUND');
    const longitude = decimal(input.longitude, 'longitude');
    const latitude = decimal(input.latitude, 'latitude');
    if (input.targetStatus === 'FAILED' ? !input.failureReason?.trim() : longitude === null || latitude === null || longitude.lessThan(-180) || longitude.greaterThan(180) || latitude.lessThan(-90) || latitude.greaterThan(90)) throw new AppError('ADDRESS_GEOCODE_RESULT_INVALID', 'Geocode result does not match target status', 400);
    return this.idempotency.execute({ actorId: context.accountId, key: metadata.idempotencyKey, payload: { addressId, ...input }, responseCode: 200, scope: 'mdm.partner-address.geocode.v1', tenantId: context.tenantId }, async (transaction) => {
      const address = await transaction.partnerAddress.findFirst({ where: { id: addressId, tenantId: context.tenantId } });
      if (!address) throw new AppError('PARTNER_ADDRESS_NOT_FOUND', 'Partner address was not found', 404);
      this.expected(address.version, input.expectedVersion, 'PARTNER_ADDRESS_VERSION_CONFLICT');
      if (address.status !== 'ACTIVE') throw new AppError('PARTNER_ADDRESS_INACTIVE', 'Inactive address cannot be geocoded', 409);
      assertGeocodeTransition(address.geocodeStatus, input.targetStatus);
      const failed = input.targetStatus === 'FAILED';
      const manual = input.targetStatus === 'MANUAL_CORRECTION';
      const changed = await transaction.partnerAddress.update({ data: { administrativeCode: optional(input.administrativeCode, 50) ?? address.administrativeCode, city: optional(input.city, 100) ?? address.city, correctedAt: manual ? new Date() : null, correctedBy: manual ? context.accountId : null, district: optional(input.district, 100) ?? address.district, geocodeFailureReason: failed ? required(input.failureReason, 'failureReason', 500) : null, geocodeProvider: failed ? optional(input.provider, 100) : required(input.provider ?? (manual ? 'MANUAL' : undefined), 'provider', 100), geocodeReference: optional(input.providerReference, 200), geocodeStatus: input.targetStatus, geocodedAt: failed ? null : new Date(), latitude: failed ? null : latitude, line1: optional(input.line1, 500) ?? address.line1, line2: optional(input.line2, 500) ?? address.line2, longitude: failed ? null : longitude, postalCode: optional(input.postalCode, 30) ?? address.postalCode, province: optional(input.province, 100) ?? address.province, updatedBy: context.accountId, version: { increment: 1 } }, where: { id: addressId } });
      await this.record(transaction, 'PartnerAddress', changed.id, changed.version, failed ? 'mdm.partner-address-geocode-failed.v1' : 'mdm.partner-address-geocoded.v1', 'partner-address.geocode', context, metadata, { geocodeStatus: changed.geocodeStatus, rawText: changed.rawText }, { geocodeStatus: address.geocodeStatus, rawText: address.rawText });
      return { addressId: changed.id, geocodeStatus: changed.geocodeStatus, rawText: changed.rawText, version: changed.version };
    });
  }

  listCorrectionQueue(context: TenantContext) {
    return this.prisma.partnerAddress.findMany({ orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 500, where: { geocodeStatus: 'FAILED', status: 'ACTIVE', tenantId: context.tenantId } });
  }

  saveServiceZone(input: SaveServiceZoneInput, context: TenantContext, metadata: CommandMetadata) {
    const code = required(input.code, 'code', 100).toUpperCase();
    const name = required(input.name, 'name', 200);
    if (!CODE.test(code) || (input.partnerId !== undefined && !isUuid(input.partnerId))) throw new AppError('SERVICE_ZONE_INVALID', 'Service zone input is invalid', 400);
    const longitude = decimal(input.centerLongitude, 'centerLongitude');
    const latitude = decimal(input.centerLatitude, 'centerLatitude');
    const radius = decimal(input.radiusKm, 'radiusKm', 0.000001);
    const geometry = json(input.geometry);
    const prefixes = (input.postalPrefixes ?? []).map((item) => required(item, 'postalPrefix', 30));
    if ((input.zoneType === 'POSTAL_PREFIX' && !prefixes.length) || (input.zoneType === 'POLYGON' && !Object.keys(geometry).length) || (input.zoneType === 'RADIUS' && (longitude === null || latitude === null || radius === null || longitude.lessThan(-180) || longitude.greaterThan(180) || latitude.lessThan(-90) || latitude.greaterThan(90)))) throw new AppError('SERVICE_ZONE_DEFINITION_INVALID', 'Service zone definition does not match its type', 400);
    return this.childCreate('ServiceZone', 'mdm.service-zone-created.v1', 'mdm.service-zone.create.v1', input, context, metadata, async (transaction) => {
      if (input.partnerId) await this.partnerMutable(transaction, input.partnerId, context);
      const zone = await transaction.serviceZone.create({ data: { centerLatitude: latitude, centerLongitude: longitude, code, createdBy: context.accountId, geometry, id: randomUUID(), name, partnerId: input.partnerId ?? null, postalPrefixes: prefixes, radiusKm: radius, serviceCapabilities: json(input.serviceCapabilities), tenantId: context.tenantId, updatedBy: context.accountId, zoneType: input.zoneType } });
      return { aggregateId: zone.id, result: { serviceZoneId: zone.id, status: zone.status, version: zone.version }, version: zone.version };
    }, 'SERVICE_ZONE_CODE_CONFLICT', 'Service zone code already exists');
  }

  transitionServiceZone(zoneId: string, target: 'ACTIVE' | 'INACTIVE', input: PartnerVersionInput, context: TenantContext, metadata: CommandMetadata) {
    this.id(zoneId, 'SERVICE_ZONE_NOT_FOUND');
    return this.idempotency.execute({ actorId: context.accountId, key: metadata.idempotencyKey, payload: { zoneId, target, ...input }, responseCode: 200, scope: 'mdm.service-zone.transition.v1', tenantId: context.tenantId }, async (transaction) => {
      const zone = await transaction.serviceZone.findFirst({ where: { id: zoneId, tenantId: context.tenantId } });
      if (!zone) throw new AppError('SERVICE_ZONE_NOT_FOUND', 'Service zone was not found', 404);
      this.expected(zone.version, input.expectedVersion, 'SERVICE_ZONE_VERSION_CONFLICT');
      assertServiceZoneTransition(zone.status, target);
      const changed = await transaction.serviceZone.update({ data: { status: target, updatedBy: context.accountId, version: { increment: 1 } }, where: { id: zoneId } });
      await this.record(transaction, 'ServiceZone', zoneId, changed.version, `mdm.service-zone-${target.toLowerCase()}.v1`, 'service-zone.transition', context, metadata, { status: changed.status }, { status: zone.status });
      return { serviceZoneId: zoneId, status: changed.status, version: changed.version };
    });
  }

  saveExternalCode(input: SaveExternalCodeInput, context: TenantContext, metadata: CommandMetadata) {
    this.id(input.objectId, 'PARTNER_NOT_FOUND');
    const sourceSystem = required(input.sourceSystem, 'sourceSystem', 100).toUpperCase();
    const externalCode = required(input.externalCode, 'externalCode', 200);
    return this.idempotency.execute({ actorId: context.accountId, key: metadata.idempotencyKey, payload: input, responseCode: 201, scope: 'mdm.external-code.save.v1', tenantId: context.tenantId }, async (transaction) => {
      await this.partnerMutable(transaction, input.objectId, context);
      const current = await transaction.externalCodeMap.findFirst({ where: { objectId: input.objectId, objectType: input.objectType, sourceSystem, status: 'ACTIVE', tenantId: context.tenantId } });
      const latest = await transaction.externalCodeMap.findFirst({ orderBy: { versionNumber: 'desc' }, where: { objectId: input.objectId, objectType: input.objectType, sourceSystem, tenantId: context.tenantId } });
      if (current?.externalCode === externalCode) throw new AppError('EXTERNAL_CODE_UNCHANGED', 'External code is already active for this object', 409);
      if (current) await transaction.externalCodeMap.update({ data: { effectiveUntil: new Date(), status: 'INACTIVE', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: current.id } });
      const mapping = await transaction.externalCodeMap.create({ data: { createdBy: context.accountId, externalCode, id: randomUUID(), mappingSnapshot: { externalCode, objectId: input.objectId, objectType: input.objectType, sourceSystem }, objectId: input.objectId, objectType: input.objectType, sourceSystem, tenantId: context.tenantId, updatedBy: context.accountId, versionNumber: (latest?.versionNumber ?? 0) + 1 } });
      await this.record(transaction, 'ExternalCodeMap', mapping.id, mapping.version, 'mdm.external-code-versioned.v1', 'external-code.version', context, metadata, { externalCode, objectId: input.objectId, versionNumber: mapping.versionNumber }, current ? { externalCode: current.externalCode, objectId: current.objectId, versionNumber: current.versionNumber } : undefined);
      return { externalCodeMapId: mapping.id, status: mapping.status, version: mapping.version, versionNumber: mapping.versionNumber };
    }).catch((error: unknown) => { throw this.unique(error, 'EXTERNAL_CODE_CONFLICT', 'External code is already mapped in this source and object type'); });
  }

  async resolveExternalCode(sourceInput: string, objectType: string, externalInput: string, context: TenantContext) {
    const sourceSystem = required(sourceInput, 'sourceSystem', 100).toUpperCase();
    const externalCode = required(externalInput, 'externalCode', 200);
    const mapping = await this.prisma.externalCodeMap.findFirst({ where: { externalCode, objectType: objectType.toUpperCase(), sourceSystem, status: 'ACTIVE', tenantId: context.tenantId } });
    if (!mapping) throw new AppError('EXTERNAL_CODE_NOT_FOUND', 'Active external code mapping was not found', 404);
    return mapping;
  }

  private async partnerMutable(transaction: Prisma.TransactionClient, partnerId: string, context: TenantContext) {
    const partner = await transaction.partner.findFirst({ where: { id: partnerId, tenantId: context.tenantId } });
    if (!partner) throw new AppError('PARTNER_NOT_FOUND', 'Partner was not found', 404);
    if (partner.status === 'INACTIVE') throw new AppError('PARTNER_INACTIVE', 'Inactive partner cannot be changed', 409);
    return partner;
  }

  private childCreate<T extends Record<string, unknown>>(aggregateType: string, eventName: string, scope: string, payload: unknown, context: TenantContext, metadata: CommandMetadata, operation: (transaction: Prisma.TransactionClient) => Promise<{ aggregateId: string; result: T; version: number }>, conflictCode?: string, conflictMessage?: string) {
    return this.idempotency.execute({ actorId: context.accountId, key: metadata.idempotencyKey, payload, responseCode: 201, scope, tenantId: context.tenantId }, async (transaction) => {
      const created = await operation(transaction);
      await this.record(transaction, aggregateType, created.aggregateId, created.version, eventName, `${aggregateType}.create`, context, metadata, created.result as Prisma.InputJsonObject);
      return created.result;
    }).catch((error: unknown) => { throw conflictCode && conflictMessage ? this.unique(error, conflictCode, conflictMessage) : error; });
  }

  private async record(transaction: Prisma.TransactionClient, aggregateType: string, aggregateId: string, aggregateVersion: number, eventName: string, action: string, context: TenantContext, metadata: CommandMetadata, after: Prisma.InputJsonObject, before?: Prisma.InputJsonObject) {
    await Promise.all([
      transaction.platformAuditLog.create({ data: { action, after, ...(before ? { before } : {}), category: 'BUSINESS_CHANGE', correlationId: metadata.correlationId, createdBy: context.accountId, deviceId: context.deviceId, ipAddress: metadata.ipAddress ?? null, resourceId: aggregateId, resourceType: aggregateType, tenantId: context.tenantId, updatedBy: context.accountId } }),
      transaction.platformOutbox.create({ data: { aggregateId, aggregateType, aggregateVersion, correlationId: metadata.correlationId, createdBy: context.accountId, eventName, payload: { aggregateId, tenantId: context.tenantId, version: aggregateVersion }, tenantId: context.tenantId, updatedBy: context.accountId } }),
    ]);
  }

  private id(value: string, code: string) { if (!isUuid(value)) throw new AppError(code, 'Resource was not found', 404); }
  private expected(actual: number, expected: number | undefined, code: string) { if (!Number.isInteger(expected) || actual !== expected) throw new AppError(code, 'Resource changed; refresh and retry', 409, { retryable: true }); }
  private unique(error: unknown, code: string, message: string): unknown { return isPrismaErrorCode(error, 'P2002') ? new AppError(code, message, 409) : error; }
}

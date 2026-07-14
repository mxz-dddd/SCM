import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { IdempotencyService } from '../platform/idempotency.service';
import { PartnerService } from './partner.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('partner, address and service zone persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('preserves raw addresses and external-code history with tenant isolation and idempotency', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = { accountId: actorId, accountKind: 'TENANT_ADMIN', deviceId: 'partner-database-test', organizationIds: [], permissionVersion: 1, tenantId, tokenId: randomUUID() };
    const other: TenantContext = { ...context, tenantId: randomUUID() };
    const command = (key = randomUUID()) => ({ correlationId: randomUUID(), idempotencyKey: key, ipAddress: '127.0.0.1' });
    const service = new PartnerService(new IdempotencyService(prisma as never), prisma as never);
    try {
      const input = { code: `P-${randomUUID().slice(0, 8).toUpperCase()}`, creditCurrency: 'CNY', creditLimit: '100000.25', legalName: '测试供应链有限公司', serviceCapabilities: { coldChain: true }, taxId: 'TAX-001' };
      const key = randomUUID();
      const created = await service.save(undefined, input, context, command(key));
      await expect(service.save(undefined, input, context, command(key))).resolves.toEqual(created);
      await expect(service.save(undefined, { ...input, legalName: '异内容' }, context, command(key))).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT', statusCode: 409 });
      await expect(service.transition(created.partnerId, 'ACTIVE', { expectedVersion: created.version }, context, command())).rejects.toMatchObject({ code: 'PARTNER_ROLE_REQUIRED', statusCode: 409 });

      const customerRole = await service.addRole({ capabilities: { ordering: true }, partnerId: created.partnerId, roleType: 'CUSTOMER' }, context, command());
      await service.addRole({ capabilities: { supply: true }, partnerId: created.partnerId, roleType: 'SUPPLIER' }, context, command());
      const contact = await service.addContact({ email: 'contact@example.test', isPrimary: true, name: '张三', partnerId: created.partnerId }, context, command());
      const certificate = await service.addCertificate({ certificateNo: 'CERT-001', certificateType: 'BUSINESS_LICENSE', partnerId: created.partnerId, validFrom: '2026-01-01', validUntil: '2030-12-31' }, context, command());
      const expiredCertificate = await service.addCertificate({ certificateNo: 'CERT-OLD', certificateType: 'CARRIER_LICENSE', partnerId: created.partnerId, validUntil: '2025-12-31' }, context, command());
      await expect(service.expireCertificate(expiredCertificate.certificateId, { expectedVersion: expiredCertificate.version }, context, command())).resolves.toMatchObject({ status: 'EXPIRED' });
      const address = await service.saveAddress({ addressType: 'SHIP_TO', city: '上海市', code: 'SH-01', countryCode: 'CN', partnerId: created.partnerId, rawText: '上海市浦东新区原始地址 88 号', timeWindowFrom: '09:00', timeWindowUntil: '18:00' }, context, command());
      const failure = await service.geocode(address.addressId, { expectedVersion: address.version, failureReason: 'NO_MATCH', provider: 'TEST', targetStatus: 'FAILED' }, context, command());
      expect(failure).toMatchObject({ geocodeStatus: 'FAILED', rawText: '上海市浦东新区原始地址 88 号' });
      expect((await service.listCorrectionQueue(context)).map(({ id }) => id)).toContain(address.addressId);
      const corrected = await service.geocode(address.addressId, { city: '上海市', expectedVersion: failure.version, latitude: '31.23040000', line1: '浦东新区标准路 88 号', longitude: '121.47370000', provider: 'MANUAL', targetStatus: 'MANUAL_CORRECTION' }, context, command());
      expect(corrected.rawText).toBe('上海市浦东新区原始地址 88 号');
      await expect(prisma.partnerAddress.update({ data: { rawText: '被覆盖' }, where: { id: address.addressId } })).rejects.toThrow();

      const zone = await service.saveServiceZone({ code: `ZONE-${randomUUID().slice(0, 6).toUpperCase()}`, name: '华东服务区', partnerId: created.partnerId, postalPrefixes: ['20', '21'], zoneType: 'POSTAL_PREFIX' }, context, command());
      const activeZone = await service.transitionServiceZone(zone.serviceZoneId, 'ACTIVE', { expectedVersion: zone.version }, context, command());
      await service.transitionServiceZone(zone.serviceZoneId, 'INACTIVE', { expectedVersion: activeZone.version }, context, command());

      const mapping1 = await service.saveExternalCode({ externalCode: 'ERP-CUSTOMER-001', objectId: created.partnerId, objectType: 'PARTNER', sourceSystem: 'ERP' }, context, command());
      const mapping2 = await service.saveExternalCode({ externalCode: 'ERP-CUSTOMER-002', objectId: created.partnerId, objectType: 'PARTNER', sourceSystem: 'ERP' }, context, command());
      expect(mapping2.versionNumber).toBe(mapping1.versionNumber + 1);
      await expect(service.resolveExternalCode('erp', 'partner', 'ERP-CUSTOMER-002', context)).resolves.toMatchObject({ objectId: created.partnerId, versionNumber: 2 });
      await expect(prisma.externalCodeMap.update({ data: { externalCode: 'MUTATED' }, where: { id: mapping1.externalCodeMapId } })).rejects.toThrow();
      await expect(service.get(created.partnerId, other)).rejects.toMatchObject({ code: 'PARTNER_NOT_FOUND', statusCode: 404 });

      const active = await service.transition(created.partnerId, 'ACTIVE', { expectedVersion: created.version }, context, command());
      const suspended = await service.transition(created.partnerId, 'SUSPENDED', { expectedVersion: active.version }, context, command());
      const resumed = await service.transition(created.partnerId, 'ACTIVE', { expectedVersion: suspended.version }, context, command());
      const inactive = await service.transition(created.partnerId, 'INACTIVE', { expectedVersion: resumed.version }, context, command());
      expect(inactive.status).toBe('INACTIVE');
      await expect(service.transition(created.partnerId, 'ACTIVE', { expectedVersion: inactive.version }, context, command())).rejects.toMatchObject({ code: 'PARTNER_TRANSITION_INVALID', statusCode: 409 });

      await service.deactivateChild('role', customerRole.partnerRoleId, { expectedVersion: customerRole.version }, context, command()).catch((error: unknown) => { throw error; });
      await service.deactivateChild('contact', contact.contactId, { expectedVersion: contact.version }, context, command()).catch((error: unknown) => { throw error; });
      await service.deactivateChild('certificate', certificate.certificateId, { expectedVersion: certificate.version }, context, command()).catch((error: unknown) => { throw error; });
      expect(await prisma.platformOutbox.count({ where: { aggregateType: 'Partner', tenantId } })).toBeGreaterThanOrEqual(4);
    } finally {
      await prisma.partnerRole.deleteMany({ where: { tenantId } });
      await prisma.partnerContact.deleteMany({ where: { tenantId } });
      await prisma.partnerCertificate.deleteMany({ where: { tenantId } });
      await prisma.partnerAddress.deleteMany({ where: { tenantId } });
      await prisma.serviceZone.deleteMany({ where: { tenantId } });
      await prisma.partner.deleteMany({ where: { tenantId } });
      // ExternalCodeMap and audit facts are immutable by design; random tenant IDs keep them isolated.
      await prisma.platformOutbox.deleteMany({ where: { tenantId } });
      await prisma.idempotencyRecord.deleteMany({ where: { tenantId } });
    }
  });
});

import { PrismaClient } from '@prisma/client';
import {
  ADMIN_PERMISSIONS,
  READ_ONLY_AUDITOR_PERMISSION_CODES,
} from '@scm/shared';
import { hashPassword } from '../src/modules/platform/auth/password';
import {
  PLATFORM_AUDITOR_ROLE_ID,
  PLATFORM_OPERATOR_ACCOUNT_ID,
  PLATFORM_OPERATOR_ACCOUNT_ROLE_ID,
  PLATFORM_OPERATOR_ORGANIZATION_ID,
  PLATFORM_OPERATOR_PERSON_ID,
  PLATFORM_OPERATOR_TENANT_ID,
  PLATFORM_OPERATOR_ROLE_ID,
} from '../src/modules/platform/platform.constants';

const prisma = new PrismaClient();

const seedId = '10000000-0000-4000-8000-000000000001';
const tenantId = '10000000-0000-4000-8000-000000000002';
const actorId = '10000000-0000-4000-8000-000000000003';
const packageSpecVersionId = '10000000-0000-4000-8000-000000000004';

export const DEFAULT_NUMBER_BUSINESS_TYPES = [
  'AMS_APPOINTMENT',
  'AMS_DOCK_ASSIGNMENT',
  'AMS_GATE_VERIFICATION',
  'AMS_QUEUE_TICKET',
  'AMS_RECURRING_APPOINTMENT',
  'AMS_WORKLOAD_ADJUSTMENT',
  'AMS_WORKLOAD_ESTIMATE',
  'BILLING_ACCRUAL',
  'BILLING_AP_VOUCHER',
  'BILLING_AR_VOUCHER',
  'BILLING_CHARGE_CALCULATION',
  'BILLING_CHARGE_FACT_CORRECTION',
  'BILLING_DISPUTE',
  'BILLING_PAYMENT',
  'BILLING_RECONCILIATION_ADJUSTMENT',
  'BILLING_RECONCILIATION_STATEMENT',
  'BILLING_REVERSAL',
  'CONTROL_ALERT_CASE',
  'CONTROL_FULFILLMENT_FAILURE_CASE',
  'CONTROL_RECONCILIATION_CASE',
  'OMS_BUSINESS_ORDER',
  'OMS_FULFILLMENT_ORDER',
  'OMS_ORDER_MERGE_GROUP',
  'OMS_ORDER_RELEASE_BATCH',
  'OMS_RETURN_MERCHANDISE_AUTHORIZATION',
  'OMS_SETTLEMENT_REQUEST',
  'OMS_SHIPMENT_REQUEST',
  'TMS_ACCRUAL_VOUCHER',
  'TMS_APPOINTMENT_REQUEST',
  'TMS_AP_VOUCHER',
  'TMS_AR_VOUCHER',
  'TMS_CAPACITY_POOL',
  'TMS_CAPACITY_RESERVATION',
  'TMS_CARRIER_STATEMENT',
  'TMS_CARRIER_TENDER',
  'TMS_CHARGE_CALCULATION',
  'TMS_CLAIM_CASE',
  'TMS_COMPLIANCE_CHECK',
  'TMS_CONDITION_ALERT',
  'TMS_CONSOLIDATION_PLAN',
  'TMS_CUSTOMER_STATEMENT',
  'TMS_DELIVERY_CONFIRMATION',
  'TMS_DRIVER_TASK',
  'TMS_FREIGHT_CHARGE_FACT',
  'TMS_GEOFENCE_TRACKING_EVENT',
  'TMS_LOAD_PLAN',
  'TMS_MAINTENANCE_PLAN',
  'TMS_MILESTONE_PLAN',
  'TMS_PLANNING_BATCH',
  'TMS_PROOF_OF_DELIVERY',
  'TMS_RETURN_ORDER',
  'TMS_RETURN_TRANSPORT_ORDER',
  'TMS_ROUTE_PLAN',
  'TMS_SHIPMENT',
  'TMS_SHIPMENT_DISPATCH',
  'TMS_SPOT_RFQ',
  'TMS_TELEMETRY_EXCEPTION',
  'TMS_TRACKING_EVENT',
  'TMS_TRANSPORT_EXCEPTION',
  'TMS_TRANSPORT_ORDER',
  'TMS_VEHICLE_ASSIGNMENT',
  'TMS_VEHICLE_OPERATING_FACT',
  'WMS_CANCELLATION_PLAN',
  'WMS_DEVICE_COMMAND',
  'WMS_HANDLING_UNIT',
  'WMS_INBOUND_ORDER',
  'WMS_INVENTORY_ADJUSTMENT',
  'WMS_INVENTORY_COUNT',
  'WMS_INVENTORY_EXPIRY_ALERT',
  'WMS_INVENTORY_HOLD',
  'WMS_INVENTORY_MOVEMENT',
  'WMS_INVENTORY_RECONCILIATION',
  'WMS_INVENTORY_RECONCILIATION_CASE',
  'WMS_INVENTORY_RESERVATION',
  'WMS_INVENTORY_STATUS_CHANGE',
  'WMS_INVENTORY_TRANSFER_TASK',
  'WMS_LABEL_JOB',
  'WMS_LABOR_ASSIGNMENT',
  'WMS_LOAD_TASK',
  'WMS_OUTBOUND',
  'WMS_OWNERSHIP_TRANSFER',
  'WMS_PACKAGE',
  'WMS_PACK_TASK',
  'WMS_PICK_TASK',
  'WMS_PUTAWAY_TASK',
  'WMS_QUALITY_DISPOSITION',
  'WMS_QUALITY_INSPECTION',
  'WMS_RECEIPT_TASK',
  'WMS_RECEIVING_VARIANCE',
  'WMS_REPLENISHMENT_POLICY',
  'WMS_REPLENISHMENT_TASK',
  'WMS_SHORTAGE',
  'WMS_SHORT_PICK_CASE',
  'WMS_STAGING_TASK',
  'WMS_VALUE_ADDED_ORDER',
  'WMS_WAVE',
  'WMS_WAVE_TEMPLATE',
  'WMS_WEIGHT_EXCEPTION',
] as const;

async function seed() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('SEED_ADMIN_PASSWORD is required');
  }
  const passwordHash = await hashPassword(adminPassword);

  await prisma.tenant.upsert({
    where: { id: PLATFORM_OPERATOR_TENANT_ID },
    create: {
      code: 'PLATFORM',
      createdBy: PLATFORM_OPERATOR_ACCOUNT_ID,
      currency: 'CNY',
      defaultLocale: 'zh-CN',
      id: PLATFORM_OPERATOR_TENANT_ID,
      isolationMode: 'SHARED_SCHEMA',
      name: 'SCM Platform Operations',
      status: 'ACTIVE',
      tenantId: PLATFORM_OPERATOR_TENANT_ID,
      timezone: 'Asia/Shanghai',
      updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
    },
    update: {
      name: 'SCM Platform Operations',
      updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
    },
  });
  await prisma.organization.upsert({
    where: { id: PLATFORM_OPERATOR_ORGANIZATION_ID },
    create: {
      code: 'ROOT',
      createdBy: PLATFORM_OPERATOR_ACCOUNT_ID,
      id: PLATFORM_OPERATOR_ORGANIZATION_ID,
      name: 'Platform Operations',
      path: `/${PLATFORM_OPERATOR_ORGANIZATION_ID}`,
      tenantId: PLATFORM_OPERATOR_TENANT_ID,
      type: 'GROUP',
      updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
    },
    update: {
      updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
    },
  });
  await prisma.person.upsert({
    where: { id: PLATFORM_OPERATOR_PERSON_ID },
    create: {
      createdBy: PLATFORM_OPERATOR_ACCOUNT_ID,
      displayName: 'Platform Administrator',
      employeeNo: 'PLATFORM-ADMIN',
      id: PLATFORM_OPERATOR_PERSON_ID,
      tenantId: PLATFORM_OPERATOR_TENANT_ID,
      updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
    },
    update: { updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID },
  });
  await prisma.account.upsert({
    where: { id: PLATFORM_OPERATOR_ACCOUNT_ID },
    create: {
      createdBy: PLATFORM_OPERATOR_ACCOUNT_ID,
      id: PLATFORM_OPERATOR_ACCOUNT_ID,
      kind: 'PLATFORM_ADMIN',
      passwordHash,
      tenantId: PLATFORM_OPERATOR_TENANT_ID,
      updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
      username: 'platform-admin',
    },
    update: {
      passwordHash,
      updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
    },
  });
  await prisma.identityBinding.upsert({
    where: {
      tenantId_accountId_personId: {
        accountId: PLATFORM_OPERATOR_ACCOUNT_ID,
        personId: PLATFORM_OPERATOR_PERSON_ID,
        tenantId: PLATFORM_OPERATOR_TENANT_ID,
      },
    },
    create: {
      accountId: PLATFORM_OPERATOR_ACCOUNT_ID,
      createdBy: PLATFORM_OPERATOR_ACCOUNT_ID,
      organizationId: PLATFORM_OPERATOR_ORGANIZATION_ID,
      personId: PLATFORM_OPERATOR_PERSON_ID,
      tenantId: PLATFORM_OPERATOR_TENANT_ID,
      updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
    },
    update: { updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID },
  });

  const permissionIds = new Map<string, string>();
  for (const permission of ADMIN_PERMISSIONS) {
    const storedPermission = await prisma.permission.upsert({
      where: {
        tenantId_code: {
          code: permission.code,
          tenantId: PLATFORM_OPERATOR_TENANT_ID,
        },
      },
      create: {
        ...permission,
        createdBy: PLATFORM_OPERATOR_ACCOUNT_ID,
        tenantId: PLATFORM_OPERATOR_TENANT_ID,
        updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
      },
      update: {
        name: permission.name,
        resourceRef: permission.resourceRef,
        resourceType: permission.resourceType,
        updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
      },
    });
    permissionIds.set(permission.code, storedPermission.id);
  }
  await prisma.role.upsert({
    where: { id: PLATFORM_OPERATOR_ROLE_ID },
    create: {
      code: 'PLATFORM_ADMINISTRATOR',
      createdBy: PLATFORM_OPERATOR_ACCOUNT_ID,
      id: PLATFORM_OPERATOR_ROLE_ID,
      name: 'Platform Administrator',
      tenantId: PLATFORM_OPERATOR_TENANT_ID,
      updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
    },
    update: { updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID },
  });
  for (const permission of ADMIN_PERMISSIONS) {
    const permissionId = permissionIds.get(permission.code)!;
    await prisma.rolePermission.upsert({
      where: {
        tenantId_roleId_permissionId: {
          permissionId,
          roleId: PLATFORM_OPERATOR_ROLE_ID,
          tenantId: PLATFORM_OPERATOR_TENANT_ID,
        },
      },
      create: {
        createdBy: PLATFORM_OPERATOR_ACCOUNT_ID,
        effect: 'ALLOW',
        permissionId,
        roleId: PLATFORM_OPERATOR_ROLE_ID,
        tenantId: PLATFORM_OPERATOR_TENANT_ID,
        updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
      },
      update: {
        effect: 'ALLOW',
        updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
      },
    });
  }
  await prisma.role.upsert({
    where: { id: PLATFORM_AUDITOR_ROLE_ID },
    create: {
      code: 'SECURITY_AUDITOR',
      createdBy: PLATFORM_OPERATOR_ACCOUNT_ID,
      description: 'Read-only audit log and change history access',
      id: PLATFORM_AUDITOR_ROLE_ID,
      name: 'Security Auditor',
      tenantId: PLATFORM_OPERATOR_TENANT_ID,
      updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
    },
    update: {
      description: 'Read-only audit log and change history access',
      updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
    },
  });
  for (const permissionCode of READ_ONLY_AUDITOR_PERMISSION_CODES) {
    const permissionId = permissionIds.get(permissionCode)!;
    await prisma.rolePermission.upsert({
      where: {
        tenantId_roleId_permissionId: {
          permissionId,
          roleId: PLATFORM_AUDITOR_ROLE_ID,
          tenantId: PLATFORM_OPERATOR_TENANT_ID,
        },
      },
      create: {
        createdBy: PLATFORM_OPERATOR_ACCOUNT_ID,
        effect: 'ALLOW',
        permissionId,
        roleId: PLATFORM_AUDITOR_ROLE_ID,
        tenantId: PLATFORM_OPERATOR_TENANT_ID,
        updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
      },
      update: {
        effect: 'ALLOW',
        updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
      },
    });
  }
  await prisma.accountRole.upsert({
    where: { id: PLATFORM_OPERATOR_ACCOUNT_ROLE_ID },
    create: {
      accountId: PLATFORM_OPERATOR_ACCOUNT_ID,
      createdBy: PLATFORM_OPERATOR_ACCOUNT_ID,
      id: PLATFORM_OPERATOR_ACCOUNT_ROLE_ID,
      organizationId: null,
      roleId: PLATFORM_OPERATOR_ROLE_ID,
      tenantId: PLATFORM_OPERATOR_TENANT_ID,
      updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
    },
    update: {
      organizationId: null,
      updatedBy: PLATFORM_OPERATOR_ACCOUNT_ID,
    },
  });

  await prisma.dataBaseline.upsert({
    where: { id: seedId },
    create: {
      amount: '12.340000',
      baseUom: 'EA',
      createdBy: actorId,
      currency: 'CNY',
      extensionFields: { source: 'development-seed' },
      extensionSchemaId: 'platform.data-baseline',
      extensionSchemaVersion: 1,
      id: seedId,
      originalUom: 'BOX',
      packageSpecVersionId,
      quantityBase: '120.000000',
      quantityOriginal: '12.000000',
      tenantId,
      updatedBy: actorId,
    },
    update: {
      updatedBy: actorId,
    },
  });

  for (const scopedTenantId of [PLATFORM_OPERATOR_TENANT_ID, tenantId]) {
    for (const businessType of DEFAULT_NUMBER_BUSINESS_TYPES) {
      await prisma.numberRule.upsert({
        where: {
          tenantId_businessType_organizationRef: {
            businessType,
            organizationRef: '*',
            tenantId: scopedTenantId,
          },
        },
        create: {
          blockSize: 100,
          businessType,
          createdBy:
            scopedTenantId === PLATFORM_OPERATOR_TENANT_ID
              ? PLATFORM_OPERATOR_ACCOUNT_ID
              : actorId,
          organizationRef: '*',
          prefixTemplate: '{TYPE}-{YYYY}{MM}{DD}-',
          resetPeriod: 'DAILY',
          sequenceWidth: 8,
          tenantId: scopedTenantId,
          updatedBy:
            scopedTenantId === PLATFORM_OPERATOR_TENANT_ID
              ? PLATFORM_OPERATOR_ACCOUNT_ID
              : actorId,
        },
        update: {
          prefixTemplate: '{TYPE}-{YYYY}{MM}{DD}-',
          resetPeriod: 'DAILY',
          sequenceWidth: 8,
          updatedBy:
            scopedTenantId === PLATFORM_OPERATOR_TENANT_ID
              ? PLATFORM_OPERATOR_ACCOUNT_ID
              : actorId,
        },
      });
    }
  }
}

seed()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error('database.seed.failed', error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });

import { PrismaClient } from '@prisma/client';
import { ADMIN_PERMISSIONS } from '@scm/shared';
import { hashPassword } from '../src/modules/platform/auth/password';
import {
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
  for (const [index, permission] of ADMIN_PERMISSIONS.entries()) {
    const id = `10000000-0000-4000-8000-${String(200 + index).padStart(12, '0')}`;
    permissionIds.set(permission.code, id);
    await prisma.permission.upsert({
      where: {
        tenantId_code: {
          code: permission.code,
          tenantId: PLATFORM_OPERATOR_TENANT_ID,
        },
      },
      create: {
        ...permission,
        createdBy: PLATFORM_OPERATOR_ACCOUNT_ID,
        id,
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
  for (const [index, permission] of ADMIN_PERMISSIONS.entries()) {
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
        id: `10000000-0000-4000-8000-${String(300 + index).padStart(12, '0')}`,
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
}

seed()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error('database.seed.failed', error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });

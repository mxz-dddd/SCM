import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const seedId = '10000000-0000-4000-8000-000000000001';
const tenantId = '10000000-0000-4000-8000-000000000002';
const actorId = '10000000-0000-4000-8000-000000000003';
const packageSpecVersionId = '10000000-0000-4000-8000-000000000004';

async function seed() {
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

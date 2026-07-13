import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const prismaDirectory = resolve(process.cwd(), 'prisma');
const schema = readFileSync(resolve(prismaDirectory, 'schema.prisma'), 'utf8');
const migrationDirectory = resolve(prismaDirectory, 'migrations');
const migrationName = readdirSync(migrationDirectory).find((entry) =>
  entry.endsWith('_data_baseline'),
);

if (!migrationName) {
  throw new Error('Missing data baseline migration');
}

const migration = readFileSync(
  resolve(migrationDirectory, migrationName, 'migration.sql'),
  'utf8',
);

const domainSchemas = [
  'platform',
  'mdm',
  'oms',
  'wms',
  'tms',
  'ams',
  'billing',
  'control',
  'integration',
] as const;

describe('Prisma data baseline', () => {
  it.each(domainSchemas)('declares and migrates the %s schema', (domain) => {
    expect(schema).toContain(`"${domain}"`);
    expect(migration).toContain(`CREATE SCHEMA IF NOT EXISTS "${domain}"`);
  });

  it('keeps the mandatory fields and tenant-first index on the baseline model', () => {
    for (const field of [
      'id',
      'tenantId',
      'createdAt',
      'createdBy',
      'updatedAt',
      'updatedBy',
      'version',
      'status',
    ]) {
      expect(schema).toMatch(new RegExp(`\\n\\s+${field}\\s`));
    }

    expect(schema).toContain('@@index([tenantId, status]');
  });

  it('uses decimal quantities, versioned package conversion and controlled JSON', () => {
    expect(schema).toContain('@db.Decimal(20, 6)');
    expect(schema).toContain('packageSpecVersionId');
    expect(schema).toContain('extensionSchemaId');
    expect(schema).toContain('extensionSchemaVersion');
    expect(migration).toContain(
      'jsonb_typeof("extension_fields") = \'object\'',
    );
  });

  it('does not introduce cross-domain foreign keys', () => {
    expect(migration).not.toContain('FOREIGN KEY');
  });
});

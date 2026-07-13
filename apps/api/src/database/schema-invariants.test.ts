import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const prismaDirectory = resolve(process.cwd(), 'prisma');
const schema = readFileSync(resolve(prismaDirectory, 'schema.prisma'), 'utf8');
const migrationDirectory = resolve(prismaDirectory, 'migrations');
const migrationNames = readdirSync(migrationDirectory).filter((entry) =>
  /^\d+_/.test(entry),
);
const migration = migrationNames
  .map((name) =>
    readFileSync(resolve(migrationDirectory, name, 'migration.sql'), 'utf8'),
  )
  .join('\n');

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

  it('keeps mandatory fields on every persisted model', () => {
    const models = [...schema.matchAll(/model\s+(\w+)\s+\{([\s\S]*?)\n\}/g)];
    expect(models.length).toBeGreaterThan(1);
    for (const [, name, body] of models) {
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
        expect(body, `${name}.${field}`).toMatch(
          new RegExp(`\\n\\s*${field}\\s`),
        );
      }
    }
  });

  it('keeps explicit compound indexes tenant-first', () => {
    const indexes = [...schema.matchAll(/@@(?:index|unique)\(\[([^\]]+)\]/g)];
    expect(indexes.length).toBeGreaterThan(1);
    for (const [, fields] of indexes) {
      expect(fields?.split(',')[0]?.trim()).toBe('tenantId');
    }
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

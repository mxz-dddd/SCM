import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

let files = process.argv.slice(2).filter((file) => file.endsWith('.sql'));
if (files.length === 0 && process.env.MIGRATION_BASE_SHA) {
  files = execFileSync(
    'git',
    [
      'diff',
      '--name-only',
      process.env.MIGRATION_BASE_SHA,
      'HEAD',
      '--',
      'apps/api/prisma/migrations/*/migration.sql',
    ],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter((file) => file.endsWith('.sql'));
}
if (files.length === 0) {
  process.stdout.write(
    'No migration files supplied; migration safety check skipped.\n',
  );
  process.exit(0);
}

const forbidden = [
  { code: 'DROP_TABLE', pattern: /\bDROP\s+TABLE\b/i },
  { code: 'DROP_COLUMN', pattern: /\bDROP\s+COLUMN\b/i },
  { code: 'REWRITE_COLUMN', pattern: /\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i },
  {
    code: 'BLOCKING_INDEX',
    pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b(?!\s+CONCURRENTLY)/i,
  },
];

let failed = false;
for (const file of files) {
  if (!file.endsWith('.sql')) continue;
  const sql = readFileSync(file, 'utf8');
  const phase = sql
    .match(/^--\s*phase:\s*(expand|migrate|contract)\s*$/im)?.[1]
    ?.toUpperCase();
  if (!phase) {
    process.stderr.write(
      `${file}: missing -- phase: expand|migrate|contract\n`,
    );
    failed = true;
  }
  for (const rule of forbidden) {
    if (!rule.pattern.test(sql)) continue;
    if (
      rule.code === 'BLOCKING_INDEX' &&
      /^--\s*online-index-safe:\s*new-table\s*$/im.test(sql)
    )
      continue;
    if (
      phase === 'CONTRACT' &&
      /^--\s*contract-approved:\s*true\s*$/im.test(sql)
    )
      continue;
    process.stderr.write(
      `${file}: ${rule.code} requires contract phase and explicit contract-approved evidence\n`,
    );
    failed = true;
  }
  if (
    /\bLOCK\s+TABLE\b/i.test(sql) &&
    !/^--\s*online-lock-reviewed:\s*true\s*$/im.test(sql)
  ) {
    process.stderr.write(
      `${file}: LOCK TABLE requires online-lock-reviewed evidence\n`,
    );
    failed = true;
  }
}
if (failed) process.exit(1);
process.stdout.write(
  `Migration safety check passed for ${files.length} file(s).\n`,
);

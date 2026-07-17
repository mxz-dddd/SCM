import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readJson, repositoryRoot } from './shared.mjs';

const catalogPath = path.join(
  repositoryRoot,
  'docs/ui-parity/reference-page-catalog.json',
);
const catalog = await readJson(catalogPath);
const schema = await readJson(
  path.join(
    repositoryRoot,
    'docs/ui-parity/reference-page-catalog.schema.json',
  ),
);
const routeRegistrySource = await readFile(
  path.join(repositoryRoot, 'apps/web/src/router/route-registry.tsx'),
  'utf8',
);
const records = catalog.records ?? [];
const failures = [];
const validStatuses = new Set([
  'IMPLEMENTED',
  'PARTIAL',
  'MISSING',
  'NOT_APPLICABLE',
  'BLOCKED',
]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const redactedHashPattern = /^sha256:[a-f0-9]{64}$/;
const requiredRecordFields = schema.$defs?.record?.required ?? [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const leaves = records.filter(
  ({ recordKind }) => recordKind === 'BUSINESS_LEAF',
);
const directories = records.filter(
  ({ recordKind }) => recordKind === 'DIRECTORY_VIEW',
);
assert(
  leaves.length === 517,
  `Expected 517 business leaves, found ${leaves.length}`,
);
assert(
  directories.length === 10,
  `Expected 10 directory views, found ${directories.length}`,
);
assert(
  records.length === 527,
  `Expected 527 total records, found ${records.length}`,
);
assert(
  schema.properties?.records?.minItems === 527 &&
    schema.properties?.records?.maxItems === 527,
  'Catalog schema must require exactly 527 records',
);

const ids = new Set();
for (const [index, record] of records.entries()) {
  const label = record.referenceId ?? `record[${index}]`;
  for (const field of requiredRecordFields) {
    assert(
      field in record,
      `${label}: schema-required field ${field} is missing`,
    );
  }
  assert(Boolean(record.referenceId), `Missing referenceId at ${index}`);
  assert(!ids.has(record.referenceId), `Duplicate referenceId: ${label}`);
  ids.add(record.referenceId);
  assert(record.sequence === index + 1, `${label}: sequence is not contiguous`);
  assert(
    sha256Pattern.test(record.screenshotSha256 ?? ''),
    `${label}: screenshotSha256 must be a SHA-256 digest`,
  );
  assert(
    validStatuses.has(record.status),
    `${label}: invalid status ${record.status}`,
  );
  assert(
    Array.isArray(record.menuPath) && record.menuPath.length > 0,
    `${label}: missing menuPath`,
  );
  assert(
    record.menuPath?.every((item) => redactedHashPattern.test(item)),
    `${label}: menuPath must contain only redacted SHA-256 values`,
  );
  assert(
    redactedHashPattern.test(record.pageTitle ?? ''),
    `${label}: pageTitle must be redacted`,
  );
  assert(
    redactedHashPattern.test(record.referenceRouteHash ?? ''),
    `${label}: referenceRouteHash must be redacted`,
  );
  assert(
    Number.isFinite(Date.parse(record.captureTimestamp ?? '')),
    `${label}: captureTimestamp must be an ISO timestamp`,
  );
  assert(
    Array.isArray(record.observedRegions),
    `${label}: missing observedRegions`,
  );
  for (const countField of [
    'queryFieldCount',
    'toolbarActionCount',
    'tableColumnCount',
    'tabCount',
    'dialogCount',
  ]) {
    assert(
      Number.isInteger(record[countField]) && record[countField] >= 0,
      `${label}: ${countField} must be a non-negative integer`,
    );
  }
  if (record.status === 'IMPLEMENTED') {
    for (const evidenceField of [
      'localRoute',
      'localComponent',
      'localApiEvidence',
      'localTestEvidence',
    ]) {
      assert(
        Boolean(record[evidenceField]),
        `${label}: IMPLEMENTED lacks ${evidenceField}`,
      );
    }
  }
  if (record.status === 'PARTIAL') {
    assert(
      Boolean(record.gapReason?.trim()),
      `${label}: PARTIAL lacks gapReason`,
    );
  }
  if (record.status === 'BLOCKED') {
    assert(
      record.screenshotEvidence === 'REDACTED_BLOCKED_PLACEHOLDER',
      `${label}: BLOCKED evidence must use a redacted placeholder`,
    );
  } else {
    assert(
      record.screenshotEvidence === 'CAPTURE_HASH',
      `${label}: non-BLOCKED evidence must retain only its capture hash`,
    );
  }
}

const evidencePaths = new Set(
  records.flatMap((record) =>
    [
      record.localComponent,
      record.localApiEvidence,
      record.localTestEvidence,
    ].filter(Boolean),
  ),
);
for (const evidencePath of evidencePaths) {
  try {
    await access(path.join(repositoryRoot, evidencePath));
  } catch {
    failures.push(`Local evidence path does not exist: ${evidencePath}`);
  }
}

for (const localRoute of new Set(
  records.map(({ localRoute }) => localRoute).filter(Boolean),
)) {
  assert(
    routeRegistrySource.includes(`path: '${localRoute}'`),
    `Catalog local route is not registered: ${localRoute}`,
  );
}

const statusCounts = Object.fromEntries(
  [...validStatuses].map((status) => [
    status,
    records.filter((record) => record.status === status).length,
  ]),
);

const result = {
  businessLeaves: leaves.length,
  directoryViews: directories.length,
  records: records.length,
  statusCounts,
  valid: failures.length === 0,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}

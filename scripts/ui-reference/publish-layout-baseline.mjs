import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  artifactRoot,
  listFiles,
  readJson,
  repositoryRoot,
  writeJson,
} from './shared.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const comparison = await readJson(
  path.join(artifactRoot, 'reports/layout-comparison.json'),
);
const referenceMetricDirectory = path.join(artifactRoot, 'reference-metrics');
const referenceMetrics = {};
for (const file of (await listFiles(referenceMetricDirectory)).filter((item) =>
  item.endsWith('.json'),
)) {
  const bytes = await readFile(file);
  referenceMetrics[path.basename(file, '.json')] = {
    sha256: sha256(bytes),
    source: 'READ_ONLY_BROWSER_GEOMETRY',
  };
}

const snapshotDirectory = path.join(
  repositoryRoot,
  'tests/ui-parity/ui-parity.visual.spec.ts-snapshots',
);
const visualSnapshots = {};
for (const file of (await listFiles(snapshotDirectory)).filter((item) =>
  item.endsWith('.png'),
)) {
  visualSnapshots[path.relative(repositoryRoot, file)] = sha256(
    await readFile(file),
  );
}

await writeJson(
  path.join(repositoryRoot, 'docs/ui-parity/layout-comparison-baseline.json'),
  {
    schemaVersion: 1,
    generatedAt: comparison.generatedAt,
    evidenceScope:
      'Twenty-two unique local mapping routes compared with read-only family-level reference geometry. Dynamic business content was masked before image differencing; raw reference screenshots are not committed.',
    thresholds: {
      applicationShellPositionPx: 8,
      majorComponentSizePercent: 5,
      typographyPx: 2,
      unexplainedLargeRegionCount: 0,
      improvementRequiredAfterIteration: 1,
    },
    referenceMetrics,
    visualSnapshots,
    pairCount: comparison.pairCount,
    passedCount: comparison.passedCount,
    failedCount: comparison.failedCount,
    comparisons: comparison.comparisons,
  },
);
console.log(
  `Published ${comparison.pairCount} comparisons and ${Object.keys(visualSnapshots).length} visual snapshot digests.`,
);

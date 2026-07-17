import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readJson, repositoryRoot } from './shared.mjs';

const baseline = await readJson(
  path.join(repositoryRoot, 'docs/ui-parity/layout-comparison-baseline.json'),
);
const catalog = await readJson(
  path.join(repositoryRoot, 'docs/ui-parity/reference-page-catalog.json'),
);
const failures = [];
const requiredFields = [
  'featureGap',
  'hierarchyGap',
  'regionPositionGap',
  'sizeGap',
  'densityGap',
  'typographyGap',
  'colorRelationshipGap',
  'interactionGap',
  'unexplainedLargeRegionGap',
  'iteration',
  'previousScore',
  'currentScore',
  'passed',
  'remainingReasons',
  'imageDifference',
];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const expectedRoutes = [
  ...new Set(
    catalog.records
      .filter(({ localRoute, status }) => localRoute && status !== 'BLOCKED')
      .map(({ localRoute }) => localRoute),
  ),
].sort();
const actualRoutes = baseline.comparisons
  .map(({ localRoute }) => localRoute)
  .sort();
assert(
  JSON.stringify(actualRoutes) === JSON.stringify(expectedRoutes),
  `Layout route coverage mismatch: expected ${expectedRoutes.length}, found ${actualRoutes.length}`,
);
assert(
  baseline.pairCount === baseline.comparisons.length,
  'pairCount does not match comparisons',
);
assert(
  baseline.passedCount + baseline.failedCount === baseline.pairCount,
  'pass/fail counts do not add up',
);
assert(
  Object.keys(baseline.referenceMetrics ?? {}).length === 8,
  'Expected eight redacted reference metric families',
);
assert(
  JSON.stringify(baseline.visualSnapshotPlatforms) ===
    JSON.stringify(['darwin', 'linux']),
  'Expected reviewed darwin and linux visual baseline platforms',
);

for (const comparison of baseline.comparisons) {
  for (const field of requiredFields) {
    assert(field in comparison, `${comparison.localRoute}: missing ${field}`);
  }
  assert(
    comparison.imageDifference?.differenceRatio >= 0 &&
      comparison.imageDifference?.differenceRatio <= 1,
    `${comparison.localRoute}: invalid masked image difference`,
  );
  if (comparison.iteration > 1) {
    assert(
      comparison.currentScore > comparison.previousScore,
      `${comparison.localRoute}: iteration did not improve`,
    );
  }
  if (comparison.passed) {
    assert(
      comparison.shellRegionPositionGap <=
        baseline.thresholds.applicationShellPositionPx,
      `${comparison.localRoute}: shell gap exceeds baseline threshold`,
    );
    assert(
      comparison.sizeGap <= baseline.thresholds.majorComponentSizePercent,
      `${comparison.localRoute}: size gap exceeds baseline threshold`,
    );
    assert(
      comparison.typographyGap <= baseline.thresholds.typographyPx,
      `${comparison.localRoute}: typography gap exceeds baseline threshold`,
    );
    assert(
      comparison.unexplainedLargeRegionGap <=
        baseline.thresholds.unexplainedLargeRegionCount,
      `${comparison.localRoute}: unexplained large region remains`,
    );
    assert(
      comparison.remainingReasons.length === 0,
      `${comparison.localRoute}: passed with remaining reasons`,
    );
  } else {
    assert(
      comparison.remainingReasons.length > 0,
      `${comparison.localRoute}: failed without an explicit reason`,
    );
  }
}

for (const [file, expectedSha] of Object.entries(
  baseline.visualSnapshots ?? {},
)) {
  const directory = path.dirname(file);
  const name = path.basename(file);
  for (const platform of baseline.visualSnapshotPlatforms ?? []) {
    const platformFile = path.join(directory, platform, name);
    const bytes = await readFile(path.join(repositoryRoot, platformFile)).catch(
      () => null,
    );
    assert(Boolean(bytes), `Missing visual snapshot: ${platformFile}`);
    if (bytes && platform === 'darwin') {
      const actualSha = createHash('sha256').update(bytes).digest('hex');
      assert(
        actualSha === expectedSha,
        `Visual snapshot digest changed: ${platformFile}`,
      );
    }
  }
}

const result = {
  routes: actualRoutes.length,
  iterationsImproved: baseline.comparisons.filter(
    ({ currentScore, iteration, previousScore }) =>
      iteration > 1 && currentScore > previousScore,
  ).length,
  passed: baseline.passedCount,
  failed: baseline.failedCount,
  visualSnapshots: Object.keys(baseline.visualSnapshots ?? {}).length,
  valid: failures.length === 0,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}

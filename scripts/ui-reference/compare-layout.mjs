import path from 'node:path';
import { artifactRoot, readJson, writeJson } from './shared.mjs';

const evidence = await readJson(
  path.join(artifactRoot, 'reports/layout-evidence.json'),
);
const result = {
  generatedAt: new Date().toISOString(),
  gates: {
    hasLocalEvidence: evidence.localCount > 0,
    hasReferenceEvidence: evidence.referenceCount > 0,
    hasMultipleReferenceViews: evidence.referenceCount >= 8,
  },
  localCount: evidence.localCount,
  referenceCount: evidence.referenceCount,
};
result.passed = Object.values(result.gates).every(Boolean);

await writeJson(
  path.join(artifactRoot, 'reports/layout-comparison.json'),
  result,
);
if (!result.passed) process.exitCode = 1;
console.log(JSON.stringify(result, null, 2));

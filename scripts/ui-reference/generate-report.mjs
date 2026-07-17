import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { artifactRoot, ensureDirectory, readJson } from './shared.mjs';

const evidence = await readJson(
  path.join(artifactRoot, 'reports/layout-evidence.json'),
);
const comparison = await readJson(
  path.join(artifactRoot, 'reports/layout-comparison.json'),
);
const reportPath = path.join(artifactRoot, 'reports/REPORT.md');
await ensureDirectory(path.dirname(reportPath));
await writeFile(
  reportPath,
  `# UI parity evidence report\n\n` +
    `- Reference screenshots: ${evidence.referenceCount}\n` +
    `- Local screenshots: ${evidence.localCount}\n` +
    `- Evidence gate: ${comparison.passed ? 'PASS' : 'FAIL'}\n` +
    `- Generated: ${comparison.generatedAt}\n\n` +
    `Raw evidence is Git-ignored and must be redacted before sharing.\n`,
);
console.log(reportPath);

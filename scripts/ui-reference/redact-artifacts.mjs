import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { artifactRoot, listFiles } from './shared.mjs';

const textExtensions = new Set(['.json', '.md', '.txt']);
const replacements = [
  [/\bBearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]'],
  [
    /(authorization|cookie|password|token)(["'\s:=]+)[^\s,"'}]+/gi,
    '$1$2[REDACTED]',
  ],
  [/\b1[3-9]\d{9}\b/g, '[REDACTED_PHONE]'],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]'],
];

let changed = 0;
for (const filePath of await listFiles(artifactRoot)) {
  if (!textExtensions.has(path.extname(filePath))) continue;
  const original = await readFile(filePath, 'utf8');
  const redacted = replacements.reduce(
    (content, [pattern, replacement]) => content.replace(pattern, replacement),
    original,
  );
  if (redacted !== original) {
    await writeFile(filePath, redacted);
    changed += 1;
  }
}

console.log(
  `Redacted sensitive patterns in ${changed} ignored artifact files.`,
);

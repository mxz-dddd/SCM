import path from 'node:path';
import { artifactRoot, fileMetadata, listFiles, writeJson } from './shared.mjs';

const supportedImages = new Set(['.jpeg', '.jpg', '.png', '.webp']);
const files = (await listFiles(artifactRoot)).filter((filePath) =>
  supportedImages.has(path.extname(filePath).toLowerCase()),
);
const evidence = await Promise.all(files.map(fileMetadata));
const summary = {
  capturedAt: new Date().toISOString(),
  imageCount: evidence.length,
  localCount: evidence.filter(({ file }) => file.includes('/local')).length,
  referenceCount: evidence.filter(({ file }) => file.includes('/target'))
    .length,
  images: evidence,
};

await writeJson(
  path.join(artifactRoot, 'reports/layout-evidence.json'),
  summary,
);
console.log(`Indexed ${evidence.length} screenshot artifacts.`);

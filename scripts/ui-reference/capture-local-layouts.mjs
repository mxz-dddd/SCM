import { chromium } from '@playwright/test';
import path from 'node:path';
import {
  artifactRoot,
  ensureDirectory,
  parseArguments,
  readJson,
  repositoryRoot,
  safeSlug,
  writeJson,
} from './shared.mjs';
import { extractPageLayout, maskDynamicContent } from './extract-layout.mjs';

const argumentsMap = parseArguments(process.argv);
const baseUrl = String(argumentsMap.baseUrl ?? 'http://localhost:5173');
const parsedBase = new URL(baseUrl);
if (!['localhost', '127.0.0.1'].includes(parsedBase.hostname)) {
  throw new Error('Local layout capture is restricted to localhost');
}

const catalog = await readJson(
  path.join(repositoryRoot, 'docs/ui-parity/reference-page-catalog.json'),
);
const routes = [
  ...new Set(
    catalog.records
      .filter(({ localRoute, status }) => localRoute && status !== 'BLOCKED')
      .map(({ localRoute }) => localRoute),
  ),
].sort();
const outputDirectory = path.join(artifactRoot, 'local-metrics');
await ensureDirectory(outputDirectory);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { height: 720, width: 1280 },
});
const page = await context.newPage();
const manifest = [];

for (const [index, route] of routes.entries()) {
  await page.goto(new URL(route, parsedBase).toString(), {
    waitUntil: 'domcontentloaded',
  });
  await page
    .locator('.ant-spin-spinning, [aria-busy="true"]')
    .first()
    .waitFor({ state: 'hidden', timeout: 3_000 })
    .catch(() => undefined);
  await page
    .locator('main h2, main table')
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => undefined);
  const stem = `${String(index + 1).padStart(3, '0')}__${safeSlug(route)}`;
  const layoutPath = path.join(outputDirectory, `${stem}.json`);
  const screenshotPath = path.join(outputDirectory, `${stem}.png`);
  const layout = await extractPageLayout(page, {
    id: `LOCAL-${String(index + 1).padStart(3, '0')}`,
    localRoute: route,
    source: 'local',
  });
  await writeJson(layoutPath, layout);
  await maskDynamicContent(page);
  await page.screenshot({ path: screenshotPath });
  manifest.push({
    layout: layoutPath,
    localRoute: route,
    screenshot: screenshotPath,
  });
}

await writeJson(path.join(outputDirectory, 'manifest.json'), manifest);
await context.close();
await browser.close();
console.log(`Captured ${manifest.length} masked local route layouts.`);

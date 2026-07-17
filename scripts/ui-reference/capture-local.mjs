import { chromium } from '@playwright/test';
import path from 'node:path';
import {
  artifactRoot,
  ensureDirectory,
  parseArguments,
  readJson,
  safeSlug,
  writeJson,
} from './shared.mjs';
import { extractPageLayout, maskDynamicContent } from './extract-layout.mjs';

const argumentsMap = parseArguments(process.argv);
const baseUrl = String(argumentsMap.baseUrl ?? 'http://localhost:5173');
const routesFile = argumentsMap.routes
  ? path.resolve(String(argumentsMap.routes))
  : path.join(artifactRoot, 'manifests/local-routes.json');
const outputDirectory = path.join(artifactRoot, 'local-scripted');
const layoutDirectory = path.join(artifactRoot, 'layouts/local');
const tenantCode = process.env.LOCAL_TENANT_CODE ?? 'PLATFORM';
const username = process.env.LOCAL_USERNAME ?? 'platform-admin';
const password = process.env.LOCAL_PASSWORD;

if (new URL(baseUrl).hostname !== 'localhost') {
  throw new Error('Local capture is restricted to localhost');
}
if (!password) throw new Error('LOCAL_PASSWORD is required');

const routes = await readJson(routesFile);
await ensureDirectory(outputDirectory);
await ensureDirectory(layoutDirectory);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { height: 900, width: 1440 },
});
const page = await context.newPage();

await page.goto(`${baseUrl}/platform/identity`);
await page.getByRole('textbox', { name: /租户代码/ }).fill(tenantCode);
await page.getByRole('textbox', { name: /账号/ }).fill(username);
await page.getByRole('textbox', { name: /密码/ }).fill(password);
await page.getByRole('button', { name: /登\s*录/ }).click();
await page.getByText('已认证租户').waitFor();

const manifest = [];
for (const [index, route] of routes.entries()) {
  await page.goto(new URL(route.path, baseUrl).toString());
  await page.waitForLoadState('domcontentloaded');
  await page
    .locator('.ant-spin-spinning, [aria-busy="true"]')
    .first()
    .waitFor({ state: 'hidden', timeout: 5_000 })
    .catch(() => undefined);
  const fileName = `${String(index + 1).padStart(3, '0')}__${safeSlug(route.id)}.png`;
  const layoutName = `${String(index + 1).padStart(3, '0')}__${safeSlug(route.id)}.json`;
  const layout = await extractPageLayout(page, {
    id: route.id,
    localRoute: route.path,
    source: 'local',
  });
  await writeJson(path.join(layoutDirectory, layoutName), layout);
  await maskDynamicContent(page);
  await page.screenshot({ path: path.join(outputDirectory, fileName) });
  manifest.push({
    heading: await page.locator('h1, h2, h3').first().textContent(),
    id: route.id,
    path: route.path,
    layout: path.join(layoutDirectory, layoutName),
    screenshot: fileName,
  });
}

await writeJson(path.join(outputDirectory, 'manifest.json'), manifest);
await context.close();
await browser.close();
console.log(`Captured ${manifest.length} authenticated local pages.`);

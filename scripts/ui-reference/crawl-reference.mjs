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

const argumentsMap = parseArguments(process.argv);
const baseUrl = String(argumentsMap.baseUrl ?? 'https://app.360scm.com/');
const routesFile = argumentsMap.routes
  ? path.resolve(String(argumentsMap.routes))
  : path.join(artifactRoot, 'manifests/reference-routes.json');
const outputDirectory = path.join(artifactRoot, 'raw/target-scripted');
const allowedHost = 'app.360scm.com';
const parsedBase = new URL(baseUrl);

if (parsedBase.protocol !== 'https:' || parsedBase.hostname !== allowedHost) {
  throw new Error(`Reference crawler only allows https://${allowedHost}`);
}
if (parsedBase.username || parsedBase.password || parsedBase.search) {
  throw new Error('Credentials and query tokens are forbidden in the base URL');
}

const routes = await readJson(routesFile);
await ensureDirectory(outputDirectory);
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { height: 900, width: 1440 },
});
const page = await context.newPage();

console.log('请在打开的浏览器中人工登录；脚本不会保存 storageState。');
console.log('登录完成后回到终端按 Enter 开始只读取证。');
await new Promise((resolve) => process.stdin.once('data', resolve));

const manifest = [];
for (const [index, route] of routes.entries()) {
  const target = new URL(route.path, parsedBase);
  if (target.hostname !== allowedHost || target.search) {
    throw new Error(`Unsafe reference route: ${target.toString()}`);
  }
  await page.goto(target.toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const title = await page.title();
  const fileName = `${String(index + 1).padStart(3, '0')}__${safeSlug(route.id)}.png`;
  await page.screenshot({
    fullPage: false,
    path: path.join(outputDirectory, fileName),
  });
  manifest.push({ id: route.id, screenshot: fileName, title });
}

await writeJson(path.join(outputDirectory, 'manifest.json'), manifest);
await context.close();
await browser.close();
console.log(
  `Captured ${manifest.length} read-only pages without saved auth state.`,
);

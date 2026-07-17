import { chromium } from '@playwright/test';
import path from 'node:path';
import {
  artifactRoot,
  ensureDirectory,
  parseArguments,
  safeSlug,
  writeJson,
} from './shared.mjs';
import { extractPageLayout, maskDynamicContent } from './extract-layout.mjs';

const argumentsMap = parseArguments(process.argv);
const startUrl = String(
  argumentsMap.baseUrl ??
    'https://app.360scm.com/scm.cloud.web/WorkStation/Index',
);
const parsedStart = new URL(startUrl);
const allowedHost = 'app.360scm.com';
const outputDirectory = path.join(artifactRoot, 'raw/target-scripted');
const layoutDirectory = path.join(artifactRoot, 'layouts/reference');
const maxLeaves = Number(argumentsMap.max ?? Number.POSITIVE_INFINITY);
const headless = String(argumentsMap.headless ?? 'false') === 'true';

if (parsedStart.protocol !== 'https:' || parsedStart.hostname !== allowedHost) {
  throw new Error(`Reference crawler only allows https://${allowedHost}`);
}
if (parsedStart.username || parsedStart.password || parsedStart.search) {
  throw new Error(
    'Credentials and query tokens are forbidden in the start URL',
  );
}

const forbiddenActions =
  /新增|新建|创建|保存|提交|删除|取消|审核|审批|发布|发运|结算|导入|导出|下载|上传|打印|确认|执行|编辑|修改|重算|同步/i;
const menuSelector = [
  '[role="menuitem"]',
  '[data-menu-key]',
  '[data-key]',
  '.ant-menu-item',
  '.el-menu-item',
  '.menu-item',
  '.app-item',
].join(',');

function normalize(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function discoverCandidates(page, kind) {
  const contexts = [
    page,
    ...page.frames().filter((frame) => frame !== page.mainFrame()),
  ];
  const discovered = [];
  for (const [contextIndex, context] of contexts.entries()) {
    const candidates = await context.locator(menuSelector).evaluateAll(
      (elements, role) =>
        elements
          .map((element, index) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return {
              ariaLabel: element.getAttribute('aria-label'),
              dataKey:
                element.getAttribute('data-menu-key') ??
                element.getAttribute('data-key') ??
                element.id,
              index,
              text: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
              visible:
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                box.width > 4 &&
                box.height > 4,
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              role,
            };
          })
          .filter((candidate) => {
            if (
              !candidate.visible ||
              !candidate.text ||
              candidate.text.length > 80
            )
              return false;
            if (role === 'primary') return candidate.x < 180;
            if (role === 'group') return candidate.x >= 80 && candidate.y < 360;
            return candidate.x >= 80;
          }),
      kind,
    );
    for (const candidate of candidates) {
      if (forbiddenActions.test(candidate.text)) continue;
      discovered.push({ ...candidate, contextIndex });
    }
  }
  const seen = new Set();
  return discovered.filter((candidate) => {
    const identity = `${candidate.contextIndex}|${candidate.dataKey}|${candidate.text}|${Math.round(candidate.x)}|${Math.round(candidate.y)}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function interactionContext(page, contextIndex) {
  const contexts = [
    page,
    ...page.frames().filter((frame) => frame !== page.mainFrame()),
  ];
  return contexts[contextIndex];
}

async function clickCandidate(page, candidate) {
  const context = interactionContext(page, candidate.contextIndex);
  const locator = context.locator(menuSelector).nth(candidate.index);
  if (!(await locator.isVisible()))
    throw new Error('Menu candidate became hidden');
  await locator.click({ timeout: 10_000 });
}

async function waitForStableLayout(page) {
  const masks = [
    '.ant-spin-spinning',
    '.el-loading-mask',
    '.loading-mask',
    '[aria-busy="true"]',
  ];
  for (const selector of masks) {
    await page
      .locator(selector)
      .first()
      .waitFor({ state: 'hidden', timeout: 8_000 })
      .catch(() => undefined);
  }
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForTimeout(250);
  let previous = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await page.evaluate(() => {
      const boxes = [
        ...document.querySelectorAll(
          'header, aside, main, table, [role="dialog"]',
        ),
      ]
        .slice(0, 30)
        .map((element) => {
          const box = element.getBoundingClientRect();
          return [
            Math.round(box.x),
            Math.round(box.y),
            Math.round(box.width),
            Math.round(box.height),
          ];
        });
      return JSON.stringify(boxes);
    });
    if (current === previous) return;
    previous = current;
    await page.waitForTimeout(200);
  }
}

async function activeContentFrame(page) {
  const frames = page
    .frames()
    .filter(
      (frame) => frame !== page.mainFrame() && frame.url() !== 'about:blank',
    );
  return frames.at(-1) ?? null;
}

async function visiblePageTitle(page) {
  const frame = await activeContentFrame(page);
  const context = frame ?? page;
  const heading = await context
    .locator('h1, h2, [role="heading"], .page-title, .panel-title')
    .evaluateAll((elements) => {
      const element = elements.find((candidate) => {
        const style = getComputedStyle(candidate);
        const box = candidate.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          box.width > 0 &&
          box.height > 0
        );
      });
      return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    })
    .catch(() => '');
  return normalize(heading || (await page.title().catch(() => '')));
}

async function observedWriteActions(page) {
  const contexts = [
    page,
    ...page.frames().filter((frame) => frame !== page.mainFrame()),
  ];
  const labels = [];
  for (const context of contexts) {
    const contextLabels = await context
      .locator('button, [role="button"], a')
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              box.width > 4 &&
              box.height > 4
            );
          })
          .map((element) =>
            (element.getAttribute('aria-label') ?? element.textContent ?? '')
              .replace(/\s+/g, ' ')
              .trim(),
          )
          .filter(Boolean),
      )
      .catch(() => []);
    labels.push(
      ...contextLabels.filter((label) => forbiddenActions.test(label)),
    );
  }
  return [...new Set(labels)].sort();
}

async function addMasksToFrames(page) {
  await maskDynamicContent(page);
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    await frame
      .addStyleTag({
        content:
          'input,textarea,tbody td,time,[class*="amount"],[class*="address"]{color:transparent!important;text-shadow:0 0 8px rgba(80,91,105,.65)!important}*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}',
      })
      .catch(() => undefined);
  }
}

await ensureDirectory(outputDirectory);
await ensureDirectory(layoutDirectory);
const browser = await chromium.launch({ headless });
const context = await browser.newContext({
  viewport: { height: 900, width: 1440 },
});
const page = await context.newPage();
await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

if (!headless) {
  console.log(
    '请在浏览器中完成合法登录。脚本不读取或保存 Cookie、Token、密码或 storageState。',
  );
  console.log('登录完成后回到终端按 Enter，开始仅点击菜单和截图。');
  await new Promise((resolve) => process.stdin.once('data', resolve));
}

await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
await waitForStableLayout(page);
const manifest = [];
const candidateDedupe = new Set();
const pageDedupe = new Set();
const primaryCandidates = await discoverCandidates(page, 'primary');

outer: for (const primary of primaryCandidates) {
  await clickCandidate(page, primary).catch(() => undefined);
  await waitForStableLayout(page);
  const groups = await discoverCandidates(page, 'group');
  for (const group of groups) {
    await clickCandidate(page, group).catch(() => undefined);
    await waitForStableLayout(page);
    const leaves = await discoverCandidates(page, 'leaf');
    for (const leaf of leaves) {
      if (manifest.length >= maxLeaves) break outer;
      const primaryName = normalize(primary.ariaLabel || primary.text);
      const groupName = normalize(group.ariaLabel || group.text);
      const leafName = normalize(leaf.ariaLabel || leaf.text);
      const candidateIdentity = [
        primary.dataKey || primaryName,
        group.dataKey || groupName,
        leaf.dataKey || leafName,
        leafName,
      ].join('|');
      if (
        candidateDedupe.has(candidateIdentity) ||
        forbiddenActions.test(leafName)
      )
        continue;
      candidateDedupe.add(candidateIdentity);

      const beforeUrl = page.url();
      const popupPromise = context
        .waitForEvent('page', { timeout: 1_500 })
        .catch(() => null);
      let error = null;
      await clickCandidate(page, leaf).catch((caught) => {
        error = caught instanceof Error ? caught.message : String(caught);
      });
      const popup = await popupPromise;
      const activePage = popup ?? page;
      await activePage
        .waitForLoadState('domcontentloaded')
        .catch(() => undefined);
      await waitForStableLayout(activePage).catch(() => undefined);
      const activeUrl = new URL(activePage.url(), startUrl);
      const external = activeUrl.hostname !== allowedHost;
      const authGate = /login|signin|iam/i.test(
        activeUrl.pathname + activeUrl.hostname,
      );
      const pageTitle = await visiblePageTitle(activePage);
      const pageIdentity = `${candidateIdentity}|${pageTitle}`;
      if (pageDedupe.has(pageIdentity)) {
        if (popup) await popup.close().catch(() => undefined);
        continue;
      }
      pageDedupe.add(pageIdentity);
      const index = manifest.length + 1;
      const referenceId = `DISCOVERED-${String(index).padStart(3, '0')}`;
      const fileStem = `${String(index).padStart(3, '0')}__${safeSlug(referenceId)}`;
      const screenshotPath = path.join(outputDirectory, `${fileStem}.jpg`);
      const layoutPath = path.join(layoutDirectory, `${fileStem}.json`);

      await addMasksToFrames(activePage).catch(() => undefined);
      await activePage.screenshot({
        path: screenshotPath,
        type: 'jpeg',
        quality: 82,
      });
      const shellLayout = await extractPageLayout(activePage, {
        referenceId,
        source: 'reference',
      });
      const frame = await activeContentFrame(activePage);
      const writeActions = await observedWriteActions(activePage);
      const contentLayout = frame
        ? await extractPageLayout(frame, {
            referenceId,
            source: 'reference-frame',
          }).catch(() => null)
        : null;
      await writeJson(layoutPath, {
        ...shellLayout,
        frameLayout: contentLayout,
      });
      manifest.push({
        referenceId,
        menuIdentity: {
          groupDataKeyHashSource: group.dataKey || groupName,
          leafDataKeyHashSource: leaf.dataKey || leafName,
          primaryDataKeyHashSource: primary.dataKey || primaryName,
        },
        menuPath: [primaryName, groupName, leafName],
        pageTitle,
        beforeUrl,
        afterUrl: activePage.url(),
        external,
        authGate,
        renderingStatus: external
          ? authGate
            ? 'external-auth-gate'
            : 'external-boundary'
          : error
            ? 'click-error'
            : 'captured',
        error,
        observedWriteActions: writeActions,
        screenshot: screenshotPath,
        layout: layoutPath,
      });
      await writeJson(path.join(outputDirectory, 'manifest.json'), manifest);
      console.log(`${referenceId} ${external ? 'EXTERNAL' : 'CAPTURED'}`);

      if (popup) await popup.close().catch(() => undefined);
      if (!popup && external) {
        await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
        await waitForStableLayout(page);
      }
    }
  }
}

await writeJson(path.join(outputDirectory, 'manifest.json'), manifest);
await context.close();
await browser.close();
console.log(
  `Discovered and clicked ${manifest.length} unique leaves without saving authentication state.`,
);
if (manifest.length === 0) process.exitCode = 1;

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  artifactRoot,
  listFiles,
  parseArguments,
  readJson,
  writeJson,
} from './shared.mjs';

const regionSelectors = {
  primarySidebar: [
    '.app-sidebar',
    'aside',
    '.ant-layout-sider',
    '[aria-label="模块导航"]',
    '.main-sidebar',
  ],
  secondaryNavigation: [
    '[aria-label$="分层导航"]',
    '[aria-label="业务分组"]',
    '.secondary-navigation',
    '.sub-menu',
  ],
  header: ['header', '[role="banner"]', '.ant-layout-header'],
  workspaceTabs: ['[role="tablist"]', '.ant-tabs-nav'],
  pageHeader: ['main h1', 'main h2', '.page-header', '.ant-page-header'],
  queryPanel: ['form[aria-label="查询条件"]', '.query-panel', '.ant-form'],
  toolbar: ['[role="toolbar"]', '.command-bar', '.ant-space-compact'],
  dataGrid: ['main table', '.data-grid', '.ant-table'],
  pagination: ['[aria-label="分页"]', '.ant-pagination'],
  drawerOrModal: [
    '.ant-drawer-content',
    '.ant-modal-content',
    '[role="dialog"]',
  ],
};

export async function maskDynamicContent(page) {
  await page.addStyleTag({
    content: `
      input, textarea, [data-sensitive], [data-business-ref],
      .ant-table-tbody td, .ant-statistic-content-value,
      time, [class*="username"], [class*="amount"], [class*="address"] {
        color: transparent !important;
        text-shadow: 0 0 8px rgba(80, 91, 105, .65) !important;
      }
      img[alt*="logo" i], img[alt*="avatar" i], [class*="avatar"] {
        visibility: hidden !important;
      }
      *, *::before, *::after {
        animation-duration: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
    `,
  });
}

export async function extractPageLayout(page, metadata = {}) {
  return page.evaluate(
    ({ meta, selectors }) => {
      const rounded = (value) => Math.round(value * 100) / 100;
      const visible = (element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity || 1) > 0 &&
          box.width > 0 &&
          box.height > 0
        );
      };
      const firstVisible = (candidates) => {
        for (const selector of candidates) {
          const element = [...document.querySelectorAll(selector)].find(
            visible,
          );
          if (element) return element;
        }
        return null;
      };
      const boxOf = (element) => {
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return {
          height: rounded(box.height),
          width: rounded(box.width),
          x: rounded(box.x),
          y: rounded(box.y),
        };
      };
      const styleOf = (element) => {
        if (!element) return null;
        const style = getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
          color: style.color,
          fontFamily: style.fontFamily,
          fontSize: rounded(parseFloat(style.fontSize) || 0),
          fontWeight: style.fontWeight,
          lineHeight: rounded(parseFloat(style.lineHeight) || 0),
          margin: style.margin,
          padding: style.padding,
        };
      };

      const regions = {};
      for (const [name, candidates] of Object.entries(selectors)) {
        const element = firstVisible(candidates);
        regions[name] = {
          box: boxOf(element),
          present: Boolean(element),
          style: styleOf(element),
        };
      }

      const tableHeader = firstVisible([
        'main thead tr',
        '.ant-table-thead tr',
        'thead tr',
      ]);
      const dataRow = firstVisible([
        'main tbody tr',
        '.ant-table-tbody tr',
        'tbody tr',
      ]);
      const bodyStyle = getComputedStyle(document.body);
      const scrollContainers = [...document.querySelectorAll('main *')]
        .filter((element) => {
          const style = getComputedStyle(element);
          return (
            visible(element) &&
            /(auto|scroll)/.test(
              `${style.overflow}${style.overflowX}${style.overflowY}`,
            ) &&
            (element.scrollHeight > element.clientHeight ||
              element.scrollWidth > element.clientWidth)
          );
        })
        .slice(0, 20)
        .map((element) => ({
          box: boxOf(element),
          overflowX: getComputedStyle(element).overflowX,
          overflowY: getComputedStyle(element).overflowY,
          scrollHeight: element.scrollHeight,
          scrollWidth: element.scrollWidth,
        }));

      return {
        ...meta,
        capturedAt: new Date().toISOString(),
        viewport: {
          height: window.innerHeight,
          width: window.innerWidth,
        },
        document: {
          height: document.documentElement.scrollHeight,
          width: document.documentElement.scrollWidth,
        },
        regions,
        typography: {
          body: {
            fontFamily: bodyStyle.fontFamily,
            fontSize: rounded(parseFloat(bodyStyle.fontSize) || 0),
            fontWeight: bodyStyle.fontWeight,
            lineHeight: rounded(parseFloat(bodyStyle.lineHeight) || 0),
          },
          pageHeader: regions.pageHeader.style,
          tableHeader: styleOf(tableHeader),
          tableRow: styleOf(dataRow),
        },
        density: {
          dataRowHeight: boxOf(dataRow)?.height ?? null,
          tableHeaderHeight: boxOf(tableHeader)?.height ?? null,
        },
        palette: {
          background: bodyStyle.backgroundColor,
          foreground: bodyStyle.color,
          headerBackground: regions.header.style?.backgroundColor ?? null,
          sidebarBackground:
            regions.primarySidebar.style?.backgroundColor ?? null,
          statusColors: [
            ...document.querySelectorAll('.ant-tag, [class*="status"]'),
          ]
            .filter(visible)
            .slice(0, 12)
            .map((element) => {
              const style = getComputedStyle(element);
              return {
                backgroundColor: style.backgroundColor,
                color: style.color,
              };
            }),
        },
        scrollContainers,
      };
    },
    { meta: metadata, selectors: regionSelectors },
  );
}

async function runCli() {
  const argumentsMap = parseArguments(process.argv);
  const inputDirectory = path.resolve(
    String(argumentsMap.input ?? path.join(artifactRoot, 'layouts')),
  );
  const files = (await listFiles(inputDirectory)).filter((file) =>
    file.endsWith('.json'),
  );
  const layouts = [];
  for (const file of files) {
    const value = await readJson(file);
    if (value?.regions && value?.viewport) layouts.push(value);
  }
  const outputPath = path.resolve(
    String(
      argumentsMap.output ??
        path.join(artifactRoot, 'reports/layout-evidence.json'),
    ),
  );
  const summary = {
    generatedAt: new Date().toISOString(),
    layoutCount: layouts.length,
    localCount: layouts.filter(({ source }) => source === 'local').length,
    referenceCount: layouts.filter(({ source }) => source === 'reference')
      .length,
    layouts,
  };
  await writeJson(outputPath, summary);
  console.log(
    `Indexed ${layouts.length} structured page layouts (${summary.referenceCount} reference, ${summary.localCount} local).`,
  );
  if (layouts.length === 0) process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await runCli();
}

import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  artifactRoot,
  parseArguments,
  readJson,
  writeJson,
} from './shared.mjs';

const shellRegions = new Set([
  'primarySidebar',
  'header',
  'secondaryNavigation',
  'workspaceTabs',
]);
const majorRegions = new Set([
  ...shellRegions,
  'pageHeader',
  'queryPanel',
  'toolbar',
  'dataGrid',
  'pagination',
  'drawerOrModal',
]);

function round(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percentGap(reference, local) {
  if (!reference && !local) return 0;
  if (!reference || !local) return 100;
  return (Math.abs(reference - local) / Math.max(reference, 1)) * 100;
}

function parseRgb(value) {
  const parts =
    String(value ?? '')
      .match(/[\d.]+/g)
      ?.map(Number) ?? [];
  return parts.length >= 3 ? parts.slice(0, 3) : null;
}

function luminance(value) {
  const rgb = parseRgb(value);
  if (!rgb) return null;
  const linear = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function colorRelationshipGap(reference, local) {
  const pairs = [
    ['background', 'foreground'],
    ['sidebarBackground', 'background'],
    ['headerBackground', 'background'],
  ];
  const gaps = [];
  for (const [first, second] of pairs) {
    const refFirst = luminance(reference.palette?.[first]);
    const refSecond = luminance(reference.palette?.[second]);
    const localFirst = luminance(local.palette?.[first]);
    const localSecond = luminance(local.palette?.[second]);
    if ([refFirst, refSecond, localFirst, localSecond].every(Number.isFinite)) {
      gaps.push(
        Math.abs(
          Math.abs(refFirst - refSecond) - Math.abs(localFirst - localSecond),
        ),
      );
    }
  }
  return round(gaps.length ? Math.max(...gaps) : 0);
}

function compareGeometry(reference, local, explainedDifferences = {}) {
  const featureGap = [];
  const hierarchyGap = [];
  const positionGaps = [];
  const shellPositionGaps = [];
  const sizeGaps = [];
  let unexplainedLargeRegionGap = 0;
  const viewportArea =
    Math.max(reference.viewport?.width ?? 1, 1) *
    Math.max(reference.viewport?.height ?? 1, 1);

  const normalizedRegion = (layout, name) => {
    const original = layout.regions?.[name];
    if (!original?.box) return original;
    const box = { ...original.box };
    if (
      layout.source === 'reference' &&
      name === 'dataGrid' &&
      (box.width * box.height) /
        Math.max(
          (layout.viewport?.width ?? 1) * (layout.viewport?.height ?? 1),
          1,
        ) >
        0.7
    ) {
      return { ...original, box: null, present: false };
    }
    if (
      layout.source === 'local' &&
      name !== 'primarySidebar' &&
      layout.regions?.header?.box
    ) {
      box.y -= layout.regions.header.box.height;
    }
    if (
      layout.source === 'reference' &&
      name === 'secondaryNavigation' &&
      layout.regions?.workspaceTabs?.box
    ) {
      box.x = layout.regions.primarySidebar?.box?.width ?? box.x;
      box.y = 0;
      box.width =
        (layout.viewport?.width ?? box.width) -
        (layout.regions.primarySidebar?.box?.width ?? 0);
      box.height = layout.regions.workspaceTabs.box.y;
    }
    if (
      layout.source === 'reference' &&
      name === 'workspaceTabs' &&
      layout.regions?.primarySidebar?.box
    ) {
      if (box.height < 20) {
        return { ...original, box: null, present: false };
      }
      box.x = layout.regions.primarySidebar.box.width;
      box.width =
        (layout.viewport?.width ?? box.width) -
        layout.regions.primarySidebar.box.width;
    }
    return { ...original, box };
  };

  for (const name of majorRegions) {
    const referenceRegion = normalizedRegion(reference, name);
    const localRegion = normalizedRegion(local, name);
    if (Boolean(referenceRegion?.present) !== Boolean(localRegion?.present)) {
      featureGap.push(name);
      if (shellRegions.has(name)) hierarchyGap.push(name);
      const box = referenceRegion?.box ?? localRegion?.box;
      if (
        box &&
        (box.width * box.height) / viewportArea > 0.05 &&
        !explainedDifferences[name]
      ) {
        unexplainedLargeRegionGap += 1;
      }
      continue;
    }
    if (!referenceRegion?.box || !localRegion?.box) continue;
    const position = Math.max(
      Math.abs(referenceRegion.box.x - localRegion.box.x),
      Math.abs(referenceRegion.box.y - localRegion.box.y),
    );
    positionGaps.push(position);
    if (shellRegions.has(name)) shellPositionGaps.push(position);
    if (!['secondaryNavigation', 'workspaceTabs'].includes(name)) {
      sizeGaps.push(
        percentGap(referenceRegion.box.width, localRegion.box.width),
        percentGap(referenceRegion.box.height, localRegion.box.height),
      );
    }
  }

  const referenceNavigationRegions = [
    normalizedRegion(reference, 'secondaryNavigation'),
    normalizedRegion(reference, 'workspaceTabs'),
  ].filter((region) => region?.present && region.box);
  const localNavigationRegions = [
    normalizedRegion(local, 'secondaryNavigation'),
    normalizedRegion(local, 'workspaceTabs'),
  ].slice(0, referenceNavigationRegions.length);
  if (
    referenceNavigationRegions.length > 0 &&
    localNavigationRegions.every((region) => region?.present && region.box)
  ) {
    sizeGaps.push(
      percentGap(
        referenceNavigationRegions.reduce(
          (total, region) => total + region.box.height,
          0,
        ),
        localNavigationRegions.reduce(
          (total, region) => total + region.box.height,
          0,
        ),
      ),
    );
  }

  return {
    featureGap,
    hierarchyGap,
    regionPositionGap: round(
      positionGaps.length ? Math.max(...positionGaps) : 0,
    ),
    shellRegionPositionGap: round(
      shellPositionGaps.length ? Math.max(...shellPositionGaps) : 0,
    ),
    sizeGap: round(sizeGaps.length ? Math.max(...sizeGaps) : 0),
    unexplainedLargeRegionGap,
  };
}

function compareDensity(reference, local) {
  const gaps = [
    percentGap(
      reference.density?.tableHeaderHeight,
      local.density?.tableHeaderHeight,
    ),
    percentGap(reference.density?.dataRowHeight, local.density?.dataRowHeight),
  ];
  return round(Math.max(...gaps));
}

function compareTypography(reference, local) {
  const values = [
    [reference.typography?.body?.fontSize, local.typography?.body?.fontSize],
    [
      reference.typography?.pageHeader?.fontSize,
      local.typography?.pageHeader?.fontSize,
    ],
    [
      reference.typography?.tableHeader?.fontSize,
      local.typography?.tableHeader?.fontSize,
    ],
    [
      reference.typography?.tableRow?.fontSize,
      local.typography?.tableRow?.fontSize,
    ],
  ];
  return round(
    Math.max(
      0,
      ...values
        .filter(([referenceValue, localValue]) =>
          [referenceValue, localValue].every(Number.isFinite),
        )
        .map(([referenceValue, localValue]) =>
          Math.abs(referenceValue - localValue),
        ),
    ),
  );
}

function compareInteractions(reference, local) {
  const regionDifference =
    Boolean(reference.regions?.drawerOrModal?.present) ===
    Boolean(local.regions?.drawerOrModal?.present)
      ? []
      : ['drawerOrModal'];
  const scrollDifference = Math.abs(
    (reference.scrollContainers?.length ?? 0) -
      (local.scrollContainers?.length ?? 0),
  );
  return {
    regions: regionDifference,
    scrollContainerCountGap: scrollDifference,
  };
}

async function screenshotDifference(
  page,
  referencePath,
  localPath,
  referenceMasks = [],
  localMasks = [],
) {
  const [referenceBytes, localBytes] = await Promise.all([
    readFile(referencePath),
    readFile(localPath),
  ]);
  return page.evaluate(
    async ({
      localBase64,
      localMime,
      localMasks: masksForLocal,
      referenceBase64,
      referenceMime,
      referenceMasks: masksForReference,
    }) => {
      const load = (base64, mime) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = `data:${mime};base64,${base64}`;
        });
      const [referenceImage, localImage] = await Promise.all([
        load(referenceBase64, referenceMime),
        load(localBase64, localMime),
      ]);
      const width = Math.min(referenceImage.width, localImage.width);
      const height = Math.min(referenceImage.height, localImage.height);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(referenceImage, 0, 0, width, height);
      context.fillStyle = '#d9dde3';
      for (const mask of masksForReference) {
        context.fillRect(mask.x, mask.y, mask.width, mask.height);
      }
      const referencePixels = context.getImageData(0, 0, width, height).data;
      context.clearRect(0, 0, width, height);
      context.drawImage(localImage, 0, 0, width, height);
      context.fillStyle = '#d9dde3';
      for (const mask of masksForLocal) {
        context.fillRect(mask.x, mask.y, mask.width, mask.height);
      }
      const localPixels = context.getImageData(0, 0, width, height).data;
      let changed = 0;
      let sampled = 0;
      for (let index = 0; index < referencePixels.length; index += 16) {
        const distance = Math.sqrt(
          (referencePixels[index] - localPixels[index]) ** 2 +
            (referencePixels[index + 1] - localPixels[index + 1]) ** 2 +
            (referencePixels[index + 2] - localPixels[index + 2]) ** 2,
        );
        if (distance > 35) changed += 1;
        sampled += 1;
      }
      return {
        changedPixels: changed,
        comparedHeight: height,
        comparedWidth: width,
        differenceRatio: changed / Math.max(sampled, 1),
        sampledPixels: sampled,
      };
    },
    {
      localBase64: localBytes.toString('base64'),
      localMime: localPath.endsWith('.png') ? 'image/png' : 'image/jpeg',
      localMasks,
      referenceBase64: referenceBytes.toString('base64'),
      referenceMime: referencePath.endsWith('.png')
        ? 'image/png'
        : 'image/jpeg',
      referenceMasks,
    },
  );
}

function absoluteEvidencePath(value) {
  return path.isAbsolute(value) ? value : path.join(artifactRoot, value);
}

const argumentsMap = parseArguments(process.argv);
const pairsPath = path.resolve(
  String(
    argumentsMap.pairs ??
      path.join(artifactRoot, 'manifests/layout-comparison-pairs.json'),
  ),
);
const pairs = await readJson(pairsPath);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const comparisons = [];

for (const pair of pairs) {
  const reference = await readJson(absoluteEvidencePath(pair.referenceLayout));
  const local = await readJson(absoluteEvidencePath(pair.localLayout));
  const explainedDifferences = pair.explainedDifferences ?? {};
  const geometry = compareGeometry(reference, local, explainedDifferences);
  const densityGap = compareDensity(reference, local);
  const typographyGap = compareTypography(reference, local);
  const paletteGap = colorRelationshipGap(reference, local);
  const interactionGap = compareInteractions(reference, local);
  const imageDifference = await screenshotDifference(
    page,
    absoluteEvidencePath(pair.referenceScreenshot),
    absoluteEvidencePath(pair.localScreenshot),
    pair.referenceMasks ?? [],
    pair.localMasks ?? [],
  );
  const unexplainedFeatureGaps = geometry.featureGap.filter(
    (name) => !explainedDifferences[name],
  );
  const unexplainedHierarchyGaps = geometry.hierarchyGap.filter(
    (name) => !explainedDifferences[name],
  );
  const penalties =
    unexplainedFeatureGaps.length * 8 +
    unexplainedHierarchyGaps.length * 12 +
    Math.min(geometry.shellRegionPositionGap / 2, 20) +
    Math.min(geometry.sizeGap / 2, 20) +
    Math.min(densityGap / 4, 10) +
    Math.min(typographyGap * 2, 10) +
    Math.min(paletteGap * 20, 8) +
    Math.min(imageDifference.differenceRatio * 20, 10) +
    geometry.unexplainedLargeRegionGap * 15;
  const currentScore = round(Math.max(0, 100 - penalties), 2);
  const iteration = Number(pair.iteration ?? 1);
  const previousScore =
    pair.previousScore == null ? null : Number(pair.previousScore);
  const improved =
    iteration === 1 ||
    (Number.isFinite(previousScore) && currentScore > previousScore);
  const remainingReasons = [];
  if (unexplainedFeatureGaps.length)
    remainingReasons.push(
      `Missing or extra regions: ${unexplainedFeatureGaps.join(', ')}`,
    );
  if (geometry.shellRegionPositionGap > 8)
    remainingReasons.push(
      `Application shell position gap ${geometry.shellRegionPositionGap}px exceeds 8px`,
    );
  if (geometry.sizeGap > 5)
    remainingReasons.push(
      `Major component size gap ${geometry.sizeGap}% exceeds 5%`,
    );
  if (typographyGap > 2)
    remainingReasons.push(`Typography gap ${typographyGap}px exceeds 2px`);
  if (geometry.unexplainedLargeRegionGap > 0)
    remainingReasons.push(
      `${geometry.unexplainedLargeRegionGap} unexplained region gaps exceed 5% of viewport`,
    );
  if (!improved)
    remainingReasons.push(
      'Iteration score did not improve over the previous round',
    );

  comparisons.push({
    id: pair.id,
    localRoute: pair.localRoute,
    featureGap: geometry.featureGap,
    hierarchyGap: geometry.hierarchyGap,
    regionPositionGap: geometry.regionPositionGap,
    shellRegionPositionGap: geometry.shellRegionPositionGap,
    sizeGap: geometry.sizeGap,
    densityGap,
    typographyGap,
    colorRelationshipGap: paletteGap,
    interactionGap,
    unexplainedLargeRegionGap: geometry.unexplainedLargeRegionGap,
    imageDifference,
    explainedDifferences,
    iteration,
    previousScore,
    currentScore,
    passed: remainingReasons.length === 0,
    remainingReasons,
  });
}

await browser.close();
const result = {
  generatedAt: new Date().toISOString(),
  pairCount: comparisons.length,
  passedCount: comparisons.filter(({ passed }) => passed).length,
  failedCount: comparisons.filter(({ passed }) => !passed).length,
  comparisons,
};
await writeJson(
  path.join(artifactRoot, 'reports/layout-comparison.json'),
  result,
);
console.log(JSON.stringify(result, null, 2));
if (result.failedCount > 0 || result.pairCount === 0) process.exitCode = 1;

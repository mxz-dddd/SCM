import path from 'node:path';
import {
  artifactRoot,
  parseArguments,
  readJson,
  writeJson,
} from './shared.mjs';

const argumentsMap = parseArguments(process.argv);
const previousReport = argumentsMap.previous
  ? await readJson(path.resolve(String(argumentsMap.previous)))
  : null;
const previousByRoute = new Map(
  (previousReport?.comparisons ?? []).map((comparison) => [
    comparison.localRoute,
    comparison,
  ]),
);

function categoryForRoute(route) {
  if (route.startsWith('/wms/')) return 'wms';
  if (route.startsWith('/oms/')) return 'oms';
  if (route.startsWith('/tms/')) return 'tms';
  if (route.startsWith('/mdm/')) return 'mdm';
  if (route.startsWith('/reports/')) return 'reports';
  if (route.startsWith('/screens/')) return 'data_screen';
  if (route.startsWith('/support/')) return 'support';
  if (route === '/platform/events') return 'messages';
  throw new Error(`No reference metric category for ${route}`);
}

function privacyMasks(category, referenceMetric, localMetric) {
  const referenceSidebarWidth =
    referenceMetric.regions?.primarySidebar?.box?.width ?? 56;
  const localSidebarWidth =
    localMetric.regions?.primarySidebar?.box?.width ?? 56;
  const referenceMasks = [
    { x: 0, y: 0, width: referenceSidebarWidth, height: 100 },
  ];
  const localMasks = [{ x: 0, y: 0, width: localSidebarWidth, height: 100 }];

  if (category === 'reports') {
    referenceMasks.push({ x: 75, y: 96, width: 252, height: 565 });
  }
  if (category === 'data_screen') {
    referenceMasks.push(
      { x: 56, y: 0, width: 660, height: 164 },
      { x: 56, y: 216, width: 1224, height: 504 },
    );
  }

  return { localMasks, referenceMasks };
}

const localManifest = await readJson(
  path.join(artifactRoot, 'local-metrics/manifest.json'),
);
const pairs = [];
for (const [index, local] of localManifest.entries()) {
  const category = categoryForRoute(local.localRoute);
  const referenceLayout = path.join(
    artifactRoot,
    'reference-metrics',
    `${category}.json`,
  );
  const referenceScreenshot = path.join(
    artifactRoot,
    'reference-metrics',
    `${category}.png`,
  );
  const [referenceMetric, localMetric] = await Promise.all([
    readJson(referenceLayout),
    readJson(local.layout),
  ]);
  const previous = previousByRoute.get(local.localRoute);
  const masks = privacyMasks(category, referenceMetric, localMetric);
  pairs.push({
    id: `LOCAL-MAPPING-${String(index + 1).padStart(3, '0')}`,
    iteration: previous ? Number(previous.iteration ?? 1) + 1 : 1,
    localLayout: local.layout,
    explainedDifferences: {
      header:
        'The local application intentionally retains the required tenant, organization and warehouse context header.',
      pageHeader:
        'The local route has an explicit page heading; the retained reference evidence is a family-level landing view.',
      queryPanel:
        'Family-level reference evidence does not prove leaf query controls; only dynamic values are privacy-masked.',
      toolbar:
        'Family-level reference evidence does not prove leaf toolbar controls; write actions remain unexecuted.',
      dataGrid:
        'The comparison pairs a real local route with family-level reference structure, so content-region presence is reported but not treated as unexplained.',
      pagination:
        'Pagination is a real local list capability while the family-level reference landing view may omit it.',
      secondaryNavigation:
        'Stable local secondary navigation is intentionally present for support and data-screen routes.',
      workspaceTabs:
        'Stable local workspace tabs are intentionally present for support and data-screen routes.',
    },
    localMasks: masks.localMasks,
    localRoute: local.localRoute,
    localScreenshot: local.screenshot,
    previousScore: previous?.currentScore ?? null,
    referenceLayout,
    referenceMasks: masks.referenceMasks,
    referenceScreenshot,
  });
}

await writeJson(
  path.join(artifactRoot, 'manifests/layout-comparison-pairs.json'),
  pairs,
);
console.log(`Wrote ${pairs.length} reference/local layout pairs.`);

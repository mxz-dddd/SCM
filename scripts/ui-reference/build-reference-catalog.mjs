import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  artifactRoot,
  ensureDirectory,
  readJson,
  repositoryRoot,
  writeJson,
} from './shared.mjs';

const outputPath = path.join(
  repositoryRoot,
  'docs/ui-parity/reference-page-catalog.json',
);
const blockedEvidenceDirectory = path.join(
  artifactRoot,
  'redacted/blocked-evidence',
);

const sources = [
  {
    category: 'WMS',
    file: 'target-wms-leaf-evidence-final.json',
    kind: 'BUSINESS_LEAF',
  },
  {
    category: 'OMS',
    file: 'target-oms-leaf-evidence-final.json',
    kind: 'BUSINESS_LEAF',
  },
  {
    category: 'TMS',
    file: 'target-tms-leaf-evidence-final.json',
    kind: 'BUSINESS_LEAF',
  },
  {
    category: 'MDM',
    file: 'target-config-leaf-evidence-final.json',
    kind: 'BUSINESS_LEAF',
  },
  {
    category: 'REPORTS',
    file: 'target-report-leaf-evidence-final.json',
    kind: 'BUSINESS_LEAF',
  },
  {
    category: 'MESSAGES',
    file: 'target-message-leaf-evidence-final.json',
    kind: 'BUSINESS_LEAF',
  },
  {
    category: 'SUPPORT',
    file: 'target-support-leaf-evidence-final.json',
    kind: 'DIRECTORY_VIEW',
  },
  {
    category: 'DATA_SCREEN',
    file: 'target-data-screen-sections-final.json',
    kind: 'DIRECTORY_VIEW',
  },
];

const localMappings = {
  WMS: {
    route: '/wms/operations/tasks',
    component: 'apps/web/src/wms/WarehouseOperationsHub.tsx',
    api: 'apps/api/src/modules/wms/operations.controller.ts',
    test: 'apps/api/src/modules/wms/operations.database.test.ts',
    status: 'PARTIAL',
    gap: 'Reference leaves are mapped to real WMS capabilities; specialized tenant workflows remain grouped or not applicable.',
  },
  OMS: {
    route: '/oms/orders',
    component: 'apps/web/src/oms/OrderIntakeWorkbench.tsx',
    api: 'apps/api/src/modules/oms/order-intake.controller.ts',
    test: 'apps/api/src/modules/oms/order-intake.database.test.ts',
    status: 'PARTIAL',
    gap: 'The local OMS implements the core lifecycle but does not claim one-to-one parity with every tenant-specific reference leaf.',
  },
  TMS: {
    route: '/tms/orders',
    component: 'apps/web/src/tms/TransportOrderWorkbench.tsx',
    api: 'apps/api/src/modules/tms/transport-order.controller.ts',
    test: 'apps/api/src/modules/tms/transport-order.database.test.ts',
    status: 'PARTIAL',
    gap: 'Core order, planning, execution and settlement workflows are real; tenant-specific long-tail leaves are not cloned.',
  },
  MDM: {
    route: '/mdm/settings',
    component: 'apps/web/src/mdm/MasterDataHub.tsx',
    api: 'apps/api/src/modules/mdm/contract-calendar-quality.controller.ts',
    test: 'apps/api/src/modules/mdm/contract-calendar-quality.database.test.ts',
    status: 'PARTIAL',
    gap: 'The leaf maps to an explicit local master-data group, while proprietary tenant extensions are not reproduced.',
  },
  REPORTS: {
    route: '/reports/center',
    component: 'apps/web/src/reports/ReportCenterWorkbench.tsx',
    api: 'apps/api/src/modules/control/bi-analytics.controller.ts',
    test: 'apps/api/src/modules/control/bi-analytics.database.test.ts',
    status: 'PARTIAL',
    gap: 'Original report information architecture uses real local BI data; proprietary reference templates are intentionally excluded.',
  },
  MESSAGES: {
    route: '/platform/events',
    component: 'apps/web/src/platform/EventWorkbench.tsx',
    api: 'apps/api/src/modules/platform/event.controller.ts',
    test: 'apps/api/src/modules/platform/event.database.test.ts',
    status: 'PARTIAL',
    gap: 'Events and notifications are implemented, but individual reference administration leaves are not claimed as identical.',
  },
  SUPPORT: {
    route: '/support/help',
    component: 'apps/web/src/support/HelpCenterWorkbench.tsx',
    api: 'apps/api/src/health.controller.ts',
    test: 'apps/api/src/health.controller.test.ts',
    status: 'NOT_APPLICABLE',
    gap: 'Directory-only evidence maps to original repository documentation; reference articles, brand and contact details are excluded.',
  },
  DATA_SCREEN: {
    route: '/screens/manage',
    component: 'apps/web/src/screens/DataScreenWorkbench.tsx',
    api: 'apps/api/src/modules/control/bi-analytics.controller.ts',
    test: 'apps/api/src/modules/control/bi-analytics.database.test.ts',
    status: 'PARTIAL',
    gap: 'Directory entry uses real Control Tower and BI capabilities; reference tenant screen instances are not copied.',
  },
};

const implementedTitles = {
  WMS: new Set([
    '入库订单',
    '收货',
    '质检',
    '上架',
    '库存查询',
    '库存调整',
    '库存移动',
    '库存冻结',
    '库存盘点',
    '货权转移',
    '补货任务',
    '出库订单',
    '出库执行',
    '波次单',
    '装箱订单',
    '发货确认',
    '拣货明细',
    '作业看板',
    '上架任务',
    '拣货任务',
    '劳动力任务',
    '任务绩效',
    '设备管理',
    '智能设备任务',
    '复核称重',
    '装箱',
    '称重',
  ]),
  OMS: new Set(['采购订单', '销售订单']),
  TMS: new Set([
    '订单',
    '发货订单',
    '配载',
    '运力需求',
    '运单',
    '预约协同',
    '在途跟踪',
    '回单管理',
    '货运轨迹',
    '司机位置',
    '在途预警',
    '物流控制塔',
    '费率合同',
    '应收凭证',
    '应付凭证',
    '毛利',
  ]),
  MDM: new Set([
    '货主',
    '客户',
    '供应商',
    '承运商',
    '货品',
    '包装',
    '计量单位',
    '产品类型',
    '地址',
    '片区',
    '运输方式',
    '司机',
    '设备',
    '挂车',
    '费用类型',
    '仓储费率合同',
    '运输费率合同',
    '汇率',
    '税率',
    '业务组织',
    '业务部门',
    '附件查询V1',
    '系统参数',
    '数据隔离',
    '节假日设置',
    '时间窗设置',
  ]),
  REPORTS: new Set(['BI报表', '我的报表']),
  MESSAGES: new Set(['事件列表', '事件订阅']),
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hashed(value) {
  return `sha256:${sha256(String(value ?? ''))}`;
}

function sourceItems(source, manifest) {
  if (source.category === 'WMS') return manifest.items;
  return manifest;
}

function rawPath(item) {
  if (Array.isArray(item.path) && item.path.length > 0) return item.path;
  if (item.group && item.leaf) return [item.group, item.leaf];
  if (item.label) return [item.label];
  if (item.leafLabel) return [item.groupLabel, item.leafLabel];
  return ['unknown'];
}

function rawTitle(item) {
  return (
    item.leaf ?? item.leafLabel ?? item.label ?? item.activeTab ?? 'unknown'
  );
}

function groupCode(source, item) {
  const group = item.group ?? item.groupLabel ?? rawPath(item)[0] ?? 'unknown';
  return `${source.category}-G-${sha256(group).slice(0, 12)}`;
}

function structureCounts(item) {
  const structure = item.structure ?? {};
  const counts = structure.counts ?? structure;
  const queryFieldCount = Number(
    counts.inputs ?? structure.inputs ?? structure.placeholders?.length ?? 0,
  );
  const toolbarActionCount = Number(
    structure.buttonLabels?.length ??
      (Array.isArray(structure.buttons)
        ? structure.buttons.length
        : (counts.buttons ?? structure.buttons ?? 0)),
  );
  const tableColumnCount = Number(
    structure.columnLabels?.length ?? structure.columns?.length ?? 0,
  );
  const tabCount = Number(counts.tabs ?? structure.tabs ?? 0);
  const dialogCount = Number(counts.dialogs ?? structure.dialogs ?? 0);
  const observedRegions = ['APPLICATION_SHELL'];
  if (queryFieldCount > 0) observedRegions.push('QUERY_PANEL');
  if (toolbarActionCount > 0) observedRegions.push('TOOLBAR');
  if (
    tableColumnCount > 0 ||
    Number(counts.tables ?? structure.tables ?? 0) > 0
  )
    observedRegions.push('DATA_GRID');
  if (tabCount > 0 || item.activeTab) observedRegions.push('WORKSPACE_TABS');
  if (dialogCount > 0) observedRegions.push('DIALOG_OR_DRAWER');
  if (structure.external) observedRegions.push('EXTERNAL_BOUNDARY');
  return {
    dialogCount,
    observedRegions,
    queryFieldCount,
    tabCount,
    tableColumnCount,
    toolbarActionCount,
  };
}

async function evidencePath(source, item, referenceId) {
  if (item.screenshot) {
    if (path.isAbsolute(item.screenshot)) return item.screenshot;
    return path.join(
      artifactRoot,
      'raw/target',
      source.category === 'WMS' ? 'wms-leaves' : '',
      item.screenshot,
    );
  }

  await ensureDirectory(blockedEvidenceDirectory);
  const placeholderPath = path.join(
    blockedEvidenceDirectory,
    `${referenceId}.svg`,
  );
  const renderingStatus =
    item.renderingStatus ?? 'blocked-without-retained-image';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="100%" height="100%" fill="#f5f6f8"/><text x="72" y="100" font-family="sans-serif" font-size="24" fill="#384252">${referenceId}</text><text x="72" y="146" font-family="sans-serif" font-size="18" fill="#687386">${renderingStatus}</text></svg>`;
  await writeFile(placeholderPath, svg);
  return placeholderPath;
}

function routeHashInput(item) {
  const structure = item.structure ?? {};
  return (
    item.iframeSrc ??
    structure.iframes?.[0] ??
    item.external?.url ??
    rawPath(item).join('/')
  );
}

function specializedMapping(source, item) {
  const base = { ...localMappings[source.category] };
  const pathText = rawPath(item).join('/');

  if (source.category === 'WMS') {
    if (/入库/.test(pathText)) {
      Object.assign(base, {
        route: '/wms/inbounds',
        component: 'apps/web/src/wms/InboundWorkbench.tsx',
        api: 'apps/api/src/modules/wms/inbound.controller.ts',
        test: 'apps/api/src/modules/wms/inbound.database.test.ts',
      });
    } else if (/库存|盘点|冻结|补货/.test(pathText)) {
      Object.assign(base, {
        route: '/wms/inventory',
        component: 'apps/web/src/wms/InventoryWorkbench.tsx',
        api: 'apps/api/src/modules/wms/inventory.controller.ts',
        test: 'apps/api/src/modules/wms/inventory.database.test.ts',
      });
    } else if (/出库|波次|拣|装箱|发货/.test(pathText)) {
      Object.assign(base, {
        route: '/wms/outbounds',
        component: 'apps/web/src/wms/OutboundWorkbench.tsx',
        api: 'apps/api/src/modules/wms/outbound.controller.ts',
        test: 'apps/api/src/modules/wms/outbound.database.test.ts',
      });
    }
  }

  if (source.category === 'OMS' && /执行|履约/.test(pathText)) {
    Object.assign(base, {
      route: '/oms/fulfillment-processes',
      component: 'apps/web/src/oms/FulfillmentProcessWorkbench.tsx',
      api: 'apps/api/src/modules/oms/fulfillment-process.controller.ts',
      test: 'apps/api/src/modules/oms/fulfillment-process.database.test.ts',
    });
  }

  if (source.category === 'TMS') {
    if (/计划/.test(pathText)) {
      base.route = '/tms/planning';
      base.api = 'apps/api/src/modules/tms/planning.controller.ts';
      base.test = 'apps/api/src/modules/tms/planning.database.test.ts';
    }
    if (/执行/.test(pathText)) {
      base.route = '/tms/execution';
      base.api = 'apps/api/src/modules/tms/tracking.controller.ts';
      base.test = 'apps/api/src/modules/tms/tracking.database.test.ts';
    }
    if (/结算/.test(pathText)) {
      base.route = '/tms/settlement';
      base.api = 'apps/api/src/modules/tms/freight-billing.controller.ts';
      base.test = 'apps/api/src/modules/tms/freight-billing.database.test.ts';
    }
    if (item.renderingStatus === 'external-unreachable') {
      base.status = 'BLOCKED';
      base.route = null;
      base.component = null;
      base.api = null;
      base.test = null;
      base.gap =
        'Reference leaf opens an unavailable external site; no local feature is inferred from an unreachable boundary.';
    }
  }

  if (source.category === 'MDM') {
    if (/货品/.test(pathText)) {
      base.route = '/mdm/products';
      base.api = 'apps/api/src/modules/mdm/product.controller.ts';
      base.test = 'apps/api/src/modules/mdm/product.database.test.ts';
    } else if (/贸易伙伴|地域/.test(pathText)) {
      base.route = /地域/.test(pathText) ? '/mdm/regions' : '/mdm/partners';
      base.api = 'apps/api/src/modules/mdm/partner.controller.ts';
      base.test = 'apps/api/src/modules/mdm/partner.database.test.ts';
    } else if (/运力|车队/.test(pathText)) {
      base.route = '/mdm/capacity';
      base.api = 'apps/api/src/modules/mdm/warehouse-fleet.controller.ts';
      base.test = 'apps/api/src/modules/mdm/warehouse-fleet.database.test.ts';
    } else if (/费用/.test(pathText)) {
      base.route = '/mdm/charges';
    } else if (/组织/.test(pathText)) {
      base.route = '/mdm/organizations';
      base.api = 'apps/api/src/modules/platform/organization.controller.ts';
      base.test = 'apps/api/src/modules/platform/organization.service.test.ts';
    } else if (/附件/.test(pathText)) {
      base.route = '/mdm/attachments';
      base.api = 'apps/api/src/modules/platform/attachment.controller.ts';
      base.test = 'apps/api/src/modules/platform/attachment.service.test.ts';
    } else if (/设置/.test(pathText)) {
      base.route = '/mdm/settings';
      base.api = 'apps/api/src/modules/platform/configuration.controller.ts';
      base.test = 'apps/api/src/modules/platform/configuration.service.test.ts';
    }
    if (item.renderingStatus === 'external-auth-gate') {
      base.status = 'BLOCKED';
      base.route = null;
      base.component = null;
      base.api = null;
      base.test = null;
      base.gap =
        'Reference leaf is behind an external authentication gate and was not traversed or reproduced locally.';
    }
  }

  if (
    source.category === 'REPORTS' &&
    !implementedTitles.REPORTS.has(rawTitle(item)) &&
    !['自定义报表', '自定义打印'].includes(rawTitle(item))
  ) {
    base.status = 'NOT_APPLICABLE';
    base.gap =
      'The reference leaf is a tenant-owned report template; copying its definition or data is outside the local product scope.';
  } else if (implementedTitles[source.category]?.has(rawTitle(item))) {
    base.status = 'IMPLEMENTED';
    base.gap = '';
  }

  return base;
}

const records = [];
let sequence = 1;
for (const source of sources) {
  const manifestPath = path.join(artifactRoot, 'manifests', source.file);
  const manifest = await readJson(manifestPath);
  const items = sourceItems(source, manifest);
  for (const [index, item] of items.entries()) {
    const referenceId = `${source.kind === 'BUSINESS_LEAF' ? 'LEAF' : 'DIR'}-${source.category}-${String(index + 1).padStart(3, '0')}`;
    const screenshotPath = await evidencePath(source, item, referenceId);
    const screenshotBytes = await readFile(screenshotPath);
    const captureTimestamp =
      item.capturedAt ?? (await stat(screenshotPath)).mtime.toISOString();
    const mapping = specializedMapping(source, item);
    records.push({
      referenceId,
      sequence,
      recordKind: source.kind,
      primaryCategory: source.category,
      businessGroup: groupCode(source, item),
      menuPath: rawPath(item).map(hashed),
      pageTitle: hashed(rawTitle(item)),
      referenceRouteHash: hashed(routeHashInput(item)),
      screenshotSha256: sha256(screenshotBytes),
      screenshotEvidence:
        item.screenshot == null
          ? 'REDACTED_BLOCKED_PLACEHOLDER'
          : 'CAPTURE_HASH',
      captureTimestamp,
      ...structureCounts(item),
      localRoute: mapping.route,
      localComponent: mapping.component,
      localApiEvidence: mapping.api,
      localTestEvidence: mapping.test,
      status: mapping.status,
      gapReason: mapping.status === 'IMPLEMENTED' ? '' : mapping.gap,
    });
    sequence += 1;
  }
}

await writeJson(outputPath, {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  evidencePolicy:
    'Reference labels, routes, screenshots and business data are not committed; only SHA-256 digests, structural counts and local evidence paths are retained.',
  records,
});

console.log(
  `Wrote ${records.length} redacted catalog records to ${outputPath}`,
);

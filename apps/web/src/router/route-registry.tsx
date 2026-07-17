import type { ComponentType } from 'react';
import type { AccountKind } from '@scm/shared';
import { WorkbenchHome } from './route-support';

export type RouteShell = 'ADMIN' | 'CUSTOMER' | 'PARTNER' | 'DRIVER' | 'RF';

export interface AppRouteDefinition {
  readonly allowedAccountKinds?: readonly AccountKind[];
  readonly id: string;
  readonly load: () => Promise<ComponentType>;
  readonly navLabel: string;
  readonly path: string;
  readonly shell: RouteShell;
  readonly title: string;
}

export interface AdminNavGroupDefinition {
  readonly id: string;
  readonly label: string;
  readonly routeIds: readonly string[];
}

export interface AdminNavCategoryDefinition {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly groups: readonly AdminNavGroupDefinition[];
}

/**
 * Admin information architecture. Every route id must occur exactly once.
 * The same structure drives the primary categories, business groups and leaf
 * page navigation; route components and URLs remain in ADMIN_ROUTE_REGISTRY.
 */
export const ADMIN_NAV_CATEGORIES: readonly AdminNavCategoryDefinition[] = [
  {
    id: 'workbench',
    label: '工作台',
    shortLabel: '工作台',
    groups: [{ id: 'overview', label: '总览', routeIds: ['workbench'] }],
  },
  {
    id: 'oms',
    label: '订单管理',
    shortLabel: '订单',
    groups: [
      { id: 'order-center', label: '订单中心', routeIds: ['orders'] },
      {
        id: 'fulfillment',
        label: '履约协同',
        routeIds: ['fulfillment-processes'],
      },
    ],
  },
  {
    id: 'wms',
    label: '仓储管理',
    shortLabel: '仓储',
    groups: [
      { id: 'inbound', label: '入库管理', routeIds: ['inbound'] },
      { id: 'inventory', label: '库存管理', routeIds: ['inventory'] },
      { id: 'outbound', label: '出库管理', routeIds: ['outbound'] },
      { id: 'tasks', label: '仓储任务', routeIds: ['warehouse-tasks'] },
      { id: 'wes', label: 'WES 调度', routeIds: ['warehouse-wes'] },
      {
        id: 'performance',
        label: '作业绩效',
        routeIds: ['warehouse-performance'],
      },
      { id: 'rules', label: '作业规则', routeIds: ['warehouse-rules'] },
      { id: 'devices', label: '设备协同', routeIds: ['warehouse-devices'] },
    ],
  },
  {
    id: 'tms',
    label: '运输管理',
    shortLabel: '运输',
    groups: [
      { id: 'orders', label: '订单', routeIds: ['transport-orders'] },
      { id: 'planning', label: '计划', routeIds: ['transport-planning'] },
      { id: 'execution', label: '执行', routeIds: ['transport-execution'] },
      {
        id: 'settlement',
        label: '结算与分析',
        routeIds: ['transport-settlement'],
      },
    ],
  },
  {
    id: 'ams',
    label: '预约管理',
    shortLabel: '预约',
    groups: [
      { id: 'capacity', label: '容量与预约', routeIds: ['appointments'] },
    ],
  },
  {
    id: 'billing',
    label: '结算管理',
    shortLabel: '结算',
    groups: [{ id: 'finance', label: '事实与结算', routeIds: ['billing'] }],
  },
  {
    id: 'mdm',
    label: '主数据',
    shortLabel: '主数据',
    groups: [
      { id: 'products', label: '货品管理', routeIds: ['products'] },
      { id: 'partners', label: '贸易伙伴', routeIds: ['partners'] },
      { id: 'regions', label: '地域管理', routeIds: ['master-regions'] },
      { id: 'capacity', label: '运力管理', routeIds: ['master-capacity'] },
      { id: 'fleet', label: '车队管理', routeIds: ['master-fleet'] },
      { id: 'charges', label: '费用设置', routeIds: ['master-charges'] },
      {
        id: 'organizations',
        label: '组织管理',
        routeIds: ['master-organizations'],
      },
      {
        id: 'attachments',
        label: '附件中心',
        routeIds: ['master-attachments'],
      },
      { id: 'settings', label: '综合设置', routeIds: ['master-settings'] },
    ],
  },
  {
    id: 'control',
    label: '控制塔与分析',
    shortLabel: '控制塔',
    groups: [
      { id: 'tower', label: '供应链控制塔', routeIds: ['control'] },
      { id: 'alerts', label: '预警与例外', routeIds: ['control-alerts'] },
      {
        id: 'analytics',
        label: '分析与优化',
        routeIds: ['control-bi', 'control-acceptance', 'control-ai'],
      },
      {
        id: 'reports',
        label: '报表中心',
        routeIds: [
          'report-center',
          'report-subjects',
          'my-reports',
          'report-templates',
        ],
      },
      {
        id: 'screens',
        label: '数据大屏',
        routeIds: [
          'screen-manage',
          'screen-groups',
          'my-screens',
          'screen-maps',
        ],
      },
    ],
  },
  {
    id: 'integration',
    label: '协同与集成',
    shortLabel: '协同',
    groups: [
      {
        id: 'connectivity',
        label: '开放与连接',
        routeIds: [
          'integration-gateway',
          'integration-exchange',
          'integration-adapter-iot',
        ],
      },
      { id: 'portal', label: '移动与门户', routeIds: ['mobile-portal'] },
    ],
  },
  {
    id: 'platform',
    label: '平台与系统',
    shortLabel: '平台',
    groups: [
      { id: 'identity', label: '租户与权限', routeIds: ['identity', 'rbac'] },
      {
        id: 'experience',
        label: '体验与配置',
        routeIds: [
          'components',
          'configuration',
          'attachments',
          'data-exchange',
        ],
      },
      {
        id: 'automation',
        label: '流程与自动化',
        routeIds: ['workflow', 'rules', 'jobs', 'events', 'inbox'],
      },
      {
        id: 'governance',
        label: '审计与运维',
        routeIds: ['audit', 'finalization', 'platform-operations'],
      },
      {
        id: 'support',
        label: '系统支持',
        routeIds: [
          'support-help',
          'support-user',
          'support-operations',
          'support-api',
          'support-releases',
        ],
      },
    ],
  },
] as const;

const admin = (
  definition: Omit<AppRouteDefinition, 'shell'>,
): AppRouteDefinition => ({ ...definition, shell: 'ADMIN' });

export const ADMIN_ROUTE_REGISTRY: readonly AppRouteDefinition[] = [
  admin({
    id: 'workbench',
    navLabel: '工作台',
    path: '/workbench',
    title: '工作台',
    load: async () => WorkbenchHome,
  }),
  admin({
    id: 'identity',
    navLabel: '平台',
    path: '/platform/identity',
    title: '租户与认证',
    load: () =>
      import('../platform/AuthWorkbench').then(
        (module) => module.AuthWorkbench,
      ),
  }),
  admin({
    id: 'rbac',
    navLabel: '权限',
    path: '/platform/rbac',
    title: '组织与权限',
    load: () =>
      import('../platform/OrganizationRbacWorkbench').then(
        (module) => module.OrganizationRbacWorkbench,
      ),
  }),
  admin({
    id: 'components',
    navLabel: '组件',
    path: '/platform/components',
    title: '统一组件',
    load: () =>
      import('../ui/ComponentGallery').then(
        (module) => module.ComponentGallery,
      ),
  }),
  admin({
    id: 'configuration',
    navLabel: '配置',
    path: '/platform/configuration',
    title: '配置中心',
    load: () =>
      import('../platform/ConfigurationWorkbench').then(
        (module) => module.ConfigurationWorkbench,
      ),
  }),
  admin({
    id: 'audit',
    navLabel: '审计',
    path: '/platform/audit',
    title: '审计中心',
    load: () =>
      import('../platform/AuditWorkbench').then(
        (module) => module.AuditWorkbench,
      ),
  }),
  admin({
    id: 'attachments',
    navLabel: '附件',
    path: '/platform/attachments',
    title: '附件中心',
    load: () =>
      import('../platform/AttachmentWorkbench').then(
        (module) => module.AttachmentWorkbench,
      ),
  }),
  admin({
    id: 'inbox',
    navLabel: '消息',
    path: '/platform/inbox',
    title: '待办消息',
    load: () =>
      import('../platform/NotificationWorkbench').then(
        (module) => module.NotificationWorkbench,
      ),
  }),
  admin({
    id: 'data-exchange',
    navLabel: '数据',
    path: '/platform/data-exchange',
    title: '数据交换与搜索',
    load: () =>
      import('../platform/DataExchangeWorkbench').then(
        (module) => module.DataExchangeWorkbench,
      ),
  }),
  admin({
    id: 'workflow',
    navLabel: '审批',
    path: '/platform/workflow',
    title: '工作流与审批',
    load: () =>
      import('../platform/WorkflowWorkbench').then(
        (module) => module.WorkflowWorkbench,
      ),
  }),
  admin({
    id: 'rules',
    navLabel: '规则',
    path: '/platform/rules',
    title: '规则引擎',
    load: () =>
      import('../platform/RuleEngineWorkbench').then(
        (module) => module.RuleEngineWorkbench,
      ),
  }),
  admin({
    id: 'jobs',
    navLabel: '调度',
    path: '/platform/jobs',
    title: '调度任务',
    load: () =>
      import('../platform/JobWorkbench').then((module) => module.JobWorkbench),
  }),
  admin({
    id: 'events',
    navLabel: '事件',
    path: '/platform/events',
    title: '业务事件',
    load: () =>
      import('../platform/EventWorkbench').then(
        (module) => module.EventWorkbench,
      ),
  }),
  admin({
    id: 'finalization',
    navLabel: '收尾',
    path: '/platform/finalization',
    title: '平台收尾',
    load: () =>
      import('../platform/PlatformFinalizationWorkbench').then(
        (module) => module.PlatformFinalizationWorkbench,
      ),
  }),
  admin({
    id: 'products',
    navLabel: '货品',
    path: '/mdm/products',
    title: '货品主数据',
    load: () =>
      import('../mdm/MasterDataHub').then(
        (module) => module.MasterProductsPage,
      ),
  }),
  admin({
    id: 'partners',
    navLabel: '伙伴',
    path: '/mdm/partners',
    title: '伙伴与地址',
    load: () =>
      import('../mdm/MasterDataHub').then(
        (module) => module.MasterPartnersPage,
      ),
  }),
  admin({
    id: 'master-regions',
    navLabel: '地域',
    path: '/mdm/regions',
    title: '地域管理',
    load: () =>
      import('../mdm/MasterDataHub').then((module) => module.MasterRegionsPage),
  }),
  admin({
    id: 'master-capacity',
    navLabel: '运力',
    path: '/mdm/capacity',
    title: '运力管理',
    load: () =>
      import('../mdm/MasterDataHub').then(
        (module) => module.MasterCapacityPage,
      ),
  }),
  admin({
    id: 'master-fleet',
    navLabel: '车队',
    path: '/mdm/fleet',
    title: '车队管理',
    load: () =>
      import('../mdm/MasterDataHub').then((module) => module.MasterFleetPage),
  }),
  admin({
    id: 'master-charges',
    navLabel: '费用',
    path: '/mdm/charges',
    title: '费用设置',
    load: () =>
      import('../mdm/MasterDataHub').then((module) => module.MasterChargesPage),
  }),
  admin({
    id: 'master-organizations',
    navLabel: '组织',
    path: '/mdm/organizations',
    title: '组织管理',
    load: () =>
      import('../mdm/MasterDataHub').then(
        (module) => module.MasterOrganizationsPage,
      ),
  }),
  admin({
    id: 'master-attachments',
    navLabel: '附件',
    path: '/mdm/attachments',
    title: '主数据附件',
    load: () =>
      import('../mdm/MasterDataHub').then(
        (module) => module.MasterAttachmentsPage,
      ),
  }),
  admin({
    id: 'master-settings',
    navLabel: '设置',
    path: '/mdm/settings',
    title: '主数据综合设置',
    load: () =>
      import('../mdm/MasterDataHub').then(
        (module) => module.MasterSettingsPage,
      ),
  }),
  admin({
    id: 'orders',
    navLabel: '订单',
    path: '/oms/orders',
    title: '订单中心',
    load: () =>
      import('../oms/OrderIntakeWorkbench').then(
        (module) => module.OrderIntakeWorkbench,
      ),
  }),
  admin({
    id: 'fulfillment-processes',
    navLabel: '履约',
    path: '/oms/fulfillment-processes',
    title: '履约过程',
    load: () =>
      import('../oms/FulfillmentProcessWorkbench').then(
        (module) => module.FulfillmentProcessWorkbench,
      ),
  }),
  admin({
    id: 'inbound',
    navLabel: '入库',
    path: '/wms/inbounds',
    title: '入库接入',
    load: () =>
      import('../wms/InboundWorkbench').then(
        (module) => module.InboundWorkbench,
      ),
  }),
  admin({
    id: 'inventory',
    navLabel: '仓储',
    path: '/wms/inventory',
    title: '库存视图',
    load: () =>
      import('../wms/InventoryWorkbench').then(
        (module) => module.InventoryWorkbench,
      ),
  }),
  admin({
    id: 'outbound',
    navLabel: '出库',
    path: '/wms/outbounds',
    title: '出库与波次',
    load: () =>
      import('../wms/OutboundWorkbench').then(
        (module) => module.OutboundWorkbench,
      ),
  }),
  admin({
    id: 'warehouse-tasks',
    navLabel: '任务',
    path: '/wms/operations/tasks',
    title: '仓储任务中心',
    load: () =>
      import('../wms/WarehouseOperationsHub').then(
        (module) => module.WarehouseTasksPage,
      ),
  }),
  admin({
    id: 'warehouse-wes',
    navLabel: 'WES',
    path: '/wms/operations/wes',
    title: 'WES 调度',
    load: () =>
      import('../wms/WarehouseOperationsHub').then(
        (module) => module.WarehouseWesPage,
      ),
  }),
  admin({
    id: 'warehouse-performance',
    navLabel: '绩效',
    path: '/wms/operations/performance',
    title: '作业绩效',
    load: () =>
      import('../wms/WarehouseOperationsHub').then(
        (module) => module.WarehousePerformancePage,
      ),
  }),
  admin({
    id: 'warehouse-rules',
    navLabel: '规则',
    path: '/wms/operations/rules',
    title: '作业规则',
    load: () =>
      import('../wms/WarehouseOperationsHub').then(
        (module) => module.WarehouseRulesPage,
      ),
  }),
  admin({
    id: 'warehouse-devices',
    navLabel: '设备',
    path: '/wms/operations/devices',
    title: '设备协同',
    load: () =>
      import('../wms/WarehouseOperationsHub').then(
        (module) => module.WarehouseDevicesPage,
      ),
  }),
  admin({
    id: 'transport-orders',
    navLabel: '运输订单',
    path: '/tms/orders',
    title: '运输订单',
    load: () =>
      import('../tms/TransportOrderWorkbench').then(
        (module) => module.TransportOrdersPage,
      ),
  }),
  admin({
    id: 'transport-planning',
    navLabel: '运输计划',
    path: '/tms/planning',
    title: '运输计划',
    load: () =>
      import('../tms/TransportOrderWorkbench').then(
        (module) => module.TransportPlanningPage,
      ),
  }),
  admin({
    id: 'transport-execution',
    navLabel: '运输执行',
    path: '/tms/execution',
    title: '运输执行',
    load: () =>
      import('../tms/TransportOrderWorkbench').then(
        (module) => module.TransportExecutionPage,
      ),
  }),
  admin({
    id: 'transport-settlement',
    navLabel: '运输结算',
    path: '/tms/settlement',
    title: '运输结算与分析',
    load: () =>
      import('../tms/TransportOrderWorkbench').then(
        (module) => module.TransportSettlementPage,
      ),
  }),
  admin({
    id: 'appointments',
    navLabel: '预约',
    path: '/ams/capacity',
    title: '预约容量',
    load: () =>
      import('../ams/AppointmentCapacityWorkbench').then(
        (module) => module.AppointmentCapacityWorkbench,
      ),
  }),
  admin({
    id: 'billing',
    navLabel: '结算',
    path: '/billing/facts',
    title: '结算中心',
    load: () =>
      import('../billing/BillingFactWorkbench').then(
        (module) => module.BillingFactWorkbench,
      ),
  }),
  admin({
    id: 'control',
    navLabel: '控制塔',
    path: '/control/tower',
    title: '控制塔',
    load: () =>
      import('../control/ControlTowerWorkbench').then(
        (module) => module.ControlTowerWorkbench,
      ),
  }),
  admin({
    id: 'control-alerts',
    navLabel: '预警',
    path: '/control/alerts',
    title: '预警例外',
    load: () =>
      import('../control/AlertGovernanceWorkbench').then(
        (module) => module.AlertGovernanceWorkbench,
      ),
  }),
  admin({
    id: 'control-bi',
    navLabel: 'BI',
    path: '/control/bi',
    title: 'BI 分析',
    load: () =>
      import('../control/BiAnalyticsWorkbench').then(
        (module) => module.BiAnalyticsWorkbench,
      ),
  }),
  admin({
    id: 'control-acceptance',
    navLabel: '验收',
    path: '/control/acceptance',
    title: 'P4 验收',
    load: () =>
      import('../control/ReconciliationWorkbench').then(
        (module) => module.ReconciliationWorkbench,
      ),
  }),
  admin({
    id: 'control-ai',
    navLabel: 'AI 优化',
    path: '/control/ai',
    title: 'AI 优化',
    load: () =>
      import('../control/AiOptimizationWorkbench').then(
        (module) => module.AiOptimizationWorkbench,
      ),
  }),
  admin({
    id: 'report-center',
    navLabel: '报表中心',
    path: '/reports/center',
    title: '报表中心',
    load: () =>
      import('../reports/ReportCenterWorkbench').then(
        (module) => module.ReportCenterPage,
      ),
  }),
  admin({
    id: 'report-subjects',
    navLabel: '主题分析',
    path: '/reports/subjects',
    title: '主题分析',
    load: () =>
      import('../reports/ReportCenterWorkbench').then(
        (module) => module.ReportSubjectsPage,
      ),
  }),
  admin({
    id: 'my-reports',
    navLabel: '我的报表',
    path: '/reports/mine',
    title: '我的报表',
    load: () =>
      import('../reports/ReportCenterWorkbench').then(
        (module) => module.MyReportsPage,
      ),
  }),
  admin({
    id: 'report-templates',
    navLabel: '模板',
    path: '/reports/templates',
    title: '报表模板管理',
    load: () =>
      import('../reports/ReportCenterWorkbench').then(
        (module) => module.ReportTemplatesPage,
      ),
  }),
  admin({
    id: 'screen-manage',
    navLabel: '大屏管理',
    path: '/screens/manage',
    title: '大屏管理',
    load: () =>
      import('../screens/DataScreenWorkbench').then(
        (module) => module.DataScreenManagePage,
      ),
  }),
  admin({
    id: 'screen-groups',
    navLabel: '大屏分组',
    path: '/screens/groups',
    title: '大屏分组',
    load: () =>
      import('../screens/DataScreenWorkbench').then(
        (module) => module.DataScreenGroupsPage,
      ),
  }),
  admin({
    id: 'my-screens',
    navLabel: '我的大屏',
    path: '/screens/mine',
    title: '我的大屏',
    load: () =>
      import('../screens/DataScreenWorkbench').then(
        (module) => module.MyDataScreensPage,
      ),
  }),
  admin({
    id: 'screen-maps',
    navLabel: '地图',
    path: '/screens/maps',
    title: '地图配置',
    load: () =>
      import('../screens/DataScreenWorkbench').then(
        (module) => module.DataScreenMapsPage,
      ),
  }),
  admin({
    id: 'integration-gateway',
    navLabel: '集成',
    path: '/integration/gateway',
    title: '开放 API',
    load: () =>
      import('../integration/ApiGatewayWorkbench').then(
        (module) => module.ApiGatewayWorkbench,
      ),
  }),
  admin({
    id: 'integration-exchange',
    navLabel: '消息集成',
    path: '/integration/exchange',
    title: '消息集成',
    load: () =>
      import('../integration/MessageExchangeWorkbench').then(
        (module) => module.MessageExchangeWorkbench,
      ),
  }),
  admin({
    id: 'integration-adapter-iot',
    navLabel: '适配器与 IoT',
    path: '/integration/adapter-iot',
    title: '适配器与 IoT',
    load: () =>
      import('../integration/AdapterIotWorkbench').then(
        (module) => module.AdapterIotWorkbench,
      ),
  }),
  admin({
    id: 'mobile-portal',
    navLabel: '移动与门户',
    path: '/integration/mobile-portal',
    title: '移动与伙伴门户',
    load: () =>
      import('../integration/MobilePortalWorkbench').then(
        (module) => module.MobilePortalWorkbench,
      ),
  }),
  admin({
    allowedAccountKinds: ['PLATFORM_ADMIN'],
    id: 'platform-operations',
    navLabel: '生产运维',
    path: '/platform/operations',
    title: '生产运维',
    load: () =>
      import('../platform/OperationsWorkbench').then(
        (module) => module.OperationsWorkbench,
      ),
  }),
  admin({
    id: 'support-help',
    navLabel: '帮助',
    path: '/support/help',
    title: '帮助中心',
    load: () =>
      import('../support/HelpCenterWorkbench').then(
        (module) => module.HelpHomePage,
      ),
  }),
  admin({
    id: 'support-user',
    navLabel: '用户手册',
    path: '/support/user-guide',
    title: '用户手册',
    load: () =>
      import('../support/HelpCenterWorkbench').then(
        (module) => module.UserGuidePage,
      ),
  }),
  admin({
    id: 'support-operations',
    navLabel: '运维手册',
    path: '/support/operations',
    title: '运维手册',
    load: () =>
      import('../support/HelpCenterWorkbench').then(
        (module) => module.OperationsGuidePage,
      ),
  }),
  admin({
    id: 'support-api',
    navLabel: 'API 文档',
    path: '/support/api',
    title: 'API 与架构',
    load: () =>
      import('../support/HelpCenterWorkbench').then(
        (module) => module.ApiGuidePage,
      ),
  }),
  admin({
    id: 'support-releases',
    navLabel: '版本说明',
    path: '/support/releases',
    title: '版本说明',
    load: () =>
      import('../support/HelpCenterWorkbench').then(
        (module) => module.ReleaseNotesPage,
      ),
  }),
] as const;

export const TERMINAL_ROUTE_REGISTRY: readonly AppRouteDefinition[] = [
  {
    id: 'customer-portal',
    navLabel: '客户门户',
    path: '/portal/customer/*',
    shell: 'CUSTOMER',
    title: '客户门户',
    load: () =>
      import('./terminal-shells').then((module) => module.CustomerPortalShell),
  },
  {
    id: 'partner-portal',
    navLabel: '伙伴门户',
    path: '/portal/partner/*',
    shell: 'PARTNER',
    title: '伙伴门户',
    load: () =>
      import('./terminal-shells').then((module) => module.PartnerPortalShell),
  },
  {
    id: 'driver-terminal',
    navLabel: '司机端',
    path: '/driver/*',
    shell: 'DRIVER',
    title: '司机执行端',
    load: () =>
      import('./terminal-shells').then((module) => module.DriverTerminalShell),
  },
  {
    id: 'rf-terminal',
    navLabel: 'RF 端',
    path: '/rf/*',
    shell: 'RF',
    title: '仓储 RF 端',
    load: () =>
      import('./terminal-shells').then((module) => module.RfTerminalShell),
  },
] as const;

export const APP_ROUTE_REGISTRY = [
  ...ADMIN_ROUTE_REGISTRY,
  ...TERMINAL_ROUTE_REGISTRY,
] as const;

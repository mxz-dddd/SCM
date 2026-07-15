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
    navLabel: '商品',
    path: '/mdm/products',
    title: '商品主数据',
    load: () =>
      import('../mdm/ProductWorkbench').then(
        (module) => module.ProductWorkbench,
      ),
  }),
  admin({
    id: 'partners',
    navLabel: '伙伴',
    path: '/mdm/partners',
    title: '伙伴与地址',
    load: () =>
      import('../mdm/PartnerWorkbench').then(
        (module) => module.PartnerWorkbench,
      ),
  }),
  admin({
    id: 'warehouses',
    navLabel: '仓库',
    path: '/mdm/warehouses',
    title: '仓库与车队',
    load: () =>
      import('../mdm/WarehouseFleetWorkbench').then(
        (module) => module.WarehouseFleetWorkbench,
      ),
  }),
  admin({
    id: 'mdm-governance',
    navLabel: '治理',
    path: '/mdm/governance',
    title: '主数据治理',
    load: () =>
      import('../mdm/MdmGovernanceWorkbench').then(
        (module) => module.MdmGovernanceWorkbench,
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
    id: 'operations',
    navLabel: '作业',
    path: '/wms/operations',
    title: '移动作业与看板',
    load: () =>
      import('../wms/MobileOperationsWorkbench').then(
        (module) => module.MobileOperationsWorkbench,
      ),
  }),
  admin({
    id: 'transport',
    navLabel: '运输',
    path: '/tms/shipments',
    title: '运输执行',
    load: () =>
      import('../tms/TransportOrderWorkbench').then(
        (module) => module.TransportOrderWorkbench,
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

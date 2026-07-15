export const PERMISSION_RESOURCE_TYPES = [
  'MENU',
  'PAGE',
  'API',
  'BUTTON',
  'FIELD',
  'EXPORT',
] as const;

export type PermissionEffect = 'ALLOW' | 'DENY';
export type PermissionResourceType = (typeof PERMISSION_RESOURCE_TYPES)[number];

const MODULE_ADMIN_PERMISSION_CODES = [
  'billing.calculation.execute',
  'billing.accrual.manage',
  'billing.adjustment.approve',
  'billing.adjustment.manage',
  'billing.fact.correct',
  'billing.fact.ingest',
  'billing.fact.read',
  'billing.invoice.manage',
  'billing.payment.manage',
  'billing.period.close',
  'billing.period.reopen',
  'billing.reconciliation.manage',
  'billing.reconciliation.respond',
  'billing.report.generate',
  'billing.voucher.approve',
  'billing.voucher.manage',
  'billing.voucher.validate',
  'ams.appointment.approve',
  'ams.appointment.change',
  'ams.appointment.create',
  'ams.appointment.read',
  'ams.appointment.recurring',
  'ams.appointment.remind',
  'ams.capacity.manage',
  'ams.capacity.read',
  'ams.dashboard.read',
  'ams.dock.assign',
  'ams.gate.access',
  'ams.gate.checkout',
  'ams.gate.verify',
  'ams.noshow.appeal',
  'ams.noshow.manage',
  'ams.noshow.waive',
  'ams.onsite.read',
  'ams.operation.manage',
  'ams.operation.read',
  'ams.queue.manage',
  'ams.workload.adjust',
  'ams.workload.calculate',
  'ams.workload.manage',
  'tms.billing.accrual',
  'tms.billing.calculate',
  'tms.billing.read',
  'tms.billing.settle',
  'tms.billing.statement',
  'tms.capacity-tender.read',
  'tms.capacity.manage',
  'tms.capacity.reserve',
  'tms.claim.manage',
  'tms.delivery.confirm',
  'tms.delivery.read',
  'tms.dispatch.assign',
  'tms.dispatch.compliance',
  'tms.dispatch.confirm',
  'tms.dispatch.read',
  'tms.driver.execute',
  'tms.fleet.maintenance',
  'tms.fleet.read',
  'tms.iot.ingest',
  'tms.iot.resolve',
  'tms.metrics.generate',
  'tms.operations.appointment.integrate',
  'tms.operations.appointment.manage',
  'tms.operations.exception.detect',
  'tms.operations.exception.escalate',
  'tms.operations.exception.manage',
  'tms.operations.map.precise',
  'tms.operations.map.refresh',
  'tms.operations.read',
  'tms.plan.approve',
  'tms.pod.review',
  'tms.pod.submit',
  'tms.quote.award',
  'tms.quote.bid',
  'tms.quote.manage',
  'tms.return.manage',
  'tms.subcontract.manage',
  'tms.subcontract.respond',
  'tms.tender.manage',
  'tms.tender.respond',
  'tms.tender.revoke',
  'tms.tracking.ingest',
  'tms.tracking.plan',
  'tms.tracking.predict',
  'tms.tracking.read',
  'tms.tracking.share',
] as const;

function moduleAdminPermission(
  code: (typeof MODULE_ADMIN_PERMISSION_CODES)[number],
): {
  code: string;
  name: string;
  resourceRef: string;
  resourceType: PermissionResourceType;
} {
  const domain = code.split('.')[0]!;
  return {
    code,
    name: `业务模块权限（${code}）`,
    resourceRef: `/api/v1/${domain}/*`,
    resourceType: code.endsWith('.read') ? 'PAGE' : 'BUTTON',
  };
}

export const ADMIN_PERMISSIONS = [
  ...MODULE_ADMIN_PERMISSION_CODES.map(moduleAdminPermission),
  {
    code: 'tms.transport.read',
    name: '查看运输订单',
    resourceRef: '/api/v1/tms/transport-orders*',
    resourceType: 'PAGE',
  },
  {
    code: 'tms.transport.receive',
    name: '接收运输订单',
    resourceRef: '/api/v1/tms/transport-orders',
    resourceType: 'BUTTON',
  },
  {
    code: 'tms.transport.review',
    name: '审核运输订单',
    resourceRef: '/api/v1/tms/transport-orders/*/review',
    resourceType: 'BUTTON',
  },
  {
    code: 'tms.planning.read',
    name: '查看运输计划工作台',
    resourceRef: '/api/v1/tms/planning/workbench',
    resourceType: 'PAGE',
  },
  {
    code: 'tms.planning.manage',
    name: '创建批次与构建运输计划',
    resourceRef: '/api/v1/tms/planning/*',
    resourceType: 'BUTTON',
  },
  {
    code: 'tms.planning.claim',
    name: '领取和释放计划订单',
    resourceRef: '/api/v1/tms/planning/*/claim',
    resourceType: 'BUTTON',
  },
  {
    code: 'tms.planning.publish',
    name: '校验并发布运输计划',
    resourceRef: '/api/v1/tms/planning/plans/*/publish',
    resourceType: 'BUTTON',
  },
  {
    code: 'tms.optimization.read',
    name: '查看配载路线优化',
    resourceRef: '/api/v1/tms/optimization/workbench',
    resourceType: 'PAGE',
  },
  {
    code: 'tms.load.manage',
    name: '编辑运输配载',
    resourceRef: '/api/v1/tms/optimization/load-plans*',
    resourceType: 'BUTTON',
  },
  {
    code: 'tms.load.publish',
    name: '校验发布配载',
    resourceRef: '/api/v1/tms/optimization/load-plans/*/transition',
    resourceType: 'BUTTON',
  },
  {
    code: 'tms.route.optimize',
    name: '优化选择运输路线',
    resourceRef: '/api/v1/tms/optimization/*route*',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.read',
    name: '查看库存余额',
    resourceRef: '/api/v1/wms/inventory',
    resourceType: 'PAGE',
  },
  {
    code: 'wms.inventory.trace',
    name: '查看库存追溯链',
    resourceRef: '/api/v1/wms/inventory/*/trace',
    resourceType: 'PAGE',
  },
  {
    code: 'wms.inventory.receive',
    name: '登记库存入账',
    resourceRef: '/api/v1/wms/inventory/receipts',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.status.write',
    name: '变更库存状态',
    resourceRef: '/api/v1/wms/inventory/*/status-transitions',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.hold',
    name: '冻结库存',
    resourceRef: '/api/v1/wms/inventory/*/holds',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.hold.release',
    name: '审批解冻库存',
    resourceRef: '/api/v1/wms/inventory-holds/*/release',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.reserve',
    name: '预占库存',
    resourceRef: '/api/v1/wms/inventory/*/reservations',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.reserve.release',
    name: '释放库存预占',
    resourceRef: '/api/v1/wms/inventory-reservations/*/release',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.transfer',
    name: '执行库存移库',
    resourceRef: '/api/v1/wms/inventory/*/transfers',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.owner-transfer',
    name: '执行货主转换',
    resourceRef: '/api/v1/wms/inventory/*/ownership-transfers',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.count.read',
    name: '查看库存盘点',
    resourceRef: '/api/v1/wms/inventory-counts/*',
    resourceType: 'PAGE',
  },
  {
    code: 'wms.inventory.count.plan',
    name: '创建库存盘点',
    resourceRef: '/api/v1/wms/inventory-counts',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.count.execute',
    name: '执行库存初复盘',
    resourceRef: '/api/v1/wms/inventory-count*',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.count.approve',
    name: '审批盘点差异与分段解冻',
    resourceRef: '/api/v1/wms/inventory-count*',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.governance.read',
    name: '查看库存治理工作台',
    resourceRef: '/api/v1/wms/inventory-governance',
    resourceType: 'PAGE',
  },
  {
    code: 'wms.inventory.adjust.write',
    name: '创建库存调整单',
    resourceRef: '/api/v1/wms/inventory-adjustments',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.adjust.approve',
    name: '审批并过账库存调整',
    resourceRef: '/api/v1/wms/inventory-adjustments/*/transition',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.replenishment.plan',
    name: '配置并计划自动补货',
    resourceRef: '/api/v1/wms/replenishment-policies*',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.replenishment.execute',
    name: '执行补货任务',
    resourceRef: '/api/v1/wms/replenishment-tasks/*/execute',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.aging.run',
    name: '运行库龄效期评估',
    resourceRef: '/api/v1/wms/inventory-aging-runs',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.reconcile',
    name: '执行并关闭库存对账',
    resourceRef: '/api/v1/wms/inventory-reconciliations*',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inventory.reconcile.resolve',
    name: '处置库存对账差异工单',
    resourceRef: '/api/v1/wms/inventory-reconciliation-cases/*/resolve',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.outbound.read',
    name: '查看出库与波次',
    resourceRef: '/api/v1/wms/outbounds',
    resourceType: 'PAGE',
  },
  {
    code: 'wms.outbound.write',
    name: '接收出库单',
    resourceRef: '/api/v1/wms/outbounds',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.outbound.release',
    name: '释放出库单',
    resourceRef: '/api/v1/wms/outbounds/*/release',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.wave.template.write',
    name: '配置波次模板',
    resourceRef: '/api/v1/wms/wave-templates',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.wave.plan',
    name: '模拟与创建波次',
    resourceRef: '/api/v1/wms/wave*',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.wave.release',
    name: '发布与完成波次',
    resourceRef: '/api/v1/wms/waves/*/transition',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.outbound.shortage.resolve',
    name: '处置出库缺货',
    resourceRef: '/api/v1/wms/outbound-shortages/*/resolve',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.picking.read',
    name: '查看拣选工作台',
    resourceRef: '/api/v1/wms/picking',
    resourceType: 'PAGE',
  },
  {
    code: 'wms.picking.execute',
    name: '执行拣选与 RF 扫描',
    resourceRef: '/api/v1/wms/pick-task*',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.picking.supervise',
    name: '处置短拣与重算路线',
    resourceRef: '/api/v1/wms/*pick*',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.picking.verify',
    name: '执行拣选复核与纠正',
    resourceRef: '/api/v1/wms/pick-*verify*',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.pack-ship.read',
    name: '查看包装发运工作台',
    resourceRef: '/api/v1/wms/pack-ship',
    resourceType: 'PAGE',
  },
  {
    code: 'wms.pack.execute',
    name: '执行包装称重量方',
    resourceRef: '/api/v1/wms/*pack*',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.pack.supervise',
    name: '处置包装超差',
    resourceRef: '/api/v1/wms/weight-exceptions/*/resolve',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.pack.label',
    name: '签发作废出库标签',
    resourceRef: '/api/v1/wms/*label*',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.ship.stage',
    name: '执行集货暂存',
    resourceRef: '/api/v1/wms/packages/*/stage',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.ship.load',
    name: '执行装车校验',
    resourceRef: '/api/v1/wms/*load*',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.ship.confirm',
    name: '确认发运与库存扣减',
    resourceRef: '/api/v1/wms/load-tasks/*/ship',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.ship.cancel',
    name: '执行出库取消补偿',
    resourceRef: '/api/v1/wms/outbounds/*/cancel',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.operations.read',
    name: '查看增值劳务设备工作台',
    resourceRef: '/api/v1/wms/operations',
    resourceType: 'PAGE',
  },
  {
    code: 'wms.dashboard.read',
    name: '查看仓库作业看板',
    resourceRef: '/api/v1/wms/dashboard',
    resourceType: 'PAGE',
  },
  {
    code: 'wms.vas.execute',
    name: '执行增值作业',
    resourceRef: '/api/v1/wms/value-added-orders*',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.labor.manage',
    name: '配置标准工时与劳务指派',
    resourceRef: '/api/v1/wms/labor-*',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.labor.execute',
    name: '执行劳务任务',
    resourceRef: '/api/v1/wms/labor-assignments/*/transition',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.mobile.sync',
    name: '同步 RF 离线命令',
    resourceRef: '/api/v1/wms/offline-devices/*/sync',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.mobile.supervise',
    name: '处置 RF 离线冲突',
    resourceRef: '/api/v1/wms/offline-conflicts/*/resolve',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.device.control',
    name: '控制仓储设备与回执',
    resourceRef: '/api/v1/wms/device-commands*',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.quality.read',
    name: '查看质检与上架',
    resourceRef: '/api/v1/wms/inbounds/*/quality-putaway',
    resourceType: 'PAGE',
  },
  {
    code: 'wms.quality.plan',
    name: '创建质检计划',
    resourceRef: '/api/v1/wms/inbounds/*/inspections',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.quality.inspect',
    name: '执行质检与判定',
    resourceRef: '/api/v1/wms/inspections/*/transition',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.quality.dispose',
    name: '处置不合格品',
    resourceRef: '/api/v1/wms/inspections/*/dispositions',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.putaway.decide',
    name: '执行上架策略',
    resourceRef: '/api/v1/wms/inbounds/*/putaway-decisions',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.putaway.task.write',
    name: '创建上架任务',
    resourceRef: '/api/v1/wms/putaway-decisions/*/tasks',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.putaway.task.execute',
    name: '执行上架扫描确认',
    resourceRef: '/api/v1/wms/putaway-tasks/*',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.cross-dock.write',
    name: '创建与执行越库分配',
    resourceRef: '/api/v1/wms/*cross-dock*',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.receipt.read',
    name: '查看收货明细',
    resourceRef: '/api/v1/wms/inbounds/*/receiving-*',
    resourceType: 'PAGE',
  },
  {
    code: 'wms.receipt.receive',
    name: '确认普通收货',
    resourceRef: '/api/v1/wms/inbounds/*/receive',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.receipt.variance.authorize',
    name: '授权超短收与替代包装',
    resourceRef: '/api/v1/wms/inbounds/*/receive-authorized',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.handling-unit.write',
    name: '创建处理单元与标签',
    resourceRef: '/api/v1/wms/inbounds/*/handling-units',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.handling-unit.build',
    name: 'LPN 建托',
    resourceRef: '/api/v1/wms/handling-units/*/build',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.handling-unit.split',
    name: 'LPN 拆托',
    resourceRef: '/api/v1/wms/handling-units/*/split',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.handling-unit.merge',
    name: 'LPN 合托',
    resourceRef: '/api/v1/wms/handling-units/*/merge',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.label.print',
    name: '补打 LPN 标签',
    resourceRef: '/api/v1/wms/handling-units/*/labels/reprint',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.receiving.variance.write',
    name: '记录收货差异',
    resourceRef: '/api/v1/wms/receiving-variances',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.receiving.variance.dispose',
    name: '处置收货差异',
    resourceRef: '/api/v1/wms/receiving-variances/*/disposition',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inbound.read',
    name: '查看入库与收货任务',
    resourceRef: '/api/v1/wms/inbounds*',
    resourceType: 'PAGE',
  },
  {
    code: 'wms.inbound.write',
    name: '创建入库单',
    resourceRef: '/api/v1/wms/inbounds',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inbound.publish',
    name: '发布预期入库',
    resourceRef: '/api/v1/wms/inbounds/*/publish',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inbound.package',
    name: '解析 ASN 包装层级',
    resourceRef: '/api/v1/wms/inbounds/*/packages/parse',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inbound.appointment.project',
    name: '接收预约投影',
    resourceRef: '/api/v1/wms/inbounds/*/appointment-projections',
    resourceType: 'API',
  },
  {
    code: 'wms.inbound.checkin',
    name: '入库到场签到',
    resourceRef: '/api/v1/wms/inbounds/*/check-in',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.receipt.task.write',
    name: '创建收货任务',
    resourceRef: '/api/v1/wms/inbounds/*/receipt-tasks',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.receipt.task.assign',
    name: '自动指派收货任务',
    resourceRef: '/api/v1/wms/receipt-tasks/*/assign',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.receipt.task.claim',
    name: '抢领收货任务',
    resourceRef: '/api/v1/wms/receipt-tasks/*/claim',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.receipt.task.transfer',
    name: '转派收货任务',
    resourceRef: '/api/v1/wms/receipt-tasks/*/transfer',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.receipt.task.execute',
    name: '执行收货任务',
    resourceRef: '/api/v1/wms/receipt-tasks/*/transition',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.inbound.complete',
    name: '完成入库单',
    resourceRef: '/api/v1/wms/inbounds/*/complete',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.scan.write',
    name: '记录 RF 条码扫描',
    resourceRef: '/api/v1/wms/scans',
    resourceType: 'BUTTON',
  },
  {
    code: 'wms.scan.resolve',
    name: '人工解析条码',
    resourceRef: '/api/v1/wms/scans/*/manual-resolution',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.order.read',
    name: '查看订单与接入异常',
    resourceRef: '/api/v1/oms/orders/*',
    resourceType: 'API',
  },
  {
    code: 'oms.order.write',
    name: '创建和修改订单草稿',
    resourceRef: '/api/v1/oms/orders/*',
    resourceType: 'API',
  },
  {
    code: 'oms.order.submit',
    name: '校验并提交订单',
    resourceRef: '/api/v1/oms/orders/*/submit',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.order.warning.override',
    name: '强制通过订单校验警告',
    resourceRef: '/api/v1/oms/orders/*/submit-with-warnings',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.order.review',
    name: '执行订单风险审核',
    resourceRef: '/api/v1/oms/orders/*/review',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.order.approve',
    name: '人工审批订单审核',
    resourceRef: '/api/v1/oms/order-reviews/*/decision',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.order.adjust',
    name: '合单与拆单',
    resourceRef: '/api/v1/oms/order-*',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.order.priority',
    name: '调整订单与订单行优先级',
    resourceRef: '/api/v1/oms/orders/*/priority',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.order.hold',
    name: '冻结订单或订单行',
    resourceRef: '/api/v1/oms/orders/*/holds',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.order.hold.release',
    name: '解除订单冻结',
    resourceRef: '/api/v1/oms/order-holds/*/release',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.order.change',
    name: '发起订单变更',
    resourceRef: '/api/v1/oms/orders/*/changes',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.order.change.confirm',
    name: '确认订单变更影响',
    resourceRef: '/api/v1/oms/order-changes/*/confirmations',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.order.cancel',
    name: '取消订单',
    resourceRef: '/api/v1/oms/orders/*/cancel',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.fulfillment.project',
    name: '投影订单履约进度',
    resourceRef: '/api/v1/oms/orders/*/lines/*/progress',
    resourceType: 'API',
  },
  {
    code: 'oms.substitution.write',
    name: '发起替代品建议',
    resourceRef: '/api/v1/oms/orders/*/lines/*/substitutions',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.substitution.decide',
    name: '确认替代品建议',
    resourceRef: '/api/v1/oms/substitutions/*/decision',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.rma.write',
    name: '发起退货授权',
    resourceRef: '/api/v1/oms/orders/*/rmas',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.rma.transition',
    name: '推进退货授权',
    resourceRef: '/api/v1/oms/rmas/*/transition',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.exception.read',
    name: '查看订单异常',
    resourceRef: '/api/v1/oms/order-exceptions',
    resourceType: 'PAGE',
  },
  {
    code: 'oms.exception.write',
    name: '检测订单异常',
    resourceRef: '/api/v1/oms/order-exceptions/detect',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.exception.assign',
    name: '指派订单异常',
    resourceRef: '/api/v1/oms/order-exceptions/*/assign',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.exception.retry',
    name: '重试与补偿订单异常',
    resourceRef: '/api/v1/oms/order-exceptions/*/actions/*',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.sla.write',
    name: '维护订单 SLA 时钟',
    resourceRef: '/api/v1/oms/*/sla-clocks',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.sla.monitor',
    name: '监控与升级订单 SLA',
    resourceRef: '/api/v1/oms/sla-clocks/monitor',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.settlement.write',
    name: '创建订单结算请求',
    resourceRef: '/api/v1/oms/orders/*/settlement-requests',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.settlement.project',
    name: '接收计费状态投影',
    resourceRef: '/api/v1/oms/settlement-requests/*/status',
    resourceType: 'API',
  },
  {
    code: 'oms.order.batch',
    name: '执行逐单鉴权批量动作',
    resourceRef: '/api/v1/oms/order-batches',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.portal.order.read',
    name: '客户门户查看订单',
    resourceRef: '/api/v1/oms/portal/orders/*',
    resourceType: 'PAGE',
  },
  {
    code: 'oms.portal.order.change',
    name: '客户门户申请变更',
    resourceRef: '/api/v1/oms/portal/orders/*/changes',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.portal.order.cancel',
    name: '客户门户取消订单',
    resourceRef: '/api/v1/oms/portal/orders/*/cancel',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.portal.rma.write',
    name: '客户门户申请退货',
    resourceRef: '/api/v1/oms/portal/orders/*/rmas',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.availability.read',
    name: '查询 ATP 与承诺快照',
    resourceRef: '/api/v1/oms/availability*',
    resourceType: 'API',
  },
  {
    code: 'oms.availability.project',
    name: '接收库存可用量投影',
    resourceRef: '/api/v1/oms/availability-projections',
    resourceType: 'API',
  },
  {
    code: 'oms.order.allocate',
    name: '执行订单分配与预占',
    resourceRef: '/api/v1/oms/orders/*/allocations',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.allocation.release',
    name: '释放订单库存预占',
    resourceRef: '/api/v1/oms/allocations/*/release',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.order.release',
    name: '释放订单履约',
    resourceRef: '/api/v1/oms/orders/*/release',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.order.release.batch',
    name: '批量释放订单履约',
    resourceRef: '/api/v1/oms/order-release-batches',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.order.release.auto',
    name: '按日历自动释放订单',
    resourceRef: '/api/v1/oms/order-release-batches/automatic',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.fulfillment.project',
    name: '回写履约进度事件',
    resourceRef: '/api/v1/oms/fulfillment-orders/*/status-events',
    resourceType: 'API',
  },
  {
    code: 'oms.partner.collaborate',
    name: '提交伙伴订单协同',
    resourceRef: '/api/v1/oms/orders/*/collaborations',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.asn.write',
    name: '提交供应商 ASN',
    resourceRef: '/api/v1/oms/orders/*/asns',
    resourceType: 'BUTTON',
  },
  {
    code: 'oms.timeline.consume',
    name: '消费订单时间线事件',
    resourceRef: '/api/v1/oms/timeline-events/consume',
    resourceType: 'API',
  },
  {
    code: 'oms.order.page',
    name: '访问订单接入工作台',
    resourceRef: 'orders',
    resourceType: 'PAGE',
  },
  {
    code: 'mdm.contract.read',
    name: '查看合同与费率版本',
    resourceRef: '/api/v1/mdm/contracts/*',
    resourceType: 'API',
  },
  {
    code: 'mdm.contract.write',
    name: '维护合同与费率草稿',
    resourceRef: '/api/v1/mdm/rate-*',
    resourceType: 'API',
  },
  {
    code: 'mdm.contract.approve',
    name: '审批合同并发布费率',
    resourceRef: '/api/v1/mdm/rate-versions/*',
    resourceType: 'BUTTON',
  },
  {
    code: 'mdm.calendar.read',
    name: '查看营业日历与工作时段',
    resourceRef: '/api/v1/mdm/calendars/*',
    resourceType: 'API',
  },
  {
    code: 'mdm.calendar.write',
    name: '维护日历班次与截单时间',
    resourceRef: '/api/v1/mdm/calendars/*',
    resourceType: 'API',
  },
  {
    code: 'mdm.quality.read',
    name: '查看主数据质量评估与问题',
    resourceRef: '/api/v1/mdm/quality-assessments',
    resourceType: 'API',
  },
  {
    code: 'mdm.quality.write',
    name: '执行主数据质量评估与问题处置',
    resourceRef: '/api/v1/mdm/quality-*',
    resourceType: 'API',
  },
  {
    code: 'mdm.quality.approve',
    name: '审批主数据质量结果',
    resourceRef: '/api/v1/mdm/quality-assessments/*/decision',
    resourceType: 'BUTTON',
  },
  {
    code: 'mdm.governance.page',
    name: '访问主数据治理工作台',
    resourceRef: 'mdm-governance',
    resourceType: 'PAGE',
  },
  {
    code: 'mdm.warehouse.read',
    name: '查看仓库层级与停用投影',
    resourceRef: '/api/v1/mdm/warehouses/*',
    resourceType: 'API',
  },
  {
    code: 'mdm.warehouse.write',
    name: '维护仓库、库位、门岗与月台',
    resourceRef: '/api/v1/mdm/warehouse*',
    resourceType: 'API',
  },
  {
    code: 'mdm.warehouse.project',
    name: '回写仓库跨域使用投影',
    resourceRef: '/api/v1/mdm/warehouses/*/usage-projection',
    resourceType: 'API',
  },
  {
    code: 'mdm.fleet.read',
    name: '查看车型、车辆、司机与指派校验',
    resourceRef: '/api/v1/mdm/fleet/*',
    resourceType: 'API',
  },
  {
    code: 'mdm.fleet.write',
    name: '维护车型、车辆、司机与证照',
    resourceRef: '/api/v1/mdm/vehicles/*',
    resourceType: 'API',
  },
  {
    code: 'mdm.warehouse.page',
    name: '访问仓库与车队工作台',
    resourceRef: 'warehouses',
    resourceType: 'PAGE',
  },
  {
    code: 'mdm.partner.read',
    name: '查看伙伴、地址与服务区域',
    resourceRef: '/api/v1/mdm/partners/*',
    resourceType: 'API',
  },
  {
    code: 'mdm.partner.write',
    name: '维护伙伴、地址与服务区域',
    resourceRef: '/api/v1/mdm/*',
    resourceType: 'API',
  },
  {
    code: 'mdm.partner.geocode',
    name: '回写与人工校正地址地理编码',
    resourceRef: '/api/v1/mdm/partner-addresses/*',
    resourceType: 'BUTTON',
  },
  {
    code: 'mdm.partner.page',
    name: '访问伙伴与地址工作台',
    resourceRef: 'partners',
    resourceType: 'PAGE',
  },
  {
    code: 'mdm.product.read',
    name: '查看商品、条码与包装版本',
    resourceRef: '/api/v1/mdm/*',
    resourceType: 'API',
  },
  {
    code: 'mdm.product.write',
    name: '维护商品、条码与包装版本',
    resourceRef: '/api/v1/mdm/*',
    resourceType: 'API',
  },
  {
    code: 'mdm.product.publish',
    name: '发布商品主数据版本',
    resourceRef: '/api/v1/mdm/products/*/publish',
    resourceType: 'BUTTON',
  },
  {
    code: 'mdm.product.page',
    name: '访问商品主数据工作台',
    resourceRef: 'products',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.organization.read',
    name: '查看组织树',
    resourceRef: '/api/v1/platform/organizations',
    resourceType: 'API',
  },
  {
    code: 'platform.organization.write',
    name: '维护组织树',
    resourceRef: '/api/v1/platform/organizations/*',
    resourceType: 'API',
  },
  {
    code: 'platform.role.read',
    name: '查看角色权限',
    resourceRef: '/api/v1/platform/roles',
    resourceType: 'API',
  },
  {
    code: 'platform.role.write',
    name: '维护角色权限',
    resourceRef: '/api/v1/platform/roles/*',
    resourceType: 'API',
  },
  {
    code: 'platform.policy.read',
    name: '查看数据范围策略',
    resourceRef: '/api/v1/platform/data-policies',
    resourceType: 'API',
  },
  {
    code: 'platform.policy.write',
    name: '维护数据范围策略',
    resourceRef: '/api/v1/platform/data-policies/*',
    resourceType: 'API',
  },
  {
    code: 'platform.configuration.read',
    name: '查看配置字典与单号规则',
    resourceRef: '/api/v1/platform/configuration/*',
    resourceType: 'API',
  },
  {
    code: 'platform.configuration.write',
    name: '维护配置字典与单号规则',
    resourceRef: '/api/v1/platform/configuration/*',
    resourceType: 'API',
  },
  {
    code: 'platform.audit.read',
    name: '只读查询审计与变更历史',
    resourceRef: '/api/v1/platform/audit/*',
    resourceType: 'API',
  },
  {
    code: 'platform.attachment.read',
    name: '查看附件与业务关联',
    resourceRef: '/api/v1/platform/attachments',
    resourceType: 'API',
  },
  {
    code: 'platform.attachment.write',
    name: '上传附件与维护业务关联',
    resourceRef: '/api/v1/platform/attachments/*',
    resourceType: 'API',
  },
  {
    code: 'platform.attachment.scan',
    name: '回写附件病毒扫描结果',
    resourceRef: '/api/v1/platform/attachments/*/scan-results',
    resourceType: 'API',
  },
  {
    code: 'platform.attachment.download',
    name: '下载授权范围内附件',
    resourceRef: '/api/v1/platform/attachments/*/downloads',
    resourceType: 'API',
  },
  {
    code: 'platform.inbox.read',
    name: '查看与处理个人待办消息',
    resourceRef: '/api/v1/platform/notifications/inbox/*',
    resourceType: 'API',
  },
  {
    code: 'platform.inbox.write',
    name: '创建业务待办消息',
    resourceRef: '/api/v1/platform/notifications/inbox',
    resourceType: 'API',
  },
  {
    code: 'platform.notification.manage',
    name: '管理通知模板与投递记录',
    resourceRef: '/api/v1/platform/notifications/*',
    resourceType: 'API',
  },
  {
    code: 'platform.notification.send',
    name: '创建投递重试与升级通知',
    resourceRef: '/api/v1/platform/notifications/*',
    resourceType: 'API',
  },
  {
    code: 'platform.import.read',
    name: '查看导入任务与逐行回执',
    resourceRef: '/api/v1/platform/imports',
    resourceType: 'API',
  },
  {
    code: 'platform.import.write',
    name: '创建并推进导入任务',
    resourceRef: '/api/v1/platform/imports/*',
    resourceType: 'API',
  },
  {
    code: 'platform.import.process',
    name: '执行导入校验与结果回写',
    resourceRef: '/api/v1/platform/imports/*',
    resourceType: 'API',
  },
  {
    code: 'platform.export.read',
    name: '查看个人导出任务',
    resourceRef: '/api/v1/platform/exports',
    resourceType: 'API',
  },
  {
    code: 'platform.export.create',
    name: '按当前视图创建脱敏导出',
    resourceRef: '/api/v1/platform/exports',
    resourceType: 'EXPORT',
  },
  {
    code: 'platform.export.process',
    name: '执行异步导出任务',
    resourceRef: '/api/v1/platform/exports/*',
    resourceType: 'API',
  },
  {
    code: 'platform.export.download',
    name: '下载授权范围内导出结果',
    resourceRef: '/api/v1/platform/exports/downloads/*',
    resourceType: 'EXPORT',
  },
  {
    code: 'platform.search.read',
    name: '统一搜索业务对象',
    resourceRef: '/api/v1/platform/search',
    resourceType: 'API',
  },
  {
    code: 'platform.search.index',
    name: '写入统一搜索投影',
    resourceRef: '/api/v1/platform/search/documents',
    resourceType: 'API',
  },
  {
    code: 'platform.saved-view.read',
    name: '查看个人与共享视图',
    resourceRef: '/api/v1/platform/saved-views',
    resourceType: 'API',
  },
  {
    code: 'platform.saved-view.write',
    name: '维护个人与共享视图',
    resourceRef: '/api/v1/platform/saved-views/*',
    resourceType: 'API',
  },
  {
    code: 'platform.workflow-definition.read',
    name: '查看流程定义与版本',
    resourceRef: '/api/v1/platform/workflow-definitions',
    resourceType: 'API',
  },
  {
    code: 'platform.workflow-definition.write',
    name: '维护并发布流程定义版本',
    resourceRef: '/api/v1/platform/workflow-definitions/*',
    resourceType: 'API',
  },
  {
    code: 'platform.workflow.start',
    name: '发起与撤回工作流实例',
    resourceRef: '/api/v1/platform/workflow-instances/*',
    resourceType: 'API',
  },
  {
    code: 'platform.approval.read',
    name: '查看审批任务与历史',
    resourceRef: '/api/v1/platform/approval-tasks',
    resourceType: 'API',
  },
  {
    code: 'platform.approval.act',
    name: '执行审批与批量动作',
    resourceRef: '/api/v1/platform/approval-tasks/*',
    resourceType: 'BUTTON',
  },
  {
    code: 'platform.rule.read',
    name: '查看规则版本与求值追踪',
    resourceRef: '/api/v1/platform/rules/*',
    resourceType: 'API',
  },
  {
    code: 'platform.rule.write',
    name: '维护并发布规则集',
    resourceRef: '/api/v1/platform/rules/sets/*',
    resourceType: 'API',
  },
  {
    code: 'platform.rule.simulate',
    name: '模拟规则求值',
    resourceRef: '/api/v1/platform/rules/simulate',
    resourceType: 'BUTTON',
  },
  {
    code: 'platform.rule.evaluate',
    name: '执行正式规则求值',
    resourceRef: '/api/v1/platform/rules/evaluate',
    resourceType: 'API',
  },
  {
    code: 'platform.job.read',
    name: '查看调度定义、运行与日志',
    resourceRef: '/api/v1/platform/jobs/*',
    resourceType: 'API',
  },
  {
    code: 'platform.job.write',
    name: '维护调度任务定义',
    resourceRef: '/api/v1/platform/jobs/definitions',
    resourceType: 'API',
  },
  {
    code: 'platform.job.trigger',
    name: '触发调度任务',
    resourceRef: '/api/v1/platform/jobs/definitions/*/runs',
    resourceType: 'BUTTON',
  },
  {
    code: 'platform.job.cancel',
    name: '取消调度任务运行',
    resourceRef: '/api/v1/platform/jobs/runs/*/cancel',
    resourceType: 'BUTTON',
  },
  {
    code: 'platform.job.process',
    name: '领取并回报调度任务',
    resourceRef: '/api/v1/platform/jobs/runs/*',
    resourceType: 'API',
  },
  {
    code: 'platform.event.read',
    name: '查看业务事件与投递回执',
    resourceRef: '/api/v1/platform/events/*',
    resourceType: 'API',
  },
  {
    code: 'platform.event.process',
    name: '领取、投递并消费业务事件',
    resourceRef: '/api/v1/platform/events/relay/*',
    resourceType: 'API',
  },
  {
    code: 'platform.event.replay',
    name: '恢复并重放死信事件',
    resourceRef: '/api/v1/platform/events/outbox/*/replay',
    resourceType: 'BUTTON',
  },
  {
    code: 'platform.locale.read',
    name: '查看区域与时区设置',
    resourceRef: '/api/v1/platform/finalization/locale*',
    resourceType: 'API',
  },
  {
    code: 'platform.locale.write',
    name: '维护区域与时区设置',
    resourceRef: '/api/v1/platform/finalization/locale',
    resourceType: 'API',
  },
  {
    code: 'platform.unit.read',
    name: '查看并使用单位换算',
    resourceRef: '/api/v1/platform/finalization/unit-conversions*',
    resourceType: 'API',
  },
  {
    code: 'platform.unit.write',
    name: '维护单位换算版本',
    resourceRef: '/api/v1/platform/finalization/unit-conversions',
    resourceType: 'API',
  },
  {
    code: 'platform.feature.read',
    name: '查看特性开关版本',
    resourceRef: '/api/v1/platform/finalization/feature-flags',
    resourceType: 'API',
  },
  {
    code: 'platform.feature.write',
    name: '维护发布特性开关',
    resourceRef: '/api/v1/platform/finalization/feature-flags/*',
    resourceType: 'API',
  },
  {
    code: 'platform.feature.evaluate',
    name: '求值特性开关',
    resourceRef: '/api/v1/platform/finalization/feature-flags/evaluate',
    resourceType: 'API',
  },
  {
    code: 'platform.comment.read',
    name: '查看内部协同评论',
    resourceRef: '/api/v1/platform/finalization/comments',
    resourceType: 'API',
  },
  {
    code: 'platform.comment.external',
    name: '查看伙伴可见评论',
    resourceRef: '/api/v1/platform/finalization/comments/external',
    resourceType: 'API',
  },
  {
    code: 'platform.comment.write',
    name: '发表评论与解决评论',
    resourceRef: '/api/v1/platform/finalization/comments/*',
    resourceType: 'BUTTON',
  },
  {
    code: 'platform.print.read',
    name: '查看模板打印机与任务',
    resourceRef: '/api/v1/platform/finalization/print-*',
    resourceType: 'API',
  },
  {
    code: 'platform.print.write',
    name: '维护打印模板和打印机',
    resourceRef: '/api/v1/platform/finalization/print-templates/*',
    resourceType: 'API',
  },
  {
    code: 'platform.print.create',
    name: '创建与取消打印任务',
    resourceRef: '/api/v1/platform/finalization/print-jobs/*',
    resourceType: 'BUTTON',
  },
  {
    code: 'platform.print.process',
    name: '领取并完成打印任务',
    resourceRef: '/api/v1/platform/finalization/print-jobs/*',
    resourceType: 'API',
  },
  {
    code: 'platform.admin.menu',
    name: '平台管理菜单',
    resourceRef: 'platform-admin',
    resourceType: 'MENU',
  },
  {
    code: 'platform.rbac.page',
    name: '组织与权限页面',
    resourceRef: 'platform-rbac',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.configuration.page',
    name: '配置中心页面',
    resourceRef: 'platform-configuration',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.audit.page',
    name: '审计查询页面',
    resourceRef: 'platform-audit',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.attachment.page',
    name: '附件中心页面',
    resourceRef: 'platform-attachments',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.inbox.page',
    name: '待办与消息中心页面',
    resourceRef: 'platform-inbox',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.data-exchange.page',
    name: '导入导出与统一搜索页面',
    resourceRef: 'platform-data-exchange',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.workflow.page',
    name: '流程定义与审批中心页面',
    resourceRef: 'platform-workflow',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.rule.page',
    name: '规则引擎与决策追踪页面',
    resourceRef: 'platform-rules',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.job.page',
    name: '调度任务中心页面',
    resourceRef: 'platform-jobs',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.event.page',
    name: '业务事件运维页面',
    resourceRef: 'platform-events',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.finalization.page',
    name: '国际化协同与打印页面',
    resourceRef: 'platform-finalization',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.organization.move',
    name: '移动组织按钮',
    resourceRef: 'organization.move',
    resourceType: 'BUTTON',
  },
  {
    code: 'platform.configuration.publish',
    name: '发布与回滚配置按钮',
    resourceRef: 'configuration.publish',
    resourceType: 'BUTTON',
  },
  {
    code: 'platform.account.secret-field',
    name: '账号敏感字段',
    resourceRef: 'account.identitySource',
    resourceType: 'FIELD',
  },
  {
    code: 'platform.rbac.export',
    name: '导出权限配置',
    resourceRef: 'platform-rbac.csv',
    resourceType: 'EXPORT',
  },
  {
    code: 'platform.audit.export',
    name: '导出审计查询结果',
    resourceRef: 'platform-audit.csv',
    resourceType: 'EXPORT',
  },
] as const satisfies ReadonlyArray<{
  code: string;
  name: string;
  resourceRef: string;
  resourceType: PermissionResourceType;
}>;

export const READ_ONLY_AUDITOR_PERMISSION_CODES = [
  'platform.audit.read',
  'platform.audit.page',
  'platform.audit.export',
] as const;

export interface PermissionGrant {
  readonly effect: PermissionEffect;
  readonly organizationPath: string | undefined;
  readonly permissionCode: string;
}

export interface PermissionResolution {
  readonly allowed: boolean;
  readonly reason: 'EXPLICIT_DENY' | 'NO_MATCHING_GRANT' | 'ROLE_ALLOW';
}

export interface RoleTemplateLink {
  readonly id: string;
  readonly templateRoleId: string | null;
}

export function collectRoleLineage(
  roleId: string,
  roles: readonly RoleTemplateLink[],
): readonly string[] {
  const roleById = new Map(roles.map((role) => [role.id, role] as const));
  const lineage: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = roleId;
  while (currentId && !visited.has(currentId) && lineage.length < 16) {
    visited.add(currentId);
    lineage.push(currentId);
    currentId = roleById.get(currentId)?.templateRoleId ?? null;
  }
  return lineage;
}

export function resolvePermission(
  grants: readonly PermissionGrant[],
  permissionCode: string,
  targetOrganizationPath?: string,
): PermissionResolution {
  const matching = grants.filter(
    (grant) =>
      grant.permissionCode === permissionCode &&
      (targetOrganizationPath
        ? !grant.organizationPath ||
          targetOrganizationPath === grant.organizationPath ||
          targetOrganizationPath.startsWith(`${grant.organizationPath}/`)
        : !grant.organizationPath),
  );
  if (matching.some((grant) => grant.effect === 'DENY')) {
    return { allowed: false, reason: 'EXPLICIT_DENY' };
  }
  if (matching.some((grant) => grant.effect === 'ALLOW')) {
    return { allowed: true, reason: 'ROLE_ALLOW' };
  }
  return { allowed: false, reason: 'NO_MATCHING_GRANT' };
}

export function buildOrganizationPath(
  parentPath: string | undefined,
  organizationId: string,
): string {
  return parentPath ? `${parentPath}/${organizationId}` : `/${organizationId}`;
}

# V2 事件目录与订阅清单

> 本文件由 `pnpm event:catalog` 从 API 源码中的 `eventName`、`emit`、`record` 与 Outbox 写入点扫描生成。请勿手工维护事件行。

## 订阅定义

| Consumer | 事件模式 | 内部端点 | 消费语义 | 必需 | 最大尝试 | 基础退避秒 |
| --- | --- | --- | --- | --- | ---: | ---: |
| `oms.order-timeline.v1` | `order.*, fulfillment.*, inbound.*, outbound.*, shipment.*, tracking.*, appointment.*, settlement.*` | `/api/v1/oms/timeline-events/consume` | EVERY_EVENT | 是 | 10 | 2 |
| `control.projection.v1` | `*` | `/api/v1/control/events/consume` | LATEST_STATE | 否 | 10 | 2 |
| `control.alert-engine.v1` | `*` | `/api/v1/control/alert-events/consume` | EVERY_EVENT | 否 | 8 | 5 |
| `control.data-lake.v1` | `*` | `/api/v1/control/bi/lake/events/consume` | EVERY_EVENT | 否 | 8 | 5 |
| `control.reconciliation.v1` | `order.*, fulfillment.*, inventory.*, outbound.*, shipment.*, billing.*` | `/api/v1/control/reconciliations/events/consume` | EVERY_EVENT | 否 | 8 | 5 |
| `billing.charge-fact.v1` | `*.charge-fact.v1, *.charge-facts-captured.v1, appointment.completed.v1, appointment.penalty-decided.v1, inbound.completed.v1, outbound.shipped.v1, shipment.delivered.v1` | `/api/v1/billing/events/consume` | EVERY_EVENT | 是 | 12 | 3 |
| `integration.portal-projection.v1` | `order.*, inventory.*, appointment.*, shipment.*, tracking.*, billing.*` | `/api/v1/integration/portal/projections/events` | LATEST_STATE | 否 | 8 | 3 |
| `wms.fulfillment-command.v2` | `fulfillment.released.v2` | `/api/v1/wms/events/fulfillment-released` | EVERY_EVENT | 是 | 12 | 2 |
| `tms.shipment-request.v2` | `shipment.requested.v2` | `/api/v1/tms/events/shipment-requested` | EVERY_EVENT | 是 | 12 | 2 |
| `oms.order-fulfillment-process.v2` | `outbound.*, shipment.*, tracking.*, tms.transport-order-received.v1` | `/api/v1/oms/fulfillment-process/events` | EVERY_EVENT | 是 | 12 | 2 |

## 代码扫描目录

已发现 393 个静态事件名。动态事件名仍必须符合 `{domain}.{event}.v{n}` 并在代码评审中核对。

| 事件 | 匹配消费者 | 发现位置 |
| --- | --- | --- |
| `alert.merged.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/alert-governance.service.ts` |
| `alert.opened.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/alert-governance.service.ts`<br>`apps/api/src/modules/tms/in-transit-operations.service.ts` |
| `ams.appointment-requested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/oms/collaboration-timeline.service.ts` |
| `ams.capacity-profile-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/capacity-workload.service.ts` |
| `ams.capacity-profile-published.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/capacity-workload.service.ts` |
| `ams.time-slot-changed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/capacity-workload.service.ts` |
| `ams.time-slots-generated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/capacity-workload.service.ts` |
| `ams.workload-adjusted.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/capacity-workload.service.ts` |
| `ams.workload-estimated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/capacity-workload.service.ts` |
| `ams.workload-rule-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/capacity-workload.service.ts` |
| `ams.workload-rule-published.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/capacity-workload.service.ts` |
| `appointment.cancelled.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, integration.portal-projection.v1 | `apps/api/src/modules/ams/appointment-intake.service.ts` |
| `appointment.checked-out.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, integration.portal-projection.v1 | `apps/api/src/modules/ams/operation-closure.service.ts` |
| `appointment.completed.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, billing.charge-fact.v1, integration.portal-projection.v1 | `apps/api/src/modules/ams/operation-closure.service.ts` |
| `appointment.confirmed.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, integration.portal-projection.v1 | `apps/api/src/modules/ams/appointment-intake.service.ts` |
| `appointment.draft-saved.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, integration.portal-projection.v1 | `apps/api/src/modules/ams/appointment-intake.service.ts` |
| `appointment.no-show-appealed.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, integration.portal-projection.v1 | `apps/api/src/modules/ams/operation-closure.service.ts` |
| `appointment.operation-event.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, integration.portal-projection.v1 | `apps/api/src/modules/ams/operation-closure.service.ts` |
| `appointment.penalty-decided.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, billing.charge-fact.v1, integration.portal-projection.v1 | `apps/api/src/modules/ams/operation-closure.service.ts` |
| `appointment.recurring-created.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, integration.portal-projection.v1 | `apps/api/src/modules/ams/appointment-intake.service.ts` |
| `appointment.reminders-scheduled.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, integration.portal-projection.v1 | `apps/api/src/modules/ams/appointment-intake.service.ts` |
| `appointment.requested.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, integration.portal-projection.v1 | `apps/api/src/modules/tms/in-transit-operations.service.ts` |
| `appointment.reschedule-suggested.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, integration.portal-projection.v1 | `apps/api/src/modules/ams/appointment-intake.service.ts` |
| `appointment.rescheduled.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, integration.portal-projection.v1 | `apps/api/src/modules/ams/appointment-intake.service.ts` |
| `billing.accrual.draft-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/settlement-voucher.service.ts` |
| `billing.accrual.posted.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/settlement-voucher.service.ts` |
| `billing.adjustment.approval-requested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/reconciliation.service.ts` |
| `billing.adjustment.approved.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/reconciliation.service.ts` |
| `billing.adjustment.draft-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/reconciliation.service.ts` |
| `billing.adjustment.posted.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/reconciliation.service.ts` |
| `billing.charge-fact-corrected.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/charge-fact-rate.service.ts` |
| `billing.charge-fact-received.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/charge-fact-rate.service.ts` |
| `billing.charge.calculated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/charge-calculation.service.ts` |
| `billing.invoice.credit-note-issued.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/financial-close.service.ts` |
| `billing.invoice.issued.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/financial-close.service.ts` |
| `billing.payment.allocated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/financial-close.service.ts` |
| `billing.payment.registered.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/financial-close.service.ts` |
| `billing.period.closed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/financial-close.service.ts` |
| `billing.period.closing-started.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/financial-close.service.ts` |
| `billing.period.opened.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/financial-close.service.ts` |
| `billing.period.reopened.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/financial-close.service.ts` |
| `billing.reconciliation.dispute-raised.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/reconciliation.service.ts` |
| `billing.reconciliation.draft-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/reconciliation.service.ts` |
| `billing.reconciliation.reconciled.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/reconciliation.service.ts` |
| `billing.settlement-report.generated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/financial-close.service.ts` |
| `billing.voucher.approval-rejected.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/settlement-voucher.service.ts` |
| `billing.voucher.approval-requested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/settlement-voucher.service.ts` |
| `billing.voucher.approved.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/settlement-voucher.service.ts` |
| `billing.voucher.calculated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/settlement-voucher.service.ts` |
| `billing.voucher.draft-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/settlement-voucher.service.ts` |
| `billing.voucher.reconciled.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/reconciliation.service.ts` |
| `billing.voucher.validation-failed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/billing/settlement-voucher.service.ts` |
| `charge.accrued.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/freight-billing.service.ts` |
| `charge.calculated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/freight-billing.service.ts` |
| `charge.exception-opened.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/freight-billing.service.ts` |
| `control.ai-optimization-requested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/public/job-scheduling.facade.ts` |
| `control.alert-assigned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/alert-governance.service.ts` |
| `control.alert-rule-published.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/alert-governance.service.ts` |
| `control.dashboard-published.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/bi-analytics.service.ts` |
| `control.demand-forecast-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.demand-forecast-deviation-recorded.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.demand-forecast-published.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.demand-forecast-retired.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.event-delivery-dead-lettered.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/event.service.ts` |
| `control.inventory-policy-recommendation-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.knowledge-published.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/alert-governance.service.ts` |
| `control.lake-recomputed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/bi-analytics.service.ts` |
| `control.load-deviation-recorded.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.load-optimization-failed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.load-optimization-job-linked.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.load-optimization-proposed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.load-optimization-queued.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.load-optimization-started.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.metric-observed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/bi-analytics.service.ts` |
| `control.metric-published.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/bi-analytics.service.ts` |
| `control.network-scenario-archived.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.network-scenario-completed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.network-scenario-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.network-scenario-failed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.network-scenario-job-linked.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.network-scenario-queued.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.network-scenario-started.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.reconciliation-case-resolved.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/reconciliation.service.ts` |
| `control.reconciliation-completed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/reconciliation.service.ts` |
| `control.remediation-requested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/alert-governance.service.ts` |
| `control.report-published.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/bi-analytics.service.ts` |
| `control.route-optimization-completed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.route-optimization-failed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.route-optimization-job-linked.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.route-optimization-queued.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.route-optimization-started.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/ai-optimization.service.ts` |
| `control.sla-reopened.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/alert-governance.service.ts` |
| `control.sla-started.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/alert-governance.service.ts` |
| `control.sla-transitioned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/control/alert-governance.service.ts` |
| `cross-dock.proposed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/quality-putaway.service.ts` |
| `cross-dock.transitioned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/quality-putaway.service.ts` |
| `dock.assigned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/onsite-operations.service.ts` |
| `dock.runtime-changed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/onsite-operations.service.ts` |
| `dock.switched.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/onsite-operations.service.ts` |
| `fleet.maintenance-planned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/fleet-insights.service.ts` |
| `fleet.operating-fact-recorded.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/fleet-insights.service.ts` |
| `fulfillment.progressed.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1 | `apps/api/src/modules/oms/fulfillment-release.service.ts` |
| `fulfillment.released.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1 | `apps/api/src/modules/oms/fulfillment-release.service.ts` |
| `gate.access-recorded.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/onsite-operations.service.ts` |
| `gate.pass-issued.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/onsite-operations.service.ts` |
| `gate.verification-completed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/onsite-operations.service.ts` |
| `inbound.appointment-projected.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/inbound.service.ts` |
| `inbound.arrived.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/inbound.service.ts` |
| `inbound.completed.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, billing.charge-fact.v1 | `apps/api/src/modules/wms/inbound.service.ts` |
| `inbound.created.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/inbound.service.ts` |
| `inbound.expected.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/inbound.service.ts` |
| `inbound.packages-parsed.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/inbound.service.ts` |
| `inbound.receipt-confirmed.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/receiving-detail.service.ts` |
| `inbound.receiving-started.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/inbound.service.ts` |
| `integration.adapter-command-dispatched.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/adapter-iot.service.ts` |
| `integration.adapter-command-normalized.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/adapter-iot.service.ts` |
| `integration.adapter-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/adapter-iot.service.ts` |
| `integration.adapter-version-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/adapter-iot.service.ts` |
| `integration.adapter-version-published.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/adapter-iot.service.ts` |
| `integration.adapter-version-tested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/adapter-iot.service.ts` |
| `integration.api-credential-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/gateway.service.ts` |
| `integration.api-credential-revoked.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/gateway.service.ts` |
| `integration.api-credential-rotated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/gateway.service.ts` |
| `integration.api-definition-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/api-contract.service.ts` |
| `integration.api-definition-deprecated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/api-contract.service.ts` |
| `integration.api-definition-published.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/api-contract.service.ts` |
| `integration.api-definition-version-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/api-contract.service.ts` |
| `integration.device-certificate-rotated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/adapter-iot.service.ts` |
| `integration.device-command-queued.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/adapter-iot.service.ts` |
| `integration.device-heartbeat.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/adapter-iot.service.ts` |
| `integration.device-registered.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/adapter-iot.service.ts` |
| `integration.device-telemetry-received.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/adapter-iot.service.ts` |
| `integration.device.heartbeat.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/adapter-iot.service.ts` |
| `integration.file-acknowledged.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/message-exchange.service.ts` |
| `integration.file-archived.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/message-exchange.service.ts` |
| `integration.file-received.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/message-exchange.service.ts` |
| `integration.gateway-policy-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/gateway.service.ts` |
| `integration.mapping-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/message-exchange.service.ts` |
| `integration.mapping-published.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/message-exchange.service.ts` |
| `integration.mapping-tested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/message-exchange.service.ts` |
| `integration.mapping-version-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/message-exchange.service.ts` |
| `integration.message-replayed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/message-exchange.service.ts` |
| `integration.message-transformed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/message-exchange.service.ts` |
| `integration.portal-access-granted.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/mobile-portal.service.ts` |
| `integration.portal-command-requested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/mobile-portal.service.ts` |
| `integration.webhook-dead-lettered.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/message-exchange.service.ts` |
| `integration.webhook-disabled.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/message-exchange.service.ts` |
| `integration.webhook-event-queued.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/message-exchange.service.ts` |
| `integration.webhook-subscribed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/integration/message-exchange.service.ts` |
| `inventory.adjustment-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory-governance.service.ts` |
| `inventory.adjustment-posted.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory-governance.service.ts` |
| `inventory.aging-evaluated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory-governance.service.ts` |
| `inventory.changed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory.service.ts` |
| `inventory.count-planned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory.service.ts` |
| `inventory.count-segment-released.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory.service.ts` |
| `inventory.count-transitioned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory.service.ts` |
| `inventory.count-variance-approved.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory.service.ts` |
| `inventory.counted.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory.service.ts` |
| `inventory.held.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory.service.ts` |
| `inventory.hold-released.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory.service.ts` |
| `inventory.ownership-transferred.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory.service.ts` |
| `inventory.reconciled.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory-governance.service.ts` |
| `inventory.reconciliation-case-resolved.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory-governance.service.ts` |
| `inventory.reconciliation-closed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory-governance.service.ts` |
| `inventory.replenishment-completed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory-governance.service.ts` |
| `inventory.replenishment-planned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory-governance.service.ts` |
| `inventory.replenishment-policy-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory-governance.service.ts` |
| `inventory.reservation-release-requested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/atp-allocation.service.ts` |
| `inventory.reservation-released.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory.service.ts` |
| `inventory.reservation-requested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/atp-allocation.service.ts` |
| `inventory.reserved.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory.service.ts` |
| `inventory.status-changed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory.service.ts` |
| `inventory.transferred.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/wms/inventory.service.ts` |
| `mdm.calendar-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/contract-calendar-quality.service.ts` |
| `mdm.category-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/product.service.ts` |
| `mdm.category-inactivated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/product.service.ts` |
| `mdm.contract-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/contract-calendar-quality.service.ts` |
| `mdm.driver-certificate.transition.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/warehouse-fleet.service.ts` |
| `mdm.external-code-versioned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/partner.service.ts` |
| `mdm.package-spec-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/product.service.ts` |
| `mdm.package-spec-retired.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/product.service.ts` |
| `mdm.partner-address-geocode-failed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/partner.service.ts` |
| `mdm.partner-address-inactivated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/partner.service.ts` |
| `mdm.partner-certificate-expired.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/partner.service.ts` |
| `mdm.partner-certificate-inactivated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/partner.service.ts` |
| `mdm.partner-contact-inactivated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/partner.service.ts` |
| `mdm.partner-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/partner.service.ts` |
| `mdm.partner-role-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/partner.service.ts` |
| `mdm.partner-role-inactivated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/partner.service.ts` |
| `mdm.partner-updated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/partner.service.ts` |
| `mdm.product-barcode-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/product.service.ts` |
| `mdm.product-barcode-inactivated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/product.service.ts` |
| `mdm.product-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/product.service.ts` |
| `mdm.product-inactivated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/product.service.ts` |
| `mdm.product-published.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/product.service.ts` |
| `mdm.product-updated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/product.service.ts` |
| `mdm.quality-assessed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/contract-calendar-quality.service.ts` |
| `mdm.quality-issue.resolve.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/contract-calendar-quality.service.ts` |
| `mdm.rate-card-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/contract-calendar-quality.service.ts` |
| `mdm.rate-card.create.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/contract-calendar-quality.service.ts` |
| `mdm.rate-version-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/contract-calendar-quality.service.ts` |
| `mdm.warehouse-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/warehouse-fleet.service.ts` |
| `mdm.warehouse-usage-projected.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/mdm/warehouse-fleet.service.ts` |
| `notification.requested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/appointment-intake.service.ts`<br>`apps/api/src/modules/control/alert-governance.service.ts` |
| `oms.availability-projected.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/oms/atp-allocation.service.ts` |
| `oms.availability-promised.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/oms/atp-allocation.service.ts` |
| `order.allocated.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/atp-allocation.service.ts` |
| `order.allocation-failed.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/atp-allocation.service.ts` |
| `order.cancelled.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/change-reverse.service.ts` |
| `order.change-applied.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/change-reverse.service.ts` |
| `order.change-rejected.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/change-reverse.service.ts` |
| `order.change-requested.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/change-reverse.service.ts` |
| `order.changed.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/order-intake.service.ts` |
| `order.created.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/order-intake.service.ts` |
| `order.duplicate-detected.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/order-intake.service.ts` |
| `order.exception-assigned.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/order-operations.service.ts` |
| `order.exception-opened.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/order-operations.service.ts` |
| `order.exception-reported.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/order-operations.service.ts` |
| `order.execution-cancel-requested.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/change-reverse.service.ts` |
| `order.line-progressed.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/change-reverse.service.ts` |
| `order.merge-group-created.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/order-governance.service.ts` |
| `order.opened.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/order-intake.service.ts` |
| `order.partner-collaborated.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/collaboration-timeline.service.ts` |
| `order.release-batch-completed.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/fulfillment-release.service.ts` |
| `order.released.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/fulfillment-release.service.ts` |
| `order.sla-breached.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/order-operations.service.ts` |
| `order.sla-started.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/order-operations.service.ts` |
| `order.sla-transitioned.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/order-operations.service.ts` |
| `order.sla-warning.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/order-operations.service.ts` |
| `order.split-created.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/order-governance.service.ts` |
| `order.substitution-decided.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/change-reverse.service.ts` |
| `order.substitution-expired.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/change-reverse.service.ts` |
| `order.substitution-proposed.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1 | `apps/api/src/modules/oms/change-reverse.service.ts` |
| `outbound.cancelled.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/wms/pack-ship.service.ts` |
| `outbound.created.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/wms/outbound.service.ts` |
| `outbound.label-reprinted.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/wms/pack-ship.service.ts` |
| `outbound.label-voided.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/wms/pack-ship.service.ts` |
| `outbound.load-created.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/wms/pack-ship.service.ts` |
| `outbound.measurement-exception-resolved.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/wms/pack-ship.service.ts` |
| `outbound.measurement-exception.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/wms/pack-ship.service.ts` |
| `outbound.pack-created.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/wms/pack-ship.service.ts` |
| `outbound.package-loaded.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/wms/pack-ship.service.ts` |
| `outbound.package-sealed.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/wms/pack-ship.service.ts` |
| `outbound.ready.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/wms/pack-ship.service.ts` |
| `outbound.released.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/wms/outbound.service.ts` |
| `outbound.shipped.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, billing.charge-fact.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/wms/pack-ship.service.ts` |
| `outbound.shortage-resolved.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/wms/outbound.service.ts` |
| `outbound.wave-created.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/wms/outbound.service.ts` |
| `outbound.wave-template-created.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/wms/outbound.service.ts` |
| `picking.route-replanned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/pick.service.ts` |
| `picking.scan-accepted.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/pick.service.ts` |
| `picking.scan-rejected.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/pick.service.ts` |
| `picking.short-pick-recorded.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/pick.service.ts` |
| `picking.short-pick-resolved.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/pick.service.ts` |
| `picking.task-started.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/pick.service.ts` |
| `picking.verification-corrected.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/pick.service.ts` |
| `platform.api-credential-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/service-account.service.ts` |
| `platform.attachment-linked.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/attachment.service.ts` |
| `platform.attachment-scan-requested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/attachment.service.ts` |
| `platform.attachment-upload-requested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/attachment.service.ts` |
| `platform.audit-export-recorded.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/audit.service.ts` |
| `platform.comment-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/collaboration-print.service.ts` |
| `platform.config-draft-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/configuration.service.ts` |
| `platform.config-published.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/configuration.service.ts` |
| `platform.config-rolled-back.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/configuration.service.ts` |
| `platform.data-policy-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/data-policy.service.ts` |
| `platform.dictionary-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/configuration.service.ts` |
| `platform.dictionary-item-status-changed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/configuration.service.ts` |
| `platform.import-uploaded.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/import.service.ts` |
| `platform.inbox-item-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/notification.service.ts` |
| `platform.job-definition-saved.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/job.service.ts` |
| `platform.job-run-lease-recovered.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/job.service.ts` |
| `platform.job-run-queued.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/job.service.ts` |
| `platform.job-run-retry-scheduled.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/job.service.ts` |
| `platform.notification-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/notification.service.ts` |
| `platform.notification-dispatched.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/notification.service.ts` |
| `platform.notification-escalated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/notification.service.ts` |
| `platform.notification-preference-saved.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/notification.service.ts` |
| `platform.notification-template-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/notification.service.ts` |
| `platform.notification-template-published.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/notification.service.ts` |
| `platform.notification-template-retired.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/notification.service.ts` |
| `platform.number-rule-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/configuration.service.ts` |
| `platform.ops-archive-completed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/operations.service.ts` |
| `platform.ops-backup-planned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/operations.service.ts` |
| `platform.ops-capacity-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/operations.service.ts` |
| `platform.ops-dr-drill-queued.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/operations.service.ts` |
| `platform.ops-migration-planned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/operations.service.ts` |
| `platform.ops-monitor-alert-triggered.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/operations.service.ts` |
| `platform.ops-monitor-rule-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/operations.service.ts` |
| `platform.ops-operation-requested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/public/job-scheduling.facade.ts` |
| `platform.ops-privacy-requested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/operations.service.ts` |
| `platform.ops-release-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/operations.service.ts` |
| `platform.ops-retention-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/operations.service.ts` |
| `platform.ops-tenant-migration-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/operations.service.ts` |
| `platform.organization-path-rebuild-requested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/organization.service.ts` |
| `platform.print-job-queued.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/collaboration-print.service.ts` |
| `platform.role-permissions-changed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/role.service.ts` |
| `platform.rule-evaluated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/rule-engine.service.ts` |
| `platform.rule-set-published.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/rule-engine.service.ts` |
| `platform.rule-set-saved.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/rule-engine.service.ts` |
| `platform.saved-view-saved.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/search.service.ts` |
| `platform.saved-view-status-changed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/search.service.ts` |
| `platform.search-document-indexed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/search.service.ts` |
| `platform.sequence-reserved.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/configuration.service.ts` |
| `platform.tenant-provisioned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/tenant.service.ts` |
| `platform.tenant-status-changed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/tenant.service.ts` |
| `platform.workflow-definition-published.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/workflow.service.ts` |
| `platform.workflow-definition-saved.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/workflow.service.ts` |
| `platform.workflow-instance-started.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/platform/workflow.service.ts` |
| `putaway.confirmed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/quality-putaway.service.ts` |
| `putaway.decision-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/quality-putaway.service.ts` |
| `putaway.task-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/quality-putaway.service.ts` |
| `putaway.task-started.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/quality-putaway.service.ts` |
| `quality.disposition-recorded.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/quality-putaway.service.ts` |
| `quality.inspection-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/quality-putaway.service.ts` |
| `quality.inspection-transitioned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/quality-putaway.service.ts` |
| `queue.call-timeout.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/onsite-operations.service.ts` |
| `queue.driver-acknowledged.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/onsite-operations.service.ts` |
| `queue.driver-called.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/onsite-operations.service.ts` |
| `queue.ticket-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/ams/onsite-operations.service.ts` |
| `receipt.task-assigned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/inbound.service.ts` |
| `receipt.task-transitioned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/inbound.service.ts` |
| `receiving.variance-disposed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/receiving-detail.service.ts` |
| `receiving.variance-opened.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/receiving-detail.service.ts` |
| `rma.requested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/oms/change-reverse.service.ts` |
| `settlement.requested.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/oms/order-operations.service.ts` |
| `settlement.status-projected.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/oms/order-operations.service.ts` |
| `shipment.charge-facts-captured.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, billing.charge-fact.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/freight-billing.service.ts` |
| `shipment.claim-opened.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/delivery-reverse.service.ts` |
| `shipment.delivered.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, billing.charge-fact.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/delivery-reverse.service.ts` |
| `shipment.delivery-variance.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/delivery-reverse.service.ts` |
| `shipment.driver-task-accepted.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/tracking.service.ts` |
| `shipment.driver-task-assigned.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/tracking.service.ts` |
| `shipment.exception-escalated.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/in-transit-operations.service.ts` |
| `shipment.map-projected.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/in-transit-operations.service.ts` |
| `shipment.milestone-plan-created.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/tracking.service.ts` |
| `shipment.pod-supplemented.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/delivery-reverse.service.ts` |
| `shipment.pod-uploaded.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/delivery-reverse.service.ts` |
| `shipment.requested.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/oms/fulfillment-release.service.ts` |
| `shipment.return-requested.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/delivery-reverse.service.ts` |
| `shipment.settled.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/freight-billing.service.ts` |
| `shipment.tendered.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/capacity-tender.service.ts` |
| `shipment.vehicle-assigned.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/dispatch.service.ts` |
| `shipment.vehicle-assignment-revoked.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, control.reconciliation.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/dispatch.service.ts` |
| `telemetry.condition-alerted.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/fleet-insights.service.ts` |
| `tms.award-recommended.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/capacity-tender.service.ts` |
| `tms.award-rejected.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/capacity-tender.service.ts` |
| `tms.capacity-pool-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/capacity-tender.service.ts` |
| `tms.capacity-released.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/capacity-tender.service.ts` |
| `tms.capacity-reservation-expired.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/capacity-tender.service.ts` |
| `tms.capacity-reserved.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/capacity-tender.service.ts` |
| `tms.carrier-bid-submitted.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/capacity-tender.service.ts` |
| `tms.consolidation-plan-built.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/planning.service.ts` |
| `tms.consolidation-plan-published.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/planning.service.ts` |
| `tms.consolidation-plan-validated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/planning.service.ts` |
| `tms.load-plan-adjusted.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/load-route.service.ts` |
| `tms.load-plan-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/load-route.service.ts` |
| `tms.planning-batch-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/planning.service.ts` |
| `tms.planning-order-claimed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/planning.service.ts` |
| `tms.planning-order-released.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/planning.service.ts` |
| `tms.quote-requested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/capacity-tender.service.ts` |
| `tms.route-optimized.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/load-route.service.ts` |
| `tms.route-selected.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/load-route.service.ts` |
| `tms.shipment-retendered.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/capacity-tender.service.ts` |
| `tms.subcontract-proposed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/capacity-tender.service.ts` |
| `tms.tender-expired.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/capacity-tender.service.ts` |
| `tms.tender-revoked.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/capacity-tender.service.ts` |
| `tms.transport-order-received.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/transport-order.service.ts` |
| `tracking.access-issued.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/fleet-insights.service.ts` |
| `tracking.access-revoked.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/fleet-insights.service.ts` |
| `tracking.eta-changed.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/tracking.service.ts` |
| `tracking.event.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/dispatch.service.ts`<br>`apps/api/src/modules/tms/tracking.service.ts` |
| `tracking.position-received.v1` | oms.order-timeline.v1, control.projection.v1, control.alert-engine.v1, control.data-lake.v1, integration.portal-projection.v1, oms.order-fulfillment-process.v2 | `apps/api/src/modules/tms/tracking.service.ts` |
| `transport.metrics-generated.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/tms/fleet-insights.service.ts` |
| `wms.asn-submitted.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/oms/collaboration-timeline.service.ts` |
| `wms.barcode-manually-resolved.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/inbound.service.ts` |
| `wms.barcode-scanned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/inbound.service.ts` |
| `wms.device-command-sent.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/operations.service.ts` |
| `wms.device-timed-out.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/operations.service.ts` |
| `wms.handling-unit-built.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/receiving-detail.service.ts` |
| `wms.handling-unit-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/receiving-detail.service.ts` |
| `wms.handling-unit-merged.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/receiving-detail.service.ts` |
| `wms.handling-unit-split.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/receiving-detail.service.ts` |
| `wms.label-reprint-requested.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/receiving-detail.service.ts` |
| `wms.labor-assigned.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/operations.service.ts` |
| `wms.labor-completed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/operations.service.ts` |
| `wms.labor-standard-saved.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/operations.service.ts` |
| `wms.offline-conflict-resolved.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/operations.service.ts` |
| `wms.offline-conflict.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/operations.service.ts` |
| `wms.vas-completed.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/operations.service.ts` |
| `wms.vas-created.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/operations.service.ts` |
| `wms.vas-quality-held.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/operations.service.ts` |
| `wms.vas-started.v1` | control.projection.v1, control.alert-engine.v1, control.data-lake.v1 | `apps/api/src/modules/wms/operations.service.ts` |

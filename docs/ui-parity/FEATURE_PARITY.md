# 前端功能对照矩阵

状态含义：`IMPLEMENTED` 表示真实 UI、API 和测试均存在；`PARTIAL` 表示能力存在但入口、拆分、权限/状态或页面结构仍不完整；`MISSING` 表示设计范围内尚无真实实现；`IN_REVIEW` 表示仍在逐页取证。

| 参考页面/业务组 | 本系统路由 | 本地组件/API 证据 | 状态 | 差距与动作 |
| --- | --- | --- | --- | --- |
| 订单中心 | `/oms/orders` | `OrderIntakeWorkbench`；OMS intake/review/allocation/release API 与数据库测试 | IMPLEMENTED | 当前一个 Workbench 混合多个子能力；拆为页面内页签/抽屉并归入三级导航 |
| 订单履约过程 | `/oms/fulfillment-processes` | `FulfillmentProcessWorkbench`；自动 WMS/TMS 编排 E2E | IMPLEMENTED | 归入“订单管理 → 履约协同”组，不再作为一级侧栏项 |
| 入库订单与执行 | `/wms/inbounds` | `InboundWorkbench`；inbound/receiving/quality/putaway API 与测试 | IMPLEMENTED | 参考站拆分订单、收货、质检、上架和明细；本地先保留真实能力，以页面页签表达 |
| 库存查询/移动/调整/冻结/盘点 | `/wms/inventory` | `InventoryWorkbench`；inventory core/governance API 与并发测试 | IMPLEMENTED | 需从单一大 Workbench 拆成二级组下的三级视图或稳定页签 |
| 出库订单、波次、拣货、装箱、发运 | `/wms/outbounds` | `OutboundWorkbench`；outbound/picking/pack/ship API 与并发测试 | IMPLEMENTED | 参考站拆分为多个叶子；本地改为“出库管理”组和页面内工作流 |
| 仓储任务与移动作业 | `/wms/operations` | `MobileOperationsWorkbench`；RF、labor、device API | PARTIAL | 功能集中在一个 Workbench，缺少任务/WES/绩效的清晰可达子入口 |
| 独立 RF 端 | `/rf/*` | `RfTerminalShell`；窄屏路由 E2E | IMPLEMENTED | 保持独立 Shell，不放入管理端叶子导航 |
| 运输订单与执行 | `/tms/shipments` | `TransportOrderWorkbench`；TMS planning/dispatch/tracking/billing API 与测试 | IMPLEMENTED | 当前 69 kB 单页混合订单、计划、执行、结算；需按参考业务组重组页签/视图 |
| 预约与容量 | `/ams/capacity` | `AppointmentCapacityWorkbench`；容量并发/改期测试 | IMPLEMENTED | 映射到运输预约与独立预约大类，保留领域边界 |
| 结算事实与凭证 | `/billing/facts` | `BillingFactWorkbench`；rate/fact/voucher/close API 与测试 | IMPLEMENTED | 从一级叶子移入“结算管理”大类下的事实、对账、凭证组 |
| 商品/包装主数据 | `/mdm/products` | `ProductWorkbench`；MDM API/测试 | IMPLEMENTED | 归入“主数据 → 货品管理” |
| 伙伴/地址 | `/mdm/partners` | `PartnerWorkbench`；partner/address API/测试 | IMPLEMENTED | 归入“主数据 → 贸易伙伴/地域” |
| 仓库/车队 | `/mdm/warehouses` | `WarehouseFleetWorkbench`；warehouse/fleet API/测试 | IMPLEMENTED | 归入“主数据 → 仓储与运力” |
| 主数据治理 | `/mdm/governance` | `MdmGovernanceWorkbench` | PARTIAL | 参考站将组织、附件、费用和设置拆组；本地需增加清晰入口映射 |
| BI/控制塔/预警 | `/control/tower`、`/control/alerts`、`/control/bi` | Control Workbench 与 analytics/alert API | IMPLEMENTED | 合并为一级“控制塔与分析”，三级进入各页面 |
| 事件与消息 | `/platform/events`、`/platform/inbox` | Event/Notification Workbench，Outbox/Delivery/Inbox API | IMPLEMENTED | 归入“平台与系统 → 消息与事件” |
| 报表中心 | `/control/bi`、`/billing/facts` | BI 与财务报告 API | PARTIAL | 缺少统一报表目录/我的报表/打印入口；需按既有 API 能力审查后补齐 |
| 系统设置、规则、审批、调度、审计 | `/platform/configuration`、`/platform/rules`、`/platform/workflow`、`/platform/jobs`、`/platform/audit` | 各独立 Workbench 和真实 API | IMPLEMENTED | 移入“平台与系统”二级分组，取消一级散列按钮 |
| 系统支持 | `/platform/operations`、项目文档 | 生产运维 Workbench；仓库内验收/操作手册 | PARTIAL | 参考站是独立帮助中心；本地保留原创文档与运维入口，不复制其品牌、文章或联系方式 |
| 数据大屏 | `/control/tower`、`/control/bi` | Dashboard/BI 能力 | PARTIAL | 需逐页核对大屏视图和路由，不用静态假图表补齐 |

## 当前统计

- IMPLEMENTED：15 个核心映射项
- PARTIAL：5 个
- MISSING：0 个已确认核心项（叶子逐页取证尚未完成，不能据此宣称最终为 0）
- IN_REVIEW：0 个当前核心映射项；矩阵外的参考站叶子页面仍在逐页审查

当前核心映射完整实现率为 75%（15/20），能力覆盖率为 100%（IMPLEMENTED + PARTIAL）。下一步将以参考站叶子页面 manifest、本地 Controller/Workbench/测试扫描为证据，继续拆细矩阵。

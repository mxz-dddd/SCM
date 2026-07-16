# 前端功能对照矩阵

状态含义：`IMPLEMENTED` 表示真实 UI、API 和测试均存在；`PARTIAL` 表示核心能力存在但参考站的细分入口、专用视图或完整目录仍未一一对应；`MISSING` 表示当前 SCM 设计范围内尚无真实实现。参考站专有客户报表、外部工具和帮助文章不据此倒推为本地业务功能。

| 参考页面/业务组 | 本系统路由 | 本地组件/API 证据 | 状态 | 差距与动作 |
| --- | --- | --- | --- | --- |
| 订单中心 | `/oms/orders` | `OrderIntakeWorkbench`；OMS intake/review/allocation/release API 与数据库测试 | IMPLEMENTED | 当前一个 Workbench 混合多个子能力；拆为页面内页签/抽屉并归入三级导航 |
| 订单履约过程 | `/oms/fulfillment-processes` | `FulfillmentProcessWorkbench`；自动 WMS/TMS 编排 E2E | IMPLEMENTED | 归入“订单管理 → 履约协同”组，不再作为一级侧栏项 |
| 入库订单与执行 | `/wms/inbounds` | `InboundWorkbench`；inbound/receiving/quality/putaway API 与测试 | IMPLEMENTED | 参考站拆分订单、收货、质检、上架和明细；本地先保留真实能力，以页面页签表达 |
| 库存查询/移动/调整/冻结/盘点 | `/wms/inventory` | `InventoryWorkbench`；inventory core/governance API 与并发测试 | IMPLEMENTED | 需从单一大 Workbench 拆成二级组下的三级视图或稳定页签 |
| 出库订单、波次、拣货、装箱、发运 | `/wms/outbounds` | `OutboundWorkbench`；outbound/picking/pack/ship API 与并发测试 | IMPLEMENTED | 参考站拆分为多个叶子；本地改为“出库管理”组和页面内工作流 |
| 仓储任务与移动作业 | `/wms/operations` | `MobileOperationsWorkbench`；RF、labor、device API | PARTIAL | 功能集中在一个 Workbench，缺少任务/WES/绩效的清晰可达子入口 |
| 独立 RF 端 | `/rf/*` | `RfTerminalShell`；窄屏路由 E2E | IMPLEMENTED | 保持独立 Shell，不放入管理端叶子导航 |
| 运输订单、计划、执行、结算与分析 | `/tms/orders`、`/tms/planning`、`/tms/execution`、`/tms/settlement` | 4 个真实深链共用 `TransportOrderWorkbench` 的订单/计划/执行/结算页签；TMS planning/dispatch/tracking/billing API 与测试 | IMPLEMENTED | 已消除单页纵向堆叠；旧 `/tms/shipments` 保留真实重定向 |
| 预约与容量 | `/ams/capacity` | `AppointmentCapacityWorkbench`；容量并发/改期测试 | IMPLEMENTED | 映射到运输预约与独立预约大类，保留领域边界 |
| 结算事实与凭证 | `/billing/facts` | `BillingFactWorkbench`；rate/fact/voucher/close API 与测试 | IMPLEMENTED | 从一级叶子移入“结算管理”大类下的事实、对账、凭证组 |
| 商品/包装主数据 | `/mdm/products` | `ProductWorkbench`；MDM API/测试 | IMPLEMENTED | 归入“主数据 → 货品管理” |
| 伙伴/地址 | `/mdm/partners` | `PartnerWorkbench`；partner/address API/测试 | IMPLEMENTED | 归入“主数据 → 贸易伙伴/地域” |
| 仓库/车队 | `/mdm/warehouses` | `WarehouseFleetWorkbench`；warehouse/fleet API/测试 | IMPLEMENTED | 归入“主数据 → 仓储与运力” |
| 主数据治理 | `/mdm/governance` | `MdmGovernanceWorkbench` | PARTIAL | 参考站将组织、附件、费用和设置拆组；本地需增加清晰入口映射 |
| BI/控制塔/预警 | `/control/tower`、`/control/alerts`、`/control/bi` | Control Workbench 与 analytics/alert API | IMPLEMENTED | 合并为一级“控制塔与分析”，三级进入各页面 |
| 事件与消息 | `/platform/events`、`/platform/inbox` | Event/Notification Workbench，Outbox/Delivery/Inbox API | IMPLEMENTED | 归入“平台与系统 → 消息与事件” |
| 报表中心 | `/control/bi`、`/billing/facts` | BI 与财务报告 API | PARTIAL | BI、财务与运营分析真实可用；没有照搬参考租户的 75 个专有报表设置和自定义打印目录 |
| 系统设置、规则、审批、调度、审计 | `/platform/configuration`、`/platform/rules`、`/platform/workflow`、`/platform/jobs`、`/platform/audit` | 各独立 Workbench 和真实 API | IMPLEMENTED | 移入“平台与系统”二级分组，取消一级散列按钮 |
| 系统支持 | `/platform/operations`、项目文档 | 生产运维 Workbench；仓库内验收/操作手册 | PARTIAL | 参考站是独立帮助中心；本地保留原创文档与运维入口，不复制其品牌、文章或联系方式 |
| 数据大屏 | `/control/tower`、`/control/bi` | Dashboard/BI 能力 | PARTIAL | 已核对管理/分组/我的大屏/地图四个目录；本地保持真实 Control Tower/BI，不用静态假图表复刻 25 个参考租户实例 |

## 叶子页映射审计

`517` 个参考业务叶子页不是 `517` 个应复制的本地页面。审计按领域能力、真实 API 和本地状态机归并，结论如下：

| 参考域 | 参考叶子 | 本地真实入口 | API/状态机覆盖结论 | 映射状态 |
| --- | ---: | --- | --- | --- |
| WMS | 188 | `/wms/inbounds`、`/wms/inventory`、`/wms/outbounds`、`/wms/operations`、`/rf/*` | 入库、收货、质检、上架、库存、冻结、预占、盘点、波次、拣配、装运和移动作业有真实命令/查询；参考站的专用规则、设备和统计页被归并 | PARTIAL |
| OMS | 60 | `/oms/orders`、`/oms/fulfillment-processes` | 接入、校验、审核、ATP、释放、变更、取消、异常、RMA、履约编排均有真实实现 | IMPLEMENTED |
| TMS | 86 | `/tms/orders`、`/tms/planning`、`/tms/execution`、`/tms/settlement`、`/ams/capacity` | 订单、路径/配载、运力、调度、轨迹、在途、签收逆向、计费和车队洞察均映射到真实面板/API | IMPLEMENTED |
| 基础资料 | 98 | `/mdm/products`、`/mdm/partners`、`/mdm/warehouses`、`/mdm/governance`、平台配置/附件 | 核心伙伴、货品、包装、地址、仓库、车队、合同/日历/质量和治理存在；参考站的细粒度费用、组织和页面自定义入口被归并 | PARTIAL |
| 报表 | 79 | `/control/bi`、`/control/tower`、`/billing/facts` | 通用 BI、控制塔、预警和结算事实真实可用；租户专有报表模板不复制 | PARTIAL |
| 消息 | 6 | `/platform/events`、`/platform/inbox`、`/platform/configuration` | 领域事件、Outbox/Inbox、通知投递和配置真实可用 | IMPLEMENTED |

参考站叶子覆盖率为 `517/517 = 100%`（均完成取证与能力归并）；核心能力族不存在已确认的 `MISSING`。`PARTIAL` 代表未复制参考租户的细分页面数量或专有模板，不代表用静态页、假按钮或假数据补位。

## UI 对齐结论

| 维度 | 参考站观察 | 本轮本地结果 | 剩余差异 |
| --- | --- | --- | --- |
| 主导航 | 深色窄侧栏只放大类 | 10 个本地业务大类，叶子不再堆入侧栏 | 本地域边界与参考站 8 类并非一一同名 |
| 二/三级导航 | 当前产品的业务组与叶子页 | 类型化 `ADMIN_NAV_CATEGORIES` 统一驱动业务组和叶子页 | 少量大型 Workbench 仍用页内功能区归并长尾叶子 |
| URL/页签 | 内部页签承载叶子页 | BrowserRouter、深链、前进后退、工作区 Tab 同源 | 无核心差距 |
| 页面骨架 | 查询区、工具栏、密集表格、分页、详情层 | `QueryPanel`、`CommandBar`、`DataGrid`、Drawer 与四类模板 | 本地采用原创 Ant Design 视觉，不复制参考 CSS/素材 |
| 运输长页 | 订单/计划/执行/结算分组 | 4 个 URL + 4 个真实页签，旧 URL 重定向 | 无核心差距 |
| 支持/大屏 | 独立帮助中心和租户大屏实例 | 原创运维/文档、Control Tower/BI | 不复制文章、联系方式、租户模板或地图素材 |

## 当前统计

- IMPLEMENTED：15 个核心映射项
- PARTIAL：5 个
- MISSING：0 个已确认核心能力族
- 参考业务叶子取证：517/517
- 辅助目录视图：10/10

当前核心映射完整实现率为 75%（15/20），核心能力覆盖率为 100%（IMPLEMENTED + PARTIAL）。完整率没有把参考租户专有报表、外部不可达工具或帮助文章计作本地缺失功能。

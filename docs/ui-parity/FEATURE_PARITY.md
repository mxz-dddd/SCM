# 前端功能对照矩阵

本矩阵区分“参考页面已取证”和“本地功能已实现”。`517` 个业务叶子是参考站只读取证条目，不代表本地存在 `517` 个独立页面。逐条、脱敏、可机读的结论以 `reference-page-catalog.json` 为准。

状态含义：

- `IMPLEMENTED`：有稳定本地路由、真实组件、API 和测试证据；
- `PARTIAL`：存在真实能力，但参考叶子的专用流程、细分视图或管理能力没有一一实现；
- `MISSING`：当前产品范围内确认需要、但没有实现；
- `NOT_APPLICABLE`：参考租户专有模板、文章或扩展不属于本地产品；
- `BLOCKED`：参考入口位于不可达外站或外部认证门，未据此推断本地需求。

## 核心映射

| 参考能力族 | 本地稳定入口 | 真实组件/API 证据 | 当前结论 |
| --- | --- | --- | --- |
| OMS 订单与履约 | `/oms/orders`、`/oms/fulfillment-processes` | `OrderIntakeWorkbench`、`FulfillmentProcessWorkbench`；OMS intake/process API 与数据库测试 | 核心生命周期已实现；58 个租户细分叶子仍为 `PARTIAL` |
| WMS 入库、库存、出库 | `/wms/inbounds`、`/wms/inventory`、`/wms/outbounds` | 三个真实 Workbench；WMS 命令/查询、并发和数据库测试 | 核心流程已实现，长尾规则与专用执行视图按条目保留 `PARTIAL` |
| WMS 任务/WES/绩效/规则/设备 | `/wms/operations/{tasks,wes,performance,rules,devices}` | `WarehouseOperationsHub` 复用 `MobileOperationsWorkbench`、`InventoryGovernanceWorkbench` 和 WMS operations API | 五个稳定入口已落地；没有空白页或静态占位，专用租户流程不宣称等价 |
| TMS 订单、计划、执行、结算 | `/tms/orders`、`/tms/planning`、`/tms/execution`、`/tms/settlement` | `TransportOrderWorkbench`；planning/tracking/freight-billing API 与测试 | 四个真实深链已实现；2 个外站入口 `BLOCKED`，68 个细分叶子 `PARTIAL` |
| MDM 九类业务组 | `/mdm/products`、`partners`、`regions`、`capacity`、`fleet`、`charges`、`organizations`、`attachments`、`settings` | `MasterDataHub` 复用 Product、Partner、Warehouse/Fleet、Governance、Organization、Attachment、Configuration Workbench | 九类均可导航到真实能力；低代码外部认证门 `BLOCKED`，租户扩展仍 `PARTIAL` |
| 原创报表中心 | `/reports/center`、`subjects`、`mine`、`templates` | `ReportCenterWorkbench` 组合真实 BI、Control Tower 和 Billing Fact API | 2 条核心报表 `IMPLEMENTED`、2 条 `PARTIAL`；75 个参考租户模板 `NOT_APPLICABLE` |
| 消息与事件 | `/platform/events`、`/platform/inbox` | Event/Notification Workbench；Outbox、Inbox、投递 API 与测试 | 2 条 `IMPLEMENTED`、4 条管理细分能力 `PARTIAL` |
| 原创帮助中心 | `/support/help`、`user-guide`、`operations`、`api`、`releases` | `HelpCenterWorkbench` 只链接仓库内已跟踪的 README、设计、运维、安全和变更文档 | 本地帮助 Shell 已实现；6 个参考文章目录按内容边界记为 `NOT_APPLICABLE` |
| 数据大屏 | `/screens/manage`、`groups`、`mine`、`maps` | `DataScreenWorkbench` 复用真实 BI 与 Control Tower | 四个稳定入口均非静态假图；由于尚无独立大屏编排/分组管理模型，4 条保持 `PARTIAL` |

## 527 条 Catalog 统计

| 一级参考域 | 业务叶子/目录 | IMPLEMENTED | PARTIAL | MISSING | NOT_APPLICABLE | BLOCKED |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| WMS | 188 | 28 | 160 | 0 | 0 | 0 |
| OMS | 60 | 2 | 58 | 0 | 0 | 0 |
| TMS | 86 | 16 | 68 | 0 | 0 | 2 |
| MDM | 98 | 28 | 69 | 0 | 0 | 1 |
| REPORTS | 79 | 2 | 2 | 0 | 75 | 0 |
| MESSAGES | 6 | 2 | 4 | 0 | 0 | 0 |
| SUPPORT（目录） | 6 | 0 | 0 | 0 | 6 | 0 |
| DATA_SCREEN（目录） | 4 | 0 | 4 | 0 | 0 | 0 |
| **合计** | **527** | **78** | **365** | **0** | **81** | **3** |

这些数字只表达逐条映射判断。`MISSING = 0` 不等于本地具有 517 个页面；大量条目被合并到同一真实领域页面，365 条仍明确保留 `PARTIAL`。

## 布局与视觉证据边界

- 22 个唯一映射路由均生成结构化布局结果和遮罩后图像差异；
- 参考侧使用 8 个业务族只读结构快照，本地侧使用 22 个真实路由；因此这是“业务族壳层与区域结构”比较，不是 517 个叶子的逐像素复刻；
- 只遮罩头像/Logo、用户名、订单号、金额、地址、时间和参考租户专有报表/大屏内容，不再整块遮住普通内容区；
- 结构门槛为应用壳位置 `<= 8px`、主要尺寸 `<= 5%`、字号 `<= 2px`、无未解释的大块差异；
- 当前 22 个结果处于第 1 轮严格比较，没有上一轮同口径分数，因此不使用“视觉收敛”表述；遮罩后图像差异仍在最终报告中按路由如实展示。

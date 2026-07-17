# SCM V2 运行闭环架构

本文描述 V2-01 至 V2-08 已实现的运行时结构。代码清单是事件和订阅的事实来源，生成结果见 [V2 事件目录](V2_EVENT_CATALOG.md)；本文件不替代领域边界、状态机和数据不变量。

## 逻辑架构

```mermaid
flowchart LR
  subgraph Clients["入口与终端"]
    Admin["管理工作台"]
    Customer["客户门户"]
    Partner["伙伴门户"]
    Driver["司机端"]
    RF["RF 端"]
    External["External Gateway"]
  end
  subgraph Runtime["应用运行时"]
    API["NestJS 模块化单体"]
    Worker["多租户 Worker"]
    Web["React Browser Router"]
    Optimizer["无状态优化器"]
  end
  subgraph Persistence["基础设施"]
    PG[("PostgreSQL 16\n领域 Schema + Outbox/Inbox/Delivery")]
    Redis[("Redis 7\nBullMQ + 隔离 DB")]
    MinIO[("MinIO\n附件与报表")]
  end
  Admin --> Web
  Customer --> Web
  Partner --> Web
  Driver --> Web
  RF --> Web
  Web --> API
  External -->|"认证、配额、原始请求校验"| API
  API --> PG
  API --> Redis
  API --> MinIO
  API --> Optimizer
  Worker -->|"Worker Principal + 租户头"| API
  Worker --> Redis
  Worker -->|"Webhook: HTTPS + DNS/IP 钉扎"| Webhook["公网 Webhook"]
```

## 事件投递流程

```mermaid
flowchart TD
  Command["领域命令"] --> Tx["业务事实 + Outbox 同一事务"]
  Tx --> Relay["Worker 按 ACTIVE 租户领取 Outbox"]
  Relay --> Match["按静态 EVENT_SUBSCRIPTIONS 匹配"]
  Match --> Ledger["幂等创建 EventDelivery"]
  Ledger --> Claim["consumer + partitionKey 源顺序领取"]
  Claim --> Endpoint["内部 allowlist 具名端点"]
  Endpoint --> Inbox["Inbox 去重 + 领域 handler"]
  Inbox -->|"成功"| Processed["PROCESSED / IGNORED"]
  Inbox -->|"临时失败"| Retry["指数退避 + availableAt"]
  Retry --> Claim
  Inbox -->|"耗尽尝试"| Dead["DEAD_LETTER"]
  Dead --> Block["必需消费者阻塞同分区后续事件"]
  Dead --> Alert["Control 异常 + OMS 人工介入"]
  Operator["授权操作员"] --> Replay["审计式人工重放"]
  Replay --> Claim
  Claim -->|"其他分区"| Parallel["有界并行，不受阻塞分区影响"]
```

## OMS 自动履约时序

```mermaid
sequenceDiagram
  actor User as OMS 操作员
  participant API as OMS API
  participant DB as PostgreSQL
  participant Worker as 多租户 Worker
  participant WMS as WMS Consumer
  participant TMS as TMS Consumer
  participant PM as OMS Process Manager
  User->>API: release(orderId, Idempotency-Key)
  API->>DB: Order + Process + Steps + Outbox 原子提交
  DB-->>Worker: fulfillment.released.v2 / shipment.requested.v2
  Worker->>WMS: 具名端点 + eventId:consumer
  WMS->>DB: Inbox + Outbound 幂等提交
  Worker->>TMS: 具名端点 + eventId:consumer
  TMS->>DB: Inbox + TransportOrder 幂等提交
  DB-->>Worker: outbound.* / shipment.*
  Worker->>PM: 履约事实事件
  PM->>DB: Step + Link + Process 投影
  PM-->>User: EXECUTING / COMPLETED / MANUAL_INTERVENTION
  Note over Worker,PM: 重放同一事件不会重复创建下游对象
```

## 核心运行时类图

```mermaid
classDiagram
  class OutboxEvent {
    +UUID id
    +UUID tenantId
    +String eventName
    +UUID aggregateId
    +Int aggregateVersion
    +DateTime occurredAt
  }
  class EventSubscriptionDefinition {
    +String consumer
    +String[] eventPatterns
    +String endpoint
    +ConsumerMode mode
    +Boolean required
    +Int maxAttempts
  }
  class EventDelivery {
    +UUID eventId
    +String consumer
    +String partitionKey
    +DeliveryStatus status
    +Int attemptCount
    +DateTime availableAt
    +Int version
  }
  class InboxEvent {
    +UUID tenantId
    +String consumer
    +UUID eventId
    +String status
  }
  class WorkerPrincipal {
    +UUID actorId
    +String accountKind
    +UUID tenantId
    +String operation
  }
  class OrderFulfillmentProcess {
    +UUID orderId
    +ProcessStatus status
    +Int expectedStepCount
    +Int succeededStepCount
    +Int version
  }
  class OrderFulfillmentStep {
    +StepType stepType
    +StepStatus status
    +UUID sourceEventId
    +String idempotencyKey
  }
  OutboxEvent --> EventSubscriptionDefinition : matches
  OutboxEvent "1" --> "0..*" EventDelivery : fans out
  EventDelivery --> InboxEvent : dispatches
  WorkerPrincipal --> EventDelivery : claims per tenant
  OrderFulfillmentProcess "1" --> "1..*" OrderFulfillmentStep
  InboxEvent ..> OrderFulfillmentStep : advances
```

## 运行边界

- 跨域只交换自包含事件合同、业务号、对方 ID 和必要快照；不跨域 JOIN、外键或导入内部仓储。
- `EVERY_EVENT` 逐 `eventId` 处理；只有声明为 `LATEST_STATE` 的最终状态投影可以留下可观测的旧版本 `IGNORED`。
- Worker 使用专用 control token 和 actor，每次后台请求显式携带租户；服务端对 operation deny-by-default。
- 外部 Gateway 的 method、path、IP、body bytes/hash 均取自真实请求；Webhook 在配置和每次投递时都重新验证 DNS/IP。
- 管理端和四类终端均由 Browser Router 注册，支持刷新、历史和地址栏深链。

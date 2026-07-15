# SCM V2 OMS→WMS/TMS 履约运行闭环

本图集描述 V2-03 已落地的运行时边界。WMS/TMS consumer 只读取自包含事件，不查询 OMS 内部表；所有副作用均通过目标域公开服务完成。

## 自动履约流程

```mermaid
flowchart TD
  A[OMS 审核与 ATP 分配] --> B[Release 命令]
  B --> C[同一事务: Order + Process + Steps + Outbox]
  C --> D[fulfillment.released.v2]
  C --> E[shipment.requested.v2]
  D --> F[EventDelivery: WMS consumer]
  E --> G[EventDelivery: TMS consumer]
  F --> H[OutboundService 幂等创建并释放]
  G --> I[TransportOrderService 幂等接收]
  H --> J[outbound.created/released]
  I --> K[tms.transport-order-received]
  J --> L[OMS Process consumer]
  K --> L
  L --> M[更新 Step + CrossDomainObjectLink + 履约投影]
  M --> N{创建步骤全部成功?}
  N -- 是 --> O[Process EXECUTING]
  N -- 否 --> P[Process WAITING_DOWNSTREAM]
  O --> V[outbound.ready / shipment.vehicle-assigned]
  V --> W[shipment.delivered]
  W --> X[shipment.pod-confirmed]
  X --> Y{全部生命周期步骤成功?}
  Y -- 是 --> Z[Process COMPLETED]
  Y -- 否 --> O
  F -.耗尽重试.-> Q[Delivery DEAD_LETTER]
  G -.耗尽重试.-> Q
  Q --> R[Process MANUAL_INTERVENTION]
  R --> S[Control AlertCase]
  R --> T[显式 retry-step]
  R --> U[仅未创建目标对象时本地补偿]
  T --> F
  T --> G
```

## 事件时序

```mermaid
sequenceDiagram
  participant O as OMS Release TX
  participant L as Delivery Ledger
  participant W as Worker
  participant WC as WMS Consumer Facade
  participant TC as TMS Consumer Facade
  participant PM as OMS Process Manager
  participant C as Control
  O->>O: create Process and command Steps
  O->>L: v2 events fan-out after commit
  W->>L: claim ordered deliveries
  W->>WC: fulfillment.released.v2 + eventId:consumer
  WC->>WC: Inbox dedupe, create/release Outbound
  WC-->>PM: outbound.created/released.v1
  W->>TC: shipment.requested.v2 + eventId:consumer
  TC->>TC: Inbox dedupe, receive TransportOrder
  TC-->>PM: tms.transport-order-received.v1
  PM->>PM: update Step, Link and Process
  PM->>PM: EXECUTING after downstream objects exist
  WC-->>PM: outbound.ready.v1
  TC-->>PM: vehicle-assigned / delivered / pod-confirmed
  PM->>PM: complete lifecycle Steps; then COMPLETED
  alt delivery retries exhausted
    L-->>PM: control.event-delivery-dead-lettered.v1
    PM->>PM: MANUAL_INTERVENTION
    PM-->>C: oms.fulfillment-process-failed.v1
    C->>C: create deduplicated AlertCase
  else operator retries failed step
    PM->>L: reissue original v2 command event
  end
```

## 核心类图

```mermaid
classDiagram
  class OrderFulfillmentProcess {
    +UUID orderId
    +Int orderVersion
    +ProcessStatus status
    +Int expectedStepCount
    +Int succeededStepCount
    +Boolean manualInterventionRequired
    +Int version
  }
  class OrderFulfillmentStep {
    +StepType stepType
    +StepStatus status
    +UUID sourceEventId
    +String idempotencyKey
    +String targetType
    +UUID targetId
    +Json inputSnapshot
    +Json resultSnapshot
    +Json compensationSnapshot
    +Int attemptCount
    +Int version
  }
  class CrossDomainObjectLink {
    +String sourceType
    +UUID sourceId
    +String sourceBusinessNo
    +String targetType
    +UUID targetId
    +String targetBusinessNo
  }
  class FulfillmentReleasedV2 {
    +order and fulfillment refs
    +warehouse owner customer snapshots
    +destination and service snapshots
    +original and base quantity lines
  }
  class ShipmentRequestedV2 {
    +order and shipment refs
    +origin and destination snapshots
    +pickup and delivery windows
    +weight and volume dual units
    +package vehicle carrier charge snapshots
  }
  class OutboundOrder {
    +String sourceRef
    +Int sourceVersion
  }
  class TransportOrder {
    +String sourceRef
    +String sourceVersion
  }
  OrderFulfillmentProcess "1" --> "1..*" OrderFulfillmentStep
  OrderFulfillmentProcess "1" --> "0..*" CrossDomainObjectLink
  OrderFulfillmentStep ..> FulfillmentReleasedV2
  OrderFulfillmentStep ..> ShipmentRequestedV2
  FulfillmentReleasedV2 ..> OutboundOrder
  ShipmentRequestedV2 ..> TransportOrder
```

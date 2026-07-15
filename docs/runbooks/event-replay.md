# 事件死信与重放手册

## 判定原则

EventDelivery 是投递事实账本，Outbox 的已发布不代表消费者已处理。重放必须操作原 Delivery，并保留 attempt、错误、操作者、原因、correlation id 和审计事件；禁止直接修改 Inbox、伪造新业务结果或删除死信记录。

同一 `tenant + consumer + partitionKey` 按源事件时间和 eventId 稳定排序。必需消费者的头部 Delivery 进入 `DEAD_LETTER` 后，后续同分区事件保持阻塞；其他分区继续运行。`EVERY_EVENT` 的两个不同 eventId 必须分别处理，即使 aggregateVersion 相同；`LATEST_STATE` 才允许旧状态以 `IGNORED` 收敛。

## 重放步骤

1. 从事件工作台按租户、consumer、partitionKey 和业务引用定位死信，确认其为当前分区头部。
2. 检查最后错误、attempt 历史、源事件 payload 版本和目标端点；先修复临时依赖、配置或兼容性问题。
3. 判断副作用是否具备 `eventId:consumer` 幂等保护，确认目标域 Inbox 或业务对象当前状态。
4. 使用具备事件重放权限的命令提交原因和 `Idempotency-Key`；不要直接更新 Delivery 状态。
5. 观察 Delivery 从 `PENDING`/`PROCESSING` 到 `PROCESSED` 或 `IGNORED`，确认同分区后续事件恢复领取。
6. 检查下游对象数、Inbox 数和履约步骤，证明没有重复出库、运单、计费事实或时间线。

若事件语义已无法安全执行，只能使用独立高权限的人工跳过命令，并记录业务批准、影响对象与补偿方案。必需消费者不得为清空队列而随意跳过。

## 验证与升级

- 临时失败：预期 attempt 增加、`availableAt` 按指数退避，修复后自动成功。
- 永久失败：预期 `DEAD_LETTER`、Control 异常和相关 OMS Process 人工介入。
- 重放失败：保留新的 attempt 证据，不删除原错误；连续失败时升级领域负责人。
- 分区不恢复：检查是否仍有更早的 `PENDING`、`PROCESSING` 或 `DEAD_LETTER`，以及 lease 是否过期。
- 重复副作用：立即暂停该 consumer，保存 Delivery/Inbox/业务对象证据，按幂等缺陷处理，不用数据删除掩盖。

发布前执行 `pnpm test:v2-e2e`，它会验证临时失败重试、死信阻塞、人工重放恢复、逐事件顺序和重放不重复副作用。

# 多租户 Worker 运行手册

## 身份与发现

API 与 Worker 使用同一个 32 字符以上的 `WORKER_CONTROL_TOKEN`，并为 Worker 配置固定 UUID `WORKER_ACTOR_ID`。该 actor 不是账号，不能登录或获得租户管理员 JWT。Worker 通过内部发现端点分页读取 ACTIVE 租户；每次后台调用都携带 control token、`X-Tenant-Id` 和 correlation id。API 的 `WorkerAccessGuard` 对后台身份默认拒绝，只有标注且位于 operation allowlist 的端点可用。

`WORKER_TENANT_REFRESH_INTERVAL_MS` 控制租户刷新，默认 30000 ms。Outbox、EventDelivery、Webhook 的轮询间隔分别由 `WORKER_RELAY_INTERVAL_MS`、`WORKER_EVENT_DELIVERY_INTERVAL_MS`、`WORKER_WEBHOOK_INTERVAL_MS` 控制。`WORKER_TENANT_CONCURRENCY` 限制同进程并行租户数；多进程互斥仍由数据库 lease 和 `SKIP LOCKED` 保证。Redis 逻辑库由 `REDIS_DB` 指定，取值只能是 0 至 15。

## 启动检查

1. 确认 API、PostgreSQL 和 Redis 健康，API 与 Worker 密钥版本一致。
2. 启动 Worker，轮询 `GET /health`；首次成功刷新租户前 503 是预期状态，刷新后必须为 200。
3. 核对 `tenantCount`、`lastTenantRefreshAt`、`failedTenants`、`inFlight`，以及每租户 Outbox、EventDelivery、Webhook、Job、Print backlog。
4. 用两个测试租户各提交一笔命令，确认同一 Worker 都能处理，日志中的 tenantId、businessRef、traceId 不串租户。

所有健康轮询必须有超时。不要用固定长 sleep 掩盖租户发现、租约或数据库连接竞态。

## 告警与处置

- `WORKER_AUTH_REQUIRED`：核对 token 长度、密钥版本、actor UUID 和租户状态，禁止临时切换管理员 JWT。
- `failedTenants` 非空：按 tenantId 和 correlation id 检查 API/数据库错误；单租户故障不应阻止其他租户运行。
- backlog 单调增长：分别检查 relay、delivery、webhook 间隔及数据库 lease；不要通过全局 `concurrency: 1` 掩盖分区顺序问题。
- EventDelivery `DEAD_LETTER`：按 [事件重放手册](event-replay.md) 判断重放、跳过或保持阻塞。
- 健康端点长期 503：先检查租户发现日志和 API allowlist，再检查 PostgreSQL/Redis；不要扩大后台端点权限。

## 扩缩容与停机

同一版本可水平扩展多个 Worker。严格顺序的边界是 `tenant + consumer + partitionKey`，不同分区可并行。滚动升级前停止新轮询，等待健康端点 `inFlight` 归零后退出；进程会在优雅关闭窗口内等待在途任务，残留租约到期后由其他实例安全接管。密钥轮换步骤见 [Worker Control Token](worker-control-token.md)。

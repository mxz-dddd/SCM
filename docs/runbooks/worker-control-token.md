# Worker Control Token 部署与轮换

## 部署

API 与 Worker 必须同时注入相同的 `WORKER_CONTROL_TOKEN`，长度至少 32 个字符；使用密钥管理系统生成和分发，不写入镜像、Git、日志或数据库。`WORKER_ACTOR_ID` 是用于审计的固定 UUID，不创建 Account，也不能登录。Worker 通过 `WORKER_API_URL` 调用 API，每 30 秒从 `GET /api/v1/internal/worker/tenants` 刷新 ACTIVE 租户。

后台身份只能访问带 `@WorkerAccessible(operation)` 的精确路由。新增后台 API 时必须先增加 operation allowlist、路由装饰器和拒绝测试；禁止装饰整个业务 CRUD controller。普通 JWT 仍经过原 RBAC，不因装饰器获得额外权限。

健康探针默认读取 `GET http://worker:3001/health`。首次租户刷新前返回 503，之后返回 200，并展示发现租户数、最近刷新时间、按租户的 Outbox/EventDelivery/Webhook/Job/Print backlog、失败租户和 in-flight 数量。

## 轮换

当前协议只接受一个 control token，因此采用短暂停机的协调轮换：

1. 停止 Worker 接收新任务并等待 `/health` 中 `inFlight` 为 0；数据库租约到期可由新实例安全接管。
2. 在密钥管理系统生成新的 32+ 字符随机 token。
3. 更新 API 的 `WORKER_CONTROL_TOKEN` 并滚动重启 API。
4. 更新 Worker 的同名变量并启动 Worker；确认租户发现成功、backlog 开始下降且无 `WORKER_AUTH_REQUIRED`。
5. 删除旧 token 版本，记录轮换人、时间、变更单和健康证据。

不得临时改用租户管理员 JWT，也不得恢复 `WORKER_TENANT_ID`。若 Worker token 疑似泄露，立即停止 Worker、轮换 token，并从结构化日志按 `accountKind=WORKER`、`WORKER_ACTOR_ID` 和 correlation id 审计后台调用。

# SCM Cloud

多租户供应链协同 SaaS 的 pnpm/Turborepo Monorepo。

## 工作区

- `apps/web`：React 18 + Vite Web 工作台
- `apps/api`：NestJS 10 模块化单体 API
- `apps/worker`：BullMQ 后台消费者
- `packages/shared`：跨端契约、枚举与状态机定义
- `packages/ui`：统一业务组件库

## 本地启动

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:migrate:deploy
SEED_ADMIN_PASSWORD='<local-password>' pnpm db:seed
pnpm dev
```

本地 JWT、API 凭证和 `WORKER_CONTROL_TOKEN` 需要在 `.env` 中配置彼此独立、至少 32 个字符的随机密钥；`WORKER_ACTOR_ID` 使用专用 UUID，不对应任何可登录账号。Worker 每 30 秒从 API 发现 ACTIVE 租户，不再配置单一 `WORKER_TENANT_ID`；`http://localhost:3001/health` 展示租户数量、刷新时间、各租户 backlog、失败租户和 in-flight 数量。种子账号为 `PLATFORM / platform-admin`，密码由 `SEED_ADMIN_PASSWORD` 提供，仓库不保存明文密码。

API 默认启用 Helmet、1 MiB JSON/64 KiB 表单上限、数据库原子限流和显式 CORS allowlist。生产环境必须配置 `CORS_ALLOWED_ORIGINS`，仅在可信反向代理已清洗转发头时设置 `TRUST_PROXY`；外部 Gateway 凭据头和 Webhook 出站限制见 [入口安全运行手册](docs/runbooks/entry-security.md)。

V2 运行闭环以持久化 EventDelivery 为核心：OMS Release 事件由受限多租户 Worker 自动 fan-out 到 WMS/TMS，并通过 Inbox 幂等、分区顺序、退避重试、死信与人工重放收敛。架构、订阅和运行手册见 [V2 架构](docs/design/V2_ARCHITECTURE.md)、[事件目录](docs/design/V2_EVENT_CATALOG.md)、[Worker 多租户](docs/runbooks/worker-multitenancy.md) 与 [事件重放](docs/runbooks/event-replay.md)。

Web 使用真实 Browser Router；管理端与 `/portal/customer/*`、`/portal/partner/*`、`/driver/*`、`/rf/*` 均可直接打开和刷新。

提交前运行统一门禁：

```bash
pnpm verify
pnpm build
pnpm test:v2-e2e
```

`test:v2-e2e` 会使用隔离的 PostgreSQL 数据库和 Redis DB 15，启动真实 API、Worker、Web 与 Chromium；失败证据写入 `artifacts/v2/`。

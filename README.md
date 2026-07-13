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

本地 JWT 和 API 凭证还需要在 `.env` 中配置至少 32 个字符的独立密钥。种子账号为 `PLATFORM / platform-admin`，密码由 `SEED_ADMIN_PASSWORD` 提供，仓库不保存明文密码。

提交前运行统一门禁：

```bash
pnpm verify
```

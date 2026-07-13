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
pnpm dev
```

提交前运行统一门禁：

```bash
pnpm verify
```

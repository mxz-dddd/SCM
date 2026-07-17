# SCM V2 改造前基线

- 执行日期：2026-07-16
- 基线分支：`main`
- 基线 SHA：`2ffe648820ce484e3ee3b6b09695f0a0f8820d54`
- Node.js：`v24.16.0`
- pnpm：`11.7.0`
- 安装：`pnpm install --frozen-lockfile` 通过

## 基础设施

本机 5432/6379/9000 已被其他现有项目容器占用，未停止或修改这些任务外容器。SCM PostgreSQL 16 以 55434 映射启动，Redis 7 与 MinIO 复用本机已运行服务。

默认 `scm` 数据卷存在旧的迁移表/枚举不一致，首次 deploy 在 `20260716050000_control_ai_optimization` 报 `P3018 / ControlRouteOptimizationStatus already exists`。为避免将遗留数据卷问题误判为仓库问题，后续在独立空库 `scm_v2_baseline` 中执行基线。

## 基线结果

| 命令 | 结果 | 摘要 |
| --- | --- | --- |
| `pnpm db:migrate:deploy` | 通过 | 独立空库从零应用 76 个迁移 |
| `pnpm verify` | 通过 | API 298、Web 30、Worker 13、Shared 28、UI 6；无跳过 |
| `pnpm build` | 通过 | 5 个工作区包全部成功 |

已知非阻断警告：Web 基线主 chunk 约 1.49 MB，Vite 提示应使用动态 import 分割；V2-07 路由级懒加载将处理该项。

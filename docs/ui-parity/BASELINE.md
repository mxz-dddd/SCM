# 前端对标重构基线

## 代码与环境

- 记录日期：2026-07-17（Asia/Shanghai）
- 目标分支：`codex/frontend-parity`
- `origin/main`：`2ffe648820ce484e3ee3b6b09695f0a0f8820d54`
- 任务起始 HEAD：`690f0507eabf29127f73b756d52054858d1258cd`
- Node.js：`v24.16.0`
- pnpm：`11.9.0`
- 工作树在本任务开始前已有未提交的 V2 业务改动；本任务保留这些改动，没有 reset、checkout 或覆盖。

## 隔离基础设施

由于本机 `5432`、`6379`、`9000` 已被其他项目占用，未停止或修改其他项目容器。本任务使用 Git 忽略的 `.env.ui-parity.local` 和 `.artifacts/ui-reference/docker-compose.override.yml` 启动隔离环境：

- PostgreSQL 16：`55436`，数据库 `scm_ui_parity`
- Redis 7：`56381`
- MinIO：`59000` / `59001`

结果：PostgreSQL、Redis、MinIO 均 healthy；82 个 Prisma migration 从空库应用成功；seed 成功。

## 基线门禁

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 通过 | lockfile 与供应链策略校验通过，600 个条目 |
| `pnpm db:migrate:deploy` | 通过 | 82/82 migrations |
| `pnpm db:seed` | 通过 | 隔离数据库 seed 完成 |
| `pnpm lint` | 通过 | 5 个 workspace package |
| `pnpm typecheck` | 通过 | 5 个 workspace package |
| `pnpm verify` | 通过 | lint、typecheck、test 全绿；API 157 个文件 388/388、Web 38/38、Worker 31/31、UI 8/8、Shared 31/31 |
| `pnpm test:e2e` | 通过 | Playwright 12/12；验收 Worker 使用独立健康端口，避免与常驻本地 Worker 冲突 |
| `pnpm build` | 通过 | 5 个 workspace package 均构建成功；Web 主 chunk 存在大于 500 kB 的既有警告 |

基线阶段出现的单个 Worker 数据库用例已在隔离数据库中单独复测通过，最终全量门禁没有跳过、注释或降低任何断言。

## 当前前端结构

- `apps/web/src/router/route-registry.tsx`：40 条 ADMIN 路由、4 类独立终端路由，路由级动态 import 已存在。
- `apps/web/src/router/app-router.ts`：已使用 `createBrowserRouter`，具备深链、404、错误页和终端 redirect。
- `apps/web/src/workspace/ApplicationShell.tsx`：URL 与工作区 Tab 已同步，命令面板、收藏、最近访问共享路由注册源。
- 主要 Workbench：36 个；API Controller：70 个；Service：86 个。

核心缺陷：`ADMIN_ROUTE_REGISTRY` 是扁平数组，`ApplicationShell` 将每个叶子 route 都直接渲染成一级侧栏按钮。当前注册项没有 category/group 归属，无法表达“一级大类 → 二级业务组 → 三级页面”。

## 本轮重构进展

- 新增类型化 `ADMIN_NAV_CATEGORIES`，37 条管理端路由全部且仅归属一个一级大类和二级业务组。
- 左侧栏只显示 10 个本地业务大类；当前大类显示二级组和三级叶子，URL、浏览器历史、工作区 Tab、命令面板共用路由注册源。
- 修复命令导航时“先激活 Tab、后更新 URL”导致回跳工作台的竞态；路由现在作为导航单一事实源。
- 新增列表、主从、任务、配置四类共享页面模板，入库列表已接入；动作栏变为单行滚动以保持企业页面密度。
- 将原先纵向堆叠的运输大页拆为订单、计划、执行、结算与分析四个真实深链/页签，旧 `/tms/shipments` 自动跳转到 `/tms/orders`。
- 路由测试 8/8、应用主测试 31/31、共享 UI 测试 8/8 通过；Web 与共享 UI 类型检查通过。
- 本地隔离 API 已启动并完成真实登录，10/10 一级模块人工点击、URL 和分层导航核验通过；截图存放在 Git 忽略目录。

## 最终参考取证与视觉循环

- 仓储 188、订单 60、运输 86、基础资料 98、报表 79、消息 6，共 `517/517` 个业务叶子页完成只读打开、截图和结构抽取。
- 按用户确认的边界，系统支持保留 6 个展开目录截图，数据大屏保留 4 个目录页截图，不逐篇打开帮助文章、不逐个打开 25 个租户大屏。
- 两个外部不可达工具页和一个外部认证门只记录状态并立即关闭；浏览器临时页在每轮核验后清理。
- 本地代表页覆盖订单、入库、库存和运输；运输初次对比发现超长纵向堆叠，完成 URL/页签拆分后再次截图，4/4 深链均选中对应真实内容。
- 视觉迭代在第 2 轮收敛，没有复制参考站 HTML、CSS、图标、图片、字体、品牌或业务数据。

## 参考站访问与安全状态

- 访问方式：用户在 Codex 内置浏览器中人工完成登录，Codex 复用既有会话。
- 只执行导航、截图和只读 DOM/布局测量；没有读取 Cookie、Token、用户名或密码。
- 没有执行保存、提交、审批、删除、导出、下载、上传、发运或结算。
- 原始截图和结构快照仅存放在 Git 忽略目录 `.artifacts/ui-reference/raw/target/`。
- 取证文本已运行 `scripts/ui-reference/redact-artifacts.mjs`，发现并脱敏 3 个原始文件中的敏感模式；仓库内不提交这些原始证据。

# P1 平台骨架阶段验收报告

- 验收日期：2026-07-14
- 验收范围：`P1-01` 至 `P1-17`
- 设计基线：`docs/design/SCM_同类系统_架构与详细设计说明书_v0.1.md` §6、§9、§11、§13
- 结论：通过

## 退出条件

| 退出条件 | 验收证据 | 结果 |
| --- | --- | --- |
| 可登录 | PLATFORM 租户管理员通过 `/api/v1/auth/login` 获取租户绑定 JWT；登录成功/失败均有审计 | 通过 |
| 多租户隔离 | TenantContext 中间件、RBAC/ABAC 后端守卫、所有平台查询 tenant 条件；权限拒绝和跨租户引用测试覆盖 | 通过 |
| 模块路由 | Web 应用壳包含平台、配置、审计、附件、消息、数据、审批、规则、调度、事件与平台收尾工作台 | 通过 |
| 统一表格/表单/动作 | 页面复用 QueryPanel、DataGrid、CommandBar、StatusBadge 与 Action Registry；Web 组件验收 12/12 | 通过 |
| 平台共性能力 | 配置/字典/单号、审计、对象存储、通知、导入导出、工作流、规则、任务、事件、国际化、开关、评论和打印均完成 API、页面和测试 | 通过 |
| 数据基线 | PostgreSQL 九域 multiSchema 从空库顺序应用 19 个迁移；seed 连续执行两次无冲突 | 通过 |
| 质量门禁 | `pnpm verify` 的 lint、TypeScript strict typecheck、全部默认测试通过 | 通过 |

## 自动化结果

| 检查 | 结果 |
| --- | --- |
| `pnpm verify` | 通过；API 默认 109 项、Web 12 项、Worker 8 项、Shared 27 项、UI 6 项，共 162 项通过 |
| 空库迁移 | `scm_p117_verify` 从零应用 19/19 迁移 |
| 幂等 seed | 空库连续 seed 2 次通过 |
| 数据库测试 | API 120/120 通过，包含不可变事实、号段、Job 租约、Outbox relay、Inbox 去重与打印领取并发 |
| 真实 API 冒烟 | 登录、事件领取/消费/确认、调度运行、UTC/时区、Decimal 单位换算、特性开关、评论、模板/打印机路由和打印完成均通过 |

## 关键不变量抽查

- 外部写命令要求 `Idempotency-Key`；同键同载荷返回原结果，同键异载荷返回 409。
- 状态变化通过显式 transition map，并在业务事务中记录审计和 Outbox。
- Outbox 按租户与聚合键/版本有序领取；Inbox 先去重再执行，重复事件不重复产生副作用，旧版本标记 `IGNORED`。
- Job 与 PrintJob 使用 PostgreSQL 事务锁和租约作为多实例防重最终判定；并发测试仅一个领取者成功。
- 发布后的工作流、规则、打印模板，以及审计、事件回执等事实由数据库触发器保护不可变内容。
- 评论伙伴视图只返回 `EXTERNAL`；内部评论不会因前端参数泄漏给伙伴权限端点。

## 提交清单

P1 共 17 个独立工作包提交，从 `fa0d3c5`（P1-01）至 `3a95ff1`（P1-17）。每张任务卡均已在 `docs/BACKLOG.md` 勾选，并在 `docs/CHANGELOG.md` 留有摘要。

## 说明

仓库当前没有 `pnpm test:e2e` 脚本，且 BACKLOG 未定义单独的 P1 Playwright 验收卡；P1 的阶段退出条件采用真实 API 冒烟、Web DOM 交互测试、数据库集成/并发测试和空库迁移验证完成。P2/P3/P4 的 Playwright 验收卡仍保留在各自阶段末尾。

# AGENTS.md — SCM 同类系统仓库守则

本文件对所有 AI 编码代理（Codex 等）生效。任何实现与本文件冲突时，以本文件为准；无法遵守时停止并写入 `docs/QUESTIONS.md`。

## 1. 项目背景

多租户供应链协同 SaaS：OMS / WMS / TMS / AMS / Billing / Control Tower / Integration / Mobile。
需求基线：`docs/PLAN.md`（计划书）与 `docs/BACKLOG.md`（任务卡，唯一工作来源）。设计细节见 `docs/design/`（架构与详细设计说明书、Mermaid 图源）。

## 2. 技术栈（冻结，禁止更换或引入平行方案）

- Monorepo：pnpm workspaces + Turborepo。目录：
  - `apps/web` React 18 + TS + Vite + Ant Design 5 + TanStack Query + Zustand
  - `apps/api` NestJS 10 模块化单体（modules: platform, mdm, oms, wms, tms, ams, billing, control, integration）
  - `apps/worker` BullMQ 消费者（Outbox 投递、调度任务、异步作业）
  - `packages/shared` 跨端类型、事件契约、枚举、状态机定义
  - `packages/ui` 统一业务组件库
- 数据：PostgreSQL 16 + Prisma（multiSchema，每域独立 schema）；Redis 7；MinIO（S3）。
- 本地环境：`docker-compose up -d`（pg/redis/minio）。统一校验命令：`pnpm verify`（= lint + typecheck + test）。

## 3. 硬性规则（违反 = 返工）

### 数据建模（设计书 §12.1）
1. 所有业务表必须含：`id`(UUID)、`tenant_id`、`created_at/by`、`updated_at/by`、`version`(乐观锁)、`status`。业务流水与审计表不允许软删或物理删。
2. 金额一律 `Money { amount: Decimal, currency }`，禁止 float；税、汇率、舍入单独记录。
3. 数量保存原单位 + 基础单位双值；换算引用当时 PackageSpec 版本。
4. 业务单据保存主数据 ID + 关键字段快照，主数据变更不得改变历史语义。
5. 单号在 tenant + business_type 范围唯一；外部编号走映射表，不作主键。
6. 高频表索引以 `tenant_id` 开头；业务号建租户范围唯一索引。

### 领域边界
7. 跨模块禁止 JOIN、禁止数据库外键、禁止 import 他域内部实体/仓储；只保存对方 ID、业务号与必要快照。
8. 跨域写入只能通过领域命令（API 调用）或领域事件；跨域查询用读模型/投影。
9. 状态变更只能通过领域命令方法（显式 transition map），禁止直接 UPDATE status；每次变更写领域事件 + 审计。
10. 事件发布走事务 Outbox（与业务同事务写入），消费走 Inbox 去重；事件命名 `{domain}.{event}.v{n}`，最小载荷见设计书 §11.3。
11. 外部写接口必须支持 `Idempotency-Key`：同键同内容返回原结果，同键异内容返回 409。

### 关键不变量（设计书 §9.7，必须有测试守护）
12. 订单：数量守恒；已执行部分不可直接取消；Completed 要求所有履约行终态。
13. 库存：`available = onHand - allocated - hold`；version 单调；流水不可变；分配 ≤ 可用（乐观锁或原子 UPDATE ... WHERE 防超卖）。
14. 出库：已发运不可逆；短拣必须原因码并释放/重分配差额。
15. 预约：`used + reserved + workload ≤ capacity` 原子校验（slot version 条件更新）；改期先占新时隙再释放旧时隙，失败保持原预约。
16. 运输：节点时间单调；承运商接受后改派需显式撤销；POD 未确认不得进入结算。
17. 计费：事实不可覆盖只能更正；费率按业务发生时点匹配；重算生成新版本；计算行不得重复入账；期间关闭后禁普通修改。

### 前端（设计书 §4）
18. 所有列表页复用 `packages/ui` 的 QueryPanel + DataGrid（服务端分页/排序/列配置/保存视图）；所有动作经统一 Action Registry（权限 + 状态条件 + 确认文案），禁止在页面内散写权限判断。
19. 布局：深色窄侧栏 + 顶部租户/组织/仓库上下文栏 + 多标签工作区 + 右侧详情抽屉；状态色与状态词典全局统一。
20. 品牌名、logo、图标、插画、文案自创，禁止使用"科箭/360scm/Power"等目标产品的品牌资产或复制其 CSS/截图。
21. 异步动作立即返回 jobId 并在列表显示进度；错误用统一错误模型（code/message/fieldErrors/correlationId/retryable）。

### 安全
22. 后端每个命令按顺序校验：认证 → 资源权限(RBAC) → 数据范围(ABAC) → 状态机 → 业务规则，前端隐藏不是安全边界。
23. 所有请求携带并透传 `X-Correlation-Id`；日志结构化，含 tenantId/userId/businessRef/traceId。
24. 禁止在代码、测试、种子数据中写真实凭证；密钥一律走环境变量。

## 4. 完成定义（DoD，每张任务卡通用）

1. 实现任务卡列出的功能 ID 的后端命令/查询 + 前端页面（或明确标注 API-only）。
2. 单元测试覆盖：正常路径 + 每条状态机转换 + 权限拒绝 + 幂等重放；涉及库存/时隙的必须有并发测试（两事务竞争仅一方成功）。
3. `pnpm verify` 全绿；新增迁移可从零 `prisma migrate deploy` 成功。
4. 更新 `docs/BACKLOG.md` 勾选状态、`docs/CHANGELOG.md` 一行摘要。
5. Git 提交规范：`feat(wp-p2-15): 库存余额与预占 [WMS-INV-001..005]`，一个 WP 至少一次独立提交。

## 5. 工作流程（目标模式循环）

1. 读 `docs/BACKLOG.md`，取第一张未勾选且依赖已满足的任务卡。
2. 读该卡引用的设计书章节（`docs/design/`），列出实现清单后再动手。
3. 实现 → 测试 → `pnpm verify` → 勾选任务卡 → commit。
4. 循环。遇到以下情况停止并写 `docs/QUESTIONS.md`：需求歧义、需要外部凭证、需要人工决策、连续 3 次无法让 verify 通过。
5. 禁止：跳过测试、注释掉失败用例、为过检降低 lint/tsconfig 严格度、删除他人代码绕过冲突、擅自新增第三方重型依赖（>1 个新 runtime 依赖需在 QUESTIONS.md 说明理由）。

## 6. 常用命令

```bash
pnpm i                 # 安装
docker-compose up -d   # 本地基础设施
pnpm db:migrate        # prisma migrate dev
pnpm db:seed           # 种子数据（演示租户/用户/主数据）
pnpm dev               # web + api + worker
pnpm verify            # lint + typecheck + test（提交前必须绿）
pnpm test:e2e          # Playwright 验收场景
```

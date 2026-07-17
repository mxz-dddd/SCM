# UI 对标与 V2 运行闭环最终审计报告

## 审计边界

- 分支：`codex/frontend-parity`
- `main` baseline：`2ffe648820ce484e3ee3b6b09695f0a0f8820d54`
- 本轮目标起点：`6f242491bc964ea1a3924400f8e53ad30c543365`
- 已验证实现 HEAD：`4c1f0b3e93d88a7772e2aefb79d32d50d9726aad`
- 报告文档提交：本文件所在 `HEAD`；提交对象不能在自身内容中固定写入自己的 SHA，最终 SHA 以 Git 为准。
- Draft PR：https://github.com/mxz-dddd/SCM/pull/1
- 对比范围是 517 个参考业务叶子和 10 个目录视图的脱敏审计映射，以及 22 条代表性本地路由；不把参考取证数量表述成本地实现了 517 个页面。

## 完整提交范围

相对 `main` 共 27 个提交，分为 13 个 V2 运行时提交、6 个本轮开始前已有的 UI 对标提交、7 个本轮新增实现提交和 1 个本报告提交。

### V2 运行时提交（13）

1. `f3c1dbe2b9726ac4230174bef786954ea43cd49e` feat(wp-v2-01): 建立事件目录与消费语义 [V2-EVT-001..008]
2. `ba1e76d945838691ca5325c68468651e4da3e726` feat(wp-v2-02): 建立持久化事件投递账本 [V2-EVT-009..018]
3. `ca01e4c30cfa4b87d67f8da6963e431a0cdf8538` feat(wp-v2-03): 建立自动履约过程管理器 [V2-OMS-001..012]
4. `aac189a7264a36d2d034bb0c10214bdfddf0e8ab` feat(wp-v2-04): 建立多租户 Worker 身份 [V2-WRK-001..010]
5. `999a5a09b2819ed9e0dad4472e68e2c167742b2a` feat(wp-v2-05): 加固外部入口与 Webhook [V2-SEC-001..010]
6. `d3c6ebcbb4f4c9ca9a479ff4f2daf74f3043ff11` feat(wp-v2-06): 统一全域业务单号 [V2-NUM-001..010]
7. `8027160585c581e74b0cf38572901c412d2d24c2` feat(wp-v2-07): 建立多终端路由与原创令牌 [V2-WEB-001..012]
8. `eb9e2bc0928fe9fc0502610eb3c8f3c77c7cedcc` style(wp-v2-08): 恢复全仓格式化门禁
9. `9cbc7e36c7330ccd3552d9a3e841e387b29e7d18` feat(wp-v2-08): 建立真实运行闭环验收 [V2-E2E-001..011]
10. `5fd5dcf52220c481fa3cabb10b6c4ef1996823c4` fix(wp-v2-08): 稳定事件目录生成 [V2-EVT-019]
11. `fbc3d69fd53cb375db7c410835ff3cf6a0bbfa9d` fix(wp-v2-08): 隔离专用运行时验收 [V2-E2E-012]
12. `07ee022f96e3682d74b18add5a2c553ce26c35cd` fix(wp-v2-08): 固化生产就绪后台凭据 [V2-E2E-013]
13. `690f0507eabf29127f73b756d52054858d1258cd` feat(wp-v2-08): 完成运行闭环验收证据 [V2-OPS-001..010]

### 已有 UI 对标提交（6）

1. `5f65bb0779042e5d42bbb4dd733542d0b3f41808` chore(ui-parity): add read-only evidence tools
2. `74517fb59f68b4a10e6252bfbab38ed4b89c97cc` docs(ui-parity): record reference IA and feature matrix
3. `8a653efc5312d3ec6069c14fb8f27f23199ec0b4` feat(ui-parity): add hierarchical navigation and page templates
4. `76d165dc61dbc547b0ea1ba3b626c0aea986fe51` test(ui-parity): isolate acceptance worker port
5. `e05f3590cb3b78743216c2439cf48a637ab24763` docs(ui-parity): correct parity totals
6. `6f242491bc964ea1a3924400f8e53ad30c543365` feat(ui-parity): complete reference audit and split transport views

### 本轮新增实现提交（7）

1. `b347394ef4a6917feae3e3a2e33f85023984088f` feat(ui-parity): resolve audited long-tail navigation families
2. `09a45ba2bd55af18a9df59bd2b4cce9d5a886b5b` test(ui-parity): add redacted evidence and visual gates
3. `19f21fc21687a347a7dda3d0aaf727ec2aff3863` docs(ui-parity): correct audited scope and status totals
4. `5f65ba57bc310770085fa89b6d7e043871b7da1c` fix(ui-parity): make clean CI gates reproducible
5. `e5ec69e01cbadd5d10bd29c58cabea3d236a63f3` test(ui-parity): stabilize cross-platform CI evidence
6. `a1ddd97de6f13149fcc0077fcdb18ab79216eb6c` test(ui-parity): validate platform-specific baselines
7. `4c1f0b3e93d88a7772e2aefb79d32d50d9726aad` test(ui-parity): adopt reviewed runner baselines

本报告本身构成第 27 个提交，其 SHA 以最终分支 `HEAD` 为准；完整 SHA 清单使用 `git log main..HEAD` 读取，避免自引用改变提交对象标识。

## Catalog 审计

- 业务叶子：517
- 目录视图：10
- 总记录：527
- 校验结果：有效；`referenceId` 唯一、每条均有截图 SHA-256 和明确状态。
- 状态：IMPLEMENTED 78、PARTIAL 365、MISSING 0、NOT_APPLICABLE 81、BLOCKED 3。
- IMPLEMENTED 同时具备路由、组件、API 和测试证据；PARTIAL 均有非空差距原因。

## 五个原 PARTIAL 功能族

- WMS：建立任务、WES、绩效、规则、设备五个稳定子入口，均绑定现有仓储功能与 API，没有空白占位页。
- MDM：按货品、伙伴、地域、运力、车队、费用、组织、附件、综合设置形成业务组；专有且本地不存在的能力保留 NOT_APPLICABLE。
- 报表：新增原创报表中心、主题分组、我的报表、模板管理信息架构，复用真实 BI、结算与运营数据。
- 系统支持：新增原创帮助中心 Shell，连接仓库用户手册、运维手册、API 文档和版本说明，不复制参考站文章或品牌信息。
- 数据大屏：新增大屏管理、分组、我的大屏、地图配置稳定入口，复用 Control Tower/BI 能力，不使用静态假图冒充功能。

## 布局与视觉差异

- 22 条本地映射路由均通过结构门禁；应用壳主要区域位置差异最大 8px，主要组件尺寸差异最大 4%，字号差异 2px，未解释的大块结构差异为 0。
- 结构得分范围 63.42–74.33；遮罩后图像差异范围 8.35%–94.26%。高图像差异保留在 `featureGap` 与 `explainedDifferences` 中，不能据此宣称参考页面已像素级复刻。
- 18 个视觉场景分别保留经审查的 Darwin 与 GitHub Linux Runner baseline，Playwright 最大差异像素比例仍为 0.5%，没有放宽阈值。
- 当前全部页面均为第 1 轮，`previousScore = null`，因此本报告不宣称“视觉已经收敛”。

| 本地路由 | 轮次 | 当前分 | 通过 | 未通过原因 |
| --- | ---: | ---: | --- | --- |
| /mdm/attachments | 1 | 72.03 | 是 | 无 |
| /mdm/capacity | 1 | 71.98 | 是 | 无 |
| /mdm/charges | 1 | 71.93 | 是 | 无 |
| /mdm/organizations | 1 | 71.89 | 是 | 无 |
| /mdm/partners | 1 | 71.99 | 是 | 无 |
| /mdm/products | 1 | 71.98 | 是 | 无 |
| /mdm/regions | 1 | 71.99 | 是 | 无 |
| /mdm/settings | 1 | 71.84 | 是 | 无 |
| /oms/fulfillment-processes | 1 | 63.42 | 是 | 无 |
| /oms/orders | 1 | 63.42 | 是 | 无 |
| /platform/events | 1 | 74.33 | 是 | 无 |
| /reports/center | 1 | 69.51 | 是 | 无 |
| /screens/manage | 1 | 68.00 | 是 | 无 |
| /support/help | 1 | 73.27 | 是 | 无 |
| /tms/execution | 1 | 72.51 | 是 | 无 |
| /tms/orders | 1 | 72.63 | 是 | 无 |
| /tms/planning | 1 | 72.49 | 是 | 无 |
| /tms/settlement | 1 | 72.16 | 是 | 无 |
| /wms/inbounds | 1 | 72.20 | 是 | 无 |
| /wms/inventory | 1 | 71.50 | 是 | 无 |
| /wms/operations/tasks | 1 | 72.21 | 是 | 无 |
| /wms/outbounds | 1 | 71.96 | 是 | 无 |

## 本地门禁结果

| 命令 | 真实结果 |
| --- | --- |
| `pnpm format:check` | PASS |
| `pnpm db:migrate:deploy` | PASS，82 个迁移可从空库部署 |
| `pnpm migration:safety` | PASS |
| `pnpm verify` | PASS；API 388、Web 40、Worker 31 等仓库测试通过 |
| `pnpm build` | PASS，5/5 workspace build |
| `pnpm test:e2e` | PASS |
| `pnpm test:p3-e2e` | PASS |
| `pnpm test:p4-e2e` | PASS |
| `pnpm test:p5-readiness` | PASS |
| `pnpm test:v2-e2e` | PASS，5 个测试、11 个场景、82 个迁移 |
| `pnpm test:ui-reference` | PASS，527 条 Catalog、9/9 路由测试 |
| `pnpm test:visual` | PASS，3/3 Playwright 测试、18 个视觉场景 |
| `pnpm test:ui-parity` | PASS，22/22 布局映射与视觉回归通过 |
| `pnpm audit --prod --audit-level high` | PASS；0 High/Critical，4 Moderate |
| `git diff --check` | PASS |
| `docker compose config` | PASS |
| `git status --short` | 仅保留用户既有未提交后端、Vite、CHANGELOG、package.json 与演示文档改动；本轮提交文件无未提交残留 |

## GitHub Actions

运行：https://github.com/mxz-dddd/SCM/actions/runs/29559264648

| Job | 结果 |
| --- | --- |
| verify | SUCCESS |
| v2-runtime-e2e | SUCCESS |
| optimizer-image | SUCCESS |
| production-readiness | SUCCESS |
| ui-parity | SUCCESS |

## 数据与凭据边界

提交内容只包含脱敏结构指标、哈希、映射证据和本地视觉 baseline。参考站原始截图、Cookie、Token、用户名/密码、HAR、HTML 和业务数据均未提交。

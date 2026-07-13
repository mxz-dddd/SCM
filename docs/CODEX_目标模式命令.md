# Codex 目标模式执行命令

目标模式 = 非交互自主执行：给 Codex 一个目标，它按 `AGENTS.md` 守则 + `docs/BACKLOG.md` 任务卡循环工作，直到阶段完成或遇到需要人工决策的阻塞。

## 0. 一次性准备

```bash
# 1. 安装并登录 Codex CLI
npm i -g @openai/codex && codex login

# 2. 初始化仓库并放置驱动文件
mkdir scm-cloud && cd scm-cloud && git init
#    AGENTS.md          → 仓库根目录（Codex 自动读取）
#    docs/PLAN.md       → SCM_项目实现计划书_v1.0.md 改名放入
#    docs/BACKLOG.md    → 任务卡
#    docs/design/       → 设计说明书 docx/pdf 转出的 md + Mermaid 图源 + 图源包解压后的 .dot/.svg
git add -A && git commit -m "chore: 项目驱动文件基线"
```

> Flag 以你安装版本的 `codex --help` 为准（CLI 迭代较快）。沙箱建议 `workspace-write`：允许改仓库、禁碰仓库外文件；`--full-auto` 等价于 workspace-write + 自动批准。

## 1. 主命令（目标模式主循环，核心交付）

```bash
codex exec --full-auto --cd . "$(cat <<'EOF'
你是本仓库的执行工程师，严格遵守 AGENTS.md（技术栈冻结、硬性规则、DoD、禁止事项）。
目标：推进 docs/BACKLOG.md 中【当前阶段】的任务卡，直到全部完成或遇到阻塞。

循环执行：
1. 读 docs/BACKLOG.md，找到第一张未勾选、非〔人工〕、依赖已满足的任务卡。
2. 读任务卡引用的功能 ID 在 docs/design/ 设计说明书 §6 中的规格（处理规则/输入输出/状态机），以及 §9 状态不变量、§11 API 与事件约定；先在心中列出实现清单再动手。
3. 实现后端命令/查询 + 前端页面 + 测试（正常路径、每条状态转换、权限拒绝、幂等重放；库存/时隙类必须加并发测试）。
4. 运行 pnpm verify，全绿后：勾选该任务卡、在 docs/CHANGELOG.md 追加一行、git commit（格式：feat(wp-xx): 摘要 [功能ID]）。
5. 回到第 1 步。

停止条件（停止时把原因和建议写入 docs/QUESTIONS.md 并 commit）：
- 需求歧义或需要人工决策；
- 需要外部凭证/服务（短信、地图 key 等）；
- 同一任务连续 3 次无法让 pnpm verify 通过；
- 当前阶段任务卡已全部完成（此时运行该阶段验收卡并输出验收报告）。

绝对禁止：跳过或删除测试、降低 lint/tsc 严格度、跨模块访问他域内部表、修改 AGENTS.md、引入未声明的重型依赖。
EOF
)"
```

用法：把 BACKLOG 中想执行的阶段之前的卡都勾掉（或已完成），Codex 即从该阶段开始。每次运行处理若干张卡后退出，反复执行同一命令即可持续推进（配合下方 §4 循环脚本可无人值守）。

## 2. 阶段命令（限定范围的变体）

只跑某一阶段时，在主命令的「目标」行替换为：

```text
目标：只处理 docs/BACKLOG.md 中 P1 平台骨架 章节的任务卡，其他章节不得改动。
```

首次启动建议先单独执行 P1-01 脚手架卡，人工确认目录结构后再放开主循环：

```bash
codex exec --full-auto "按 AGENTS.md 与 docs/BACKLOG.md 中 P1-01 任务卡初始化 Monorepo。只做这一张卡：pnpm workspaces + Turborepo 四包结构、ESLint/Prettier/strict tsconfig、Vitest、docker-compose(pg16/redis7/minio)、GitHub Actions CI、pnpm verify 脚本。完成后勾选 P1-01 并 commit，然后停止。"
```

## 3. 单任务 / 验收 / 修复命令

```bash
# 指定单卡（人工想盯紧的关键聚合：库存、时隙、计费）
codex exec --full-auto "只执行 docs/BACKLOG.md 中 P2-15 库存核心任务卡，严守 AGENTS.md 不变量 13：available=onHand-allocated-hold、流水不可变、乐观锁防超卖，必须包含两事务并发预占仅一方成功的测试。完成勾选并 commit 后停止。"

# 阶段验收
codex exec --full-auto "运行 pnpm test:e2e 中 P2 验收场景①③，逐个修复失败直到全绿，输出验收报告到 docs/reports/P2-acceptance.md 并 commit。"

# 修复 QUESTIONS 决策后继续
codex exec --full-auto "docs/QUESTIONS.md 中的问题我已批注答复。按答复更新实现，然后继续主循环推进 BACKLOG。"
```

## 4. 无人值守循环脚本（可选）

```bash
#!/usr/bin/env bash
# run_codex_loop.sh — 反复调用目标模式，直到阶段完成或出现待决策问题
set -e
while true; do
  codex exec --full-auto --cd . "$(cat docs/prompts/main-loop.md)"   # 主命令提示词存为文件
  git pull --rebase 2>/dev/null || true
  # 出现未答复的 QUESTIONS 或阶段完成标记则退出
  if grep -q "## 待人工决策" docs/QUESTIONS.md 2>/dev/null; then echo "有问题待决策，停止"; break; fi
  if ! grep -q "^- \[ \]" docs/BACKLOG.md; then echo "BACKLOG 全部完成"; break; fi
  sleep 5
done
```

## 5. 云端 Codex（chatgpt.com/codex）变体

仓库推到 GitHub 并连接后，新建任务粘贴主命令引号内的提示词即可；云端每个任务产出一个 PR，适合按「一张任务卡 = 一个任务 = 一个 PR」的粒度并行跑 P2-05~P2-11 这类互相独立的卡。

## 6. 人工检查点（不要全托管）

| 时机 | 动作 |
|---|---|
| P1-01 完成后 | 确认目录结构与 verify 门禁，再放开主循环 |
| 每张关键聚合卡（P2-15、P3-12、P4-02） | 人工 review 并发测试与不变量实现 |
| 每阶段验收卡 | 人工跑通六大验收场景，签字进下一阶段 |
| QUESTIONS.md 有新条目 | 及时答复，否则循环停摆 |
| 每周 | `git log --oneline` 抽查提交质量，防止 Codex 静默降低标准 |

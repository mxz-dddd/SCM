# Questions

## 已解决

### V2-05 / V2-07：两个窄职责运行时依赖（2026-07-16 已按改造指令授权）

- `helmet@8.1.0` 维护 API 安全响应头，`react-router-dom` 在 V2-07 提供 Browser Router 与深链恢复。
- 改造指令明确授权这两个 runtime dependency；理由与边界记录于 `docs/adr/ADR-0001-v2-runtime-dependencies.md`。不引入其他平行框架或重型运行时，继续执行目标模式。

### P5-05 / AI-001：OR-Tools 运行时方案（2026-07-15 已解决）

- 任务卡明确要求车辆路径优化使用 OR-Tools，并在时间窗、容量、司机工时、路况和成本约束下保存结果与解释。
- 当前 Node/Nest 冻结栈及 `pnpm-lock.yaml` 中没有 OR-Tools；现有 P3 路径优化只生成三组候选序列并评分，不是 OR-Tools 约束求解器，直接复用不能满足任务卡。
- 引入 Python/Java OR-Tools sidecar、Node 原生绑定或外部求解服务都属于新增重型运行时或平行技术方案，未经授权会违反 `AGENTS.md` 的技术栈冻结与“禁止擅自新增重型依赖”。外部服务方案还需要地址和凭证。

- 人工决策：授权方案 1，使用 Python OR-Tools sidecar、固定镜像和窄 JSON 接口。
- 实施边界：sidecar 无数据库、租户、凭证和外呼能力；仅接收路径/装载约束快照并返回可行性、分配、约束判定、目标值和解释。NestJS 控制域持有异步作业、状态机、RBAC/ABAC、幂等、审计、Outbox 和不可变结果。
- 依赖固定：基础镜像锁定 `python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7`，OR-Tools 锁定 `9.14.6206`，传递依赖全部精确版本固定。该授权同时解决 `AGENTS.md` 对重型运行时和多个传递依赖的人工决策要求。

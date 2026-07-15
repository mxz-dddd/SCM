# 灰度发布与数据库迁移

## 发布门禁

Release 进入 `VALIDATED` 前必须同时具备：`pnpm verify`、镜像漏洞扫描和迁移安全检查通过证据。镜像以 digest 发布，不使用浮动标签。灰度从 5% 流量开始，观察错误率、P95、队列积压、任务延迟和业务 SLA；超出错误预算立即回滚。

## Expand / Migrate / Contract

1. **Expand**：只增加向后兼容的表、列和索引；大表索引用在线策略，禁止高峰期持有大表锁。
2. **Migrate**：双读校验、分批回填、限速并记录游标；每批做数量、金额、状态校验。
3. **Contract**：确认旧版本实例与消费者全部退出后再删除旧结构；SQL 必须标注 `-- phase: contract` 和 `-- contract-approved: true`。

迁移 SQL 通过 `pnpm migration:safety -- <files...>` 检查。任一阶段失败先停止推进；应用回滚保持对 expand 后结构兼容，数据回滚使用已验证快照或补偿迁移，不覆盖审计/流水。

## 灰度与回滚记录

- Canary evidence：流量比例、开始/结束时间、技术指标、业务指标和负责人。
- Rollback evidence：原因、触发阈值、回滚 digest、数据兼容判断和完成时间。
- `ROLLED_OUT` 后仍保留回滚窗口；Contract 只能在窗口关闭且旧读者为零时执行。

# 备份、恢复与容灾演练

## 目标

- PostgreSQL：连续 WAL 归档 + 定期基础备份，支持 PITR。
- 对象存储：业务桶启用版本控制，备份清单复制到异地区域。
- 默认生产目标：RPO 15 分钟、RTO 60 分钟；租户可在 `OpsBackupSet` 上收紧目标。
- 故障切换必须先取得唯一写入栅栏；任何时刻不得让主、备两侧同时写入。

## 备份

1. 确认 `archive_mode=on`、WAL 归档目录可写，且异地复制延迟低于 RPO。
2. 以只读环境变量提供 `DATABASE_URL` 和 `BACKUP_DIRECTORY`，执行 `scripts/ops/create-base-backup.sh`。
3. 将 `backup_manifest`、校验和、WAL 连续性、对象版本清单及异地复制证明登记为 `BackupSet` artifact，不记录凭证。
4. 只有基础备份、WAL、对象版本和跨区域副本均校验通过，才把备份转为 `VERIFIED`。

## PITR 恢复

1. 在隔离网络创建空白 PostgreSQL 16 实例，停止业务写入。
2. 恢复最近基础备份，配置 `restore_command`，设置 `recovery_target_time`，启动恢复。
3. 恢复对象版本到隔离桶；禁止复用生产写凭证。
4. 用 `scripts/ops/verify-restore.sh` 验证连接和预先登记的 schema 清单，再做订单数、金额、状态抽样对账。

## 演练与切换

1. 用已验证 BackupSet 创建 DR Drill；exercise 必须记录 RPO/RTO 观测值和 `secondaryWriterEnabled=false`。
2. 切换前冻结旧主写入口，取得带租约的 `singleWriterFence`；确认队列消费者和定时任务只在新主启动。
3. 恢复 API、Worker、对象存储和外部回调，验证业务与技术告警。
4. 任一目标超限或发现双写风险，演练记为 `FAILED`，回切到旧主并保留证据。

## 演练频率

- 每月做一次隔离恢复；每季度做一次完整区域切换。
- 报告必须包含恢复点、实际 RPO/RTO、数据对账、单写栅栏、告警时间线和改进责任人。

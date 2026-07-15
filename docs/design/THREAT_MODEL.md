# SCM V2 入口威胁模型

| 信任边界 | 主要威胁 | 控制与证据 |
| --- | --- | --- |
| Browser/Partner → API | CORS 越权、超大 body、伪造代理 IP、错误泄密 | 明确 CORS allowlist、Helmet、全局 body 上限、显式 trust proxy、统一无 stack 错误、correlation id |
| Login → Identity | 凭据填充、多实例绕过本地限流 | IP+tenant+username PostgreSQL 原子桶、账号锁定、LoginAudit |
| User API → Domain | 热点滥用、跨租户 actor 混桶 | tenant+actor+matched route 原子高水位桶；认证、RBAC、ABAC 顺序不变 |
| Partner → External API | 伪造 method/path/size、HMAC 重放、凭据/IP/scope/quota 绕过 | 真实 Request 派生属性、原始 body hash、恒时摘要校验、持久化签名单次表、策略/凭据双层校验、GatewayLog/RateLimitDecision |
| API/Worker → Webhook | localhost/metadata SSRF、DNS rebinding、redirect 绕过、慢响应/大响应 | 创建及投递双重 DNS 校验、公共 IP allow-only、连接固定 IP、TLS hostname 校验、默认不跟随 redirect、超时与 64 KiB 上限 |

剩余风险：上游可信反向代理错误配置会影响 remote IP 与代理终止的 mTLS 指纹；因此相关环境变量默认关闭并纳入部署变更评审。公网目标在连接后可能代理到其内部网络，该风险需由目标方控制，SCM 不发送自身云凭据且不读取代理环境变量。

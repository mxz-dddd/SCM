# 入口与 Webhook 安全运行手册

## API 启动基线

- 生产 `CORS_ALLOWED_ORIGINS` 必须是逗号分隔的明确 HTTPS origin，不允许 `*`；凭据模式保持开启。
- `API_JSON_BODY_LIMIT` 默认 `1mb`，`API_URLENCODED_BODY_LIMIT` 默认 `64kb`。附件使用对象存储预签名上传，不提高 API 全局 body 上限。
- `TRUST_PROXY` 默认关闭。只有入口代理固定、能够覆盖并清洗 `Forwarded`/`X-Forwarded-*` 时才配置 hop 数或子网。`TRUST_CLIENT_CERT_HEADER=true` 仅可与该可信代理配套使用。
- `LOGIN_RATE_LIMIT_PER_MINUTE` 默认 10；普通用户 API 按 tenant+actor+route 默认 600/分钟。计数在 PostgreSQL 原子递增，多实例不使用本地内存。
- `/health`、API 与 Worker 都保留 `X-Correlation-Id`；未处理异常只向客户端返回统一错误，不返回 stack。

## 外部 Gateway

生产 `/api/v1/external/**`（token 签发和已弃用的管理员诊断接口除外）由全局 `ExternalGatewayGuard` 保护。Guard 只信任服务端观察到的 method、规范化 pathname、remote IP、原始 body byte/hash 和 correlation id，忽略客户端伪造的 route/method/size 字段。

凭据约定：

- OAuth2：`Authorization: Bearer <access-token>`；
- API Key：`X-SCM-Key-Id` + `X-SCM-API-Secret`；
- HMAC：`X-SCM-Key-Id` + `X-SCM-Timestamp` + `X-SCM-Signature`，签名串为 `timestamp\nMETHOD\nPATH\nraw-body-sha256`；签名五分钟有效且只能使用一次；
- mTLS：优先读取已通过 TLS 验证的 peer certificate。代理终止 TLS 时才启用受信证书指纹头。

`POST /api/v1/external/gateway/authorize` 仅保留为需 `integration.gateway.manage` 的管理员诊断接口，响应带 `Deprecation`/`Sunset`，不得作为生产调用前置安全边界。

## Webhook 出站

订阅创建和每次领取投递都会解析 DNS 并拒绝 localhost、私网、link-local、CGNAT、multicast、reserved、IPv4-mapped 私网及云 metadata 地址。Worker 再次解析并只允许 HTTPS，通过自定义 `lookup` 把连接固定到已验证公共 IP，同时保留原 hostname 的 SNI/证书校验；不使用代理环境变量，不跟随 redirect，连接超时 5 秒、总超时 15 秒、响应体最大 64 KiB。

告警处置：`WEBHOOK_ENDPOINT_FORBIDDEN` 表示 endpoint 或 DNS 已不安全；保持订阅/attempt 证据，不绕过策略。DNS 污染或凭据泄漏时暂停订阅、轮换密钥并按 correlation id 审计 GatewayLog/DeliveryAttempt。

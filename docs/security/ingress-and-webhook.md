# 外部入口与 Webhook 安全边界

本文是 V2 的安全边界说明；部署参数和告警处置同时参见 [入口安全运行手册](../runbooks/entry-security.md)。

## 入站请求

- API 启用 Helmet、显式 CORS allowlist、JSON/urlencoded body 上限和统一 correlation id。`TRUST_PROXY` 默认关闭，只能在固定且会清洗转发头的代理后启用。
- 登录与普通 API 通过 PostgreSQL 原子计数限流，多实例共享同一决策；客户端提供的 IP、route、method 或 requestBytes 不作为安全事实。
- `/api/v1/external/**` 由全局 Gateway Guard 保护。method、规范化 pathname、remote IP、raw body bytes/hash 均由服务端真实请求派生。
- OAuth2、API Key、HMAC、mTLS 各自校验凭据状态、租户、作用域、IP、请求大小和分钟/日/敏感配额。HMAC 签名覆盖 timestamp、method、path 和 raw-body SHA-256，五分钟有效且持久化单次使用。
- 管理员 gateway authorize 端点仅用于受 RBAC 保护的诊断并带弃用头，不是外部请求的前置授权通道。

## Webhook 出站 SSRF 防护

订阅创建和每次投递前都必须验证目标；创建时安全不代表后续 DNS 仍安全。

1. 仅接受 HTTPS，拒绝 URL 凭据、非标准解析结果和 redirect。
2. 解析目标全部 A/AAAA 地址，拒绝 loopback、私网、link-local、CGNAT、multicast、reserved、IPv4-mapped 私网和云 metadata。
3. Worker 在投递时再次解析，把 socket 固定到已经验证的公共 IP，同时使用原 hostname 做 SNI 和证书主机名校验，防 DNS rebinding。
4. 不读取代理环境变量；限制连接超时、总超时和响应体，避免慢连接与无限响应耗尽资源。
5. 每次 attempt 保留目标、状态、错误和 correlation id；失败采用有界退避，耗尽后死信。

## 发布与事件响应检查

- 运行 Gateway 真实请求配额、HMAC 重放、伪造 method/path/size、私网/metadata/IPv6/DNS rebinding、302 私网和大响应测试。
- 对 `WEBHOOK_ENDPOINT_FORBIDDEN` 不得临时放宽 CIDR 或关闭再次解析；暂停订阅并确认 DNS、证书及接收方所有权。
- 凭据泄露时先吊销/轮换，再按 GatewayLog、RateLimitDecision、DeliveryAttempt 与 correlation id 确定影响面。
- 代理或网络拓扑变化必须重新评审可信 hop、客户端证书头和 egress；禁止把 `TRUST_PROXY` 或证书指纹头全局信任。

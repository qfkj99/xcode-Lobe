# 多父站嵌入与域名迁移

`NEW_API_PUBLIC_URL` 保留当前主站，`NEW_API_ADDITIONAL_PARENT_ORIGINS` 配置其他父站，
例如 `https://xcodebest.com`。仅支持完整 HTTP(S) origin，不能使用通配符、路径、用户信息或查询参数。
桥接页及聊天响应的 CSP 使用同一白名单；握手只接收实际父窗口的白名单 origin，
完成消息只返回发起握手的那个父站。不得改为 `postMessage('*')` 或 `frame-ancestors *`。

HTTPS 桥接和 Better Auth Cookie 均使用 `Secure; HttpOnly; SameSite=None; Partitioned`，
让不同根域名下的 iframe 可以维持登录，同时按顶层网站隔离会话。
桥接 Cookie 名升级为 `newapi.bridge.v2` / `newapi.flow.v2`，Better Auth prefix
增加 `-bridge-v2`，避免旧的非分区同名 Cookie 遮蔽新 Cookie。
升级后用户重新打开网页聊天会自动重新握手；账号绑定、历史对话、文件和数据库保持不变。
HTTP 本地开发仍使用 Lax 非 Secure Cookie；普通非桥接部署不改变 Cookie 策略。
浏览器必须支持分区 Cookie；限制第三方嵌入的浏览器仍须实际验收，不能只靠服务端 200 判断成功。

## 验证

```sh
node --test .github/scripts/newapi-multisite-regression.test.mjs
node --test deploy/lobehub/compose.test.mjs
```

还需在真实浏览器分别从两父站完成握手、加载已有历史、发送消息并刷新。
确认未授权 origin 无法嵌入或交换 ticket，退出主站后聊天授权失效。
升级只重建应用服务，保留 PostgreSQL、Redis、对象存储卷与所有秘密值。

## 旧域名退役前的必做事项

1. 先为聊天、对象存储和其他相关服务配置新域名、TLS、DNS、CDN与回源规则。
2. 将 `APP_URL` / `LOBE_PUBLIC_URL` 改为新聊天域名，并同步 New API 网页聊天 URL。
   `NEW_API_INTERNAL_URL` 应指向可靠内网服务或已迁移域名，不能继续依赖待过期的旧域名。
3. 主站切换时更新 `NEW_API_PUBLIC_URL`、父站白名单、New API ServerAddress、
   OAuth 回调/退出地址、支付 notify/webhook、邮件与媒体 URL、Turnstile 和存储 CORS。
4. 保持原数据库、AUTH_SECRET、KEY_VAULTS_SECRET、桥接 secret 与账号 subject（New API 用户 ID），
   避免“换域名”变成新账号或无法解密历史数据。
5. Passkey 不能跨无关根域名自动迁移。提前引导用户在新站绑定 Passkey，并启用 2FA/恢复方式。
6. 搜索数据库内已保存的旧图片/附件/分享地址，明确迁移或保留重定向期。域名过期后无法再提供重定向。
7. 停用前从白名单、OAuth 与支付配置中移除旧域名，防止被他人注册后成为受信任来源。
   在隔离环境阻断所有旧域名访问，复验登录、聊天、上传下载、支付和密码重置，再决定不续费。

本次共存修复不执行主站迁移，旧域名仍须保持有效。

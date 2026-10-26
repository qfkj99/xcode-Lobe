# Xcode Lobe 独立服务器部署

本仓库是 LobeHub v2.2.20 的 New API 网页聊天适配版，上游基线为
`49204982cab98bfa2f2fb6831a34d5018a2af6be`。聊天界面、会话和文件存储沿用
LobeHub，登录身份、可用分组和模型、额度与计费由已接入的 New API 提供。

本目录可以独立构建和部署，不需要把 New API 仓库放在同一台服务器。
New API 服务本身必须先部署包含 `/api/lobe/*` 和网页聊天设置页的版本。
官方原版 LobeHub 镜像没有这些适配，不能替代本仓库构建的镜像。

## 1. 准备服务器和域名

需要 Linux、Git、Node.js 24，以及支持 BuildKit 命名构建上下文和
`docker compose up --wait` 的 Docker Engine、Buildx 与 Compose V2。
已验证的镜像平台是 `linux/amd64`，其他架构需要另外构建与验证。

资源建议是部署预算，不是压测得出的最低规格：

| 场景 | 建议起步配置 | 依据与限制 |
| --- | --- | --- |
| 在这台服务器从源码构建并运行 | 4 vCPU、16 GiB 内存、80 GiB SSD | 上游构建允许 Node 使用 8 GiB 堆，还需要依赖安装和 Docker 构建空间；不要同时运行其他大型构建 |
| 镜像在别处构建，只运行服务 | 4 vCPU、8 GiB 内存、至少 50 GiB SSD | 本 Compose 的 PostgreSQL、Redis、对象存储内存上限合计约 2.25 GiB，Lobe 和系统另需空间；用户数和附件量增加时扩容 |

未验证 2 核 2 GiB 等低配机器能稳定运行。SSD 建议不含长期附件和备份增长。
模型推理发生在 New API 的上游服务，这台机器不需要 GPU。

下面使用三个域名：

| 地址 | 指向 | 用途 |
| --- | --- | --- |
| `https://api.example.com` | 已有 New API 服务器 | 用户登录的网站和控制台 |
| `https://chat.example.com` | 新 Lobe 服务器 | 内嵌聊天 |
| `https://files.example.com` | 新 Lobe 服务器 | 浏览器直传附件与短期签名下载 |

`chat` 和 `files` 的 DNS A/AAAA 记录应指向新服务器。网站与聊天必须使用
同一个站点下的 HTTPS 域名，例如上述 `api.example.com` 和
`chat.example.com`；两者可以在不同服务器。当前桥接 Cookie 是
`HttpOnly; SameSite=Lax`，HTTPS 时加 `Secure`，不设置共享 Domain。
把网站和聊天放在两个不同的主域名下，会导致 iframe 中 Cookie 无法按当前设计工作。

服务器只需对外开放反向代理的 80/443。Compose 中 Lobe 的 3210 和对象存储的
9000 只绑定 `127.0.0.1`；PostgreSQL 和 Redis 不发布宿主机端口。

## 2. 克隆代码并初始化运行目录

以下示例以有权管理 `/srv` 和 Docker 的部署账户执行。先确认所用账户能执行
`docker info`，以及 `/srv/xcode` 存在且可写。

```sh
mkdir -p /srv/xcode
git clone https://github.com/qfkj99/xcode-Lobe.git /srv/xcode/xcode-Lobe
cd /srv/xcode/xcode-Lobe
node deploy/lobehub/init-runtime.mjs /srv/xcode/lobe-runtime
```

`lobe-runtime` 必须尚不存在。初始化器只创建这个新目录，POSIX 下目录权限为
`0700`，清单权限为 `0600`。运行目录在 Git 仓库外，用于保存环境变量和生成的
Dockerfile，不能提交到 Git，也不能作为 Docker 构建上下文。

本仓库已经包含适配代码。不要再运行 New API 仓库的
`integrations/lobehub/prepare-lobehub.mjs`：该工具是给原始上游 checkout 打补丁，
要求 HEAD 恰好等于上游基线，会拒绝本仓库自己的提交。

## 3. 生成并填写环境配置

完整字段示例见 [lobehub.env.example](lobehub.env.example)。下面的命令为首次部署
生成独立随机密钥，只写入权限为 `0600` 的新文件，不在终端打印密钥；文件已存在时拒绝覆盖。
先把三个域名替换成实际值。

```sh
cd /srv/xcode/xcode-Lobe
export LOBE_BUILD_TAG="xcode-lobe:$(git rev-parse --short=12 HEAD)"
node --input-type=module <<'NODE'
import fs from 'node:fs';
import crypto from 'node:crypto';
const hex = () => crypto.randomBytes(32).toString('hex');
const settings = {
  COMPOSE_PROJECT_NAME: 'xcode-lobe',
  LOBE_IMAGE: process.env.LOBE_BUILD_TAG,
  LOBE_PUBLIC_URL: 'https://chat.example.com',
  NEW_API_PUBLIC_URL: 'https://api.example.com',
  NEW_API_INTERNAL_URL: 'https://api.example.com',
  S3_ENDPOINT: 'https://files.example.com',
  NEW_API_CHAT_BRIDGE_SECRET: hex(),
  POSTGRES_PASSWORD: hex(),
  AUTH_SECRET: hex(),
  KEY_VAULTS_SECRET: crypto.randomBytes(32).toString('base64'),
  S3_ACCESS_KEY_ID: 'lobehub',
  S3_SECRET_ACCESS_KEY: hex(),
};
fs.writeFileSync('/srv/xcode/lobe-runtime/lobehub.env',
  Object.entries(settings).map(([key, value]) => `${key}=${value}`).join('\n') + '\n',
  { mode: 0o600, flag: 'wx' });
NODE
```

配置含义：

- `LOBE_PUBLIC_URL`：用户浏览器访问的聊天 HTTPS 源地址，仅协议、主机和可选端口，不带路径。
- `NEW_API_PUBLIC_URL`：控制台的准确源地址，必须与实际登录网站一致，不能混用带 `www` 与不带 `www` 的地址。它决定允许内嵌的父页面源。
- `NEW_API_INTERNAL_URL`：Lobe 容器访问 New API 的地址。可以与公开地址相同，也可以使用受保护的内网地址；远程 New API 不能写成 `localhost`。桥接和模型请求都要能从容器到达该地址，不能经过交互登录页或重定向。
- `S3_ENDPOINT`：浏览器可访问的对象存储 HTTPS 源地址。容器内部访问另用 Compose 已设定的 `http://storage:9000`。
- `NEW_API_CHAT_BRIDGE_SECRET`：两端唯一需要相等的共享密钥，稍后填入 New API 网页聊天设置。使用至少 32 个无空白的可见 ASCII 字符，以上随机 hex 满足要求。
- `AUTH_SECRET`：Lobe 登录及加密桥接 Cookie 使用的独立密钥，不要与共享密钥复用。
- `KEY_VAULTS_SECRET`：恰好 32 个随机字节的 Base64 编码。上面的生成方式满足 AES-256 长度要求。
- PostgreSQL 和 S3 密码也各自独立。更新服务时保留这些值；不要重新运行密钥生成命令覆盖已有环境文件。

不要为该集成设置 OpenAI、Claude 等供应商 API Key。用户的模型请求经 New API
受控路由，不从 Lobe 使用个人或统一供应商密钥绕开计费。

## 4. 构建固定依赖的镜像

```sh
cd /srv/xcode/xcode-Lobe
node --test deploy/lobehub/prepare-build.test.mjs
node deploy/lobehub/prepare-build.mjs "$PWD" /srv/xcode/lobe-runtime 0.36.0
docker build \
  --build-context integration=deploy/lobehub \
  --file /srv/xcode/lobe-runtime/Dockerfile.lobehub \
  --tag "$LOBE_BUILD_TAG" \
  .
```

如果换了终端，先重新设置与环境文件 `LOBE_IMAGE` 相同的 `LOBE_BUILD_TAG`。
首次构建需要访问镜像仓库和依赖源，耗时取决于网络和机器性能。

这里必须用生成的 Dockerfile 和 `--build-context integration=deploy/lobehub`。
只运行仓库根目录原始 `docker build .` 不会应用已验证的构建修复：上游默认关闭
root lockfile，原 Dockerfile 还有浮动依赖安装。本目录固定了 Node/BusyBox 镜像、
Corepack `0.36.0`、根 pnpm `12.4.1`、运行时 pnpm `12.14.0`，并校验锁文件哈希。
`standard-openapi` 的可选 Zod v3 转换器安装在独立目录，不替换应用的 Zod v4。

`prepare-build.mjs` 读取当前 fork 的 Dockerfile，检查预期构建结构和锁文件，
可以接受包含适配提交的本仓库；它不要求 fork 的 HEAD 等于上游基线。
不要把其 `--reuse-dependencies` 开关用于全新服务器，除非已经按同一锁文件构建了
对应的依赖镜像。常规完整构建不依赖本地历史镜像或任何 New API 容器。

## 5. 配置 HTTPS 反向代理

以下是安装在宿主机上的 Nginx 示例。证书须覆盖对应域名，示例证书路径需替换。
`map` 应位于 Nginx 的 `http` 上下文；放在该上下文包含的 `conf.d/*.conf` 中即可。
如果 Nginx 运行在另一容器内，`127.0.0.1` 指向该容器自身，不能直接照抄上游地址。

```nginx
map $http_upgrade $lobe_connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name chat.example.com files.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name chat.example.com;
    ssl_certificate /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;
    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:3210;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $lobe_connection_upgrade;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}

server {
    listen 443 ssl;
    server_name files.example.com;
    ssl_certificate /etc/letsencrypt/live/files.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/files.example.com/privkey.pem;
    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
    }
}
```

检查并加载配置：`nginx -t`，通过后 `systemctl reload nginx`。
不要在聊天域名上额外添加 `X-Frame-Options: DENY/SAMEORIGIN`，也不要追加拒绝父站的
`Content-Security-Policy`。适配层已经返回精确的
`frame-ancestors https://api.example.com`。保留 `Set-Cookie`，不要缓存认证页面或接口。

文件域名代理必须保留原始 Host、路径与查询串，不要改写为 `/s3/` 等子路径，
否则 S3 签名会失效。不要额外添加通配符 CORS 或公开读策略。初始化任务会创建私有
`lobehub` bucket，并只允许聊天源的上传/读取 CORS。反代的 `100m` 是传输上限示例，
不改变模型请求中私有多媒体的 20 MiB 总内联限制。

## 6. 启动独立服务

```sh
cd /srv/xcode/xcode-Lobe
docker compose --env-file /srv/xcode/lobe-runtime/lobehub.env \
  -f deploy/lobehub/compose.yml config --quiet
docker compose --env-file /srv/xcode/lobe-runtime/lobehub.env \
  -f deploy/lobehub/compose.yml pull postgresql redis storage storage-init
docker compose --env-file /srv/xcode/lobe-runtime/lobehub.env \
  -f deploy/lobehub/compose.yml up -d --wait
docker compose --env-file /srv/xcode/lobe-runtime/lobehub.env \
  -f deploy/lobehub/compose.yml ps
```

这里仅使用 `compose.yml`。不需要原开发机器的 Docker 网络、MySQL、Redis或容器名，
也不需要 New API 的本地容器捕获、替换、恢复脚本。

服务包含 Lobe、PostgreSQL/pgvector、Redis、RustFS 和一次性 `storage-init`。
`storage-init` 成功后为退出状态是正常的；其余服务应健康。Lobe 启动器会执行数据库迁移。
它的健康检查预期匿名访问根路径返回 `401`，不是匿名开放聊天，也不是部署失败。

## 7. 在 New API 控制台启用

用 New API 的 root 管理员登录，进入：

**系统设置 → 站点与品牌 → 网页聊天**，路由 `/system-settings/site/web-chat`。

填写 LobeHub 地址 `https://chat.example.com`，从私有环境文件安全取得
`NEW_API_CHAT_BRIDGE_SECRET` 的值填入桥接密钥，打开网页聊天并保存。
URL 只能是源地址，不能包含账号密码、路径、查询或片段。

第一次保存前可显示 New API 的 `LOBE_PUBLIC_URL`、`LOBE_BRIDGE_SECRET` 环境回退值。
保存后以数据库配置为准；密钥输入留空表示保留，不会清除。关闭开关不会回退到环境变量。
保存对当前 New API 实例立即生效，其他实例通过现有选项同步更新，默认周期 60 秒。
公开部署不要开启开发专用 `LOBE_ALLOW_HTTP`。

用户之后从控制台左侧 **聊天 → 游乐场下方的网页聊天** 进入，无需注册 Lobe 账户或填 API Key。
浏览器直接匿名打开聊天域名出现 `401` 符合设计。

## 8. 验证部署

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://chat.example.com/
curl -sS -D - -o /dev/null https://chat.example.com/newapi/bridge
```

第一条应为 `401`；第二条桥接页面应可访问，并含允许实际父站的 `frame-ancestors`。
外部证书、DNS或代理配置仍需用浏览器验证，`healthy` 不能代替已登录验收。

用专门测试账户检查从 New API 正常进入、先分组再模型的选择菜单、刷新后历史仍在、
上传附件可预览，以及网站退出后聊天不能继续请求。发送对话会按 New API 实际渠道计费；
如需零费用验收，应先建立仅测试账号可用的本地 mock 渠道，不要拿普通用户账户试发。

本集成聚焦网页聊天。外部客户端、公开分享、后台 Agent、工作流/Webhook、独立搜索与知识处理
服务没有随此 Compose 开启。不要直接套用上游完整平台的功能说明承诺这些能力。

## 9. 持久化、更新与回退

使用上面的固定项目名时，持久数据在 Docker 卷中：

| Compose 卷 | 数据 |
| --- | --- |
| `postgres-data` | Lobe 用户映射、会话、消息、模型配置与文件元数据 |
| `redis-data` | Redis 持久数据 |
| `storage-data` | 附件对象 |

实际卷名带 `COMPOSE_PROJECT_NAME` 前缀。更新时保留项目名、环境文件和三类卷。
不要运行 `docker compose down -v`。普通重新构建/重建容器不应删除数据卷。
备份应包含 PostgreSQL、对象存储、Redis及私有环境文件，并保存所用代码提交和镜像 ID。
数据备份需要一致性策略；不要把运行中数据库目录的随手复制当成已验证备份。

更新前备份；拉取并确认需要部署的提交，按第 4 节重新构建一个新的提交号镜像标签，
只修改私有环境文件中的 `LOBE_IMAGE`，然后运行：

```sh
docker compose --env-file /srv/xcode/lobe-runtime/lobehub.env \
  -f deploy/lobehub/compose.yml up -d --no-deps --force-recreate --wait lobe
```

保留旧镜像。只有确认数据库迁移向后兼容，才可把 `LOBE_IMAGE` 改回旧标签并用同一命令回退；
否则需要按备份恢复数据库和对象存储。不要在普通镜像回退时删除现有卷。

修改域名或对象存储凭据时，还要检查反代、两端地址和 bucket CORS；不能只重建 Lobe。
轮换桥接密钥必须同时更新 New API 网页聊天设置和 Lobe 环境文件，再重建 Lobe 服务，
两端不一致期间聊天会拒绝请求。不要顺带重新生成 `KEY_VAULTS_SECRET` 或其他持久密钥。

本仓库保留上游许可与声明。构建、修改和分发时一并保留这些文件。

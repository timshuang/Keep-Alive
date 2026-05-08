# Keepalive

通过 Hubstudio 指纹浏览器的 CDP 能力，对 Twitter、Discord、Gmail 等账号执行轻量保活，降低长期不活跃带来的风控和二次验证风险。

当前正式运行模型：

- 单服务 `keepalive`
- 单进程内同时承载保活主循环和本地管理页
- 使用 PM2 托管
- 管理页默认监听 `3210`

## 推荐部署

当前推荐正式部署在：

- `WSL` 中运行 `keepalive`
- `Windows 宿主机` 继续运行 `Hubstudio + 指纹环境 + Connector`

这样可以把 Node 服务放在 WSL 中统一管理，同时继续使用宿主机 Windows 的图形化指纹环境。

## WSL 一键安装

在 WSL 任意目录执行：

```bash
curl -fsSL https://raw.githubusercontent.com/timshuang/Keep-Alive/master/install.sh | bash
```

这一步只做：

- 创建并使用 `~/apps/keepalive`
- clone 或复用已有仓库
- 预检 `git`、`curl`、`node`、`npm`、`pm2`
- 将 Node.js 安装或升级到 `22.x`
- 初始化 `.env` 与 `accounts.json`
- 预检 WSL 到宿主机 Hubstudio Connector 的连通性

这一步不会做任何交互输入，也不会卡在 `read`。

## 第二步：进入目录做轻交互配置

```bash
cd ~/apps/keepalive
bash install.sh
```

这一步会：

- 显示当前状态摘要
- 必填 `TG_BOT_TOKEN`
- 必填 `TG_CHAT_ID`
- 可选填写 `TG_API_PROXY`
- 提示你手工编辑 `accounts.json`
- 最后询问是否立即执行启动

> `accounts.json` 不走终端逐项录入，保持手工编辑。

> `.env` 采用纯 `KEY=value` 格式，注释请单独成行，不要写成 `KEY=value # comment`。

## 正式启动默认策略

如果在交互末尾选择立即启动，脚本会执行：

```bash
npm install
npm run build
ADMIN_HOST=127.0.0.1 npm run pm2:start
```

默认使用 `127.0.0.1`，优先保证安全性。

先在 Windows 宿主机验证：

```bash
http://localhost:3210/health
```

如果宿主机访问不到，再考虑改为：

```bash
ADMIN_HOST=0.0.0.0 npm run pm2:restart
```

注意：

- `0.0.0.0` 会扩大监听范围
- 仅在 localhost 转发不可用时使用
- 建议结合宿主机防火墙限制访问来源

## WSL 部署原则

### 1. 部署目录

正式部署目录应放在 WSL 原生 Linux 文件系统中，例如：

```bash
~/apps/keepalive
```

不要放在：

```bash
/mnt/c/...
```

原因：

- `/mnt` 挂载目录的 I/O 和权限表现更差
- PM2、日志和状态文件在原生 WSL 文件系统中更稳定

### 2. Hubstudio 访问方式

`config.jsonc` 中默认仍可写：

```json
{
  "hub": {
    "host": "127.0.0.1",
    "port": 6873
  }
}
```

当程序运行在 WSL 中时，[src/config.ts](/F:/Projects2026/codex/Keepalive/src/config.ts) 会自动：

- 检测当前是否为 WSL
- 从 `/etc/resolv.conf` 读取 Windows 宿主机 IP
- 将 `127.0.0.1` 替换为宿主机可访问 IP

如果目标 WSL 网络模式下自动探测失效，再将 `hub.host` 手动改成宿主机实际可达 IP。

## 当前需要配置的内容

### 必填

- `.env` 中的 `TG_BOT_TOKEN`
- `.env` 中的 `TG_CHAT_ID`
- `accounts.json`

### 可选

- `.env` 中的 `TG_API_PROXY`
- `.env` 中的 `RESEND_API_KEY`
- `.env` 中的 `ALERT_EMAIL`

### 高级配置

默认不进入首次交互，需要时再手工调整：

- `config.jsonc` 中的 `hub.host` / `hub.port`
- `intervals`
- `jitter`
- `scheduling`
- `browse`

## 管理页

管理页用于：

- 管理本地账号配置和保活渠道
- 查看运行时状态
- 手动执行“立刻重补今日任务”

常用地址：

- 健康检查：`/health`
- 账号管理页：`/accounts`
- 运行时状态：`/api/runtime-status`

## 常用命令

```bash
npm run build
npm run pm2:start
npm run pm2:restart
npm run pm2:stop
npm run pm2:logs
```

## 日常测试

开发或迁移验证时，建议先用少量账号测试：

```bash
node dist/index.js --test --filter 001,002 --force
```

也可以按范围：

```bash
node dist/index.js --test --filter 001-005 --force
```

或按 `containerCode`：

```bash
node dist/index.js --test --filter 1221370654 --force
```

## CLI 参数

| 参数 | 说明 |
|------|------|
| `--test` | 跳过每日随机启动延迟，立即进入当次执行流程 |
| `--filter <value>` | 仅执行指定账号，支持 `001,002`、`001-005`、`containerCode` |
| `--force` | 忽略到期判断、今日已执行判断和异常状态限制 |
| `--reset` | 删除 `state.json` 并重置运行状态后退出 |

## Hubstudio 关键前提

### 1. 已开启环境再次调用 `browser/start`

如果要在“环境已打开”的情况下仍然拿到 `debuggingPort`，需要 Hubstudio 侧已开通对应权限。否则可能返回：

```text
-10013
```

### 2. 客户端版本

如果需要 GUI 客户端与 API 同时工作，Hubstudio 客户端版本需满足：

```text
>= V3.35.0
```

## 迁移到 WSL 时的验证顺序

1. WSL 内 `node -v` / `npm -v` / `pm2 -v`
2. 执行 `curl -fsSL ... | bash`
3. 进入 `~/apps/keepalive` 执行 `bash install.sh`
4. 宿主机打开 `http://localhost:3210/health`
5. 用 `--test --filter ... --force` 验证少量账号
6. 验证管理页的“立刻重补今日任务”

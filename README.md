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

### 3. 管理页访问方式

WSL 中建议用：

```bash
ADMIN_HOST=0.0.0.0
```

这样 Windows 宿主机优先可通过：

```bash
http://localhost:3210
```

访问管理页；若宿主机到 WSL 的 localhost 转发不可用，再改用 WSL IP。

## 环境预检要求

WSL 正式部署前必须先检查：

- `node`
- `npm`
- `pm2`

处理规则：

- `node` 不存在：安装 `Node.js 22.x`
- `node` 已存在但主版本不是 `22`：升级到 `22.x`
- `npm` 缺失：补装
- `pm2` 缺失：全局安装
- 已满足要求：跳过，不重复安装

仓库内的 [install.sh](/F:/Projects2026/codex/Keepalive/install.sh) 已按这套规则更新。

## 快速安装

在 WSL 中执行：

```bash
bash install.sh
```

脚本会：

- 检查并安装 `git`、`curl`
- 预检 `node` / `npm` / `pm2`
- 将 Node.js 安装或升级到 `22.x`
- 初始化 `.env` 与 `accounts.json`
- 预检 WSL 到宿主机 Hubstudio Connector 的连通性

## 正式启动

### 1. 安装依赖并构建

```bash
npm install
npm run build
```

### 2. 用 PM2 启动

```bash
ADMIN_HOST=0.0.0.0 npm run pm2:start
```

常用命令：

```bash
npm run pm2:restart
npm run pm2:stop
npm run pm2:logs
```

### 3. 健康检查

```bash
http://localhost:3210/health
```

## 管理页

管理页用于：

- 管理本地账号配置和保活渠道
- 查看运行时状态
- 手动执行“立刻重补今日任务”

常用地址：

- 健康检查：`/health`
- 账号管理页：`/accounts`
- 运行时状态：`/api/runtime-status`

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

建议按下面顺序验证：

1. WSL 内 `node -v` / `npm -v` / `pm2 -v`
2. WSL 内访问 Hubstudio Connector
3. `npm install` / `npm run build`
4. `ADMIN_HOST=0.0.0.0 npm run pm2:start`
5. 宿主机打开 `http://localhost:3210/health`
6. 用 `--test --filter ... --force` 验证少量账号
7. 验证管理页的“立刻重补今日任务”


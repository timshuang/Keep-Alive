# Keepalive Windows 部署指南

这份文档对应的是 Windows 正式运行方案，也是当前推荐的生产部署方式。

## 适用场景

如果你希望 keepalive 真正控制 Hubstudio 指纹浏览器，请把下面这些都运行在同一台 Windows 主机上：

- Hubstudio GUI
- 指纹环境
- Hubstudio Connector
- `keepalive`

不建议把 WSL 当作正式浏览器自动化运行时。WSL 往往能访问 Connector API，但 Hubstudio 返回的 DevTools 端口通常只绑定在 Windows `127.0.0.1`，这会导致 WSL 无法通过 CDP 接管浏览器。

## 前置条件

请先安装：

- Git
- Node.js
- npm
- PM2：`npm install -g pm2`

同时确认：

- Hubstudio Connector 正在 `127.0.0.1:6873` 监听；如果不是，请先修改 [`config.jsonc`](F:\Projects2026\codex\Keepalive\config.jsonc)
- 如果需要 GUI 与 API 同时工作，Hubstudio 客户端版本应满足要求
- Windows 安装脚本会按默认地址 `127.0.0.1:6873` 做预检；如果你的 Connector 不在这个地址，请先安装，再手动修改 `config.jsonc`

## 一键部署

如果你已经拿到了仓库目录，请在 `cmd.exe` 中进入项目目录后执行：

```bat
install-windows.bat
```

如果你想从仓库外直接开始，可以先单独下载 `install-windows.bat`，把它放到你想作为安装根目录的文件夹中，然后双击运行。脚本会自动创建：

```text
install-windows.bat 所在目录\apps
```

并把项目 clone 到：

```text
install-windows.bat 所在目录\apps\keepalive
```

脚本会自动完成：

- 复用现有 keepalive 仓库，或在脚本所在目录下创建 `apps\keepalive`
- 校验 `git`、`node`、`npm`、`pm2`
- 检查 Node.js 与 npm 是否可用
- 缺失时初始化 `.env` 和 `accounts.json`
- 提示填写 `TG_BOT_TOKEN`
- 提示填写 `TG_CHAT_ID`
- 可选填写 `TG_API_PROXY`
- 预检 Hubstudio Connector API 连通性
- 执行 `npm install`
- 执行 `npm run build`
- 用 `ADMIN_HOST=127.0.0.1` 启动 PM2

## 必填文件

首次正式运行前，仍然需要把真实配置补齐。

`.env` 中必填：

- `TG_BOT_TOKEN`
- `TG_CHAT_ID`

可选：

- `TG_API_PROXY`
- `RESEND_API_KEY`
- `ALERT_EMAIL`

`accounts.json` 需要满足：

- 把 [`accounts.json.example`](F:\Projects2026\codex\Keepalive\accounts.json.example) 里的示例账号替换掉
- 保持为非空 JSON 数组
- 每个账号都要包含 `containerCode`、`containerName`、`platforms`
- 如果运行安装脚本时提示 `accounts.json` 未配置好，先编辑这个文件，再在脚本里选择重试即可

## 启动与 PM2

脚本默认使用下面的方式启动：

```bat
set "ADMIN_HOST=127.0.0.1" && npm run pm2:start
```

常用命令：

```bat
npm run pm2:start
npm run pm2:restart
npm run pm2:stop
npm run pm2:logs
```

健康检查：

```text
http://127.0.0.1:3210/health
```

如果你需要让管理页不只监听 localhost，再按需改成：

```bat
set "ADMIN_HOST=0.0.0.0" && npm run pm2:restart
```

## 实时日志

这个项目使用仓库内自己的 PM2 上下文，所以不要优先用全局裸命令 `pm2 logs`，而应优先使用项目命令。

推荐：

```bat
npm run pm2:logs
```

直接查看日志文件：

```bat
type logs\pm2\keepalive.out.log
type logs\pm2\keepalive.err.log
type logs\keepalive-YYYY-MM-DD.log
```

PowerShell 实时跟随示例：

```powershell
Get-Content .\logs\pm2\keepalive.out.log -Wait -Tail 50
Get-Content .\logs\pm2\keepalive.err.log -Wait -Tail 50
Get-Content .\logs\keepalive-2026-05-09.log -Wait -Tail 50
```

## 常见问题

### `pm2 logs` 看不到日志

这个仓库通过 [`scripts/pm2-runner.js`](F:\Projects2026\codex\Keepalive\scripts\pm2-runner.js) 重定向了 `PM2_HOME`。直接执行全局 `pm2 logs` 时，你很可能看的不是这个项目自己的 PM2 实例。

请改用：

```bat
npm run pm2:logs
```

### Hubstudio 返回 `-10013`

这表示环境已经打开，但 Hubstudio 还需要具备“环境已打开时再次返回 `debuggingPort`”的权限。

### CDP 连接失败，出现 `Unexpected status 400`，或访问 `/json/version` 没响应

如果 Windows 本机可以访问：

```text
http://127.0.0.1:<debuggingPort>/json/version
```

但其他运行时访问不了，那基本就说明 DevTools 端口只绑定在 Windows localhost。此时应把 keepalive 正式运行在 Windows，而不是 WSL。

### 管理页访问不到

先优先使用 `ADMIN_HOST=127.0.0.1`。只有在确实需要对外监听时，再切到 `0.0.0.0`，并配合 Windows 防火墙限制来源。

## 仓库说明

- [`install-windows.bat`](F:\Projects2026\codex\Keepalive\install-windows.bat) 是 Windows 正式部署入口
- [`install.sh`](F:\Projects2026\codex\Keepalive\install.sh) 仍保留在仓库中，适合历史或开发辅助场景，但不再作为推荐的正式生产安装脚本

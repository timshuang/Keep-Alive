# Keepalive 项目交接文档

## 1. 项目概述

**目标**：对"撸毛三件套"（Twitter、Discord、Gmail）账号进行自动保活，防止长期不活跃被平台要求手机验证（手机号为一次性接码，无法恢复）。核心需求：以后用指纹浏览器登录时不再触发验证。

**核心思路**：通过 Hubstudio 指纹浏览器的 CDP 协议连接已打开的 profile，新建标签页访问平台 → 等待加载 → 检测是否被锁 → 关闭新标签页。**绝对不关其他页面，绝对不关指纹环境**。

**保活方式**：三平台全走浏览器 CDP 保活（不用 HTTP/cookie 方案，因为 HTTP 保活无法维持"设备信任"，只维持"账号活跃"，两者是不同的）。

---

## 2. 架构与模块说明

```
Keepalive/
├── src/
│   ├── index.ts          # 主入口（--test 模式 + 预检 + 随机延迟 + 调度 + 日报）
│   ├── config.ts          # .env 加载 + 校验 + 类型定义（含 TG_API_PROXY）
│   ├── logger.ts          # 日志系统（文件 + 控制台 + ANSI 颜色，不用 chalk）
│   ├── state.ts           # state.json 读写 + 类型定义
│   ├── scheduler.ts       # 调度算法（stagger + jitter + dailyQueue + 重启确定性）
│   ├── notifier.ts        # TG Bot 通知（HTML <pre> 日报 + 命令监听）+ 邮件告警
│   ├── cdp.ts             # Playwright CDP 连接封装（只关新建标签页）
│   ├── detector.ts        # 三平台验证页面检测
│   ├── hub/
│   │   ├── types.ts       # Hubstudio API 完整类型定义
│   │   └── client.ts      # Hubstudio API 封装（start, stop, all-browser-status, env/list, ensureEnvOpen, getOpenedContainerCodes）
│   └── actions/
│       ├── index.ts       # 导出
│       └── gmail.ts       # 三平台保活动作（keepaliveGmail, keepaliveTwitter, keepaliveDiscord）
├── scripts/
│   ├── watchdog.sh        # 进程守护脚本（检测程序死亡 → TG + 邮件通知 + 自动重启）
│   └── setup-cron.sh      # crontab 安装脚本
├── README.md               # Hubstudio API 接口说明 + 踩坑记录
├── package.json
├── tsconfig.json
├── .gitignore             # 含 state.json, .env, accounts.json
├── .env.example           # 配置模板
├── .env                   # 实际配置（gitignore）
├── accounts.json.example  # 账号模板
├── accounts.json          # 48个账号数据（gitignore）
└── state.json             # 运行状态（程序自动维护，gitignore）
```

### 关键模块职责

| 模块 | 职责 |
|------|------|
| `config.ts` | 加载 .env，校验必填项，导出类型安全的配置对象 |
| `hub/client.ts` | 封装 Hubstudio API 调用：启动/停止环境、查询状态、批量获取已开环境（getOpenedContainerCodes）、确保环境打开 |
| `cdp.ts` | 通过 CDP 连接已打开的指纹浏览器，新建标签页执行操作后只关闭新标签页 |
| `detector.ts` | 检测 Gmail/Twitter/Discord 是否弹出验证页面 |
| `actions/gmail.ts` | 三平台保活的具体动作：打开 URL → 等待加载 → 检测验证 → 关闭标签 |
| `scheduler.ts` | 调度算法：各平台独立判断到期，stagger 分散首次运行，dailyQueue 缓存保证重启确定性 |
| `notifier.ts` | TG Bot 发送 HTML `<pre>` 格式状态表、告警、日报；监听 /reset /set /status /reboot 命令 |
| `state.ts` | 读写 state.json：每个账号每个平台的 lastRun 时间戳 |
| `index.ts` | 主流程：预检（批量对比已开环境） → 随机延迟 → 调度循环 → 日报 |

---

## 3. 运行流程

```
启动 → 解析 --test 参数
  → 预检（调一次 all-browser-status，与 accounts.json 对比，未开则报错停止 + 发 TG，不主动启动环境）
  → 随机延迟（精确到分钟，--test 跳过）
  → 调度循环
      → 计算今日待保活队列（dailyQueue）
      → 依次执行保活（CDP 连接 → 打开URL → 等待 → 检测 → 关标签）
      → 检测到验证 → 标记 verification_required → 跳过后续保活
      → 全部完成 → 发送日报
  → 等待下一周期
```

---

## 4. 配置说明

### .env 字段

| 字段 | 说明 |
|------|------|
| `HUB_APP_ID` | Hubstudio 应用 ID |
| `HUB_GROUP_CODE` | Hubstudio 分组代码 |
| `HUB_CONNECTOR_PATH` | hubstudio_connector.exe 路径 |
| `HUB_CONNECTOR_PORT` | Connector HTTP 端口，默认 6873 |
| `TG_BOT_TOKEN` | Telegram Bot Token |
| `TG_CHAT_ID` | Telegram 通知目标 Chat ID |
| `TG_API_PROXY` | TG API 代理地址，如 `http://127.0.0.1:52022` |
| `ALERT_EMAIL` | 告警邮件接收地址（可选） |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | 邮件 SMTP 配置（可选） |

### accounts.json 格式

```json
{
  "accounts": [
    {
      "name": "001-日常",
      "containerCode": "abc123",
      "platforms": ["gmail", "twitter", "discord"]
    }
  ]
}
```

- 当前 48 个账号：001-018 日常撸毛 + 1001-1030 肉鸡
- `containerCode` 已通过 Hubstudio `/api/v1/env/list` API 验证正确

---

## 5. 调度算法

### 保活间隔

| 平台 | 间隔 | 抖动范围 |
|------|------|----------|
| Gmail | 3 天 | ±1 天 |
| Twitter | 7 天 | ±2 天 |
| Discord | 30 天 | ±5 天 |

### 首次运行（stagger 算法）

通过 `state.json` 是否存在 + `lastRun` 是否全空判断首次运行。

首次运行时，为避免所有账号同时保活，使用 stagger 分散：
```
lastRun = now - (accountIndex % intervalDays) * 86400秒
```

### dailyQueue 缓存

每日计算出待保活队列后缓存到 state.json，保证程序中途被杀重启后：
- 已完成的账号不重复执行
- 未完成的账号继续执行

### Jitter 随机抖动

每次保活的时间点精确到分钟级别，不固定整点启动，增加随机性。

---

## 6. Hubstudio API 要点

### Connector 启动

```bash
hubstudio_connector.exe --server_mode=http --http_port=6873 --app_id=xxx --group_code=xxx
```

### 关键 API

| API | 方法 | 说明 |
|-----|------|------|
| `/api/v1/browser/start` | POST | 启动环境，已打开的也能返回 debuggingPort（需客服开通权限） |
| `/api/v1/browser/stop` | POST | 停止环境 |
| `/api/v1/browser/all-browser-status` | POST | 查询所有环境状态（传空 containerCodes 查全部，status: 0=已开启 1=开启中 2=关闭中 3=已关闭） |
| `/api/v1/env/list` | POST | 获取环境列表，**必须 POST + Content-Type: application/json + body `{"current":1,"size":200}`** |

### 踩坑

- `/api/v1/env/list` 用 GET 会返回空，必须 POST + JSON body
- 已打开的环境调用 `/api/v1/browser/start` 也能返回 debuggingPort（需联系客服开通权限）
- containerCode 以 API 返回为准，YAML 里的可能过时
- API 与客户端同时运行需 Hub V3.35.0 及以上客户端版本

### 预检机制（V2 迭代）

预检阶段**只做检查不主动启动环境**：
1. 调一次 `all-browser-status` 获取所有已开环境的 containerCode 集合
2. 与 accounts.json 中的 containerCode 逐一对比
3. 已开 → OK，未开 → 标记失败
4. 任一未开则停止程序 + 发 TG 通知

好处：48 个账号只需 1 次 API 调用即可完成预检，且不会因低配机器自动开环境导致资源不足。

---

## 7. 踩坑记录 / Discoveries

1. **accounts.json 的 containerCode**：用户原始 YAML 里的 containerCode 很多是错的，必须通过 `/api/v1/env/list` API 获取真实数据验证
2. **CDP 连接报错 "Target page, context or browser has been closed"**：是用户手动关了页面导致，不是代码 bug
3. **Node.js 在 Windows 上比 curl 更适合调 Hubstudio API**：curl 的 JSON 转义在 PowerShell 下有问题，Node.js http 模块直接发请求更可靠
4. **TG API 需要走代理**：用户网络无法直连 TG API，需通过 `TG_API_PROXY=http://127.0.0.1:52022`
5. **HTTP 保活 vs CDP 保活**：HTTP 保活无法维持"设备信任"，只维持"账号活跃"，两者是不同的。必须用 CDP 浏览器方式保活
6. **Token 消耗**：build 模式下大量文件读写 + 长日志输出消耗 token 很快，建议大改动在 plan 模式确认，测试输出重定向到文件
7. **已开环境调用 browser/start 返回 debuggingPort 需客服开通权限**：默认已开环境再调 start 会报错 -10013，开通权限后才能获取 debuggingPort
8. **API 与客户端同时运行需 V3.35.0+**：低于此版本的客户端无法在打开 GUI 的同时通过 API 操作环境

---

## 8. 已完成事项

1. ✅ 项目初始化：package.json, tsconfig, .gitignore, accounts.json.example, .env.example
2. ✅ config.ts：.env 加载 + 校验 + 类型（含 TG_API_PROXY）
3. ✅ logger.ts：日志（文件 + 控制台 + ANSI 颜色）
4. ✅ hub/types.ts：Hubstudio API 完整类型定义
5. ✅ hub/client.ts：Hubstudio API 封装（start, stop, all-browser-status, env/list, ensureEnvOpen, getOpenedContainerCodes）
6. ✅ state.ts：state.json 读写 + 类型
7. ✅ cdp.ts：Playwright CDP 连接（只关新建标签页）
8. ✅ detector.ts：三平台验证页面检测
9. ✅ actions/gmail.ts：三平台保活动作（CDP → 打开URL → 等待 → 检测 → 关标签）
10. ✅ notifier.ts：TG Bot + HTML `<pre>` 日报 + 命令监听（/reset, /set email, /status, /reboot）+ 邮件告警
11. ✅ scheduler.ts：调度算法（stagger + jitter + dailyQueue）
12. ✅ index.ts：主入口（--test 模式 + 批量预检 + 随机延迟 + 调度 + 日报）
13. ✅ scripts/watchdog.sh + setup-cron.sh
14. ✅ 编译通过，零错误
15. ✅ 首次运行测试：48/48 预检全部成功，保活阶段因手动关页面中断（非代码问题）
16. ✅ V2 迭代：预检逻辑优化（批量对比已开环境，不主动启动），清理 exportCookie，新增 README.md（Hub API 接口说明）

---

## 9. 待办 / 已知问题

- [ ] accounts.json 中部分账号的 platforms 配置需要用户确认（如肉鸡组哪些有 Gmail）
- [ ] Gmail 保活可能需要更高频率（Google 对 IP 变化最敏感）
- [ ] 需要在 WSL2 中部署运行（当前在 Windows 测试）
- [ ] 异常账号标记 `verification_required` 后只能通过 TG /reset 命令重置，暂无自动恢复机制

---

## 10. 部署指南

### 环境要求

- Node.js 18+
- WSL2 + tmux
- Hubstudio 指纹浏览器 + connector
- 可用的 TG API 代理

### 步骤

```bash
# 1. 安装依赖
npm install

# 2. 编译
npx tsc

# 3. 配置
cp .env.example .env
# 编辑 .env 填入实际值
cp accounts.json.example accounts.json
# 编辑 accounts.json 填入账号数据

# 4. 启动 connector（如果未运行）
hubstudio_connector.exe --server_mode=http --http_port=6873 --app_id=xxx --group_code=xxx

# 5. 运行（测试模式，跳过随机延迟）
node dist/index.js --test

# 6. 正式运行
node dist/index.js

# 7. tmux 后台运行
tmux new -s keepalive
node dist/index.js
# Ctrl+B D 分离

# 8. 安装 watchdog crontab
bash scripts/setup-cron.sh
```

### watchdog 说明

- `scripts/watchdog.sh` 定期检测 keepalive 进程是否存活
- 进程死亡 → 发送 TG 通知 + 邮件告警 + 自动重启
- 通过 crontab 每 5 分钟执行一次

---

## 11. TG Bot 命令

| 命令 | 说明 |
|------|------|
| `/status` | 查看所有账号当前保活状态 |
| `/reset <containerCode> [platform]` | 重置异常账号标记（verification_required） |
| `/set email <containerCode> <email>` | 为指定账号设置告警邮箱 |
| `/reboot` | 重启保活程序 |

### 通知格式

日报和状态查询使用 HTML `<pre>` 块格式表格：

```
┌──────────┬─────────┬─────────┬─────────┐
│ 账号      │ Gmail   │ Twitter │ Discord │
├──────────┼─────────┼─────────┼─────────┤
│ 001-日常  │ ✅ 1d   │ ✅ 3d   │ ⚠️ 25d  │
│ 002-日常  │ 🔒 锁定 │ ✅ 5d   │ ✅ 10d  │
└──────────┴─────────┴─────────┴─────────┘
```

---

## 12. 重要约束

- **绝对不关其他页面**：CDP 操作只关闭新建的标签页，不影响用户已打开的页面
- **绝对不关指纹环境**：保活完成后不关闭/停止指纹浏览器环境
- **预检只检查不启动**：V2 起预检阶段不主动启动未开的环境，只报告哪些未开，由用户手动处理
- **所有修改必须先经过用户同意**：不能擅自改代码
- **敏感文件不入 Git**：.env, accounts.json, state.json 均在 .gitignore 中

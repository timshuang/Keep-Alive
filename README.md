# Keepalive

对"撸毛三件套"（Twitter、Discord、Gmail）账号进行自动保活，防止长期不活跃被平台要求手机验证。通过 Hubstudio 指纹浏览器的 CDP 协议连接已打开的 profile，新建标签页访问平台 → 等待加载 → 检测是否被锁 → 关闭新标签页。

---

## 常用命令

### 开发测试

开发机性能有限，只需挑几个环境测试保活功能：

```bash
# 指定账号 + 跳过随机延迟 + 强制执行（忽略到期判断和异常状态）
node dist/index.js --test --filter 001,002 --force

# 按范围筛选
node dist/index.js --test --filter 001-005 --force

# 按 containerCode 筛选
node dist/index.js --test --filter 1221370654 --force

# 只筛选不强制（只跑到期账号）
node dist/index.js --test --filter 001,002
```

### 重置系统状态

状态混乱时一键重置，删除 `state.json` 后下次启动等同于首次运行：

```bash
node dist/index.js --reset
```

### 正式运行

```bash
# 编译
npx tsc

# 正式运行（全量 48 个账号，含随机延迟）
node dist/index.js
```

### CLI 参数说明

| 参数 | 说明 |
|------|------|
| `--test` | 跳过随机启动延迟（最长 720 分钟），快速进入保活流程 |
| `--filter <值>` | 筛选指定账号，支持按 containerName（如 `001`）或 containerCode（如 `1221370654`）匹配，支持逗号分隔和范围语法（如 `001-005`） |
| `--force` | 强制执行保活，忽略：① 到期判断（不管间隔是否到了）② 今日已跑判断 ③ dailyQueue 缓存 ④ 异常状态（自动重置 `verification_required` / `error` 为 `ok`） |
| `--reset` | 删除 `state.json`，重置所有运行状态，立即退出。下次启动为全新首次运行 |

> **组合使用**：`--test --filter 001,002 --force` 是开发测试最常用的组合，快速对指定账号执行保活，不受任何调度限制。

---

## Hubstudio API 接口说明

所有接口通过本地 Connector 提供，基础地址格式：`http://127.0.0.1:{HUB_CONNECTOR_PORT}`（默认 6873）。

### 1. 获取环境列表

```
POST /api/v1/env/list
```

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| current | number | 页码，从 1 开始 |
| size | number | 每页数量，建议 200 |

**请求示例：**

```json
{ "current": 1, "size": 200 }
```

**响应结构：**

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "total": 48,
    "list": [
      {
        "containerCode": 12345,
        "containerName": "001-日常",
        "proxyTypeName": "socks5",
        "proxyHost": "127.0.0.1",
        "proxyPort": 1080,
        "lastUsedIp": "1.2.3.4",
        "lastCountry": "US",
        "ua": "Mozilla/5.0 ...",
        "...": "其他字段省略"
      }
    ]
  }
}
```

> **必须用 POST + `Content-Type: application/json` + JSON body**，用 GET 会返回空列表。

---

### 2. 启动环境

```
POST /api/v1/browser/start
```

**请求参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| containerCode | string | 是 | 环境编码 |
| isHeadless | boolean | 否 | 是否无头模式 |
| args | string[] | 否 | 额外浏览器启动参数 |

**请求示例：**

```json
{ "containerCode": "abc123" }
```

**响应结构：**

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "debuggingPort": 9222,
    "action": "start",
    "statusCode": 0,
    "...": "其他字段省略"
  }
}
```

**关键行为：**

- 环境未开 → 启动并返回 `debuggingPort`
- 环境已开 → 需要客服开通权限后，也能返回 `debuggingPort`（见下方说明）
- 环境已开且无权限 → 返回错误码 `-10013`（`ENV_ALREADY_RUNNING`）

---

### 3. 停止环境

```
POST /api/v1/browser/stop
```

**请求参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| containerCode | string | 是 | 环境编码 |

**请求示例：**

```json
{ "containerCode": "abc123" }
```

**响应结构：**

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "action": "stop",
    "statusCode": 0
  }
}
```

> 本项目**不会主动调用此接口**停止环境，保活完成后只关闭新建标签页，不关指纹浏览器。

---

### 4. 查询所有环境状态

```
POST /api/v1/browser/all-browser-status
```

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| containerCodes | string[] | 要查询的环境编码列表，传空数组查询全部 |

**请求示例：**

```json
{ "containerCodes": [] }
```

**响应结构：**

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "containers": [
      { "containerCode": "abc123", "status": 0 },
      { "containerCode": "def456", "status": 3 }
    ]
  }
}
```

**status 取值：**

| 值 | 含义 |
|----|------|
| 0 | 已开启 |
| 1 | 开启中 |
| 2 | 关闭中 |
| 3 | 已关闭 |

> 传空 `containerCodes` 可一次性获取所有环境状态，用于预检批量判断哪些环境已开，无需逐个查询。

---

## 重要说明

### 已开环境调用 browser/start 需要开通权限

默认情况下，环境已开启时再次调用 `browser/start` 会返回错误码 `-10013`（`ENV_ALREADY_RUNNING`），**无法获取 `debuggingPort`**。

如果需要在环境已开的情况下获取 `debuggingPort`（本项目的核心需求），**必须联系 Hubstudio 客服开通此权限**。开通后，已开环境调用 `browser/start` 也会正常返回 `debuggingPort`。

### API 与客户端同时运行需 V3.35.0 及以上

如需 API 与 Hubstudio 客户端同时运行使用，**客户端版本需 ≥ V3.35.0**。低于此版本的客户端无法在打开 GUI 的同时通过 API 操作环境。

---

## 踩坑记录

| 问题 | 说明 |
|------|------|
| `env/list` 用 GET 返回空 | 必须用 POST + `Content-Type: application/json` + body `{"current":1,"size":200}` |
| containerCode 以 API 返回为准 | YAML 配置或手动记录的 containerCode 可能过时，以 `/api/v1/env/list` 返回为准 |
| 已开环境再调 start 的行为 | 未开通权限 → 报错 `-10013`；开通权限 → 正常返回 `debuggingPort` |
| Node.js 比 curl 更适合调 API | Windows PowerShell 下 curl 的 JSON 转义容易出错，Node.js `fetch`/`http` 模块更可靠 |
---

## PM2

```bash
# build dist/
npm run build

# start both keepalive-main and keepalive-admin
npm run pm2:start

# restart both apps
npm run pm2:restart

# stop both apps
npm run pm2:stop

# inspect recent logs
npm run pm2:logs
```

- `keepalive-admin` keeps listening on `127.0.0.1:3210`
- Health check: `http://127.0.0.1:3210/health`
- The project-level pm2 runner first tries `pm2` from `PATH`, then falls back to the current npm global prefix, which makes Windows and WSL migration easier.

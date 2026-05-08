# Keepalive

Keepalive 通过 Hubstudio 的 CDP 能力，对 Twitter、Discord、Gmail 等账号执行轻量保活。

## 推荐部署方式

当前推荐的正式运行环境是 Windows，而不是 WSL。

- Windows 正式部署请看 [README.windows.md](F:\Projects2026\codex\Keepalive\README.windows.md)
- Windows 部署入口脚本是 [install-windows.bat](F:\Projects2026\codex\Keepalive\install-windows.bat)
- [install.sh](F:\Projects2026\codex\Keepalive\install.sh) 仍保留在仓库中，适合历史或开发辅助场景，但不再作为推荐的正式生产安装脚本

调整原因：

- WSL 通常可以访问 Hubstudio Connector API
- 但 Hubstudio 返回的 DevTools 调试端口经常只绑定在 Windows `127.0.0.1`
- 这会导致 WSL 无法通过 CDP 接管指纹浏览器

## 常用命令

```bash
npm run build
npm run pm2:start
npm run pm2:restart
npm run pm2:stop
npm run pm2:logs
```

## 健康检查

```text
http://127.0.0.1:3210/health
```

## 小范围测试

```bash
node dist/index.js --test --filter 001,002 --force
node dist/index.js --test --filter 001-005 --force
node dist/index.js --test --filter 1221370654 --force
```

## Hubstudio 说明

- 如果 `browser/start` 返回 `-10013`，说明 Hubstudio 需要具备“环境已打开时再次返回 `debuggingPort`”的权限
- 如果需要 GUI 与 API 同时工作，Hubstudio 客户端版本应满足 `>= V3.35.0`

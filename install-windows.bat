@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

set "REPO_URL=https://github.com/timshuang/Keep-Alive.git"
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "DEFAULT_DIR=%SCRIPT_DIR%\apps\keepalive"
set "ADMIN_HOST_DEFAULT=127.0.0.1"
set "PROJECT_DIR="

call :main
exit /b %ERRORLEVEL%

:main
where git >nul 2>nul
if errorlevel 1 (
  call :fail 缺少必需命令：git
  echo 请先安装 Git，然后重新运行此脚本。
  exit /b 1
)
call :ok 已检测到 git

call :locate_project_dir
if errorlevel 1 exit /b 1

cd /d "%PROJECT_DIR%" || (
  call :fail 无法进入项目目录："%PROJECT_DIR%"
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  call :fail 缺少必需命令：node
  echo 请先安装 Node.js，然后重新运行此脚本。
  exit /b 1
)
call :ok 已检测到 node

where npm >nul 2>nul
if errorlevel 1 (
  call :fail 缺少必需命令：npm
  echo 请先安装 npm（通常随 Node.js 一起安装），然后重新运行此脚本。
  exit /b 1
)
call :ok 已检测到 npm

where pm2 >nul 2>nul
if errorlevel 1 (
  call :fail 缺少必需命令：pm2
  echo 请先全局安装 PM2：npm install -g pm2
  exit /b 1
)
call :ok 已检测到 pm2

call :ensure_env_file
if errorlevel 1 exit /b 1
call :ensure_accounts_file
if errorlevel 1 exit /b 1
call :ensure_accounts_ready
if errorlevel 1 exit /b 1

set "HUB_HOST=127.0.0.1"
set "HUB_PORT=6873"

call :print_status_summary
call :check_hub_connectivity

call :ensure_required_env_value TG_BOT_TOKEN "Enter TG_BOT_TOKEN"
if errorlevel 1 exit /b 1
call :ensure_required_env_value TG_CHAT_ID "Enter TG_CHAT_ID"
if errorlevel 1 exit /b 1
call :ensure_optional_env_value TG_API_PROXY "Enter TG_API_PROXY (optional, press Enter to skip)"
if errorlevel 1 exit /b 1

set "PROCEED="
set /p "PROCEED=现在执行 npm install、npm run build，并启动 PM2 吗？[Y/n]: "
if /i "%PROCEED%"=="n" goto :print_next_steps
if /i "%PROCEED%"=="no" goto :print_next_steps

call :info 正在执行 npm install...
call npm install
if errorlevel 1 (
  call :fail npm install 执行失败。
  exit /b 1
)

call :info 正在执行 npm run build...
call npm run build
if errorlevel 1 (
  call :fail npm run build 执行失败。
  exit /b 1
)

call :info 正在使用 ADMIN_HOST=%ADMIN_HOST_DEFAULT% 启动 PM2...
set "ADMIN_HOST=%ADMIN_HOST_DEFAULT%"
call npm run pm2:start
if errorlevel 1 (
  call :fail PM2 启动失败。
  exit /b 1
)

call :print_post_start_notes
call :ok Windows 部署已完成。
exit /b 0

:print_next_steps
echo.
call :info 后续步骤：
echo   cd /d "%PROJECT_DIR%"
echo   npm install
echo   npm run build
echo   set "ADMIN_HOST=%ADMIN_HOST_DEFAULT%" ^&^& npm run pm2:start
call :print_post_start_notes
exit /b 0

:locate_project_dir
call :is_keepalive_repo_dir "%CD%"
if not errorlevel 1 (
  set "PROJECT_DIR=%CD%"
  call :ok 使用当前项目目录："!PROJECT_DIR!"
  exit /b 0
)

call :is_keepalive_repo_dir "%SCRIPT_DIR%"
if not errorlevel 1 (
  set "PROJECT_DIR=%SCRIPT_DIR%"
  call :ok 使用脚本所在目录作为项目目录："!PROJECT_DIR!"
  exit /b 0
)

call :ensure_default_parent_dir
if not exist "%DEFAULT_DIR%" (
  call :info 正在克隆仓库到 "%DEFAULT_DIR%"...
  git clone "%REPO_URL%" "%DEFAULT_DIR%"
  if errorlevel 1 (
    call :fail 仓库克隆失败。
    exit /b 1
  )
  call :ok 仓库克隆完成。
)

call :is_keepalive_repo_dir "%DEFAULT_DIR%"
if errorlevel 1 (
  call :fail 目标目录已存在，但不是 keepalive 仓库："%DEFAULT_DIR%"
  exit /b 1
)

set "PROJECT_DIR=%DEFAULT_DIR%"
call :ok 使用部署目录："%PROJECT_DIR%"
exit /b 0

:ensure_default_parent_dir
if not exist "%SCRIPT_DIR%\apps" mkdir "%SCRIPT_DIR%\apps" >nul 2>nul
exit /b 0

:is_keepalive_repo_dir
set "CHECK_DIR=%~1"
if not exist "%CHECK_DIR%\package.json" exit /b 1
findstr /c:"\"name\": \"keepalive\"" "%CHECK_DIR%\package.json" >nul 2>nul
if errorlevel 1 exit /b 1
exit /b 0

:ensure_env_file
if exist ".env" (
  call :ok 复用现有 .env
  exit /b 0
)
if exist ".env.example" (
  copy /y ".env.example" ".env" >nul
  call :ok 已根据 .env.example 创建 .env
  exit /b 0
)
(
  echo TG_BOT_TOKEN=
  echo TG_CHAT_ID=
  echo TG_API_PROXY=
  echo.
  echo RESEND_API_KEY=
  echo ALERT_EMAIL=
) > ".env"
call :ok 已创建默认 .env
exit /b 0

:ensure_accounts_file
if exist "accounts.json" (
  call :ok 复用现有 accounts.json
  exit /b 0
)
if not exist "accounts.json.example" (
  call :fail 缺少 accounts.json.example，无法初始化 accounts.json。
  exit /b 1
)
copy /y "accounts.json.example" "accounts.json" >nul
call :ok 已根据 accounts.json.example 创建 accounts.json
exit /b 0

:check_hub_connectivity
powershell -NoProfile -Command ^
  "$uri = 'http://%HUB_HOST%:%HUB_PORT%/api/v1/env/list';" ^
  "$body = @{ current = 1; size = 1 } | ConvertTo-Json -Compress;" ^
  "try {" ^
  "  $null = Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 5;" ^
  "  exit 0" ^
  "} catch {" ^
  "  exit 1" ^
  "}"
if errorlevel 1 (
  call :warn Hubstudio Connector 预检失败：%HUB_HOST%:%HUB_PORT%
  echo 请确认当前 Windows 主机上的 Hubstudio Connector 已启动。
  echo 你仍可继续，但如果 Connector 不可达，后续 PM2 启动会失败。
  exit /b 0
)
call :ok Hubstudio Connector 预检通过：%HUB_HOST%:%HUB_PORT%
exit /b 0

:get_env_value
set "%~2="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "$key = '%~1'; $line = Select-String -Path '.env' -Pattern ('^' + [regex]::Escape($key) + '=') | Select-Object -First 1; if ($line) { $line.Line.Substring($key.Length + 1) }"`) do set "%~2=%%A"
exit /b 0

:set_env_value
set "ENV_KEY=%~1"
powershell -NoProfile -Command ^
  "$path = '.env';" ^
  "$key = $env:ENV_KEY;" ^
  "$value = $env:ENV_VALUE;" ^
  "$lines = if (Test-Path $path) { Get-Content $path } else { @() };" ^
  "$escaped = [regex]::Escape($key);" ^
  "$updated = $false;" ^
  "$result = foreach ($line in $lines) {" ^
  "  if ($line -match ('^' + $escaped + '=')) {" ^
  "    $updated = $true;" ^
  "    '' + $key + '=' + $value" ^
  "  } else {" ^
  "    $line" ^
  "  }" ^
  "};" ^
  "if (-not $updated) { $result += '' + $key + '=' + $value };" ^
  "Set-Content -Path $path -Value $result -Encoding UTF8"
if errorlevel 1 (
  call :fail 更新 .env 中的 %~1 失败。
  exit /b 1
)
exit /b 0

:ensure_required_env_value
call :get_env_value %~1 CURRENT_VALUE
if defined CURRENT_VALUE (
  call :ok %~1 已配置
  exit /b 0
)

:prompt_required
set "INPUT_VALUE="
set /p "INPUT_VALUE=%~2: "
if not defined INPUT_VALUE (
  call :warn %~1 不能为空。
  goto :prompt_required
)
set "ENV_KEY=%~1"
set "ENV_VALUE=%INPUT_VALUE%"
call :set_env_value %~1
if errorlevel 1 exit /b 1
call :ok 已将 %~1 写入 .env
exit /b 0

:ensure_optional_env_value
call :get_env_value %~1 CURRENT_VALUE
if defined CURRENT_VALUE (
  call :ok %~1 已配置
  exit /b 0
)
set "INPUT_VALUE="
set /p "INPUT_VALUE=%~2: "
if not defined INPUT_VALUE (
  call :ok 已跳过 %~1
  exit /b 0
)
set "ENV_KEY=%~1"
set "ENV_VALUE=%INPUT_VALUE%"
call :set_env_value %~1
if errorlevel 1 exit /b 1
call :ok 已将 %~1 写入 .env
exit /b 0

:ensure_accounts_ready
call :validate_accounts_file
if not errorlevel 1 exit /b 0

:accounts_retry_prompt
echo.
call :warn accounts.json 还未配置好。
echo 当前文件可能仍包含示例账号，或缺少必填字段。
echo 请先编辑：
echo   "%PROJECT_DIR%\accounts.json"
echo 如需参考，可查看 accounts.json.example。
echo.
set "ACCOUNTS_ACTION="
set /p "ACCOUNTS_ACTION=编辑完成后输入 R 重试，或直接回车 / 输入 E 退出： "
if /i "%ACCOUNTS_ACTION%"=="r" (
  call :validate_accounts_file
  if not errorlevel 1 exit /b 0
  goto :accounts_retry_prompt
)
if "%ACCOUNTS_ACTION%"=="" (
  call :warn 未启动 PM2。请先配置 accounts.json，再重新运行 install-windows.bat。
  exit /b 1
)
if /i "%ACCOUNTS_ACTION%"=="e" (
  call :warn 未启动 PM2。请先配置 accounts.json，再重新运行 install-windows.bat。
  exit /b 1
)
echo 输入无效。请输入 R 重试，或直接回车 / 输入 E 退出。
goto :accounts_retry_prompt

:validate_accounts_file
powershell -NoProfile -Command ^
  "$path = 'accounts.json';" ^
  "if (-not (Test-Path $path)) { exit 1 }" ^
  "try { $data = Get-Content $path -Raw | ConvertFrom-Json } catch { exit 1 }" ^
  "if ($data -isnot [System.Array] -or $data.Count -eq 0) { exit 1 }" ^
  "$demoCodes = @('84794164', '84794165', '84794166');" ^
  "$demoNames = @('Account1-Twitter+Gmail+DC', 'Account2-Twitter+DC', 'Account3-Paused');" ^
  "foreach ($item in $data) {" ^
  "  if (-not $item.containerCode -or -not $item.containerName) { exit 1 }" ^
  "  if ($null -eq $item.platforms) { exit 1 }" ^
  "  if ($demoCodes -contains [string]$item.containerCode -or $demoNames -contains [string]$item.containerName) { exit 1 }" ^
  "}"
exit /b %ERRORLEVEL%

:print_status_summary
echo.
echo 当前状态
echo ------------------------------
echo 项目目录:       %PROJECT_DIR%
for /f "delims=" %%A in ('node -v') do set "NODE_VERSION=%%A"
echo Node.js:         %NODE_VERSION%
for /f "delims=" %%A in ('npm -v') do set "NPM_VERSION=%%A"
echo npm:             %NPM_VERSION%
echo PM2:             可用
echo Hub Connector:   %HUB_HOST%:%HUB_PORT%
if exist ".env" echo .env:            已存在
if exist "accounts.json" echo accounts.json:   已存在
echo ------------------------------
echo.
exit /b 0

:print_post_start_notes
echo.
echo PM2 常用命令：
echo   cd /d "%PROJECT_DIR%"
echo   npm run pm2:logs
echo   npm run pm2:restart
echo   npm run pm2:stop
echo.
echo 健康检查：
echo   http://127.0.0.1:3210/health
echo.
echo 如果管理页需要对外监听，可改用：
echo   set "ADMIN_HOST=0.0.0.0" ^&^& npm run pm2:restart
echo.
echo 日志文件：
echo   "%PROJECT_DIR%\logs\pm2\keepalive.out.log"
echo   "%PROJECT_DIR%\logs\pm2\keepalive.err.log"
echo   "%PROJECT_DIR%\logs\keepalive-YYYY-MM-DD.log"
echo.
exit /b 0

:info
echo [INFO] %*
exit /b 0

:ok
echo [OK] %*
exit /b 0

:warn
echo [WARN] %*
exit /b 0

:fail
echo [FAIL] %*
exit /b 1

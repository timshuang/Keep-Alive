@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

set "REPO_URL=https://github.com/timshuang/Keep-Alive.git"
set "DEFAULT_DIR=%USERPROFILE%\apps\keepalive"
set "NODE_MAJOR_REQUIRED=22"
set "ADMIN_HOST_DEFAULT=127.0.0.1"
set "PROJECT_DIR="

call :main
exit /b %ERRORLEVEL%

:main
call :ensure_command git "Install Git first, then rerun this script."
if errorlevel 1 exit /b 1

call :locate_project_dir
if errorlevel 1 exit /b 1

cd /d "%PROJECT_DIR%" || (
  call :fail Failed to enter project directory: "%PROJECT_DIR%"
  exit /b 1
)

call :ensure_command node "Install Node.js 22.x first, then rerun this script."
if errorlevel 1 exit /b 1
call :ensure_command npm "Install npm with Node.js 22.x first, then rerun this script."
if errorlevel 1 exit /b 1
call :ensure_command pm2 "Install PM2 globally with: npm install -g pm2"
if errorlevel 1 exit /b 1

call :validate_node_major
if errorlevel 1 exit /b 1

call :ensure_env_file
if errorlevel 1 exit /b 1
call :ensure_accounts_file
if errorlevel 1 exit /b 1

call :resolve_hub_host_port
if errorlevel 1 exit /b 1

call :print_status_summary
call :check_hub_connectivity

call :ensure_required_env_value TG_BOT_TOKEN "Enter TG_BOT_TOKEN"
if errorlevel 1 exit /b 1
call :ensure_required_env_value TG_CHAT_ID "Enter TG_CHAT_ID"
if errorlevel 1 exit /b 1
call :ensure_optional_env_value TG_API_PROXY "Enter TG_API_PROXY (optional, press Enter to skip)"
if errorlevel 1 exit /b 1

echo.
call :warn Edit accounts.json before the first production run:
echo   "%PROJECT_DIR%\accounts.json"
echo Demo accounts are rejected during startup validation.
echo.

set "PROCEED="
set /p "PROCEED=Run npm install, npm run build, and start PM2 now? [Y/n]: "
if /i "%PROCEED%"=="n" goto :print_next_steps
if /i "%PROCEED%"=="no" goto :print_next_steps

call :validate_accounts_file
if errorlevel 1 exit /b 1

call :info Running npm install...
call npm install
if errorlevel 1 (
  call :fail npm install failed.
  exit /b 1
)

call :info Running npm run build...
call npm run build
if errorlevel 1 (
  call :fail npm run build failed.
  exit /b 1
)

call :info Starting PM2 with ADMIN_HOST=%ADMIN_HOST_DEFAULT%...
set "ADMIN_HOST=%ADMIN_HOST_DEFAULT%"
call npm run pm2:start
if errorlevel 1 (
  call :fail PM2 start failed.
  exit /b 1
)

call :print_post_start_notes
call :ok Windows deployment is ready.
exit /b 0

:print_next_steps
echo.
call :info Next steps:
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
  call :ok Using current project directory: "!PROJECT_DIR!"
  exit /b 0
)

set "SCRIPT_DIR=%~dp0"
call :is_keepalive_repo_dir "%SCRIPT_DIR%"
if not errorlevel 1 (
  set "PROJECT_DIR=%SCRIPT_DIR:~0,-1%"
  call :ok Using script directory as project directory: "!PROJECT_DIR!"
  exit /b 0
)

call :ensure_default_parent_dir
if not exist "%DEFAULT_DIR%" (
  call :info Cloning repository to "%DEFAULT_DIR%"...
  git clone "%REPO_URL%" "%DEFAULT_DIR%"
  if errorlevel 1 (
    call :fail Failed to clone repository.
    exit /b 1
  )
  call :ok Repository cloned successfully.
)

call :is_keepalive_repo_dir "%DEFAULT_DIR%"
if errorlevel 1 (
  call :fail Target directory exists but is not the keepalive repository: "%DEFAULT_DIR%"
  exit /b 1
)

set "PROJECT_DIR=%DEFAULT_DIR%"
call :ok Using deployment directory: "%PROJECT_DIR%"
exit /b 0

:ensure_default_parent_dir
if not exist "%USERPROFILE%\apps" mkdir "%USERPROFILE%\apps" >nul 2>nul
exit /b 0

:is_keepalive_repo_dir
set "CHECK_DIR=%~1"
if not exist "%CHECK_DIR%\package.json" exit /b 1
findstr /c:"\"name\": \"keepalive\"" "%CHECK_DIR%\package.json" >nul 2>nul
if errorlevel 1 exit /b 1
exit /b 0

:ensure_command
where %~1 >nul 2>nul
if errorlevel 1 (
  call :fail Missing required command: %~1
  echo %~2
  exit /b 1
)
call :ok Found %~1
exit /b 0

:validate_node_major
set "NODE_VERSION="
for /f "delims=" %%A in ('node -v 2^>nul') do set "NODE_VERSION=%%A"
if not defined NODE_VERSION (
  call :fail Unable to read Node.js version.
  exit /b 1
)
set "NODE_VERSION=%NODE_VERSION:v=%"
for /f "tokens=1 delims=." %%A in ("%NODE_VERSION%") do set "NODE_MAJOR=%%A"
if not "%NODE_MAJOR%"=="%NODE_MAJOR_REQUIRED%" (
  call :fail Node.js %NODE_MAJOR_REQUIRED%.x is required, but found v%NODE_VERSION%.
  exit /b 1
)
call :ok Node.js version is compatible: v%NODE_VERSION%
exit /b 0

:ensure_env_file
if exist ".env" (
  call :ok Reusing existing .env
  exit /b 0
)
if exist ".env.example" (
  copy /y ".env.example" ".env" >nul
  call :ok Created .env from .env.example
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
call :ok Created fallback .env
exit /b 0

:ensure_accounts_file
if exist "accounts.json" (
  call :ok Reusing existing accounts.json
  exit /b 0
)
if not exist "accounts.json.example" (
  call :fail Missing accounts.json.example, cannot initialize accounts.json.
  exit /b 1
)
copy /y "accounts.json.example" "accounts.json" >nul
call :ok Created accounts.json from accounts.json.example
exit /b 0

:resolve_hub_host_port
set "HUB_HOST=127.0.0.1"
set "HUB_PORT=6873"
if not exist "config.jsonc" exit /b 0

for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "$raw = Get-Content 'config.jsonc' -Raw; $m = [regex]::Match($raw, '\"host\"\s*:\s*\"([^\"]+)\"'); if ($m.Success) { $m.Groups[1].Value } else { '127.0.0.1' }"`) do set "HUB_HOST=%%A"
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "$raw = Get-Content 'config.jsonc' -Raw; $m = [regex]::Match($raw, '\"port\"\s*:\s*(\d+)'); if ($m.Success) { $m.Groups[1].Value } else { '6873' }"`) do set "HUB_PORT=%%A"
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
  call :warn Hubstudio Connector preflight failed at %HUB_HOST%:%HUB_PORT%.
  echo Confirm Hubstudio Connector is running on this Windows host.
  echo You can continue, but PM2 startup will fail if the Connector is unreachable.
  exit /b 0
)
call :ok Hubstudio Connector preflight succeeded at %HUB_HOST%:%HUB_PORT%
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
  call :fail Failed to update .env for key %~1.
  exit /b 1
)
exit /b 0

:ensure_required_env_value
call :get_env_value %~1 CURRENT_VALUE
if defined CURRENT_VALUE (
  call :ok %~1 is already configured
  exit /b 0
)

:prompt_required
set "INPUT_VALUE="
set /p "INPUT_VALUE=%~2: "
if not defined INPUT_VALUE (
  call :warn %~1 cannot be empty.
  goto :prompt_required
)
set "ENV_KEY=%~1"
set "ENV_VALUE=%INPUT_VALUE%"
call :set_env_value %~1
if errorlevel 1 exit /b 1
call :ok Saved %~1 to .env
exit /b 0

:ensure_optional_env_value
call :get_env_value %~1 CURRENT_VALUE
if defined CURRENT_VALUE (
  call :ok %~1 is already configured
  exit /b 0
)
set "INPUT_VALUE="
set /p "INPUT_VALUE=%~2: "
if not defined INPUT_VALUE (
  call :ok Skipped %~1
  exit /b 0
)
set "ENV_KEY=%~1"
set "ENV_VALUE=%INPUT_VALUE%"
call :set_env_value %~1
if errorlevel 1 exit /b 1
call :ok Saved %~1 to .env
exit /b 0

:validate_accounts_file
powershell -NoProfile -Command ^
  "$path = 'accounts.json';" ^
  "if (-not (Test-Path $path)) { Write-Error 'accounts.json is missing.'; exit 1 }" ^
  "try { $data = Get-Content $path -Raw | ConvertFrom-Json } catch { Write-Error 'accounts.json is not valid JSON.'; exit 1 }" ^
  "if ($data -isnot [System.Array] -or $data.Count -eq 0) { Write-Error 'accounts.json must be a non-empty array.'; exit 1 }" ^
  "$demoCodes = @('84794164', '84794165', '84794166');" ^
  "$demoNames = @('Account1-Twitter+Gmail+DC', 'Account2-Twitter+DC', 'Account3-Paused');" ^
  "foreach ($item in $data) {" ^
  "  if (-not $item.containerCode -or -not $item.containerName) { Write-Error 'Each account requires containerCode and containerName.'; exit 1 }" ^
  "  if ($null -eq $item.platforms) { Write-Error 'Each account requires a platforms array.'; exit 1 }" ^
  "  if ($demoCodes -contains [string]$item.containerCode -or $demoNames -contains [string]$item.containerName) { Write-Error 'Replace demo accounts in accounts.json before startup.'; exit 1 }" ^
  "}"
if errorlevel 1 (
  call :fail accounts.json validation failed.
  exit /b 1
)
call :ok accounts.json validation passed
exit /b 0

:print_status_summary
echo.
echo Current status
echo ------------------------------
echo Project Dir:     %PROJECT_DIR%
echo Node.js:         %NODE_VERSION%
for /f "delims=" %%A in ('npm -v') do set "NPM_VERSION=%%A"
echo npm:             %NPM_VERSION%
echo PM2:             available
echo Hub Connector:   %HUB_HOST%:%HUB_PORT%
if exist ".env" echo .env:            present
if exist "accounts.json" echo accounts.json:   present
echo ------------------------------
echo.
exit /b 0

:print_post_start_notes
echo.
echo PM2 commands:
echo   cd /d "%PROJECT_DIR%"
echo   npm run pm2:logs
echo   npm run pm2:restart
echo   npm run pm2:stop
echo.
echo Health check:
echo   http://127.0.0.1:3210/health
echo.
echo If localhost access is not enough for the admin page, restart with:
echo   set "ADMIN_HOST=0.0.0.0" ^&^& npm run pm2:restart
echo.
echo Log files:
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

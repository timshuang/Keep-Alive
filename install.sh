#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO_URL="https://github.com/timshuang/Keep-Alive.git"
DEFAULT_DIR="$HOME/apps/keepalive"
NODE_MAJOR_REQUIRED=22
ADMIN_HOST_DEFAULT="127.0.0.1"

info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()  { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

detect_pkg_manager() {
  if command -v apt >/dev/null 2>&1; then
    echo "apt"
  elif command -v dnf >/dev/null 2>&1; then
    echo "dnf"
  elif command -v yum >/dev/null 2>&1; then
    echo "yum"
  elif command -v pacman >/dev/null 2>&1; then
    echo "pacman"
  else
    echo "unknown"
  fi
}

is_wsl() {
  grep -qi microsoft /proc/version 2>/dev/null
}

pkg_install() {
  local pkg_mgr="$1"
  shift
  case "$pkg_mgr" in
    apt)
      sudo apt update -qq
      sudo apt install -y "$@"
      ;;
    dnf)
      sudo dnf install -y "$@"
      ;;
    yum)
      sudo yum install -y "$@"
      ;;
    pacman)
      sudo pacman -S --noconfirm "$@"
      ;;
    *)
      fail "无法自动安装依赖: $*。请手动安装后重试。"
      ;;
  esac
}

install_node_22() {
  local pkg_mgr="$1"
  info "开始安装或升级 Node.js ${NODE_MAJOR_REQUIRED}.x ..."

  case "$pkg_mgr" in
    apt)
      pkg_install "$pkg_mgr" ca-certificates curl gnupg
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR_REQUIRED}.x" | sudo -E bash -
      sudo apt install -y nodejs
      ;;
    dnf)
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR_REQUIRED}.x" | sudo bash -
      sudo dnf install -y nodejs
      ;;
    yum)
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR_REQUIRED}.x" | sudo bash -
      sudo yum install -y nodejs
      ;;
    pacman)
      sudo pacman -S --noconfirm nodejs npm
      ;;
    *)
      fail "无法自动安装 Node.js ${NODE_MAJOR_REQUIRED}.x，请手动安装后重试。"
      ;;
  esac
}

ensure_git() {
  local pkg_mgr="$1"
  if command -v git >/dev/null 2>&1; then
    ok "git 已满足，跳过安装"
    return
  fi
  warn "git 未安装，开始安装..."
  pkg_install "$pkg_mgr" git
  ok "git 已安装"
}

ensure_curl() {
  local pkg_mgr="$1"
  if command -v curl >/dev/null 2>&1; then
    ok "curl 已满足，跳过安装"
    return
  fi
  warn "curl 未安装，开始安装..."
  pkg_install "$pkg_mgr" curl
  ok "curl 已安装"
}

ensure_node_and_npm() {
  local pkg_mgr="$1"

  if command -v node >/dev/null 2>&1; then
    local current_major
    current_major="$(node -v | sed 's/^v//' | cut -d. -f1)"
    if [ "$current_major" = "$NODE_MAJOR_REQUIRED" ]; then
      ok "Node.js $(node -v) 已满足要求，跳过安装"
    else
      warn "当前 Node.js 版本为 $(node -v)，需要 ${NODE_MAJOR_REQUIRED}.x，开始升级..."
      install_node_22 "$pkg_mgr"
      ok "Node.js 已升级到 $(node -v)"
    fi
  else
    warn "Node.js 未安装，开始安装 ${NODE_MAJOR_REQUIRED}.x ..."
    install_node_22 "$pkg_mgr"
    ok "Node.js 已安装为 $(node -v)"
  fi

  if command -v npm >/dev/null 2>&1; then
    ok "npm $(npm -v) 已满足，跳过安装"
  else
    warn "npm 未安装，开始补装..."
    install_node_22 "$pkg_mgr"
    ok "npm 已安装为 $(npm -v)"
  fi
}

ensure_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    ok "pm2 可用，跳过安装"
    return
  fi
  warn "pm2 未安装，开始全局安装..."
  sudo npm install -g pm2
  ok "pm2 已安装"
}

ensure_default_parent_dir() {
  mkdir -p "$(dirname "$DEFAULT_DIR")"
}

ensure_not_mnt_dir() {
  local dir="$1"
  case "$dir" in
    /mnt/*)
      fail "WSL 正式部署目录不能放在 /mnt 下。请改用类似 ${DEFAULT_DIR} 的 WSL 原生目录。"
      ;;
  esac
}

is_keepalive_repo_dir() {
  [ -f "$1/package.json" ] && grep -q '"keepalive"' "$1/package.json" 2>/dev/null
}

ensure_bootstrap_repo() {
  ensure_default_parent_dir
  ensure_not_mnt_dir "$DEFAULT_DIR"

  if [ -d "$DEFAULT_DIR" ]; then
    if is_keepalive_repo_dir "$DEFAULT_DIR"; then
      ok "检测到已有安装目录，复用 ${DEFAULT_DIR}"
      return
    fi
    fail "目标目录 ${DEFAULT_DIR} 已存在，但不是 keepalive 仓库。请手动处理后重试。"
  fi

  info "开始克隆仓库到 ${DEFAULT_DIR}"
  git clone "$REPO_URL" "$DEFAULT_DIR"
  ok "仓库克隆完成"
}

ensure_env_file() {
  if [ -f .env ]; then
    ok ".env 已存在，跳过初始化"
    return
  fi

  if [ -f .env.example ]; then
    cp .env.example .env
  else
    cat > .env <<'EOF'
TG_BOT_TOKEN=
TG_CHAT_ID=
TG_API_PROXY=
RESEND_API_KEY=
ALERT_EMAIL=
EOF
  fi
  ok "已创建 .env 模板"
}

ensure_accounts_file() {
  if [ -f accounts.json ]; then
    ok "accounts.json 已存在，跳过初始化"
    return
  fi

  if [ -f accounts.json.example ]; then
    cp accounts.json.example accounts.json
    ok "已创建 accounts.json 模板"
  else
    fail "缺少 accounts.json.example，无法初始化 accounts.json。"
  fi
}

resolve_wsl_host_ip() {
  awk '/^nameserver / { print $2; exit }' /etc/resolv.conf 2>/dev/null || true
}

resolve_hub_host() {
  if [ ! -f config.jsonc ]; then
    echo "127.0.0.1"
    return
  fi

  local configured
  configured="$(sed -n 's/.*"host"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' config.jsonc | head -n 1)"
  if [ -z "$configured" ]; then
    configured="127.0.0.1"
  fi

  if [ "$configured" = "127.0.0.1" ] && is_wsl; then
    local wsl_host_ip
    wsl_host_ip="$(resolve_wsl_host_ip)"
    if [ -n "$wsl_host_ip" ]; then
      echo "$wsl_host_ip"
      return
    fi
  fi

  echo "$configured"
}

check_hub_connectivity() {
  local hub_host="$1"
  local hub_port="$2"

  if curl -fsS --max-time 5 \
    -H "Content-Type: application/json" \
    -d '{"current":1,"size":1}' \
    "http://${hub_host}:${hub_port}/api/v1/env/list" >/dev/null; then
    ok "Hubstudio Connector 连通性预检通过 (${hub_host}:${hub_port})"
    return 0
  fi

  warn "Hubstudio Connector 连通性预检失败 (${hub_host}:${hub_port})"
  warn "请确认宿主机 Windows 上的 Hubstudio Connector 已启动。"
  warn "若 WSL 自动探测地址不可用，请手动调整 config.jsonc 中的 hub.host。"
  return 1
}

env_value() {
  local key="$1"
  local file="${2:-.env}"
  local raw
  raw="$(sed -n "s/^${key}=//p" "$file" 2>/dev/null | head -n 1)"
  printf '%s' "$raw" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

has_non_empty_env() {
  local key="$1"
  local value
  value="$(env_value "$key")"
  [ -n "${value}" ]
}

read_from_stdin() {
  local prompt="$1"
  local target="$2"
  local input_value=""

  read -r -p "$prompt" input_value
  printf -v "$target" '%s' "$input_value"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local tmp_file
  local found=0

  tmp_file="$(mktemp)"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" == "${key}="* ]]; then
      printf '%s=%s\n' "$key" "$value" >> "$tmp_file"
      found=1
    else
      printf '%s\n' "$line" >> "$tmp_file"
    fi
  done < .env

  if [ "$found" -eq 0 ]; then
    printf '%s=%s\n' "$key" "$value" >> "$tmp_file"
  fi

  cat "$tmp_file" > .env
  rm -f "$tmp_file"
}

ensure_required_env_value() {
  local key="$1"
  local prompt="$2"
  local current
  current="$(env_value "$key")"

  if [ -n "$current" ]; then
    ok "${key} 已配置，跳过"
    return
  fi

  local value=""
  while [ -z "$value" ]; do
    read_from_stdin "$prompt" value
    if [ -z "$value" ]; then
      warn "${key} 为必填项，不能为空。"
    fi
  done
  set_env_value "$key" "$value"
  ok "${key} 已写入 .env"
}

ensure_optional_env_value() {
  local key="$1"
  local prompt="$2"
  local current
  current="$(env_value "$key")"

  if [ -n "$current" ]; then
    ok "${key} 已配置，跳过"
    return
  fi

  local value=""
  read_from_stdin "$prompt" value
  if [ -n "$value" ]; then
    set_env_value "$key" "$value"
    ok "${key} 已写入 .env"
  else
    ok "${key} 已跳过"
  fi
}

tty_yes_no() {
  local prompt="$1"
  local answer=""
  read_from_stdin "$prompt" answer
  case "$answer" in
    [Nn]|[Nn][Oo])
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

validate_accounts_file() {
  if [ ! -f accounts.json ]; then
    fail "缺少 accounts.json，请先填写真实账号配置。"
  fi

  node - <<'EOF'
const fs = require('fs');

const raw = fs.readFileSync('accounts.json', 'utf8');
let data;
try {
  data = JSON.parse(raw);
} catch {
  console.error('accounts.json 不是合法 JSON。');
  process.exit(1);
}

if (!Array.isArray(data) || data.length === 0) {
  console.error('accounts.json 必须是非空数组。');
  process.exit(1);
}

const demoCodes = new Set(['84794164', '84794165', '84794166']);
const demoNames = new Set([
  'Account1-Twitter+Gmail+DC',
  'Account2-Twitter+DC',
  'Account3-Paused',
]);

for (const item of data) {
  if (!item || typeof item !== 'object') {
    console.error('accounts.json 中存在无效账号项。');
    process.exit(1);
  }

  if (typeof item.containerCode !== 'string' || !item.containerCode.trim()) {
    console.error('accounts.json 中存在缺少 containerCode 的账号项。');
    process.exit(1);
  }

  if (typeof item.containerName !== 'string' || !item.containerName.trim()) {
    console.error('accounts.json 中存在缺少 containerName 的账号项。');
    process.exit(1);
  }

  if (!Array.isArray(item.platforms)) {
    console.error('accounts.json 中存在缺少 platforms 数组的账号项。');
    process.exit(1);
  }

  if (demoCodes.has(item.containerCode) || demoNames.has(item.containerName)) {
    console.error('accounts.json 仍然包含示例模板账号，请先替换成真实账号。');
    process.exit(1);
  }
}
EOF
}

print_status_summary() {
  local hub_host="$1"

  echo
  echo "当前状态摘要"
  echo "------------------------------"
  if command -v node >/dev/null 2>&1; then
    echo "Node.js:        $(node -v)"
  else
    echo "Node.js:        未安装"
  fi
  if command -v npm >/dev/null 2>&1; then
    echo "npm:            $(npm -v)"
  else
    echo "npm:            未安装"
  fi
  if command -v pm2 >/dev/null 2>&1; then
    echo "pm2:            可用"
  else
    echo "pm2:            未安装"
  fi
  if has_non_empty_env TG_BOT_TOKEN; then
    echo ".env TG_BOT_TOKEN: 已配置"
  else
    echo ".env TG_BOT_TOKEN: 未配置"
  fi
  if has_non_empty_env TG_CHAT_ID; then
    echo ".env TG_CHAT_ID:   已配置"
  else
    echo ".env TG_CHAT_ID:   未配置"
  fi
  if [ -f accounts.json ]; then
    echo "accounts.json:   已存在"
  else
    echo "accounts.json:   不存在"
  fi
  if check_hub_connectivity "$hub_host" "6873" >/dev/null 2>&1; then
    echo "Hub 连通性:      通过 (${hub_host}:6873)"
  else
    echo "Hub 连通性:      失败 (${hub_host}:6873)"
  fi
  echo "------------------------------"
  echo
}

print_bootstrap_result() {
  local hub_host="$1"

  echo
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}  Keepalive 安装与预检完成${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo
  echo -e "安装目录: ${CYAN}${DEFAULT_DIR}${NC}"
  echo -e "Hub 地址: ${CYAN}${hub_host}:6873${NC}"
  echo
  echo -e "下一步："
  echo -e "  ${CYAN}cd ${DEFAULT_DIR} && bash install.sh${NC}"
  echo
  echo -e "这一步会进入轻交互配置，要求填写："
  echo -e "  - TG_BOT_TOKEN"
  echo -e "  - TG_CHAT_ID"
  echo -e "  - 可选的 TG_API_PROXY"
  echo -e "  - 然后提示你手工编辑 accounts.json"
  echo -e "  - .env 注释请单独成行，不要写成 KEY=value # comment"
  echo
}

print_post_start_notes() {
  echo
  echo -e "管理页默认以更安全的方式监听：${CYAN}${ADMIN_HOST_DEFAULT}:3210${NC}"
  echo -e "请先在 Windows 宿主机尝试访问：${CYAN}http://localhost:3210/health${NC}"
  echo -e "如果宿主机访问不到，再改用 ${CYAN}ADMIN_HOST=0.0.0.0${NC} 重启。"
  echo -e "注意：${CYAN}0.0.0.0${NC} 会扩大监听范围，建议配合宿主机防火墙限制来源。"
  echo
}

run_bootstrap() {
  local pkg_mgr
  pkg_mgr="$(detect_pkg_manager)"
  [ "$pkg_mgr" != "unknown" ] || fail "无法识别包管理器，请手动安装依赖。"

  if is_wsl; then
    ok "已检测到 WSL 环境"
  else
    warn "当前未检测到 WSL。正式部署仍推荐在 WSL 中执行。"
  fi

  ensure_git "$pkg_mgr"
  ensure_curl "$pkg_mgr"
  ensure_node_and_npm "$pkg_mgr"
  ensure_pm2
  ensure_bootstrap_repo

  cd "$DEFAULT_DIR"
  ensure_env_file
  ensure_accounts_file

  local hub_host
  hub_host="$(resolve_hub_host)"
  check_hub_connectivity "$hub_host" "6873" || true
  print_bootstrap_result "$hub_host"
}

run_configure() {
  local pkg_mgr
  pkg_mgr="$(detect_pkg_manager)"
  [ "$pkg_mgr" != "unknown" ] || fail "无法识别包管理器，请手动安装依赖。"

  ensure_not_mnt_dir "$(pwd)"
  ensure_env_file
  ensure_accounts_file
  ensure_git "$pkg_mgr"
  ensure_curl "$pkg_mgr"
  ensure_node_and_npm "$pkg_mgr"
  ensure_pm2

  local hub_host
  hub_host="$(resolve_hub_host)"
  print_status_summary "$hub_host"

  info "即将进入交互配置，请在当前终端输入 TG_BOT_TOKEN 和 TG_CHAT_ID。"
  ensure_required_env_value "TG_BOT_TOKEN" "请输入 TG_BOT_TOKEN: "
  ensure_required_env_value "TG_CHAT_ID" "请输入 TG_CHAT_ID: "
  ensure_optional_env_value "TG_API_PROXY" "请输入 TG_API_PROXY（可直接回车跳过）: "

  echo
  warn "请手工编辑 accounts.json 后再开始正式保活。"
  echo "文件路径: $(pwd)/accounts.json"
  echo "未完成真实账号填写前，脚本将阻止直接启动服务。"
  echo

  if tty_yes_no "是否现在执行 npm install、npm run build，并用 ADMIN_HOST=${ADMIN_HOST_DEFAULT} 启动 PM2？[Y/n] "; then
    validate_accounts_file
    npm install
    npm run build
    ADMIN_HOST="${ADMIN_HOST_DEFAULT}" npm run pm2:start
    print_post_start_notes
  else
    echo
    echo "后续可手动执行："
    echo "  npm install"
    echo "  npm run build"
    echo "  ADMIN_HOST=${ADMIN_HOST_DEFAULT} npm run pm2:start"
    print_post_start_notes
  fi
}

main() {
  local mode="${1:-auto}"

  case "$mode" in
    bootstrap)
      run_bootstrap
      ;;
    configure)
      run_configure
      ;;
    auto)
      if is_keepalive_repo_dir "$(pwd)"; then
        run_configure
      else
        run_bootstrap
      fi
      ;;
    *)
      fail "不支持的模式: ${mode}。可用模式: bootstrap, configure"
      ;;
  esac
}

main "$@"

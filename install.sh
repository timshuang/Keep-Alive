#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()  { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

REPO_URL="https://github.com/timshuang/Keep-Alive.git"
DEFAULT_DIR="$HOME/apps/keepalive"
NODE_MAJOR_REQUIRED=22

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

ensure_not_mnt_dir() {
  local dir="$1"
  case "$dir" in
    /mnt/*)
      fail "WSL 正式部署目录不能放在 /mnt 下。请改用类似 ${DEFAULT_DIR} 的 WSL 原生目录。"
      ;;
  esac
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
    ok "pm2 $(pm2 -v) 已满足，跳过安装"
    return
  fi
  warn "pm2 未安装，开始全局安装..."
  sudo npm install -g pm2
  ok "pm2 已安装为 $(pm2 -v)"
}

resolve_project_dir() {
  if [ -f "package.json" ] && grep -q '"keepalive"' package.json 2>/dev/null; then
    pwd
    return
  fi

  local dir="$DEFAULT_DIR"
  mkdir -p "$(dirname "$dir")"

  if [ -d "$dir/.git" ]; then
    echo "$dir"
    return
  fi

  git clone "$REPO_URL" "$dir"
  echo "$dir"
}

ensure_env_file() {
  if [ -f .env ]; then
    ok ".env 已存在，跳过初始化"
    return
  fi

  if [ -f .env.example ]; then
    cp .env.example .env
    warn "已根据 .env.example 创建 .env，请补充 TG_BOT_TOKEN / TG_CHAT_ID 等配置后再启动。"
  else
    cat > .env <<'EOF'
TG_BOT_TOKEN=
TG_CHAT_ID=
TG_API_PROXY=
RESEND_API_KEY=
ALERT_EMAIL=
EOF
    warn "已创建空白 .env，请补充配置后再启动。"
  fi
}

ensure_accounts_file() {
  if [ -f accounts.json ]; then
    ok "accounts.json 已存在，跳过初始化"
    return
  fi

  if [ -f accounts.json.example ]; then
    cp accounts.json.example accounts.json
    warn "已根据 accounts.json.example 创建 accounts.json，请填入账号信息。"
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

  info "开始预检 Hubstudio Connector: http://${hub_host}:${hub_port}"
  if curl -fsS --max-time 5 \
    -H "Content-Type: application/json" \
    -d '{"current":1,"size":1}' \
    "http://${hub_host}:${hub_port}/api/v1/env/list" >/dev/null; then
    ok "Hubstudio Connector 连通性预检通过"
  else
    warn "Hubstudio Connector 连通性预检失败"
    warn "如果当前在 WSL 中运行，请确认宿主机 Windows 上的 Hubstudio Connector 已启动并允许从 WSL 访问。"
    warn "如自动探测地址不可用，请在 config.jsonc 中将 hub.host 改为宿主机实际可达 IP 后重试。"
  fi
}

print_next_steps() {
  local project_dir="$1"
  local hub_host="$2"

  echo
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}  Keepalive WSL 部署准备完成${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo
  echo -e "项目目录:      ${CYAN}${project_dir}${NC}"
  echo -e ".env 文件:     ${CYAN}${project_dir}/.env${NC}"
  echo -e "账号文件:      ${CYAN}${project_dir}/accounts.json${NC}"
  echo -e "Hub 访问地址:  ${CYAN}${hub_host}:6873${NC}"
  echo
  echo -e "启动命令:"
  echo -e "  ${CYAN}cd ${project_dir} && npm install && npm run build && ADMIN_HOST=0.0.0.0 npm run pm2:start${NC}"
  echo
  echo -e "常用命令:"
  echo -e "  ${CYAN}npm run pm2:restart${NC}"
  echo -e "  ${CYAN}npm run pm2:logs${NC}"
  echo
  echo -e "宿主机访问管理页:"
  echo -e "  ${CYAN}http://localhost:3210/health${NC}"
  echo -e "  若 localhost 转发不可用，再改用 WSL IP 访问。"
  echo
}

main() {
  local pkg_mgr
  pkg_mgr="$(detect_pkg_manager)"
  [ "$pkg_mgr" != "unknown" ] || fail "无法识别包管理器，请手动安装依赖。"

  if is_wsl; then
    ok "已检测到 WSL 环境"
  else
    warn "当前未检测到 WSL。该脚本仍可运行，但正式部署推荐在 WSL 中执行。"
  fi

  local project_dir
  project_dir="$(resolve_project_dir)"
  ensure_not_mnt_dir "$project_dir"
  cd "$project_dir"
  ok "部署目录: $project_dir"

  info "开始环境预检..."
  ensure_git "$pkg_mgr"
  ensure_curl "$pkg_mgr"
  ensure_node_and_npm "$pkg_mgr"
  ensure_pm2

  info "开始初始化项目文件..."
  ensure_env_file
  ensure_accounts_file

  local hub_host
  hub_host="$(resolve_hub_host)"
  check_hub_connectivity "$hub_host" "6873"

  print_next_steps "$project_dir" "$hub_host"
}

main "$@"

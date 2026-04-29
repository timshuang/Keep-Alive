#!/bin/bash
set -euo pipefail

# ========== Colors ==========
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()  { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

# ========== Detect package manager ==========
detect_pkg_manager() {
  if command -v apt &>/dev/null; then
    echo "apt"
  elif command -v dnf &>/dev/null; then
    echo "dnf"
  elif command -v yum &>/dev/null; then
    echo "yum"
  elif command -v pacman &>/dev/null; then
    echo "pacman"
  else
    echo "unknown"
  fi
}

pkg_install() {
  local pkg_mgr="$1"
  shift
  case "$pkg_mgr" in
    apt)
      sudo apt update -qq && sudo apt install -y "$@"
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
      fail "无法自动安装 $*，请手动安装后重新运行脚本"
      ;;
  esac
}

# ========== Step 1: Clone or detect project ==========
PROJECT_DIR=""
REPO_URL="https://github.com/timshuang/Keep-Alive.git"

if [ -f "package.json" ] && grep -q '"keepalive"' package.json 2>/dev/null; then
  PROJECT_DIR="$(pwd)"
  ok "已在项目目录: ${PROJECT_DIR}"
else
  PROJECT_DIR="$(pwd)/Keepalive"
  if [ -d "${PROJECT_DIR}" ]; then
    ok "项目目录已存在: ${PROJECT_DIR}"
  else
    info "正在克隆仓库..."
    if command -v git &>/dev/null; then
      git clone "${REPO_URL}" "${PROJECT_DIR}" || fail "git clone 失败"
      ok "仓库克隆完成"
    else
      PKG_MGR=$(detect_pkg_manager)
      info "git 未安装，正在自动安装..."
      pkg_install "$PKG_MGR" git
      git clone "${REPO_URL}" "${PROJECT_DIR}" || fail "git clone 失败"
      ok "仓库克隆完成"
    fi
  fi
fi

cd "${PROJECT_DIR}"

# ========== Step 2: System dependency check ==========
info "正在检查系统依赖..."

PKG_MGR=$(detect_pkg_manager)

check_and_install() {
  local cmd="$1"
  local pkg_name="$2"
  if command -v "$cmd" &>/dev/null; then
    ok "${cmd} 已安装"
  else
    warn "${cmd} 未安装，正在自动安装..."
    pkg_install "$PKG_MGR" "$pkg_name"
    ok "${cmd} 安装完成"
  fi
}

check_and_install git git
check_and_install tmux tmux

# Node.js special handling: need >= 18
if command -v node &>/dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -ge 18 ]; then
    ok "Node.js $(node -v) 已安装"
  else
    warn "Node.js $(node -v) 版本过低（需要 >= 18），正在升级..."
    case "$PKG_MGR" in
      apt)
        # Try nodesource for newer Node.js
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null && sudo apt install -y nodejs || fail "Node.js 升级失败，请手动安装 Node.js >= 18"
        ;;
      dnf)
        sudo dnf install -y nodejs || fail "Node.js 升级失败"
        ;;
      yum)
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - 2>/dev/null && sudo yum install -y nodejs || fail "Node.js 升级失败"
        ;;
      pacman)
        sudo pacman -S --noconfirm nodejs npm || fail "Node.js 升级失败"
        ;;
      *)
        fail "无法自动升级 Node.js，请手动安装 Node.js >= 18"
        ;;
    esac
    ok "Node.js $(node -v) 安装完成"
  fi
else
  warn "Node.js 未安装，正在自动安装..."
  case "$PKG_MGR" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null && sudo apt install -y nodejs || fail "Node.js 安装失败，请手动安装 Node.js >= 18"
      ;;
    dnf)
      sudo dnf install -y nodejs || fail "Node.js 安装失败"
      ;;
    yum)
      curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - 2>/dev/null && sudo yum install -y nodejs || fail "Node.js 安装失败"
      ;;
    pacman)
      sudo pacman -S --noconfirm nodejs npm || fail "Node.js 安装失败"
      ;;
    *)
      fail "无法自动安装 Node.js，请手动安装 Node.js >= 18 后重新运行脚本"
      ;;
  esac
  ok "Node.js $(node -v) 安装完成"
fi

if command -v npm &>/dev/null; then
  ok "npm 已安装"
else
  warn "npm 未安装，正在安装..."
  pkg_install "$PKG_MGR" npm
  ok "npm 安装完成"
fi

# ========== Step 3: npm install & build ==========
info "正在安装依赖..."
npm install || fail "npm install 失败"
ok "依赖安装完成"

info "正在编译项目..."
npm run build || fail "npm run build 失败"
ok "编译完成"

# ========== Step 4: Interactive .env configuration ==========
if [ -f .env ]; then
  ok ".env 已存在，跳过配置"
else
  info "开始配置 .env 文件（必填项需输入，可选项直接回车跳过）"
  echo ""

  read -p "请输入 TG_BOT_TOKEN（必填，从 @BotFather 获取）: " TG_BOT_TOKEN
  while [ -z "$TG_BOT_TOKEN" ]; do
    warn "TG_BOT_TOKEN 不能为空"
    read -p "请输入 TG_BOT_TOKEN: " TG_BOT_TOKEN
  done

  read -p "请输入 TG_CHAT_ID（必填，接收通知的 Chat ID）: " TG_CHAT_ID
  while [ -z "$TG_CHAT_ID" ]; do
    warn "TG_CHAT_ID 不能为空"
    read -p "请输入 TG_CHAT_ID: " TG_CHAT_ID
  done

  read -p "请输入 TG_API_PROXY（可选，如 http://127.0.0.1:7890，回车跳过）: " TG_API_PROXY

  cat > .env <<EOF
# Telegram Bot（必填）
TG_BOT_TOKEN=${TG_BOT_TOKEN}
TG_CHAT_ID=${TG_CHAT_ID}
TG_API_PROXY=${TG_API_PROXY}

# Resend 邮件（可选，配置后启用邮件告警）
# RESEND_API_KEY=
# ALERT_EMAIL=
EOF

  ok ".env 配置完成"
fi

# ========== Step 5: accounts.json ==========
if [ -f accounts.json ]; then
  ok "accounts.json 已存在，跳过"
else
  cp accounts.json.example accounts.json
  warn "已从 accounts.json.example 创建 accounts.json"
  warn "请编辑 accounts.json 填入你的账号信息后重新运行！"
  echo ""
  echo -e "  编辑命令: ${CYAN}nano ${PROJECT_DIR}/accounts.json${NC}"
  echo ""
  read -p "是否现在编辑 accounts.json？[Y/n] " EDIT_NOW
  if [[ "$EDIT_NOW" =~ ^[Nn] ]]; then
    warn "请稍后手动编辑 accounts.json，完成后重新运行安装脚本"
    exit 0
  fi
  ${EDITOR:-nano} accounts.json
  ok "accounts.json 编辑完成"
fi

# ========== Step 6: Fix permissions ==========
info "正在修复文件权限..."

CURRENT_USER="$(whoami)"
mkdir -p logs

# Ensure current user owns everything
if [ "$(id -u)" -eq 0 ]; then
  # Running as root, chown to SUDO_USER if available
  TARGET_USER="${SUDO_USER:-$CURRENT_USER}"
  chown -R "$TARGET_USER":"$TARGET_USER" . 2>/dev/null || true
  warn "以 root 运行，已将文件所有者改为 ${TARGET_USER}"
else
  # Running as normal user, just ensure writable
  chmod -R u+rw . 2>/dev/null || true
fi

ok "文件权限修复完成"

# ========== Step 7: Start with tmux ==========
SESSION_NAME="keepalive"

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  warn "tmux session '${SESSION_NAME}' 已存在"
  read -p "是否重启？[Y/n] " RESTART_NOW
  if [[ ! "$RESTART_NOW" =~ ^[Nn] ]]; then
    tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
    sleep 1
  else
    ok "保持现有 session 运行"
    echo ""
    echo -e "  查看日志: ${CYAN}tmux attach -t ${SESSION_NAME}${NC}"
    exit 0
  fi
fi

if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
  su - "$SUDO_USER" -c "cd '${PROJECT_DIR}' && tmux new-session -d -s '${SESSION_NAME}' 'node dist/index.js 2>&1 | tee -a logs/console.log'"
else
  tmux new-session -d -s "$SESSION_NAME" "cd '${PROJECT_DIR}' && node dist/index.js 2>&1 | tee -a logs/console.log"
fi

ok "Keepalive 已在 tmux session '${SESSION_NAME}' 中启动"

# ========== Done ==========
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Keepalive 安装完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  查看日志:   ${CYAN}tmux attach -t ${SESSION_NAME}${NC}"
echo -e "  退出日志:   ${CYAN}Ctrl+B 然后按 D${NC}"
echo -e "  停止程序:   ${CYAN}tmux kill-session -t ${SESSION_NAME}${NC}"
echo -e "  重启程序:   ${CYAN}cd ${PROJECT_DIR} && tmux new-session -d -s ${SESSION_NAME} 'node dist/index.js 2>&1 | tee -a logs/console.log'${NC}"
echo ""
echo -e "  项目目录:   ${CYAN}${PROJECT_DIR}${NC}"
echo -e "  配置文件:   ${CYAN}${PROJECT_DIR}/.env${NC}"
echo -e "  账号文件:   ${CYAN}${PROJECT_DIR}/accounts.json${NC}"
echo ""

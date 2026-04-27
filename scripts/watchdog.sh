#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SESSION_NAME="keepalive"
LOG_FILE="${PROJECT_DIR}/logs/console.log"

mkdir -p "${PROJECT_DIR}/logs"

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  # tmux session exists, check if process is alive
  if ! tmux list-panes -t "$SESSION_NAME" -F "#{pane_dead}" 2>/dev/null | grep -q "0"; then
    echo "[$(date)] Keepalive tmux session exists but process is dead. Restarting..." >> "${LOG_FILE}"

    TG_BOT_TOKEN=$(grep TG_BOT_TOKEN "${PROJECT_DIR}/.env" | cut -d= -f2)
    TG_CHAT_ID=$(grep TG_CHAT_ID "${PROJECT_DIR}/.env" | cut -d= -f2)
    ALERT_EMAIL=$(grep ALERT_EMAIL "${PROJECT_DIR}/.env" | cut -d= -f2)

    # Send TG notification
    if [ -n "$TG_BOT_TOKEN" ] && [ -n "$TG_CHAT_ID" ]; then
      curl -s "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
        -d "chat_id=${TG_CHAT_ID}" \
        -d "text=💀 Keepalive 程序异常退出！Watchdog 正在重启..." \
        > /dev/null 2>&1
    fi

    # Send email notification
    if [ -n "$ALERT_EMAIL" ] && command -v python3 &>/dev/null; then
      SMTP_HOST=$(grep SMTP_HOST "${PROJECT_DIR}/.env" | cut -d= -f2)
      SMTP_PORT=$(grep SMTP_PORT "${PROJECT_DIR}/.env" | cut -d= -f2)
      SMTP_USER=$(grep SMTP_USER "${PROJECT_DIR}/.env" | cut -d= -f2)
      SMTP_PASS=$(grep SMTP_PASS "${PROJECT_DIR}/.env" | cut -d= -f2)
      SMTP_FROM=$(grep SMTP_FROM "${PROJECT_DIR}/.env" | cut -d= -f2)

      if [ -n "$SMTP_HOST" ] && [ -n "$SMTP_USER" ]; then
        python3 -c "
import smtplib
from email.mime.text import MIMEText
msg = MIMEText('Keepalive program died at $(date -Iseconds). Watchdog is restarting...')
msg['Subject'] = '💀 Keepalive 程序异常退出'
msg['From'] = '${SMTP_FROM}'
msg['To'] = '${ALERT_EMAIL}'
try:
    s = smtplib.SMTP('${SMTP_HOST}', ${SMTP_PORT:-587})
    s.starttls()
    s.login('${SMTP_USER}', '${SMTP_PASS}')
    s.send_message(msg)
    s.quit()
except: pass
" 2>/dev/null
      fi
    fi

    # Kill dead session and restart
    tmux kill-session -t "$SESSION_NAME" 2>/dev/null
    sleep 2
    tmux new-session -d -s "$SESSION_NAME" "cd ${PROJECT_DIR} && node dist/index.js 2>&1 | tee -a ${LOG_FILE}"
    echo "[$(date)] Keepalive restarted." >> "${LOG_FILE}"
  fi
else
  # No tmux session, start fresh
  echo "[$(date)] No keepalive session found. Starting..." >> "${LOG_FILE}"
  tmux new-session -d -s "$SESSION_NAME" "cd ${PROJECT_DIR} && node dist/index.js 2>&1 | tee -a ${LOG_FILE}"
  echo "[$(date)] Keepalive started." >> "${LOG_FILE}"
fi

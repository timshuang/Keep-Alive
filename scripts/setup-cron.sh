#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WATCHDOG_SCRIPT="${SCRIPT_DIR}/watchdog.sh"
CHECK_INTERVAL=$(grep WATCHDOG_CHECK_INTERVAL_HOURS "${PROJECT_DIR}/.env" 2>/dev/null | cut -d= -f2)
CHECK_INTERVAL=${CHECK_INTERVAL:-6}

echo "Setting up Keepalive cron jobs..."
echo ""
echo "  Watchdog: every ${CHECK_INTERVAL} hours"
echo "  Script: ${WATCHDOG_SCRIPT}"
echo ""

chmod +x "${WATCHDOG_SCRIPT}"

CRON_LINE="0 */${CHECK_INTERVAL} * * * ${WATCHDOG_SCRIPT}"

(crontab -l 2>/dev/null | grep -v "keepalive" | grep -v "watchdog.sh"; echo "${CRON_LINE}") | crontab -

echo "Cron job installed. Current crontab:"
echo ""
crontab -l
echo ""
echo "Done! Watchdog will check every ${CHECK_INTERVAL} hours."
echo ""
echo "Manual commands:"
echo "  Start:   tmux new-session -d -s keepalive 'cd ${PROJECT_DIR} && node dist/index.js 2>&1 | tee -a logs/console.log'"
echo "  View:    tmux attach -t keepalive"
echo "  Stop:    tmux kill-session -t keepalive"

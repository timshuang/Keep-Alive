import fs from 'fs';
import path from 'path';
import { loadConfig } from './config';
import { logger } from './logger';
import { HubClient } from './hub/client';
import {
  loadState,
  saveState,
  ensureAccountState,
  updatePlatformState,
  cleanOldDailyQueues,
  getTodayDate,
  syncAccountStates,
  DailyQueue,
  AppState,
} from './state';
import { connectCDP } from './cdp';
import { keepaliveGmail, keepaliveTwitter, keepaliveDiscord, ActionOutcome } from './actions';
import { Notifier } from './notifier';
import { computeDailyQueue, getScheduleItems, applyFirstRunStagger, randomDelaySeconds } from './scheduler';
import { PlatformName } from './detector';
import { AccountEntry, loadAccountsFromDisk } from './accounts';

const DAILY_WAKE_HOUR = 0;
const DAILY_WAKE_MINUTE = 5;

interface RuntimeContext {
  currentDate: string | null;
  accounts: AccountEntry[];
  activeAccounts: AccountEntry[];
  queue: DailyQueue | null;
}

function loadAccounts(): AccountEntry[] {
  try {
    return loadAccountsFromDisk();
  } catch (err) {
    logger.error(`Failed to load accounts.json: ${err}`);
    process.exit(1);
  }
}

function parseFilterArg(): Set<string> | null {
  const idx = process.argv.indexOf('--filter');
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  const raw = process.argv[idx + 1];
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  const expanded: string[] = [];
  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (start <= end) {
        const width = rangeMatch[1].length;
        for (let i = start; i <= end; i++) {
          expanded.push(String(i).padStart(width, '0'));
        }
      }
    } else {
      expanded.push(part);
    }
  }
  return new Set(expanded);
}

function filterAccounts(accounts: AccountEntry[], filterSet: Set<string>): AccountEntry[] {
  return accounts.filter(a => filterSet.has(a.containerName) || filterSet.has(a.containerCode));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getActiveAccounts(accounts: AccountEntry[]): AccountEntry[] {
  return accounts.filter(account => account.platforms.length > 0);
}

function getNextDailyWakeTime(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setHours(DAILY_WAKE_HOUR, DAILY_WAKE_MINUTE, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

async function waitUntilNextDailyWindow(): Promise<void> {
  const now = new Date();
  const next = getNextDailyWakeTime(now);
  const waitMs = next.getTime() - now.getTime();
  const waitMinutes = Math.max(1, Math.ceil(waitMs / 60000));
  logger.info(`Daily cycle complete. Sleeping until ${next.toLocaleString()} (${waitMinutes} min).`);
  await sleep(waitMs);
}

async function applyDailyStartDelay(config: ReturnType<typeof loadConfig>, isTestMode: boolean): Promise<void> {
  if (isTestMode) {
    logger.info('TEST MODE: skipping daily random delay');
    return;
  }

  const maxMinutes = config.scheduling.randomStartDelayMaxMin;
  if (maxMinutes <= 0) {
    return;
  }

  const delayMinutes = Math.floor(Math.random() * maxMinutes);
  const delaySeconds = delayMinutes * 60;
  logger.info(`Daily random start delay: ${delayMinutes} minutes`);

  for (let i = delaySeconds; i > 0; i -= 60) {
    const remaining = Math.ceil(i / 60);
    if (remaining % 30 === 0 || remaining <= 5) {
      logger.info(`Starting daily run in ${remaining} minutes...`);
    }
    await sleep(Math.min(i, 60) * 1000);
  }
}

function sendStatus(runtime: RuntimeContext, state: AppState, notifier: Notifier): void {
  const date = runtime.currentDate ?? getTodayDate();
  const queue = runtime.queue ?? state.dailyQueue[date];
  const pausedCount = runtime.accounts.length - runtime.activeAccounts.length;

  const lines = [
    `📮 ${date} 状态概览:`,
    `  活跃账号: ${runtime.activeAccounts.length}`,
    `  已暂停账号: ${pausedCount}`,
  ];

  if (queue) {
    lines.push(`  Gmail 队列: ${queue.gmail.length}`);
    lines.push(`  Twitter 队列: ${queue.twitter.length}`);
    lines.push(`  Discord 队列: ${queue.discord.length}`);
  } else {
    lines.push('  今日队列: 尚未生成');
  }

  lines.push('');
  lines.push('异常账号:');

  let abnormalCount = 0;
  for (const account of runtime.activeAccounts) {
    const accountState = state.accounts[account.containerCode];
    if (!accountState) {
      continue;
    }
    for (const platform of account.platforms) {
      const ps = accountState[platform];
      if (!ps || ps.status === 'ok') {
        continue;
      }
      abnormalCount++;
      lines.push(`  ${account.containerCode}/${platform}: ${ps.status}`);
    }
  }

  if (abnormalCount === 0) {
    lines.push('  无');
  }

  void notifier.send(lines.join('\n'));
}

async function runEnvironmentPrecheck(
  accounts: AccountEntry[],
  hub: HubClient
): Promise<Array<{ code: string; name: string; ok: boolean; detail: string }>> {
  logger.info('Running environment precheck...');
  const precheckResults: Array<{ code: string; name: string; ok: boolean; detail: string }> = [];

  const openedCodes = await hub.getOpenedContainerCodes();
  logger.info(`Hub: ${openedCodes.size} environments already open`);

  for (const account of accounts) {
    if (openedCodes.has(account.containerCode)) {
      precheckResults.push({ code: account.containerCode, name: account.containerName, ok: true, detail: '已开启' });
      logger.success(`${account.containerName} (${account.containerCode}): OK`);
    } else {
      precheckResults.push({ code: account.containerCode, name: account.containerName, ok: false, detail: '未开启' });
      logger.fail(`${account.containerName} (${account.containerCode}): 未开启`);
    }
  }

  return precheckResults;
}

async function runDailyCycle(
  config: ReturnType<typeof loadConfig>,
  state: AppState,
  hub: HubClient,
  notifier: Notifier,
  runtime: RuntimeContext,
  options: { isTestMode: boolean; isForceMode: boolean; filterSet: Set<string> | null }
): Promise<void> {
  const { isTestMode, isForceMode, filterSet } = options;
  const today = getTodayDate();
  runtime.currentDate = today;
  runtime.queue = null;

  let accounts = loadAccounts();
  logger.info(`Loaded ${accounts.length} accounts from accounts.json`);

  if (filterSet) {
    const before = accounts.length;
    accounts = filterAccounts(accounts, filterSet);
    if (accounts.length === 0) {
      logger.error(`--filter matched 0 accounts out of ${before}. Check your filter values.`);
      process.exit(1);
    }
    const names = accounts.map(a => a.containerName).join(', ');
    logger.info(`--filter: ${accounts.length}/${before} accounts selected (${names})`);
  }

  runtime.accounts = accounts;
  runtime.activeAccounts = getActiveAccounts(accounts);

  syncAccountStates(state, accounts);
  cleanOldDailyQueues(state);

  if (isForceMode) {
    let resetCount = 0;
    for (const account of runtime.activeAccounts) {
      const accountState = state.accounts[account.containerCode];
      if (!accountState) continue;
      for (const platform of account.platforms) {
        const ps = accountState[platform];
        if (ps && ps.status !== 'ok') {
          logger.info(`[FORCE] Resetting ${account.containerName}/${platform}: ${ps.status} -> ok`);
          ps.status = 'ok';
          ps.lastAlert = undefined;
          ps.alertDetail = undefined;
          resetCount++;
        }
      }
    }
    if (resetCount > 0) {
      logger.info(`[FORCE] Reset ${resetCount} platform(s) to ok status`);
    }
  }

  for (const account of runtime.activeAccounts) {
    ensureAccountState(state, account.containerCode, account.platforms);
  }

  applyFirstRunStagger(runtime.activeAccounts, state, config);
  saveState(state);

  if (runtime.activeAccounts.length === 0) {
    logger.info('No active accounts configured for today.');
    await notifier.send('📋 当前没有启用保活渠道的账号，今日跳过执行。');
    return;
  }

  await applyDailyStartDelay(config, isTestMode);

  const precheckResults = await runEnvironmentPrecheck(runtime.activeAccounts, hub);
  await notifier.sendPrecheck(precheckResults);

  if (precheckResults.some(result => !result.ok)) {
    logger.error('Environment precheck failed for this daily cycle. Skipping execution until next day.');
    await notifier.send('❌ 环境预检失败，今日保活已跳过。请检查未开启环境，新的账号配置将在下一自然日生效。');
    return;
  }

  logger.info('Computing daily queue...');
  const queue = computeDailyQueue(runtime.activeAccounts, state, config, isForceMode);
  runtime.queue = queue;
  saveState(state);

  const items = getScheduleItems(runtime.activeAccounts, queue);
  logger.info(`Today's schedule: ${items.length} operations`);

  if (items.length === 0) {
    logger.info('No active accounts due for keepalive today.');
    await notifier.send('📋 今日没有到期的活跃账号需要保活。');
    return;
  }

  const outcomes: Array<ActionOutcome & { code: string; name: string }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    logger.info(`[${i + 1}/${items.length}] Processing ${item.containerName}/${item.platform}`);

    try {
      const envResult = await hub.ensureEnvOpen(item.containerCode);
      if (!envResult.success || !envResult.debuggingPort) {
        logger.error(`Failed to get debuggingPort for ${item.containerCode}: ${envResult.error}`);
        outcomes.push({
          platform: item.platform as PlatformName,
          success: false,
          reason: envResult.error,
          code: item.containerCode,
          name: item.containerName,
        });
        updatePlatformState(state, item.containerCode, item.platform, { status: 'error' });
        continue;
      }

      const session = await connectCDP(envResult.debuggingPort, config);

      try {
        const { page, close } = await session.newPage();

        let result: ActionOutcome;

        switch (item.platform) {
          case 'gmail':
            result = await keepaliveGmail(page, config);
            break;
          case 'twitter':
            result = await keepaliveTwitter(page, config);
            break;
          case 'discord':
            result = await keepaliveDiscord(page, config);
            break;
          default:
            result = { platform: item.platform as PlatformName, success: false, reason: 'Unknown platform' };
        }

        const outcome: ActionOutcome & { code: string; name: string } = {
          ...result,
          code: item.containerCode,
          name: item.containerName,
        };
        outcomes.push(outcome);

        if (outcome.success) {
          updatePlatformState(state, item.containerCode, item.platform, {
            lastRun: new Date().toISOString(),
            status: 'ok',
          });
          logger.success(`${item.containerName}/${item.platform}: OK`);
        } else {
          updatePlatformState(state, item.containerCode, item.platform, {
            status: 'verification_required',
            lastAlert: new Date().toISOString(),
            alertDetail: outcome.reason,
          });
          logger.fail(`${item.containerName}/${item.platform}: ${outcome.reason}`);
          await notifier.sendAlert(item.containerCode, item.containerName, outcome.platform, outcome.reason || 'Unknown', outcome.url);
        }

        await close();
      } finally {
        await session.close();
      }
    } catch (err) {
      logger.error(`Error processing ${item.containerCode}/${item.platform}: ${err}`);
      outcomes.push({
        platform: item.platform as PlatformName,
        success: false,
        reason: String(err),
        code: item.containerCode,
        name: item.containerName,
      });
    }

    if (i < items.length - 1) {
      const waitSec = randomDelaySeconds(config.scheduling.accountIntervalMinSec, config.scheduling.accountIntervalMaxSec);
      logger.info(`Waiting ${waitSec}s before next account...`);
      await sleep(waitSec * 1000);
    }
  }

  cleanOldDailyQueues(state);
  saveState(state);

  await notifier.sendDailyReport(outcomes, runtime.activeAccounts);

  logger.banner('Keepalive 完成', {
    '总操作': outcomes.length,
    '成功': outcomes.filter(o => o.success).length,
    '失败': outcomes.filter(o => !o.success).length,
  });
}

async function main(): Promise<void> {
  if (process.argv.includes('--reset')) {
    const statePath = path.resolve(process.cwd(), 'state.json');
    try {
      if (fs.existsSync(statePath)) {
        fs.unlinkSync(statePath);
        logger.info('state.json deleted. System state has been reset.');
      } else {
        logger.info('state.json does not exist. Nothing to reset.');
      }
    } catch (err) {
      logger.error(`Failed to delete state.json: ${err}`);
      process.exit(1);
    }
    process.exit(0);
  }

  const isTestMode = process.argv.includes('--test');
  const isForceMode = process.argv.includes('--force');
  const filterSet = parseFilterArg();

  if (isTestMode) {
    logger.info('TEST MODE: single daily cycle with no startup delay');
  }
  if (isForceMode) {
    logger.info('FORCE MODE: ignoring intervals, status checks, and daily queue cache for this cycle');
  }

  logger.banner('Keepalive 服务启动中...', {});

  const config = loadConfig();
  const state = loadState();
  const hub = new HubClient(config);
  const notifier = new Notifier(config);
  const runtime: RuntimeContext = {
    currentDate: null,
    accounts: [],
    activeAccounts: [],
    queue: null,
  };

  logger.info('Testing Telegram connection...');
  const tgResult = await notifier.testConnection();
  if (tgResult.ok) {
    logger.success(`✅ Telegram 连接成功 (bot: @${tgResult.botUsername})`);
  } else {
    if (config.telegram.apiProxy) {
      logger.error(`❌ Telegram 连接失败（已配置代理 ${config.telegram.apiProxy}）。请检查代理地址是否正确、代理服务是否正常运行。`);
    } else {
      logger.error('❌ Telegram 连接失败（无法直连，请配置代理）。请在 .env 中配置 TG_API_PROXY 后重试。');
    }
    process.exit(1);
  }

  notifier.onReset = (code: string, platform: PlatformName) => {
    updatePlatformState(state, code, platform, { status: 'ok', lastAlert: undefined, alertDetail: undefined });
    void notifier.send(`✅ 已重置 ${code}/${platform} 状态为 ok`);
  };

  notifier.onStatus = () => {
    sendStatus(runtime, state, notifier);
  };

  notifier.onReboot = () => {
    logger.info('TG: reboot requested, exiting process for PM2 restart');
    process.exit(0);
  };

  await notifier.sendStartupGuide();

  const singleRunMode = isTestMode || isForceMode || filterSet !== null;

  try {
    if (singleRunMode) {
      await runDailyCycle(config, state, hub, notifier, runtime, { isTestMode, isForceMode, filterSet });
      await notifier.stop();
      return;
    }

    let lastProcessedDate: string | null = null;
    while (true) {
      const today = getTodayDate();
      if (today !== lastProcessedDate) {
        await runDailyCycle(config, state, hub, notifier, runtime, { isTestMode: false, isForceMode: false, filterSet: null });
        lastProcessedDate = today;
      }
      if (getTodayDate() !== lastProcessedDate) {
        continue;
      }
      await waitUntilNextDailyWindow();
    }
  } catch (err) {
    await notifier.stop();
    throw err;
  }
}

main().catch(async err => {
  logger.error(`Fatal error: ${err}`);
  process.exit(1);
});

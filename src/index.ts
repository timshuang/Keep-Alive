import fs from 'fs';
import path from 'path';
import { startAdminServer, RuntimeStatusPayload } from './admin-server';
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

type RuntimePhase = RuntimeStatusPayload['phase'];
type DailyCycleMode = 'automatic' | 'manual-recover';

interface RuntimeContext {
  currentDate: string | null;
  accounts: AccountEntry[];
  activeAccounts: AccountEntry[];
  queue: DailyQueue | null;
}

interface DailyCycleOptions {
  isTestMode: boolean;
  isForceMode: boolean;
  filterSet: Set<string> | null;
  skipStartDelay: boolean;
  mode: DailyCycleMode;
}

interface DailyCycleResult {
  status: 'completed' | 'precheck_failed' | 'interrupted';
}

interface RuntimeControl {
  setPhase: (phase: RuntimePhase, message: string) => void;
  setWaitingCountdown: (message: string, expectedStartAt: Date) => void;
  getSnapshot: () => RuntimeStatusPayload;
  registerWaitCanceler: (canceler: (() => void) | null) => void;
  requestManualRecover: () => { success: boolean; message: string };
  consumeManualRecoverRequest: () => boolean;
  finishManualRecover: () => void;
}

function createRuntimeControl(): RuntimeControl {
  let phase: RuntimePhase = 'starting';
  let message = '服务启动中';
  let recoveryInProgress = false;
  let manualRecoverRequested = false;
  let waitCanceler: (() => void) | null = null;
  let expectedStartAtMs: number | null = null;

  function setPhase(nextPhase: RuntimePhase, nextMessage: string): void {
    phase = nextPhase;
    message = nextMessage;
    if (nextPhase !== 'idle_waiting') {
      expectedStartAtMs = null;
    }
  }

  function setWaitingCountdown(nextMessage: string, expectedStartAt: Date): void {
    phase = 'idle_waiting';
    message = nextMessage;
    expectedStartAtMs = expectedStartAt.getTime();
  }

  function canRecover(): boolean {
    return !recoveryInProgress && (phase === 'idle_waiting' || phase === 'precheck_failed');
  }

  return {
    setPhase,
    setWaitingCountdown,
    getSnapshot: () => ({
      phase,
      canRecover: canRecover(),
      recoveryInProgress,
      message,
      countdownSeconds: phase === 'idle_waiting' && expectedStartAtMs !== null
        ? Math.max(0, Math.ceil((expectedStartAtMs - Date.now()) / 1000))
        : null,
      expectedStartAt: phase === 'idle_waiting' && expectedStartAtMs !== null
        ? new Date(expectedStartAtMs).toISOString()
        : null,
    }),
    registerWaitCanceler: canceler => {
      waitCanceler = canceler;
    },
    requestManualRecover: () => {
      if (recoveryInProgress) {
        return { success: false, message: '当前正在恢复今日任务，请稍候。' };
      }

      if (phase === 'running') {
        return { success: false, message: '当前任务执行中，无需重复触发。' };
      }

      if (phase === 'completed') {
        return { success: false, message: '今日任务已完成，不会重复启动。' };
      }

      if (phase === 'starting') {
        return { success: false, message: '服务仍在启动中，请稍后再试。' };
      }

      if (phase !== 'idle_waiting' && phase !== 'precheck_failed') {
        return { success: false, message: '当前状态不支持手动恢复。' };
      }

      manualRecoverRequested = true;
      recoveryInProgress = true;
      expectedStartAtMs = null;
      message = '已收到手动恢复请求，准备立即预检。';

      if (waitCanceler) {
        const cancel = waitCanceler;
        waitCanceler = null;
        cancel();
      }

      return { success: true, message: '已开始立即预检，预检通过后会继续今日未完成任务。' };
    },
    consumeManualRecoverRequest: () => {
      if (!manualRecoverRequested) {
        return false;
      }
      manualRecoverRequested = false;
      return true;
    },
    finishManualRecover: () => {
      recoveryInProgress = false;
    },
  };
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

function sleepInterruptibly(ms: number, runtimeControl: RuntimeControl): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      runtimeControl.registerWaitCanceler(null);
      resolve(true);
    }, ms);

    runtimeControl.registerWaitCanceler(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      runtimeControl.registerWaitCanceler(null);
      resolve(false);
    });
  });
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

async function waitUntilNextDailyWindow(runtimeControl: RuntimeControl): Promise<boolean> {
  const now = new Date();
  const next = getNextDailyWakeTime(now);
  const waitMs = next.getTime() - now.getTime();
  const waitMinutes = Math.max(1, Math.ceil(waitMs / 60000));
  logger.info(`Sleeping until ${next.toLocaleString()} (${waitMinutes} min).`);
  return sleepInterruptibly(waitMs, runtimeControl);
}

async function applyDailyStartDelay(
  config: ReturnType<typeof loadConfig>,
  isTestMode: boolean,
  skipStartDelay: boolean,
  runtimeControl: RuntimeControl
): Promise<boolean> {
  if (isTestMode || skipStartDelay) {
    if (isTestMode) {
      logger.info('TEST MODE: skipping daily random delay');
    } else {
      logger.info('Manual recover: skipping daily random delay');
    }
    return true;
  }

  const maxMinutes = config.scheduling.randomStartDelayMaxMin;
  if (maxMinutes <= 0) {
    return true;
  }

  const delayMinutes = Math.floor(Math.random() * maxMinutes);
  const delaySeconds = delayMinutes * 60;
  logger.info(`Daily random start delay: ${delayMinutes} minutes`);

  if (delaySeconds <= 0) {
    return true;
  }

  runtimeControl.setPhase('idle_waiting', `今日任务等待随机延迟结束，约 ${delayMinutes} 分钟后开始。`);

  const expectedStartAt = new Date(Date.now() + delaySeconds * 1000);
  runtimeControl.setWaitingCountdown(
    `今日任务等待随机延迟结束，距离开始还有 ${delaySeconds} 秒，预计 ${expectedStartAt.toLocaleTimeString('zh-CN', { hour12: false })} 开始。`,
    expectedStartAt
  );

  for (let remainingSeconds = delaySeconds; remainingSeconds > 0; remainingSeconds -= 60) {
    const remainingMinutes = Math.ceil(remainingSeconds / 60);
    if (remainingMinutes % 30 === 0 || remainingMinutes <= 5) {
      logger.info(`Starting daily run in ${remainingMinutes} minutes...`);
    }

    const slept = await sleepInterruptibly(Math.min(remainingSeconds, 60) * 1000, runtimeControl);
    if (!slept) {
      logger.info('Daily random delay interrupted by manual recover request.');
      return false;
    }
  }

  return true;
}

function sendStatus(runtime: RuntimeContext, state: AppState, notifier: Notifier): void {
  const date = runtime.currentDate ?? getTodayDate();
  const queue = runtime.queue ?? state.dailyQueue[date];
  const pausedCount = runtime.accounts.length - runtime.activeAccounts.length;

  const lines = [
    `📦 ${date} 状态概览`,
    `活跃账号: ${runtime.activeAccounts.length}`,
    `已暂停账号: ${pausedCount}`,
  ];

  if (queue) {
    lines.push(`Gmail 队列: ${queue.gmail.length}`);
    lines.push(`Twitter 队列: ${queue.twitter.length}`);
    lines.push(`Discord 队列: ${queue.discord.length}`);
  } else {
    lines.push('今日队列: 尚未生成');
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
      lines.push(`${account.containerCode}/${platform}: ${ps.status}`);
    }
  }

  if (abnormalCount === 0) {
    lines.push('无');
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
  runtimeControl: RuntimeControl,
  options: DailyCycleOptions
): Promise<DailyCycleResult> {
  const { isTestMode, isForceMode, filterSet, skipStartDelay, mode } = options;
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
    runtimeControl.setPhase('completed', '当前没有启用保活渠道的账号。');
    logger.info('No active accounts configured for today.');
    await notifier.send('📭 当前没有启用保活渠道的账号，今日跳过执行。');
    return { status: 'completed' };
  }

  const delayFinished = await applyDailyStartDelay(config, isTestMode, skipStartDelay, runtimeControl);
  if (!delayFinished) {
    return { status: 'interrupted' };
  }

  runtimeControl.setPhase('running', mode === 'manual-recover' ? '正在执行手动预检。' : '正在执行今日环境预检。');

  const precheckResults = await runEnvironmentPrecheck(runtime.activeAccounts, hub);
  await notifier.sendPrecheck(precheckResults);

  if (precheckResults.some(result => !result.ok)) {
    runtimeControl.setPhase('precheck_failed', '环境预检失败，可手动补开指纹环境后再次恢复。');
    logger.error('Environment precheck failed for this daily cycle. Skipping execution until next day.');
    await notifier.send('❌ 环境预检失败，今日保活已跳过。请检查未开启环境，新的账号配置将在下一自然日生效。');
    return { status: 'precheck_failed' };
  }

  if (mode === 'manual-recover') {
    await notifier.send('✅ 手动预检已通过，开始恢复今日未完成任务。');
  }

  logger.info('Computing daily queue...');
  const queue = computeDailyQueue(runtime.activeAccounts, state, config, isForceMode);
  runtime.queue = queue;
  saveState(state);

  const items = getScheduleItems(runtime.activeAccounts, queue, state);
  logger.info(`Today's schedule: ${items.length} operations`);

  if (items.length === 0) {
    runtimeControl.setPhase('completed', '今日任务已完成，无需额外恢复。');
    logger.info('No active accounts due for keepalive today.');
    await notifier.send(mode === 'manual-recover'
      ? 'ℹ️ 手动预检通过，但今日没有未完成的到期任务。'
      : '📭 今日没有到期的活跃账号需要保活。');
    return { status: 'completed' };
  }

  runtimeControl.setPhase(
    'running',
    mode === 'manual-recover'
      ? `正在恢复今日未完成任务，共 ${items.length} 项。`
      : `正在执行今日任务，共 ${items.length} 项。`
  );

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

        const pauseMs = 2000 + Math.random() * 1000;
        logger.info(`Closing tab in ${Math.round(pauseMs / 1000)}s...`);
        await sleep(pauseMs);
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

  runtimeControl.setPhase('completed', '今日任务已完成，等待下一自然日。');
  return { status: 'completed' };
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
  const runtimeControl = createRuntimeControl();
  const runtime: RuntimeContext = {
    currentDate: null,
    accounts: [],
    activeAccounts: [],
    queue: null,
  };

  await startAdminServer({
    hub,
    state,
    onRestartService: () => {
      logger.info('Admin: restart requested, exiting process for PM2 restart');
      process.exit(0);
    },
    onRecoverToday: async () => runtimeControl.requestManualRecover(),
    getRuntimeStatus: () => runtimeControl.getSnapshot(),
  });

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
      await runDailyCycle(config, state, hub, notifier, runtime, runtimeControl, {
        isTestMode,
        isForceMode,
        filterSet,
        skipStartDelay: false,
        mode: 'automatic',
      });
      await notifier.stop();
      return;
    }

    let lastProcessedDate: string | null = null;
    while (true) {
      const today = getTodayDate();
      if (today !== lastProcessedDate) {
        const result = await runDailyCycle(config, state, hub, notifier, runtime, runtimeControl, {
          isTestMode: false,
          isForceMode: false,
          filterSet: null,
          skipStartDelay: false,
          mode: 'automatic',
        });

        if (result.status !== 'interrupted') {
          lastProcessedDate = today;
        }
      }

      if (runtimeControl.consumeManualRecoverRequest()) {
        const result = await runDailyCycle(config, state, hub, notifier, runtime, runtimeControl, {
          isTestMode: false,
          isForceMode: false,
          filterSet: null,
          skipStartDelay: true,
          mode: 'manual-recover',
        });
        runtimeControl.finishManualRecover();
        if (result.status !== 'interrupted') {
          lastProcessedDate = getTodayDate();
        }
        continue;
      }

      const snapshot = runtimeControl.getSnapshot();
      if (snapshot.phase === 'precheck_failed') {
        const waited = await waitUntilNextDailyWindow(runtimeControl);
        if (!waited) {
          continue;
        }
        continue;
      }

      runtimeControl.setPhase('completed', snapshot.message || '今日任务已完成，等待下一自然日。');
      const waited = await waitUntilNextDailyWindow(runtimeControl);
      if (!waited) {
        continue;
      }
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

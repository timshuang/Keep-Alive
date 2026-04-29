import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { loadConfig } from './config';
import { logger } from './logger';
import { HubClient } from './hub/client';
import { loadState, saveState, ensureAccountState, updatePlatformState, cleanOldDailyQueues, getTodayDate } from './state';
import { connectCDP } from './cdp';
import { keepaliveGmail, keepaliveTwitter, keepaliveDiscord, ActionOutcome } from './actions';
import { Notifier } from './notifier';
import { computeDailyQueue, getScheduleItems, applyFirstRunStagger, randomDelaySeconds } from './scheduler';
import { PlatformName } from './detector';

interface AccountEntry {
  containerCode: string;
  containerName: string;
  platforms: string[];
}

function loadAccounts(): AccountEntry[] {
  try {
    const accountsPath = path.resolve(process.cwd(), 'accounts.json');
    const raw = fs.readFileSync(accountsPath, 'utf-8');
    return JSON.parse(raw) as AccountEntry[];
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
  if (isTestMode) {
    logger.info('⚠️  TEST MODE: skipping random delay');
  }
  if (isForceMode) {
    logger.info('⚠️  FORCE MODE: ignoring intervals, status checks, and daily queue cache');
  }

  logger.banner('Keepalive 启动中...', {});

  const config = loadConfig();
  logger.info('Config loaded');

  let accounts = loadAccounts();
  logger.info(`Loaded ${accounts.length} accounts from accounts.json`);

  const filterSet = parseFilterArg();
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

  const state = loadState();
  logger.info('State loaded');

  if (isForceMode) {
    let resetCount = 0;
    for (const account of accounts) {
      const accountState = state.accounts[account.containerCode];
      if (!accountState) continue;
      for (const platform of account.platforms) {
        const ps = accountState[platform];
        if (ps && ps.status !== 'ok') {
          logger.info(`[FORCE] Resetting ${account.containerName}/${platform}: ${ps.status} → ok`);
          ps.status = 'ok';
          ps.lastAlert = undefined;
          ps.alertDetail = undefined;
          resetCount++;
        }
      }
    }
    if (resetCount > 0) {
      saveState(state);
      logger.info(`[FORCE] Reset ${resetCount} platform(s) to ok status`);
    }
  }

  for (const account of accounts) {
    ensureAccountState(state, account.containerCode, account.platforms);
  }

  applyFirstRunStagger(accounts, state, config);
  saveState(state);

  const hub = new HubClient(config);
  const notifier = new Notifier(config);

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
    notifier.send(`✅ 已重置 ${code}/${platform} 状态为 ok`);
  };

  notifier.onStatus = () => {
    const today = getTodayDate();
    const queue = state.dailyQueue[today];
    if (!queue) {
      notifier.send('📋 今日尚未计算队列');
      return;
    }

    const lines = [
      `📅 ${today} 队列:`,
      `  Gmail: ${queue.gmail.length} 个`,
      `  Twitter: ${queue.twitter.length} 个`,
      `  Discord: ${queue.discord.length} 个`,
      '',
      '异常账号:',
    ];

    for (const [code, accState] of Object.entries(state.accounts)) {
      for (const [platform, ps] of Object.entries(accState)) {
        if ((ps as any).status !== 'ok') {
          lines.push(`  ${code}/${platform}: ${(ps as any).status}`);
        }
      }
    }

    notifier.send(lines.join('\n'));
  };

  notifier.onReboot = () => {
    spawn('node', [path.resolve(__dirname, 'index.js')], {
      detached: true,
      stdio: 'ignore',
      cwd: process.cwd(),
    }).unref();
    process.exit(0);
  };

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

  await notifier.sendPrecheck(precheckResults);

  const hasFailures = precheckResults.some(r => !r.ok);
  if (hasFailures) {
    logger.error('Environment precheck failed. Stopping.');
    await notifier.send('❌ 环境预检失败，程序已停止。请检查失败环境后重新运行。');
    process.exit(1);
  }

  await notifier.sendStartupGuide();

  logger.banner('🎉 Keepalive 已启动', {
    'Gmail 频率': `每 ${config.intervals.gmail - config.jitter.gmail}-${config.intervals.gmail + config.jitter.gmail} 天`,
    'Twitter 频率': `每 ${config.intervals.twitter - config.jitter.twitter}-${config.intervals.twitter + config.jitter.twitter} 天`,
    'Discord 频率': `每 ${config.intervals.discord - config.jitter.discord}-${config.intervals.discord + config.jitter.discord} 天`,
  });

  if (isTestMode) {
    logger.info('TEST MODE: Skipping random delay');
  } else {
    const delayMinutes = Math.floor(Math.random() * config.scheduling.randomStartDelayMaxMin);
    const delaySeconds = delayMinutes * 60;
    logger.info(`Random start delay: ${delayMinutes} minutes`);

    for (let i = delaySeconds; i > 0; i -= 60) {
      const remaining = Math.ceil(i / 60);
      if (remaining % 30 === 0 || remaining <= 5) {
        logger.info(`Starting in ${remaining} minutes...`);
      }
      await sleep(Math.min(i, 60) * 1000);
    }
  }

  logger.info('Computing daily queue...');
  const queue = computeDailyQueue(accounts, state, config, isForceMode);
  saveState(state);

  const items = getScheduleItems(accounts, queue);
  logger.info(`Today's schedule: ${items.length} operations`);

  if (items.length === 0) {
    logger.info('No accounts due for keepalive today.');
    await notifier.send('📋 今日无账号需要保活。');
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

  await notifier.sendDailyReport(outcomes, accounts);

  logger.banner('Keepalive 完成', {
    '总操作': outcomes.length,
    '成功': outcomes.filter(o => o.success).length,
    '失败': outcomes.filter(o => !o.success).length,
  });

  await notifier.stop();
}

main().catch(async (err) => {
  logger.error(`Fatal error: ${err}`);
  process.exit(1);
});

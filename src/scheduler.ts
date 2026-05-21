import { toLocalISO } from './timezone';
import { Config } from './config';
import { logger } from './logger';
import { AppState, DailyQueue, getTodayDate, isRunToday, PlatformState } from './state';

export interface AccountConfig {
  containerCode: string;
  containerName: string;
  platforms: string[];
}

interface ScheduleItem {
  containerCode: string;
  containerName: string;
  platform: string;
}

function randomJitter(jitter: number): number {
  return Math.floor(Math.random() * (jitter * 2 + 1)) - jitter;
}

function isExpired(lastRun: string | null, intervalDays: number, jitterDays: number): boolean {
  if (!lastRun) return true;

  const last = new Date(lastRun).getTime();
  const now = Date.now();

  const effectiveInterval = (intervalDays + randomJitter(jitterDays)) * 86400 * 1000;

  return now >= last + effectiveInterval;
}

export function computeDailyQueue(
  accounts: AccountConfig[],
  state: AppState,
  config: Config,
  forceMode: boolean = false
): DailyQueue {
  const today = getTodayDate();

  if (!forceMode && state.dailyQueue[today]) {
    logger.info(`Scheduler: Using cached daily queue for ${today}`);
    return state.dailyQueue[today];
  }

  const queue: DailyQueue = { gmail: [], twitter: [], discord: [] };

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const accountState = state.accounts[account.containerCode];

    for (const platform of account.platforms) {
      const platformKey = platform as keyof DailyQueue;
      if (platformKey !== 'gmail' && platformKey !== 'twitter' && platformKey !== 'discord') continue;

      const ps: PlatformState | undefined = accountState?.[platform];
      const lastRun = ps?.lastRun ?? null;
      const status = ps?.status ?? 'ok';

      if (!forceMode && status !== 'ok') {
        logger.info(`Scheduler: Skipping ${account.containerCode}/${platform} (status=${status})`);
        continue;
      }

      if (!forceMode && isRunToday(lastRun)) {
        logger.info(`Scheduler: Skipping ${account.containerCode}/${platform} (already run today)`);
        continue;
      }

      if (forceMode) {
        queue[platformKey].push(account.containerCode);
        logger.info(`Scheduler: [FORCE] ${account.containerCode}/${platform} added to queue`);
      } else {
        const interval = config.intervals[platformKey];
        const jitter = config.jitter[platformKey];

        if (isExpired(lastRun, interval, jitter)) {
          queue[platformKey].push(account.containerCode);
          logger.info(`Scheduler: ${account.containerCode}/${platform} is due (lastRun=${lastRun}, interval=${interval}d±${jitter}d)`);
        }
      }
    }

    if (!accountState) {
      for (const platform of account.platforms) {
        const platformKey = platform as keyof DailyQueue;
        if (platformKey === 'gmail' || platformKey === 'twitter' || platformKey === 'discord') {
          const staggerDays = i % config.intervals[platformKey];
          if (staggerDays === 0 || forceMode) {
            queue[platformKey].push(account.containerCode);
          }
          logger.info(`Scheduler: First run stagger for ${account.containerCode}/${platform} (stagger=${staggerDays}d)`);
        }
      }
    }
  }

  state.dailyQueue[today] = queue;
  logger.info(`Scheduler: Daily queue for ${today}${forceMode ? ' [FORCE]' : ''} - Gmail: ${queue.gmail.length}, Twitter: ${queue.twitter.length}, Discord: ${queue.discord.length}`);

  return queue;
}

export function getScheduleItems(accounts: AccountConfig[], queue: DailyQueue, state?: AppState): ScheduleItem[] {
  const accountMap = new Map(accounts.map(a => [a.containerCode, a]));
  const items: ScheduleItem[] = [];

  const allCodes = new Set<string>();
  for (const codes of Object.values(queue)) {
    for (const code of codes) {
      allCodes.add(code);
    }
  }

  for (const code of allCodes) {
    const account = accountMap.get(code);
    if (!account) continue;

    for (const platform of account.platforms) {
      const platformKey = platform as keyof DailyQueue;
      if (platformKey !== 'gmail' && platformKey !== 'twitter' && platformKey !== 'discord') continue;

      if (queue[platformKey].includes(code)) {
        const platformState = state?.accounts[code]?.[platform];
        if (platformState) {
          if (platformState.status !== 'ok') {
            logger.info(`Scheduler: Skipping ${code}/${platform} during resume (status=${platformState.status})`);
            continue;
          }
          if (isRunToday(platformState.lastRun)) {
            logger.info(`Scheduler: Skipping ${code}/${platform} during resume (already run today)`);
            continue;
          }
        }

        items.push({
          containerCode: code,
          containerName: account.containerName,
          platform,
        });
      }
    }
  }

  return shuffleArray(items);
}

export function applyFirstRunStagger(
  accounts: AccountConfig[],
  state: AppState,
  config: Config
): void {
  const now = Date.now();

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    if (!state.accounts[account.containerCode]) {
      state.accounts[account.containerCode] = {};
    }

    for (const platform of account.platforms) {
      const platformKey = platform as keyof DailyQueue;
      if (platformKey !== 'gmail' && platformKey !== 'twitter' && platformKey !== 'discord') continue;

      if (!state.accounts[account.containerCode][platform] || state.accounts[account.containerCode][platform].lastRun === null) {
        const staggerDays = i % config.intervals[platformKey];
        const staggerMs = staggerDays * 86400 * 1000;
        const lastRun = toLocalISO(new Date(now - staggerMs));

        state.accounts[account.containerCode][platform] = {
          lastRun,
          status: 'ok',
        };

        logger.info(`Stagger: ${account.containerCode}/${platform} lastRun set to ${lastRun} (stagger=${staggerDays}d)`);
      }
    }
  }
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function randomDelaySeconds(minSec: number, maxSec: number): number {
  return Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec;
}

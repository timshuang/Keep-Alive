import fs from 'fs';
import path from 'path';
import { logger } from './logger';

export type PlatformStatus = 'ok' | 'verification_required' | 'error';

export interface PlatformState {
  lastRun: string | null;
  status: PlatformStatus;
  lastAlert?: string;
  alertDetail?: string;
}

export interface AccountState {
  [platform: string]: PlatformState;
}

export interface DailyQueue {
  gmail: string[];
  twitter: string[];
  discord: string[];
}

export interface AppState {
  version: number;
  accounts: {
    [containerCode: string]: AccountState;
  };
  dailyQueue: {
    [date: string]: DailyQueue;
  };
}

const STATE_FILE = path.resolve(process.cwd(), 'state.json');

function createDefaultPlatformState(): PlatformState {
  return { lastRun: null, status: 'ok' };
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function loadState(): AppState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(raw) as AppState;
    }
  } catch (err) {
    logger.error(`Failed to load state.json: ${err}`);
  }

  return {
    version: 1,
    accounts: {},
    dailyQueue: {},
  };
}

export function saveState(state: AppState): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    logger.error(`Failed to save state.json: ${err}`);
  }
}

export function ensureAccountState(state: AppState, containerCode: string, platforms: string[]): void {
  if (!state.accounts[containerCode]) {
    state.accounts[containerCode] = {};
  }
  for (const platform of platforms) {
    if (!state.accounts[containerCode][platform]) {
      state.accounts[containerCode][platform] = createDefaultPlatformState();
    }
  }
}

export function syncAccountStates(
  state: AppState,
  accounts: Array<{ containerCode: string; platforms: string[] }>
): void {
  const accountMap = new Map(accounts.map(account => [account.containerCode, new Set(account.platforms)]));

  for (const containerCode of Object.keys(state.accounts)) {
    const enabledPlatforms = accountMap.get(containerCode);
    if (!enabledPlatforms || enabledPlatforms.size === 0) {
      delete state.accounts[containerCode];
      continue;
    }

    for (const platform of Object.keys(state.accounts[containerCode])) {
      if (!enabledPlatforms.has(platform)) {
        delete state.accounts[containerCode][platform];
      }
    }

    if (Object.keys(state.accounts[containerCode]).length === 0) {
      delete state.accounts[containerCode];
    }
  }
}

export function updatePlatformState(
  state: AppState,
  containerCode: string,
  platform: string,
  update: Partial<PlatformState>
): void {
  if (!state.accounts[containerCode]) {
    state.accounts[containerCode] = {};
  }
  if (!state.accounts[containerCode][platform]) {
    state.accounts[containerCode][platform] = createDefaultPlatformState();
  }
  Object.assign(state.accounts[containerCode][platform], update);
  saveState(state);
}

export function getTodayDate(): string {
  return formatLocalDate(new Date());
}

export function cleanOldDailyQueues(state: AppState, keepDays: number = 7): void {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);
  const cutoffStr = formatLocalDate(cutoff);

  for (const date of Object.keys(state.dailyQueue)) {
    if (date < cutoffStr) {
      delete state.dailyQueue[date];
    }
  }
}

export function isRunToday(lastRun: string | null): boolean {
  if (!lastRun) return false;
  return lastRun.slice(0, 10) === getTodayDate();
}

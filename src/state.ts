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
  return new Date().toISOString().slice(0, 10);
}

export function cleanOldDailyQueues(state: AppState, keepDays: number = 7): void {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

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

import fs from 'fs';
import path from 'path';
import { HubClient } from './hub/client';

export const ACCOUNT_PLATFORMS = ['twitter', 'discord', 'gmail'] as const;

export type AccountPlatform = (typeof ACCOUNT_PLATFORMS)[number];

export interface AccountEntry {
  containerCode: string;
  containerName: string;
  platforms: AccountPlatform[];
}

interface LegacyAccountEntry {
  containerCode?: unknown;
  containerName?: unknown;
  platforms?: unknown;
  group?: unknown;
}

export interface AccountValidationInput {
  containerCode?: string;
  containerName?: string;
  platforms?: string[];
}

export interface AccountValidationResult {
  containerCode: string;
  containerName: string;
  platforms: AccountPlatform[];
}

const ACCOUNTS_FILE = path.resolve(process.cwd(), 'accounts.json');

function isPlatform(value: string): value is AccountPlatform {
  return (ACCOUNT_PLATFORMS as readonly string[]).includes(value);
}

function normalizePlatforms(platforms: unknown): AccountPlatform[] {
  if (!Array.isArray(platforms)) {
    return [];
  }

  const normalized = platforms
    .map(item => String(item).trim().toLowerCase())
    .filter(isPlatform);

  return Array.from(new Set(normalized));
}

function normalizeAccountEntry(entry: LegacyAccountEntry, index: number): AccountEntry {
  const containerCode = String(entry.containerCode ?? '').trim();
  const containerName = String(entry.containerName ?? '').trim();

  if (!containerCode || !containerName) {
    throw new Error(`accounts.json 第 ${index + 1} 条账号缺少指纹环境名称或指纹环境编号`);
  }

  return {
    containerCode,
    containerName,
    platforms: normalizePlatforms(entry.platforms),
  };
}

export function loadAccountsFromDisk(): AccountEntry[] {
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    throw new Error('accounts.json 文件不存在');
  }

  const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('accounts.json 格式不正确，必须是数组');
  }

  return parsed.map((entry, index) => normalizeAccountEntry(entry as LegacyAccountEntry, index));
}

export function saveAccountsToDisk(accounts: AccountEntry[]): void {
  const normalized = accounts.map((account, index) => normalizeAccountEntry(account, index));
  const tempPath = `${ACCOUNTS_FILE}.tmp`;
  const payload = JSON.stringify(normalized, null, 2) + '\n';

  fs.writeFileSync(tempPath, payload, 'utf-8');
  if (fs.existsSync(ACCOUNTS_FILE)) {
    fs.rmSync(ACCOUNTS_FILE);
  }
  fs.renameSync(tempPath, ACCOUNTS_FILE);
}

export function validateAccountInput(input: AccountValidationInput): AccountValidationResult {
  const containerCode = String(input.containerCode ?? '').trim();
  const containerName = String(input.containerName ?? '').trim();

  if (!containerCode) {
    throw new Error('请输入指纹环境编号');
  }
  if (!containerName) {
    throw new Error('请输入指纹环境名称');
  }

  return {
    containerCode,
    containerName,
    platforms: normalizePlatforms(input.platforms ?? []),
  };
}

export function assertNoDuplicateAccount(accounts: AccountEntry[], candidate: AccountEntry): void {
  if (accounts.some(account => account.containerCode === candidate.containerCode)) {
    throw new Error('该指纹环境编号已存在');
  }
  if (accounts.some(account => account.containerName === candidate.containerName)) {
    throw new Error('该指纹环境名称已存在');
  }
}

export function updateAccountPlatforms(
  accounts: AccountEntry[],
  containerCode: string,
  platforms: string[]
): AccountEntry[] {
  const nextPlatforms = normalizePlatforms(platforms);
  const target = accounts.find(account => account.containerCode === containerCode);
  if (!target) {
    throw new Error('未找到对应账号');
  }

  return accounts.map(account =>
    account.containerCode === containerCode
      ? { ...account, platforms: nextPlatforms }
      : account
  );
}

export function removeAccount(accounts: AccountEntry[], containerCode: string): AccountEntry[] {
  const nextAccounts = accounts.filter(account => account.containerCode !== containerCode);
  if (nextAccounts.length === accounts.length) {
    throw new Error('未找到对应账号');
  }
  return nextAccounts;
}

export async function assertAccountMatchesHub(
  hub: HubClient,
  candidate: Pick<AccountEntry, 'containerCode' | 'containerName'>
): Promise<void> {
  const envs = await hub.getAllEnvList();
  const matched = envs.some(env =>
    String(env.containerCode) === candidate.containerCode &&
    env.containerName === candidate.containerName
  );

  if (!matched) {
    throw new Error('指纹环境名称和指纹环境编号与 Hubstudio 中的数据不匹配');
  }
}

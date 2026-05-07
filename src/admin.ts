import http, { IncomingMessage, ServerResponse } from 'http';
import { loadHubConfig } from './config';
import {
  AccountEntry,
  assertAccountMatchesHub,
  assertNoDuplicateAccount,
  loadAccountsFromDisk,
  removeAccount,
  saveAccountsToDisk,
  updateAccountPlatforms,
  validateAccountInput,
} from './accounts';
import { renderAdminPage } from './admin-page';
import { HubClient } from './hub/client';
import { logger } from './logger';

const DEFAULT_PORT = 3210;
const DEFAULT_HOST = '127.0.0.1';

function getAdminHost(): string {
  const raw = process.env.ADMIN_HOST?.trim();
  return raw || DEFAULT_HOST;
}

function getAdminPort(): number {
  const raw = process.env.ADMIN_PORT;
  if (!raw) {
    return DEFAULT_PORT;
  }

  const port = Number.parseInt(raw, 10);
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function readAccountsOrThrow(): AccountEntry[] {
  try {
    return loadAccountsFromDisk();
  } catch (error) {
    throw new Error(`读取 accounts.json 失败：${String(error)}`);
  }
}

function writeAccountsOrThrow(accounts: AccountEntry[]): void {
  try {
    saveAccountsToDisk(accounts);
  } catch (error) {
    throw new Error(`保存 accounts.json 失败：${String(error)}`);
  }
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  hub: HubClient
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/api/accounts') {
    const accounts = readAccountsOrThrow();
    sendJson(res, 200, { accounts });
    return true;
  }

  if (method === 'POST' && pathname === '/api/accounts') {
    const body = await readJsonBody(req);
    const candidate = validateAccountInput(body);
    const accounts = readAccountsOrThrow();

    assertNoDuplicateAccount(accounts, candidate);
    try {
      await assertAccountMatchesHub(hub, candidate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('不匹配')) {
        throw error;
      }
      throw new Error(`查询 Hubstudio 指纹环境失败：${message}`);
    }

    const nextAccounts = [...accounts, candidate].sort((a, b) => a.containerName.localeCompare(b.containerName));
    writeAccountsOrThrow(nextAccounts);
    sendJson(res, 201, { account: candidate });
    return true;
  }

  const patchMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/platforms$/);
  if (method === 'PATCH' && patchMatch) {
    const containerCode = decodeURIComponent(patchMatch[1]);
    const body = await readJsonBody(req);
    const accounts = readAccountsOrThrow();
    const nextAccounts = updateAccountPlatforms(accounts, containerCode, body.platforms ?? []);
    writeAccountsOrThrow(nextAccounts);
    sendJson(res, 200, { account: nextAccounts.find(account => account.containerCode === containerCode) });
    return true;
  }

  const deleteMatch = pathname.match(/^\/api\/accounts\/([^/]+)$/);
  if (method === 'DELETE' && deleteMatch) {
    const containerCode = decodeURIComponent(deleteMatch[1]);
    const accounts = readAccountsOrThrow();
    const nextAccounts = removeAccount(accounts, containerCode);
    writeAccountsOrThrow(nextAccounts);
    sendJson(res, 200, { success: true });
    return true;
  }

  return false;
}

function isClientErrorMessage(message: string): boolean {
  return [
    '请输入',
    '已存在',
    '未找到',
    '不匹配',
    '格式不正确',
    '文件不存在',
    '缺少指纹环境',
  ].some(keyword => message.includes(keyword));
}

async function requestHandler(req: IncomingMessage, res: ServerResponse, hub: HubClient): Promise<void> {
  try {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/' || url.pathname === '/accounts') {
      sendHtml(res, renderAdminPage());
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, hub);
      if (!handled) {
        sendJson(res, 404, { error: `未找到接口：${method} ${url.pathname}` });
      }
      return;
    }

    sendJson(res, 404, { error: `未找到页面：${method} ${url.pathname}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, isClientErrorMessage(message) ? 400 : 500, { error: message });
  }
}

async function main(): Promise<void> {
  const hub = new HubClient({ hub: loadHubConfig() });
  const host = getAdminHost();
  const port = getAdminPort();

  const server = http.createServer((req, res) => {
    void requestHandler(req, res, hub);
  });

  server.listen(port, host, () => {
    logger.info(`Account admin is running at http://${host}:${port}`);
  });
}

main().catch(error => {
  logger.error(`Failed to start account admin: ${error}`);
  process.exit(1);
});

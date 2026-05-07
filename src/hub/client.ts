import { Config, HubConfig } from '../config';
import { logger } from '../logger';
import {
  HubBrowserStartRequest,
  HubBrowserStartResponse,
  HubAllBrowserStatusResponse,
  HubEnvListResponse,
  HubEnvListItem,
  HubErrorCode,
  HubBrowserStatusItem,
} from './types';

export class HubClient {
  private baseUrl: string;

  constructor(config: Pick<Config, 'hub'> | { hub: HubConfig }) {
    this.baseUrl = config.hub.baseUrl;
  }

  private async request<T>(path: string, method: 'GET' | 'POST' = 'POST', body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body && method === 'POST') {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);
    const data = await res.json() as T;
    return data;
  }

  async startEnv(containerCode: string): Promise<HubBrowserStartResponse> {
    logger.info(`Hub: Starting environment ${containerCode}`);
    const body: HubBrowserStartRequest = { containerCode };
    const res = await this.request<HubBrowserStartResponse>('/api/v1/browser/start', 'POST', body);

    if (res.code === HubErrorCode.SUCCESS && res.data) {
      logger.info(`Hub: Environment ${containerCode} started, debuggingPort=${res.data.debuggingPort}`);
    } else if (res.code === HubErrorCode.ENV_ALREADY_RUNNING) {
      logger.info(`Hub: Environment ${containerCode} already running, code=${res.code}`);
    } else {
      logger.error(`Hub: Failed to start environment ${containerCode}, code=${res.code}, msg=${res.msg}`);
    }

    return res;
  }

  async stopEnv(containerCode: string): Promise<boolean> {
    logger.info(`Hub: Stopping environment ${containerCode}`);
    const res = await this.request<{ msg: string; code: number; data?: { action: string; statusCode: number } }>(
      '/api/v1/browser/stop',
      'POST',
      { containerCode }
    );
    return res.code === HubErrorCode.SUCCESS;
  }

  async getOpenedEnvs(): Promise<HubBrowserStatusItem[]> {
    const res = await this.request<HubAllBrowserStatusResponse>(
      '/api/v1/browser/all-browser-status',
      'POST',
      { containerCodes: [] }
    );

    if (res.code !== HubErrorCode.SUCCESS || !res.data) {
      logger.error(`Hub: Failed to get browser status, code=${res.code}`);
      return [];
    }

    return res.data.containers.filter(c => c.status === 0);
  }

  async getAllBrowserStatus(containerCodes: string[]): Promise<HubBrowserStatusItem[]> {
    const res = await this.request<HubAllBrowserStatusResponse>(
      '/api/v1/browser/all-browser-status',
      'POST',
      { containerCodes }
    );

    if (res.code !== HubErrorCode.SUCCESS || !res.data) {
      logger.error(`Hub: Failed to get browser status, code=${res.code}`);
      return [];
    }

    return res.data.containers;
  }

  async getEnvList(current: number = 1, size: number = 200): Promise<HubEnvListResponse> {
    return this.request<HubEnvListResponse>('/api/v1/env/list', 'POST', { current, size });
  }

  async getAllEnvList(size: number = 200): Promise<HubEnvListItem[]> {
    const all: HubEnvListItem[] = [];
    let current = 1;
    let total = Number.POSITIVE_INFINITY;

    while (all.length < total) {
      const res = await this.getEnvList(current, size);
      if (res.code !== HubErrorCode.SUCCESS || !res.data) {
        throw new Error(`Hub: Failed to get env list, code=${res.code}, msg=${res.msg}`);
      }

      all.push(...res.data.list);
      total = res.data.total;
      if (res.data.list.length === 0) {
        break;
      }
      current += 1;
    }

    return all;
  }

  async getOpenedContainerCodes(): Promise<Set<string>> {
    const res = await this.request<HubAllBrowserStatusResponse>(
      '/api/v1/browser/all-browser-status',
      'POST',
      { containerCodes: [] }
    );

    if (res.code !== HubErrorCode.SUCCESS || !res.data) {
      logger.error(`Hub: Failed to get browser status, code=${res.code}`);
      return new Set();
    }

    const opened = res.data.containers
      .filter(c => c.status === 0)
      .map(c => c.containerCode);
    return new Set(opened);
  }

  async ensureEnvOpen(containerCode: string): Promise<{ success: boolean; debuggingPort?: number; error?: string }> {
    const statuses = await this.getAllBrowserStatus([containerCode]);
    const status = statuses.find(s => s.containerCode === containerCode || s.containerCode === String(containerCode));

    if (status && status.status === 0) {
      logger.info(`Hub: Environment ${containerCode} already open`);
      const startRes = await this.startEnv(containerCode);
      if (startRes.code === HubErrorCode.SUCCESS && startRes.data) {
        return { success: true, debuggingPort: startRes.data.debuggingPort };
      }
      if (startRes.code === HubErrorCode.ENV_ALREADY_RUNNING) {
        return { success: true, debuggingPort: await this.getDebuggingPortForRunningEnv(containerCode) };
      }
      return { success: false, error: `start API returned code ${startRes.code}` };
    }

    const startRes = await this.startEnv(containerCode);
    if (startRes.code === HubErrorCode.SUCCESS && startRes.data) {
      return { success: true, debuggingPort: startRes.data.debuggingPort };
    }

    return { success: false, error: `Failed to start: code=${startRes.code}, msg=${startRes.msg}` };
  }

  private async getDebuggingPortForRunningEnv(containerCode: string): Promise<number | undefined> {
    const startRes = await this.startEnv(containerCode);
    if (startRes.code === HubErrorCode.SUCCESS && startRes.data) {
      return startRes.data.debuggingPort;
    }
    return undefined;
  }
}

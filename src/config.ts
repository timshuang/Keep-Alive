import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import stripJsonComments from 'strip-json-comments';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export interface Config {
  hub: {
    host: string;
    port: number;
    baseUrl: string;
  };
  telegram: {
    botToken: string;
    chatId: string;
    apiProxy: string;
  };
  email: {
    alertEmail: string;
    resendApiKey: string;
    configured: boolean;
  };
  intervals: {
    gmail: number;
    twitter: number;
    discord: number;
  };
  jitter: {
    gmail: number;
    twitter: number;
    discord: number;
  };
  scheduling: {
    accountIntervalMinSec: number;
    accountIntervalMaxSec: number;
    pageWaitMinSec: number;
    pageWaitMaxSec: number;
    randomStartDelayMaxMin: number;
  };
  browse: {
    twitterSecRange: [number, number];
    discordSecRange: [number, number];
    gmailReadSecRange: [number, number];
  };
}

export interface HubConfig {
  host: string;
  port: number;
  baseUrl: string;
}

interface JsoncConfig {
  hub?: { host?: string; port?: number };
  intervals?: { gmail?: number; twitter?: number; discord?: number };
  jitter?: { gmail?: number; twitter?: number; discord?: number };
  scheduling?: {
    accountIntervalMinSec?: number;
    accountIntervalMaxSec?: number;
    pageWaitMinSec?: number;
    pageWaitMaxSec?: number;
    randomStartDelayMaxMin?: number;
  };
  browse?: {
    twitterSecRange?: [number, number];
    discordSecRange?: [number, number];
    gmailReadSecRange?: [number, number];
  };
}

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required env variable: ${key}`);
  }
  return value;
}

function loadJsoncConfig(): JsoncConfig {
  const configPath = path.resolve(process.cwd(), 'config.jsonc');
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(stripJsonComments(raw)) as JsoncConfig;
  }
  return {};
}

const DEFAULTS: JsoncConfig = {
  hub: { host: '127.0.0.1', port: 6873 },
  intervals: { gmail: 3, twitter: 7, discord: 30 },
  jitter: { gmail: 1, twitter: 2, discord: 5 },
  scheduling: {
    accountIntervalMinSec: 180,
    accountIntervalMaxSec: 480,
    pageWaitMinSec: 3,
    pageWaitMaxSec: 8,
    randomStartDelayMaxMin: 720,
  },
  browse: {
    twitterSecRange: [5, 15],
    discordSecRange: [5, 10],
    gmailReadSecRange: [5, 10],
  },
};

function isWSL(): boolean {
  try {
    const version = fs.readFileSync('/proc/version', 'utf-8');
    return version.toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

function getWSLHostIP(): string | null {
  try {
    const resolv = fs.readFileSync('/etc/resolv.conf', 'utf-8');
    const match = resolv.match(/^nameserver\s+(\S+)/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function resolveHubHost(host: string): string {
  if (host === '127.0.0.1' && isWSL()) {
    const wslIP = getWSLHostIP();
    if (wslIP) {
      console.log(`[WSL] Detected WSL environment, replacing hub host 127.0.0.1 → ${wslIP}`);
      return wslIP;
    }
  }
  return host;
}

export function loadConfig(): Config {
  const jsonc = loadJsoncConfig();

  const hubHost = resolveHubHost(jsonc.hub?.host ?? DEFAULTS.hub!.host!);
  const hubPort = jsonc.hub?.port ?? DEFAULTS.hub!.port!;

  const tgBotToken = getEnv('TG_BOT_TOKEN');
  const tgChatId = getEnv('TG_CHAT_ID');
  const resendApiKey = getEnv('RESEND_API_KEY', '');
  const alertEmail = getEnv('ALERT_EMAIL', '');
  const emailConfigured = !!(resendApiKey && alertEmail);

  return {
    hub: {
      host: hubHost,
      port: hubPort,
      baseUrl: `http://${hubHost}:${hubPort}`,
    },
    telegram: {
      botToken: tgBotToken,
      chatId: tgChatId,
      apiProxy: getEnv('TG_API_PROXY', ''),
    },
    email: {
      alertEmail,
      resendApiKey,
      configured: emailConfigured,
    },
    intervals: {
      gmail: jsonc.intervals?.gmail ?? DEFAULTS.intervals!.gmail!,
      twitter: jsonc.intervals?.twitter ?? DEFAULTS.intervals!.twitter!,
      discord: jsonc.intervals?.discord ?? DEFAULTS.intervals!.discord!,
    },
    jitter: {
      gmail: jsonc.jitter?.gmail ?? DEFAULTS.jitter!.gmail!,
      twitter: jsonc.jitter?.twitter ?? DEFAULTS.jitter!.twitter!,
      discord: jsonc.jitter?.discord ?? DEFAULTS.jitter!.discord!,
    },
    scheduling: {
      accountIntervalMinSec: jsonc.scheduling?.accountIntervalMinSec ?? DEFAULTS.scheduling!.accountIntervalMinSec!,
      accountIntervalMaxSec: jsonc.scheduling?.accountIntervalMaxSec ?? DEFAULTS.scheduling!.accountIntervalMaxSec!,
      pageWaitMinSec: jsonc.scheduling?.pageWaitMinSec ?? DEFAULTS.scheduling!.pageWaitMinSec!,
      pageWaitMaxSec: jsonc.scheduling?.pageWaitMaxSec ?? DEFAULTS.scheduling!.pageWaitMaxSec!,
      randomStartDelayMaxMin: jsonc.scheduling?.randomStartDelayMaxMin ?? DEFAULTS.scheduling!.randomStartDelayMaxMin!,
    },
    browse: {
      twitterSecRange: jsonc.browse?.twitterSecRange ?? DEFAULTS.browse!.twitterSecRange!,
      discordSecRange: jsonc.browse?.discordSecRange ?? DEFAULTS.browse!.discordSecRange!,
      gmailReadSecRange: jsonc.browse?.gmailReadSecRange ?? DEFAULTS.browse!.gmailReadSecRange!,
    },
  };
}

export function loadHubConfig(): HubConfig {
  const jsonc = loadJsoncConfig();
  const hubHost = resolveHubHost(jsonc.hub?.host ?? DEFAULTS.hub!.host!);
  const hubPort = jsonc.hub?.port ?? DEFAULTS.hub!.port!;

  return {
    host: hubHost,
    port: hubPort,
    baseUrl: `http://${hubHost}:${hubPort}`,
  };
}

import dotenv from 'dotenv';
import path from 'path';

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
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPass: string;
    smtpFrom: string;
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
  watchdog: {
    checkIntervalHours: number;
  };
}

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required env variable: ${key}`);
  }
  return value;
}

function getEnvInt(key: string, defaultValue?: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required env variable: ${key}`);
  }
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid integer for env variable ${key}: ${raw}`);
  }
  return parsed;
}

export function loadConfig(): Config {
  const hubHost = getEnv('HUB_API_HOST', '127.0.0.1');
  const hubPort = getEnvInt('HUB_API_PORT', 6873);

  const tgBotToken = getEnv('TG_BOT_TOKEN');
  const tgChatId = getEnv('TG_CHAT_ID');

  const alertEmail = getEnv('ALERT_EMAIL', '');
  const smtpHost = getEnv('SMTP_HOST', '');
  const smtpUser = getEnv('SMTP_USER', '');
  const smtpPass = getEnv('SMTP_PASS', '');
  const smtpFrom = getEnv('SMTP_FROM', '');

  const emailConfigured = !!(alertEmail && smtpHost && smtpUser && smtpPass && smtpFrom);

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
      smtpHost,
      smtpPort: getEnvInt('SMTP_PORT', 587),
      smtpUser,
      smtpPass,
      smtpFrom,
      configured: emailConfigured,
    },
    intervals: {
      gmail: getEnvInt('GMAIL_INTERVAL', 3),
      twitter: getEnvInt('TWITTER_INTERVAL', 7),
      discord: getEnvInt('DISCORD_INTERVAL', 30),
    },
    jitter: {
      gmail: getEnvInt('GMAIL_JITTER', 1),
      twitter: getEnvInt('TWITTER_JITTER', 2),
      discord: getEnvInt('DISCORD_JITTER', 5),
    },
    scheduling: {
      accountIntervalMinSec: getEnvInt('ACCOUNT_INTERVAL_MIN_SEC', 180),
      accountIntervalMaxSec: getEnvInt('ACCOUNT_INTERVAL_MAX_SEC', 480),
      pageWaitMinSec: getEnvInt('PAGE_WAIT_MIN_SEC', 3),
      pageWaitMaxSec: getEnvInt('PAGE_WAIT_MAX_SEC', 8),
      randomStartDelayMaxMin: getEnvInt('RANDOM_START_DELAY_MAX_MIN', 720),
    },
    watchdog: {
      checkIntervalHours: getEnvInt('WATCHDOG_CHECK_INTERVAL_HOURS', 6),
    },
  };
}

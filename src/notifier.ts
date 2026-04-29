import TelegramBot from 'node-telegram-bot-api';
import { Resend } from 'resend';
import { Config } from './config';
import { logger } from './logger';
import { PlatformName } from './detector';
import { ActionOutcome } from './actions';
import { AppState, PlatformState } from './state';

interface AccountInfo {
  containerCode: string;
  containerName: string;
  platforms: string[];
}

export class Notifier {
  private bot: TelegramBot;
  private chatId: string;
  private config: Config;
  private resend: Resend | null = null;

  constructor(config: Config) {
    this.config = config;
    const botOptions: TelegramBot.ConstructorOptions = { polling: true };
    if (config.telegram.apiProxy) {
      botOptions.request = {
        proxy: config.telegram.apiProxy,
      } as any;
    }
    this.bot = new TelegramBot(config.telegram.botToken, botOptions);
    this.chatId = config.telegram.chatId;

    if (config.email.configured) {
      this.resend = new Resend(config.email.resendApiKey);
    }

    this.setupCommands();
  }

  private setupCommands(): void {
    this.bot.onText(/\/reset\s+(\S+)\s+(\S+)/, async (msg, match) => {
      const [, code, platform] = match!;
      logger.info(`TG: /reset command received: ${code} ${platform}`);
      this.onReset?.(code, platform as PlatformName);
    });

    this.bot.onText(/\/status/, async (msg) => {
      logger.info('TG: /status command received');
      this.onStatus?.();
    });

    this.bot.onText(/\/reboot/, async (msg) => {
      logger.info('TG: /reboot command received');
      await this.send('♻️ Keepalive 正在重启...');
      this.onReboot?.();
    });
  }

  onReset?: (code: string, platform: PlatformName) => void;
  onStatus?: () => void;
  onReboot?: () => void;

  async testConnection(): Promise<{ ok: boolean; botUsername?: string }> {
    try {
      const botInfo = await this.bot.getMe();
      return { ok: true, botUsername: botInfo.username };
    } catch {
      return { ok: false };
    }
  }

  async send(text: string): Promise<void> {
    try {
      await this.bot.sendMessage(this.chatId, text, { parse_mode: 'HTML' });
    } catch (err) {
      logger.error(`TG: Failed to send message: ${err}`);
    }
  }

  async sendAlert(containerCode: string, containerName: string, platform: PlatformName, reason: string, url?: string): Promise<void> {
    const msg = [
      '🚨 <b>Keepalive 告警</b>',
      '',
      `环境: ${containerName} (${containerCode})`,
      `平台: ${platform}`,
      `问题: ${reason}`,
      `时间: ${new Date().toISOString().slice(0, 19)}`,
      '',
      '该账号已标记为 verification_required，后续保活将跳过。',
      '发送 /reset &lt;containerCode&gt; &lt;platform&gt; 重置状态。',
    ].join('\n');

    await this.send(msg);
  }

  async sendPrecheck(results: Array<{ code: string; name: string; ok: boolean; detail: string }>): Promise<void> {
    const date = new Date().toISOString().slice(0, 10);
    const header = '🔍 <b>Keepalive 环境预检</b> - ' + date;

    const codeW = 10;
    const nameW = 14;
    const statusW = 10;

    const divider = '-'.repeat(codeW + nameW + statusW + 8);
    const headerLine = padRight('Code', codeW) + ' | ' + padRight('名称', nameW) + ' | ' + padRight('状态', statusW);
    const rows = results.map(r => {
      const status = r.ok ? '✅ ' + r.detail : '❌ ' + r.detail;
      return padRight(r.code, codeW) + ' | ' + padRight(r.name, nameW) + ' | ' + padRight(status, statusW + 2);
    }).join('\n');

    const failed = results.filter(r => !r.ok).length;
    const footer = failed > 0
      ? `\n❌ ${failed}个环境启动失败，程序已停止。`
      : '\n✅ 所有环境检查通过';

    await this.send(`${header}\n\n<pre>${headerLine}\n${divider}\n${rows}</pre>${footer}`);
  }

  async sendDailyReport(outcomes: Array<ActionOutcome & { code: string; name: string }>, accounts: AccountInfo[]): Promise<void> {
    const date = new Date().toISOString().slice(0, 10);
    const header = '📊 <b>Keepalive 日报</b> - ' + date;

    const codeW = 10;
    const nameW = 14;
    const platW = 6;

    const divider = '-'.repeat(codeW + nameW + platW * 3 + 12);
    const headerLine = padRight('Code', codeW) + ' | ' + padRight('名称', nameW) + ' | ' + padRight('Gmail', platW) + ' | ' + padRight('Twitter', platW) + ' | ' + padRight('DC', platW);

    const accountMap = new Map(accounts.map(a => [a.containerCode, a]));

    const codeSet = new Set(outcomes.map(o => o.code));
    const rows = Array.from(codeSet).map(code => {
      const info = accountMap.get(code);
      const name = info?.containerName || '';
      const accOutcomes = outcomes.filter(o => o.code === code);

      const gmail = formatCell(accOutcomes, 'gmail', info?.platforms);
      const twitter = formatCell(accOutcomes, 'twitter', info?.platforms);
      const discord = formatCell(accOutcomes, 'discord', info?.platforms);

      return padRight(code, codeW) + ' | ' + padRight(name, nameW) + ' | ' + padRight(gmail, platW) + ' | ' + padRight(twitter, platW) + ' | ' + padRight(discord, platW);
    }).join('\n');

    const successCount = outcomes.filter(o => o.success).length;
    const failCount = outcomes.filter(o => !o.success).length;

    const footer = `\n✅ 成功: ${successCount}  ⛔ 失败: ${failCount}`;

    await this.send(`${header}\n\n<pre>${headerLine}\n${divider}\n${rows}</pre>${footer}`);
  }

  async sendStartupGuide(): Promise<void> {
    const msg = [
      '🎉 <b>Keepalive 已启动</b>',
      '',
      '<b>可用命令：</b>',
      '<pre>',
      '/reset  &lt;containerCode&gt; &lt;platform&gt;  重置异常账号',
      '/status                   查看当前状态',
      '/reboot                   重启程序',
      '</pre>',
      '',
      '<b>示例：</b>',
      '<code>/reset 84794164 gmail</code>'
    ].join('\n');

    await this.send(msg);
  }

  async sendEmailWarning(): Promise<void> {
    await this.send('⚠️ <b>未配置告警邮箱！</b>\n\n请在 .env 中配置 RESEND_API_KEY 和 ALERT_EMAIL 以启用邮件告警。\n也可通过 <code>/set email your@email.com</code> 设置收件地址。');
  }

  async sendDeathNoticeAndEmail(): Promise<void> {
    const msg = '💀 <b>Keepalive 程序异常退出！</b>\n\nWatchdog 正在重启程序...';
    await this.send(msg);

    if (this.resend && this.config.email.alertEmail) {
      try {
        await this.resend.emails.send({
          from: 'Keepalive <onboarding@resend.dev>',
          to: this.config.email.alertEmail,
          subject: '💀 Keepalive 程序异常退出',
          text: `Keepalive program died at ${new Date().toISOString()}. Watchdog is restarting...`,
        });
      } catch (err) {
        logger.error(`Email: Failed to send death notice: ${err}`);
      }
    }
  }

  async stop(): Promise<void> {
    this.bot.stopPolling();
  }
}

function padRight(str: string, len: number): string {
  const pad = len - str.length;
  if (pad <= 0) return str.slice(0, len);
  return str + ' '.repeat(pad);
}

function formatCell(outcomes: Array<ActionOutcome & { code: string; name: string }>, platform: PlatformName, enabledPlatforms?: string[]): string {
  if (enabledPlatforms && !enabledPlatforms.includes(platform)) return '—';
  const o = outcomes.find(x => x.platform === platform);
  if (!o) return '—';
  return o.success ? '✅' : '⛔';
}

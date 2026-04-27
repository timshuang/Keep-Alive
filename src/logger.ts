import fs from 'fs';
import path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgBlue: '\x1b[44m',
};

const LEVEL_PREFIX: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: `${ANSI.dim}DBG${ANSI.reset}`,
  [LogLevel.INFO]: `${ANSI.cyan}INF${ANSI.reset}`,
  [LogLevel.WARN]: `${ANSI.yellow}WRN${ANSI.reset}`,
  [LogLevel.ERROR]: `${ANSI.red}ERR${ANSI.reset}`,
};

export class Logger {
  private logDir: string;
  private minLevel: LogLevel;

  constructor(logDir: string = path.resolve(process.cwd(), 'logs'), minLevel: LogLevel = LogLevel.INFO) {
    this.logDir = logDir;
    this.minLevel = minLevel;
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  private getLogFile(): string {
    const date = new Date().toISOString().slice(0, 10);
    return path.join(this.logDir, `keepalive-${date}.log`);
  }

  private formatMessage(level: LogLevel, msg: string): string {
    const ts = new Date().toISOString().slice(0, 19);
    return `[${ts}] ${LogLevel[level]} ${msg}`;
  }

  private write(level: LogLevel, msg: string): void {
    if (level < this.minLevel) return;

    const formatted = this.formatMessage(level, msg);

    console.log(`[${LEVEL_PREFIX[level]}] ${msg}`);

    try {
      fs.appendFileSync(this.getLogFile(), formatted + '\n');
    } catch {
      // ignore file write errors
    }
  }

  debug(msg: string): void { this.write(LogLevel.DEBUG, msg); }
  info(msg: string): void { this.write(LogLevel.INFO, msg); }
  warn(msg: string): void { this.write(LogLevel.WARN, msg); }
  error(msg: string): void { this.write(LogLevel.ERROR, msg); }

  banner(title: string, lines: Record<string, string | number>): void {
    const w = 45;
    const border = '═'.repeat(w);
    const titleLine = `  ${title}`;

    console.log(`\n${ANSI.bold}${ANSI.cyan}${border}${ANSI.reset}`);
    console.log(`${ANSI.bold}${ANSI.green}${titleLine}${ANSI.reset}`);
    console.log(`${ANSI.bold}${ANSI.cyan}${border}${ANSI.reset}`);

    for (const [key, val] of Object.entries(lines)) {
      const label = `${ANSI.bold}${key}:${ANSI.reset}`;
      console.log(`  ${label}   ${val}`);
    }

    console.log(`${ANSI.bold}${ANSI.cyan}${border}${ANSI.reset}\n`);

    for (const [key, val] of Object.entries(lines)) {
      this.info(`${key}: ${val}`);
    }
  }

  success(msg: string): void {
    console.log(`  ${ANSI.green}✅ ${msg}${ANSI.reset}`);
    this.info(`✅ ${msg}`);
  }

  fail(msg: string): void {
    console.log(`  ${ANSI.red}❌ ${msg}${ANSI.reset}`);
    this.error(`❌ ${msg}`);
  }

  warnLine(msg: string): void {
    console.log(`  ${ANSI.yellow}⚠️  ${msg}${ANSI.reset}`);
    this.warn(`⚠️ ${msg}`);
  }
}

export const logger = new Logger();

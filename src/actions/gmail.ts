import { Page } from 'playwright-core';
import { Config } from '../config';
import { logger } from '../logger';
import { detect, DetectionResult, PlatformName } from '../detector';

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function waitSeconds(sec: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, sec * 1000));
}

async function waitRandom(config: Config): Promise<void> {
  const seconds = randomBetween(config.scheduling.pageWaitMinSec, config.scheduling.pageWaitMaxSec);
  logger.info(`Waiting ${seconds}s for page load...`);
  await waitSeconds(seconds);
}

export interface ActionOutcome {
  platform: PlatformName;
  success: boolean;
  reason?: string;
  url?: string;
  code?: string;
  name?: string;
}

async function browseTwitter(page: Page): Promise<void> {
  const totalSec = randomBetween(5, 15);
  const scrollTimes = randomBetween(1, 2);
  const secPerScroll = Math.floor(totalSec / (scrollTimes + 1));

  for (let i = 0; i < scrollTimes; i++) {
    await page.mouse.wheel(0, randomBetween(300, 800));
    await waitSeconds(secPerScroll);
  }

  const doLike = Math.random() < 0.5;
  if (doLike) {
    try {
      const likeButtons = await page.$$('button[data-testid="like"]');
      if (likeButtons.length > 0) {
        const pick = likeButtons[randomBetween(0, likeButtons.length - 1)];
        await pick.click({ timeout: 3000 });
        logger.info('Twitter: Liked a random tweet');
      }
    } catch {
      logger.info('Twitter: Like attempt skipped');
    }
  }

  const remaining = totalSec - scrollTimes * secPerScroll;
  if (remaining > 0) await waitSeconds(remaining);

  logger.info(`Twitter: Browsed timeline for ~${totalSec}s`);
}

async function browseDiscord(page: Page): Promise<void> {
  const browseSec = randomBetween(5, 10);

  try {
    const links = await page.$$('a[href*="/channels/"]');
    const channels = links.filter(l => {
      const href = (l as any).href || '';
      return href && !href.includes('/@me');
    });

    if (channels.length > 0) {
      const pick = channels[randomBetween(0, channels.length - 1)];
      await pick.click({ timeout: 5000 });
      logger.info('Discord: Entered a random channel');
    }
  } catch {
    logger.info('Discord: Channel click skipped');
  }

  await waitSeconds(browseSec);
  logger.info(`Discord: Browsed for ~${browseSec}s`);
}

async function browseGmail(page: Page): Promise<void> {
  const emailCount = randomBetween(1, 2);

  try {
    let rows = await page.$$('tr.zA');
    if (rows.length === 0) {
      rows = await page.$$('div[role="row"]');
    }

    if (rows.length === 0) {
      logger.info('Gmail: No email rows found, skipping browse');
      return;
    }

    const shuffled = rows.sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(emailCount, shuffled.length));

    for (const row of selected) {
      try {
        await row.click({ timeout: 5000 });
        const readSec = randomBetween(5, 10);
        await waitSeconds(readSec);
        logger.info(`Gmail: Read an email for ~${readSec}s`);
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
        await waitSeconds(1);
      } catch {
        logger.info('Gmail: Email click skipped');
        break;
      }
    }
  } catch {
    logger.info('Gmail: Browse skipped');
  }
}

export async function keepaliveGmail(page: Page, config: Config): Promise<ActionOutcome> {
  const platform: PlatformName = 'gmail';

  try {
    await page.goto('https://mail.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitRandom(config);

    const result: DetectionResult = await detect(page, platform);

    if (!result.isOk) {
      logger.error(`Gmail: Verification detected - ${result.reason}`);
      return { platform, success: false, reason: result.reason, url: result.url };
    }

    logger.info('Gmail: OK - inbox accessible');

    try {
      await browseGmail(page);
    } catch {
      logger.info('Gmail: Browse error, ignoring');
    }

    return { platform, success: true, url: result.url };
  } catch (err) {
    logger.error(`Gmail: Error - ${err}`);
    return { platform, success: false, reason: String(err) };
  }
}

export async function keepaliveTwitter(page: Page, config: Config): Promise<ActionOutcome> {
  const platform: PlatformName = 'twitter';

  try {
    await page.goto('https://x.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitRandom(config);

    const result: DetectionResult = await detect(page, platform);

    if (!result.isOk) {
      logger.error(`Twitter: Verification detected - ${result.reason}`);
      return { platform, success: false, reason: result.reason, url: result.url };
    }

    logger.info('Twitter: OK - timeline accessible');

    try {
      await browseTwitter(page);
    } catch {
      logger.info('Twitter: Browse error, ignoring');
    }

    return { platform, success: true, url: result.url };
  } catch (err) {
    logger.error(`Twitter: Error - ${err}`);
    return { platform, success: false, reason: String(err) };
  }
}

export async function keepaliveDiscord(page: Page, config: Config): Promise<ActionOutcome> {
  const platform: PlatformName = 'discord';

  try {
    await page.goto('https://discord.com/channels/@me', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitRandom(config);

    const result: DetectionResult = await detect(page, platform);

    if (!result.isOk) {
      logger.error(`Discord: Verification detected - ${result.reason}`);
      return { platform, success: false, reason: result.reason, url: result.url };
    }

    logger.info('Discord: OK - channels accessible');

    try {
      await browseDiscord(page);
    } catch {
      logger.info('Discord: Browse error, ignoring');
    }

    return { platform, success: true, url: result.url };
  } catch (err) {
    logger.error(`Discord: Error - ${err}`);
    return { platform, success: false, reason: String(err) };
  }
}

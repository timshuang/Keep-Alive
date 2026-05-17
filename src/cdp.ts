import { chromium, Browser, BrowserContext, Page } from 'playwright-core';
import { logger } from './logger';
import { Config } from './config';

export interface CDPSession {
  browser: Browser;
  context: BrowserContext;
  close: () => Promise<void>;
  newPage: () => Promise<{ page: Page; close: () => Promise<void> }>;
}

export async function connectCDP(debuggingPort: number, config: Config): Promise<CDPSession> {
  const cdpHost = config.hub.host;
  const cdpUrl = `http://${cdpHost}:${debuggingPort}`;

  logger.info(`CDP: Connecting to ${cdpUrl}`);

  const browser = await chromium.connectOverCDP(cdpUrl);
  const contexts = browser.contexts();

  if (contexts.length === 0) {
    throw new Error(`No browser context found at ${cdpUrl}`);
  }

  const context = contexts[0];
  logger.info(`CDP: Connected, ${context.pages().length} existing pages`);

  const createdPages: Page[] = [];

  const newPage = async (): Promise<{ page: Page; close: () => Promise<void> }> => {
    const page = await context.newPage();
    createdPages.push(page);
    logger.info(`CDP: Created new tab, total new tabs: ${createdPages.length}`);

    const close = async (): Promise<void> => {
      try {
        if (!page.isClosed()) {
          await page.close();
          const idx = createdPages.indexOf(page);
          if (idx > -1) createdPages.splice(idx, 1);
          logger.info('CDP: Closed new tab');
        }
      } catch (err) {
        logger.warn(`CDP: Error closing tab: ${err}`);
      }
    };

    return { page, close };
  };

  const close = async (): Promise<void> => {
    for (const page of createdPages) {
      try {
        if (!page.isClosed()) {
          await page.close();
        }
      } catch (err) {
        logger.warn(`CDP: Error closing created page: ${err}`);
      }
    }
    createdPages.length = 0;

    // Minimize window before disconnecting so it goes to taskbar
    try {
      const cdpSession = await browser.newBrowserCDPSession();
      const { targetInfos } = await cdpSession.send('Target.getTargets');
      const pageTarget = targetInfos.find((t: any) => t.type === 'page');
      if (pageTarget) {
        const { windowId } = await cdpSession.send('Browser.getWindowForTarget', {
          targetId: pageTarget.targetId,
        });
        await cdpSession.send('Browser.setWindowBounds', {
          windowId,
          bounds: { windowState: 'minimized' },
        });
        logger.info('CDP: Window minimized');
      }
      await cdpSession.detach();
    } catch (err) {
      logger.warn(`CDP: Failed to minimize window: ${err}`);
    }

    try {
      await browser.close();
      logger.info('CDP: Disconnected from browser');
    } catch (err) {
      logger.warn(`CDP: Error disconnecting: ${err}`);
    }
  };

  return { browser, context, close, newPage };
}

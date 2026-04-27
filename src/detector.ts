import { Page } from 'playwright-core';

export type PlatformName = 'gmail' | 'twitter' | 'discord';

export interface DetectionResult {
  platform: PlatformName;
  isOk: boolean;
  reason?: string;
  url?: string;
}

interface DetectionRule {
  platform: PlatformName;
  okPatterns: RegExp[];
  badPatterns: RegExp[];
  getUrl: (page: Page) => Promise<string>;
}

const RULES: DetectionRule[] = [
  {
    platform: 'gmail',
    okPatterns: [/mail\.google\.com\/mail/],
    badPatterns: [/accounts\.google\.com/, /signin/, /challenge/, /ServiceLogin/],
    getUrl: async (page) => page.url(),
  },
  {
    platform: 'twitter',
    okPatterns: [/x\.com\/home/, /x\.com\/compose/, /x\.com\/explore/],
    badPatterns: [/x\.com\/login/, /x\.com\/i\/flow\/login/, /challenge/, /phone_verification/, /x\.com\/account\/access/],
    getUrl: async (page) => page.url(),
  },
  {
    platform: 'discord',
    okPatterns: [/discord\.com\/channels/],
    badPatterns: [/discord\.com\/login/, /discord\.com\/auth/, /discord\.com\/verify/],
    getUrl: async (page) => page.url(),
  },
];

export async function detect(page: Page, platform: PlatformName): Promise<DetectionResult> {
  const rule = RULES.find(r => r.platform === platform);
  if (!rule) {
    return { platform, isOk: false, reason: '未知平台' };
  }

  const url = await rule.getUrl(page);

  for (const pattern of rule.badPatterns) {
    if (pattern.test(url)) {
      return {
        platform,
        isOk: false,
        reason: '需要验证',
        url,
      };
    }
  }

  for (const pattern of rule.okPatterns) {
    if (pattern.test(url)) {
      return { platform, isOk: true, url };
    }
  }

  return {
    platform,
    isOk: false,
    reason: 'Unexpected URL',
    url,
  };
}

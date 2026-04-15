/**
 * Shared Playwright browser bootstrap for HLTV scraping scripts.
 *
 * All scripts in this directory need a stealth-enabled Chromium instance to
 * bypass Cloudflare's JS challenges on hltv.org. This module centralises that
 * setup so every script starts with the same configuration.
 *
 * Usage:
 *   import { launchBrowser } from './browser';
 *
 *   const { browser, page } = await launchBrowser();
 *   try {
 *     await page.goto('https://www.hltv.org/results');
 *     // ... work with the page ...
 *   } finally {
 *     await browser.close();
 *   }
 *
 * Options:
 *   headless  — run in headless mode (default true)
 *   downloads — enable download events (needed by download-demo)
 */

import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export interface LaunchOptions {
  headless?: boolean;
  downloads?: boolean;
}

export interface BrowserHandle {
  browser: Browser;
  page: Page;
}

let stealthRegistered = false;

export async function launchBrowser(opts: LaunchOptions = {}): Promise<BrowserHandle> {
  const { headless = true, downloads = false } = opts;

  // StealthPlugin only needs to be registered once per process
  if (!stealthRegistered) {
    chromium.use(StealthPlugin());
    stealthRegistered = true;
  }

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent: DEFAULT_USER_AGENT,
    ...(downloads && { acceptDownloads: true }),
  });
  const page = await context.newPage();

  return { browser, page };
}

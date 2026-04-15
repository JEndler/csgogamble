import puppeteer from '@cloudflare/puppeteer';
import { USER_AGENT } from './constants';
import type { Env } from './types';

const NAVIGATION_TIMEOUT_MS = 30_000;
const SNAPSHOT_TIMEOUT_MS = 5_000;
const SNAPSHOT_RETRY_LIMIT = 2;
const BROWSER_KEEP_ALIVE_MS = 600_000;
const BROWSER_LAUNCH_RETRY_LIMIT = 3;
const DEFAULT_LAUNCH_RETRY_AFTER_MS = 1_000;
const RETRYABLE_SNAPSHOT_ERROR_MARKERS = [
  'Attempted to use detached Frame',
  'Execution context was destroyed',
  'Cannot find context with specified id',
];
const DEFAULT_BROWSER_SESSION_KEY = 'default';
const INTERNAL_DO_ORIGIN = 'https://browser-session';

interface BrowserPageController {
  setUserAgent?(userAgent: string): Promise<void> | void;
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  waitForNavigation(options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  waitForNetworkIdle(options: { idleTime: number; timeout: number }): Promise<void>;
  content(): Promise<string>;
  title(): Promise<string>;
  url(): string;
  close(): Promise<void>;
}

interface BrowserController {
  isConnected(): boolean;
  newPage(): Promise<BrowserPageController>;
  close(): Promise<void>;
}

export interface BrowserPageSnapshot {
  requestedUrl: string;
  finalUrl: string;
  html: string;
  title: string | null;
}

export interface BrowserSessionCloseResponse {
  ok: true;
  sessionKey: string;
}

type BrowserLauncher = (env: Env) => Promise<BrowserController>;
type SleepFn = (ms: number) => Promise<void>;

type RateLimitedLaunchError = Error & {
  status?: number;
  headers?: Headers;
};

const defaultSleep: SleepFn = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const defaultBrowserLauncher: BrowserLauncher = async (env) =>
  puppeteer.launch(env.BROWSER, {
    keep_alive: BROWSER_KEEP_ALIVE_MS,
  });
let browserLauncher: BrowserLauncher = defaultBrowserLauncher;
let sleep: SleepFn = defaultSleep;

export function setBrowserSessionLauncherForTests(next?: BrowserLauncher): void {
  browserLauncher = next ?? defaultBrowserLauncher;
}

export function setBrowserSessionSleepForTests(next?: SleepFn): void {
  sleep = next ?? defaultSleep;
}

function resolveBrowserSessionKey(sessionKey?: string): string {
  return sessionKey && sessionKey.trim().length > 0 ? sessionKey.trim() : DEFAULT_BROWSER_SESSION_KEY;
}

function readRetryAfterMs(error: RateLimitedLaunchError): number {
  const retryAfter = error.headers?.get('Retry-After');
  if (!retryAfter) {
    return DEFAULT_LAUNCH_RETRY_AFTER_MS;
  }

  const parsed = Number.parseFloat(retryAfter);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LAUNCH_RETRY_AFTER_MS;
  }

  return Math.ceil(parsed * 1_000);
}

function isRateLimitedLaunchError(error: unknown): error is RateLimitedLaunchError {
  return error instanceof Error && (error as RateLimitedLaunchError).status === 429;
}

async function launchBrowserWithRetry(env: Env): Promise<BrowserController> {
  for (let attempt = 1; attempt <= BROWSER_LAUNCH_RETRY_LIMIT; attempt += 1) {
    try {
      return await browserLauncher(env);
    } catch (error) {
      if (attempt === BROWSER_LAUNCH_RETRY_LIMIT || !isRateLimitedLaunchError(error)) {
        throw error;
      }

      await sleep(readRetryAfterMs(error));
    }
  }

  throw new Error('Browser launch retry limit exhausted');
}

function isRetryableSnapshotError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return RETRYABLE_SNAPSHOT_ERROR_MARKERS.some((marker) => error.message.includes(marker));
}

async function waitForPageToSettle(page: BrowserPageController): Promise<void> {
  await page.waitForNetworkIdle({ idleTime: 750, timeout: SNAPSHOT_TIMEOUT_MS }).catch(() => undefined);
}

async function capturePageSnapshot(page: BrowserPageController): Promise<{
  finalUrl: string;
  html: string;
  title: string | null;
}> {
  for (let attempt = 1; attempt <= SNAPSHOT_RETRY_LIMIT; attempt += 1) {
    try {
      const html = await page.content();
      const title = await page.title().catch(() => null);

      return {
        finalUrl: page.url(),
        html,
        title,
      };
    } catch (error) {
      if (attempt === SNAPSHOT_RETRY_LIMIT || !isRetryableSnapshotError(error)) {
        throw error;
      }

      await page
        .waitForNavigation({
          waitUntil: 'domcontentloaded',
          timeout: SNAPSHOT_TIMEOUT_MS,
        })
        .catch(() => undefined);
      await waitForPageToSettle(page);
    }
  }

  throw new Error('Browser snapshot retry limit exhausted');
}

async function fetchSnapshotWithBrowserController(
  browser: BrowserController,
  targetUrl: string,
): Promise<BrowserPageSnapshot> {
  const page = await browser.newPage();

  try {
    await page.setUserAgent?.(USER_AGENT);
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    await waitForPageToSettle(page);

    const { finalUrl, html, title } = await capturePageSnapshot(page);
    return {
      requestedUrl: targetUrl,
      finalUrl,
      html,
      title,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

export async function fetchPageSnapshotWithBrowser(env: Env, targetUrl: string): Promise<BrowserPageSnapshot> {
  const browser = await launchBrowserWithRetry(env);

  try {
    return await fetchSnapshotWithBrowserController(browser, targetUrl);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export class BrowserSession {
  private browser: BrowserController | undefined;
  private readonly env: Env;

  constructor(_state: unknown, env: Env) {
    this.env = env;
  }

  private async getBrowser(): Promise<BrowserController> {
    if (!this.browser?.isConnected()) {
      this.browser = await launchBrowserWithRetry(this.env);
    }

    return this.browser;
  }

  private async closeBrowser(): Promise<void> {
    if (!this.browser) {
      return;
    }

    const current = this.browser;
    this.browser = undefined;
    await current.close().catch(() => undefined);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/close') {
      await this.closeBrowser();
      const body: BrowserSessionCloseResponse = {
        ok: true,
        sessionKey: url.searchParams.get('sessionKey') ?? DEFAULT_BROWSER_SESSION_KEY,
      };
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    if (request.method !== 'GET' || url.pathname !== '/snapshot') {
      return new Response('Not found', { status: 404 });
    }

    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) {
      return new Response('Missing url parameter', { status: 400 });
    }

    try {
      const browser = await this.getBrowser();
      const snapshot = await fetchSnapshotWithBrowserController(browser, targetUrl);
      return new Response(JSON.stringify(snapshot), {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    } catch (error) {
      await this.closeBrowser();
      const message = error instanceof Error ? error.message : 'Browser session snapshot failed';
      return new Response(message, { status: 500 });
    }
  }
}

export async function fetchPageSnapshotWithSession(
  env: Env,
  targetUrl: string,
  sessionKey?: string,
): Promise<BrowserPageSnapshot> {
  const resolvedSessionKey = resolveBrowserSessionKey(sessionKey);
  const id = env.BROWSER_SESSION.idFromName(resolvedSessionKey);
  const stub = env.BROWSER_SESSION.get(id);
  const response = await stub.fetch(
    `${INTERNAL_DO_ORIGIN}/snapshot?url=${encodeURIComponent(targetUrl)}&sessionKey=${encodeURIComponent(resolvedSessionKey)}`,
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as BrowserPageSnapshot;
}

export async function closeBrowserSession(env: Env, sessionKey?: string): Promise<BrowserSessionCloseResponse> {
  const resolvedSessionKey = resolveBrowserSessionKey(sessionKey);
  const id = env.BROWSER_SESSION.idFromName(resolvedSessionKey);
  const stub = env.BROWSER_SESSION.get(id);
  const response = await stub.fetch(
    `${INTERNAL_DO_ORIGIN}/close?sessionKey=${encodeURIComponent(resolvedSessionKey)}`,
    { method: 'POST' },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as BrowserSessionCloseResponse;
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserSession,
  fetchPageSnapshotWithBrowser,
  setBrowserSessionLauncherForTests,
  setBrowserSessionSleepForTests,
} from '../src/browser-session';
import type { Env } from '../src/types';

describe('BrowserSession', () => {
  beforeEach(() => {
    setBrowserSessionLauncherForTests(undefined);
    setBrowserSessionSleepForTests(undefined);
  });

  afterEach(() => {
    setBrowserSessionLauncherForTests(undefined);
    setBrowserSessionSleepForTests(undefined);
  });

  it('reuses one browser instance across multiple snapshot requests', async () => {
    let currentUrl = '';
    const browserClose = vi.fn(async () => undefined);
    const browser = {
      isConnected: vi.fn(() => true),
      newPage: vi.fn(async () => ({
        setUserAgent: vi.fn(async () => undefined),
        goto: vi.fn(async (url: string) => {
          currentUrl = url;
        }),
        waitForNavigation: vi.fn(async () => undefined),
        waitForNetworkIdle: vi.fn(async () => undefined),
        content: vi.fn(async () => `<html><title>${currentUrl}</title><body>${currentUrl}</body></html>`),
        title: vi.fn(async () => currentUrl),
        url: vi.fn(() => currentUrl),
        close: vi.fn(async () => undefined),
      })),
      close: browserClose,
    };
    const launchSpy = vi.fn(async () => browser);
    setBrowserSessionLauncherForTests(launchSpy);

    const session = new BrowserSession({}, { BROWSER: {} } as Env);

    const firstResponse = await session.fetch(new Request('https://do/snapshot?url=https://example.com/one'));
    const firstBody = (await firstResponse.json()) as { finalUrl: string; html: string };
    const secondResponse = await session.fetch(new Request('https://do/snapshot?url=https://example.com/two'));
    const secondBody = (await secondResponse.json()) as { finalUrl: string; html: string };

    expect(firstBody.finalUrl).toBe('https://example.com/one');
    expect(firstBody.html).toContain('https://example.com/one');
    expect(secondBody.finalUrl).toBe('https://example.com/two');
    expect(secondBody.html).toContain('https://example.com/two');
    expect(launchSpy).toHaveBeenCalledTimes(1);
    expect(browser.newPage).toHaveBeenCalledTimes(2);

    await session.fetch(new Request('https://do/close', { method: 'POST' }));
    expect(browserClose).toHaveBeenCalledTimes(1);
  });

  it('retries browser launch after a 429 using Retry-After', async () => {
    let currentUrl = '';
    const browser = {
      isConnected: vi.fn(() => true),
      newPage: vi.fn(async () => ({
        setUserAgent: vi.fn(async () => undefined),
        goto: vi.fn(async (url: string) => {
          currentUrl = url;
        }),
        waitForNavigation: vi.fn(async () => undefined),
        waitForNetworkIdle: vi.fn(async () => undefined),
        content: vi.fn(async () => `<html><body>${currentUrl}</body></html>`),
        title: vi.fn(async () => currentUrl),
        url: vi.fn(() => currentUrl),
        close: vi.fn(async () => undefined),
      })),
      close: vi.fn(async () => undefined),
    };
    const rateLimitError = Object.assign(new Error('Rate limit exceeded'), {
      status: 429,
      headers: new Headers({ 'Retry-After': '2' }),
    });
    const launchSpy = vi.fn(async () => {
      if (launchSpy.mock.calls.length === 1) {
        throw rateLimitError;
      }
      return browser;
    });
    const sleepSpy = vi.fn(async () => undefined);
    setBrowserSessionLauncherForTests(launchSpy);
    setBrowserSessionSleepForTests(sleepSpy);

    const snapshot = await fetchPageSnapshotWithBrowser({ BROWSER: {} } as Env, 'https://example.com/retry');

    expect(snapshot.finalUrl).toBe('https://example.com/retry');
    expect(launchSpy).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledWith(2_000);
  });
});

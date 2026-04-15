import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleRequest } from '../src/app';
import { setBrowserDiagnosticsProviderForTests, summarizeBrowserHtml } from '../src/browser-debug';
import { findCloudflareChallengeMarkers, isCloudflareChallenge } from '../src/hltv';
import type { Env } from '../src/types';

describe('HLTV browser debug helpers', () => {
  const env = {
    HLTV_BASE_URL: 'https://www.hltv.org',
  } as Env;

  beforeEach(() => {
    setBrowserDiagnosticsProviderForTests(undefined);
  });

  afterEach(() => {
    setBrowserDiagnosticsProviderForTests(undefined);
  });

  it('detects common Cloudflare challenge markers', () => {
    const html = `
      <html>
        <head><title>Just a moment...</title></head>
        <body>
          <div id="cf-wrapper">Enable JavaScript and cookies to continue</div>
          <script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>
        </body>
      </html>
    `;

    expect(findCloudflareChallengeMarkers(html)).toEqual([
      'Just a moment...',
      'Enable JavaScript and cookies to continue',
      '/cdn-cgi/challenge-platform/',
      'challenge-platform',
    ]);
    expect(isCloudflareChallenge(html)).toBe(true);
  });

  it('summarizes results HTML without returning the full page', () => {
    const html = `
      <html>
        <head><title>Results | HLTV.org</title></head>
        <body>
          <a href="/matches/111/alpha-vs-beta">Alpha vs Beta</a>
          <a href="/matches/222/gamma-vs-delta">Gamma vs Delta</a>
          <a href="/matches/111/alpha-vs-beta">Alpha vs Beta</a>
        </body>
      </html>
    `;

    expect(
      summarizeBrowserHtml({
        requestedUrl: 'https://www.hltv.org/results',
        finalUrl: 'https://www.hltv.org/results',
        html,
        title: null,
      }),
    ).toMatchObject({
      ok: true,
      finalUrl: 'https://www.hltv.org/results',
      title: 'Results | HLTV.org',
      challengeDetected: false,
      challengeMarkers: [],
      discoveredMatchUrlCount: 2,
      discoveredMatchUrlsSample: [
        'https://www.hltv.org/matches/111/alpha-vs-beta',
        'https://www.hltv.org/matches/222/gamma-vs-delta',
      ],
    });
  });

  it('summarizes browser limits via the debug route', async () => {
    setBrowserDiagnosticsProviderForTests(async () => ({
      limits: {
        activeSessions: [{ id: 'session-1' }],
        allowedBrowserAcquisitions: 0,
        maxConcurrentSessions: 120,
        timeUntilNextAllowedBrowserAcquisition: 750,
      },
      sessions: [],
      history: [],
    }));

    const response = await handleRequest(new Request('https://worker/debug/browser/limits'), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limits: {
        activeSessions: [{ id: 'session-1' }],
        allowedBrowserAcquisitions: 0,
        maxConcurrentSessions: 120,
        timeUntilNextAllowedBrowserAcquisition: 750,
      },
    });
  });

  it('summarizes browser sessions and history via the debug routes', async () => {
    setBrowserDiagnosticsProviderForTests(async () => ({
      limits: {
        activeSessions: [],
        allowedBrowserAcquisitions: 1,
        maxConcurrentSessions: 120,
        timeUntilNextAllowedBrowserAcquisition: 0,
      },
      sessions: [{ sessionId: 'session-2', startTime: 123 }],
      history: [{ sessionId: 'session-3', closeReasonText: 'BrowserIdle', startTime: 100, endTime: 200 }],
    }));

    const sessionsResponse = await handleRequest(new Request('https://worker/debug/browser/sessions'), env);
    const historyResponse = await handleRequest(new Request('https://worker/debug/browser/history'), env);

    expect(sessionsResponse.status).toBe(200);
    await expect(sessionsResponse.json()).resolves.toEqual({
      ok: true,
      sessions: [{ sessionId: 'session-2', startTime: 123 }],
    });
    expect(historyResponse.status).toBe(200);
    await expect(historyResponse.json()).resolves.toEqual({
      ok: true,
      history: [{ sessionId: 'session-3', closeReasonText: 'BrowserIdle', startTime: 100, endTime: 200 }],
    });
  });

  it('returns 500 when browser diagnostics fail', async () => {
    setBrowserDiagnosticsProviderForTests(async () => {
      throw new Error('diagnostics exploded');
    });

    const response = await handleRequest(new Request('https://worker/debug/browser/limits'), env);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'diagnostics exploded',
    });
  });
});

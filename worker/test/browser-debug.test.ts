import { describe, expect, it } from 'vitest';
import { summarizeBrowserHtml } from '../src/browser-debug';
import { findCloudflareChallengeMarkers, isCloudflareChallenge } from '../src/hltv';

describe('HLTV browser debug helpers', () => {
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
});

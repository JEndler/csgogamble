import { describe, expect, it } from 'vitest';
import { buildStealthFetchHeaders, resolveStealthFetchProfile } from '../src/http';

describe('http stealth acquisition profiles', () => {
  it('selects a stable profile for the same key and rotates across different keys', () => {
    const first = resolveStealthFetchProfile('hltv-overlap-3:2369001');
    const repeat = resolveStealthFetchProfile('hltv-overlap-3:2369001');
    const variants = new Set(
      Array.from({ length: 24 }, (_, index) => resolveStealthFetchProfile(`hltv-overlap-3:${2369001 + index}`).id),
    );

    expect(repeat).toEqual(first);
    expect(variants.size).toBeGreaterThan(1);
  });

  it('builds internally consistent Chrome and Firefox header profiles', () => {
    const chromeHeaders = buildStealthFetchHeaders('https://www.hltv.org/matches/1/a-vs-b', undefined, 'chrome-win');
    expect(chromeHeaders.get('user-agent')).toContain('Chrome/');
    expect(chromeHeaders.get('sec-ch-ua')).toContain('Chromium');
    expect(chromeHeaders.get('sec-ch-ua-platform')).toBe('"Windows"');

    const firefoxHeaders = buildStealthFetchHeaders('https://www.hltv.org/matches/2/a-vs-b', undefined, 'firefox-mac');
    expect(firefoxHeaders.get('user-agent')).toContain('Firefox/');
    expect(firefoxHeaders.has('sec-ch-ua')).toBe(false);
    expect(firefoxHeaders.get('referer')).toBe('https://www.hltv.org/');
  });
});

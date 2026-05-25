import { USER_AGENT } from './constants';

export interface StealthFetchProfile {
  id: string;
  userAgent: string;
  acceptLanguage: string;
  secChUa?: string;
  secChUaMobile?: string;
  secChUaPlatform?: string;
}

export const STEALTH_FETCH_PROFILES: readonly StealthFetchProfile[] = [
  {
    id: 'chrome-win',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    acceptLanguage: 'en-US,en;q=0.9',
    secChUa: '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
    secChUaMobile: '?0',
    secChUaPlatform: '"Windows"',
  },
  {
    id: 'chrome-mac',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    acceptLanguage: 'en-US,en;q=0.9',
    secChUa: '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
    secChUaMobile: '?0',
    secChUaPlatform: '"macOS"',
  },
  {
    id: 'firefox-win',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
    acceptLanguage: 'en-US,en;q=0.9',
  },
  {
    id: 'firefox-mac',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:126.0) Gecko/20100101 Firefox/126.0',
    acceptLanguage: 'en-US,en;q=0.9',
  },
];

export const STEALTH_BROWSER_USER_AGENT = STEALTH_FETCH_PROFILES[0]?.userAgent ?? USER_AGENT;

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function resolveStealthFetchProfile(profileKey = 'default'): StealthFetchProfile {
  const explicit = STEALTH_FETCH_PROFILES.find((profile) => profile.id === profileKey);
  if (explicit) return explicit;
  return STEALTH_FETCH_PROFILES[stableHash(profileKey) % STEALTH_FETCH_PROFILES.length] ?? STEALTH_FETCH_PROFILES[0];
}

export function buildStealthFetchHeaders(url: string, referer?: string, profileKey?: string): Headers {
  const profile = resolveStealthFetchProfile(profileKey ?? url);
  const headers = new Headers();
  headers.set('user-agent', profile.userAgent);
  headers.set(
    'accept',
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  );
  headers.set('accept-language', profile.acceptLanguage);
  headers.set('cache-control', 'no-cache');
  headers.set('pragma', 'no-cache');
  headers.set('upgrade-insecure-requests', '1');
  headers.set('sec-fetch-dest', 'document');
  headers.set('sec-fetch-mode', 'navigate');
  headers.set('sec-fetch-site', referer ? 'same-origin' : 'none');
  headers.set('sec-fetch-user', '?1');
  if (profile.secChUa) headers.set('sec-ch-ua', profile.secChUa);
  if (profile.secChUaMobile) headers.set('sec-ch-ua-mobile', profile.secChUaMobile);
  if (profile.secChUaPlatform) headers.set('sec-ch-ua-platform', profile.secChUaPlatform);
  if (referer) headers.set('referer', referer);
  if (!referer && new URL(url).pathname !== '/') headers.set('referer', new URL('/', url).toString());
  return headers;
}

/** Fetch text content with the default HLTV-oriented user-agent. */
export async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const headers = new Headers(init.headers);
  if (!headers.has('user-agent')) {
    headers.set('user-agent', USER_AGENT);
  }

  const response = await fetch(url, {
    ...init,
    headers,
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Fetch failed for ${url} with status ${response.status}`);
  }

  return response.text();
}

export async function fetchTextWithStealthHeaders(url: string, referer?: string, profileKey?: string): Promise<string> {
  return fetchText(url, { headers: buildStealthFetchHeaders(url, referer, profileKey) });
}

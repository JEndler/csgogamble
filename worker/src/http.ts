import { USER_AGENT } from './constants';

export const STEALTH_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export function buildStealthFetchHeaders(url: string, referer?: string): Headers {
  const headers = new Headers();
  headers.set('user-agent', STEALTH_BROWSER_USER_AGENT);
  headers.set(
    'accept',
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  );
  headers.set('accept-language', 'en-US,en;q=0.9');
  headers.set('cache-control', 'no-cache');
  headers.set('pragma', 'no-cache');
  headers.set('upgrade-insecure-requests', '1');
  headers.set('sec-fetch-dest', 'document');
  headers.set('sec-fetch-mode', 'navigate');
  headers.set('sec-fetch-site', referer ? 'same-origin' : 'none');
  headers.set('sec-fetch-user', '?1');
  headers.set('sec-ch-ua', '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"');
  headers.set('sec-ch-ua-mobile', '?0');
  headers.set('sec-ch-ua-platform', '"Windows"');
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

export async function fetchTextWithStealthHeaders(url: string, referer?: string): Promise<string> {
  return fetchText(url, { headers: buildStealthFetchHeaders(url, referer) });
}

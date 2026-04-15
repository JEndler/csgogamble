import { USER_AGENT } from './constants';

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

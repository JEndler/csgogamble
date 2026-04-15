import {
  type BrowserPageSnapshot,
  fetchPageSnapshotWithBrowser,
  fetchPageSnapshotWithSession,
} from './browser-session';
import { fetchText } from './http';
import type { AcquisitionMode, Env } from './types';

const DEFAULT_BROWSER_SESSION_KEY = 'default';

export async function acquirePageSnapshot(
  env: Env,
  targetUrl: string,
  acquisitionMode: AcquisitionMode = 'http',
  browserSessionKey?: string,
): Promise<BrowserPageSnapshot> {
  switch (acquisitionMode) {
    case 'browser':
      return fetchPageSnapshotWithBrowser(env, targetUrl);
    case 'browser-session':
      return fetchPageSnapshotWithSession(env, targetUrl, browserSessionKey ?? DEFAULT_BROWSER_SESSION_KEY);
    default:
      return {
        requestedUrl: targetUrl,
        finalUrl: targetUrl,
        html: await fetchText(targetUrl),
        title: null,
      };
  }
}

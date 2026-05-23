import {
  type BrowserPageSnapshot,
  fetchPageSnapshotWithBrowser,
  fetchPageSnapshotWithSession,
} from './browser-session';
import { fetchText, fetchTextWithStealthHeaders } from './http';
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
    case 'browser-native':
      return fetchPageSnapshotWithBrowser(env, targetUrl, { profile: 'native', recaptureChallenge: true });
    case 'browser-stealth':
      return fetchPageSnapshotWithBrowser(env, targetUrl, {
        profile: 'stealth',
        warmup: true,
        recaptureChallenge: true,
      });
    case 'browser-session':
      return fetchPageSnapshotWithSession(env, targetUrl, browserSessionKey ?? DEFAULT_BROWSER_SESSION_KEY);
    case 'browser-session-stealth':
      return fetchPageSnapshotWithSession(env, targetUrl, browserSessionKey ?? DEFAULT_BROWSER_SESSION_KEY, {
        profile: 'stealth',
        warmup: true,
        recaptureChallenge: true,
      });
    case 'http-stealth':
      return {
        requestedUrl: targetUrl,
        finalUrl: targetUrl,
        html: await fetchTextWithStealthHeaders(targetUrl),
        title: null,
      };
    default:
      return {
        requestedUrl: targetUrl,
        finalUrl: targetUrl,
        html: await fetchText(targetUrl),
        title: null,
      };
  }
}

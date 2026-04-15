import puppeteer from '@cloudflare/puppeteer';
import { type BrowserPageSnapshot, closeBrowserSession, fetchPageSnapshotWithBrowser } from './browser-session';
import { discoverMatchUrls, findCloudflareChallengeMarkers } from './hltv';
import { errorResponse, jsonResponse } from './http-response';
import type { Env } from './types';

const DEFAULT_RESULTS_PATH = '/results';
const MATCH_URL_SAMPLE_LIMIT = 10;

export interface BrowserDebugSummary {
  ok: true;
  requestedUrl: string;
  finalUrl: string;
  title: string | null;
  challengeDetected: boolean;
  challengeMarkers: string[];
  discoveredMatchUrlCount: number;
  discoveredMatchUrlsSample: string[];
  htmlBytes: number;
}

export interface BrowserLimitsDebugResponse {
  ok: true;
  limits: unknown;
}

export interface BrowserSessionsDebugResponse {
  ok: true;
  sessions: unknown;
}

export interface BrowserHistoryDebugResponse {
  ok: true;
  history: unknown;
}

interface BrowserDiagnosticsSnapshot {
  limits: unknown;
  sessions: unknown;
  history: unknown;
}

type BrowserDiagnosticsProvider = (env: Env) => Promise<BrowserDiagnosticsSnapshot>;

const defaultBrowserDiagnosticsProvider: BrowserDiagnosticsProvider = async (env) => ({
  limits: await puppeteer.limits(env.BROWSER),
  sessions: await puppeteer.sessions(env.BROWSER),
  history: await puppeteer.history(env.BROWSER),
});

let browserDiagnosticsProvider: BrowserDiagnosticsProvider = defaultBrowserDiagnosticsProvider;

export function setBrowserDiagnosticsProviderForTests(next?: BrowserDiagnosticsProvider): void {
  browserDiagnosticsProvider = next ?? defaultBrowserDiagnosticsProvider;
}

function extractDocumentTitle(html: string): string | null {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch?.[1]?.trim() || null;
}

export function summarizeBrowserHtml(
  snapshot: Pick<BrowserPageSnapshot, 'requestedUrl' | 'finalUrl' | 'html' | 'title'>,
): BrowserDebugSummary {
  const title = snapshot.title?.trim() || extractDocumentTitle(snapshot.html);
  const challengeMarkers = findCloudflareChallengeMarkers(snapshot.html);
  const final = new URL(snapshot.finalUrl);
  const discoveredMatchUrls =
    final.pathname.startsWith(DEFAULT_RESULTS_PATH) || snapshot.requestedUrl.includes('/results')
      ? discoverMatchUrls(final.origin, snapshot.html)
      : [];

  return {
    ok: true,
    requestedUrl: snapshot.requestedUrl,
    finalUrl: snapshot.finalUrl,
    title,
    challengeDetected: challengeMarkers.length > 0,
    challengeMarkers,
    discoveredMatchUrlCount: discoveredMatchUrls.length,
    discoveredMatchUrlsSample: discoveredMatchUrls.slice(0, MATCH_URL_SAMPLE_LIMIT),
    htmlBytes: snapshot.html.length,
  };
}

function readMatchUrl(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Browser match debug body must be an object');
  }

  const matchUrl = (payload as Record<string, unknown>).matchUrl;
  if (typeof matchUrl !== 'string' || matchUrl.length === 0) {
    throw new Error('Browser match debug requires matchUrl');
  }

  return matchUrl;
}

function readSessionKey(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Browser session debug body must be an object');
  }

  const sessionKey = (payload as Record<string, unknown>).sessionKey;
  if (sessionKey === undefined) {
    return undefined;
  }
  if (typeof sessionKey !== 'string' || sessionKey.length === 0) {
    throw new Error('Browser session debug requires sessionKey to be a non-empty string');
  }

  return sessionKey;
}

async function getBrowserDiagnostics(env: Env): Promise<BrowserDiagnosticsSnapshot> {
  return browserDiagnosticsProvider(env);
}

export async function handleBrowserLimitsDebug(env: Env): Promise<Response> {
  try {
    const diagnostics = await getBrowserDiagnostics(env);
    const response: BrowserLimitsDebugResponse = {
      ok: true,
      limits: diagnostics.limits,
    };
    return jsonResponse(response);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Browser limits debug failed', 500);
  }
}

export async function handleBrowserSessionsDebug(env: Env): Promise<Response> {
  try {
    const diagnostics = await getBrowserDiagnostics(env);
    const response: BrowserSessionsDebugResponse = {
      ok: true,
      sessions: diagnostics.sessions,
    };
    return jsonResponse(response);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Browser sessions debug failed', 500);
  }
}

export async function handleBrowserHistoryDebug(env: Env): Promise<Response> {
  try {
    const diagnostics = await getBrowserDiagnostics(env);
    const response: BrowserHistoryDebugResponse = {
      ok: true,
      history: diagnostics.history,
    };
    return jsonResponse(response);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Browser history debug failed', 500);
  }
}

export async function handleBrowserResultsDebug(env: Env, pageUrl?: string): Promise<Response> {
  try {
    const targetUrl = pageUrl || `${env.HLTV_BASE_URL}${DEFAULT_RESULTS_PATH}`;
    return jsonResponse(summarizeBrowserHtml(await fetchPageSnapshotWithBrowser(env, targetUrl)));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Browser results debug failed', 500);
  }
}

export async function handleBrowserMatchDebug(request: Request, env: Env): Promise<Response> {
  try {
    const targetUrl = readMatchUrl(await request.json());
    return jsonResponse(summarizeBrowserHtml(await fetchPageSnapshotWithBrowser(env, targetUrl)));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser match debug failed';
    const status = message.includes('requires matchUrl') || message.includes('must be an object') ? 400 : 500;
    return errorResponse(message, status);
  }
}

export async function handleBrowserSessionClose(request: Request, env: Env): Promise<Response> {
  try {
    const sessionKey = readSessionKey(await request.json());
    return jsonResponse(await closeBrowserSession(env, sessionKey));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser session close failed';
    const status = message.includes('must be an object') || message.includes('requires sessionKey') ? 400 : 500;
    return errorResponse(message, status);
  }
}

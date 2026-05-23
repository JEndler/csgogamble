import { acquirePageSnapshot } from './acquisition';
import { closeBrowserSession } from './browser-session';
import {
  discoverMatchUrls,
  findCloudflareChallengeMarkers,
  findHardCloudflareChallengeMarkers,
  parseMatchHtml,
} from './hltv';
import { errorResponse, jsonResponse } from './http-response';
import type { AcquisitionMode, Env } from './types';

const DEFAULT_MODES: AcquisitionMode[] = [
  'http-stealth',
  'browser-native',
  'browser-stealth',
  'browser-session-stealth',
];
const MAX_REPETITIONS = 5;
const MAX_TARGETS = 5;
const SAMPLE_LIMIT = 10;

interface CanaryTarget {
  name?: string;
  kind?: 'results' | 'match';
  pageUrl?: string;
  matchUrl?: string;
}

interface AcquisitionCanaryBody {
  operatorLabel?: string;
  targets?: CanaryTarget[];
  modes?: AcquisitionMode[];
  repetitions?: number;
  sessionPolicy?: 'fresh-per-attempt' | 'shared-per-mode';
  closeSessions?: boolean;
}

interface CanaryAttemptResult {
  targetName: string;
  kind: 'results' | 'match';
  mode: AcquisitionMode;
  repetition: number;
  sessionKey: string | null;
  requestedUrl: string;
  finalUrl: string | null;
  title: string | null;
  status: 'ok' | 'challenge' | 'unusable' | 'error';
  challengeDetected: boolean;
  hardChallengeMarkers: string[];
  challengeMarkers: string[];
  htmlBytes: number;
  durationMs: number;
  discoveredMatchUrlCount: number | null;
  discoveredMatchUrlsSample: string[];
  parsedStatus: string | null;
  parseWarningCount: number | null;
  error: string | null;
}

function isAuthorized(request: Request, env: Env): boolean {
  const adminToken = env.ADMIN_TOKEN;
  const header = request.headers.get('x-admin-token');
  return Boolean(adminToken) && Boolean(header) && header === adminToken;
}

function isAcquisitionMode(value: unknown): value is AcquisitionMode {
  return (
    value === 'http' ||
    value === 'http-stealth' ||
    value === 'browser' ||
    value === 'browser-native' ||
    value === 'browser-stealth' ||
    value === 'browser-session' ||
    value === 'browser-session-stealth'
  );
}

function readBody(payload: unknown, baseUrl: string): Required<AcquisitionCanaryBody> {
  if (typeof payload !== 'object' || payload === null) throw new Error('Canary body must be a JSON object');
  const body = payload as AcquisitionCanaryBody;
  const defaultTargets: CanaryTarget[] = [{ name: 'results', kind: 'results', pageUrl: `${baseUrl}/results` }];
  const targets = (body.targets?.length ? body.targets : defaultTargets).slice(0, MAX_TARGETS);
  const modes = (body.modes?.length ? body.modes : DEFAULT_MODES).filter(isAcquisitionMode);
  if (modes.length === 0) throw new Error('Canary requires at least one valid acquisition mode');
  const repetitions = Math.min(Math.max(1, Math.floor(body.repetitions ?? 1)), MAX_REPETITIONS);
  return {
    operatorLabel: body.operatorLabel ?? `canary-${Date.now()}`,
    targets,
    modes,
    repetitions,
    sessionPolicy: body.sessionPolicy ?? 'fresh-per-attempt',
    closeSessions: body.closeSessions ?? true,
  };
}

function targetUrl(target: CanaryTarget): { name: string; kind: 'results' | 'match'; url: string } {
  const kind = target.kind ?? (target.matchUrl ? 'match' : 'results');
  const url = kind === 'match' ? target.matchUrl : target.pageUrl;
  if (!url)
    throw new Error(`Canary target ${target.name ?? kind} is missing ${kind === 'match' ? 'matchUrl' : 'pageUrl'}`);
  return { name: target.name ?? kind, kind, url };
}

function buildSessionKey(
  label: string,
  mode: AcquisitionMode,
  targetName: string,
  repetition: number,
  shared: boolean,
): string | null {
  if (!mode.includes('browser-session')) return null;
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48);
  const safeTarget = targetName.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32);
  return shared ? `canary-${safeLabel}-${mode}` : `canary-${safeLabel}-${mode}-${safeTarget}-${repetition}`;
}

function classify(
  kind: 'results' | 'match',
  hardMarkers: string[],
  discoveredCount: number,
  parsedStatus: string | null,
): 'ok' | 'challenge' | 'unusable' {
  if (hardMarkers.length > 0) return 'challenge';
  if (kind === 'results' && discoveredCount === 0) return 'unusable';
  if (kind === 'match' && (!parsedStatus || parsedStatus === 'challenge')) return 'unusable';
  return 'ok';
}

interface CanarySummary {
  attempts: number;
  ok: number;
  challenge: number;
  unusable: number;
  error: number;
  byMode: Record<string, { attempts: number; ok: number; challenge: number; unusable: number; error: number }>;
}

function summarize(results: CanaryAttemptResult[]): CanarySummary {
  const byMode: Record<string, { attempts: number; ok: number; challenge: number; unusable: number; error: number }> =
    {};
  for (const result of results) {
    byMode[result.mode] ??= { attempts: 0, ok: 0, challenge: 0, unusable: 0, error: 0 };
    byMode[result.mode].attempts += 1;
    byMode[result.mode][result.status] += 1;
  }
  return {
    attempts: results.length,
    ok: results.filter((result) => result.status === 'ok').length,
    challenge: results.filter((result) => result.status === 'challenge').length,
    unusable: results.filter((result) => result.status === 'unusable').length,
    error: results.filter((result) => result.status === 'error').length,
    byMode,
  };
}

export async function handleAcquisitionCanary(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) return errorResponse('Unauthorized', 401);
  const body = readBody(await request.json(), env.HLTV_BASE_URL);
  const startedAt = new Date().toISOString();
  const results: CanaryAttemptResult[] = [];
  const sessionKeys = new Set<string>();

  for (const rawTarget of body.targets) {
    const target = targetUrl(rawTarget);
    for (const mode of body.modes) {
      for (let repetition = 1; repetition <= body.repetitions; repetition += 1) {
        const started = Date.now();
        const sessionKey = buildSessionKey(
          body.operatorLabel,
          mode,
          target.name,
          repetition,
          body.sessionPolicy === 'shared-per-mode',
        );
        if (sessionKey) sessionKeys.add(sessionKey);
        try {
          // biome-ignore lint/performance/noAwaitInLoops: canaries must run sequentially to avoid acquisition storms.
          const snapshot = await acquirePageSnapshot(env, target.url, mode, sessionKey ?? undefined);
          const markers = findCloudflareChallengeMarkers(snapshot.html);
          const hardMarkers = findHardCloudflareChallengeMarkers(snapshot.html);
          const discovered =
            target.kind === 'results' ? discoverMatchUrls(new URL(snapshot.finalUrl).origin, snapshot.html) : [];
          const parsed = target.kind === 'match' ? parseMatchHtml(snapshot.finalUrl, snapshot.html) : null;
          const status = classify(target.kind, hardMarkers, discovered.length, parsed?.status ?? null);
          results.push({
            targetName: target.name,
            kind: target.kind,
            mode,
            repetition,
            sessionKey,
            requestedUrl: snapshot.requestedUrl,
            finalUrl: snapshot.finalUrl,
            title: snapshot.title,
            status,
            challengeDetected: hardMarkers.length > 0,
            hardChallengeMarkers: hardMarkers,
            challengeMarkers: markers,
            htmlBytes: snapshot.html.length,
            durationMs: Date.now() - started,
            discoveredMatchUrlCount: target.kind === 'results' ? discovered.length : null,
            discoveredMatchUrlsSample: discovered.slice(0, SAMPLE_LIMIT),
            parsedStatus: parsed?.status ?? null,
            parseWarningCount: parsed?.parseWarnings.length ?? null,
            error: null,
          });
        } catch (error) {
          results.push({
            targetName: target.name,
            kind: target.kind,
            mode,
            repetition,
            sessionKey,
            requestedUrl: target.url,
            finalUrl: null,
            title: null,
            status: 'error',
            challengeDetected: false,
            hardChallengeMarkers: [],
            challengeMarkers: [],
            htmlBytes: 0,
            durationMs: Date.now() - started,
            discoveredMatchUrlCount: target.kind === 'results' ? 0 : null,
            discoveredMatchUrlsSample: [],
            parsedStatus: null,
            parseWarningCount: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  if (body.closeSessions) {
    for (const sessionKey of sessionKeys) {
      // biome-ignore lint/performance/noAwaitInLoops: close each DO session deterministically after the canary.
      await closeBrowserSession(env, sessionKey).catch(() => undefined);
    }
  }

  return jsonResponse({
    ok: true,
    operatorLabel: body.operatorLabel,
    startedAt,
    finishedAt: new Date().toISOString(),
    summary: summarize(results),
    results,
  });
}

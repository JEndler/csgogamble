import {
  type BackfillCandidateSeed,
  claimPendingBackfillCandidates,
  countInFlightBackfillCandidates,
  createBackfillRun,
  getBackfillRun,
  incrementBackfillCounter,
  releaseBackfillCandidates,
  setBackfillRunStatus,
} from './db';
import { buildMatchUrl } from './hltv';
import { errorResponse, jsonResponse } from './http-response';
import { buildIngestMatchMessages, enqueueMessages } from './queue';
import type { AcquisitionMode, Env } from './types';

const DEFAULT_BACKFILL_BATCH_SIZE = 25;
const MAX_BACKFILL_BATCH_SIZE = 100;

interface BackfillStartBody {
  matchIds?: number[];
  candidates?: Array<{ matchId: number; sourceUrl?: string | null }>;
  candidateFilter?: string;
  options?: Record<string, unknown>;
}

interface BackfillEnqueueBody {
  runId: number;
  batchSize?: number;
  acquisitionMode?: AcquisitionMode;
  browserSessionKey?: string;
  source?: string;
}

interface BackfillStatusBody {
  runId: number;
}

function isAuthorized(request: Request, env: Env): boolean {
  const adminTokenEnv = (env as unknown as { ADMIN_TOKEN?: string }).ADMIN_TOKEN;
  if (!adminTokenEnv) return false;
  const header = request.headers.get('x-admin-token');
  return Boolean(header) && header === adminTokenEnv;
}

function readJsonBody<T>(payload: unknown): T {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Admin request body must be a JSON object');
  }
  return payload as T;
}

function readAcquisitionMode(value: unknown): AcquisitionMode {
  if (
    value === 'http' ||
    value === 'http-stealth' ||
    value === 'browser' ||
    value === 'browser-native' ||
    value === 'browser-stealth' ||
    value === 'browser-session' ||
    value === 'browser-session-stealth'
  ) {
    return value;
  }
  return 'browser-session';
}

function toCandidateSeeds(body: BackfillStartBody, baseUrl: string): BackfillCandidateSeed[] {
  if (Array.isArray(body.candidates) && body.candidates.length > 0) {
    return body.candidates
      .filter((entry): entry is { matchId: number; sourceUrl?: string | null } => typeof entry?.matchId === 'number')
      .map((entry) => ({
        hltvMatchId: entry.matchId,
        sourceUrl:
          typeof entry.sourceUrl === 'string' && entry.sourceUrl.length > 0
            ? entry.sourceUrl
            : buildMatchUrl(baseUrl, { matchId: entry.matchId }),
      }));
  }
  if (Array.isArray(body.matchIds)) {
    return body.matchIds
      .filter((id): id is number => typeof id === 'number' && Number.isFinite(id))
      .map((matchId) => ({
        hltvMatchId: matchId,
        sourceUrl: buildMatchUrl(baseUrl, { matchId }),
      }));
  }
  return [];
}

/** POST /admin/backfill/start — create a backfill run and seed candidates. */
export async function handleBackfillStart(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) return errorResponse('Unauthorized', 401);
  const body = readJsonBody<BackfillStartBody>(await request.json());
  const candidates = toCandidateSeeds(body, env.HLTV_BASE_URL);
  if (candidates.length === 0) return errorResponse('No candidates provided', 400);

  const runId = await createBackfillRun(
    env,
    body.candidateFilter ?? null,
    body.options ? JSON.stringify(body.options) : null,
    candidates,
  );

  return jsonResponse({ ok: true, runId, totalCandidates: candidates.length });
}

/**
 * POST /admin/backfill/enqueue — claim a batch of pending candidates, send
 * them to the queue, and only on a successful send mark the run as running and
 * bump the enqueued counter. On send failure, the claim is rolled back so the
 * candidates return to `pending` and a retry will pick them up cleanly.
 */
export async function handleBackfillEnqueue(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) return errorResponse('Unauthorized', 401);
  const body = readJsonBody<BackfillEnqueueBody>(await request.json());
  const run = await getBackfillRun(env, body.runId);
  if (!run) return errorResponse(`Unknown backfill run ${body.runId}`, 404);

  const batchSize = Math.min(Math.max(1, body.batchSize ?? DEFAULT_BACKFILL_BATCH_SIZE), MAX_BACKFILL_BATCH_SIZE);
  const claimed = await claimPendingBackfillCandidates(env, body.runId, batchSize);
  if (claimed.length === 0) {
    const inFlight = await countInFlightBackfillCandidates(env, body.runId);
    const status = inFlight === 0 ? 'completed' : 'draining';
    await setBackfillRunStatus(env, body.runId, status);
    return jsonResponse({ ok: true, runId: body.runId, enqueued: 0, drained: true, inFlight });
  }

  const acquisitionMode = readAcquisitionMode(body.acquisitionMode);
  const browserSessionKey = body.browserSessionKey ?? `backfill-${body.runId}`;
  const source = body.source ?? `backfill:${body.runId}`;
  const messages = claimed.map((candidate) => {
    const [message] = buildIngestMatchMessages(
      [candidate.sourceUrl ?? buildMatchUrl(env.HLTV_BASE_URL, { matchId: candidate.hltvMatchId })],
      { persistHtml: true, source, acquisitionMode, browserSessionKey },
    );
    if (!message) throw new Error('buildIngestMatchMessages returned empty result');
    return {
      ...message,
      payload: {
        ...message.payload,
        backfillRunId: body.runId,
        backfillCandidateId: candidate.id,
      },
    };
  });

  try {
    await enqueueMessages(env, messages);
  } catch (error) {
    // Roll the claim back so the candidates are visible to the next enqueue call.
    // Without this, a queue.sendBatch failure would silently strand them in
    // `enqueued` with no consumer ever finalizing them.
    await releaseBackfillCandidates(
      env,
      claimed.map((candidate) => candidate.id),
    );
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to enqueue backfill batch: ${message}`, 502);
  }

  await incrementBackfillCounter(env, body.runId, 'enqueued', claimed.length);
  await setBackfillRunStatus(env, body.runId, 'running');

  return jsonResponse({ ok: true, runId: body.runId, enqueued: claimed.length, drained: false });
}

/** POST /admin/backfill/status — return current counters for a backfill run. */
export async function handleBackfillStatus(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) return errorResponse('Unauthorized', 401);
  const body = readJsonBody<BackfillStatusBody>(await request.json());
  const run = await getBackfillRun(env, body.runId);
  if (!run) return errorResponse(`Unknown backfill run ${body.runId}`, 404);
  return jsonResponse({ ok: true, run });
}

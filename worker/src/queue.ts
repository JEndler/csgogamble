import { handleRequest } from './app';
import {
  classifyFailure,
  evaluateCircuit,
  type FailureClass,
  recordFailure,
  recordSuccess,
  SCHEDULED_DISCOVERY_CIRCUIT_KEY,
} from './circuit';
import type { DiscoverResultsResponse, ErrorResponse, IngestMatchResponse, MatchStatus } from './contracts';
import {
  type BackfillCandidateTerminalState,
  countOpenBackfillCandidates,
  createIngestRun,
  finalizeBackfillCandidate,
  finishIngestRun,
  getBackfillCandidateForRun,
  incrementBackfillCounter,
  releaseCrawlLock,
  setBackfillRunStatus,
  tryAcquireCrawlLock,
} from './db';
import type { AcquisitionMode, DiscoverQueueMessage, Env, IngestMatchQueueMessage, WorkerQueueMessage } from './types';

const INTERNAL_BASE_URL = 'https://internal.csgogamble-worker';
const SCHEDULED_DISCOVER_LOCK_KEY = 'scheduled_discovery_lock';
const SCHEDULED_DISCOVER_LOCK_TTL_MS = 10 * 60 * 1_000;
/** Canary challenge must open the circuit immediately to abort fan-out. */
const CANARY_CHALLENGE_THRESHOLD = 1;

type QueueDispatchResult = DiscoverResultsResponse | IngestMatchResponse;

class QueueMessageValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readOptionalAcquisitionMode(value: unknown): AcquisitionMode | undefined {
  return value === 'http' || value === 'browser' || value === 'browser-session' ? value : undefined;
}

function isQueueMessageValidationError(error: unknown): error is QueueMessageValidationError {
  return error instanceof QueueMessageValidationError;
}

async function invokeEndpoint<TResponse extends QueueDispatchResult>(
  env: Env,
  path: '/discover/results' | '/ingest/match',
  payload: Record<string, unknown>,
): Promise<TResponse> {
  const response = await handleRequest(
    new Request(`${INTERNAL_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    }),
    env,
  );

  const body = (await response.json()) as TResponse | ErrorResponse;
  if (!response.ok) {
    throw new Error('error' in body ? body.error : `Internal ${path} request failed with ${response.status}`);
  }

  return body as TResponse;
}

export function createDiscoverResultsMessage(payload: DiscoverQueueMessage['payload'] = {}): DiscoverQueueMessage {
  return {
    type: 'discover-results',
    payload: {
      pageUrl: payload.pageUrl,
      html: payload.html,
      persistHtml: payload.persistHtml,
      source: payload.source,
      acquisitionMode: payload.acquisitionMode,
      browserSessionKey: payload.browserSessionKey,
      maxMatches: payload.maxMatches,
      canary: payload.canary,
      followupMaxMatches: payload.followupMaxMatches,
    },
  };
}

export function createIngestMatchMessage(payload: IngestMatchQueueMessage['payload']): IngestMatchQueueMessage {
  return {
    type: 'ingest-match',
    payload: {
      matchUrl: payload.matchUrl,
      matchId: payload.matchId,
      html: payload.html,
      persistHtml: payload.persistHtml,
      source: payload.source,
      acquisitionMode: payload.acquisitionMode,
      browserSessionKey: payload.browserSessionKey,
      backfillRunId: payload.backfillRunId,
      backfillCandidateId: payload.backfillCandidateId,
    },
  };
}

export function buildIngestMatchMessages(
  matchUrls: string[],
  options: Pick<
    IngestMatchQueueMessage['payload'],
    'persistHtml' | 'source' | 'acquisitionMode' | 'browserSessionKey'
  > = {},
): IngestMatchQueueMessage[] {
  return matchUrls.map((matchUrl) =>
    createIngestMatchMessage({
      matchUrl,
      persistHtml: options.persistHtml,
      source: options.source,
      acquisitionMode: options.acquisitionMode,
      browserSessionKey: options.browserSessionKey,
    }),
  );
}

function parseDiscoverPayload(payload: Record<string, unknown>): DiscoverQueueMessage {
  const message = createDiscoverResultsMessage({
    pageUrl: readOptionalString(payload.pageUrl),
    html: readOptionalString(payload.html),
    persistHtml: readOptionalBoolean(payload.persistHtml),
    source: readOptionalString(payload.source),
    acquisitionMode: readOptionalAcquisitionMode(payload.acquisitionMode),
    browserSessionKey: readOptionalString(payload.browserSessionKey),
    maxMatches: readOptionalNumber(payload.maxMatches),
    canary: readOptionalBoolean(payload.canary),
    followupMaxMatches: readOptionalNumber(payload.followupMaxMatches),
  });

  if (payload.pageUrl !== undefined && message.payload.pageUrl === undefined && payload.pageUrl !== null) {
    throw new QueueMessageValidationError('Queue discovery job requires a string pageUrl when provided');
  }

  if (payload.html !== undefined && message.payload.html === undefined && payload.html !== null) {
    throw new QueueMessageValidationError('Queue discovery job requires html to be a string when provided');
  }

  return message;
}

function parseIngestPayload(payload: Record<string, unknown>): IngestMatchQueueMessage {
  const message = createIngestMatchMessage({
    matchUrl: readOptionalString(payload.matchUrl),
    matchId: readOptionalNumber(payload.matchId),
    html: readOptionalString(payload.html),
    persistHtml: readOptionalBoolean(payload.persistHtml),
    source: readOptionalString(payload.source),
    acquisitionMode: readOptionalAcquisitionMode(payload.acquisitionMode),
    browserSessionKey: readOptionalString(payload.browserSessionKey),
    backfillRunId: readOptionalNumber(payload.backfillRunId),
    backfillCandidateId: readOptionalNumber(payload.backfillCandidateId),
  });

  if (!message.payload.matchUrl && message.payload.matchId === undefined) {
    throw new QueueMessageValidationError('Queue ingest job requires either matchUrl or matchId');
  }

  if (payload.matchUrl !== undefined && message.payload.matchUrl === undefined && payload.matchUrl !== null) {
    throw new QueueMessageValidationError('Queue ingest job requires matchUrl to be a string when provided');
  }

  if (payload.matchId !== undefined && message.payload.matchId === undefined && payload.matchId !== null) {
    throw new QueueMessageValidationError('Queue ingest job requires matchId to be numeric when provided');
  }

  return message;
}

export function parseQueueMessage(payload: unknown): WorkerQueueMessage {
  if (!isRecord(payload) || typeof payload.type !== 'string' || !isRecord(payload.payload)) {
    throw new QueueMessageValidationError('Queue message must contain a type and payload object');
  }

  if (payload.type === 'discover-results') {
    return parseDiscoverPayload(payload.payload);
  }

  if (payload.type === 'ingest-match') {
    return parseIngestPayload(payload.payload);
  }

  throw new QueueMessageValidationError('Unsupported queue message type');
}

export async function enqueueMessages(env: Env, messages: readonly WorkerQueueMessage[]): Promise<void> {
  if (messages.length === 0) {
    return;
  }

  await env.INGESTION_QUEUE.sendBatch(messages.map((body) => ({ body })));
}

async function dispatchInlineSessionIngest(
  env: Env,
  ingestMessages: readonly IngestMatchQueueMessage[],
): Promise<number> {
  let successCount = 0;
  for (const ingestMessage of ingestMessages) {
    // Sequential ingest is intentional: every message reuses the same browser session,
    // which can only service one request at a time.
    // biome-ignore lint/performance/noAwaitInLoops: shared browser session requires sequential dispatch
    await processIngestMessage(env, ingestMessage);
    successCount += 1;
  }
  return successCount;
}

async function runDiscovery(env: Env, message: DiscoverQueueMessage, runId: number): Promise<void> {
  const response = await invokeEndpoint<DiscoverResultsResponse>(env, '/discover/results', {
    pageUrl: message.payload.pageUrl,
    html: message.payload.html,
    acquisitionMode: message.payload.acquisitionMode,
    browserSessionKey: message.payload.browserSessionKey,
    maxMatches: message.payload.maxMatches,
  });

  // Canary discoveries don't fan out themselves; they enqueue a follow-up
  // discovery sized by `followupMaxMatches` after proving the source is healthy.
  if (message.payload.canary) {
    const followupMaxMatches = message.payload.followupMaxMatches ?? 20;
    await enqueueMessages(env, [
      createDiscoverResultsMessage({
        source: message.payload.source ? `${message.payload.source}:followup` : 'cron:canary:followup',
        acquisitionMode: message.payload.acquisitionMode,
        browserSessionKey: message.payload.browserSessionKey,
        maxMatches: followupMaxMatches,
        persistHtml: message.payload.persistHtml,
      }),
    ]);
    if (runId) {
      await finishIngestRun(
        env,
        runId,
        'success',
        `Canary discovered ${response.discovered} matches; enqueued follow-up discovery with maxMatches=${followupMaxMatches}`,
      );
    }
    return;
  }

  const ingestMessages = buildIngestMatchMessages(response.matchUrls, {
    persistHtml: message.payload.persistHtml,
    source: message.payload.source,
    acquisitionMode: message.payload.acquisitionMode,
    browserSessionKey: message.payload.browserSessionKey,
  });

  if (message.payload.acquisitionMode === 'browser-session' && message.payload.browserSessionKey) {
    const successCount = await dispatchInlineSessionIngest(env, ingestMessages);
    if (runId) {
      await finishIngestRun(
        env,
        runId,
        'success',
        `Discovered ${response.discovered} matches; ingested ${successCount} inline via shared browser session`,
      );
    }
    return;
  }

  await enqueueMessages(env, ingestMessages);
  if (runId) {
    await finishIngestRun(
      env,
      runId,
      'success',
      `Discovered ${response.discovered} matches; enqueued ${ingestMessages.length} ingest jobs`,
    );
  }
}

interface DiscoverContext {
  isScheduledRun: boolean;
  runTarget: string | null;
  lockToken: string | null;
}

function buildDiscoverContext(message: DiscoverQueueMessage): DiscoverContext {
  const isScheduledRun = message.payload.source?.startsWith('cron:') ?? false;
  const runTarget = message.payload.browserSessionKey ?? message.payload.pageUrl ?? null;
  const lockToken = isScheduledRun ? `${message.payload.browserSessionKey ?? 'cron'}:${Date.now()}` : null;
  return { isScheduledRun, runTarget, lockToken };
}

async function startDiscoverRun(env: Env, message: DiscoverQueueMessage, context: DiscoverContext): Promise<number> {
  if (!context.isScheduledRun) return 0;
  const scope = message.payload.canary ? 'scheduled-discovery-canary' : 'scheduled-discovery';
  return await createIngestRun(
    env,
    scope,
    context.runTarget,
    'running',
    `Starting ${message.payload.canary ? 'canary ' : ''}scheduled discovery with maxMatches=${message.payload.maxMatches ?? 'default'}`,
  );
}

async function processDiscoverMessage(env: Env, message: DiscoverQueueMessage): Promise<void> {
  const context = buildDiscoverContext(message);

  if (context.isScheduledRun) {
    const decision = await evaluateCircuit(env, { key: SCHEDULED_DISCOVERY_CIRCUIT_KEY });
    if (decision.open) {
      const cooldownMinutes = Math.ceil(decision.cooldownRemainingMs / 60_000);
      await createIngestRun(
        env,
        message.payload.canary ? 'scheduled-discovery-canary' : 'scheduled-discovery',
        context.runTarget,
        'skipped_circuit_open',
        `Circuit open; cooldown ${cooldownMinutes}m remaining (lastClass=${decision.state.lastFailureClass ?? 'none'})`,
        decision.state.lastFailureClass,
      );
      return;
    }
  }

  const lockAcquired = context.lockToken
    ? await tryAcquireCrawlLock(env, SCHEDULED_DISCOVER_LOCK_KEY, context.lockToken, SCHEDULED_DISCOVER_LOCK_TTL_MS)
    : true;

  if (!lockAcquired) {
    if (context.isScheduledRun) {
      await createIngestRun(
        env,
        message.payload.canary ? 'scheduled-discovery-canary' : 'scheduled-discovery',
        context.runTarget,
        'skipped',
        'Skipped because another scheduled discovery batch still holds the crawl lock',
      );
    }
    return;
  }

  const runId = await startDiscoverRun(env, message, context);

  try {
    await runDiscovery(env, message, runId);
    if (context.isScheduledRun) {
      await recordSuccess(env, { key: SCHEDULED_DISCOVERY_CIRCUIT_KEY });
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    const failureClass: FailureClass = classifyFailure(error);
    const isClassified = failureClass !== 'unknown';

    if (context.isScheduledRun) {
      await recordFailure(env, failureClass, messageText, {
        key: SCHEDULED_DISCOVERY_CIRCUIT_KEY,
        threshold: message.payload.canary ? CANARY_CHALLENGE_THRESHOLD : undefined,
      });
    }

    if (runId) {
      const finalStatus = failureClass === 'challenge' ? 'challenge' : isClassified ? 'failed_classified' : 'error';
      await finishIngestRun(env, runId, finalStatus, messageText, failureClass);
    }

    if (failureClass === 'challenge' || isClassified) {
      // Classified failures are not retried — retrying a challenge storm just wastes the source budget.
      return;
    }
    throw error;
  } finally {
    if (context.lockToken) {
      await releaseCrawlLock(env, SCHEDULED_DISCOVER_LOCK_KEY, context.lockToken);
    }
  }
}

/**
 * Map an ingest match status to the canonical backfill candidate terminal
 * state. `parsed`/`partial`/`challenge` map 1:1; `error` becomes
 * `failed_classified` because the consumer already classified the failure.
 */
function ingestStatusToCandidateState(status: MatchStatus | null): BackfillCandidateTerminalState {
  switch (status) {
    case 'parsed':
      return 'parsed';
    case 'partial':
      return 'partial';
    case 'challenge':
      return 'challenge';
    default:
      return 'failed_classified';
  }
}

async function finalizeBackfillFromIngest(
  env: Env,
  runId: number,
  candidateId: number,
  terminalState: BackfillCandidateTerminalState,
  options: { failureClass?: string | null; message?: string | null } = {},
): Promise<boolean> {
  const finalized = await finalizeBackfillCandidate(env, candidateId, terminalState, options);
  if (!finalized) return false;

  await incrementBackfillCounter(env, runId, terminalState, 1);
  if ((await countOpenBackfillCandidates(env, runId)) === 0) {
    await setBackfillRunStatus(env, runId, 'completed');
  }
  return true;
}

async function processIngestMessage(env: Env, message: IngestMatchQueueMessage): Promise<void> {
  const { backfillRunId, backfillCandidateId } = message.payload;
  if (backfillRunId && backfillCandidateId) {
    const candidate = await getBackfillCandidateForRun(env, backfillRunId, backfillCandidateId);
    if (!candidate || candidate.state !== 'enqueued') {
      return;
    }
  }
  try {
    const response = await invokeEndpoint<IngestMatchResponse>(env, '/ingest/match', {
      matchUrl: message.payload.matchUrl,
      matchId: message.payload.matchId,
      html: message.payload.html,
      persistHtml: message.payload.persistHtml,
      acquisitionMode: message.payload.acquisitionMode,
      browserSessionKey: message.payload.browserSessionKey,
    });

    if (backfillRunId && backfillCandidateId) {
      const terminalState = ingestStatusToCandidateState(response.parsed?.status ?? null);
      await finalizeBackfillFromIngest(env, backfillRunId, backfillCandidateId, terminalState, {
        failureClass: terminalState === 'challenge' ? 'challenge' : null,
        message: response.parsed?.parseWarnings?.[0] ?? null,
      });
    }
  } catch (error) {
    if (backfillRunId && backfillCandidateId) {
      const failureClass = classifyFailure(error);
      if (failureClass === 'unknown') {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const terminalState: BackfillCandidateTerminalState =
        failureClass === 'challenge' ? 'challenge' : 'failed_classified';
      await finalizeBackfillFromIngest(env, backfillRunId, backfillCandidateId, terminalState, {
        failureClass,
        message,
      });
      return;
    }
    throw error;
  }
}

export async function processQueueBatch(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  let firstError: Error | null = null;

  for (const message of batch.messages) {
    try {
      const queueMessage = parseQueueMessage(message.body);
      // Sequential processing is intentional: queue messages may share browser sessions
      // or crawl locks, and parallel execution would corrupt that shared state.
      // biome-ignore lint/performance/noAwaitInLoops: shared browser/lock state requires sequential processing
      await (queueMessage.type === 'discover-results'
        ? processDiscoverMessage(env, queueMessage)
        : processIngestMessage(env, queueMessage));
      message.ack();
    } catch (error) {
      if (isQueueMessageValidationError(error)) {
        message.ack();
      } else {
        message.retry();
      }

      if (!firstError) {
        firstError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  if (firstError) {
    throw firstError;
  }
}

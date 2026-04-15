import { handleRequest } from './app';
import type { DiscoverResultsResponse, ErrorResponse, IngestMatchResponse } from './contracts';
import type { AcquisitionMode, DiscoverQueueMessage, Env, IngestMatchQueueMessage, WorkerQueueMessage } from './types';

const INTERNAL_BASE_URL = 'https://internal.csgogamble-worker';

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

export function parseQueueMessage(payload: unknown): WorkerQueueMessage {
  if (!isRecord(payload) || typeof payload.type !== 'string' || !isRecord(payload.payload)) {
    throw new QueueMessageValidationError('Queue message must contain a type and payload object');
  }

  if (payload.type === 'discover-results') {
    const message = createDiscoverResultsMessage({
      pageUrl: readOptionalString(payload.payload.pageUrl),
      html: readOptionalString(payload.payload.html),
      persistHtml: readOptionalBoolean(payload.payload.persistHtml),
      source: readOptionalString(payload.payload.source),
      acquisitionMode: readOptionalAcquisitionMode(payload.payload.acquisitionMode),
      browserSessionKey: readOptionalString(payload.payload.browserSessionKey),
    });

    if (
      payload.payload.pageUrl !== undefined &&
      message.payload.pageUrl === undefined &&
      payload.payload.pageUrl !== null
    ) {
      throw new QueueMessageValidationError('Queue discovery job requires a string pageUrl when provided');
    }

    if (payload.payload.html !== undefined && message.payload.html === undefined && payload.payload.html !== null) {
      throw new QueueMessageValidationError('Queue discovery job requires html to be a string when provided');
    }

    return message;
  }

  if (payload.type === 'ingest-match') {
    const message = createIngestMatchMessage({
      matchUrl: readOptionalString(payload.payload.matchUrl),
      matchId: readOptionalNumber(payload.payload.matchId),
      html: readOptionalString(payload.payload.html),
      persistHtml: readOptionalBoolean(payload.payload.persistHtml),
      source: readOptionalString(payload.payload.source),
      acquisitionMode: readOptionalAcquisitionMode(payload.payload.acquisitionMode),
      browserSessionKey: readOptionalString(payload.payload.browserSessionKey),
    });

    if (!message.payload.matchUrl && message.payload.matchId === undefined) {
      throw new QueueMessageValidationError('Queue ingest job requires either matchUrl or matchId');
    }

    if (
      payload.payload.matchUrl !== undefined &&
      message.payload.matchUrl === undefined &&
      payload.payload.matchUrl !== null
    ) {
      throw new QueueMessageValidationError('Queue ingest job requires matchUrl to be a string when provided');
    }

    if (
      payload.payload.matchId !== undefined &&
      message.payload.matchId === undefined &&
      payload.payload.matchId !== null
    ) {
      throw new QueueMessageValidationError('Queue ingest job requires matchId to be numeric when provided');
    }

    return message;
  }

  throw new QueueMessageValidationError('Unsupported queue message type');
}

export async function enqueueMessages(env: Env, messages: readonly WorkerQueueMessage[]): Promise<void> {
  if (messages.length === 0) {
    return;
  }

  await env.INGESTION_QUEUE.sendBatch(messages.map((body) => ({ body })));
}

async function processDiscoverMessage(env: Env, message: DiscoverQueueMessage): Promise<void> {
  const response = await invokeEndpoint<DiscoverResultsResponse>(env, '/discover/results', {
    pageUrl: message.payload.pageUrl,
    html: message.payload.html,
    acquisitionMode: message.payload.acquisitionMode,
    browserSessionKey: message.payload.browserSessionKey,
  });

  await enqueueMessages(
    env,
    buildIngestMatchMessages(response.matchUrls, {
      persistHtml: message.payload.persistHtml,
      source: message.payload.source,
      acquisitionMode: message.payload.acquisitionMode,
      browserSessionKey: message.payload.browserSessionKey,
    }),
  );
}

async function processIngestMessage(env: Env, message: IngestMatchQueueMessage): Promise<void> {
  await invokeEndpoint<IngestMatchResponse>(env, '/ingest/match', {
    matchUrl: message.payload.matchUrl,
    matchId: message.payload.matchId,
    html: message.payload.html,
    persistHtml: message.payload.persistHtml,
    acquisitionMode: message.payload.acquisitionMode,
    browserSessionKey: message.payload.browserSessionKey,
  });
}

export async function processQueueBatch(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  let firstError: Error | null = null;

  for (const message of batch.messages) {
    try {
      const queueMessage = parseQueueMessage(message.body);
      if (queueMessage.type === 'discover-results') {
        await processDiscoverMessage(env, queueMessage);
      } else {
        await processIngestMessage(env, queueMessage);
      }
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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handleRequestMock, tryAcquireCrawlLockMock, releaseCrawlLockMock, createIngestRunMock, finishIngestRunMock } =
  vi.hoisted(() => ({
    handleRequestMock: vi.fn(),
    tryAcquireCrawlLockMock: vi.fn(),
    releaseCrawlLockMock: vi.fn(),
    createIngestRunMock: vi.fn(),
    finishIngestRunMock: vi.fn(),
  }));

vi.mock('../src/app', () => ({
  handleRequest: handleRequestMock,
}));

vi.mock('../src/db', () => ({
  tryAcquireCrawlLock: tryAcquireCrawlLockMock,
  releaseCrawlLock: releaseCrawlLockMock,
  createIngestRun: createIngestRunMock,
  finishIngestRun: finishIngestRunMock,
}));

import {
  buildIngestMatchMessages,
  createDiscoverResultsMessage,
  createIngestMatchMessage,
  parseQueueMessage,
  processQueueBatch,
} from '../src/queue';
import type { Env, WorkerQueueMessage } from '../src/types';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function createBatch(messages: WorkerQueueMessage[]): MessageBatch<unknown> {
  return {
    messages: messages.map((body) => ({
      body,
      ack: vi.fn(),
      retry: vi.fn(),
    })),
    queue: 'csgogamble-ingestion',
  } as unknown as MessageBatch<unknown>;
}

describe('queue orchestration helpers', () => {
  beforeEach(() => {
    handleRequestMock.mockReset();
    tryAcquireCrawlLockMock.mockReset();
    releaseCrawlLockMock.mockReset();
    createIngestRunMock.mockReset();
    finishIngestRunMock.mockReset();
    tryAcquireCrawlLockMock.mockResolvedValue(true);
    releaseCrawlLockMock.mockResolvedValue(undefined);
    createIngestRunMock.mockResolvedValue(101);
    finishIngestRunMock.mockResolvedValue(undefined);
  });

  it('creates and parses a discover-results queue message', () => {
    const message = createDiscoverResultsMessage({
      pageUrl: 'https://www.hltv.org/results?offset=100',
      persistHtml: false,
      source: 'scheduled',
      acquisitionMode: 'browser-session',
      browserSessionKey: 'cron-batch-1',
      maxMatches: 20,
    });

    expect(parseQueueMessage(message)).toEqual(message);
  });

  it('creates ingest-match queue messages from discovered URLs', () => {
    expect(
      buildIngestMatchMessages(
        ['https://www.hltv.org/matches/123/alpha-vs-beta', 'https://www.hltv.org/matches/456/gamma-vs-delta'],
        {
          persistHtml: false,
          source: 'cron:*/15 * * * *',
          acquisitionMode: 'browser-session',
          browserSessionKey: 'cron-batch-1',
        },
      ),
    ).toEqual([
      createIngestMatchMessage({
        matchUrl: 'https://www.hltv.org/matches/123/alpha-vs-beta',
        persistHtml: false,
        source: 'cron:*/15 * * * *',
        acquisitionMode: 'browser-session',
        browserSessionKey: 'cron-batch-1',
      }),
      createIngestMatchMessage({
        matchUrl: 'https://www.hltv.org/matches/456/gamma-vs-delta',
        persistHtml: false,
        source: 'cron:*/15 * * * *',
        acquisitionMode: 'browser-session',
        browserSessionKey: 'cron-batch-1',
      }),
    ]);
  });

  it('processes browser-session discovery inline instead of re-queueing per match', async () => {
    handleRequestMock
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          pageUrl: 'https://www.hltv.org/results',
          discovered: 2,
          matchUrls: [
            'https://www.hltv.org/matches/123/alpha-vs-beta',
            'https://www.hltv.org/matches/456/gamma-vs-delta',
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, fetchedAt: 'now', parsed: {}, artifact: null, notes: [] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, fetchedAt: 'now', parsed: {}, artifact: null, notes: [] }));

    const sendBatch = vi.fn();
    const batch = createBatch([
      createDiscoverResultsMessage({
        acquisitionMode: 'browser-session',
        browserSessionKey: 'cron-123',
        source: 'cron:test',
        maxMatches: 2,
      }),
    ]);

    await processQueueBatch(batch, {
      INGESTION_QUEUE: { sendBatch },
    } as unknown as Env);

    expect(sendBatch).not.toHaveBeenCalled();
    expect(tryAcquireCrawlLockMock).toHaveBeenCalledTimes(1);
    expect(createIngestRunMock).toHaveBeenCalledWith(
      expect.anything(),
      'scheduled-discovery',
      'cron-123',
      'running',
      'Starting scheduled discovery with maxMatches=2',
    );
    expect(releaseCrawlLockMock).toHaveBeenCalledTimes(1);
    expect(finishIngestRunMock).toHaveBeenCalledWith(
      expect.anything(),
      101,
      'success',
      'Discovered 2 matches; ingested 2 inline via shared browser session',
    );
    expect(handleRequestMock).toHaveBeenCalledTimes(3);

    const discoverBody = JSON.parse(await (handleRequestMock.mock.calls[0]?.[0] as Request).text());
    expect(discoverBody).toEqual(
      expect.objectContaining({
        acquisitionMode: 'browser-session',
        browserSessionKey: 'cron-123',
        maxMatches: 2,
      }),
    );

    const ingestBodies = await Promise.all(
      handleRequestMock.mock.calls.slice(1).map(async ([request]) => JSON.parse(await (request as Request).text())),
    );
    expect(ingestBodies).toEqual([
      expect.objectContaining({
        matchUrl: 'https://www.hltv.org/matches/123/alpha-vs-beta',
        acquisitionMode: 'browser-session',
        browserSessionKey: 'cron-123',
      }),
      expect.objectContaining({
        matchUrl: 'https://www.hltv.org/matches/456/gamma-vs-delta',
        acquisitionMode: 'browser-session',
        browserSessionKey: 'cron-123',
      }),
    ]);
  });

  it('re-queues discovered matches for non-session acquisition modes', async () => {
    handleRequestMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        pageUrl: 'https://www.hltv.org/results',
        discovered: 1,
        matchUrls: ['https://www.hltv.org/matches/123/alpha-vs-beta'],
      }),
    );

    const sendBatch = vi.fn();
    const batch = createBatch([
      createDiscoverResultsMessage({
        acquisitionMode: 'http',
        source: 'cron:test',
      }),
    ]);

    await processQueueBatch(batch, {
      INGESTION_QUEUE: { sendBatch },
    } as unknown as Env);

    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(handleRequestMock).toHaveBeenCalledTimes(1);
  });

  it('skips a scheduled discovery batch when another scheduled batch still holds the lock', async () => {
    tryAcquireCrawlLockMock.mockResolvedValueOnce(false);

    const batch = createBatch([
      createDiscoverResultsMessage({
        acquisitionMode: 'browser-session',
        browserSessionKey: 'cron-locked',
        source: 'cron:test',
        maxMatches: 20,
      }),
    ]);

    await processQueueBatch(batch, {
      INGESTION_QUEUE: { sendBatch: vi.fn() },
    } as unknown as Env);

    expect(createIngestRunMock).toHaveBeenCalledWith(
      expect.anything(),
      'scheduled-discovery',
      'cron-locked',
      'skipped',
      'Skipped because another scheduled discovery batch still holds the crawl lock',
    );
    expect(handleRequestMock).not.toHaveBeenCalled();
    expect(releaseCrawlLockMock).not.toHaveBeenCalled();
    expect((batch.messages[0] as unknown as { ack: ReturnType<typeof vi.fn> }).ack).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed queue messages', () => {
    expect(() => parseQueueMessage({ type: 'unknown', payload: {} })).toThrow('Unsupported queue message type');
    expect(() => parseQueueMessage({ type: 'discover-results', payload: { pageUrl: 123 } })).toThrow(
      'Queue discovery job requires a string pageUrl when provided',
    );
    expect(() => parseQueueMessage({ type: 'ingest-match', payload: {} })).toThrow(
      'Queue ingest job requires either matchUrl or matchId',
    );
  });
});

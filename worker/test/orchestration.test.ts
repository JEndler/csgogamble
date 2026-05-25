// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: legacy parser/test fixtures are intentionally dense; refactor separately.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  handleRequestMock,
  tryAcquireCrawlLockMock,
  releaseCrawlLockMock,
  createIngestRunMock,
  finishIngestRunMock,
  getBackfillCandidateForRunMock,
  finalizeBackfillCandidateMock,
  incrementBackfillCounterMock,
  countOpenBackfillCandidatesMock,
  setBackfillRunStatusMock,
  evaluateCircuitMock,
  recordFailureMock,
  recordSuccessMock,
} = vi.hoisted(() => ({
  handleRequestMock: vi.fn(),
  tryAcquireCrawlLockMock: vi.fn(),
  releaseCrawlLockMock: vi.fn(),
  createIngestRunMock: vi.fn(),
  finishIngestRunMock: vi.fn(),
  getBackfillCandidateForRunMock: vi.fn(),
  finalizeBackfillCandidateMock: vi.fn(),
  incrementBackfillCounterMock: vi.fn(),
  countOpenBackfillCandidatesMock: vi.fn(),
  setBackfillRunStatusMock: vi.fn(),
  evaluateCircuitMock: vi.fn(),
  recordFailureMock: vi.fn(),
  recordSuccessMock: vi.fn(),
}));

vi.mock('../src/app', () => ({
  handleRequest: handleRequestMock,
}));

vi.mock('../src/db', () => ({
  tryAcquireCrawlLock: tryAcquireCrawlLockMock,
  releaseCrawlLock: releaseCrawlLockMock,
  createIngestRun: createIngestRunMock,
  finishIngestRun: finishIngestRunMock,
  getBackfillCandidateForRun: getBackfillCandidateForRunMock,
  finalizeBackfillCandidate: finalizeBackfillCandidateMock,
  incrementBackfillCounter: incrementBackfillCounterMock,
  countOpenBackfillCandidates: countOpenBackfillCandidatesMock,
  setBackfillRunStatus: setBackfillRunStatusMock,
}));

vi.mock('../src/circuit', async () => {
  const actual = await vi.importActual<typeof import('../src/circuit')>('../src/circuit');
  return {
    ...actual,
    evaluateCircuit: evaluateCircuitMock,
    recordFailure: recordFailureMock,
    recordSuccess: recordSuccessMock,
  };
});

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
    getBackfillCandidateForRunMock.mockReset();
    finalizeBackfillCandidateMock.mockReset();
    incrementBackfillCounterMock.mockReset();
    countOpenBackfillCandidatesMock.mockReset();
    setBackfillRunStatusMock.mockReset();
    evaluateCircuitMock.mockReset();
    recordFailureMock.mockReset();
    recordSuccessMock.mockReset();
    tryAcquireCrawlLockMock.mockResolvedValue(true);
    releaseCrawlLockMock.mockResolvedValue(undefined);
    createIngestRunMock.mockResolvedValue(101);
    finishIngestRunMock.mockResolvedValue(undefined);
    getBackfillCandidateForRunMock.mockResolvedValue(null);
    finalizeBackfillCandidateMock.mockResolvedValue(true);
    incrementBackfillCounterMock.mockResolvedValue(undefined);
    countOpenBackfillCandidatesMock.mockResolvedValue(1);
    setBackfillRunStatusMock.mockResolvedValue(undefined);
    evaluateCircuitMock.mockResolvedValue({
      open: false,
      cooldownRemainingMs: 0,
      state: {
        consecutiveChallenges: 0,
        lastFailureClass: null,
        lastFailureMessage: null,
        openedAtMs: null,
        cooldownUntilMs: null,
        updatedAtMs: 0,
      },
    });
    recordFailureMock.mockResolvedValue(undefined);
    recordSuccessMock.mockResolvedValue(undefined);
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

  it('skips scheduled discovery when the circuit is open', async () => {
    evaluateCircuitMock.mockResolvedValueOnce({
      open: true,
      cooldownRemainingMs: 12 * 60_000,
      state: {
        consecutiveChallenges: 3,
        lastFailureClass: 'challenge',
        lastFailureMessage: 'cf challenge',
        openedAtMs: 1,
        cooldownUntilMs: 12 * 60_000,
        updatedAtMs: 1,
      },
    });

    const batch = createBatch([
      createDiscoverResultsMessage({
        acquisitionMode: 'browser-session',
        browserSessionKey: 'cron-circuit-open',
        source: 'cron:*/15 * * * *',
        maxMatches: 20,
      }),
    ]);

    await processQueueBatch(batch, {
      INGESTION_QUEUE: { sendBatch: vi.fn() },
    } as unknown as Env);

    expect(handleRequestMock).not.toHaveBeenCalled();
    expect(tryAcquireCrawlLockMock).not.toHaveBeenCalled();
    expect(createIngestRunMock).toHaveBeenCalledWith(
      expect.anything(),
      'scheduled-discovery',
      'cron-circuit-open',
      'skipped_circuit_open',
      expect.stringContaining('Circuit open'),
      'challenge',
    );
    expect((batch.messages[0] as unknown as { ack: ReturnType<typeof vi.fn> }).ack).toHaveBeenCalledTimes(1);
  });

  it('records a challenge failure and acks instead of retrying when discovery is challenged', async () => {
    handleRequestMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, error: 'HLTV results discovery hit a Cloudflare challenge page' }, 503),
    );

    const batch = createBatch([
      createDiscoverResultsMessage({
        acquisitionMode: 'browser-session',
        browserSessionKey: 'cron-challenge',
        source: 'cron:*/15 * * * *',
        maxMatches: 20,
      }),
    ]);

    await processQueueBatch(batch, {
      INGESTION_QUEUE: { sendBatch: vi.fn() },
    } as unknown as Env);

    expect(recordFailureMock).toHaveBeenCalledWith(
      expect.anything(),
      'challenge',
      expect.stringContaining('Cloudflare challenge'),
      expect.objectContaining({ key: expect.any(String) }),
    );
    expect(finishIngestRunMock).toHaveBeenCalledWith(
      expect.anything(),
      101,
      'challenge',
      expect.stringContaining('Cloudflare challenge'),
      'challenge',
    );
    const message = batch.messages[0] as unknown as { ack: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(recordSuccessMock).not.toHaveBeenCalled();
  });

  it('records circuit success after a clean scheduled discovery', async () => {
    handleRequestMock
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          pageUrl: 'https://www.hltv.org/results',
          discovered: 1,
          matchUrls: ['https://www.hltv.org/matches/789/foo-vs-bar'],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, fetchedAt: 'now', parsed: {}, artifact: null, notes: [] }));

    const batch = createBatch([
      createDiscoverResultsMessage({
        acquisitionMode: 'browser-session',
        browserSessionKey: 'cron-ok',
        source: 'cron:*/15 * * * *',
        maxMatches: 1,
      }),
    ]);

    await processQueueBatch(batch, {
      INGESTION_QUEUE: { sendBatch: vi.fn() },
    } as unknown as Env);

    expect(recordSuccessMock).toHaveBeenCalledTimes(1);
    expect(recordFailureMock).not.toHaveBeenCalled();
    expect(finishIngestRunMock).toHaveBeenCalledWith(
      expect.anything(),
      101,
      'success',
      expect.stringContaining('Discovered 1 matches'),
    );
  });

  it('skips duplicate terminal backfill deliveries before re-ingesting', async () => {
    getBackfillCandidateForRunMock.mockResolvedValueOnce({
      id: 7,
      runId: 42,
      hltvMatchId: 123,
      sourceUrl: 'https://www.hltv.org/matches/123/_',
      state: 'parsed',
      failureClass: null,
      attempts: 1,
      lastAttemptAt: 'now',
      finishedAt: 'now',
      message: null,
    });

    const batch = createBatch([
      createIngestMatchMessage({
        matchUrl: 'https://www.hltv.org/matches/123/_',
        backfillRunId: 42,
        backfillCandidateId: 7,
      }),
    ]);

    await processQueueBatch(batch, { INGESTION_QUEUE: { sendBatch: vi.fn() } } as unknown as Env);

    expect(handleRequestMock).not.toHaveBeenCalled();
    expect(finalizeBackfillCandidateMock).not.toHaveBeenCalled();
    expect((batch.messages[0] as unknown as { ack: ReturnType<typeof vi.fn> }).ack).toHaveBeenCalledTimes(1);
  });

  it('retries unknown backfill ingest failures without terminalizing the candidate', async () => {
    getBackfillCandidateForRunMock.mockResolvedValueOnce({
      id: 7,
      runId: 42,
      hltvMatchId: 123,
      sourceUrl: 'https://www.hltv.org/matches/123/_',
      state: 'enqueued',
      failureClass: null,
      attempts: 1,
      lastAttemptAt: 'now',
      finishedAt: null,
      message: null,
    });
    handleRequestMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'transient weird failure' }, 500));

    const batch = createBatch([
      createIngestMatchMessage({
        matchUrl: 'https://www.hltv.org/matches/123/_',
        backfillRunId: 42,
        backfillCandidateId: 7,
      }),
    ]);

    await expect(
      processQueueBatch(batch, { INGESTION_QUEUE: { sendBatch: vi.fn() } } as unknown as Env),
    ).rejects.toThrow('transient weird failure');

    expect(finalizeBackfillCandidateMock).not.toHaveBeenCalled();
    expect(incrementBackfillCounterMock).not.toHaveBeenCalled();
    expect((batch.messages[0] as unknown as { retry: ReturnType<typeof vi.fn> }).retry).toHaveBeenCalledTimes(1);
  });

  it('finalizes classified backfill challenge failures and acks the message', async () => {
    getBackfillCandidateForRunMock.mockResolvedValueOnce({
      id: 7,
      runId: 42,
      hltvMatchId: 123,
      sourceUrl: 'https://www.hltv.org/matches/123/_',
      state: 'enqueued',
      failureClass: null,
      attempts: 1,
      lastAttemptAt: 'now',
      finishedAt: null,
      message: null,
    });
    handleRequestMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'Cloudflare challenge page' }, 503));

    const batch = createBatch([
      createIngestMatchMessage({
        matchUrl: 'https://www.hltv.org/matches/123/_',
        backfillRunId: 42,
        backfillCandidateId: 7,
      }),
    ]);

    await processQueueBatch(batch, { INGESTION_QUEUE: { sendBatch: vi.fn() } } as unknown as Env);

    expect(finalizeBackfillCandidateMock).toHaveBeenCalledWith(expect.anything(), 7, 'challenge', expect.any(Object));
    expect(incrementBackfillCounterMock).toHaveBeenCalledWith(expect.anything(), 42, 'challenge', 1);
    const message = batch.messages[0] as unknown as { ack: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it('opens circuit and retries scheduled match ingest on rate limits', async () => {
    handleRequestMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'Fetch failed with status 429' }, 429));

    const batch = createBatch([
      createIngestMatchMessage({
        matchUrl: 'https://www.hltv.org/matches/123/_',
        source: 'cron:test:followup',
        acquisitionMode: 'browser',
      }),
    ]);

    await expect(
      processQueueBatch(batch, { INGESTION_QUEUE: { sendBatch: vi.fn() } } as unknown as Env),
    ).rejects.toThrow('Fetch failed with status 429');

    expect(recordFailureMock).toHaveBeenCalledWith(
      expect.anything(),
      'rate_limited',
      expect.stringContaining('429'),
      expect.objectContaining({ threshold: 1 }),
    );
    const message = batch.messages[0] as unknown as { ack: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledTimes(1);
  });

  it('skips scheduled match ingest without acquisition while the circuit is open', async () => {
    evaluateCircuitMock.mockResolvedValueOnce({
      open: true,
      cooldownRemainingMs: 30 * 60_000,
      state: {
        consecutiveChallenges: 0,
        lastFailureClass: 'rate_limited',
        lastFailureMessage: '429',
        openedAtMs: 1,
        cooldownUntilMs: 30 * 60_000,
        updatedAtMs: 1,
      },
    });

    const batch = createBatch([
      createIngestMatchMessage({
        matchUrl: 'https://www.hltv.org/matches/123/_',
        source: 'cron:test:followup',
        acquisitionMode: 'http-stealth',
      }),
    ]);

    await processQueueBatch(batch, { INGESTION_QUEUE: { sendBatch: vi.fn() } } as unknown as Env);

    expect(handleRequestMock).not.toHaveBeenCalled();
    const message = batch.messages[0] as unknown as { ack: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it('stops acquiring later scheduled match messages after a rate-limit opens the circuit', async () => {
    evaluateCircuitMock
      .mockResolvedValueOnce({
        open: false,
        cooldownRemainingMs: 0,
        state: {
          consecutiveChallenges: 0,
          lastFailureClass: null,
          lastFailureMessage: null,
          openedAtMs: null,
          cooldownUntilMs: null,
          updatedAtMs: 0,
        },
      })
      .mockResolvedValueOnce({
        open: true,
        cooldownRemainingMs: 30 * 60_000,
        state: {
          consecutiveChallenges: 0,
          lastFailureClass: 'rate_limited',
          lastFailureMessage: '429',
          openedAtMs: 1,
          cooldownUntilMs: 30 * 60_000,
          updatedAtMs: 1,
        },
      });
    handleRequestMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'Fetch failed with status 429' }, 429));

    const batch = createBatch([
      createIngestMatchMessage({
        matchUrl: 'https://www.hltv.org/matches/123/_',
        source: 'cron:test:followup',
        acquisitionMode: 'browser',
      }),
      createIngestMatchMessage({
        matchUrl: 'https://www.hltv.org/matches/456/_',
        source: 'cron:test:followup',
        acquisitionMode: 'browser',
      }),
    ]);

    await expect(
      processQueueBatch(batch, { INGESTION_QUEUE: { sendBatch: vi.fn() } } as unknown as Env),
    ).rejects.toThrow('Fetch failed with status 429');

    expect(handleRequestMock).toHaveBeenCalledTimes(1);
    const first = batch.messages[0] as unknown as { retry: ReturnType<typeof vi.fn> };
    const second = batch.messages[1] as unknown as { ack: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
    expect(first.retry).toHaveBeenCalledTimes(1);
    expect(second.ack).toHaveBeenCalledTimes(1);
    expect(second.retry).not.toHaveBeenCalled();
  });

  it('preserves pageUrl when a canary discovery enqueues its follow-up', async () => {
    const pageUrl = `https://www.hltv.org/results?${new URLSearchParams({
      startDate: '2025-09-24',
      endDate: '2025-09-24',
    }).toString()}`;
    handleRequestMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        pageUrl,
        discovered: 1,
        matchUrls: ['https://www.hltv.org/matches/123/alpha-vs-beta'],
      }),
    );
    const sendBatch = vi.fn();
    const batch = createBatch([
      createDiscoverResultsMessage({
        pageUrl,
        source: 'cron:historical-canary',
        acquisitionMode: 'http-stealth',
        browserSessionKey: 'historical-2025-09-24',
        maxMatches: 1,
        canary: true,
        followupMaxMatches: 25,
        persistHtml: true,
      }),
    ]);

    await processQueueBatch(batch, { INGESTION_QUEUE: { sendBatch } } as unknown as Env);

    expect(sendBatch).toHaveBeenCalledWith([
      {
        body: createDiscoverResultsMessage({
          pageUrl,
          source: 'cron:historical-canary:followup',
          acquisitionMode: 'http-stealth',
          browserSessionKey: 'historical-2025-09-24',
          maxMatches: 25,
          persistHtml: true,
        }),
      },
    ]);
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

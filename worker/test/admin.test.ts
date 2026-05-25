// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: legacy parser/test fixtures are intentionally dense; refactor separately.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  claimPendingBackfillCandidatesMock,
  releaseBackfillCandidatesMock,
  countInFlightBackfillCandidatesMock,
  createBackfillRunMock,
  getBackfillRunMock,
  incrementBackfillCounterMock,
  setBackfillRunStatusMock,
  enqueueMessagesMock,
} = vi.hoisted(() => ({
  claimPendingBackfillCandidatesMock: vi.fn(),
  releaseBackfillCandidatesMock: vi.fn(),
  countInFlightBackfillCandidatesMock: vi.fn(),
  createBackfillRunMock: vi.fn(),
  getBackfillRunMock: vi.fn(),
  incrementBackfillCounterMock: vi.fn(),
  setBackfillRunStatusMock: vi.fn(),
  enqueueMessagesMock: vi.fn(),
}));

vi.mock('../src/db', async () => {
  const actual = await vi.importActual<typeof import('../src/db')>('../src/db');
  return {
    ...actual,
    claimPendingBackfillCandidates: claimPendingBackfillCandidatesMock,
    releaseBackfillCandidates: releaseBackfillCandidatesMock,
    countInFlightBackfillCandidates: countInFlightBackfillCandidatesMock,
    createBackfillRun: createBackfillRunMock,
    getBackfillRun: getBackfillRunMock,
    incrementBackfillCounter: incrementBackfillCounterMock,
    setBackfillRunStatus: setBackfillRunStatusMock,
  };
});

vi.mock('../src/queue', async () => {
  const actual = await vi.importActual<typeof import('../src/queue')>('../src/queue');
  return {
    ...actual,
    enqueueMessages: enqueueMessagesMock,
  };
});

import { handleBackfillEnqueue, handleBackfillStart, handleBackfillStatus } from '../src/admin';
import type { Env } from '../src/types';

const FAKE_ENV = {
  HLTV_BASE_URL: 'https://www.hltv.org',
  ADMIN_TOKEN: 'secret',
} as unknown as Env;

function adminRequest(path: string, body: unknown, token: string | null = 'secret'): Request {
  const headers: HeadersInit = { 'content-type': 'application/json' };
  if (token) (headers as Record<string, string>)['x-admin-token'] = token;
  return new Request(`https://internal/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const REGISTERED_RUN = {
  id: 42,
  status: 'pending',
  totalCandidates: 3,
  enqueued: 0,
  parsed: 0,
  partial: 0,
  challenge: 0,
  failedClassified: 0,
  skipped: 0,
  createdAt: '2026-05-23T00:00:00Z',
  updatedAt: '2026-05-23T00:00:00Z',
  finishedAt: null,
  optionsJson: null,
  candidateFilter: null,
  notes: null,
};

beforeEach(() => {
  claimPendingBackfillCandidatesMock.mockReset();
  releaseBackfillCandidatesMock.mockReset();
  countInFlightBackfillCandidatesMock.mockReset();
  createBackfillRunMock.mockReset();
  getBackfillRunMock.mockReset();
  incrementBackfillCounterMock.mockReset();
  setBackfillRunStatusMock.mockReset();
  enqueueMessagesMock.mockReset();
});

describe('handleBackfillStart', () => {
  it('rejects requests missing the admin token', async () => {
    const response = await handleBackfillStart(adminRequest('admin/backfill/start', { matchIds: [1] }, null), FAKE_ENV);
    expect(response.status).toBe(401);
    expect(createBackfillRunMock).not.toHaveBeenCalled();
  });

  it('rejects when no candidates are provided', async () => {
    const response = await handleBackfillStart(adminRequest('admin/backfill/start', {}), FAKE_ENV);
    expect(response.status).toBe(400);
    expect(createBackfillRunMock).not.toHaveBeenCalled();
  });

  it('creates a run from a matchIds array', async () => {
    createBackfillRunMock.mockResolvedValueOnce(7);
    const response = await handleBackfillStart(
      adminRequest('admin/backfill/start', { matchIds: [101, 102] }),
      FAKE_ENV,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, runId: 7, totalCandidates: 2 });
    expect(createBackfillRunMock).toHaveBeenCalledTimes(1);
    const [, , , candidates] = createBackfillRunMock.mock.calls[0] ?? [];
    expect(candidates).toEqual([
      { hltvMatchId: 101, sourceUrl: 'https://www.hltv.org/matches/101/_' },
      { hltvMatchId: 102, sourceUrl: 'https://www.hltv.org/matches/102/_' },
    ]);
  });
});

describe('handleBackfillEnqueue', () => {
  it('returns 404 when the run does not exist', async () => {
    getBackfillRunMock.mockResolvedValueOnce(null);
    const response = await handleBackfillEnqueue(adminRequest('admin/backfill/enqueue', { runId: 99 }), FAKE_ENV);
    expect(response.status).toBe(404);
    expect(claimPendingBackfillCandidatesMock).not.toHaveBeenCalled();
  });

  it('marks the run drained when there is nothing to claim', async () => {
    getBackfillRunMock.mockResolvedValueOnce(REGISTERED_RUN);
    claimPendingBackfillCandidatesMock.mockResolvedValueOnce([]);
    countInFlightBackfillCandidatesMock.mockResolvedValueOnce(0);
    const response = await handleBackfillEnqueue(adminRequest('admin/backfill/enqueue', { runId: 42 }), FAKE_ENV);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, runId: 42, enqueued: 0, drained: true, inFlight: 0 });
    expect(setBackfillRunStatusMock).toHaveBeenCalledWith(expect.anything(), 42, 'completed');
    expect(enqueueMessagesMock).not.toHaveBeenCalled();
    expect(incrementBackfillCounterMock).not.toHaveBeenCalled();
  });

  it('claims, sends, and bumps the enqueued counter on success', async () => {
    getBackfillRunMock.mockResolvedValueOnce(REGISTERED_RUN);
    claimPendingBackfillCandidatesMock.mockResolvedValueOnce([
      {
        id: 1,
        runId: 42,
        hltvMatchId: 100,
        sourceUrl: 'https://www.hltv.org/matches/100/a',
        state: 'enqueued',
        failureClass: null,
        attempts: 1,
        lastAttemptAt: null,
        finishedAt: null,
        message: null,
      },
      {
        id: 2,
        runId: 42,
        hltvMatchId: 200,
        sourceUrl: null,
        state: 'enqueued',
        failureClass: null,
        attempts: 1,
        lastAttemptAt: null,
        finishedAt: null,
        message: null,
      },
    ]);
    enqueueMessagesMock.mockResolvedValueOnce(undefined);
    const response = await handleBackfillEnqueue(
      adminRequest('admin/backfill/enqueue', { runId: 42, batchSize: 10 }),
      FAKE_ENV,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, runId: 42, enqueued: 2, drained: false });
    expect(enqueueMessagesMock).toHaveBeenCalledTimes(1);
    const [, messages] = enqueueMessagesMock.mock.calls[0] ?? [];
    expect(messages).toHaveLength(2);
    expect(messages?.[0]?.payload).toMatchObject({
      backfillRunId: 42,
      backfillCandidateId: 1,
      matchUrl: 'https://www.hltv.org/matches/100/a',
    });
    expect(messages?.[1]?.payload).toMatchObject({
      backfillRunId: 42,
      backfillCandidateId: 2,
      matchUrl: 'https://www.hltv.org/matches/200/_',
    });
    expect(incrementBackfillCounterMock).toHaveBeenCalledWith(expect.anything(), 42, 'enqueued', 2);
    expect(setBackfillRunStatusMock).toHaveBeenCalledWith(expect.anything(), 42, 'running');
    expect(releaseBackfillCandidatesMock).not.toHaveBeenCalled();
  });

  it('rolls the claim back to pending when the queue send fails', async () => {
    getBackfillRunMock.mockResolvedValueOnce(REGISTERED_RUN);
    claimPendingBackfillCandidatesMock.mockResolvedValueOnce([
      {
        id: 1,
        runId: 42,
        hltvMatchId: 100,
        sourceUrl: 'https://www.hltv.org/matches/100/a',
        state: 'enqueued',
        failureClass: null,
        attempts: 1,
        lastAttemptAt: null,
        finishedAt: null,
        message: null,
      },
      {
        id: 2,
        runId: 42,
        hltvMatchId: 200,
        sourceUrl: null,
        state: 'enqueued',
        failureClass: null,
        attempts: 1,
        lastAttemptAt: null,
        finishedAt: null,
        message: null,
      },
    ]);
    enqueueMessagesMock.mockRejectedValueOnce(new Error('queue offline'));

    const response = await handleBackfillEnqueue(adminRequest('admin/backfill/enqueue', { runId: 42 }), FAKE_ENV);
    expect(response.status).toBe(502);
    expect(releaseBackfillCandidatesMock).toHaveBeenCalledWith(expect.anything(), [1, 2]);
    expect(incrementBackfillCounterMock).not.toHaveBeenCalled();
    expect(setBackfillRunStatusMock).not.toHaveBeenCalled();
  });
});

describe('handleBackfillStatus', () => {
  it('returns the run row from D1', async () => {
    getBackfillRunMock.mockResolvedValueOnce({ ...REGISTERED_RUN, enqueued: 5, parsed: 3 });
    const response = await handleBackfillStatus(adminRequest('admin/backfill/status', { runId: 42 }), FAKE_ENV);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, run: { id: 42, enqueued: 5, parsed: 3 } });
  });
});

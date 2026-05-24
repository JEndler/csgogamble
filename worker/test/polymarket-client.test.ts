import { describe, expect, it } from 'vitest';
import {
  buildGammaEventsUrl,
  buildPriceHistoryUrl,
  fetchClobMarket,
  fetchGammaEvents,
  fetchPriceHistory,
  PolymarketFetchError,
} from '../src/polymarket/client';

type FetchArgs = Parameters<typeof fetch>;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function recordingFetch(responseFactory: (url: string) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: FetchArgs[];
} {
  const calls: FetchArgs[] = [];
  const fetchImpl: typeof fetch = async (...args) => {
    calls.push(args);
    const url = typeof args[0] === 'string' ? args[0] : args[0].toString();
    return await responseFactory(url);
  };
  return { fetchImpl, calls };
}

describe('polymarket client url builders', () => {
  it('encodes gamma /events/keyset params consistently', () => {
    const url = buildGammaEventsUrl({ cursor: 'abc', limit: 50, tagId: 100780, closed: true });
    expect(url).toContain('limit=50');
    expect(url).toContain('tag_id=100780');
    expect(url).toContain('next_cursor=abc');
    expect(url).toContain('/events/keyset?');
    expect(url).toContain('closed=true');
  });

  it('encodes condition ids when building CLOB market url', () => {
    const url = buildPriceHistoryUrl('tok-1', { interval: '1h', fidelityMinutes: 60, startTs: 100, endTs: 200 });
    expect(url).toContain('market=tok-1');
    expect(url).toContain('interval=1h');
    expect(url).toContain('fidelity=60');
    expect(url).toContain('startTs=100');
    expect(url).toContain('endTs=200');
  });
});

describe('polymarket client fetchers', () => {
  it('returns parsed JSON and raw body on success', async () => {
    const payload = { data: [{ id: '1', slug: 'liquid-vs-falcons' }], next_cursor: 'next' };
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse(payload));
    const result = await fetchGammaEvents({ fetchImpl, limit: 10 });
    expect(result.parsed).toEqual(payload);
    expect(result.rawBody).toBe(JSON.stringify(payload));
    expect(calls).toHaveLength(1);
  });

  it('throws PolymarketFetchError with http_429 on rate limit', async () => {
    const { fetchImpl } = recordingFetch(() => new Response('rate limited', { status: 429 }));
    await expect(fetchClobMarket('cid', { fetchImpl })).rejects.toMatchObject({
      errorClass: 'http_429',
      status: 429,
    });
  });

  it('throws invalid_json when response body is malformed', async () => {
    const { fetchImpl } = recordingFetch(
      () => new Response('not json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(fetchPriceHistory('tok', { fetchImpl })).rejects.toMatchObject({
      errorClass: 'invalid_json',
    });
  });

  it('classifies AbortError as timeout', async () => {
    const fetchImpl: typeof fetch = () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    };
    const error = await fetchGammaEvents({ fetchImpl, timeoutMs: 5 }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(PolymarketFetchError);
    expect((error as PolymarketFetchError).errorClass).toBe('timeout');
  });
});

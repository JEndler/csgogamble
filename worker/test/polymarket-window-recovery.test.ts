import { describe, expect, it } from 'vitest';
import { PolymarketFetchError } from '../src/polymarket/client';
import { capWindowEndAligned, shouldRetryWithCappedWindow } from '../src/polymarket/ingest';

describe('polymarket price-history capped window recovery', () => {
  it('caps long minute-fidelity windows ending at the original end', () => {
    expect(capWindowEndAligned(1000, 1000 + 20 * 86_400, 7 * 86_400)).toEqual({
      startTs: 1000 + 13 * 86_400,
      endTs: 1000 + 20 * 86_400,
    });
  });

  it('retries 400 long-window failures for window minute fidelity', () => {
    const error = new PolymarketFetchError('bad', 'https://example.com', 'http_4xx', 400);
    expect(
      shouldRetryWithCappedWindow(error, { interval: 'window', fidelityMinutes: 1, startTs: 0, endTs: 20 * 86_400 }),
    ).toBe(true);
  });
});

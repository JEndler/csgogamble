import { describe, expect, it } from 'vitest';
import {
  clobMarketKey,
  gammaPageKey,
  priceHistoryRawKey,
  priceHistorySeriesKey,
  putPolymarketTextArtifact,
} from '../src/polymarket/storage';

const FIXED_DATE = new Date(Date.UTC(2025, 0, 5, 10, 11, 12, 345));

describe('polymarket storage key helpers', () => {
  it('builds a gamma page key under gamma/events/yyyy/mm/dd', () => {
    const key = gammaPageKey(null, FIXED_DATE);
    expect(key).toMatch(/^gamma\/events\/2025\/01\/05\/start_/);
    expect(key.endsWith('.json')).toBe(true);
  });

  it('safely encodes a non-trivial cursor into the gamma key', () => {
    const key = gammaPageKey('abc/def?next=1', FIXED_DATE);
    expect(key).toContain('abc_def_next_1');
  });

  it('builds a per-condition CLOB market key', () => {
    const key = clobMarketKey('0xABC-123!', FIXED_DATE);
    expect(key.startsWith('clob/markets/0xABC-123_/')).toBe(true);
  });

  it('builds price-history raw and series keys', () => {
    const raw = priceHistoryRawKey('tok-xyz', '1m', 60, FIXED_DATE);
    const series = priceHistorySeriesKey('tok-xyz', '1m', 60, FIXED_DATE);
    expect(raw.startsWith('price-history/raw/tok-xyz/1m/fidelity=60/')).toBe(true);
    expect(series.startsWith('price-history/series/tok-xyz/1m/fidelity=60/')).toBe(true);
    expect(series.endsWith('.jsonl')).toBe(true);
  });
});

describe('putPolymarketTextArtifact', () => {
  it('returns null when bucket is not provided', async () => {
    const result = await putPolymarketTextArtifact(undefined, 'irrelevant', 'body', 'application/json');
    expect(result).toBeNull();
  });

  it('stores the body and reports key/size/sha256', async () => {
    const calls: Array<{
      key: string;
      body: string;
      contentType: string | undefined;
      checksum: string | undefined;
    }> = [];
    const bucket = {
      put: (key: string, body: string, options: R2PutOptions): Promise<void> => {
        calls.push({
          key,
          body,
          contentType:
            options.httpMetadata && 'contentType' in options.httpMetadata
              ? options.httpMetadata.contentType
              : undefined,
          checksum: options.customMetadata?.checksumSha256,
        });
        return Promise.resolve();
      },
    } as unknown as R2Bucket;

    const body = '{"hello":"world"}';
    const result = await putPolymarketTextArtifact(bucket, 'some/key.json', body, 'application/json');
    expect(result).not.toBeNull();
    expect(result?.key).toBe('some/key.json');
    expect(result?.size).toBe(body.length);
    expect(result?.sha256).toHaveLength(64);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.contentType).toBe('application/json');
    expect(calls[0]?.checksum).toBe(result?.sha256);
  });
});

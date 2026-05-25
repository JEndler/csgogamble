import { putTextArtifact } from '../storage';
import type { PersistedArtifactResult } from '../types';

/**
 * R2 key helpers for Polymarket artifacts. Keys are deterministic and
 * group by artifact type at the top of the bucket so an operator can
 * `wrangler r2 object list` per artifact class.
 *
 * Layout under POLYMARKET_DATA:
 *   gamma/events/YYYY/MM/DD/{cursor}_{ts}.json
 *   clob/markets/{condition_id}/{ts}.json
 *   price-history/raw/{token_id}/{interval}/fidelity={minutes}/{ts}.json
 *   price-history/series/{token_id}/{interval}/fidelity={minutes}/{ts}.jsonl
 */

function todayParts(date: Date = new Date()): { year: string; month: string; day: string; ts: string } {
  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, '0'),
    day: String(date.getUTCDate()).padStart(2, '0'),
    ts: date.toISOString().replace(/[:.]/g, '-'),
  };
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'unknown';
}

export function gammaPageKey(cursor: string | null, date: Date = new Date()): string {
  const { year, month, day, ts } = todayParts(date);
  const cursorPart = safeSegment(cursor && cursor.length > 0 ? cursor : 'start');
  return `gamma/events/${year}/${month}/${day}/${cursorPart}_${ts}.json`;
}

export function clobMarketKey(conditionId: string, date: Date = new Date()): string {
  const { ts } = todayParts(date);
  return `clob/markets/${safeSegment(conditionId)}/${ts}.json`;
}

export function priceHistoryRawKey(
  tokenId: string,
  interval: string,
  fidelityMinutes: number,
  date: Date = new Date(),
): string {
  const { ts } = todayParts(date);
  return `price-history/raw/${safeSegment(tokenId)}/${safeSegment(interval)}/fidelity=${safeSegment(String(fidelityMinutes))}/${ts}.json`;
}

export function priceHistorySeriesKey(
  tokenId: string,
  interval: string,
  fidelityMinutes: number,
  date: Date = new Date(),
): string {
  const { ts } = todayParts(date);
  return `price-history/series/${safeSegment(tokenId)}/${safeSegment(interval)}/fidelity=${safeSegment(String(fidelityMinutes))}/${ts}.jsonl`;
}

/**
 * Write a text artifact to the POLYMARKET_DATA bucket. Mirrors
 * `putTextArtifact` in src/storage.ts but pins the bucket and computes a
 * checksum so manifest rows can record sha256 alongside r2 keys.
 */
export async function putPolymarketTextArtifact(
  bucket: R2Bucket | undefined,
  key: string,
  body: string,
  contentType: string,
): Promise<PersistedArtifactResult | null> {
  return putTextArtifact(bucket, key, body, contentType);
}

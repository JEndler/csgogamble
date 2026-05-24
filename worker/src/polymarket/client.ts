import { USER_AGENT } from '../constants';
import {
  CLOB_BASE_URL,
  GAMMA_BASE_URL,
  GAMMA_CS2_TAG_ID,
  GAMMA_DEFAULT_PAGE_LIMIT,
  POLYMARKET_FETCH_TIMEOUT_MS,
} from './constants';
import type { RawClobPriceHistoryResponse, RawGammaEventsResponse, RawGammaMarket } from './types';

/**
 * Public Polymarket API client. We only touch documented public endpoints
 * (Gamma /events, CLOB /markets/{condition_id}, CLOB /prices-history).
 * No protected scraping, no authenticated endpoints, no order placement.
 */

export type PolymarketFetchErrorClass =
  | 'timeout'
  | 'network'
  | 'http_4xx'
  | 'http_429'
  | 'http_5xx'
  | 'invalid_json'
  | 'unknown';

export class PolymarketFetchError extends Error {
  readonly url: string;
  readonly errorClass: PolymarketFetchErrorClass;
  readonly status: number | null;

  constructor(message: string, url: string, errorClass: PolymarketFetchErrorClass, status: number | null = null) {
    super(message);
    this.name = 'PolymarketFetchError';
    this.url = url;
    this.errorClass = errorClass;
    this.status = status;
  }
}

export interface RawFetchResult<T> {
  url: string;
  status: number;
  rawBody: string;
  parsed: T;
}

export interface PolymarketFetchOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function classifyHttpStatus(status: number): PolymarketFetchErrorClass {
  if (status === 429) return 'http_429';
  if (status >= 500) return 'http_5xx';
  return 'http_4xx';
}

async function fetchJson<T>(url: string, options: PolymarketFetchOptions = {}): Promise<RawFetchResult<T>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? POLYMARKET_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new PolymarketFetchError(`Polymarket fetch timed out after ${timeoutMs}ms`, url, 'timeout');
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PolymarketFetchError(`Polymarket fetch failed: ${message}`, url, 'network');
  }
  clearTimeout(timeout);

  const rawBody = await response.text();
  if (!response.ok) {
    throw new PolymarketFetchError(
      `Polymarket ${response.status} for ${url}`,
      url,
      classifyHttpStatus(response.status),
      response.status,
    );
  }

  let parsed: unknown;
  try {
    parsed = rawBody.length === 0 ? {} : JSON.parse(rawBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PolymarketFetchError(`Polymarket response was not valid JSON: ${message}`, url, 'invalid_json');
  }

  return { url, status: response.status, rawBody, parsed: parsed as T };
}

export interface FetchGammaEventsOptions extends PolymarketFetchOptions {
  baseUrl?: string;
  cursor?: string | null;
  offset?: number;
  pagination?: 'keyset' | 'offset';
  tagId?: number;
  limit?: number;
  archived?: boolean;
  closed?: boolean;
}

export function buildGammaEventsUrl(options: FetchGammaEventsOptions = {}): string {
  const base = options.baseUrl ?? GAMMA_BASE_URL;
  const limit = Math.max(1, Math.min(options.limit ?? GAMMA_DEFAULT_PAGE_LIMIT, 500));
  const params = new URLSearchParams();
  params.set('tag_id', String(options.tagId ?? GAMMA_CS2_TAG_ID));
  params.set('limit', String(limit));
  if (options.pagination === 'offset') {
    params.set('offset', String(Math.max(0, Math.trunc(options.offset ?? 0))));
  } else if (options.cursor) {
    params.set('next_cursor', options.cursor);
  }
  if (options.archived !== undefined) params.set('archived', String(options.archived));
  if (options.closed !== undefined) params.set('closed', String(options.closed));
  return `${base}/${options.pagination === 'offset' ? 'events' : 'events/keyset'}?${params.toString()}`;
}

export function fetchGammaEvents(
  options: FetchGammaEventsOptions = {},
): Promise<RawFetchResult<RawGammaEventsResponse>> {
  return fetchJson<RawGammaEventsResponse>(buildGammaEventsUrl(options), options);
}

export interface FetchClobMarketOptions extends PolymarketFetchOptions {
  baseUrl?: string;
}

export function buildClobMarketUrl(conditionId: string, options: FetchClobMarketOptions = {}): string {
  const base = options.baseUrl ?? CLOB_BASE_URL;
  return `${base}/markets/${encodeURIComponent(conditionId)}`;
}

export function fetchClobMarket(
  conditionId: string,
  options: FetchClobMarketOptions = {},
): Promise<RawFetchResult<RawGammaMarket>> {
  return fetchJson<RawGammaMarket>(buildClobMarketUrl(conditionId, options), options);
}

export interface FetchPriceHistoryOptions extends PolymarketFetchOptions {
  baseUrl?: string;
  /** Polymarket-supported interval shorthand. */
  interval?: '1m' | '1h' | '6h' | '1d' | '1w' | 'max';
  /** Public price history fidelity in minutes. */
  fidelityMinutes?: number;
  /** Unix-seconds start cap when paging long ranges. */
  startTs?: number;
  /** Unix-seconds end cap. */
  endTs?: number;
  /** Hard cap on returned points to keep R2 payloads bounded. */
  maxPoints?: number;
}

export function buildPriceHistoryUrl(tokenId: string, options: FetchPriceHistoryOptions = {}): string {
  const base = options.baseUrl ?? CLOB_BASE_URL;
  const params = new URLSearchParams();
  params.set('market', tokenId);
  if (options.interval) params.set('interval', options.interval);
  if (options.fidelityMinutes !== undefined) params.set('fidelity', String(options.fidelityMinutes));
  if (options.startTs !== undefined) params.set('startTs', String(options.startTs));
  if (options.endTs !== undefined) params.set('endTs', String(options.endTs));
  return `${base}/prices-history?${params.toString()}`;
}

export function fetchPriceHistory(
  tokenId: string,
  options: FetchPriceHistoryOptions = {},
): Promise<RawFetchResult<RawClobPriceHistoryResponse>> {
  return fetchJson<RawClobPriceHistoryResponse>(buildPriceHistoryUrl(tokenId, options), options);
}

import type { Env } from '../types';
import { classifyMarket } from './classifier';
import { type FetchPriceHistoryOptions, fetchGammaEvents, fetchPriceHistory, PolymarketFetchError } from './client';
import { DEFAULT_PRICE_HISTORY_FIDELITY_MINUTES, GAMMA_CS2_TAG_ID } from './constants';
import {
  bumpPolymarketRunCounter,
  createPolymarketCrawlRun,
  finishPolymarketCrawlRun,
  recordGammaPageArtifact,
  recordPriceHistoryManifest,
  upsertPolymarketEvent,
  upsertPolymarketMarket,
  upsertPolymarketOutcomes,
} from './db';
import { normalizeEvent, normalizeMarket } from './normalize';
import { gammaPageKey, priceHistoryRawKey, priceHistorySeriesKey, putPolymarketTextArtifact } from './storage';
import type { MarketType, RawGammaEvent } from './types';

export interface GammaIngestInput {
  runId?: number;
  cursor?: string | null;
  offset?: number;
  pagination?: 'keyset' | 'offset';
  pageIndex?: number;
  maxPages?: number;
  pageLimit?: number;
  tagId?: number;
  closed?: boolean;
  archived?: boolean;
}

export interface GammaIngestResult {
  ok: true;
  runId: number;
  nextCursor: string | null;
  nextPageIndex: number;
  done: boolean;
  pagesFetched: number;
  eventsSeen: number;
  marketsSeen: number;
  outcomesSeen: number;
  classification: Record<MarketType, number>;
  errors: Array<{ stage: string; message: string; url?: string; errorClass?: string; status?: number | null }>;
}

export interface PriceHistoryIngestInput {
  runId?: number;
  tokenIds?: string[];
  marketType?: MarketType;
  limit?: number;
  interval?: FetchPriceHistoryOptions['interval'];
  fidelityMinutes?: number;
  startTs?: number;
  endTs?: number;
  onlyMissing?: boolean;
}

export interface PriceHistoryIngestResult {
  ok: true;
  runId: number;
  requested: number;
  manifestsWritten: number;
  pointsRecorded: number;
  emptyResponses: number;
  errors: Array<{ tokenId: string; message: string; url?: string; errorClass?: string; status?: number | null }>;
}

export interface PolymarketStatusResult {
  ok: true;
  generatedAt: string;
  bindings: { hasPolymarketDataBucket: boolean };
  tables: Record<string, number>;
  classification: Array<{ marketType: string; count: number }>;
  recentRuns: Array<{
    id: number;
    runType: string;
    status: string;
    target: string | null;
    pagesFetched: number;
    eventsSeen: number;
    marketsSeen: number;
    outcomesSeen: number;
    manifestsWritten: number;
    createdAt: string;
    updatedAt: string;
    finishedAt: string | null;
    message: string | null;
  }>;
}

const TERMINAL_CURSOR = 'LTE=';
const POLYMARKET_TABLES = [
  'polymarket_crawl_runs',
  'polymarket_events',
  'polymarket_markets',
  'polymarket_outcomes',
  'polymarket_gamma_pages',
  'polymarket_price_history_manifests',
] as const;

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(Math.trunc(value), max));
}

function emptyClassification(): Record<MarketType, number> {
  return {
    match_winner: 0,
    map_winner: 0,
    total_maps: 0,
    map_handicap: 0,
    outright: 0,
    player_prop: 0,
    other: 0,
    unknown: 0,
  };
}

function eventItems(raw: { events?: RawGammaEvent[]; data?: RawGammaEvent[] }): RawGammaEvent[] {
  return raw.events ?? raw.data ?? [];
}

function fetchErrorPayload(error: unknown): {
  message: string;
  url?: string;
  errorClass?: string;
  status?: number | null;
} {
  if (error instanceof PolymarketFetchError) {
    return { message: error.message, url: error.url, errorClass: error.errorClass, status: error.status };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

async function persistGammaEvents(
  env: Env,
  runId: number,
  rawEvents: RawGammaEvent[],
  rawR2Key: string,
  result: GammaIngestResult,
): Promise<void> {
  let marketsSeen = 0;
  let outcomesSeen = 0;
  let unknown = 0;
  for (const rawEvent of rawEvents) {
    const event = normalizeEvent(rawEvent);
    if (!event) continue;
    // biome-ignore lint/performance/noAwaitInLoops: D1 writes are serialized to keep Worker pressure predictable.
    const eventId = await upsertPolymarketEvent(env, { event, rawR2Key });
    for (const rawMarket of rawEvent.markets ?? []) {
      const market = normalizeMarket(rawMarket);
      if (!market) continue;
      const classification = classifyMarket(market);
      result.classification[classification.marketType] += 1;
      marketsSeen += 1;
      outcomesSeen += market.outcomes.length;
      if (classification.marketType === 'unknown') unknown += 1;
      // biome-ignore lint/performance/noAwaitInLoops: serialized D1 writes prevent batch spikes.
      const marketId = await upsertPolymarketMarket(env, {
        eventId,
        market,
        classification,
        rawR2Key,
        clobRawR2Key: null,
      });
      await upsertPolymarketOutcomes(env, marketId, market.outcomes);
    }
  }
  result.marketsSeen += marketsSeen;
  result.outcomesSeen += outcomesSeen;
  await bumpPolymarketRunCounter(env, runId, 'events_seen', rawEvents.length);
  await bumpPolymarketRunCounter(env, runId, 'markets_seen', marketsSeen);
  await bumpPolymarketRunCounter(env, runId, 'outcomes_seen', outcomesSeen);
  await bumpPolymarketRunCounter(env, runId, 'classified_unknown', unknown);
  await bumpPolymarketRunCounter(env, runId, 'classified_known', marketsSeen - unknown);
}

export async function runGammaIngest(env: Env, input: GammaIngestInput): Promise<GammaIngestResult> {
  const maxPages = clampInt(input.maxPages, 1, 1, 10);
  const pageLimit = clampInt(input.pageLimit, 100, 1, 500);
  const tagId = clampInt(input.tagId, GAMMA_CS2_TAG_ID, 1, Number.MAX_SAFE_INTEGER);
  const pagination = input.pagination ?? 'keyset';
  let cursor = input.cursor ?? null;
  let offset = clampInt(input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  let pageIndex = clampInt(input.pageIndex, 0, 0, Number.MAX_SAFE_INTEGER);
  const runId =
    input.runId ??
    (await createPolymarketCrawlRun(env, {
      runType: 'gamma_events',
      target: cursor,
      optionsJson: JSON.stringify({
        maxPages,
        pageLimit,
        tagId,
        closed: input.closed,
        archived: input.archived,
        pagination,
      }),
    }));

  const result: GammaIngestResult = {
    ok: true,
    runId,
    nextCursor: cursor,
    nextPageIndex: pageIndex,
    done: false,
    pagesFetched: 0,
    eventsSeen: 0,
    marketsSeen: 0,
    outcomesSeen: 0,
    classification: emptyClassification(),
    errors: [],
  };

  for (let fetched = 0; fetched < maxPages; fetched += 1) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Gamma keyset pagination is sequential.
      const response = await fetchGammaEvents({
        cursor,
        offset,
        pagination,
        limit: pageLimit,
        tagId,
        closed: input.closed,
        archived: input.archived,
      });
      const events = Array.isArray(response.parsed) ? response.parsed : eventItems(response.parsed);
      const artifact = await putPolymarketTextArtifact(
        env.POLYMARKET_DATA,
        gammaPageKey(cursor),
        response.rawBody,
        'application/json',
      );
      if (!artifact) throw new Error('POLYMARKET_DATA bucket is not bound');
      // biome-ignore lint/performance/noAwaitInLoops: page manifest depends on R2 artifact.
      await recordGammaPageArtifact(env, {
        runId,
        cursor,
        pageIndex,
        fetchedUrl: response.url,
        itemsCount: events.length,
        byteSize: artifact.size,
        checksumSha256: artifact.sha256,
        r2Key: artifact.key,
        status: 'stored',
      });
      result.pagesFetched += 1;
      result.eventsSeen += events.length;
      await bumpPolymarketRunCounter(env, runId, 'pages_fetched', 1);
      // biome-ignore lint/performance/noAwaitInLoops: serialized persistence protects D1.
      await persistGammaEvents(env, runId, events, artifact.key, result);
      cursor = pagination === 'offset' ? `offset:${offset + pageLimit}` : (response.parsed.next_cursor ?? null);
      offset += pageLimit;
      pageIndex += 1;
      result.nextCursor = cursor;
      result.nextPageIndex = pageIndex;
      if (
        !cursor ||
        cursor === TERMINAL_CURSOR ||
        events.length === 0 ||
        (pagination === 'offset' && events.length < pageLimit)
      ) {
        result.done = true;
        break;
      }
    } catch (error) {
      result.errors.push({ stage: 'gamma', ...fetchErrorPayload(error) });
      await finishPolymarketCrawlRun(env, runId, {
        status: 'failed',
        message: result.errors[0]?.message ?? 'gamma ingest failed',
      });
      return result;
    }
  }

  await finishPolymarketCrawlRun(env, runId, {
    status: 'completed',
    message: result.done
      ? 'gamma ingest reached terminal cursor'
      : `gamma batch completed; next cursor: ${result.nextCursor ?? 'null'}`,
  });
  return result;
}

const WINDOW_HISTORY_START_PADDING_SECONDS = 7 * 24 * 60 * 60;
const WINDOW_HISTORY_END_PADDING_SECONDS = 2 * 24 * 60 * 60;

interface TokenCandidate {
  tokenId: string;
  marketId: number | null;
  outcomeId: number | null;
  conditionId: string | null;
  outcomeLabel: string | null;
  queryStartTs: number | null;
  queryEndTs: number | null;
}

function unixSeconds(value: string | null): number | null {
  if (!value) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : null;
}

function deriveWindowBounds(
  startDate: string | null,
  endDate: string | null,
): { startTs: number | null; endTs: number | null } {
  const start = unixSeconds(startDate) ?? unixSeconds(endDate);
  const end = unixSeconds(endDate) ?? unixSeconds(startDate);
  return {
    startTs: start === null ? null : Math.max(0, start - WINDOW_HISTORY_START_PADDING_SECONDS),
    endTs: end === null ? null : end + WINDOW_HISTORY_END_PADDING_SECONDS,
  };
}

async function selectTokenCandidates(
  env: Env,
  input: PriceHistoryIngestInput,
  limit: number,
): Promise<TokenCandidate[]> {
  if (Array.isArray(input.tokenIds) && input.tokenIds.length > 0) {
    return input.tokenIds.slice(0, limit).map((tokenId) => ({
      tokenId,
      marketId: null,
      outcomeId: null,
      conditionId: null,
      outcomeLabel: null,
      queryStartTs: input.startTs ?? null,
      queryEndTs: input.endTs ?? null,
    }));
  }
  const marketType = input.marketType ?? 'match_winner';
  const dynamicWindow = input.interval === 'window' && input.startTs === undefined && input.endTs === undefined;
  const startExpr = dynamicWindow
    ? `CAST(MAX(0, unixepoch(COALESCE(m.start_date, m.end_date)) - ${WINDOW_HISTORY_START_PADDING_SECONDS}) AS TEXT)`
    : '?4';
  const endExpr = dynamicWindow
    ? `CAST(unixepoch(COALESCE(m.end_date, m.start_date)) + ${WINDOW_HISTORY_END_PADDING_SECONDS} AS TEXT)`
    : '?5';
  const onlyMissingClause =
    input.onlyMissing === false
      ? ''
      : `AND NOT EXISTS (
          SELECT 1
            FROM polymarket_price_history_manifests ph
           WHERE ph.token_id = o.token_id
             AND ph.interval = ?2
             AND COALESCE(ph.fidelity_minutes, -1) = COALESCE(?3, -1)
             AND COALESCE(ph.start_ts, '') = COALESCE(${startExpr}, '')
             AND COALESCE(ph.end_ts, '') = COALESCE(${endExpr}, '')
        )`;
  const rows = await env.DB.prepare(
    `SELECT o.token_id AS tokenId,
            o.id AS outcomeId,
            o.label AS outcomeLabel,
            m.id AS marketId,
            m.condition_id AS conditionId,
            m.start_date AS startDate,
            m.end_date AS endDate
       FROM polymarket_outcomes o
       JOIN polymarket_markets m ON m.id = o.market_id
      WHERE o.token_id IS NOT NULL
        AND m.market_type = ?1
        ${onlyMissingClause}
      ORDER BY m.id ASC, o.outcome_index ASC
      LIMIT ?6`,
  )
    .bind(
      marketType,
      input.interval ?? '1h',
      input.fidelityMinutes ?? DEFAULT_PRICE_HISTORY_FIDELITY_MINUTES,
      input.startTs === undefined ? null : String(input.startTs),
      input.endTs === undefined ? null : String(input.endTs),
      limit,
    )
    .all<TokenCandidate & { startDate: string | null; endDate: string | null }>();
  return (rows.results ?? []).map((row) => {
    const bounds = dynamicWindow
      ? deriveWindowBounds(row.startDate, row.endDate)
      : { startTs: input.startTs ?? null, endTs: input.endTs ?? null };
    return { ...row, queryStartTs: bounds.startTs, queryEndTs: bounds.endTs };
  });
}

function normalizePriceHistoryJsonl(
  candidate: TokenCandidate,
  points: Array<{ t: number; p: number | string }>,
  options: PriceHistoryIngestInput,
): string {
  return points
    .map((point) => ({
      tokenId: candidate.tokenId,
      conditionId: candidate.conditionId,
      outcomeLabel: candidate.outcomeLabel,
      interval: options.interval ?? '1h',
      fidelityMinutes: options.fidelityMinutes ?? DEFAULT_PRICE_HISTORY_FIDELITY_MINUTES,
      startTs: options.startTs ?? null,
      endTs: options.endTs ?? null,
      t: point.t,
      p: typeof point.p === 'number' ? point.p : Number(point.p),
    }))
    .map((row) => JSON.stringify(row))
    .join('\n');
}

export async function runPriceHistoryIngest(
  env: Env,
  input: PriceHistoryIngestInput,
): Promise<PriceHistoryIngestResult> {
  const limit = clampInt(input.limit, 10, 1, 100);
  const interval = input.interval ?? '1h';
  const fidelityMinutes = clampInt(input.fidelityMinutes, DEFAULT_PRICE_HISTORY_FIDELITY_MINUTES, 1, 1440);
  const runId =
    input.runId ??
    (await createPolymarketCrawlRun(env, {
      runType: 'price_history',
      target: input.marketType ?? 'match_winner',
      optionsJson: JSON.stringify({ limit, interval, fidelityMinutes, startTs: input.startTs, endTs: input.endTs }),
    }));
  const result: PriceHistoryIngestResult = {
    ok: true,
    runId,
    requested: 0,
    manifestsWritten: 0,
    pointsRecorded: 0,
    emptyResponses: 0,
    errors: [],
  };
  const candidates = await selectTokenCandidates(env, { ...input, interval, fidelityMinutes }, limit);
  result.requested = candidates.length;
  for (const candidate of candidates) {
    try {
      const startTs = candidate.queryStartTs ?? input.startTs;
      const endTs = candidate.queryEndTs ?? input.endTs;
      // biome-ignore lint/performance/noAwaitInLoops: bounded serialized calls avoid API spikes.
      const response = await fetchPriceHistory(candidate.tokenId, {
        interval,
        fidelityMinutes,
        startTs,
        endTs,
      });
      const points = response.parsed.history ?? [];
      const date = new Date();
      const rawKey = priceHistoryRawKey(candidate.tokenId, interval, fidelityMinutes, date);
      const seriesKey = priceHistorySeriesKey(candidate.tokenId, interval, fidelityMinutes, date);
      // biome-ignore lint/performance/noAwaitInLoops: R2 write per token.
      const rawArtifact = await putPolymarketTextArtifact(
        env.POLYMARKET_DATA,
        rawKey,
        response.rawBody,
        'application/json',
      );
      const jsonl = normalizePriceHistoryJsonl(candidate, points, {
        ...input,
        interval,
        fidelityMinutes,
        startTs,
        endTs,
      });
      // biome-ignore lint/performance/noAwaitInLoops: R2 write per token.
      const seriesArtifact = await putPolymarketTextArtifact(
        env.POLYMARKET_DATA,
        seriesKey,
        jsonl,
        'application/x-ndjson',
      );
      if (!rawArtifact || !seriesArtifact) throw new Error('POLYMARKET_DATA bucket is not bound');
      // biome-ignore lint/performance/noAwaitInLoops: manifest after artifacts.
      await recordPriceHistoryManifest(env, {
        marketId: candidate.marketId,
        outcomeId: candidate.outcomeId,
        tokenId: candidate.tokenId,
        interval,
        fidelityMinutes,
        startTs: startTs === undefined ? null : String(startTs),
        endTs: endTs === undefined ? null : String(endTs),
        pointCount: points.length,
        rawR2Key: rawArtifact.key,
        seriesR2Key: seriesArtifact.key,
        rawByteSize: rawArtifact.size,
        seriesByteSize: seriesArtifact.size,
        checksumSha256: rawArtifact.sha256,
        status: points.length > 0 ? 'stored' : 'empty',
        message: points.length > 0 ? null : 'valid empty price-history response',
      });
      result.manifestsWritten += 1;
      result.pointsRecorded += points.length;
      if (points.length === 0) result.emptyResponses += 1;
    } catch (error) {
      const payload = fetchErrorPayload(error);
      result.errors.push({ tokenId: candidate.tokenId, ...payload });
    }
  }
  await bumpPolymarketRunCounter(env, runId, 'price_history_manifests_written', result.manifestsWritten);
  await finishPolymarketCrawlRun(env, runId, {
    status: result.errors.length > 0 && result.manifestsWritten === 0 ? 'failed' : 'completed',
    message: `price-history requested=${result.requested} manifests=${result.manifestsWritten} errors=${result.errors.length}`,
    failureClass: result.errors[0]?.errorClass ?? null,
  });
  return result;
}

export async function getPolymarketStatus(env: Env): Promise<PolymarketStatusResult> {
  const tables: Record<string, number> = {};
  for (const table of POLYMARKET_TABLES) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: small fixed status query set.
      const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
      tables[table] = Number(row?.count ?? 0);
    } catch {
      tables[table] = -1;
    }
  }
  const classificationRows = await env.DB.prepare(
    `SELECT market_type AS marketType, COUNT(*) AS count
       FROM polymarket_markets
      GROUP BY market_type
      ORDER BY count DESC`,
  )
    .all<{ marketType: string; count: number }>()
    .catch(() => ({ results: [] as Array<{ marketType: string; count: number }> }));
  const runRows = await env.DB.prepare(
    `SELECT id, run_type AS runType, status, target,
            pages_fetched AS pagesFetched,
            events_seen AS eventsSeen,
            markets_seen AS marketsSeen,
            outcomes_seen AS outcomesSeen,
            price_history_manifests_written AS manifestsWritten,
            created_at AS createdAt,
            updated_at AS updatedAt,
            finished_at AS finishedAt,
            message
       FROM polymarket_crawl_runs
      ORDER BY id DESC
      LIMIT 10`,
  )
    .all<PolymarketStatusResult['recentRuns'][number]>()
    .catch(() => ({ results: [] as PolymarketStatusResult['recentRuns'] }));
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    bindings: { hasPolymarketDataBucket: Boolean(env.POLYMARKET_DATA) },
    tables,
    classification: classificationRows.results ?? [],
    recentRuns: runRows.results ?? [],
  };
}

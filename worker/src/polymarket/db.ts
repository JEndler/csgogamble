import type { Env } from '../types';
import { nowIso } from '../utils';
import type { MarketClassification, NormalizedEvent, NormalizedMarket, NormalizedOutcome } from './types';

/**
 * D1 persistence helpers for Polymarket metadata.
 *
 * All helpers are idempotent (upsert on natural keys), follow the patterns
 * established in src/db.ts, and never write price-history points. Heavy
 * payloads belong in R2; D1 only holds catalog rows, manifest pointers, and
 * crawl bookkeeping.
 */

export type PolymarketRunType = 'gamma_events' | 'clob_market' | 'price_history' | 'link' | 'other';

export interface CreatePolymarketCrawlRunInput {
  runType: PolymarketRunType;
  target?: string | null;
  optionsJson?: string | null;
  message?: string | null;
}

export async function createPolymarketCrawlRun(env: Env, input: CreatePolymarketCrawlRunInput): Promise<number> {
  const timestamp = nowIso();
  const result = await env.DB.prepare(
    `INSERT INTO polymarket_crawl_runs (run_type, status, target, options_json, message, created_at, updated_at)
       VALUES (?1, 'running', ?2, ?3, ?4, ?5, ?5)`,
  )
    .bind(input.runType, input.target ?? null, input.optionsJson ?? null, input.message ?? null, timestamp)
    .run();
  return Number(result.meta.last_row_id ?? 0);
}

export type PolymarketRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface FinishPolymarketCrawlRunInput {
  status: PolymarketRunStatus;
  message?: string | null;
  failureClass?: string | null;
}

export async function finishPolymarketCrawlRun(
  env: Env,
  runId: number,
  input: FinishPolymarketCrawlRunInput,
): Promise<void> {
  const timestamp = nowIso();
  await env.DB.prepare(
    `UPDATE polymarket_crawl_runs
        SET status = ?2,
            message = ?3,
            failure_class = ?4,
            updated_at = ?5,
            finished_at = CASE WHEN ?2 IN ('completed', 'failed', 'cancelled') THEN ?5 ELSE finished_at END
      WHERE id = ?1`,
  )
    .bind(runId, input.status, input.message ?? null, input.failureClass ?? null, timestamp)
    .run();
}

export type PolymarketRunCounter =
  | 'pages_fetched'
  | 'events_seen'
  | 'markets_seen'
  | 'outcomes_seen'
  | 'classified_known'
  | 'classified_unknown'
  | 'price_history_manifests_written';

export async function bumpPolymarketRunCounter(
  env: Env,
  runId: number,
  counter: PolymarketRunCounter,
  delta: number,
): Promise<void> {
  if (delta === 0) return;
  await env.DB.prepare(
    `UPDATE polymarket_crawl_runs
        SET ${counter} = ${counter} + ?2,
            updated_at = ?3
      WHERE id = ?1`,
  )
    .bind(runId, delta, nowIso())
    .run();
}

export interface GammaPageArtifactInput {
  runId: number | null;
  cursor: string | null;
  pageIndex: number;
  fetchedUrl: string;
  itemsCount: number;
  byteSize: number | null;
  checksumSha256: string | null;
  r2Key: string;
  status?: string;
  message?: string | null;
}

export async function recordGammaPageArtifact(env: Env, input: GammaPageArtifactInput): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO polymarket_gamma_pages
        (run_id, cursor, page_index, fetched_url, items_count, byte_size, checksum_sha256, r2_key, status, message)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(r2_key) DO UPDATE SET
         run_id = excluded.run_id,
         cursor = excluded.cursor,
         page_index = excluded.page_index,
         fetched_url = excluded.fetched_url,
         items_count = excluded.items_count,
         byte_size = excluded.byte_size,
         checksum_sha256 = excluded.checksum_sha256,
         status = excluded.status,
         message = excluded.message`,
  )
    .bind(
      input.runId,
      input.cursor,
      input.pageIndex,
      input.fetchedUrl,
      input.itemsCount,
      input.byteSize,
      input.checksumSha256,
      input.r2Key,
      input.status ?? 'stored',
      input.message ?? null,
    )
    .run();
}

export interface UpsertEventInput {
  event: NormalizedEvent;
  rawR2Key: string | null;
}

export async function upsertPolymarketEvent(env: Env, input: UpsertEventInput): Promise<number> {
  const timestamp = nowIso();
  const { event, rawR2Key } = input;
  const closedBit = event.closed === null ? null : event.closed ? 1 : 0;
  const archivedBit = event.archived === null ? null : event.archived ? 1 : 0;
  const activeBit = event.active === null ? null : event.active ? 1 : 0;
  await env.DB.prepare(
    `INSERT INTO polymarket_events
        (polymarket_event_id, slug, title, category, start_date, end_date,
         closed, archived, active, volume, liquidity, raw_r2_key,
         first_seen_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
       ON CONFLICT(slug) DO UPDATE SET
         polymarket_event_id = COALESCE(excluded.polymarket_event_id, polymarket_events.polymarket_event_id),
         title = COALESCE(excluded.title, polymarket_events.title),
         category = COALESCE(excluded.category, polymarket_events.category),
         start_date = COALESCE(excluded.start_date, polymarket_events.start_date),
         end_date = COALESCE(excluded.end_date, polymarket_events.end_date),
         closed = COALESCE(excluded.closed, polymarket_events.closed),
         archived = COALESCE(excluded.archived, polymarket_events.archived),
         active = COALESCE(excluded.active, polymarket_events.active),
         volume = COALESCE(excluded.volume, polymarket_events.volume),
         liquidity = COALESCE(excluded.liquidity, polymarket_events.liquidity),
         raw_r2_key = COALESCE(excluded.raw_r2_key, polymarket_events.raw_r2_key),
         last_seen_at = excluded.last_seen_at`,
  )
    .bind(
      event.polymarketEventId,
      event.slug,
      event.title,
      event.category,
      event.startDate,
      event.endDate,
      closedBit,
      archivedBit,
      activeBit,
      event.volume,
      event.liquidity,
      rawR2Key,
      timestamp,
    )
    .run();
  const row = await env.DB.prepare('SELECT id FROM polymarket_events WHERE slug = ?1')
    .bind(event.slug)
    .first<{ id: number }>();
  return Number(row?.id ?? 0);
}

export interface UpsertMarketInput {
  eventId: number | null;
  market: NormalizedMarket;
  classification: MarketClassification;
  rawR2Key: string | null;
  clobRawR2Key: string | null;
}

export async function upsertPolymarketMarket(env: Env, input: UpsertMarketInput): Promise<number> {
  const timestamp = nowIso();
  const { eventId, market, classification, rawR2Key, clobRawR2Key } = input;
  const closedBit = market.closed === null ? null : market.closed ? 1 : 0;
  const archivedBit = market.archived === null ? null : market.archived ? 1 : 0;
  const activeBit = market.active === null ? null : market.active ? 1 : 0;
  const acceptingOrdersBit = market.acceptingOrders === null ? null : market.acceptingOrders ? 1 : 0;
  await env.DB.prepare(
    `INSERT INTO polymarket_markets
        (event_id, condition_id, question_id, slug, question, description,
         market_type, classifier_version, classifier_signals,
         closed, archived, active, accepting_orders,
         end_date, start_date, resolution_source,
         parsed_team1_name, parsed_team2_name, parsed_map_name,
         parsed_total_value, parsed_handicap_value,
         raw_r2_key, clob_raw_r2_key, first_seen_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6,
               ?7, ?8, ?9,
               ?10, ?11, ?12, ?13,
               ?14, ?15, ?16,
               ?17, ?18, ?19,
               ?20, ?21,
               ?22, ?23, ?24, ?24)
       ON CONFLICT(condition_id) DO UPDATE SET
         event_id = COALESCE(excluded.event_id, polymarket_markets.event_id),
         question_id = COALESCE(excluded.question_id, polymarket_markets.question_id),
         slug = COALESCE(excluded.slug, polymarket_markets.slug),
         question = COALESCE(excluded.question, polymarket_markets.question),
         description = COALESCE(excluded.description, polymarket_markets.description),
         market_type = excluded.market_type,
         classifier_version = excluded.classifier_version,
         classifier_signals = excluded.classifier_signals,
         closed = COALESCE(excluded.closed, polymarket_markets.closed),
         archived = COALESCE(excluded.archived, polymarket_markets.archived),
         active = COALESCE(excluded.active, polymarket_markets.active),
         accepting_orders = COALESCE(excluded.accepting_orders, polymarket_markets.accepting_orders),
         end_date = COALESCE(excluded.end_date, polymarket_markets.end_date),
         start_date = COALESCE(excluded.start_date, polymarket_markets.start_date),
         resolution_source = COALESCE(excluded.resolution_source, polymarket_markets.resolution_source),
         parsed_team1_name = COALESCE(excluded.parsed_team1_name, polymarket_markets.parsed_team1_name),
         parsed_team2_name = COALESCE(excluded.parsed_team2_name, polymarket_markets.parsed_team2_name),
         parsed_map_name = COALESCE(excluded.parsed_map_name, polymarket_markets.parsed_map_name),
         parsed_total_value = COALESCE(excluded.parsed_total_value, polymarket_markets.parsed_total_value),
         parsed_handicap_value = COALESCE(excluded.parsed_handicap_value, polymarket_markets.parsed_handicap_value),
         raw_r2_key = COALESCE(excluded.raw_r2_key, polymarket_markets.raw_r2_key),
         clob_raw_r2_key = COALESCE(excluded.clob_raw_r2_key, polymarket_markets.clob_raw_r2_key),
         last_seen_at = excluded.last_seen_at`,
  )
    .bind(
      eventId,
      market.conditionId,
      market.questionId,
      market.slug,
      market.question,
      market.description,
      classification.marketType,
      classification.classifierVersion,
      JSON.stringify(classification.signals),
      closedBit,
      archivedBit,
      activeBit,
      acceptingOrdersBit,
      market.endDate,
      market.startDate,
      market.resolutionSource,
      classification.parsed.team1Name,
      classification.parsed.team2Name,
      classification.parsed.mapName,
      classification.parsed.totalValue,
      classification.parsed.handicapValue,
      rawR2Key,
      clobRawR2Key,
      timestamp,
    )
    .run();
  const row = await env.DB.prepare('SELECT id FROM polymarket_markets WHERE condition_id = ?1')
    .bind(market.conditionId)
    .first<{ id: number }>();
  return Number(row?.id ?? 0);
}

export async function upsertPolymarketOutcomes(
  env: Env,
  marketId: number,
  outcomes: NormalizedOutcome[],
): Promise<void> {
  if (outcomes.length === 0) return;
  const timestamp = nowIso();
  const statements: D1PreparedStatement[] = outcomes.map((outcome) =>
    env.DB.prepare(
      `INSERT INTO polymarket_outcomes
          (market_id, outcome_index, label, token_id, last_price,
           first_seen_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(market_id, outcome_index) DO UPDATE SET
           label = COALESCE(excluded.label, polymarket_outcomes.label),
           token_id = COALESCE(excluded.token_id, polymarket_outcomes.token_id),
           last_price = COALESCE(excluded.last_price, polymarket_outcomes.last_price),
           last_seen_at = excluded.last_seen_at`,
    ).bind(marketId, outcome.index, outcome.label, outcome.tokenId, outcome.lastPrice, timestamp),
  );
  await env.DB.batch(statements);
}

export interface RecordPriceHistoryManifestInput {
  marketId: number | null;
  outcomeId: number | null;
  tokenId: string;
  interval: string;
  fidelityMinutes: number | null;
  startTs: string | null;
  endTs: string | null;
  pointCount: number;
  rawR2Key: string | null;
  seriesR2Key: string | null;
  rawByteSize: number | null;
  seriesByteSize: number | null;
  checksumSha256: string | null;
  status?: string;
  message?: string | null;
}

export async function recordPriceHistoryManifest(env: Env, input: RecordPriceHistoryManifestInput): Promise<void> {
  const existing = await env.DB.prepare(
    `SELECT id
       FROM polymarket_price_history_manifests
      WHERE token_id = ?1
        AND interval = ?2
        AND COALESCE(fidelity_minutes, -1) = COALESCE(?3, -1)
        AND COALESCE(start_ts, '') = COALESCE(?4, '')
        AND COALESCE(end_ts, '') = COALESCE(?5, '')
      ORDER BY id ASC
      LIMIT 1`,
  )
    .bind(input.tokenId, input.interval, input.fidelityMinutes, input.startTs, input.endTs)
    .first<{ id: number }>();

  if (existing) {
    await env.DB.prepare(
      `UPDATE polymarket_price_history_manifests
          SET market_id = COALESCE(?2, market_id),
              outcome_id = COALESCE(?3, outcome_id),
              point_count = ?4,
              raw_r2_key = COALESCE(?5, raw_r2_key),
              series_r2_key = COALESCE(?6, series_r2_key),
              raw_byte_size = COALESCE(?7, raw_byte_size),
              series_byte_size = COALESCE(?8, series_byte_size),
              checksum_sha256 = COALESCE(?9, checksum_sha256),
              status = ?10,
              message = ?11,
              fetched_at = CURRENT_TIMESTAMP
        WHERE id = ?1`,
    )
      .bind(
        existing.id,
        input.marketId,
        input.outcomeId,
        input.pointCount,
        input.rawR2Key,
        input.seriesR2Key,
        input.rawByteSize,
        input.seriesByteSize,
        input.checksumSha256,
        input.status ?? 'stored',
        input.message ?? null,
      )
      .run();
    return;
  }

  await env.DB.prepare(
    `INSERT INTO polymarket_price_history_manifests
        (market_id, outcome_id, token_id, interval, fidelity_minutes,
         start_ts, end_ts, point_count,
         raw_r2_key, series_r2_key, raw_byte_size, series_byte_size,
         checksum_sha256, status, message)
       VALUES (?1, ?2, ?3, ?4, ?5,
               ?6, ?7, ?8,
               ?9, ?10, ?11, ?12,
               ?13, ?14, ?15)`,
  )
    .bind(
      input.marketId,
      input.outcomeId,
      input.tokenId,
      input.interval,
      input.fidelityMinutes,
      input.startTs,
      input.endTs,
      input.pointCount,
      input.rawR2Key,
      input.seriesR2Key,
      input.rawByteSize,
      input.seriesByteSize,
      input.checksumSha256,
      input.status ?? 'stored',
      input.message ?? null,
    )
    .run();
}

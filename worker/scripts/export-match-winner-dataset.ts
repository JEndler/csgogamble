// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: operator export script keeps sequential data assembly explicit.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: operator export script keeps the row shape readable in one place.
// biome-ignore-all lint/performance/noAwaitInLoops: R2 downloads are intentionally bounded/sequential for operator stability.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { queryD1, toNullableString, toNumber, wrangler } from './ops-utils';
import {
  computePriceFeatures,
  type PricePoint,
  resolveOutcomeTeamAndTarget,
  unixSeconds,
} from './prediction-dataset-core';

interface DatasetSourceRow {
  polymarketMarketId: number;
  conditionId: string | null;
  polymarketSlug: string | null;
  question: string | null;
  marketStartDate: string | null;
  marketEndDate: string | null;
  pmTeam1Name: string | null;
  pmTeam2Name: string | null;
  linkMethod: string | null;
  linkScore: number | null;
  outcomeId: number;
  outcomeIndex: number;
  outcomeLabel: string | null;
  tokenId: string | null;
  lastPrice: number | null;
  hltvMatchId: number;
  hltvSourceUrl: string | null;
  hltvEventName: string | null;
  bestOf: number | null;
  scheduledAt: string | null;
  team1HltvId: number | null;
  team2HltvId: number | null;
  team1Name: string | null;
  team2Name: string | null;
  team1Rank: number | null;
  team2Rank: number | null;
  team1Score: number | null;
  team2Score: number | null;
  winnerTeamId: number | null;
  matchStatus: string | null;
  ingestStatus: string | null;
  priceInterval: string | null;
  priceFidelityMinutes: number | null;
  pricePointCount: number | null;
  priceSeriesR2Key: string | null;
}

function argValue(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function datasetSql(limit: number, requireTarget: boolean): string {
  return `WITH outcome_counts AS (
    SELECT market_id, COUNT(*) AS outcome_count, COUNT(CASE WHEN token_id IS NOT NULL THEN 1 END) AS token_count
      FROM polymarket_outcomes
     GROUP BY market_id
  ), latest_manifest AS (
    SELECT * FROM (
      SELECT ph.*,
             ROW_NUMBER() OVER (
               PARTITION BY ph.outcome_id
               ORDER BY CASE WHEN ph.interval='window' AND ph.fidelity_minutes=1 THEN 0
                             WHEN ph.interval='window' THEN 1 ELSE 2 END,
                        ph.fidelity_minutes ASC,
                        ph.fetched_at DESC,
                        ph.id DESC
             ) AS rn
        FROM polymarket_price_history_manifests ph
       WHERE ph.status='stored'
         AND ph.point_count > 0
         AND ph.series_r2_key IS NOT NULL
         AND ph.interval='window'
    ) WHERE rn=1
  )
  SELECT
    pm.id AS polymarket_market_id,
    pm.condition_id,
    pm.slug AS polymarket_slug,
    pm.question,
    pm.start_date AS market_start_date,
    pm.end_date AS market_end_date,
    pm.parsed_team1_name AS pm_team1_name,
    pm.parsed_team2_name AS pm_team2_name,
    pm.link_method,
    pm.link_score,
    o.id AS outcome_id,
    o.outcome_index,
    o.label AS outcome_label,
    o.token_id,
    o.last_price,
    m.hltv_match_id,
    m.source_url AS hltv_source_url,
    m.event_name AS hltv_event_name,
    m.best_of,
    m.scheduled_at,
    m.team1_hltv_id,
    m.team2_hltv_id,
    m.team1_name,
    m.team2_name,
    m.team1_rank,
    m.team2_rank,
    m.team1_score,
    m.team2_score,
    m.winner_team_id,
    m.match_status,
    m.status AS ingest_status,
    lm.interval AS price_interval,
    lm.fidelity_minutes AS price_fidelity_minutes,
    lm.point_count AS price_point_count,
    lm.series_r2_key AS price_series_r2_key
  FROM polymarket_markets pm
  JOIN outcome_counts oc ON oc.market_id = pm.id
  JOIN polymarket_outcomes o ON o.market_id = pm.id
  JOIN matches m ON m.hltv_match_id = pm.hltv_match_id
  LEFT JOIN latest_manifest lm ON lm.outcome_id = o.id
  WHERE pm.market_type='match_winner'
    AND pm.hltv_match_id IS NOT NULL
    AND pm.link_method IN ('auto', 'manual')
    AND COALESCE(pm.link_score, 1.0) >= 0.90
    AND oc.outcome_count = 2
    AND oc.token_count = 2
    AND o.token_id IS NOT NULL
    AND m.status IN ('parsed', 'partial')
    AND m.scheduled_at IS NOT NULL
    AND m.team1_hltv_id IS NOT NULL
    AND m.team2_hltv_id IS NOT NULL
    ${requireTarget ? 'AND m.winner_team_id IS NOT NULL' : ''}
  ORDER BY m.scheduled_at, pm.id, o.outcome_index
  LIMIT ${Math.trunc(limit)};`;
}

function mapRow(row: Record<string, unknown>): DatasetSourceRow {
  return {
    polymarketMarketId: toNumber(row.polymarket_market_id),
    conditionId: toNullableString(row.condition_id),
    polymarketSlug: toNullableString(row.polymarket_slug),
    question: toNullableString(row.question),
    marketStartDate: toNullableString(row.market_start_date),
    marketEndDate: toNullableString(row.market_end_date),
    pmTeam1Name: toNullableString(row.pm_team1_name),
    pmTeam2Name: toNullableString(row.pm_team2_name),
    linkMethod: toNullableString(row.link_method),
    linkScore: nullableNumber(row.link_score),
    outcomeId: toNumber(row.outcome_id),
    outcomeIndex: toNumber(row.outcome_index),
    outcomeLabel: toNullableString(row.outcome_label),
    tokenId: toNullableString(row.token_id),
    lastPrice: nullableNumber(row.last_price),
    hltvMatchId: toNumber(row.hltv_match_id),
    hltvSourceUrl: toNullableString(row.hltv_source_url),
    hltvEventName: toNullableString(row.hltv_event_name),
    bestOf: nullableNumber(row.best_of),
    scheduledAt: toNullableString(row.scheduled_at),
    team1HltvId: nullableNumber(row.team1_hltv_id),
    team2HltvId: nullableNumber(row.team2_hltv_id),
    team1Name: toNullableString(row.team1_name),
    team2Name: toNullableString(row.team2_name),
    team1Rank: nullableNumber(row.team1_rank),
    team2Rank: nullableNumber(row.team2_rank),
    team1Score: nullableNumber(row.team1_score),
    team2Score: nullableNumber(row.team2_score),
    winnerTeamId: nullableNumber(row.winner_team_id),
    matchStatus: toNullableString(row.match_status),
    ingestStatus: toNullableString(row.ingest_status),
    priceInterval: toNullableString(row.price_interval),
    priceFidelityMinutes: nullableNumber(row.price_fidelity_minutes),
    pricePointCount: nullableNumber(row.price_point_count),
    priceSeriesR2Key: toNullableString(row.price_series_r2_key),
  };
}

async function readR2JsonlPoints(key: string, cacheDir: string): Promise<PricePoint[]> {
  const filePath = join(cacheDir, encodeURIComponent(key));
  if (!existsSync(filePath)) {
    await wrangler(['r2', 'object', 'get', `csgogamble-polymarket/${key}`, '--remote', '--file', filePath]);
  }
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { t?: unknown; p?: unknown })
    .map((point) => ({ t: Number(point.t), p: Number(point.p) }));
}

async function main(): Promise<void> {
  const output = argValue(
    '--output',
    `artifacts/prediction-datasets/match-winner-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
  );
  if (!output) throw new Error('Missing output path');
  const limit = Number(argValue('--limit', '10000'));
  const includePriceFeatures = !hasArg('--no-price-features');
  const requireTarget = !hasArg('--include-unresolved');
  const rows = await queryD1<DatasetSourceRow>(datasetSql(limit, requireTarget), mapRow);
  const cacheDir = await mkdtemp(join(tmpdir(), 'pm-series-cache-'));
  const lines: string[] = [];
  let rowsWithPrice = 0;
  let rowsWithTarget = 0;
  try {
    for (const row of rows) {
      const scheduledTs = unixSeconds(row.scheduledAt);
      const outcome = resolveOutcomeTeamAndTarget({
        outcomeLabel: row.outcomeLabel,
        pmTeam1Name: row.pmTeam1Name,
        pmTeam2Name: row.pmTeam2Name,
        hltvTeam1Name: row.team1Name,
        hltvTeam2Name: row.team2Name,
        team1HltvId: row.team1HltvId,
        team2HltvId: row.team2HltvId,
        winnerTeamId: row.winnerTeamId,
      });
      if (requireTarget && outcome.targetWin === null) continue;
      if (outcome.targetWin !== null) rowsWithTarget += 1;
      let priceFeatures = computePriceFeatures([], scheduledTs ?? 0);
      if (includePriceFeatures && row.priceSeriesR2Key && scheduledTs !== null) {
        const points = await readR2JsonlPoints(row.priceSeriesR2Key, cacheDir);
        priceFeatures = computePriceFeatures(points, scheduledTs);
      }
      if (priceFeatures.pricePointCount > 0) rowsWithPrice += 1;
      lines.push(
        JSON.stringify({
          dataset_version: 'match_winner_v0',
          polymarket_market_id: row.polymarketMarketId,
          condition_id: row.conditionId,
          outcome_id: row.outcomeId,
          outcome_index: row.outcomeIndex,
          outcome_label: row.outcomeLabel,
          token_id: row.tokenId,
          hltv_match_id: row.hltvMatchId,
          hltv_source_url: row.hltvSourceUrl,
          scheduled_at: row.scheduledAt,
          event_name: row.hltvEventName,
          best_of: row.bestOf,
          team1_hltv_id: row.team1HltvId,
          team2_hltv_id: row.team2HltvId,
          team1_name: row.team1Name,
          team2_name: row.team2Name,
          team1_rank: row.team1Rank,
          team2_rank: row.team2Rank,
          rank_diff: row.team1Rank !== null && row.team2Rank !== null ? row.team1Rank - row.team2Rank : null,
          outcome_team_hltv_id: outcome.outcomeTeamHltvId,
          target_win: outcome.targetWin,
          team1_score: row.team1Score,
          team2_score: row.team2Score,
          winner_team_id: row.winnerTeamId,
          match_status: row.matchStatus,
          ingest_status: row.ingestStatus,
          pm_team1_name: row.pmTeam1Name,
          pm_team2_name: row.pmTeam2Name,
          link_method: row.linkMethod,
          link_score: row.linkScore,
          market_start_date: row.marketStartDate,
          market_end_date: row.marketEndDate,
          last_price: row.lastPrice,
          price_interval: row.priceInterval,
          price_fidelity_minutes: row.priceFidelityMinutes,
          manifest_point_count: row.pricePointCount,
          price_series_r2_key: row.priceSeriesR2Key,
          ...priceFeatures,
        }),
      );
    }
  } finally {
    rmSync(cacheDir, { force: true, recursive: true });
  }

  mkdirSync(dirname(output), { recursive: true });
  await writeFile(output, `${lines.join('\n')}\n`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        output,
        queriedRows: rows.length,
        exportedRows: lines.length,
        rowsWithTarget,
        rowsWithPrice,
        includePriceFeatures,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});

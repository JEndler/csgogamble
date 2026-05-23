import { PARSER_VERSION } from '../src/constants';
import { queryD1, sqlString, toNullableString, toNumber } from './ops-utils';

interface Options {
  json: boolean;
  strict: boolean;
  samples: number;
}

type GateLevel = 'fail' | 'warn';
type GateStatus = 'PASS' | 'WARN' | 'FAIL';

interface Gate {
  level: GateLevel;
  status: GateStatus;
  label: string;
  detail: string;
}

interface StatusOverview {
  total: number;
  pending: number;
  parsed: number;
  partial: number;
  challenge: number;
  error: number;
  parsedPct: number;
  partialPct: number;
  challengePct: number;
  errorPct: number;
}

interface RecentStatus {
  window: string;
  total: number;
  parsed: number;
  partial: number;
  challenge: number;
  error: number;
  parsedPct: number;
  partialPct: number;
  challengePct: number;
  errorPct: number;
}

interface Freshness {
  latestLastIngestedAt: string | null;
  hoursSinceLatestIngest: number | null;
  totalMatchesWithIngestTime: number;
}

interface ParserCoverage {
  total: number;
  currentParser: number;
  staleParser: number;
  currentParserPct: number;
}

interface ParserVersionRow {
  parserVersion: string;
  matches: number;
  pct: number;
}

interface ArtifactCoverage {
  total: number;
  matchesWithHtmlR2Key: number;
  matchesWithStoredRawHtmlArtifact: number;
  htmlKeyPct: number;
  rawArtifactPct: number;
  rawHtmlStoredArtifacts: number;
  suspiciousSmallRawHtml: number;
  suspiciousSmallRawHtmlPct: number;
}

interface ArtifactDistributionRow {
  artifactType: string;
  status: string;
  artifacts: number;
  totalBytes: number;
  avgBytes: number;
}

interface EnrichedCoverage {
  parsedMatches: number;
  withMaps: number;
  withPlayerMapStats: number;
  withPlayerMatchStats: number;
  withVetoes: number;
  withLineup: number;
  withStreams: number;
  mapsPct: number;
  playerMapStatsPct: number;
  playerMatchStatsPct: number;
  vetoesPct: number;
  lineupPct: number;
  streamsPct: number;
}

interface MissingCriticalData {
  parsedMatches: number;
  missingEventName: number;
  missingBestOf: number;
  missingScheduledAt: number;
  missingTeam1Name: number;
  missingTeam2Name: number;
  missingTeam1HltvId: number;
  missingTeam2HltvId: number;
  missingMatchStatus: number;
}

interface ParseWarningSummary {
  total: number;
  matchesWithWarnings: number;
  warningMatchPct: number;
}

interface WarningDistributionRow {
  warning: string;
  matches: number;
  pct: number;
}

interface IngestRunHealth {
  stuckRuns: number;
}

interface ChildSanity {
  parsedMatches: number;
  parsedWithZeroMaps: number;
  mapCountGtBestOf: number;
  playerMapStatRows: number;
  missingKills: number;
  missingDeaths: number;
  missingRating: number;
  missingTeamHltvId: number;
}

interface MatchSample {
  hltvMatchId: number;
  status: string | null;
  parserVersion: string | null;
  ingestError: string | null;
  lastIngestedAt: string | null;
  htmlR2Key: string | null;
  sourceUrl: string | null;
}

interface MissingDataSample {
  hltvMatchId: number;
  status: string | null;
  eventName: string | null;
  bestOf: number | null;
  scheduledAt: string | null;
  team1HltvId: number | null;
  team1Name: string | null;
  team2HltvId: number | null;
  team2Name: string | null;
  sourceUrl: string | null;
}

interface Report {
  generatedAt: string;
  parserVersion: string;
  statusOverview: StatusOverview;
  recentStatus: RecentStatus[];
  freshness: Freshness;
  parserCoverage: ParserCoverage;
  parserVersions: ParserVersionRow[];
  artifactCoverage: ArtifactCoverage;
  artifactDistribution: ArtifactDistributionRow[];
  enrichedCoverage: EnrichedCoverage;
  missingCriticalData: MissingCriticalData;
  parseWarningSummary: ParseWarningSummary;
  warningDistribution: WarningDistributionRow[];
  ingestRunHealth: IngestRunHealth;
  childSanity: ChildSanity;
  staleParserSamples: MatchSample[];
  remediationSamples: MatchSample[];
  missingDataSamples: MissingDataSample[];
  gates: Gate[];
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const getValue = (name: string): string | null => {
    const prefix = `${name}=`;
    const inline = args.find((arg) => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const index = args.indexOf(name);
    return index >= 0 ? (args[index + 1] ?? null) : null;
  };

  return {
    json: args.includes('--json'),
    strict: args.includes('--strict'),
    samples: Number(getValue('--samples') ?? 10),
  };
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Number(((100 * numerator) / denominator).toFixed(2));
}

function one<T>(rows: T[], fallback: T): T {
  return rows[0] ?? fallback;
}

async function getStatusOverview(): Promise<StatusOverview> {
  const rows = await queryD1(
    `WITH base AS (
      SELECT
        COUNT(*) AS total,
        SUM(status = 'pending') AS pending,
        SUM(status = 'parsed') AS parsed,
        SUM(status = 'partial') AS partial,
        SUM(status = 'challenge') AS challenge,
        SUM(status = 'error') AS error
      FROM matches
    )
    SELECT
      total,
      COALESCE(pending, 0) AS pending,
      COALESCE(parsed, 0) AS parsed,
      COALESCE(partial, 0) AS partial,
      COALESCE(challenge, 0) AS challenge,
      COALESCE(error, 0) AS error,
      ROUND(100.0 * COALESCE(parsed, 0) / NULLIF(total, 0), 2) AS parsed_pct,
      ROUND(100.0 * COALESCE(partial, 0) / NULLIF(total, 0), 2) AS partial_pct,
      ROUND(100.0 * COALESCE(challenge, 0) / NULLIF(total, 0), 2) AS challenge_pct,
      ROUND(100.0 * COALESCE(error, 0) / NULLIF(total, 0), 2) AS error_pct
    FROM base;`,
    (row): StatusOverview => ({
      total: toNumber(row.total),
      pending: toNumber(row.pending),
      parsed: toNumber(row.parsed),
      partial: toNumber(row.partial),
      challenge: toNumber(row.challenge),
      error: toNumber(row.error),
      parsedPct: toNumber(row.parsed_pct),
      partialPct: toNumber(row.partial_pct),
      challengePct: toNumber(row.challenge_pct),
      errorPct: toNumber(row.error_pct),
    }),
  );
  return one(rows, {
    total: 0,
    pending: 0,
    parsed: 0,
    partial: 0,
    challenge: 0,
    error: 0,
    parsedPct: 0,
    partialPct: 0,
    challengePct: 0,
    errorPct: 0,
  });
}

async function getRecentStatus(): Promise<RecentStatus[]> {
  return queryD1(
    `WITH windows AS (
      SELECT '24h' AS window, datetime('now', '-24 hours') AS since
      UNION ALL
      SELECT '7d' AS window, datetime('now', '-7 days') AS since
    ), counts AS (
      SELECT
        w.window,
        COUNT(m.hltv_match_id) AS total,
        SUM(m.status = 'parsed') AS parsed,
        SUM(m.status = 'partial') AS partial,
        SUM(m.status = 'challenge') AS challenge,
        SUM(m.status = 'error') AS error
      FROM windows w
      LEFT JOIN matches m ON m.last_ingested_at >= w.since
      GROUP BY w.window
    )
    SELECT
      window,
      total,
      COALESCE(parsed, 0) AS parsed,
      COALESCE(partial, 0) AS partial,
      COALESCE(challenge, 0) AS challenge,
      COALESCE(error, 0) AS error,
      ROUND(100.0 * COALESCE(parsed, 0) / NULLIF(total, 0), 2) AS parsed_pct,
      ROUND(100.0 * COALESCE(partial, 0) / NULLIF(total, 0), 2) AS partial_pct,
      ROUND(100.0 * COALESCE(challenge, 0) / NULLIF(total, 0), 2) AS challenge_pct,
      ROUND(100.0 * COALESCE(error, 0) / NULLIF(total, 0), 2) AS error_pct
    FROM counts
    ORDER BY CASE window WHEN '24h' THEN 1 ELSE 2 END;`,
    (row): RecentStatus => ({
      window: String(row.window ?? ''),
      total: toNumber(row.total),
      parsed: toNumber(row.parsed),
      partial: toNumber(row.partial),
      challenge: toNumber(row.challenge),
      error: toNumber(row.error),
      parsedPct: toNumber(row.parsed_pct),
      partialPct: toNumber(row.partial_pct),
      challengePct: toNumber(row.challenge_pct),
      errorPct: toNumber(row.error_pct),
    }),
  );
}

async function getFreshness(): Promise<Freshness> {
  const rows = await queryD1(
    `SELECT
      MAX(last_ingested_at) AS latest_last_ingested_at,
      ROUND((julianday('now') - julianday(MAX(last_ingested_at))) * 24, 2) AS hours_since_latest_ingest,
      COUNT(*) AS total_matches_with_ingest_time
    FROM matches
    WHERE last_ingested_at IS NOT NULL;`,
    (row): Freshness => ({
      latestLastIngestedAt: toNullableString(row.latest_last_ingested_at),
      hoursSinceLatestIngest:
        row.hours_since_latest_ingest === null || row.hours_since_latest_ingest === undefined
          ? null
          : toNumber(row.hours_since_latest_ingest),
      totalMatchesWithIngestTime: toNumber(row.total_matches_with_ingest_time),
    }),
  );
  return one(rows, { latestLastIngestedAt: null, hoursSinceLatestIngest: null, totalMatchesWithIngestTime: 0 });
}

async function getParserCoverage(): Promise<ParserCoverage> {
  const rows = await queryD1(
    `SELECT
      COUNT(*) AS total,
      SUM(parser_version = ${sqlString(PARSER_VERSION)}) AS current_parser,
      SUM(parser_version IS NULL OR parser_version != ${sqlString(PARSER_VERSION)}) AS stale_parser,
      ROUND(100.0 * SUM(parser_version = ${sqlString(PARSER_VERSION)}) / NULLIF(COUNT(*), 0), 2) AS current_parser_pct
    FROM matches;`,
    (row): ParserCoverage => ({
      total: toNumber(row.total),
      currentParser: toNumber(row.current_parser),
      staleParser: toNumber(row.stale_parser),
      currentParserPct: toNumber(row.current_parser_pct),
    }),
  );
  return one(rows, { total: 0, currentParser: 0, staleParser: 0, currentParserPct: 0 });
}

async function getParserVersions(): Promise<ParserVersionRow[]> {
  return queryD1(
    `SELECT
      COALESCE(parser_version, '<null>') AS parser_version,
      COUNT(*) AS matches,
      ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS pct
    FROM matches
    GROUP BY parser_version
    ORDER BY matches DESC;`,
    (row): ParserVersionRow => ({
      parserVersion: String(row.parser_version ?? ''),
      matches: toNumber(row.matches),
      pct: toNumber(row.pct),
    }),
  );
}

async function getArtifactCoverage(): Promise<ArtifactCoverage> {
  const rows = await queryD1(
    `WITH per_match AS (
      SELECT
        m.hltv_match_id,
        m.html_r2_key,
        EXISTS (
          SELECT 1
          FROM artifacts a
          WHERE a.match_hltv_id = m.hltv_match_id
            AND a.artifact_type = 'raw_html'
            AND a.status = 'stored'
            AND a.r2_key IS NOT NULL
        ) AS has_raw_html_artifact
      FROM matches m
    ), artifact_counts AS (
      SELECT
        COUNT(*) AS raw_html_stored_artifacts,
        SUM(COALESCE(byte_size, 0) < 5000) AS suspicious_small_raw_html
      FROM artifacts
      WHERE artifact_type = 'raw_html'
        AND status = 'stored'
    )
    SELECT
      COUNT(*) AS total,
      SUM(html_r2_key IS NOT NULL) AS matches_with_html_r2_key,
      SUM(has_raw_html_artifact) AS matches_with_stored_raw_html_artifact,
      ROUND(100.0 * SUM(html_r2_key IS NOT NULL) / NULLIF(COUNT(*), 0), 2) AS html_key_pct,
      ROUND(100.0 * SUM(has_raw_html_artifact) / NULLIF(COUNT(*), 0), 2) AS raw_artifact_pct,
      ac.raw_html_stored_artifacts,
      COALESCE(ac.suspicious_small_raw_html, 0) AS suspicious_small_raw_html,
      ROUND(100.0 * COALESCE(ac.suspicious_small_raw_html, 0) / NULLIF(ac.raw_html_stored_artifacts, 0), 2) AS suspicious_small_raw_html_pct
    FROM per_match
    CROSS JOIN artifact_counts ac;`,
    (row): ArtifactCoverage => ({
      total: toNumber(row.total),
      matchesWithHtmlR2Key: toNumber(row.matches_with_html_r2_key),
      matchesWithStoredRawHtmlArtifact: toNumber(row.matches_with_stored_raw_html_artifact),
      htmlKeyPct: toNumber(row.html_key_pct),
      rawArtifactPct: toNumber(row.raw_artifact_pct),
      rawHtmlStoredArtifacts: toNumber(row.raw_html_stored_artifacts),
      suspiciousSmallRawHtml: toNumber(row.suspicious_small_raw_html),
      suspiciousSmallRawHtmlPct: toNumber(row.suspicious_small_raw_html_pct),
    }),
  );
  return one(rows, {
    total: 0,
    matchesWithHtmlR2Key: 0,
    matchesWithStoredRawHtmlArtifact: 0,
    htmlKeyPct: 0,
    rawArtifactPct: 0,
    rawHtmlStoredArtifacts: 0,
    suspiciousSmallRawHtml: 0,
    suspiciousSmallRawHtmlPct: 0,
  });
}

async function getArtifactDistribution(): Promise<ArtifactDistributionRow[]> {
  return queryD1(
    `SELECT
      artifact_type,
      status,
      COUNT(*) AS artifacts,
      SUM(COALESCE(byte_size, 0)) AS total_bytes,
      ROUND(AVG(byte_size), 2) AS avg_bytes
    FROM artifacts
    GROUP BY artifact_type, status
    ORDER BY artifact_type, status;`,
    (row): ArtifactDistributionRow => ({
      artifactType: String(row.artifact_type ?? ''),
      status: String(row.status ?? ''),
      artifacts: toNumber(row.artifacts),
      totalBytes: toNumber(row.total_bytes),
      avgBytes: toNumber(row.avg_bytes),
    }),
  );
}

async function getEnrichedCoverage(): Promise<EnrichedCoverage> {
  const rows = await queryD1(
    `WITH per_match AS (
      SELECT
        m.hltv_match_id,
        EXISTS(SELECT 1 FROM maps x WHERE x.match_hltv_id = m.hltv_match_id) AS has_maps,
        EXISTS(SELECT 1 FROM player_map_stats x WHERE x.match_hltv_id = m.hltv_match_id) AS has_player_map_stats,
        EXISTS(SELECT 1 FROM player_match_stats x WHERE x.match_hltv_id = m.hltv_match_id) AS has_player_match_stats,
        EXISTS(SELECT 1 FROM match_vetoes x WHERE x.match_hltv_id = m.hltv_match_id) AS has_vetoes,
        EXISTS(SELECT 1 FROM match_lineup x WHERE x.match_hltv_id = m.hltv_match_id) AS has_lineup,
        EXISTS(SELECT 1 FROM match_streams x WHERE x.match_hltv_id = m.hltv_match_id) AS has_streams
      FROM matches m
      WHERE m.status = 'parsed'
    )
    SELECT
      COUNT(*) AS parsed_matches,
      SUM(has_maps) AS with_maps,
      SUM(has_player_map_stats) AS with_player_map_stats,
      SUM(has_player_match_stats) AS with_player_match_stats,
      SUM(has_vetoes) AS with_vetoes,
      SUM(has_lineup) AS with_lineup,
      SUM(has_streams) AS with_streams,
      ROUND(100.0 * SUM(has_maps) / NULLIF(COUNT(*), 0), 2) AS maps_pct,
      ROUND(100.0 * SUM(has_player_map_stats) / NULLIF(COUNT(*), 0), 2) AS player_map_stats_pct,
      ROUND(100.0 * SUM(has_player_match_stats) / NULLIF(COUNT(*), 0), 2) AS player_match_stats_pct,
      ROUND(100.0 * SUM(has_vetoes) / NULLIF(COUNT(*), 0), 2) AS vetoes_pct,
      ROUND(100.0 * SUM(has_lineup) / NULLIF(COUNT(*), 0), 2) AS lineup_pct,
      ROUND(100.0 * SUM(has_streams) / NULLIF(COUNT(*), 0), 2) AS streams_pct
    FROM per_match;`,
    (row): EnrichedCoverage => ({
      parsedMatches: toNumber(row.parsed_matches),
      withMaps: toNumber(row.with_maps),
      withPlayerMapStats: toNumber(row.with_player_map_stats),
      withPlayerMatchStats: toNumber(row.with_player_match_stats),
      withVetoes: toNumber(row.with_vetoes),
      withLineup: toNumber(row.with_lineup),
      withStreams: toNumber(row.with_streams),
      mapsPct: toNumber(row.maps_pct),
      playerMapStatsPct: toNumber(row.player_map_stats_pct),
      playerMatchStatsPct: toNumber(row.player_match_stats_pct),
      vetoesPct: toNumber(row.vetoes_pct),
      lineupPct: toNumber(row.lineup_pct),
      streamsPct: toNumber(row.streams_pct),
    }),
  );
  return one(rows, {
    parsedMatches: 0,
    withMaps: 0,
    withPlayerMapStats: 0,
    withPlayerMatchStats: 0,
    withVetoes: 0,
    withLineup: 0,
    withStreams: 0,
    mapsPct: 0,
    playerMapStatsPct: 0,
    playerMatchStatsPct: 0,
    vetoesPct: 0,
    lineupPct: 0,
    streamsPct: 0,
  });
}

async function getMissingCriticalData(): Promise<MissingCriticalData> {
  const rows = await queryD1(
    `SELECT
      COUNT(*) AS parsed_matches,
      SUM(event_name IS NULL OR TRIM(event_name) = '') AS missing_event_name,
      SUM(best_of IS NULL) AS missing_best_of,
      SUM(scheduled_at IS NULL) AS missing_scheduled_at,
      SUM(team1_name IS NULL OR TRIM(team1_name) = '') AS missing_team1_name,
      SUM(team2_name IS NULL OR TRIM(team2_name) = '') AS missing_team2_name,
      SUM(team1_hltv_id IS NULL) AS missing_team1_hltv_id,
      SUM(team2_hltv_id IS NULL) AS missing_team2_hltv_id,
      SUM(match_status IS NULL OR TRIM(match_status) = '') AS missing_match_status
    FROM matches
    WHERE status = 'parsed';`,
    (row): MissingCriticalData => ({
      parsedMatches: toNumber(row.parsed_matches),
      missingEventName: toNumber(row.missing_event_name),
      missingBestOf: toNumber(row.missing_best_of),
      missingScheduledAt: toNumber(row.missing_scheduled_at),
      missingTeam1Name: toNumber(row.missing_team1_name),
      missingTeam2Name: toNumber(row.missing_team2_name),
      missingTeam1HltvId: toNumber(row.missing_team1_hltv_id),
      missingTeam2HltvId: toNumber(row.missing_team2_hltv_id),
      missingMatchStatus: toNumber(row.missing_match_status),
    }),
  );
  return one(rows, {
    parsedMatches: 0,
    missingEventName: 0,
    missingBestOf: 0,
    missingScheduledAt: 0,
    missingTeam1Name: 0,
    missingTeam2Name: 0,
    missingTeam1HltvId: 0,
    missingTeam2HltvId: 0,
    missingMatchStatus: 0,
  });
}

async function getParseWarningSummary(): Promise<ParseWarningSummary> {
  const rows = await queryD1(
    `SELECT
      COUNT(*) AS total,
      SUM(parse_warnings IS NOT NULL AND parse_warnings != '[]') AS matches_with_warnings,
      ROUND(100.0 * SUM(parse_warnings IS NOT NULL AND parse_warnings != '[]') / NULLIF(COUNT(*), 0), 2) AS warning_match_pct
    FROM matches
    WHERE status IN ('parsed', 'partial');`,
    (row): ParseWarningSummary => ({
      total: toNumber(row.total),
      matchesWithWarnings: toNumber(row.matches_with_warnings),
      warningMatchPct: toNumber(row.warning_match_pct),
    }),
  );
  return one(rows, { total: 0, matchesWithWarnings: 0, warningMatchPct: 0 });
}

async function getWarningDistribution(): Promise<WarningDistributionRow[]> {
  return queryD1(
    `WITH warning_rows AS (
      SELECT je.value AS warning
      FROM matches m, json_each(COALESCE(m.parse_warnings, '[]')) je
      WHERE m.status IN ('parsed', 'partial')
    ), denominator AS (
      SELECT COUNT(*) AS total
      FROM matches
      WHERE status IN ('parsed', 'partial')
    )
    SELECT
      warning,
      COUNT(*) AS matches,
      ROUND(100.0 * COUNT(*) / NULLIF((SELECT total FROM denominator), 0), 2) AS pct
    FROM warning_rows
    GROUP BY warning
    ORDER BY matches DESC
    LIMIT 50;`,
    (row): WarningDistributionRow => ({
      warning: String(row.warning ?? ''),
      matches: toNumber(row.matches),
      pct: toNumber(row.pct),
    }),
  );
}

async function getIngestRunHealth(): Promise<IngestRunHealth> {
  const rows = await queryD1(
    `SELECT COUNT(*) AS stuck_runs
    FROM ingest_runs
    WHERE finished_at IS NULL
      AND created_at < datetime('now', '-2 hours');`,
    (row): IngestRunHealth => ({ stuckRuns: toNumber(row.stuck_runs) }),
  );
  return one(rows, { stuckRuns: 0 });
}

async function getChildSanity(): Promise<ChildSanity> {
  const mapRows = await queryD1(
    `SELECT
      COUNT(*) AS parsed_matches,
      SUM(map_count = 0) AS parsed_with_zero_maps,
      SUM(best_of IS NOT NULL AND map_count > best_of) AS map_count_gt_best_of
    FROM (
      SELECT
        m.hltv_match_id,
        m.best_of,
        COUNT(mp.id) AS map_count
      FROM matches m
      LEFT JOIN maps mp ON mp.match_hltv_id = m.hltv_match_id
      WHERE m.status = 'parsed'
      GROUP BY m.hltv_match_id, m.best_of
    );`,
    (row) => ({
      parsedMatches: toNumber(row.parsed_matches),
      parsedWithZeroMaps: toNumber(row.parsed_with_zero_maps),
      mapCountGtBestOf: toNumber(row.map_count_gt_best_of),
    }),
  );
  const statRows = await queryD1(
    `SELECT
      COUNT(*) AS player_map_stat_rows,
      SUM(kills IS NULL) AS missing_kills,
      SUM(deaths IS NULL) AS missing_deaths,
      SUM(rating IS NULL) AS missing_rating,
      SUM(team_hltv_id IS NULL) AS missing_team_hltv_id
    FROM player_map_stats;`,
    (row) => ({
      playerMapStatRows: toNumber(row.player_map_stat_rows),
      missingKills: toNumber(row.missing_kills),
      missingDeaths: toNumber(row.missing_deaths),
      missingRating: toNumber(row.missing_rating),
      missingTeamHltvId: toNumber(row.missing_team_hltv_id),
    }),
  );
  const map = one(mapRows, { parsedMatches: 0, parsedWithZeroMaps: 0, mapCountGtBestOf: 0 });
  const stats = one(statRows, {
    playerMapStatRows: 0,
    missingKills: 0,
    missingDeaths: 0,
    missingRating: 0,
    missingTeamHltvId: 0,
  });
  return { ...map, ...stats };
}

function mapMatchSample(row: Record<string, unknown>): MatchSample {
  return {
    hltvMatchId: toNumber(row.hltv_match_id),
    status: toNullableString(row.status),
    parserVersion: toNullableString(row.parser_version),
    ingestError: toNullableString(row.ingest_error),
    lastIngestedAt: toNullableString(row.last_ingested_at),
    htmlR2Key: toNullableString(row.html_r2_key),
    sourceUrl: toNullableString(row.source_url),
  };
}

async function getStaleParserSamples(samples: number): Promise<MatchSample[]> {
  return queryD1(
    `SELECT hltv_match_id, status, parser_version, ingest_error, last_ingested_at, html_r2_key, source_url
    FROM matches
    WHERE parser_version IS NULL OR parser_version != ${sqlString(PARSER_VERSION)}
    ORDER BY last_ingested_at DESC
    LIMIT ${samples};`,
    mapMatchSample,
  );
}

async function getRemediationSamples(samples: number): Promise<MatchSample[]> {
  return queryD1(
    `SELECT hltv_match_id, status, parser_version, ingest_error, last_ingested_at, html_r2_key, source_url
    FROM matches
    WHERE status IN ('partial', 'challenge', 'error')
    ORDER BY last_ingested_at DESC
    LIMIT ${samples};`,
    mapMatchSample,
  );
}

async function getMissingDataSamples(samples: number): Promise<MissingDataSample[]> {
  return queryD1(
    `SELECT
      hltv_match_id,
      status,
      event_name,
      best_of,
      scheduled_at,
      team1_hltv_id,
      team1_name,
      team2_hltv_id,
      team2_name,
      source_url
    FROM matches
    WHERE status = 'parsed'
      AND (
        event_name IS NULL
        OR best_of IS NULL
        OR scheduled_at IS NULL
        OR team1_name IS NULL
        OR team2_name IS NULL
        OR team1_hltv_id IS NULL
        OR team2_hltv_id IS NULL
      )
    ORDER BY last_ingested_at DESC
    LIMIT ${samples};`,
    (row): MissingDataSample => ({
      hltvMatchId: toNumber(row.hltv_match_id),
      status: toNullableString(row.status),
      eventName: toNullableString(row.event_name),
      bestOf: row.best_of === null || row.best_of === undefined ? null : toNumber(row.best_of),
      scheduledAt: toNullableString(row.scheduled_at),
      team1HltvId: row.team1_hltv_id === null || row.team1_hltv_id === undefined ? null : toNumber(row.team1_hltv_id),
      team1Name: toNullableString(row.team1_name),
      team2HltvId: row.team2_hltv_id === null || row.team2_hltv_id === undefined ? null : toNumber(row.team2_hltv_id),
      team2Name: toNullableString(row.team2_name),
      sourceUrl: toNullableString(row.source_url),
    }),
  );
}

function gate(condition: boolean, level: GateLevel, label: string, detail: string): Gate {
  return { level, label, detail, status: condition ? (level === 'fail' ? 'FAIL' : 'WARN') : 'PASS' };
}

function buildOverallStatusGates(overview: StatusOverview): Gate[] {
  return [
    gate(overview.total === 0, 'fail', 'D1 has matches', 'total match count must be nonzero'),
    gate(overview.errorPct > 5, 'fail', 'overall error rate <= 5%', `${overview.errorPct}%`),
    gate(overview.challengePct > 10, 'fail', 'overall challenge rate <= 10%', `${overview.challengePct}%`),
    gate(overview.partialPct > 35, 'warn', 'overall partial rate <= 35%', `${overview.partialPct}%`),
    gate(overview.pending > 0, 'warn', 'no pending rows before large scraper run', `${overview.pending} pending`),
  ];
}

function buildFreshnessGates(freshness: Freshness): Gate[] {
  const hours = freshness.hoursSinceLatestIngest ?? 0;
  const label = freshness.hoursSinceLatestIngest ?? 'n/a';
  return [
    gate(freshness.latestLastIngestedAt === null, 'fail', 'latest ingest exists', 'last_ingested_at must be present'),
    gate(hours > 72, 'fail', 'latest ingest younger than 72h', `${label}h`),
    gate(hours > 24, 'warn', 'latest ingest younger than 24h', `${label}h`),
  ];
}

interface WindowSnapshot {
  total: number;
  challengePct: number;
  errorPct: number;
  partialPct: number;
}

function snapshotWindow(row: RecentStatus | undefined): WindowSnapshot {
  return {
    total: row?.total ?? 0,
    challengePct: row?.challengePct ?? 0,
    errorPct: row?.errorPct ?? 0,
    partialPct: row?.partialPct ?? 0,
  };
}

function buildRecentWindowGates(recentStatus: RecentStatus[]): Gate[] {
  const w24 = snapshotWindow(recentStatus.find((row) => row.window === '24h'));
  const w7d = snapshotWindow(recentStatus.find((row) => row.window === '7d'));
  return [
    gate(
      w24.total >= 20 && w24.challengePct > 5,
      'fail',
      '24h challenge rate <= 5% when volume >= 20',
      `${w24.challengePct}%`,
    ),
    gate(w24.total >= 20 && w24.errorPct > 2, 'fail', '24h error rate <= 2% when volume >= 20', `${w24.errorPct}%`),
    gate(
      w24.total >= 20 && w24.partialPct > 25,
      'warn',
      '24h partial rate <= 25% when volume >= 20',
      `${w24.partialPct}%`,
    ),
    gate(
      w7d.total >= 50 && w7d.challengePct > 8,
      'fail',
      '7d challenge rate <= 8% when volume >= 50',
      `${w7d.challengePct}%`,
    ),
    gate(w7d.total >= 50 && w7d.errorPct > 3, 'fail', '7d error rate <= 3% when volume >= 50', `${w7d.errorPct}%`),
  ];
}

function buildParserCoverageGates(coverage: ParserCoverage): Gate[] {
  return [
    gate(coverage.currentParserPct < 90, 'fail', 'current parser coverage >= 90%', `${coverage.currentParserPct}%`),
    gate(coverage.currentParserPct < 95, 'warn', 'current parser coverage >= 95%', `${coverage.currentParserPct}%`),
  ];
}

function buildArtifactGates(artifact: ArtifactCoverage): Gate[] {
  return [
    gate(artifact.rawHtmlStoredArtifacts === 0, 'fail', 'stored raw HTML artifacts exist', '0 artifacts'),
    gate(artifact.rawArtifactPct < 95, 'fail', 'match raw artifact coverage >= 95%', `${artifact.rawArtifactPct}%`),
    gate(artifact.htmlKeyPct < 95, 'warn', 'match html_r2_key coverage >= 95%', `${artifact.htmlKeyPct}%`),
    gate(
      artifact.suspiciousSmallRawHtmlPct > 5,
      'fail',
      'small raw HTML artifacts <= 5%',
      `${artifact.suspiciousSmallRawHtmlPct}%`,
    ),
    gate(
      artifact.suspiciousSmallRawHtml > 0,
      'warn',
      'no suspicious small raw HTML artifacts',
      `${artifact.suspiciousSmallRawHtml} artifacts`,
    ),
  ];
}

function buildEnrichmentGates(enrichment: EnrichedCoverage): Gate[] {
  return [
    gate(enrichment.parsedMatches === 0, 'fail', 'parsed match count nonzero', '0 parsed matches'),
    gate(enrichment.mapsPct < 98, 'fail', 'parsed matches with maps >= 98%', `${enrichment.mapsPct}%`),
    gate(
      enrichment.playerMapStatsPct < 90,
      'fail',
      'parsed matches with player map stats >= 90%',
      `${enrichment.playerMapStatsPct}%`,
    ),
    gate(
      enrichment.playerMatchStatsPct < 80,
      'warn',
      'parsed matches with aggregate player stats >= 80%',
      `${enrichment.playerMatchStatsPct}%`,
    ),
    gate(enrichment.vetoesPct < 70, 'warn', 'parsed matches with vetoes >= 70%', `${enrichment.vetoesPct}%`),
    gate(enrichment.lineupPct < 70, 'warn', 'parsed matches with lineups >= 70%', `${enrichment.lineupPct}%`),
    gate(enrichment.streamsPct < 40, 'warn', 'parsed matches with streams >= 40%', `${enrichment.streamsPct}%`),
  ];
}

function buildMissingDataGates(missing: MissingCriticalData): Gate[] {
  return [
    gate(missing.missingTeam1Name > 0, 'fail', 'no parsed rows missing team1 name', `${missing.missingTeam1Name} rows`),
    gate(missing.missingTeam2Name > 0, 'fail', 'no parsed rows missing team2 name', `${missing.missingTeam2Name} rows`),
    gate(
      pct(missing.missingTeam1HltvId, missing.parsedMatches) > 2,
      'fail',
      'missing team1 HLTV id <= 2%',
      `${missing.missingTeam1HltvId} rows`,
    ),
    gate(
      pct(missing.missingTeam2HltvId, missing.parsedMatches) > 2,
      'fail',
      'missing team2 HLTV id <= 2%',
      `${missing.missingTeam2HltvId} rows`,
    ),
    gate(
      pct(missing.missingEventName, missing.parsedMatches) > 10,
      'warn',
      'missing event name <= 10%',
      `${missing.missingEventName} rows`,
    ),
    gate(
      pct(missing.missingBestOf, missing.parsedMatches) > 10,
      'warn',
      'missing best_of <= 10%',
      `${missing.missingBestOf} rows`,
    ),
    gate(
      pct(missing.missingScheduledAt, missing.parsedMatches) > 10,
      'warn',
      'missing scheduled_at <= 10%',
      `${missing.missingScheduledAt} rows`,
    ),
  ];
}

function buildParseWarningGates(summary: ParseWarningSummary, warningDistribution: WarningDistributionRow[]): Gate[] {
  const top = warningDistribution[0];
  return [
    gate(summary.warningMatchPct > 40, 'fail', 'parse-warning match rate <= 40%', `${summary.warningMatchPct}%`),
    gate(summary.warningMatchPct > 20, 'warn', 'parse-warning match rate <= 20%', `${summary.warningMatchPct}%`),
    gate(
      (top?.pct ?? 0) > 25,
      'fail',
      'top parse warning <= 25% of parsed+partial',
      `${top?.warning ?? 'none'} ${top?.pct ?? 0}%`,
    ),
  ];
}

function buildIngestRunGates(runHealth: IngestRunHealth): Gate[] {
  return [
    gate(runHealth.stuckRuns > 5, 'fail', 'stuck ingest runs <= 5', `${runHealth.stuckRuns}`),
    gate(runHealth.stuckRuns > 0, 'warn', 'no stuck ingest runs', `${runHealth.stuckRuns}`),
  ];
}

function buildChildSanityGates(child: ChildSanity): Gate[] {
  const missingRatingPct = pct(child.missingRating, child.playerMapStatRows);
  const missingTeamIdPct = pct(child.missingTeamHltvId, child.playerMapStatRows);
  return [
    gate(child.parsedWithZeroMaps > 0, 'fail', 'no parsed matches with zero maps', `${child.parsedWithZeroMaps}`),
    gate(child.mapCountGtBestOf > 0, 'warn', 'no map count > best_of anomalies', `${child.mapCountGtBestOf}`),
    gate(missingRatingPct > 20, 'warn', 'player map stat missing rating <= 20%', `${missingRatingPct}%`),
    gate(missingTeamIdPct > 10, 'warn', 'player map stat missing team id <= 10%', `${missingTeamIdPct}%`),
  ];
}

function buildGates(report: Omit<Report, 'gates'>): Gate[] {
  return [
    ...buildOverallStatusGates(report.statusOverview),
    ...buildFreshnessGates(report.freshness),
    ...buildRecentWindowGates(report.recentStatus),
    ...buildParserCoverageGates(report.parserCoverage),
    ...buildArtifactGates(report.artifactCoverage),
    ...buildEnrichmentGates(report.enrichedCoverage),
    ...buildMissingDataGates(report.missingCriticalData),
    ...buildParseWarningGates(report.parseWarningSummary, report.warningDistribution),
    ...buildIngestRunGates(report.ingestRunHealth),
    ...buildChildSanityGates(report.childSanity),
  ];
}

function icon(status: GateStatus): string {
  if (status === 'PASS') return 'PASS';
  if (status === 'WARN') return 'WARN';
  return 'FAIL';
}

function printRows<T>(title: string, rows: T[], formatter: (row: T) => string): void {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log('  none');
    return;
  }
  for (const row of rows) console.log(`  ${formatter(row)}`);
}

function printHeaderLines(report: Report): void {
  const status = report.statusOverview;
  console.log(`Ingestion health report | generated=${report.generatedAt} | parser=${report.parserVersion}`);
  console.log(
    `Status: total=${status.total} parsed=${status.parsed} (${status.parsedPct}%) ` +
      `partial=${status.partial} (${status.partialPct}%) ` +
      `challenge=${status.challenge} (${status.challengePct}%) error=${status.error} (${status.errorPct}%)`,
  );
  console.log(
    `Freshness: latest=${report.freshness.latestLastIngestedAt ?? 'none'} ageHours=${report.freshness.hoursSinceLatestIngest ?? 'n/a'}`,
  );
  console.log(
    `Parser: current=${report.parserCoverage.currentParser}/${report.parserCoverage.total} (${report.parserCoverage.currentParserPct}%) stale=${report.parserCoverage.staleParser}`,
  );
  console.log(
    `Raw artifacts: matchCoverage=${report.artifactCoverage.rawArtifactPct}% htmlKey=${report.artifactCoverage.htmlKeyPct}% stored=${report.artifactCoverage.rawHtmlStoredArtifacts} small=${report.artifactCoverage.suspiciousSmallRawHtml}`,
  );
  const enriched = report.enrichedCoverage;
  console.log(
    `Enrichment(parsed only): maps=${enriched.mapsPct}% mapStats=${enriched.playerMapStatsPct}% ` +
      `aggStats=${enriched.playerMatchStatsPct}% vetoes=${enriched.vetoesPct}% ` +
      `lineup=${enriched.lineupPct}% streams=${enriched.streamsPct}%`,
  );
  const missing = report.missingCriticalData;
  console.log(
    `Missing critical(parsed): event=${missing.missingEventName} bestOf=${missing.missingBestOf} ` +
      `scheduled=${missing.missingScheduledAt} teamNames=${missing.missingTeam1Name + missing.missingTeam2Name} ` +
      `teamIds=${missing.missingTeam1HltvId + missing.missingTeam2HltvId}`,
  );
  console.log(
    `Parse warnings: matches=${report.parseWarningSummary.matchesWithWarnings}/${report.parseWarningSummary.total} (${report.parseWarningSummary.warningMatchPct}%)`,
  );
}

function printDetailSections(report: Report): void {
  printRows(
    'Recent windows',
    report.recentStatus,
    (row) =>
      `${row.window}: total=${row.total} parsed=${row.parsedPct}% partial=${row.partialPct}% challenge=${row.challengePct}% error=${row.errorPct}%`,
  );
  printRows('Parser versions', report.parserVersions, (row) => `${row.parserVersion}: ${row.matches} (${row.pct}%)`);
  printRows(
    'Artifact distribution',
    report.artifactDistribution,
    (row) => `${row.artifactType}/${row.status}: ${row.artifacts} avgBytes=${row.avgBytes}`,
  );
  printRows(
    'Top parse warnings',
    report.warningDistribution.slice(0, 10),
    (row) => `${row.matches} (${row.pct}%): ${row.warning}`,
  );
  printRows(
    'Stale parser samples',
    report.staleParserSamples,
    (row) => `${row.hltvMatchId} status=${row.status} parser=${row.parserVersion} ingested=${row.lastIngestedAt}`,
  );
  printRows(
    'Partial/challenge/error samples',
    report.remediationSamples,
    (row) => `${row.hltvMatchId} status=${row.status} parser=${row.parserVersion} error=${row.ingestError ?? 'none'}`,
  );
  printRows(
    'Missing-data samples',
    report.missingDataSamples,
    (row) =>
      `${row.hltvMatchId} event=${row.eventName ?? 'missing'} bestOf=${row.bestOf ?? 'missing'} scheduled=${row.scheduledAt ?? 'missing'} teams=${row.team1Name ?? 'missing'} vs ${row.team2Name ?? 'missing'}`,
  );
}

function printGatesSection(gates: Gate[], strict: boolean): void {
  const failCount = gates.filter((gateItem) => gateItem.status === 'FAIL').length;
  const warnCount = gates.filter((gateItem) => gateItem.status === 'WARN').length;
  console.log('\nGates');
  for (const gateItem of gates) {
    if (gateItem.status === 'PASS') continue;
    console.log(`  ${icon(gateItem.status)} ${gateItem.label}: ${gateItem.detail}`);
  }
  if (failCount === 0 && warnCount === 0) console.log('  PASS all gates clean');
  console.log(`\nSummary: fails=${failCount} warnings=${warnCount} strict=${strict}`);
}

function printReport(report: Report, strict: boolean): void {
  printHeaderLines(report);
  printDetailSections(report);
  printGatesSection(report.gates, strict);
}

type AggregateSections = Pick<
  Report,
  | 'statusOverview'
  | 'recentStatus'
  | 'freshness'
  | 'parserCoverage'
  | 'parserVersions'
  | 'artifactCoverage'
  | 'artifactDistribution'
  | 'enrichedCoverage'
  | 'missingCriticalData'
  | 'parseWarningSummary'
  | 'warningDistribution'
  | 'ingestRunHealth'
  | 'childSanity'
>;

type SampleSections = Pick<Report, 'staleParserSamples' | 'remediationSamples' | 'missingDataSamples'>;

async function fetchAggregateSections(): Promise<AggregateSections> {
  const [
    statusOverview,
    recentStatus,
    freshness,
    parserCoverage,
    parserVersions,
    artifactCoverage,
    artifactDistribution,
    enrichedCoverage,
    missingCriticalData,
    parseWarningSummary,
    warningDistribution,
    ingestRunHealth,
    childSanity,
  ] = await Promise.all([
    getStatusOverview(),
    getRecentStatus(),
    getFreshness(),
    getParserCoverage(),
    getParserVersions(),
    getArtifactCoverage(),
    getArtifactDistribution(),
    getEnrichedCoverage(),
    getMissingCriticalData(),
    getParseWarningSummary(),
    getWarningDistribution(),
    getIngestRunHealth(),
    getChildSanity(),
  ]);
  return {
    statusOverview,
    recentStatus,
    freshness,
    parserCoverage,
    parserVersions,
    artifactCoverage,
    artifactDistribution,
    enrichedCoverage,
    missingCriticalData,
    parseWarningSummary,
    warningDistribution,
    ingestRunHealth,
    childSanity,
  };
}

async function fetchSampleSections(samples: number): Promise<SampleSections> {
  const [staleParserSamples, remediationSamples, missingDataSamples] = await Promise.all([
    getStaleParserSamples(samples),
    getRemediationSamples(samples),
    getMissingDataSamples(samples),
  ]);
  return { staleParserSamples, remediationSamples, missingDataSamples };
}

async function buildReport(options: Options): Promise<Report> {
  const [aggregates, samples] = await Promise.all([fetchAggregateSections(), fetchSampleSections(options.samples)]);
  const reportWithoutGates: Omit<Report, 'gates'> = {
    generatedAt: new Date().toISOString(),
    parserVersion: PARSER_VERSION,
    ...aggregates,
    ...samples,
  };
  return { ...reportWithoutGates, gates: buildGates(reportWithoutGates) };
}

async function main(): Promise<void> {
  const options = parseArgs();
  try {
    const report = await buildReport(options);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else printReport(report, options.strict);

    const hasFailures = report.gates.some((gateItem) => gateItem.status === 'FAIL');
    const hasWarnings = report.gates.some((gateItem) => gateItem.status === 'WARN');
    if (hasFailures || (options.strict && hasWarnings)) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

await main();

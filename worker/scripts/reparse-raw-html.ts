import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { PARSER_VERSION } from '../src/constants';
import { parseMatchHtml } from '../src/hltv';
import type { ParsedMatch } from '../src/types';

const execFileAsync = promisify(execFile);
const DEFAULT_LIMIT = 25;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_CHECKPOINT_KEY = 'reparse_raw_html_checkpoint';
const DEFAULT_WORKER_URL = 'https://csgogamble-worker.jakob-ad5.workers.dev';
const RAW_HTML_BUCKET = 'csgogamble-raw';
const D1_DATABASE = 'csgogamble';
const WRANGLER_MAX_BUFFER = 25 * 1024 * 1024;

type Decision = 'apply' | 'skip_challenge' | 'skip_no_improvement' | 'skip_regression' | 'error';

interface Options {
  apply: boolean;
  limit: number;
  batchSize: number;
  cursor: number | null;
  resume: boolean;
  checkpointKey: string;
  workerUrl: string;
  statuses: string[];
  onlyMissingEnrichment: boolean;
  includeChallenges: boolean;
  forceRegressions: boolean;
  json: boolean;
}

interface CandidateRow {
  artifact_id: number;
  match_hltv_id: number;
  source_url: string;
  r2_key: string;
  byte_size: number | null;
  checksum_sha256: string | null;
  artifact_updated_at: string | null;
  status: string | null;
  parser_version: string | null;
  html_r2_key: string | null;
}

interface CoverageRow {
  matches_total: number;
  parsed_matches: number;
  partial_matches: number;
  challenge_matches: number;
  error_matches: number;
  matches_with_html_key: number;
  parser_current_matches: number;
  matches_with_maps: number;
  matches_with_player_map_stats: number;
  matches_with_player_match_stats: number;
  matches_with_vetoes: number;
  matches_with_lineup: number;
  matches_with_streams: number;
}

interface ExistingCounts {
  maps: number;
  playerMapStats: number;
  playerMatchStats: number;
  vetoes: number;
  lineup: number;
  streams: number;
}

interface CandidateResult {
  matchHltvId: number;
  r2Key: string;
  oldStatus: string | null;
  oldParserVersion: string | null;
  parsedStatus?: string;
  parserVersion?: string;
  existing?: ExistingCounts;
  parsed?: ExistingCounts & { parseWarnings: number };
  decision: Decision;
  reason: string;
}

interface RunSummary {
  dryRun: boolean;
  cursorStart: number;
  cursorEnd: number;
  inspected: number;
  applied: number;
  skipped: number;
  errors: number;
  before: CoverageRow | null;
  after: CoverageRow | null;
  results: CandidateResult[];
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

  const statuses = (getValue('--statuses') ?? 'parsed,partial,error')
    .split(',')
    .map((status) => status.trim())
    .filter(Boolean);

  return {
    apply: args.includes('--apply'),
    limit: Number(getValue('--limit') ?? DEFAULT_LIMIT),
    batchSize: Number(getValue('--batch-size') ?? DEFAULT_BATCH_SIZE),
    cursor: getValue('--cursor') === null ? null : Number(getValue('--cursor')),
    resume: args.includes('--resume'),
    checkpointKey: getValue('--checkpoint-key') ?? DEFAULT_CHECKPOINT_KEY,
    workerUrl: (getValue('--worker-url') ?? DEFAULT_WORKER_URL).replace(/\/$/, ''),
    statuses,
    onlyMissingEnrichment: !args.includes('--all'),
    includeChallenges: args.includes('--include-challenges'),
    forceRegressions: args.includes('--force-regressions'),
    json: args.includes('--json'),
  };
}

function loadCloudflareEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!existsSync('.dev.vars')) return env;

  const lines = readFileSync('.dev.vars', 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    env[key] = env[key] ?? value;
  }

  env.CLOUDFLARE_API_TOKEN = env.CLOUDFLARE_API_TOKEN ?? env.CF_API_TOKEN;
  env.CLOUDFLARE_ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID ?? env.CF_ACCOUNT_ID;
  return env;
}

const cloudflareEnv = loadCloudflareEnv();

async function wrangler(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    env: cloudflareEnv,
    maxBuffer: WRANGLER_MAX_BUFFER,
  });
  return stdout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function parseD1Rows<T>(output: string, mapper: (row: Record<string, unknown>) => T): T[] {
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed) || !isRecord(parsed[0]) || !Array.isArray(parsed[0].results)) return [];
  return parsed[0].results.filter(isRecord).map(mapper);
}

async function queryD1<T>(sql: string, mapper: (row: Record<string, unknown>) => T): Promise<T[]> {
  const output = await wrangler(['d1', 'execute', D1_DATABASE, '--remote', '--json', '--command', sql]);
  return parseD1Rows(output, mapper);
}

async function executeD1(sql: string): Promise<void> {
  await wrangler(['d1', 'execute', D1_DATABASE, '--remote', '--command', sql]);
}

function mapCoverage(row: Record<string, unknown>): CoverageRow {
  return {
    matches_total: toNumber(row.matches_total),
    parsed_matches: toNumber(row.parsed_matches),
    partial_matches: toNumber(row.partial_matches),
    challenge_matches: toNumber(row.challenge_matches),
    error_matches: toNumber(row.error_matches),
    matches_with_html_key: toNumber(row.matches_with_html_key),
    parser_current_matches: toNumber(row.parser_current_matches),
    matches_with_maps: toNumber(row.matches_with_maps),
    matches_with_player_map_stats: toNumber(row.matches_with_player_map_stats),
    matches_with_player_match_stats: toNumber(row.matches_with_player_match_stats),
    matches_with_vetoes: toNumber(row.matches_with_vetoes),
    matches_with_lineup: toNumber(row.matches_with_lineup),
    matches_with_streams: toNumber(row.matches_with_streams),
  };
}

async function getCoverage(): Promise<CoverageRow | null> {
  const sql = `WITH per_match AS (
    SELECT
      m.hltv_match_id,
      m.status,
      m.parser_version,
      m.html_r2_key,
      EXISTS(SELECT 1 FROM maps x WHERE x.match_hltv_id = m.hltv_match_id) AS has_maps,
      EXISTS(SELECT 1 FROM player_map_stats x WHERE x.match_hltv_id = m.hltv_match_id) AS has_player_map_stats,
      EXISTS(SELECT 1 FROM player_match_stats x WHERE x.match_hltv_id = m.hltv_match_id) AS has_player_match_stats,
      EXISTS(SELECT 1 FROM match_vetoes x WHERE x.match_hltv_id = m.hltv_match_id) AS has_vetoes,
      EXISTS(SELECT 1 FROM match_lineup x WHERE x.match_hltv_id = m.hltv_match_id) AS has_lineup,
      EXISTS(SELECT 1 FROM match_streams x WHERE x.match_hltv_id = m.hltv_match_id) AS has_streams
    FROM matches m
  )
  SELECT
    COUNT(*) AS matches_total,
    SUM(status = 'parsed') AS parsed_matches,
    SUM(status = 'partial') AS partial_matches,
    SUM(status = 'challenge') AS challenge_matches,
    SUM(status = 'error') AS error_matches,
    SUM(html_r2_key IS NOT NULL) AS matches_with_html_key,
    SUM(parser_version = ${sqlString(PARSER_VERSION)}) AS parser_current_matches,
    SUM(has_maps) AS matches_with_maps,
    SUM(has_player_map_stats) AS matches_with_player_map_stats,
    SUM(has_player_match_stats) AS matches_with_player_match_stats,
    SUM(has_vetoes) AS matches_with_vetoes,
    SUM(has_lineup) AS matches_with_lineup,
    SUM(has_streams) AS matches_with_streams
  FROM per_match;`;
  return (await queryD1(sql, mapCoverage))[0] ?? null;
}

async function getCheckpoint(checkpointKey: string): Promise<number> {
  const rows = await queryD1(`SELECT value FROM crawl_state WHERE key = ${sqlString(checkpointKey)} LIMIT 1;`, (row) =>
    toNullableString(row.value),
  );
  const value = rows[0];
  if (!value) return 0;
  try {
    const parsed: unknown = JSON.parse(value);
    if (isRecord(parsed)) return toNumber(parsed.lastMatchHltvId);
  } catch {
    return Number(value) || 0;
  }
  return 0;
}

async function setCheckpoint(checkpointKey: string, value: unknown): Promise<void> {
  const payload = JSON.stringify(value);
  await executeD1(
    `INSERT INTO crawl_state (key, value, updated_at)
     VALUES (${sqlString(checkpointKey)}, ${sqlString(payload)}, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
  );
}

function mapCandidate(row: Record<string, unknown>): CandidateRow {
  return {
    artifact_id: toNumber(row.artifact_id),
    match_hltv_id: toNumber(row.match_hltv_id),
    source_url: String(row.source_url ?? ''),
    r2_key: String(row.r2_key ?? ''),
    byte_size: row.byte_size === null || row.byte_size === undefined ? null : toNumber(row.byte_size),
    checksum_sha256: toNullableString(row.checksum_sha256),
    artifact_updated_at: toNullableString(row.artifact_updated_at),
    status: toNullableString(row.status),
    parser_version: toNullableString(row.parser_version),
    html_r2_key: toNullableString(row.html_r2_key),
  };
}

function statusClause(statuses: string[]): string {
  if (statuses.length === 0) return '1 = 1';
  return `m.status IN (${statuses.map(sqlString).join(', ')})`;
}

function enrichmentClause(enabled: boolean): string {
  if (!enabled) return '1 = 1';
  return `(m.parser_version IS NULL OR m.parser_version != ${sqlString(PARSER_VERSION)}
    OR NOT EXISTS(SELECT 1 FROM player_match_stats x WHERE x.match_hltv_id = m.hltv_match_id)
    OR NOT EXISTS(SELECT 1 FROM match_vetoes x WHERE x.match_hltv_id = m.hltv_match_id)
    OR NOT EXISTS(SELECT 1 FROM match_lineup x WHERE x.match_hltv_id = m.hltv_match_id)
    OR NOT EXISTS(SELECT 1 FROM match_streams x WHERE x.match_hltv_id = m.hltv_match_id))`;
}

async function getCandidates(
  cursor: number,
  limit: number,
  statuses: string[],
  onlyMissingEnrichment: boolean,
): Promise<CandidateRow[]> {
  const sql = `WITH ranked AS (
    SELECT
      a.id AS artifact_id,
      a.match_hltv_id,
      COALESCE(a.source_url, m.source_url) AS source_url,
      a.r2_key,
      a.byte_size,
      a.checksum_sha256,
      a.updated_at AS artifact_updated_at,
      m.status,
      m.parser_version,
      m.html_r2_key,
      ROW_NUMBER() OVER (
        PARTITION BY a.match_hltv_id
        ORDER BY
          CASE WHEN a.r2_key = m.html_r2_key THEN 0 ELSE 1 END,
          a.updated_at DESC,
          a.id DESC
      ) AS rn
    FROM artifacts a
    JOIN matches m ON m.hltv_match_id = a.match_hltv_id
    WHERE a.artifact_type = 'raw_html'
      AND a.status = 'stored'
      AND a.r2_key IS NOT NULL
      AND a.match_hltv_id IS NOT NULL
      AND a.match_hltv_id > ${cursor}
      AND ${statusClause(statuses)}
      AND ${enrichmentClause(onlyMissingEnrichment)}
  )
  SELECT * FROM ranked
  WHERE rn = 1
  ORDER BY match_hltv_id
  LIMIT ${limit};`;
  return queryD1(sql, mapCandidate);
}

async function getExistingCounts(matchHltvId: number): Promise<ExistingCounts> {
  const sql = `SELECT
    (SELECT COUNT(*) FROM maps WHERE match_hltv_id = ${matchHltvId}) AS maps,
    (SELECT COUNT(*) FROM player_map_stats WHERE match_hltv_id = ${matchHltvId}) AS player_map_stats,
    (SELECT COUNT(*) FROM player_match_stats WHERE match_hltv_id = ${matchHltvId}) AS player_match_stats,
    (SELECT COUNT(*) FROM match_vetoes WHERE match_hltv_id = ${matchHltvId}) AS vetoes,
    (SELECT COUNT(*) FROM match_lineup WHERE match_hltv_id = ${matchHltvId}) AS lineup,
    (SELECT COUNT(*) FROM match_streams WHERE match_hltv_id = ${matchHltvId}) AS streams;`;
  const row = (await queryD1(sql, (result) => result))[0] ?? {};
  return {
    maps: toNumber(row.maps),
    playerMapStats: toNumber(row.player_map_stats),
    playerMatchStats: toNumber(row.player_match_stats),
    vetoes: toNumber(row.vetoes),
    lineup: toNumber(row.lineup),
    streams: toNumber(row.streams),
  };
}

async function readRawHtml(r2Key: string): Promise<string> {
  return wrangler(['r2', 'object', 'get', `${RAW_HTML_BUCKET}/${r2Key}`, '--remote', '--pipe']);
}

function parsedCounts(parsed: ParsedMatch): ExistingCounts & { parseWarnings: number } {
  return {
    maps: parsed.maps.length,
    playerMapStats: parsed.playerStats.length,
    playerMatchStats: parsed.playerAggregateStats.length,
    vetoes: parsed.vetoes.length,
    lineup: parsed.lineup.length,
    streams: parsed.streams.length,
    parseWarnings: parsed.parseWarnings.length,
  };
}

function totalEnrichedCounts(counts: ExistingCounts): number {
  return counts.playerMatchStats + counts.vetoes + counts.lineup + counts.streams;
}

function decide(
  candidate: CandidateRow,
  existing: ExistingCounts,
  parsed: ParsedMatch,
  options: Options,
): { decision: Decision; reason: string } {
  const next = parsedCounts(parsed);
  if (parsed.status === 'challenge' && !options.includeChallenges) {
    return { decision: 'skip_challenge', reason: 'stored artifact is a Cloudflare challenge page' };
  }

  const oldScore = totalEnrichedCounts(existing);
  const newScore = totalEnrichedCounts(next);
  const hasNewUsefulData = newScore > 0 || next.maps > 0 || next.playerMapStats > 0;
  if (!hasNewUsefulData)
    return { decision: 'skip_no_improvement', reason: 'parser found no useful normalized children' };

  if (!options.forceRegressions && candidate.status === 'parsed' && parsed.status !== 'parsed') {
    return { decision: 'skip_regression', reason: `would change parsed match to ${parsed.status}` };
  }

  if (!options.forceRegressions && newScore < oldScore) {
    return { decision: 'skip_regression', reason: `enriched child score would drop from ${oldScore} to ${newScore}` };
  }

  if (candidate.parser_version === PARSER_VERSION && newScore <= oldScore) {
    return {
      decision: 'skip_no_improvement',
      reason: 'already current parser version with equal or better enrichment',
    };
  }

  return { decision: 'apply', reason: `enriched child score ${oldScore} -> ${newScore}` };
}

async function applyParsed(workerUrl: string, candidate: CandidateRow, html: string): Promise<void> {
  const response = await fetch(`${workerUrl}/ingest/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ matchUrl: candidate.source_url, html, persistHtml: false }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Worker ingest failed (${response.status}): ${text.slice(0, 500)}`);
  }
}

async function processCandidate(candidate: CandidateRow, options: Options): Promise<CandidateResult> {
  try {
    const html = await readRawHtml(candidate.r2_key);
    const parsed = parseMatchHtml(candidate.source_url, html);
    const existing = await getExistingCounts(candidate.match_hltv_id);
    const counts = parsedCounts(parsed);
    const { decision, reason } = decide(candidate, existing, parsed, options);

    if (decision === 'apply' && options.apply) {
      await applyParsed(options.workerUrl, candidate, html);
    }

    return {
      matchHltvId: candidate.match_hltv_id,
      r2Key: candidate.r2_key,
      oldStatus: candidate.status,
      oldParserVersion: candidate.parser_version,
      parsedStatus: parsed.status,
      parserVersion: parsed.parserVersion,
      existing,
      parsed: counts,
      decision,
      reason,
    };
  } catch (error) {
    return {
      matchHltvId: candidate.match_hltv_id,
      r2Key: candidate.r2_key,
      oldStatus: candidate.status,
      oldParserVersion: candidate.parser_version,
      decision: 'error',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function printCoverage(label: string, coverage: CoverageRow | null): void {
  if (!coverage) {
    console.log(`${label}: unavailable`);
    return;
  }
  console.log(
    `${label}: matches=${coverage.matches_total} parsed=${coverage.parsed_matches} partial=${coverage.partial_matches} ` +
      `challenge=${coverage.challenge_matches} error=${coverage.error_matches} currentParser=${coverage.parser_current_matches} ` +
      `maps=${coverage.matches_with_maps} aggStats=${coverage.matches_with_player_match_stats} vetoes=${coverage.matches_with_vetoes} ` +
      `lineup=${coverage.matches_with_lineup} streams=${coverage.matches_with_streams}`,
  );
}

async function main(): Promise<void> {
  const options = parseArgs();
  const checkpointCursor = options.resume ? await getCheckpoint(options.checkpointKey) : 0;
  const cursorStart = options.cursor ?? checkpointCursor;
  let cursor = cursorStart;
  const before = await getCoverage();
  const results: CandidateResult[] = [];

  if (!options.json) {
    console.log(
      `Reparse raw HTML | dry-run=${!options.apply} | limit=${options.limit} | batch=${options.batchSize} | cursor=${cursorStart}`,
    );
    printCoverage('before', before);
  }

  while (results.length < options.limit) {
    const remaining = options.limit - results.length;
    const candidates = await getCandidates(
      cursor,
      Math.min(options.batchSize, remaining),
      options.statuses,
      options.onlyMissingEnrichment,
    );
    if (candidates.length === 0) break;

    for (const candidate of candidates) {
      const result = await processCandidate(candidate, options);
      results.push(result);
      cursor = candidate.match_hltv_id;
      if (!options.json) console.log(`${result.decision} ${result.matchHltvId}: ${result.reason}`);

      if (options.apply) {
        await setCheckpoint(options.checkpointKey, {
          lastMatchHltvId: cursor,
          lastR2Key: candidate.r2_key,
          processed: results.length,
          parserVersion: PARSER_VERSION,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  const after = await getCoverage();
  const summary: RunSummary = {
    dryRun: !options.apply,
    cursorStart,
    cursorEnd: cursor,
    inspected: results.length,
    applied: results.filter((result) => result.decision === 'apply').length,
    skipped: results.filter((result) => result.decision.startsWith('skip')).length,
    errors: results.filter((result) => result.decision === 'error').length,
    before,
    after,
    results,
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  printCoverage('after ', after);
  console.log(
    `summary: inspected=${summary.inspected} ${options.apply ? 'applied' : 'wouldApply'}=${summary.applied} skipped=${summary.skipped} errors=${summary.errors} cursor=${summary.cursorEnd}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

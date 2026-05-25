// biome-ignore-all lint/nursery/noUnnecessaryConditions: Biome false positive on narrowed CLI/domain union.
/**
 * backfill-daemon.ts — D1-backed worker-native backfill orchestrator.
 *
 * Does NOT perform local HLTV acquisition. It only:
 *   1. discovers candidates by querying D1
 *   2. persists a `backfill_runs` row + `backfill_candidates` rows in D1
 *   3. asks the deployed worker (via /admin/backfill/*) to enqueue work
 *
 * Usage:
 *   npm run backfill:daemon -- --list-only --filter partial --max 200
 *   npm run backfill:daemon -- --apply --filter challenge --max 500 --batch-size 25 --concurrency 1
 *   npm run backfill:daemon -- --resume --run-id 17 --batch-size 25
 *
 * `--apply` is required to actually create a run or enqueue work; without it
 * the script lists candidates and exits. Local HLTV acquisition is rejected by
 * default; pass `--allow-local-hltv` to override (currently unused — present so
 * future workflows can opt in).
 */

import { queryD1, toNullableString, toNumber } from './ops-utils';

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_MAX = 100;
const DEFAULT_THROTTLE_MS = 1_500;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_POLL_MAX = 24;

type CandidateFilter = 'partial' | 'challenge' | 'error' | 'pending' | 'stale-parser' | 'no-html';

interface Options {
  apply: boolean;
  listOnly: boolean;
  resume: boolean;
  json: boolean;
  filter: CandidateFilter;
  max: number;
  batchSize: number;
  concurrency: number;
  runId: number | null;
  workerUrl: string | null;
  adminToken: string | null;
  acquisitionMode: 'browser' | 'browser-session' | 'http';
  browserSessionKey: string | null;
  throttleMs: number;
  allowLocalHltv: boolean;
  pollMax: number;
  pollIntervalMs: number;
}

interface CandidateRow {
  hltvMatchId: number;
  sourceUrl: string | null;
  status: string | null;
  parserVersion: string | null;
}

interface BackfillRunStatus {
  id: number;
  status: string;
  totalCandidates: number;
  enqueued: number;
  parsed: number;
  partial: number;
  challenge: number;
  failedClassified: number;
  skipped: number;
}

function readValue(args: string[], name: string): string | null {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const filter = (readValue(args, '--filter') ?? 'partial') as CandidateFilter;
  return {
    apply: args.includes('--apply'),
    listOnly: args.includes('--list-only') || !args.includes('--apply'),
    resume: args.includes('--resume'),
    json: args.includes('--json'),
    filter,
    max: Number(readValue(args, '--max') ?? DEFAULT_MAX),
    batchSize: Number(readValue(args, '--batch-size') ?? DEFAULT_BATCH_SIZE),
    concurrency: Number(readValue(args, '--concurrency') ?? DEFAULT_CONCURRENCY),
    runId: readValue(args, '--run-id') ? Number(readValue(args, '--run-id')) : null,
    workerUrl: readValue(args, '--worker-url') ?? process.env.WORKER_URL ?? null,
    adminToken: readValue(args, '--admin-token') ?? process.env.ADMIN_TOKEN ?? null,
    acquisitionMode: (readValue(args, '--acquisition-mode') as Options['acquisitionMode']) ?? 'browser-session',
    browserSessionKey: readValue(args, '--browser-session-key'),
    throttleMs: Number(readValue(args, '--throttle-ms') ?? DEFAULT_THROTTLE_MS),
    allowLocalHltv: args.includes('--allow-local-hltv'),
    pollMax: Number(readValue(args, '--poll-max') ?? DEFAULT_POLL_MAX),
    pollIntervalMs: Number(readValue(args, '--poll-interval-ms') ?? DEFAULT_POLL_INTERVAL_MS),
  };
}

function buildCandidateQuery(filter: CandidateFilter, max: number): string {
  const limit = Math.max(1, Math.min(max, 5_000));
  switch (filter) {
    case 'partial':
      return `SELECT hltv_match_id, source_url, status, parser_version
                FROM matches
               WHERE status = 'partial'
               ORDER BY last_ingested_at DESC
               LIMIT ${limit};`;
    case 'challenge':
      return `SELECT hltv_match_id, source_url, status, parser_version
                FROM matches
               WHERE status = 'challenge'
               ORDER BY last_ingested_at DESC
               LIMIT ${limit};`;
    case 'error':
      return `SELECT hltv_match_id, source_url, status, parser_version
                FROM matches
               WHERE status = 'error'
               ORDER BY last_ingested_at DESC
               LIMIT ${limit};`;
    case 'pending':
      return `SELECT hltv_match_id, source_url, status, parser_version
                FROM matches
               WHERE status = 'pending'
               ORDER BY first_seen_at DESC
               LIMIT ${limit};`;
    case 'no-html':
      return `SELECT hltv_match_id, source_url, status, parser_version
                FROM matches
               WHERE html_r2_key IS NULL
               ORDER BY last_ingested_at DESC
               LIMIT ${limit};`;
    case 'stale-parser':
      return `SELECT hltv_match_id, source_url, status, parser_version
                FROM matches
               WHERE parser_version IS NULL OR parser_version != (SELECT parser_version FROM matches ORDER BY last_ingested_at DESC LIMIT 1)
               ORDER BY last_ingested_at DESC
               LIMIT ${limit};`;
    default:
      throw new Error(`Unknown --filter ${filter}`);
  }
}

async function loadCandidates(filter: CandidateFilter, max: number): Promise<CandidateRow[]> {
  return queryD1(
    buildCandidateQuery(filter, max),
    (row): CandidateRow => ({
      hltvMatchId: toNumber(row.hltv_match_id),
      sourceUrl: toNullableString(row.source_url),
      status: toNullableString(row.status),
      parserVersion: toNullableString(row.parser_version),
    }),
  );
}

function ensureRemoteConfig(options: Options): void {
  if (!options.workerUrl) {
    throw new Error('--worker-url (or WORKER_URL env) required for --apply mode');
  }
  if (!options.adminToken) {
    throw new Error('--admin-token (or ADMIN_TOKEN env) required for --apply mode');
  }
}

async function postAdmin<TResponse>(
  options: Options,
  path: '/admin/backfill/start' | '/admin/backfill/enqueue' | '/admin/backfill/status',
  body: Record<string, unknown>,
): Promise<TResponse> {
  if (!options.workerUrl || !options.adminToken) {
    throw new Error('Worker URL / admin token not configured');
  }
  const response = await fetch(`${options.workerUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-admin-token': options.adminToken,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`POST ${path} failed: ${response.status} ${text.slice(0, 200)}`);
  }
  return (await response.json()) as TResponse;
}

interface StartResponse {
  ok: true;
  runId: number;
  totalCandidates: number;
}

interface EnqueueResponse {
  ok: true;
  runId: number;
  enqueued: number;
  drained: boolean;
}

interface StatusResponse {
  ok: true;
  run: BackfillRunStatus;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printPreflight(candidates: CandidateRow[], options: Options): void {
  console.log(
    `backfill-daemon preflight: filter=${options.filter} found=${candidates.length} max=${options.max} apply=${options.apply}`,
  );
  const statusCounts: Record<string, number> = {};
  for (const row of candidates) {
    const key = row.status ?? 'null';
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }
  console.log('Status mix:');
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status}: ${count}`);
  }
  console.log('First 10 candidates:');
  for (const row of candidates.slice(0, 10)) {
    console.log(`  ${row.hltvMatchId} ${row.status ?? 'null'} parser=${row.parserVersion ?? 'null'}`);
  }
}

function printSummary(label: string, status: BackfillRunStatus): void {
  console.log(
    `${label}: id=${status.id} status=${status.status} total=${status.totalCandidates} ` +
      `enqueued=${status.enqueued} parsed=${status.parsed} partial=${status.partial} ` +
      `challenge=${status.challenge} failed_classified=${status.failedClassified} skipped=${status.skipped}`,
  );
}

async function runApplyFlow(candidates: CandidateRow[], options: Options): Promise<void> {
  ensureRemoteConfig(options);
  let runId = options.runId;
  if (!runId) {
    const start = await postAdmin<StartResponse>(options, '/admin/backfill/start', {
      matchIds: candidates.map((candidate) => candidate.hltvMatchId),
      candidateFilter: options.filter,
      options: {
        max: options.max,
        batchSize: options.batchSize,
        concurrency: options.concurrency,
        acquisitionMode: options.acquisitionMode,
      },
    });
    runId = start.runId;
    console.log(`Created backfill run id=${runId} candidates=${start.totalCandidates}`);
  } else {
    console.log(`Resuming backfill run id=${runId}`);
  }

  let totalEnqueued = 0;
  for (let i = 0; i < options.concurrency * options.pollMax; i++) {
    // biome-ignore lint/performance/noAwaitInLoops: serial enqueue is intentional — each batch must finish before the next.
    const enqueue = await postAdmin<EnqueueResponse>(options, '/admin/backfill/enqueue', {
      runId,
      batchSize: options.batchSize,
      acquisitionMode: options.acquisitionMode,
      browserSessionKey: options.browserSessionKey ?? `backfill-${runId}`,
      source: `backfill:${runId}`,
    });
    totalEnqueued += enqueue.enqueued;
    console.log(`  batch ${i + 1}: enqueued=${enqueue.enqueued} drained=${enqueue.drained}`);
    if (enqueue.drained) break;
    await sleep(options.throttleMs);
  }

  const status = await postAdmin<StatusResponse>(options, '/admin/backfill/status', { runId });
  printSummary(`Run id=${runId} totalEnqueuedThisCall=${totalEnqueued} final state`, status.run);
}

async function main(): Promise<void> {
  const options = parseArgs();
  if (!Number.isFinite(options.max) || options.max <= 0) {
    throw new Error(`Invalid --max ${options.max}`);
  }
  if (!Number.isFinite(options.batchSize) || options.batchSize <= 0) {
    throw new Error(`Invalid --batch-size ${options.batchSize}`);
  }
  if (options.allowLocalHltv) {
    console.warn('--allow-local-hltv is ignored: this script never performs local HLTV acquisition by design.');
  }

  const candidates = options.resume ? [] : await loadCandidates(options.filter, options.max);
  if (options.listOnly) {
    if (options.json) {
      console.log(JSON.stringify({ filter: options.filter, candidates }, null, 2));
    } else {
      printPreflight(candidates, options);
      console.log('\nList-only mode: no run created. Re-run with --apply to start enqueueing.');
    }
    return;
  }

  if (!options.apply) {
    // --resume implies an existing runId; otherwise apply is required for new runs.
    if (!options.resume) {
      printPreflight(candidates, options);
      console.log('\nDry-run (default): not creating run. Re-run with --apply to start.');
      return;
    }
  }

  if (!options.resume) printPreflight(candidates, options);
  await runApplyFlow(candidates, options);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

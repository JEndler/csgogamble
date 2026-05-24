import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { queryD1, toNumber } from './ops-utils';

type Phase = 'gamma' | 'price-history';
type MarketType =
  | 'match_winner'
  | 'map_winner'
  | 'total_maps'
  | 'map_handicap'
  | 'outright'
  | 'player_prop'
  | 'other'
  | 'unknown';

interface GammaResult {
  ok: true;
  runId: number;
  nextCursor: string | null;
  nextPageIndex: number;
  done: boolean;
  pagesFetched: number;
  eventsSeen: number;
  marketsSeen: number;
  outcomesSeen: number;
  errors: Array<{ message: string; stage?: string; status?: number | null; errorClass?: string }>;
}

interface PriceHistoryResult {
  ok: true;
  runId: number;
  requested: number;
  manifestsWritten: number;
  pointsRecorded: number;
  emptyResponses: number;
  errors: Array<{ tokenId: string; message: string; status?: number | null; errorClass?: string }>;
}

interface GammaCheckpoint {
  phase: 'gamma';
  runId?: number;
  cursor: string | null;
  pageIndex: number;
  closed?: boolean;
  archived?: boolean;
  pageLimit: number;
  maxPagesPerCall: number;
  calls: number;
  startedAt: string;
  updatedAt: string;
  done: boolean;
  totals: {
    pagesFetched: number;
    eventsSeen: number;
    marketsSeen: number;
    outcomesSeen: number;
  };
}

interface PriceCheckpoint {
  phase: 'price-history';
  runId?: number;
  marketType: MarketType;
  interval: string;
  fidelityMinutes: number;
  batchSize: number;
  calls: number;
  startedAt: string;
  updatedAt: string;
  requested: number;
  manifestsWritten: number;
  pointsRecorded: number;
  emptyResponses: number;
  errors: number;
}

interface Args {
  phase: Phase;
  apply: boolean;
  closed?: boolean;
  archived?: boolean;
  pageLimit: number;
  maxPagesPerCall: number;
  marketType: MarketType;
  interval: string;
  fidelity: number;
  batchSize: number;
  throttleMs: number;
  maxCalls: number;
  checkpoint: string;
  startTs?: number;
  endTs?: number;
}

function loadDotEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed
      .slice(0, separator)
      .trim()
      .replace(/^export\s+/, '');
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    process.env[key] = process.env[key] ?? value;
  }
}

function loadEnv(): void {
  loadDotEnvFile('.env');
  loadDotEnvFile('.dev.vars');
  process.env.CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN;
  process.env.CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID;
}

function parseFlag(args: string[], name: string): string | null {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

function numberFlag(args: string[], name: string, fallback: number): number {
  const raw = parseFlag(args, name);
  const value = raw === null ? fallback : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function booleanFlag(args: string[], name: string): boolean | undefined {
  const raw = parseFlag(args, name);
  if (raw === null) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const phase = (parseFlag(argv, '--phase') ?? 'gamma') as Phase;
  if (phase !== 'gamma' && phase !== 'price-history') throw new Error(`Unsupported --phase ${phase}`);
  const defaultCheckpoint =
    phase === 'gamma'
      ? `.polymarket-backfill/gamma-closed=${parseFlag(argv, '--closed') ?? 'true'}-archived=${parseFlag(argv, '--archived') ?? 'false'}.json`
      : `.polymarket-backfill/price-history-${parseFlag(argv, '--market-type') ?? 'match_winner'}-${parseFlag(argv, '--interval') ?? '1h'}-fidelity=${parseFlag(argv, '--fidelity') ?? '60'}.json`;
  return {
    phase,
    apply: argv.includes('--apply'),
    closed: booleanFlag(argv, '--closed'),
    archived: booleanFlag(argv, '--archived'),
    pageLimit: numberFlag(argv, '--page-limit', 500),
    maxPagesPerCall: numberFlag(argv, '--max-pages-per-call', 10),
    marketType: (parseFlag(argv, '--market-type') ?? 'match_winner') as MarketType,
    interval: parseFlag(argv, '--interval') ?? '1h',
    fidelity: numberFlag(argv, '--fidelity', 60),
    batchSize: numberFlag(argv, '--batch-size', 100),
    throttleMs: numberFlag(argv, '--throttle-ms', 1000),
    maxCalls: numberFlag(argv, '--max-calls', Number.POSITIVE_INFINITY),
    checkpoint: parseFlag(argv, '--checkpoint') ?? defaultCheckpoint,
    startTs: parseFlag(argv, '--start-ts') === null ? undefined : numberFlag(argv, '--start-ts', 0),
    endTs: parseFlag(argv, '--end-ts') === null ? undefined : numberFlag(argv, '--end-ts', 0),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureCheckpointDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function writeJson(path: string, value: unknown): void {
  ensureCheckpointDir(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const seconds = Math.round(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h${m}m${s}s` : m > 0 ? `${m}m${s}s` : `${s}s`;
}

async function invokeWorker<T>(path: string, body?: unknown): Promise<T> {
  const workerUrl = process.env.WORKER_URL;
  const adminToken = process.env.ADMIN_TOKEN;
  if (!workerUrl) throw new Error('WORKER_URL is required in .env');
  if (!adminToken) throw new Error('ADMIN_TOKEN is required in .env');
  const response = await fetch(new URL(path, workerUrl).toString(), {
    method: path.endsWith('/status') ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-token': adminToken,
    },
    body: path.endsWith('/status') ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Worker ${response.status}: ${JSON.stringify(parsed)}`);
  return parsed as T;
}

function logProgress(message: string, fields: Record<string, unknown> = {}): void {
  const suffix = Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
  process.stdout.write(`${nowIso()} ${message}${suffix ? ` ${suffix}` : ''}\n`);
}

async function countPriceCandidates(args: Args): Promise<{ total: number; done: number; remaining: number }> {
  const totalRows = await queryD1(
    `SELECT COUNT(DISTINCT o.token_id) AS count
       FROM polymarket_outcomes o
       JOIN polymarket_markets m ON m.id = o.market_id
      WHERE o.token_id IS NOT NULL
        AND m.market_type = '${args.marketType.replace(/'/g, "''")}'`,
    (row) => ({ count: toNumber(row.count) }),
  );
  const doneRows = await queryD1(
    `SELECT COUNT(DISTINCT token_id) AS count
       FROM polymarket_price_history_manifests
      WHERE interval = '${args.interval.replace(/'/g, "''")}'
        AND COALESCE(fidelity_minutes, -1) = ${Math.trunc(args.fidelity)}
        AND COALESCE(start_ts, '') = ${args.startTs === undefined ? "''" : `'${String(args.startTs)}'`}
        AND COALESCE(end_ts, '') = ${args.endTs === undefined ? "''" : `'${String(args.endTs)}'`}`,
    (row) => ({ count: toNumber(row.count) }),
  );
  const total = totalRows[0]?.count ?? 0;
  const done = doneRows[0]?.count ?? 0;
  return { total, done, remaining: Math.max(0, total - done) };
}

async function runGamma(args: Args): Promise<void> {
  const started = Date.now();
  let checkpoint = readJson<GammaCheckpoint>(args.checkpoint) ?? {
    phase: 'gamma' as const,
    cursor: null,
    pageIndex: 0,
    closed: args.closed,
    archived: args.archived,
    pageLimit: args.pageLimit,
    maxPagesPerCall: args.maxPagesPerCall,
    calls: 0,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    done: false,
    totals: { pagesFetched: 0, eventsSeen: 0, marketsSeen: 0, outcomesSeen: 0 },
  };

  if (!args.apply) {
    logProgress('DRY-RUN gamma', { checkpoint: args.checkpoint, cursor: checkpoint.cursor ?? 'null' });
    return;
  }

  let consecutiveFailures = 0;
  while (!checkpoint.done && checkpoint.calls < args.maxCalls) {
    const before = Date.now();
    try {
      const result = await invokeWorker<GammaResult>('/admin/polymarket/gamma/run', {
        runId: checkpoint.runId,
        cursor: checkpoint.cursor,
        offset: checkpoint.pageIndex * checkpoint.pageLimit,
        pagination: 'offset',
        pageIndex: checkpoint.pageIndex,
        maxPages: checkpoint.maxPagesPerCall,
        pageLimit: checkpoint.pageLimit,
        closed: checkpoint.closed,
        archived: checkpoint.archived,
      });
      consecutiveFailures = 0;
      checkpoint = {
        ...checkpoint,
        runId: result.runId,
        cursor: result.nextCursor,
        pageIndex: result.nextPageIndex,
        calls: checkpoint.calls + 1,
        updatedAt: nowIso(),
        done: result.done,
        totals: {
          pagesFetched: checkpoint.totals.pagesFetched + result.pagesFetched,
          eventsSeen: checkpoint.totals.eventsSeen + result.eventsSeen,
          marketsSeen: checkpoint.totals.marketsSeen + result.marketsSeen,
          outcomesSeen: checkpoint.totals.outcomesSeen + result.outcomesSeen,
        },
      };
      writeJson(args.checkpoint, checkpoint);
      const elapsed = Date.now() - started;
      const pagesPerMin = checkpoint.totals.pagesFetched / Math.max(elapsed / 60000, 0.001);
      logProgress('gamma-batch', {
        runId: checkpoint.runId,
        call: checkpoint.calls,
        pages: result.pagesFetched,
        totalPages: checkpoint.totals.pagesFetched,
        events: checkpoint.totals.eventsSeen,
        markets: checkpoint.totals.marketsSeen,
        errors: result.errors.length,
        batchSec: ((Date.now() - before) / 1000).toFixed(1),
        pagesPerMin: pagesPerMin.toFixed(1),
        done: checkpoint.done,
      });
      if (result.errors.length > 0) throw new Error(`Worker returned ${result.errors.length} gamma errors`);
      if (!checkpoint.done) await sleep(args.throttleMs);
    } catch (error) {
      consecutiveFailures += 1;
      const backoff = Math.min(60000, 2000 * 2 ** consecutiveFailures);
      logProgress('gamma-error', {
        failures: consecutiveFailures,
        backoffMs: backoff,
        message: error instanceof Error ? error.message : String(error),
      });
      if (consecutiveFailures >= 5) throw error;
      await sleep(backoff);
    }
  }
  logProgress('gamma-finished-or-paused', {
    done: checkpoint.done,
    calls: checkpoint.calls,
    pages: checkpoint.totals.pagesFetched,
    events: checkpoint.totals.eventsSeen,
    markets: checkpoint.totals.marketsSeen,
    elapsed: formatDuration(Date.now() - started),
    checkpoint: args.checkpoint,
  });
}

async function runPriceHistory(args: Args): Promise<void> {
  const started = Date.now();
  let checkpoint = readJson<PriceCheckpoint>(args.checkpoint) ?? {
    phase: 'price-history' as const,
    marketType: args.marketType,
    interval: args.interval,
    fidelityMinutes: args.fidelity,
    batchSize: args.batchSize,
    calls: 0,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    requested: 0,
    manifestsWritten: 0,
    pointsRecorded: 0,
    emptyResponses: 0,
    errors: 0,
  };

  const initialCounts = await countPriceCandidates(args);
  if (!args.apply) {
    logProgress('DRY-RUN price-history', { checkpoint: args.checkpoint, ...initialCounts });
    return;
  }

  let consecutiveFailures = 0;
  while (checkpoint.calls < args.maxCalls) {
    const countsBefore = await countPriceCandidates(args);
    if (countsBefore.remaining <= 0) {
      logProgress('price-history-complete', countsBefore);
      break;
    }
    const before = Date.now();
    try {
      const result = await invokeWorker<PriceHistoryResult>('/admin/polymarket/price-history/run', {
        runId: checkpoint.runId,
        marketType: checkpoint.marketType,
        limit: checkpoint.batchSize,
        interval: checkpoint.interval,
        fidelityMinutes: checkpoint.fidelityMinutes,
        startTs: args.startTs,
        endTs: args.endTs,
        onlyMissing: true,
      });
      consecutiveFailures = 0;
      checkpoint = {
        ...checkpoint,
        runId: result.runId,
        calls: checkpoint.calls + 1,
        updatedAt: nowIso(),
        requested: checkpoint.requested + result.requested,
        manifestsWritten: checkpoint.manifestsWritten + result.manifestsWritten,
        pointsRecorded: checkpoint.pointsRecorded + result.pointsRecorded,
        emptyResponses: checkpoint.emptyResponses + result.emptyResponses,
        errors: checkpoint.errors + result.errors.length,
      };
      writeJson(args.checkpoint, checkpoint);
      const countsAfter = await countPriceCandidates(args);
      const elapsed = Date.now() - started;
      const completedThisRun = Math.max(0, initialCounts.remaining - countsAfter.remaining);
      const tokensPerMin = completedThisRun / Math.max(elapsed / 60000, 0.001);
      const etaMs = tokensPerMin > 0 ? (countsAfter.remaining / tokensPerMin) * 60000 : Number.NaN;
      logProgress('price-history-batch', {
        runId: checkpoint.runId,
        call: checkpoint.calls,
        requested: result.requested,
        written: result.manifestsWritten,
        remaining: countsAfter.remaining,
        done: countsAfter.done,
        total: countsAfter.total,
        points: checkpoint.pointsRecorded,
        empty: checkpoint.emptyResponses,
        errors: result.errors.length,
        batchSec: ((Date.now() - before) / 1000).toFixed(1),
        tokensPerMin: tokensPerMin.toFixed(1),
        eta: formatDuration(etaMs),
      });
      if (result.requested === 0 || (result.manifestsWritten === 0 && result.errors.length === 0)) break;
      if (result.errors.length > 0 && result.manifestsWritten === 0)
        throw new Error(`All price-history requests failed`);
      await sleep(args.throttleMs);
    } catch (error) {
      consecutiveFailures += 1;
      const backoff = Math.min(60000, 2000 * 2 ** consecutiveFailures);
      logProgress('price-history-error', {
        failures: consecutiveFailures,
        backoffMs: backoff,
        message: error instanceof Error ? error.message : String(error),
      });
      if (consecutiveFailures >= 5) throw error;
      await sleep(backoff);
    }
  }
}

async function main(): Promise<void> {
  loadEnv();
  const args = parseArgs();
  logProgress('polymarket-backfill-start', {
    phase: args.phase,
    apply: args.apply,
    checkpoint: args.checkpoint,
    maxCalls: Number.isFinite(args.maxCalls) ? args.maxCalls : 'inf',
  });
  if (args.phase === 'gamma') await runGamma(args);
  else await runPriceHistory(args);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

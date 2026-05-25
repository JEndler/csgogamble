const DEFAULT_START_DATE = '2025-09-24';
const DEFAULT_END_DATE = '2026-01-16';
const DEFAULT_MARKET_TYPE = 'match_winner';
const DEFAULT_HLTV_BASE_URL = 'https://www.hltv.org';
const DEFAULT_ACQUISITION_MODE = 'http-stealth';
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_POLL_MAX = 1;
const DEFAULT_THROTTLE_MS = 3_000;
const DEFAULT_SHARD_DAYS = 1;
const DEFAULT_MAX_MATCHES_PER_SHARD = 500;

export interface DateShard {
  startDate: string;
  endDate: string;
}

export interface OffsetShard {
  offset: number;
}

export interface MatchCandidate {
  matchId: number;
  sourceUrl: string;
}

export interface HistoricalOverlapOptions {
  apply: boolean;
  resume: boolean;
  discoverOnly: boolean;
  createOnly: boolean;
  includeExisting: boolean;
  json: boolean;
  startDate: string;
  endDate: string;
  marketType: string;
  shardDays: number;
  maxMatchesPerShard: number;
  shardMode: 'date' | 'offset';
  offsetStart: number;
  offsetEnd: number;
  offsetStep: number;
  hltvBaseUrl: string;
  workerUrl: string | null;
  adminToken: string | null;
  acquisitionMode:
    | 'http'
    | 'http-stealth'
    | 'browser'
    | 'browser-native'
    | 'browser-stealth'
    | 'browser-session'
    | 'browser-session-stealth';
  browserSessionKey: string | null;
  batchSize: number;
  pollMax: number;
  throttleMs: number;
  checkpoint: string;
  runId: number | null;
  maxShards: number | null;
}

function readValue(args: string[], name: string): string | null {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

function readPositiveInteger(args: string[], name: string, fallback: number): number {
  const raw = readValue(args, name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer, got ${raw}`);
  return value;
}

function readOptionalPositiveInteger(args: string[], name: string): number | null {
  const raw = readValue(args, name);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer, got ${raw}`);
  return value;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function assertDateString(value: string, name: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be YYYY-MM-DD, got ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || isoDate(date) !== value) throw new Error(`${name} is not a valid date: ${value}`);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function buildDateShards(startDate: string, endDate: string, shardDays: number): DateShard[] {
  assertDateString(startDate, '--start-date');
  assertDateString(endDate, '--end-date');
  if (!Number.isInteger(shardDays) || shardDays <= 0) throw new Error(`shardDays must be positive, got ${shardDays}`);
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (start > end) throw new Error(`--start-date must be <= --end-date (${startDate} > ${endDate})`);
  const shards: DateShard[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, shardDays)) {
    const shardEnd = addDays(cursor, shardDays - 1);
    shards.push({ startDate: isoDate(cursor), endDate: isoDate(shardEnd > end ? end : shardEnd) });
  }
  return shards;
}

export function buildOffsetShards(offsetStart: number, offsetEnd: number, offsetStep: number): OffsetShard[] {
  for (const [name, value] of [
    ['offsetStart', offsetStart],
    ['offsetEnd', offsetEnd],
    ['offsetStep', offsetStep],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer, got ${value}`);
  }
  if (offsetStep <= 0) throw new Error(`offsetStep must be positive, got ${offsetStep}`);
  if (offsetStart > offsetEnd) throw new Error(`offsetStart must be <= offsetEnd (${offsetStart} > ${offsetEnd})`);
  const shards: OffsetShard[] = [];
  for (let offset = offsetStart; offset <= offsetEnd; offset += offsetStep) shards.push({ offset });
  return shards;
}

export function buildResultsPageUrl(hltvBaseUrl: string, shard: DateShard): string {
  const url = new URL('/results', hltvBaseUrl.replace(/\/$/, ''));
  url.searchParams.set('startDate', shard.startDate);
  url.searchParams.set('endDate', shard.endDate);
  return url.toString();
}

export function extractMatchCandidate(matchUrl: string): MatchCandidate | null {
  const match = matchUrl.match(/\/matches\/(\d+)\//);
  if (!match?.[1]) return null;
  const matchId = Number(match[1]);
  if (!Number.isInteger(matchId) || matchId <= 0) return null;
  return { matchId, sourceUrl: matchUrl };
}

export function selectCandidatesToBackfill(
  candidates: MatchCandidate[],
  existingStatuses: Map<number, string | null>,
  includeExisting: boolean,
): MatchCandidate[] {
  if (includeExisting) return candidates;
  return candidates.filter((candidate) => existingStatuses.get(candidate.matchId) !== 'parsed');
}

function defaultCheckpoint(startDate: string, endDate: string, marketType: string): string {
  return `.hltv-overlap/${marketType}-${startDate.replace(/-/g, '')}-${endDate.replace(/-/g, '')}.json`;
}

export function parseHistoricalOverlapArgs(
  argv = process.argv.slice(2),
  env: Partial<NodeJS.ProcessEnv> = process.env,
): HistoricalOverlapOptions {
  const startDate = readValue(argv, '--start-date') ?? DEFAULT_START_DATE;
  const endDate = readValue(argv, '--end-date') ?? DEFAULT_END_DATE;
  const marketType = readValue(argv, '--market-type') ?? DEFAULT_MARKET_TYPE;
  assertDateString(startDate, '--start-date');
  assertDateString(endDate, '--end-date');
  return {
    apply: argv.includes('--apply'),
    resume: argv.includes('--resume'),
    discoverOnly: argv.includes('--discover-only'),
    createOnly: argv.includes('--create-only'),
    includeExisting: argv.includes('--include-existing'),
    json: argv.includes('--json'),
    startDate,
    endDate,
    marketType,
    shardDays: readPositiveInteger(argv, '--shard-days', DEFAULT_SHARD_DAYS),
    maxMatchesPerShard: readPositiveInteger(argv, '--max-matches-per-shard', DEFAULT_MAX_MATCHES_PER_SHARD),
    shardMode: readValue(argv, '--shard-mode') === 'offset' ? 'offset' : 'date',
    offsetStart: readPositiveInteger(argv, '--offset-start', 0),
    offsetEnd: readPositiveInteger(argv, '--offset-end', 0),
    offsetStep: readPositiveInteger(argv, '--offset-step', 100),
    hltvBaseUrl: readValue(argv, '--hltv-base-url') ?? DEFAULT_HLTV_BASE_URL,
    workerUrl: readValue(argv, '--worker-url') ?? env.WORKER_URL ?? null,
    adminToken: readValue(argv, '--admin-token') ?? env.ADMIN_TOKEN ?? null,
    acquisitionMode:
      (readValue(argv, '--acquisition-mode') as HistoricalOverlapOptions['acquisitionMode'] | null) ??
      DEFAULT_ACQUISITION_MODE,
    browserSessionKey: readValue(argv, '--browser-session-key'),
    batchSize: readPositiveInteger(argv, '--batch-size', DEFAULT_BATCH_SIZE),
    pollMax: readPositiveInteger(argv, '--poll-max', DEFAULT_POLL_MAX),
    throttleMs: readPositiveInteger(argv, '--throttle-ms', DEFAULT_THROTTLE_MS),
    checkpoint: readValue(argv, '--checkpoint') ?? defaultCheckpoint(startDate, endDate, marketType),
    runId: readOptionalPositiveInteger(argv, '--run-id'),
    maxShards: readOptionalPositiveInteger(argv, '--max-shards'),
  };
}

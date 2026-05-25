import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildDateShards,
  buildOffsetShards,
  buildResultsPageUrl,
  type DateShard,
  extractMatchCandidate,
  type HistoricalOverlapOptions,
  type MatchCandidate,
  type OffsetShard,
  parseHistoricalOverlapArgs,
  selectCandidatesToBackfill,
} from './hltv-historical-overlap-core';
import { loadCloudflareEnv, queryD1, toNullableString, toNumber } from './ops-utils';

const MAX_D1_IN_LIST = 90;

type ResultsShard = DateShard | OffsetShard;

interface CheckpointShard {
  startDate?: string;
  endDate?: string;
  offset?: number;
  pageUrl: string;
  discovered: number;
  candidates: MatchCandidate[];
  discoveredAt: string;
}

interface CheckpointFile {
  version: 1;
  startDate: string;
  endDate: string;
  marketType: string;
  runId: number | null;
  shards: CheckpointShard[];
  createdAt: string;
  updatedAt: string;
}

interface DiscoverResponse {
  ok: true;
  pageUrl: string;
  discovered: number;
  matchUrls: string[];
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
  inFlight?: number;
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

interface StatusResponse {
  ok: true;
  run: BackfillRunStatus;
}

function nowIso(): string {
  return new Date().toISOString();
}

function readCheckpoint(options: HistoricalOverlapOptions): CheckpointFile {
  if (existsSync(options.checkpoint)) {
    return JSON.parse(readFileSync(options.checkpoint, 'utf8')) as CheckpointFile;
  }
  const timestamp = nowIso();
  return {
    version: 1,
    startDate: options.startDate,
    endDate: options.endDate,
    marketType: options.marketType,
    runId: null,
    shards: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function writeCheckpoint(path: string, checkpoint: CheckpointFile): void {
  mkdirSync(dirname(path), { recursive: true });
  checkpoint.updatedAt = nowIso();
  writeFileSync(path, `${JSON.stringify(checkpoint, null, 2)}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson<T>(url: string, body: Record<string, unknown>, adminToken?: string | null): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(adminToken ? { 'x-admin-token': adminToken } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST ${url} failed ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

function buildShardPageUrl(options: HistoricalOverlapOptions, shard: ResultsShard): string {
  if ('offset' in shard) {
    const url = new URL('/results', options.hltvBaseUrl.replace(/\/$/, ''));
    url.searchParams.set('offset', String(shard.offset));
    return url.toString();
  }
  return buildResultsPageUrl(options.hltvBaseUrl, shard);
}

function shardLabel(shard: ResultsShard): string {
  return 'offset' in shard ? `offset=${shard.offset}` : `${shard.startDate}..${shard.endDate}`;
}

async function discoverShard(options: HistoricalOverlapOptions, shard: ResultsShard): Promise<CheckpointShard> {
  if (!options.workerUrl) throw new Error('--worker-url or WORKER_URL is required for remote discovery');
  const pageUrl = buildShardPageUrl(options, shard);
  const response = await postJson<DiscoverResponse>(`${options.workerUrl.replace(/\/$/, '')}/discover/results`, {
    pageUrl,
    acquisitionMode: options.acquisitionMode,
    browserSessionKey: options.browserSessionKey ?? `hltv-overlap-${shardLabel(shard).replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    maxMatches: options.maxMatchesPerShard,
  });
  const candidates = response.matchUrls
    .map(extractMatchCandidate)
    .filter((candidate): candidate is MatchCandidate => candidate !== null);
  return { ...shard, pageUrl, discovered: response.discovered, candidates, discoveredAt: nowIso() };
}

function dedupeCandidates(candidates: MatchCandidate[]): MatchCandidate[] {
  return Array.from(new Map(candidates.map((candidate) => [candidate.matchId, candidate])).values()).sort(
    (left, right) => left.matchId - right.matchId,
  );
}

async function loadExistingStatuses(matchIds: number[]): Promise<Map<number, string | null>> {
  const statuses = new Map<number, string | null>();
  for (let index = 0; index < matchIds.length; index += MAX_D1_IN_LIST) {
    const chunk = matchIds.slice(index, index + MAX_D1_IN_LIST);
    if (chunk.length === 0) continue;
    // biome-ignore lint/performance/noAwaitInLoops: D1 IN chunks must stay small and ordered for ops output.
    const rows = await queryD1(
      `SELECT hltv_match_id, status FROM matches WHERE hltv_match_id IN (${chunk.join(',')});`,
      (row) => ({ matchId: toNumber(row.hltv_match_id), status: toNullableString(row.status) }),
    );
    for (const row of rows) statuses.set(row.matchId, row.status);
  }
  return statuses;
}

async function startBackfillRun(
  options: HistoricalOverlapOptions,
  candidates: MatchCandidate[],
): Promise<StartResponse> {
  if (!options.workerUrl || !options.adminToken) throw new Error('WORKER_URL and ADMIN_TOKEN are required for --apply');
  return postJson<StartResponse>(
    `${options.workerUrl.replace(/\/$/, '')}/admin/backfill/start`,
    {
      candidates: candidates.map((candidate) => ({ matchId: candidate.matchId, sourceUrl: candidate.sourceUrl })),
      candidateFilter: `historical-overlap:polymarket:${options.marketType}:${options.startDate}..${options.endDate}`,
      options: {
        startDate: options.startDate,
        endDate: options.endDate,
        marketType: options.marketType,
        source: 'hltv-historical-overlap',
        acquisitionMode: options.acquisitionMode,
        checkpoint: options.checkpoint,
      },
    },
    options.adminToken,
  );
}

async function enqueueOnce(options: HistoricalOverlapOptions, runId: number): Promise<EnqueueResponse> {
  if (!options.workerUrl || !options.adminToken) throw new Error('WORKER_URL and ADMIN_TOKEN are required for --apply');
  return postJson<EnqueueResponse>(
    `${options.workerUrl.replace(/\/$/, '')}/admin/backfill/enqueue`,
    {
      runId,
      batchSize: options.batchSize,
      acquisitionMode: options.acquisitionMode,
      browserSessionKey: options.browserSessionKey ?? `hltv-overlap-${runId}`,
      source: `backfill:${runId}:historical-overlap`,
    },
    options.adminToken,
  );
}

async function getStatus(options: HistoricalOverlapOptions, runId: number): Promise<BackfillRunStatus> {
  if (!options.workerUrl || !options.adminToken) throw new Error('WORKER_URL and ADMIN_TOKEN are required for --apply');
  const response = await postJson<StatusResponse>(
    `${options.workerUrl.replace(/\/$/, '')}/admin/backfill/status`,
    { runId },
    options.adminToken,
  );
  return response.run;
}

async function discoverAll(options: HistoricalOverlapOptions, checkpoint: CheckpointFile): Promise<MatchCandidate[]> {
  const done = new Set(checkpoint.shards.map((shard) => shard.pageUrl));
  const allShards: ResultsShard[] =
    options.shardMode === 'offset'
      ? buildOffsetShards(options.offsetStart, options.offsetEnd, options.offsetStep)
      : buildDateShards(options.startDate, options.endDate, options.shardDays);
  let shards = allShards.filter((shard) => !done.has(buildShardPageUrl(options, shard)));
  if (options.maxShards !== null) shards = shards.slice(0, options.maxShards);

  for (const shard of shards) {
    // biome-ignore lint/performance/noAwaitInLoops: historical discovery is intentionally serialized to avoid source pressure.
    const discovered = await discoverShard(options, shard);
    checkpoint.shards.push(discovered);
    writeCheckpoint(options.checkpoint, checkpoint);
    console.error(`discovered shard ${shardLabel(shard)}: ${discovered.candidates.length}/${discovered.discovered}`);
    if (options.throttleMs > 0) await sleep(options.throttleMs);
  }
  return dedupeCandidates(checkpoint.shards.flatMap((shard) => shard.candidates));
}

function printStatus(status: BackfillRunStatus): void {
  console.log(
    `run=${status.id} status=${status.status} total=${status.totalCandidates} enqueued=${status.enqueued} parsed=${status.parsed} partial=${status.partial} challenge=${status.challenge} failed=${status.failedClassified} skipped=${status.skipped}`,
  );
}

async function resumeRun(options: HistoricalOverlapOptions, runId: number): Promise<BackfillRunStatus> {
  let finalStatus = await getStatus(options, runId);
  for (let index = 0; index < options.pollMax; index += 1) {
    if (finalStatus.status === 'completed') break;
    // biome-ignore lint/performance/noAwaitInLoops: enqueue pacing is deliberate.
    const enqueue = await enqueueOnce(options, runId);
    console.error(`enqueue ${index + 1}/${options.pollMax}: enqueued=${enqueue.enqueued} drained=${enqueue.drained}`);
    finalStatus = await getStatus(options, runId);
    if (enqueue.drained) break;
    if (options.throttleMs > 0 && index < options.pollMax - 1) await sleep(options.throttleMs);
  }
  return finalStatus;
}

async function main(): Promise<void> {
  const options = parseHistoricalOverlapArgs(process.argv.slice(2), loadCloudflareEnv());
  const checkpoint = readCheckpoint(options);

  if (options.resume) {
    const runId = options.runId ?? checkpoint.runId;
    if (!runId) throw new Error('--resume requires --run-id or checkpoint.runId');
    const status = options.apply ? await resumeRun(options, runId) : await getStatus(options, runId);
    printStatus(status);
    return;
  }

  const discovered = await discoverAll(options, checkpoint);
  const existing = await loadExistingStatuses(discovered.map((candidate) => candidate.matchId));
  const candidates = selectCandidatesToBackfill(discovered, existing, options.includeExisting);
  console.log(
    JSON.stringify(
      {
        apply: options.apply,
        startDate: options.startDate,
        endDate: options.endDate,
        marketType: options.marketType,
        shardMode: options.shardMode,
        shards: checkpoint.shards.length,
        discoveredCandidates: discovered.length,
        existingParsed: [...existing.values()].filter((status) => status === 'parsed').length,
        selectedCandidates: candidates.length,
        checkpoint: options.checkpoint,
        runId: checkpoint.runId,
      },
      null,
      2,
    ),
  );

  if (options.discoverOnly || !options.apply) return;
  if (candidates.length === 0) throw new Error('No candidates selected for backfill');

  let runId = checkpoint.runId;
  if (!runId) {
    const start = await startBackfillRun(options, candidates);
    runId = start.runId;
    checkpoint.runId = runId;
    writeCheckpoint(options.checkpoint, checkpoint);
    console.error(`created historical overlap backfill run ${runId} candidates=${start.totalCandidates}`);
  }

  if (options.createOnly) {
    printStatus(await getStatus(options, runId));
    return;
  }

  const status = await resumeRun(options, runId);
  printStatus(status);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

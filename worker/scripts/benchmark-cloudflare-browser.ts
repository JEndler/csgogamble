import { performance } from 'node:perf_hooks';

const DEFAULT_MAX_MATCHES = 100;
const DEFAULT_WORKER_URL = 'http://127.0.0.1:8787';

type AcquisitionMode = 'browser' | 'browser-session';

interface DiscoverResultsResponse {
  ok: true;
  pageUrl: string;
  discovered: number;
  matchUrls: string[];
}

interface IngestMatchResponse {
  ok: true;
  notes: string[];
}

interface BrowserSessionCloseResponse {
  ok: true;
  sessionKey: string;
}

interface RunOptions {
  workerUrl: string;
  maxMatches: number;
  persistValidationHtml: boolean;
  coldLaunchDelayMs: number;
}

interface SampleSummary {
  totalMs: number;
  averageMs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

interface IngestRunResult {
  mode: AcquisitionMode;
  sessionKey?: string;
  persistHtml: boolean;
  success: number;
  failed: number;
  samplesMs: number[];
  summary: SampleSummary;
}

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  const options: RunOptions = {
    workerUrl: DEFAULT_WORKER_URL,
    maxMatches: DEFAULT_MAX_MATCHES,
    persistValidationHtml: true,
    coldLaunchDelayMs: 1_100,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--worker-url' && args[index + 1]) {
      const nextValue = args[index + 1];
      if (nextValue) {
        options.workerUrl = nextValue;
      }
      index += 1;
      continue;
    }
    if (arg === '--max' && args[index + 1]) {
      const nextValue = args[index + 1];
      if (nextValue) {
        options.maxMatches = Number.parseInt(nextValue, 10);
      }
      index += 1;
      continue;
    }
    if (arg === '--no-persist-validation-html') {
      options.persistValidationHtml = false;
      continue;
    }
    if (arg === '--cold-launch-delay-ms' && args[index + 1]) {
      const nextValue = args[index + 1];
      if (nextValue) {
        options.coldLaunchDelayMs = Number.parseInt(nextValue, 10);
      }
      index += 1;
    }
  }

  return options;
}

async function postJson<TResponse>(url: string, body: unknown): Promise<TResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }

  return JSON.parse(text) as TResponse;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeSamples(samplesMs: number[]): SampleSummary {
  const ordered = [...samplesMs].sort((a, b) => a - b);
  const totalMs = samplesMs.reduce((sum, sample) => sum + sample, 0);
  const percentile = (ratio: number): number => {
    if (ordered.length === 0) {
      return 0;
    }
    const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * ratio) - 1));
    return ordered[index] ?? 0;
  };

  return {
    totalMs,
    averageMs: ordered.length === 0 ? 0 : totalMs / ordered.length,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    minMs: ordered[0] ?? 0,
    maxMs: ordered.at(-1) ?? 0,
  };
}

async function discoverMatchUrls(workerUrl: string, maxMatches: number, sessionKey: string): Promise<string[]> {
  const response = await postJson<DiscoverResultsResponse>(`${workerUrl}/discover/results`, {
    acquisitionMode: 'browser-session',
    browserSessionKey: sessionKey,
  });

  return response.matchUrls.slice(0, maxMatches);
}

async function ingestMatches(
  workerUrl: string,
  matchUrls: string[],
  mode: AcquisitionMode,
  persistHtml: boolean,
  sessionKey?: string,
  launchDelayMs = 0,
): Promise<IngestRunResult> {
  let success = 0;
  let failed = 0;
  const samplesMs: number[] = [];

  for (let index = 0; index < matchUrls.length; index += 1) {
    const matchUrl = matchUrls[index];
    if (!matchUrl) {
      failed += 1;
      continue;
    }
    if (launchDelayMs > 0 && index > 0) {
      await sleep(launchDelayMs);
    }
    const startedAt = performance.now();
    try {
      await postJson<IngestMatchResponse>(`${workerUrl}/ingest/match`, {
        matchUrl,
        acquisitionMode: mode,
        browserSessionKey: sessionKey,
        persistHtml,
      });
      success += 1;
    } catch (error) {
      failed += 1;
      console.error(`[${mode}] FAIL ${index + 1}/${matchUrls.length} ${matchUrl}:`, error);
    } finally {
      samplesMs.push(performance.now() - startedAt);
      console.log(`[${mode}] ${index + 1}/${matchUrls.length} ${matchUrl}`);
    }
  }

  return {
    mode,
    sessionKey,
    persistHtml,
    success,
    failed,
    samplesMs,
    summary: summarizeSamples(samplesMs),
  };
}

async function closeSession(workerUrl: string, sessionKey: string): Promise<void> {
  try {
    const response = await postJson<BrowserSessionCloseResponse>(`${workerUrl}/debug/browser/session/close`, {
      sessionKey,
    });
    console.log(`Closed browser session ${response.sessionKey}`);
  } catch (error) {
    console.warn(`Could not close session ${sessionKey}:`, error);
  }
}

function formatMs(value: number): string {
  return `${value.toFixed(0)}ms`;
}

async function main(): Promise<void> {
  const options = parseArgs();
  const workerUrl = options.workerUrl.replace(/\/$/, '');

  console.log(`Worker URL: ${workerUrl}`);
  console.log(`Requested match count: ${options.maxMatches}`);
  console.log(`Cold launch pacing: ${options.coldLaunchDelayMs}ms`);

  const discoverySessionKey = `discover-${Date.now()}`;
  const matchUrls = await discoverMatchUrls(workerUrl, options.maxMatches, discoverySessionKey);
  await closeSession(workerUrl, discoverySessionKey);

  if (matchUrls.length === 0) {
    throw new Error('No match URLs discovered.');
  }

  console.log(`Discovered ${matchUrls.length} match URLs.`);

  const validationSessionKey = `validate-${Date.now()}`;
  console.log('\nValidation run: browser-session with actual persistence');
  const validationRun = await ingestMatches(
    workerUrl,
    matchUrls,
    'browser-session',
    options.persistValidationHtml,
    validationSessionKey,
  );
  await closeSession(workerUrl, validationSessionKey);

  const coldRun = await ingestMatches(workerUrl, matchUrls, 'browser', false, undefined, options.coldLaunchDelayMs);

  const benchmarkSessionKey = `benchmark-${Date.now()}`;
  const warmRun = await ingestMatches(workerUrl, matchUrls, 'browser-session', false, benchmarkSessionKey);
  await closeSession(workerUrl, benchmarkSessionKey);

  const report = {
    workerUrl,
    matchesTested: matchUrls.length,
    coldLaunchDelayMs: options.coldLaunchDelayMs,
    validation: validationRun,
    benchmark: {
      cold: coldRun,
      reused: warmRun,
      deltaMs: coldRun.summary.totalMs - warmRun.summary.totalMs,
      speedupRatio:
        warmRun.summary.totalMs === 0 ? null : Number((coldRun.summary.totalMs / warmRun.summary.totalMs).toFixed(2)),
    },
  };

  console.log('\nSummary');
  console.log(`Validation success: ${validationRun.success}/${matchUrls.length}`);
  console.log(
    `Cold total: ${formatMs(coldRun.summary.totalMs)} | avg ${formatMs(coldRun.summary.averageMs)} | p95 ${formatMs(coldRun.summary.p95Ms)}`,
  );
  console.log(
    `Reused total: ${formatMs(warmRun.summary.totalMs)} | avg ${formatMs(warmRun.summary.averageMs)} | p95 ${formatMs(warmRun.summary.p95Ms)}`,
  );
  console.log(
    `Speedup: ${report.benchmark.speedupRatio ?? 'n/a'}x (${formatMs(report.benchmark.deltaMs)} saved over ${matchUrls.length} pages)`,
  );

  console.log('\nJSON report');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

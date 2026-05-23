import {
  buildStaleClosedMessage,
  nextStaleClosedStatus,
  type ParsedThreshold,
  parseThresholdHours,
} from './close-stale-runs-core';
import { executeD1, queryD1, sqlString, toNullableString, toNumber } from './ops-utils';

interface Options {
  apply: boolean;
  thresholdHours: number;
  json: boolean;
  limit: number;
}

interface StaleRunRow {
  id: number;
  scope: string | null;
  target: string | null;
  status: string | null;
  message: string | null;
  createdAt: string | null;
  ageHours: number;
}

interface CountByScopeRow {
  scope: string;
  status: string;
  matches: number;
}

const DEFAULT_THRESHOLD_HOURS = 2;
const DEFAULT_LIMIT = 100;

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
    apply: args.includes('--apply'),
    json: args.includes('--json'),
    thresholdHours: Number(getValue('--threshold-hours') ?? DEFAULT_THRESHOLD_HOURS),
    limit: Number(getValue('--limit') ?? DEFAULT_LIMIT),
  };
}

async function loadCandidates(threshold: ParsedThreshold, limit: number): Promise<StaleRunRow[]> {
  return queryD1(
    `SELECT id, scope, target, status, message, created_at,
            ROUND((julianday('now') - julianday(created_at)) * 24, 2) AS age_hours
       FROM ingest_runs
      WHERE finished_at IS NULL
        AND created_at < datetime('now', '${threshold.modifier}')
      ORDER BY created_at
      LIMIT ${Math.floor(limit)};`,
    (row): StaleRunRow => ({
      id: toNumber(row.id),
      scope: toNullableString(row.scope),
      target: toNullableString(row.target),
      status: toNullableString(row.status),
      message: toNullableString(row.message),
      createdAt: toNullableString(row.created_at),
      ageHours: toNumber(row.age_hours),
    }),
  );
}

async function loadCountsByScope(threshold: ParsedThreshold): Promise<CountByScopeRow[]> {
  return queryD1(
    `SELECT COALESCE(scope, '<null>') AS scope,
            COALESCE(status, '<null>') AS status,
            COUNT(*) AS matches
       FROM ingest_runs
      WHERE finished_at IS NULL
        AND created_at < datetime('now', '${threshold.modifier}')
      GROUP BY scope, status
      ORDER BY matches DESC;`,
    (row): CountByScopeRow => ({
      scope: String(row.scope ?? ''),
      status: String(row.status ?? ''),
      matches: toNumber(row.matches),
    }),
  );
}

async function applyClosure(rows: StaleRunRow[]): Promise<void> {
  for (const row of rows) {
    const status = nextStaleClosedStatus(row.status);
    const message = buildStaleClosedMessage(row);
    // biome-ignore lint/performance/noAwaitInLoops: D1 wrangler exec must serialize.
    await executeD1(
      `UPDATE ingest_runs
          SET status = ${sqlString(status)},
              message = ${sqlString(message)},
              finished_at = datetime('now')
        WHERE id = ${row.id}
          AND finished_at IS NULL;`,
    );
  }
}

function printReport(rows: StaleRunRow[], counts: CountByScopeRow[], options: Options): void {
  console.log(
    `Stale ingest_runs (>=${options.thresholdHours}h old, unfinished): total=${rows.length} apply=${options.apply}`,
  );
  console.log('\nBy scope/status:');
  if (counts.length === 0) {
    console.log('  none');
  } else {
    for (const row of counts) {
      console.log(`  ${row.scope.padEnd(22)} ${row.status.padEnd(22)} ${row.matches}`);
    }
  }
  console.log('\nSamples:');
  const sampleLimit = Math.min(10, rows.length);
  for (let i = 0; i < sampleLimit; i++) {
    const row = rows[i];
    if (!row) continue;
    console.log(
      `  id=${row.id} scope=${row.scope ?? 'null'} status=${row.status ?? 'null'} age=${row.ageHours}h target=${row.target ?? 'null'}`,
    );
  }
  if (rows.length > sampleLimit) console.log(`  ... ${rows.length - sampleLimit} more`);
  if (!options.apply) {
    console.log('\nDry-run only. Re-run with --apply to close these rows.');
  } else {
    console.log('\nClosed rows: updated finished_at and rewrote status to stale_closed / skipped_stale_closed.');
  }
}

async function main(): Promise<void> {
  const options = parseArgs();
  let threshold: ParsedThreshold;
  try {
    threshold = parseThresholdHours(options.thresholdHours);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }
  if (!Number.isFinite(options.limit) || options.limit <= 0) {
    console.error(`Invalid limit: ${options.limit}`);
    process.exitCode = 2;
    return;
  }

  try {
    const [rows, counts] = await Promise.all([loadCandidates(threshold, options.limit), loadCountsByScope(threshold)]);

    if (options.apply && rows.length > 0) {
      await applyClosure(rows);
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            thresholdHours: threshold.hours,
            thresholdModifier: threshold.modifier,
            apply: options.apply,
            rows,
            counts,
          },
          null,
          2,
        ),
      );
    } else {
      printReport(rows, counts, options);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

// Only execute the CLI when this module is invoked directly, not when imported by tests.
const isMainModule = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const url = new URL(`file://${entry}`).href;
    return import.meta.url === url;
  } catch {
    return false;
  }
})();

if (isMainModule) {
  await main();
}

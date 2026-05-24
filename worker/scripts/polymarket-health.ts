import { queryD1 } from './ops-utils';

/**
 * Polymarket health/summary script.
 *
 * Reads the remote D1 database via wrangler and prints a small report of
 * polymarket_* table sizes plus classifier coverage breakdown. Handles
 * the pre-migration case (tables missing) gracefully so this can be run
 * before 0004 is applied.
 */

interface Options {
  json: boolean;
}

interface TableSummary {
  table: string;
  rowCount: number | null;
  missing: boolean;
}

interface TypeBreakdown {
  marketType: string;
  count: number;
}

interface CrawlRunSummary {
  recentRuns: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunType: string | null;
}

interface ManifestSummary {
  manifestCount: number;
  distinctTokens: number;
  pointsRecorded: number;
}

interface LinkSummary {
  candidateRows: number;
  marketsAutoLinked: number;
  marketsManualLinked: number;
}

interface Report {
  generatedAt: string;
  tables: TableSummary[];
  classification: TypeBreakdown[];
  crawlRuns: CrawlRunSummary | null;
  manifests: ManifestSummary | null;
  links: LinkSummary | null;
}

const POLYMARKET_TABLES = [
  'polymarket_crawl_runs',
  'polymarket_events',
  'polymarket_markets',
  'polymarket_outcomes',
  'polymarket_gamma_pages',
  'polymarket_hltv_link_candidates',
  'polymarket_price_history_manifests',
  'team_aliases',
];

function parseOptions(): Options {
  const args = process.argv.slice(2);
  return { json: args.includes('--json') };
}

async function tableRowCount(table: string): Promise<TableSummary> {
  try {
    const rows = await queryD1(`SELECT COUNT(*) AS count FROM ${table}`, (row) => Number(row.count ?? 0));
    return { table, rowCount: rows[0] ?? 0, missing: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table/i.test(message)) {
      return { table, rowCount: null, missing: true };
    }
    throw error;
  }
}

async function classificationBreakdown(): Promise<TypeBreakdown[]> {
  try {
    return await queryD1(
      `SELECT market_type, COUNT(*) AS count
         FROM polymarket_markets
        GROUP BY market_type
        ORDER BY count DESC`,
      (row) => ({
        marketType: String(row.market_type ?? 'unknown'),
        count: Number(row.count ?? 0),
      }),
    );
  } catch {
    return [];
  }
}

async function crawlRunSummary(): Promise<CrawlRunSummary | null> {
  try {
    const recent = await queryD1(
      `SELECT COUNT(*) AS count FROM polymarket_crawl_runs
        WHERE created_at >= datetime('now', '-1 day')`,
      (row) => Number(row.count ?? 0),
    );
    const last = await queryD1(
      `SELECT run_type, status, created_at FROM polymarket_crawl_runs
        ORDER BY created_at DESC LIMIT 1`,
      (row) => ({
        runType: String(row.run_type ?? ''),
        status: String(row.status ?? ''),
        createdAt: String(row.created_at ?? ''),
      }),
    );
    return {
      recentRuns: recent[0] ?? 0,
      lastRunAt: last[0]?.createdAt ?? null,
      lastRunStatus: last[0]?.status ?? null,
      lastRunType: last[0]?.runType ?? null,
    };
  } catch {
    return null;
  }
}

async function manifestSummary(): Promise<ManifestSummary | null> {
  try {
    const summary = await queryD1(
      `SELECT COUNT(*) AS manifest_count,
              COUNT(DISTINCT token_id) AS distinct_tokens,
              COALESCE(SUM(point_count), 0) AS points_recorded
         FROM polymarket_price_history_manifests`,
      (row) => ({
        manifestCount: Number(row.manifest_count ?? 0),
        distinctTokens: Number(row.distinct_tokens ?? 0),
        pointsRecorded: Number(row.points_recorded ?? 0),
      }),
    );
    return summary[0] ?? null;
  } catch {
    return null;
  }
}

async function linkSummary(): Promise<LinkSummary | null> {
  try {
    const candidate = await queryD1('SELECT COUNT(*) AS count FROM polymarket_hltv_link_candidates', (row) =>
      Number(row.count ?? 0),
    );
    const linked = await queryD1(
      `SELECT
          SUM(CASE WHEN link_method = 'auto' THEN 1 ELSE 0 END) AS auto_linked,
          SUM(CASE WHEN link_method = 'manual' THEN 1 ELSE 0 END) AS manual_linked
         FROM polymarket_markets
        WHERE hltv_match_id IS NOT NULL`,
      (row) => ({
        autoLinked: Number(row.auto_linked ?? 0),
        manualLinked: Number(row.manual_linked ?? 0),
      }),
    );
    return {
      candidateRows: candidate[0] ?? 0,
      marketsAutoLinked: linked[0]?.autoLinked ?? 0,
      marketsManualLinked: linked[0]?.manualLinked ?? 0,
    };
  } catch {
    return null;
  }
}

async function buildReport(): Promise<Report> {
  const tables: TableSummary[] = [];
  for (const table of POLYMARKET_TABLES) {
    // biome-ignore lint/performance/noAwaitInLoops: small fixed loop over D1 lookups.
    tables.push(await tableRowCount(table));
  }
  const anyTablePresent = tables.some((entry) => !entry.missing);
  return {
    generatedAt: new Date().toISOString(),
    tables,
    classification: anyTablePresent ? await classificationBreakdown() : [],
    crawlRuns: anyTablePresent ? await crawlRunSummary() : null,
    manifests: anyTablePresent ? await manifestSummary() : null,
    links: anyTablePresent ? await linkSummary() : null,
  };
}

function printReport(report: Report): void {
  process.stdout.write('\nPolymarket health report\n');
  process.stdout.write(`  generated at: ${report.generatedAt}\n\n`);
  process.stdout.write('  tables:\n');
  for (const entry of report.tables) {
    if (entry.missing) {
      process.stdout.write(`    - ${entry.table.padEnd(38)} MISSING (run migration 0004)\n`);
    } else {
      process.stdout.write(`    - ${entry.table.padEnd(38)} ${entry.rowCount ?? 0} rows\n`);
    }
  }
  if (report.classification.length > 0) {
    process.stdout.write('\n  market_type breakdown:\n');
    for (const row of report.classification) {
      process.stdout.write(`    - ${row.marketType.padEnd(14)} ${row.count}\n`);
    }
  }
  if (report.crawlRuns) {
    process.stdout.write('\n  crawl runs:\n');
    process.stdout.write(`    recent (24h):     ${report.crawlRuns.recentRuns}\n`);
    process.stdout.write(`    last run at:      ${report.crawlRuns.lastRunAt ?? '-'}\n`);
    process.stdout.write(`    last run status:  ${report.crawlRuns.lastRunStatus ?? '-'}\n`);
    process.stdout.write(`    last run type:    ${report.crawlRuns.lastRunType ?? '-'}\n`);
  }
  if (report.manifests) {
    process.stdout.write('\n  price-history manifests:\n');
    process.stdout.write(`    manifest rows:    ${report.manifests.manifestCount}\n`);
    process.stdout.write(`    distinct tokens:  ${report.manifests.distinctTokens}\n`);
    process.stdout.write(`    points recorded:  ${report.manifests.pointsRecorded}\n`);
  }
  if (report.links) {
    process.stdout.write('\n  links:\n');
    process.stdout.write(`    candidate rows:        ${report.links.candidateRows}\n`);
    process.stdout.write(`    markets auto-linked:   ${report.links.marketsAutoLinked}\n`);
    process.stdout.write(`    markets manual-linked: ${report.links.marketsManualLinked}\n`);
  }
}

async function main(): Promise<void> {
  const options = parseOptions();
  const report = await buildReport();
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printReport(report);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

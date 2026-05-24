import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { classifyMarket } from '../src/polymarket/classifier';
import {
  buildGammaEventsUrl,
  buildPriceHistoryUrl,
  fetchGammaEvents,
  fetchPriceHistory,
  PolymarketFetchError,
} from '../src/polymarket/client';
import { normalizeEvent, normalizeMarket } from '../src/polymarket/normalize';
import type { MarketClassification, MarketType, NormalizedMarket, RawGammaEvent } from '../src/polymarket/types';

/**
 * Polymarket canary script (local dry-run, public endpoints only).
 *
 * Defaults are intentionally tight so this script is safe to run by hand
 * without flags. It pulls a handful of Gamma event pages, classifies the
 * markets, optionally samples price-history for the first N CS2-looking
 * tokens, and writes everything to a local output directory under
 * `./polymarket-out/` so an operator can inspect the JSON without hitting
 * the deployed Worker.
 *
 * This script never touches D1 or R2 directly. It is the scaling proof for
 * the H1/H2 modules — the Worker-side admin endpoints can reuse the same
 * helpers later.
 */

interface CanaryOptions {
  maxPages: number;
  pageLimit: number;
  maxMarkets: number;
  maxTokens: number;
  tagId: number;
  closed: boolean | null;
  outDir: string;
  json: boolean;
  sampleHistory: boolean;
  interval: '1m' | '1h' | '6h' | '1d' | '1w' | 'max';
  fidelityMinutes: number;
}

const DEFAULT_OPTIONS: CanaryOptions = {
  maxPages: 1,
  pageLimit: 25,
  maxMarkets: 50,
  maxTokens: 3,
  tagId: 100780,
  closed: null,
  outDir: './polymarket-out',
  json: false,
  sampleHistory: false,
  interval: '1h',
  fidelityMinutes: 60,
};

function parseFlag(args: string[], name: string): string | null {
  const eqForm = args.find((arg) => arg.startsWith(`${name}=`));
  if (eqForm) return eqForm.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

function parseOptions(): CanaryOptions {
  const args = process.argv.slice(2);
  const opts: CanaryOptions = { ...DEFAULT_OPTIONS };
  const maxPages = parseFlag(args, '--max-pages');
  if (maxPages) opts.maxPages = Math.max(1, Math.min(Number(maxPages), 20));
  const pageLimit = parseFlag(args, '--page-limit');
  if (pageLimit) opts.pageLimit = Math.max(1, Math.min(Number(pageLimit), 100));
  const maxMarkets = parseFlag(args, '--max-markets');
  if (maxMarkets) opts.maxMarkets = Math.max(1, Math.min(Number(maxMarkets), 500));
  const maxTokens = parseFlag(args, '--max-tokens');
  if (maxTokens) opts.maxTokens = Math.max(0, Math.min(Number(maxTokens), 20));
  const tagId = parseFlag(args, '--tag-id');
  if (tagId) opts.tagId = Math.max(1, Number(tagId));
  const closed = parseFlag(args, '--closed');
  if (closed !== null) opts.closed = closed === 'true' ? true : closed === 'false' ? false : null;
  const outDir = parseFlag(args, '--out-dir');
  if (outDir) opts.outDir = outDir;
  const interval = parseFlag(args, '--interval');
  if (interval) opts.interval = interval as CanaryOptions['interval'];
  const fidelity = parseFlag(args, '--fidelity');
  if (fidelity) opts.fidelityMinutes = Math.max(1, Math.min(Number(fidelity), 1_440));
  opts.json = args.includes('--json');
  opts.sampleHistory = args.includes('--sample-history');
  return opts;
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, data: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data, null, 2));
}

interface MarketSummary {
  conditionId: string;
  question: string | null;
  marketType: MarketType;
  outcomeCount: number;
  tokenIds: string[];
}

interface PageSummary {
  pageIndex: number;
  cursor: string | null;
  url: string;
  itemsCount: number;
  rawBytes: number;
  outFile: string;
}

interface CanaryReport {
  generatedAt: string;
  options: CanaryOptions;
  pages: PageSummary[];
  eventsSeen: number;
  marketsSeen: number;
  markets: MarketSummary[];
  classification: Record<MarketType, number>;
  priceHistorySamples: Array<{
    tokenId: string;
    url: string;
    rawBytes: number;
    pointCount: number;
    outFile: string;
  }>;
  errors: Array<{ stage: string; message: string; url?: string }>;
}

function emptyClassificationCounter(): Record<MarketType, number> {
  return {
    match_winner: 0,
    map_winner: 0,
    total_maps: 0,
    map_handicap: 0,
    outright: 0,
    player_prop: 0,
    other: 0,
    unknown: 0,
  };
}

interface CollectedMarket {
  market: NormalizedMarket;
  classification: MarketClassification;
}

function collectMarketsFromEvents(events: RawGammaEvent[]): CollectedMarket[] {
  const collected: CollectedMarket[] = [];
  for (const rawEvent of events) {
    const normalizedEvent = normalizeEvent(rawEvent);
    if (!normalizedEvent) continue;
    for (const rawMarket of rawEvent.markets ?? []) {
      const market = normalizeMarket(rawMarket);
      if (!market) continue;
      collected.push({ market, classification: classifyMarket(market) });
    }
  }
  return collected;
}

async function pullGammaPages(
  options: CanaryOptions,
  outDir: string,
  report: CanaryReport,
): Promise<CollectedMarket[]> {
  let cursor: string | null = null;
  let collected: CollectedMarket[] = [];
  for (let pageIndex = 0; pageIndex < options.maxPages; pageIndex += 1) {
    const url = buildGammaEventsUrl({
      cursor,
      limit: options.pageLimit,
      tagId: options.tagId,
      closed: options.closed ?? undefined,
    });
    try {
      // biome-ignore lint/performance/noAwaitInLoops: cursor pagination must serialize.
      const result = await fetchGammaEvents({
        cursor,
        limit: options.pageLimit,
        tagId: options.tagId,
        closed: options.closed ?? undefined,
      });
      const outFile = join(outDir, 'gamma', `page_${String(pageIndex).padStart(3, '0')}.json`);
      writeJson(outFile, JSON.parse(result.rawBody));
      const events = result.parsed.events ?? result.parsed.data ?? [];
      report.eventsSeen += events.length;
      collected = [...collected, ...collectMarketsFromEvents(events)];
      report.pages.push({
        pageIndex,
        cursor,
        url,
        itemsCount: events.length,
        rawBytes: result.rawBody.length,
        outFile,
      });
      cursor = result.parsed.next_cursor ?? null;
      if (!cursor || cursor === 'LTE=' || events.length === 0) break;
      if (collected.length >= options.maxMarkets) break;
    } catch (error) {
      const message = error instanceof PolymarketFetchError ? error.message : String(error);
      report.errors.push({ stage: 'gamma', message, url });
      break;
    }
  }
  return collected.slice(0, options.maxMarkets);
}

async function samplePriceHistory(
  collected: CollectedMarket[],
  options: CanaryOptions,
  outDir: string,
  report: CanaryReport,
): Promise<void> {
  if (!options.sampleHistory || options.maxTokens === 0) return;
  const tokenIds: Array<{ tokenId: string; conditionId: string }> = [];
  const prioritized = [...collected].sort((left, right) => {
    if (left.classification.marketType === right.classification.marketType) return 0;
    if (left.classification.marketType === 'match_winner') return -1;
    if (right.classification.marketType === 'match_winner') return 1;
    return 0;
  });
  for (const entry of prioritized) {
    for (const outcome of entry.market.outcomes) {
      if (outcome.tokenId) tokenIds.push({ tokenId: outcome.tokenId, conditionId: entry.market.conditionId });
      if (tokenIds.length >= options.maxTokens) break;
    }
    if (tokenIds.length >= options.maxTokens) break;
  }
  for (const { tokenId } of tokenIds) {
    const url = buildPriceHistoryUrl(tokenId, { interval: options.interval, fidelityMinutes: options.fidelityMinutes });
    try {
      // biome-ignore lint/performance/noAwaitInLoops: serialized sampling keeps API friendly.
      const result = await fetchPriceHistory(tokenId, {
        interval: options.interval,
        fidelityMinutes: options.fidelityMinutes,
      });
      const outFile = join(outDir, 'price-history', `${tokenId.slice(0, 16)}.json`);
      writeJson(outFile, JSON.parse(result.rawBody));
      report.priceHistorySamples.push({
        tokenId,
        url,
        rawBytes: result.rawBody.length,
        pointCount: result.parsed.history?.length ?? 0,
        outFile,
      });
    } catch (error) {
      const message = error instanceof PolymarketFetchError ? error.message : String(error);
      report.errors.push({ stage: 'price-history', message, url });
    }
  }
}

async function main(): Promise<void> {
  const options = parseOptions();
  const outDir = resolve(options.outDir);
  ensureDir(outDir);

  const report: CanaryReport = {
    generatedAt: new Date().toISOString(),
    options,
    pages: [],
    eventsSeen: 0,
    marketsSeen: 0,
    markets: [],
    classification: emptyClassificationCounter(),
    priceHistorySamples: [],
    errors: [],
  };

  const collected = await pullGammaPages(options, outDir, report);
  report.marketsSeen = collected.length;
  for (const { market, classification } of collected) {
    report.classification[classification.marketType] += 1;
    report.markets.push({
      conditionId: market.conditionId,
      question: market.question,
      marketType: classification.marketType,
      outcomeCount: market.outcomes.length,
      tokenIds: market.outcomes.map((outcome) => outcome.tokenId).filter((id): id is string => Boolean(id)),
    });
  }

  await samplePriceHistory(collected, options, outDir, report);

  const reportPath = join(outDir, 'canary-report.json');
  writeJson(reportPath, report);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(`\nPolymarket canary report written to ${reportPath}\n`);
  process.stdout.write(`  events seen:  ${report.eventsSeen}\n`);
  process.stdout.write(`  markets seen: ${report.marketsSeen}\n`);
  for (const type of Object.keys(report.classification) as MarketType[]) {
    process.stdout.write(`  classified ${type.padEnd(14)} ${report.classification[type]}\n`);
  }
  if (report.priceHistorySamples.length > 0) {
    process.stdout.write(`  price-history samples: ${report.priceHistorySamples.length}\n`);
  }
  if (report.errors.length > 0) {
    process.stdout.write(`  errors: ${report.errors.length}\n`);
    for (const error of report.errors) {
      process.stdout.write(`    - [${error.stage}] ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

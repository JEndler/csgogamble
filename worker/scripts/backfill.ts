// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: legacy parser/ops control-flow; refactor separately, do not block hygiene gate.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: legacy parser/test fixtures are intentionally dense; refactor separately.
// biome-ignore-all lint/performance/noAwaitInLoops: sequential remote/browser/D1 operations are intentional for rate limits and state ordering.
/**
 * Legacy local-only backfill script: collect historical match HTML from HLTV /results
 * and POST each to the local worker's /ingest/match endpoint.
 *
 * Uses the shared browser bootstrap (Playwright + stealth plugin) to
 * bypass Cloudflare challenges on HLTV pages.
 *
 * Prerequisites:
 *   1. npm install
 *   2. npx playwright install chromium
 *   3. Start the worker locally: npm run dev   (runs wrangler dev)
 *
 * Usage:
 *   npm run backfill -- --allow-local-hltv --max 50 --headed
 *   npm run backfill -- --allow-local-hltv --worker-url http://localhost:8787
 *
 * Production-like acquisition must use `npm run backfill:daemon` against the
 * deployed Worker. This script refuses to run unless --allow-local-hltv is
 * passed explicitly.
 */

import type { Browser, Page } from 'playwright';
import { discoverMatchUrls } from '../src/hltv';
import { launchBrowser } from './browser';

const HLTV_BASE = 'https://www.hltv.org';
const DEFAULT_WORKER_URL = 'http://localhost:8787';
const DEFAULT_MAX = 100;
const PAGE_DELAY_MS = 1000;
const MATCH_DELAY_MS = 1000;
const DEFAULT_INGEST_TIMEOUT_MS = 60_000;

interface BackfillOptions {
  max: number;
  startOffset: number;
  workerUrl: string;
  headless: boolean;
  ingestTimeoutMs: number;
  allowLocalHltv: boolean;
}

function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);
  const opts: BackfillOptions = {
    max: DEFAULT_MAX,
    startOffset: 0,
    workerUrl: DEFAULT_WORKER_URL,
    headless: true,
    ingestTimeoutMs: DEFAULT_INGEST_TIMEOUT_MS,
    allowLocalHltv: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--max' && args[i + 1]) {
      opts.max = Number.parseInt(args[++i], 10);
    } else if (arg === '--start-offset' && args[i + 1]) {
      opts.startOffset = Number.parseInt(args[++i], 10);
    } else if (arg === '--ingest-timeout-ms' && args[i + 1]) {
      opts.ingestTimeoutMs = Number.parseInt(args[++i], 10);
    } else if (arg === '--worker-url' && args[i + 1]) {
      opts.workerUrl = args[++i];
    } else if (arg === '--headed') {
      opts.headless = false;
    } else if (arg === '--allow-local-hltv') {
      opts.allowLocalHltv = true;
    }
  }

  return opts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeBrowserQuietly(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } catch (err) {
    console.warn(`Browser close warning: ${err}`);
  }
}

async function relaunchBrowser(browser: Browser, headless: boolean): Promise<{ browser: Browser; page: Page }> {
  await closeBrowserQuietly(browser);
  return launchBrowser({ headless });
}

function isClosedBrowserError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('Target page, context or browser has been closed') || message.includes('browser has been closed')
  );
}

async function main(): Promise<void> {
  const opts = parseArgs();
  if (!opts.allowLocalHltv) {
    throw new Error(
      'Refusing local HLTV acquisition. Use npm run backfill:daemon for Worker-native backfill, or pass --allow-local-hltv for an explicitly approved local run.',
    );
  }
  console.log(
    `Backfill: max=${opts.max}, startOffset=${opts.startOffset}, worker=${opts.workerUrl}, headless=${opts.headless}\n`,
  );

  let { browser, page } = await launchBrowser({ headless: opts.headless });

  try {
    // Phase 1: discover match URLs from /results pages
    const collected = new Set<string>();
    let offset = opts.startOffset;

    while (collected.size < opts.max) {
      const url = offset === 0 ? `${HLTV_BASE}/results` : `${HLTV_BASE}/results?offset=${offset}`;
      console.log(`Fetching results page: ${url}`);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(PAGE_DELAY_MS);

      const html = await page.content();
      const urls = discoverMatchUrls(HLTV_BASE, html);

      if (urls.length === 0) {
        console.log('No more match URLs found, stopping discovery.');
        break;
      }

      const before = collected.size;
      for (const u of urls) {
        if (collected.size >= opts.max) break;
        collected.add(u);
      }

      console.log(`  Found ${urls.length} URLs, ${collected.size} total unique`);
      if (collected.size === before) break;

      offset += 100;
    }

    const matchUrls = [...collected];
    console.log(`\nDiscovered ${matchUrls.length} match URLs. Starting ingestion...\n`);

    // Phase 2: visit each match and POST its HTML to the worker
    let success = 0;
    let failed = 0;
    const RESTART_EVERY = 10;

    for (let i = 0; i < matchUrls.length; i++) {
      const matchUrl = matchUrls[i];

      // Restart browser periodically to avoid session instability
      if (i > 0 && i % RESTART_EVERY === 0) {
        console.log(`Restarting browser after ${i} matches...`);
        ({ browser, page } = await relaunchBrowser(browser, opts.headless));
      }

      try {
        await page.goto(matchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForTimeout(PAGE_DELAY_MS);
        const matchHtml = await page.content();

        const resp = await fetch(`${opts.workerUrl}/ingest/match`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matchUrl, html: matchHtml }),
          signal: AbortSignal.timeout(opts.ingestTimeoutMs),
        });

        const result = (await resp.json()) as { ok: boolean; error?: string };
        if (!result.ok) throw new Error(result.error ?? 'unknown ingest error');

        success++;
        console.log(`[${i + 1}/${matchUrls.length}] OK  ${matchUrl}`);
      } catch (err) {
        failed++;
        console.error(`[${i + 1}/${matchUrls.length}] FAIL ${matchUrl}: ${err}`);
        if (isClosedBrowserError(err)) {
          console.log('Browser/page closed unexpectedly; relaunching and continuing...');
          ({ browser, page } = await relaunchBrowser(browser, opts.headless));
        }
      }

      if (i < matchUrls.length - 1) {
        await sleep(MATCH_DELAY_MS);
      }
    }

    console.log(`\nBackfill complete: ${success} succeeded, ${failed} failed out of ${matchUrls.length}`);
  } finally {
    await closeBrowserQuietly(browser);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

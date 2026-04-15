/**
 * Backfill script: collect historical match HTML from HLTV /results
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
 *   npm run backfill
 *   npm run backfill -- --max 50 --headed
 *   npm run backfill -- --worker-url http://localhost:8787
 */

import { discoverMatchUrls } from '../src/hltv';
import { launchBrowser } from './browser';

const HLTV_BASE = 'https://www.hltv.org';
const DEFAULT_WORKER_URL = 'http://localhost:8787';
const DEFAULT_MAX = 100;
const PAGE_DELAY_MS = 1000;
const MATCH_DELAY_MS = 1000;

interface BackfillOptions {
  max: number;
  workerUrl: string;
  headless: boolean;
}

function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);
  const opts: BackfillOptions = {
    max: DEFAULT_MAX,
    workerUrl: DEFAULT_WORKER_URL,
    headless: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--max' && args[i + 1]) {
      opts.max = Number.parseInt(args[++i], 10);
    } else if (arg === '--worker-url' && args[i + 1]) {
      opts.workerUrl = args[++i];
    } else if (arg === '--headed') {
      opts.headless = false;
    }
  }

  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs();
  console.log(`Backfill: max=${opts.max}, worker=${opts.workerUrl}, headless=${opts.headless}\n`);

  const { browser, page } = await launchBrowser({ headless: opts.headless });

  try {
    // Phase 1: discover match URLs from /results pages
    const collected = new Set<string>();
    let offset = 0;

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

    for (let i = 0; i < matchUrls.length; i++) {
      const matchUrl = matchUrls[i];
      try {
        await page.goto(matchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForTimeout(PAGE_DELAY_MS);
        const matchHtml = await page.content();

        const resp = await fetch(`${opts.workerUrl}/ingest/match`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matchUrl, html: matchHtml }),
        });

        const result = (await resp.json()) as { ok: boolean; error?: string };
        if (!result.ok) throw new Error(result.error ?? 'unknown ingest error');

        success++;
        console.log(`[${i + 1}/${matchUrls.length}] OK  ${matchUrl}`);
      } catch (err) {
        failed++;
        console.error(`[${i + 1}/${matchUrls.length}] FAIL ${matchUrl}: ${err}`);
      }

      if (i < matchUrls.length - 1) {
        await page.waitForTimeout(MATCH_DELAY_MS);
      }
    }

    console.log(`\nBackfill complete: ${success} succeeded, ${failed} failed out of ${matchUrls.length}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

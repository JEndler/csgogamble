/**
 * Retry failed match ingestions: re-fetch HTML via Playwright and POST
 * to the worker's /ingest/match endpoint.
 *
 * Usage:
 *   npx tsx scripts/retry-failed.ts <worker-url> <match-url> [more-urls...]
 */

import { launchBrowser } from './browser';

const workerUrl = process.argv[2] ?? 'http://localhost:8787';
const matchUrls = process.argv.slice(3);

if (matchUrls.length === 0) {
  throw new Error('Usage: tsx scripts/retry-failed.ts <worker-url> <match-url> [more-urls...]');
}

const { browser, page } = await launchBrowser();

for (const matchUrl of matchUrls) {
  await page.goto(matchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);
  const html = await page.content();
  const response = await fetch(`${workerUrl}/ingest/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ matchUrl, html }),
  });
  const body = await response.text();
  console.log(response.status, matchUrl, body.slice(0, 200));
}

await browser.close();

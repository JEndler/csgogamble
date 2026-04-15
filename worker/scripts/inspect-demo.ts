/**
 * Debug helper: search a match page's HTML for demo/GOTV-related snippets.
 *
 * Usage:
 *   npx tsx scripts/inspect-demo.ts <match-url>
 */

import { launchBrowser } from './browser';

const url = process.argv[2];
if (!url) throw new Error('Usage: tsx scripts/inspect-demo.ts <match-url>');

const { browser, page } = await launchBrowser();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2000);
const html = await page.content();
for (const needle of ['gotv', 'demo', 'download', 'replay']) {
  const idx = html.toLowerCase().indexOf(needle);
  console.log('needle', needle, 'idx', idx);
  if (idx >= 0) {
    console.log(html.slice(Math.max(0, idx - 400), idx + 1600));
  }
}
await browser.close();

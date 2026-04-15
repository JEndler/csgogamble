/**
 * Debug helper: fetch a single match URL and print the parsed maps array.
 *
 * Usage:
 *   npx tsx scripts/debug-parse.ts <match-url>
 */

import { parseMatchHtml } from '../src/hltv';
import { launchBrowser } from './browser';

const url = process.argv[2];
if (!url) throw new Error('Usage: tsx scripts/debug-parse.ts <match-url>');

const { browser, page } = await launchBrowser();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);
const html = await page.content();
const parsed = parseMatchHtml(url, html);
console.log(JSON.stringify(parsed.maps, null, 2));
await browser.close();

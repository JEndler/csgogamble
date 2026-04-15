/**
 * Debug helper: fetch a match URL and print map + player stats summary.
 *
 * Usage:
 *   npx tsx scripts/debug-player-stats.ts <match-url>
 */

import { parseMatchHtml } from '../src/hltv';
import { launchBrowser } from './browser';

const url = process.argv[2];
if (!url) throw new Error('Usage: tsx scripts/debug-player-stats.ts <match-url>');

const { browser, page } = await launchBrowser();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2000);
const html = await page.content();
const parsed = parseMatchHtml(url, html);
console.log('maps', parsed.maps);
console.log('playerStatsCount', parsed.playerStats.length);
console.log('sample', parsed.playerStats.slice(0, 5));
await browser.close();

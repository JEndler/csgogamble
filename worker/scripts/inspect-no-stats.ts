/**
 * Debug helper: compare stats-content sections, map menu entries, and
 * mapholder blocks to diagnose why player stats may be missing.
 *
 * Usage:
 *   npx tsx scripts/inspect-no-stats.ts <url> [more urls]
 */

import { launchBrowser } from './browser';

const urls = process.argv.slice(2);
if (urls.length === 0) throw new Error('Usage: tsx scripts/inspect-no-stats.ts <url> [more urls]');

const { browser, page } = await launchBrowser();

for (const url of urls) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  const html = await page.content();
  const sectionIds = [...html.matchAll(/<div class="stats-content" id="([^"\s]+)-content"/gi)].map((m) => m[1]);
  const menuIds = [...html.matchAll(/<div class="(\d+) dynamic-map-name-full" id="\d+">([^<]+)<\/div>/gi)].map((m) => ({
    id: m[1],
    name: m[2],
  }));
  const mapBlocks = [
    ...html.matchAll(/<div class="mapholder">([\s\S]*?)(?=<div class="mapholder"|<div class="stats-content"|$)/gi),
  ].map((m) => {
    const block = m[1] || '';
    const name = (block.match(/class="mapname[^"]*"[^>]*>([^<]+)/i) || [])[1] || null;
    const href =
      (block.match(/href="([^"]*\/stats\/matches\/(?:performance\/)?mapstatsid\/(\d+)\/[^"]+)"/i) || [])[1] || null;
    const mapId =
      (block.match(/href="([^"]*\/stats\/matches\/(?:performance\/)?mapstatsid\/(\d+)\/[^"]+)"/i) || [])[2] || null;
    return { name, href, mapId };
  });
  console.log(JSON.stringify({ url, sectionIds, menuIds, mapBlocks }, null, 2));
}

await browser.close();

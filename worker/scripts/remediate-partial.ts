/**
 * Remediate partial matches using improved parser and raw HTML from R2.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseMatchHtml } from '../src/hltv';

const DRY_RUN = !process.argv.includes('--apply');
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? '200');

interface PartialRow {
  hltv_match_id: number;
  html_r2_key: string | null;
  source_url: string;
}

interface D1PartialRow {
  hltv_match_id: number | string;
  html_r2_key?: string | null;
  source_url: string;
}

function runWranglerD1(sql: string): string {
  const cmd = `npx wrangler d1 execute csgogamble --remote --json --command "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { encoding: 'utf8' });
}

function parseD1Table(output: string): PartialRow[] {
  try {
    const jsonMatch = output.match(/\[\s*\{[\s\S]*?\}\s*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    const results = (parsed[0]?.results || []) as D1PartialRow[];
    return results.map((r) => ({
      hltv_match_id: Number(r.hltv_match_id),
      html_r2_key: r.html_r2_key || null,
      source_url: r.source_url,
    }));
  } catch {
    return [];
  }
}

function readHtmlFromR2(key: string): string | null {
  const candidates = [`.wrangler/state/v3/r2/csgogamble-raw/${key}`, `.wrangler/state/v3/r2/RAW_HTML/${key}`];
  for (const p of candidates) {
    try {
      return readFileSync(p, 'utf8');
    } catch {}
  }
  return null;
}

async function main() {
  console.log(`Remediate partial | dry-run=${DRY_RUN} | limit=${LIMIT}`);

  const sql = `SELECT hltv_match_id, html_r2_key, source_url FROM matches WHERE status='partial' ORDER BY last_ingested_at DESC LIMIT ${LIMIT};`;
  const output = runWranglerD1(sql);
  const partials = parseD1Table(output);

  console.log(`Found ${partials.length} partial matches`);

  let updated = 0;
  for (const row of partials) {
    const html = readHtmlFromR2(row.html_r2_key || '');
    if (!html) continue;

    const parsed = parseMatchHtml(row.source_url, html);
    const newStatus = parsed.maps.length > 0 && parsed.playerStats.length > 0 ? 'parsed' : 'partial';

    if (!DRY_RUN && newStatus === 'parsed') {
      const updateSql = `UPDATE matches SET status='${newStatus}', parser_version='${parsed.parserVersion}' WHERE hltv_match_id=${row.hltv_match_id};`;
      execSync(`npx wrangler d1 execute csgogamble --remote --command "${updateSql}"`);
      updated++;
    }
  }

  console.log(`Summary: updated=${updated} still-partial=${partials.length - updated} (dry-run=${DRY_RUN})`);
}

main().catch(console.error);

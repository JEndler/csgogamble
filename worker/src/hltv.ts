import { PARSER_VERSION } from './constants';
import type { MatchStatus } from './contracts';
import type {
  DiscoverRequest,
  MatchIngestRequest,
  ParsedMap,
  ParsedMatch,
  ParsedPlayerStat,
  TeamSummary,
} from './types';

// ── Match-ID extraction ─────────────────────────────────────────────────────

const MATCH_ID_PATTERN = /\/matches\/(\d+)/;
const MATCH_SLUG_PATTERN = /\/matches\/\d+\/([^/?#]+)/;

/** Pull the numeric HLTV match ID out of a match page URL. */
export function extractMatchIdFromUrl(matchUrl: string): number {
  const match = matchUrl.match(MATCH_ID_PATTERN);
  if (!match?.[1]) {
    throw new Error(`Could not extract match id from URL: ${matchUrl}`);
  }
  return Number(match[1]);
}

/** Extract the human-readable HLTV slug from a match URL. */
function extractMatchSlug(matchUrl: string): string | null {
  return matchUrl.match(MATCH_SLUG_PATTERN)?.[1] ?? null;
}

// ── URL builders ────────────────────────────────────────────────────────────

export function buildMatchUrl(baseUrl: string, request: MatchIngestRequest): string {
  if (request.matchUrl) return request.matchUrl;
  if (request.matchId) return `${baseUrl}/matches/${request.matchId}/_`;
  throw new Error('Expected matchUrl or matchId');
}

export function buildResultsUrl(baseUrl: string, request: DiscoverRequest): string {
  return request.pageUrl || `${baseUrl}/results`;
}

// ── Challenge detection ─────────────────────────────────────────────────────

const CLOUDFLARE_CHALLENGE_MARKERS = [
  'Just a moment...',
  'Enable JavaScript and cookies to continue',
  'Attention Required! | Cloudflare',
  '/cdn-cgi/challenge-platform/',
  'cf-browser-verification',
  'challenge-platform',
];

export function findCloudflareChallengeMarkers(html: string): string[] {
  return CLOUDFLARE_CHALLENGE_MARKERS.filter((marker) => html.includes(marker));
}

export function isCloudflareChallenge(html: string): boolean {
  return findCloudflareChallengeMarkers(html).length > 0;
}

// ── Low-level regex helpers ─────────────────────────────────────────────────

/** Try each pattern against `html` in order; return first captured group (decoded) or null. */
function captureText(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m?.[1]) return decodeHtml(m[1].trim());
  }
  return null;
}

/** Like captureText but coerce to number, stripping non-numeric chars. */
function captureNumber(html: string, patterns: RegExp[]): number | null {
  const value = captureText(html, patterns);
  if (!value) return null;
  const parsed = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Decode the five standard HTML character references. */
function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// ── Team extraction ─────────────────────────────────────────────────────────

/** Extract team ID and name from a gradient header block (e.g. "team1-gradient"). */
function inferTeamSummary(html: string, className: string): TeamSummary {
  const blockPattern = new RegExp(`<div[^>]*class="${className}[^"]*"[\\s\\S]*?</div>`, 'i');
  const block = html.match(blockPattern)?.[0] ?? '';
  const name =
    captureText(block, [/class="teamName[^"]*"[^>]*>([^<]+)/i, /class="teamName"[^>]*>([^<]+)/i]) || 'Unknown';
  const idMatch = block.match(/\/team\/(\d+)\//i);
  return { hltvTeamId: idMatch ? Number(idMatch[1]) : null, name };
}

// ── Map extraction ──────────────────────────────────────────────────────────

const MAP_BLOCK_RE = /<div class="mapholder">([\s\S]*?)(?=<div class="mapholder"|<div class="stats-content"|$)/gi;
const MAPSTATS_HREF_RE = /href="([^"]*\/stats\/matches\/(?:performance\/)?mapstatsid\/(\d+)\/[^"]+)"/i;
const MAP_SCORE_RE = /class="results-team-score[^"]*"[^>]*>([^<]+)/gi;

/** Parse all mapholder divs, deduplicating by map ID or name. Skips placeholder entries (TBA, Default). */
function inferMaps(html: string, matchUrl: string): ParsedMap[] {
  const maps: ParsedMap[] = [];
  const seen = new Set<string>();

  for (const blockMatch of html.matchAll(MAP_BLOCK_RE)) {
    const block = blockMatch[1];
    if (!block) continue;

    const mapName = captureText(block, [/class="mapname[^"]*"[^>]*>([^<]+)/i]);
    if (!mapName || mapName === 'Default' || mapName === 'TBA') continue;

    const hrefMatch = block.match(MAPSTATS_HREF_RE);
    const mapId = hrefMatch?.[2] ? Number(hrefMatch[2]) : null;
    const scores = [...block.matchAll(MAP_SCORE_RE)].map((m) => Number(m[1]));
    const sourceUrl = hrefMatch?.[1] ? `https://www.hltv.org${hrefMatch[1]}` : matchUrl;

    // Deduplicate by map ID when available, otherwise by name
    const dedupeKey = mapId !== null ? `map-id:${mapId}` : `map-name:${mapName}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    maps.push({
      hltvMapId: mapId,
      mapName,
      sourceUrl,
      team1Score: Number.isFinite(scores[0]) ? scores[0] : null,
      team2Score: Number.isFinite(scores[1]) ? scores[1] : null,
    });
  }

  return maps;
}

// ── Player stats extraction ─────────────────────────────────────────────────

const STATS_SECTION_RE =
  /<div class="stats-content" id="([^"\s]+)-content">([\s\S]*?)(?=<div class="stats-content"|$)/gi;
const STATS_TABLE_RE = /<table class="table totalstats">([\s\S]*?)<\/table>/gi;
const TABLE_ROW_RE = /<tr>([\s\S]*?)<\/tr>/gi;
const KD_RE = /class="kd text-center traditional-data">\s*(\d+)\s*-\s*(\d+)\s*</i;

/** Resolve which team a stats table belongs to via its header link or name fallback. */
function resolveTableTeamId(tableHtml: string, team1: TeamSummary, team2: TeamSummary): number | null {
  const idMatch = tableHtml.match(/href="\/team\/(\d+)\/[^"]*" class="teamName team"/i);
  if (idMatch?.[1]) return Number(idMatch[1]);

  const nameMatch = tableHtml.match(/class="teamName team">([^<]+)/i);
  const headerName = nameMatch?.[1]?.trim() ?? null;
  if (headerName === team1.name) return team1.hltvTeamId;
  if (headerName === team2.name) return team2.hltvTeamId;
  return null;
}

/** Parse a single player row into a stat entry. Returns null for header/empty rows. */
function parsePlayerRow(
  rowHtml: string,
  mapName: string,
  teamHltvId: number | null,
  sourceUrl: string | null,
): ParsedPlayerStat | null {
  const playerIdMatch = rowHtml.match(/href="\/player\/(\d+)\//i);
  if (!playerIdMatch?.[1]) return null;

  const nickname =
    captureText(rowHtml, [
      /class="player-nick">([^<]+)/i,
      /class="smartphone-only statsPlayerName text-ellipsis">([^<]+)/i,
      /class="statsPlayerName text-ellipsis">([^<]+)/i,
    ]) ?? 'Unknown';

  const kdMatch = rowHtml.match(KD_RE);
  const adr = captureNumber(rowHtml, [/class="adr[^"]*traditional-data[^>]*>([0-9.]+)/i]);
  const kast = captureNumber(rowHtml, [/class="kast[^"]*traditional-data[^>]*>([0-9.]+)%/i]);
  const rating = captureNumber(rowHtml, [/class="rating[^"]*">([0-9.]+)/i]);

  return {
    playerHltvId: Number(playerIdMatch[1]),
    nickname,
    teamHltvId,
    mapName,
    kills: kdMatch?.[1] ? Number(kdMatch[1]) : null,
    deaths: kdMatch?.[2] ? Number(kdMatch[2]) : null,
    adr,
    rating,
    kast,
    sourceUrl,
  };
}

/**
 * Walk stats-content sections (one per map), each containing two team tables.
 * Sections are keyed by their DOM id which matches the hltv_map_id from the mapholder block.
 */
function inferPlayerStats(html: string, maps: ParsedMap[], team1: TeamSummary, team2: TeamSummary): ParsedPlayerStat[] {
  const results: ParsedPlayerStat[] = [];

  for (const sectionMatch of html.matchAll(STATS_SECTION_RE)) {
    const sectionId = sectionMatch[1];
    const sectionHtml = sectionMatch[2];
    if (!sectionId || !sectionHtml || sectionId === 'all') continue;

    // Match section to a parsed map via hltv_map_id
    const map = maps.find((entry) => String(entry.hltvMapId) === sectionId);
    if (!map) continue;

    for (const tableMatch of sectionHtml.matchAll(STATS_TABLE_RE)) {
      const tableHtml = tableMatch[1];
      if (!tableHtml) continue;

      const teamId = resolveTableTeamId(tableHtml, team1, team2);

      for (const rowMatch of tableHtml.matchAll(TABLE_ROW_RE)) {
        const rowHtml = rowMatch[1];
        if (!rowHtml) continue;
        const stat = parsePlayerRow(rowHtml, map.mapName, teamId, map.sourceUrl);
        if (stat) results.push(stat);
      }
    }
  }

  return results;
}

// ── Demo URL extraction ─────────────────────────────────────────────────────

/** Find the GOTV demo download URL, preferring data-attribute over href fallback. */
function inferDemoUrl(html: string): string | null {
  const m = html.match(/data-demo-link="([^"]+)"/i) || html.match(/href="([^"]*\/download\/demo\/[^"]+)"/i);
  if (!m?.[1]) return null;
  return m[1].startsWith('http') ? m[1] : `https://www.hltv.org${m[1]}`;
}

// ── Status classification ───────────────────────────────────────────────────

/**
 * Decide parse status:
 *  - challenge  → Cloudflare JS challenge page
 *  - parsed     → maps extracted with at least some player stats
 *  - partial    → some data extracted but incomplete (maps without stats, or no maps at all)
 */
function classifyStatus(maps: ParsedMap[], playerStats: ParsedPlayerStat[]): MatchStatus {
  if (maps.length > 0 && playerStats.length > 0) return 'parsed';
  return 'partial';
}

// ── Main entry points ───────────────────────────────────────────────────────

export function parseMatchHtml(matchUrl: string, html: string): ParsedMatch {
  const hltvMatchId = extractMatchIdFromUrl(matchUrl);
  const slug = extractMatchSlug(matchUrl);

  if (isCloudflareChallenge(html)) {
    return {
      hltvMatchId,
      slug,
      sourceUrl: matchUrl,
      eventName: null,
      bestOf: null,
      scheduledAt: null,
      team1: { hltvTeamId: null, name: 'Unknown' },
      team2: { hltvTeamId: null, name: 'Unknown' },
      team1Score: null,
      team2Score: null,
      winnerTeamId: null,
      status: 'challenge',
      maps: [],
      playerStats: [],
      rawDemoUrl: null,
      parserVersion: PARSER_VERSION,
    };
  }

  const team1 = inferTeamSummary(html, 'team1-gradient');
  const team2 = inferTeamSummary(html, 'team2-gradient');
  const team1Score = captureNumber(html, [
    /class="team1-gradient[\s\S]*?class="won"[^>]*>(\d+)/i,
    /class="team1-gradient[\s\S]*?class="score"[^>]*>(\d+)/i,
  ]);
  const team2Score = captureNumber(html, [
    /class="team2-gradient[\s\S]*?class="won"[^>]*>(\d+)/i,
    /class="team2-gradient[\s\S]*?class="score"[^>]*>(\d+)/i,
  ]);
  const eventName = captureText(html, [
    /class="event text-ellipsis"[^>]*title="([^"]+)/i,
    /class="event"[^>]*>\s*<a[^>]*>([^<]+)/i,
  ]);
  const bestOf = captureNumber(html, [/Best of (\d+)/i, /bo(\d+)/i]);
  const scheduledUnix = captureNumber(html, [/data-unix="(\d{10,13})"/i]);
  const scheduledAt = scheduledUnix
    ? new Date(scheduledUnix > 9999999999 ? scheduledUnix : scheduledUnix * 1000).toISOString()
    : null;
  const maps = inferMaps(html, matchUrl);
  const playerStats = inferPlayerStats(html, maps, team1, team2);
  const rawDemoUrl = inferDemoUrl(html);

  let winnerTeamId: number | null = null;
  if (team1Score !== null && team2Score !== null) {
    winnerTeamId = team1Score > team2Score ? team1.hltvTeamId : team2Score > team1Score ? team2.hltvTeamId : null;
  }

  return {
    hltvMatchId,
    slug,
    sourceUrl: matchUrl,
    eventName,
    bestOf,
    scheduledAt,
    team1,
    team2,
    team1Score,
    team2Score,
    winnerTeamId,
    status: classifyStatus(maps, playerStats),
    maps,
    playerStats,
    rawDemoUrl,
    parserVersion: PARSER_VERSION,
  };
}

export function discoverMatchUrls(baseUrl: string, html: string): string[] {
  const links = [...html.matchAll(/href="([^"]*\/matches\/\d+\/[^"]+)"/gi)]
    .map((m) => m[1])
    .map((href) => (href.startsWith('http') ? href : `${baseUrl}${href}`));
  return [...new Set(links)];
}

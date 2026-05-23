import { PARSER_VERSION } from './constants';
import type { MatchStatus } from './contracts';
import type {
  DiscoverRequest,
  MapStatus,
  MatchIngestRequest,
  ParsedLineupPlayer,
  ParsedMap,
  ParsedMatch,
  ParsedPlayerMatchStat,
  ParsedPlayerStat,
  ParsedStream,
  ParsedVeto,
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

/** Strip tags, collapse whitespace, and HTML-decode. */
function plainText(html: string): string {
  return decodeHtml(
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

// ── Team extraction ─────────────────────────────────────────────────────────

/**
 * Take a substring of `html` from the first occurrence of `className` up to the
 * first occurrence of any `boundaryClassNames` (or `maxChars` if none found).
 * Bounds regex scans to a team's portion of the document.
 */
function sliceByClass(html: string, className: string, boundaryClassNames: string[], maxChars = 4000): string {
  const startIdx = html.search(new RegExp(`class="${className}\\b[^"]*"`, 'i'));
  if (startIdx < 0) return '';

  let endIdx = startIdx + maxChars;
  for (const boundary of boundaryClassNames) {
    const candidate = html.search(new RegExp(`class="${boundary}\\b[^"]*"`, 'i'));
    if (candidate > startIdx && candidate < endIdx) endIdx = candidate;
  }
  return html.slice(startIdx, Math.min(endIdx, html.length));
}

function parseTeamBlock(block: string): TeamSummary {
  if (!block) return { hltvTeamId: null, name: 'Unknown', rank: null };
  const name = captureText(block, [/class="teamName[^"]*"[^>]*>([^<]+)/i]) || 'Unknown';
  const idMatch = block.match(/\/team\/(\d+)\//i);
  const rankMatch = block.match(/World rank:[\s\S]*?#?(\d+)/i);
  return {
    hltvTeamId: idMatch?.[1] ? Number(idMatch[1]) : null,
    name,
    rank: rankMatch?.[1] ? Number(rankMatch[1]) : null,
  };
}

function inferTeamSummaries(html: string): { team1: TeamSummary; team2: TeamSummary } {
  const team1Block = sliceByClass(html, 'team1-gradient', [
    'team2-gradient',
    'standard-box veto-box',
    'mapholder',
    'lineups',
  ]);
  const team2Block = sliceByClass(html, 'team2-gradient', [
    'standard-box veto-box',
    'mapholder',
    'lineups',
    'preformatted-text',
  ]);
  return { team1: parseTeamBlock(team1Block), team2: parseTeamBlock(team2Block) };
}

// ── Event / meta / status extraction ────────────────────────────────────────

const EVENT_LINK_RE = /href="\/events\/(\d+)\/([^"]+)"/i;

function inferEvent(html: string): {
  eventHltvId: number | null;
  eventSourceUrl: string | null;
  eventName: string | null;
} {
  const eventName = captureText(html, [
    /class="event text-ellipsis"[^>]*title="([^"]+)/i,
    /class="event text-ellipsis"[\s\S]{0,500}?title="([^"]+)/i,
    /class="event[^"]*"[\s\S]{0,500}?<a[^>]*>(?:\s*<[^>]+>)*\s*([^<]+)/i,
  ]);

  const scopedLink = html.match(
    /<div[^>]*class="(?:timeAndEvent|teamsBox|event[^"]*)"[\s\S]{0,4000}?href="\/events\/(\d+)\/([^"]+)"/i,
  );
  const link = scopedLink ?? html.match(EVENT_LINK_RE);
  const id = link?.[1] ? Number(link[1]) : null;
  const slug = link?.[2] ?? null;
  return {
    eventHltvId: id,
    eventSourceUrl: id !== null && slug ? `https://www.hltv.org/events/${id}/${slug}` : null,
    eventName,
  };
}

function inferMatchStatus(html: string): string | null {
  return captureText(html, [
    /<div[^>]*class="countdown-info"[\s\S]*?class="standard-headline"[^>]*>([^<]+)/i,
    /<div[^>]*class="standard-headline"[^>]*>([^<]+)/i,
  ]);
}

function inferMatchMeta(html: string): {
  matchStage: string | null;
  matchFormat: string | null;
  matchLocation: string | null;
} {
  const block = html.match(/<div[^>]*class="[^"]*preformatted-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (!block) {
    return { matchStage: null, matchFormat: null, matchLocation: null };
  }
  const text = decodeHtml(
    block
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\r/g, '')
      .trim(),
  );
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let matchFormat: string | null = null;
  const remaining: string[] = [];
  for (const line of lines) {
    if (!matchFormat && /^best of\s+\d+/i.test(line)) {
      matchFormat = line;
    } else {
      remaining.push(line);
    }
  }
  return {
    matchFormat,
    matchStage: remaining[0] ?? null,
    matchLocation: remaining[1] ?? null,
  };
}

// ── Lineup extraction ───────────────────────────────────────────────────────

const LINEUP_OPEN_RE = /<div[^>]*class="[^"]*\blineup\b[^"]*"[^>]*>/gi;
const LINEUP_PLAYER_RE = /<a[^>]*href="\/player\/(\d+)\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
const LINEUP_BOUNDARY_RE =
  /<div[^>]*class="(?:[^"]*\blineup\b[^"]*|standard-box veto-box|mapholder|stats-content[^"]*)"/i;

function inferLineup(html: string, team1: TeamSummary, team2: TeamSummary): ParsedLineupPlayer[] {
  const players: ParsedLineupPlayer[] = [];
  const seen = new Set<string>();

  const openings = [...html.matchAll(LINEUP_OPEN_RE)];
  for (let i = 0; i < openings.length; i += 1) {
    const opening = openings[i];
    if (!opening || opening.index === undefined) continue;

    const teamMatch = opening[0].match(/data-team-id="(\d+)"/i);
    let teamId: number | null = teamMatch?.[1] ? Number(teamMatch[1]) : null;

    const bodyStart = opening.index + opening[0].length;
    const nextOpening = openings[i + 1];
    const nextIdx = nextOpening?.index ?? html.length;
    const restAfter = html.slice(bodyStart, nextIdx);
    const boundaryRel = restAfter.search(LINEUP_BOUNDARY_RE);
    const bodyEnd = boundaryRel >= 0 ? bodyStart + boundaryRel : nextIdx;
    const blockHtml = html.slice(bodyStart, bodyEnd);
    if (!blockHtml) continue;

    if (teamId === null) {
      const headerLink = blockHtml.match(/href="\/team\/(\d+)\//i);
      if (headerLink?.[1]) teamId = Number(headerLink[1]);
    }
    if (teamId === null) {
      const headerName = captureText(blockHtml, [/class="teamName[^"]*"[^>]*>([^<]+)/i]);
      if (headerName === team1.name) teamId = team1.hltvTeamId;
      else if (headerName === team2.name) teamId = team2.hltvTeamId;
    }

    for (const playerMatch of blockHtml.matchAll(LINEUP_PLAYER_RE)) {
      const idRaw = playerMatch[1];
      const innerHtml = playerMatch[2] ?? '';
      if (!idRaw) continue;
      const playerHltvId = Number(idRaw);
      const nicknameMatch = innerHtml.match(/class="[^"]*text-ellipsis[^"]*"[^>]*>([^<]+)/i);
      const nickname = decodeHtml(nicknameMatch?.[1]?.trim() ?? plainText(innerHtml));
      if (!nickname) continue;

      const key = `${teamId ?? 'unknown'}:${playerHltvId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      players.push({ teamHltvId: teamId, playerHltvId, nickname });
    }
  }
  return players;
}

// ── Veto extraction ─────────────────────────────────────────────────────────

const VETO_BOX_RE =
  /<div[^>]*class="standard-box veto-box"[^>]*>([\s\S]*?)(?=<div[^>]*class="standard-box(?! veto-box)|<div[^>]*class="mapholder|<div[^>]*class="stats-content|$)/i;
const VETO_LINE_RE = /<div[^>]*>([\s\S]*?)<\/div>/gi;
const VETO_ACTION_RE = /^(\d+)\.\s*(.+?)\s+(removed|picked|banned)\s+(.+?)$/i;
const VETO_REMAINDER_RE = /^(?:(\d+)\.\s*)?(.+?)\s+(?:was\s+)?left\s*over$/i;

function inferVetoes(html: string, teams: TeamSummary[]): ParsedVeto[] {
  const block = html.match(VETO_BOX_RE)?.[1];
  if (!block) return [];

  const paddingOpen = block.match(/<div[^>]*class="padding[^"]*"[^>]*>/i);
  const padding = paddingOpen?.index !== undefined ? block.slice(paddingOpen.index + paddingOpen[0].length) : block;
  const vetoes: ParsedVeto[] = [];
  for (const lineMatch of padding.matchAll(VETO_LINE_RE)) {
    const raw = lineMatch[1] ?? '';
    if (!raw.trim()) continue;
    const text = plainText(raw);
    if (!text) continue;

    const remainder = text.match(VETO_REMAINDER_RE);
    if (remainder) {
      const orderRaw = remainder[1];
      const mapName = remainder[2]?.trim();
      if (!mapName) continue;
      vetoes.push({
        order: orderRaw ? Number(orderRaw) : vetoes.length + 1,
        action: 'remainder',
        teamHltvId: null,
        teamName: null,
        mapName,
      });
      continue;
    }

    const action = text.match(VETO_ACTION_RE);
    if (!action?.[1] || !action[3]) continue;
    const order = Number(action[1]);
    const teamName = action[2]?.trim() ?? null;
    const verb = action[3].toLowerCase();
    const mapName = action[4]?.trim() ?? null;
    const team = teams.find((entry) => entry.name === teamName);
    vetoes.push({
      order,
      action: verb === 'picked' ? 'pick' : 'ban',
      teamHltvId: team?.hltvTeamId ?? null,
      teamName,
      mapName,
    });
  }
  return vetoes;
}

// ── Stream extraction ───────────────────────────────────────────────────────

const STREAMS_BLOCK_RE =
  /<div[^>]*class="streams"[^>]*>([\s\S]*?)(?=<div[^>]*class="(?:mapholder|stats-content|standard-box veto-box)|$)/i;
const STREAM_BOX_RE =
  /<div[^>]*class="stream-box(?![\w-]*dropdown)[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="stream-box(?![\w-]*dropdown)|$)/gi;

function inferStreams(html: string): ParsedStream[] {
  const container = html.match(STREAMS_BLOCK_RE)?.[1];
  if (!container) return [];
  const streams: ParsedStream[] = [];
  const seen = new Set<string>();
  for (const boxMatch of container.matchAll(STREAM_BOX_RE)) {
    const block = boxMatch[1] ?? '';
    if (!block.trim()) continue;
    const url = block.match(/href="(https?:\/\/[^"]+)"/i)?.[1] ?? null;
    const name = captureText(block, [/class="stream-name"[^>]*>([^<]+)/i]);
    const language = captureText(block, [/class="stream-flag-styling"[^>]*>([^<]+)/i]);
    const viewers = captureNumber(block, [/class="viewers"[^>]*>([0-9.,]+)/i]);
    const dedupeKey = url ?? `${name ?? ''}:${language ?? ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    streams.push({ name, url, language, viewers });
  }
  return streams;
}

// ── Map extraction ──────────────────────────────────────────────────────────

const MAP_BLOCK_RE = /<div class="mapholder">([\s\S]*?)(?=<div class="mapholder"|<div class="stats-content"|$)/gi;
const MAPSTATS_HREF_RE = /href="([^"]*\/stats\/matches\/(?:performance\/)?mapstatsid\/(\d+)\/[^"]+)"/i;
const PERFORMANCE_HREF_RE = /href="([^"]*\/stats\/matches\/performance\/mapstatsid\/\d+\/[^"]+)"/i;
const MAP_SCORE_RE = /class="results-team-score[^"]*"[^>]*>([^<]+)/gi;
const HALF_SCORE_BLOCK_RE = /class="results-center-half-score"[^>]*>([\s\S]*?)<\/div>/i;
const HALF_SCORE_NUMBER_RE = /<span[^>]*>(\d+)<\/span>/gi;
const PICK_TEAM_RE = /class="pick"[^>]*>[\s\S]*?class="[^"]*results-teamname[^"]*"[^>]*>([^<]+)/i;

function parseHalfScores(block: string): { team1: number[]; team2: number[] } {
  const inner = block.match(HALF_SCORE_BLOCK_RE)?.[1];
  if (!inner) return { team1: [], team2: [] };
  const numbers = [...inner.matchAll(HALF_SCORE_NUMBER_RE)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n));
  const team1: number[] = [];
  const team2: number[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    team1.push(numbers[i] as number);
    team2.push(numbers[i + 1] as number);
  }
  return { team1, team2 };
}

function resolveMapStatus(name: string, t1: number | null, t2: number | null): MapStatus {
  if (name === 'TBA' || name === 'Default') return 'tba';
  if (t1 === null && t2 === null) return 'upcoming';
  if (t1 === 0 && t2 === 0) return 'upcoming';
  return 'played';
}

function resolvePickTeamId(block: string, team1: TeamSummary, team2: TeamSummary): number | null {
  const name = captureText(block, [PICK_TEAM_RE]);
  if (!name) return null;
  if (name === team1.name) return team1.hltvTeamId;
  if (name === team2.name) return team2.hltvTeamId;
  return null;
}

function resolveMapWinner(t1: number | null, t2: number | null, team1: TeamSummary, team2: TeamSummary): number | null {
  if (t1 === null || t2 === null) return null;
  if (t1 === t2) return null;
  return t1 > t2 ? team1.hltvTeamId : team2.hltvTeamId;
}

function inferMaps(html: string, matchUrl: string, team1: TeamSummary, team2: TeamSummary): ParsedMap[] {
  const maps: ParsedMap[] = [];
  const seen = new Set<string>();
  let order = 0;

  for (const blockMatch of html.matchAll(MAP_BLOCK_RE)) {
    const block = blockMatch[1];
    if (!block) continue;

    const mapName = captureText(block, [/class="mapname[^"]*"[^>]*>([^<]+)/i]);
    if (!mapName || mapName === 'Default' || mapName === 'TBA') continue;

    const statsHrefMatch = block.match(MAPSTATS_HREF_RE);
    const performanceHrefMatch = block.match(PERFORMANCE_HREF_RE);
    const mapId = statsHrefMatch?.[2] ? Number(statsHrefMatch[2]) : null;
    const scores = [...block.matchAll(MAP_SCORE_RE)].map((m) => Number(m[1]));
    const sourceUrl = statsHrefMatch?.[1] ? `https://www.hltv.org${statsHrefMatch[1]}` : matchUrl;
    const performanceUrl = performanceHrefMatch?.[1] ? `https://www.hltv.org${performanceHrefMatch[1]}` : null;

    const dedupeKey = mapId !== null ? `map-id:${mapId}` : `map-name:${mapName}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    order += 1;
    const team1Score = Number.isFinite(scores[0]) ? (scores[0] as number) : null;
    const team2Score = Number.isFinite(scores[1]) ? (scores[1] as number) : null;
    const halfScores = parseHalfScores(block);

    maps.push({
      hltvMapId: mapId,
      mapName,
      sourceUrl,
      team1Score,
      team2Score,
      order,
      status: resolveMapStatus(mapName, team1Score, team2Score),
      pickTeamHltvId: resolvePickTeamId(block, team1, team2),
      winnerTeamHltvId: resolveMapWinner(team1Score, team2Score, team1, team2),
      team1HalfScores: halfScores.team1,
      team2HalfScores: halfScores.team2,
      performanceUrl,
    });
  }

  return maps;
}

// ── Player stats extraction ─────────────────────────────────────────────────

const STATS_SECTION_RE =
  /<div class="stats-content" id="([^"\s]+)-content">([\s\S]*?)(?=<div class="stats-content"|$)/gi;
const STATS_TABLE_RE = /<table class="table totalstats">([\s\S]*?)<\/table>/gi;
const TABLE_ROW_RE = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
const KD_RE = /class="kd[^"]*traditional-data[^>]*>\s*(\d+)\s*-\s*(\d+)\s*</i;
const PLUS_MINUS_RE = /class="plus-minus[^"]*"[^>]*>\s*([+-]?\d+)/i;
const FK_DIFF_RE = /class="(?:fkdiff|fk-diff)[^"]*"[^>]*>\s*([+-]?\d+)/i;
const RATING_VERSION_RE = /data-rating-version="([^"]+)"/i;

interface PlayerRowCore {
  playerHltvId: number;
  nickname: string;
  kills: number | null;
  deaths: number | null;
  kdDiff: number | null;
  firstKillDiff: number | null;
  adr: number | null;
  rating: number | null;
  ratingVersion: string | null;
  kast: number | null;
}

function parsePlayerRowCore(rowHtml: string): PlayerRowCore | null {
  const playerIdMatch = rowHtml.match(/href="\/player\/(\d+)\//i);
  if (!playerIdMatch?.[1]) return null;

  const nickname =
    captureText(rowHtml, [
      /class="player-nick">([^<]+)/i,
      /class="smartphone-only statsPlayerName text-ellipsis">([^<]+)/i,
      /class="statsPlayerName text-ellipsis">([^<]+)/i,
    ]) ?? 'Unknown';

  const kdMatch = rowHtml.match(KD_RE);
  const plusMinusMatch = rowHtml.match(PLUS_MINUS_RE);
  const fkDiffMatch = rowHtml.match(FK_DIFF_RE);
  const adr = captureNumber(rowHtml, [/class="adr[^"]*traditional-data[^>]*>([0-9.]+)/i]);
  const kast = captureNumber(rowHtml, [/class="kast[^"]*traditional-data[^>]*>([0-9.]+)%/i]);
  const rating = captureNumber(rowHtml, [/class="rating[^"]*"[^>]*>([0-9.]+)/i, /class="rating[^"]*">([0-9.]+)/i]);
  const ratingVersionMatch = rowHtml.match(RATING_VERSION_RE);

  return {
    playerHltvId: Number(playerIdMatch[1]),
    nickname,
    kills: kdMatch?.[1] ? Number(kdMatch[1]) : null,
    deaths: kdMatch?.[2] ? Number(kdMatch[2]) : null,
    kdDiff: plusMinusMatch?.[1] ? Number(plusMinusMatch[1]) : null,
    firstKillDiff: fkDiffMatch?.[1] ? Number(fkDiffMatch[1]) : null,
    adr,
    rating,
    ratingVersion: ratingVersionMatch?.[1] ?? null,
    kast,
  };
}

function resolveTableTeamId(tableHtml: string, team1: TeamSummary, team2: TeamSummary): number | null {
  const idMatch = tableHtml.match(/href="\/team\/(\d+)\/[^"]*" class="teamName team"/i);
  if (idMatch?.[1]) return Number(idMatch[1]);

  const nameMatch = tableHtml.match(/class="teamName team">([^<]+)/i);
  const headerName = nameMatch?.[1]?.trim() ?? null;
  if (headerName === team1.name) return team1.hltvTeamId;
  if (headerName === team2.name) return team2.hltvTeamId;
  return null;
}

function inferPerMapStats(html: string, maps: ParsedMap[], team1: TeamSummary, team2: TeamSummary): ParsedPlayerStat[] {
  const results: ParsedPlayerStat[] = [];

  for (const sectionMatch of html.matchAll(STATS_SECTION_RE)) {
    const sectionId = sectionMatch[1];
    const sectionHtml = sectionMatch[2];
    if (!sectionId || !sectionHtml || sectionId === 'all') continue;

    const map = maps.find((entry) => String(entry.hltvMapId) === sectionId);
    if (!map) continue;

    for (const tableMatch of sectionHtml.matchAll(STATS_TABLE_RE)) {
      const tableHtml = tableMatch[1];
      if (!tableHtml) continue;

      const teamId = resolveTableTeamId(tableHtml, team1, team2);

      for (const rowMatch of tableHtml.matchAll(TABLE_ROW_RE)) {
        const rowHtml = rowMatch[1];
        if (!rowHtml) continue;
        const core = parsePlayerRowCore(rowHtml);
        if (!core) continue;
        results.push({
          ...core,
          teamHltvId: teamId,
          mapName: map.mapName,
          sourceUrl: map.sourceUrl,
        });
      }
    }
  }
  return results;
}

const ALL_SECTION_RE = /<div class="stats-content" id="all-content">([\s\S]*?)(?=<div class="stats-content"|$)/i;

function inferAggregateStats(html: string, team1: TeamSummary, team2: TeamSummary): ParsedPlayerMatchStat[] {
  const results: ParsedPlayerMatchStat[] = [];
  const sectionHtml = html.match(ALL_SECTION_RE)?.[1];
  if (!sectionHtml) return results;

  for (const tableMatch of sectionHtml.matchAll(STATS_TABLE_RE)) {
    const tableHtml = tableMatch[1];
    if (!tableHtml) continue;

    const teamId = resolveTableTeamId(tableHtml, team1, team2);

    for (const rowMatch of tableHtml.matchAll(TABLE_ROW_RE)) {
      const rowHtml = rowMatch[1];
      if (!rowHtml) continue;
      const core = parsePlayerRowCore(rowHtml);
      if (!core) continue;
      results.push({ ...core, teamHltvId: teamId, sourceUrl: null });
    }
  }
  return results;
}

// ── Demo URL extraction ─────────────────────────────────────────────────────

function inferDemoUrl(html: string): string | null {
  const m = html.match(/data-demo-link="([^"]+)"/i) || html.match(/href="([^"]*\/download\/demo\/[^"]+)"/i);
  if (!m?.[1]) return null;
  return m[1].startsWith('http') ? m[1] : `https://www.hltv.org${m[1]}`;
}

// ── Status classification ───────────────────────────────────────────────────

function classifyStatus(maps: ParsedMap[], playerStats: ParsedPlayerStat[]): MatchStatus {
  if (maps.length > 0 && playerStats.length > 0) return 'parsed';
  return 'partial';
}

// ── Main entry points ───────────────────────────────────────────────────────

function emptyParsed(matchUrl: string): ParsedMatch {
  const hltvMatchId = extractMatchIdFromUrl(matchUrl);
  return {
    hltvMatchId,
    slug: extractMatchSlug(matchUrl),
    sourceUrl: matchUrl,
    eventName: null,
    eventHltvId: null,
    eventSourceUrl: null,
    matchStage: null,
    matchFormat: null,
    matchLocation: null,
    matchStatus: null,
    bestOf: null,
    scheduledAt: null,
    team1: { hltvTeamId: null, name: 'Unknown', rank: null },
    team2: { hltvTeamId: null, name: 'Unknown', rank: null },
    team1Score: null,
    team2Score: null,
    winnerTeamId: null,
    status: 'challenge',
    maps: [],
    playerStats: [],
    playerAggregateStats: [],
    vetoes: [],
    lineup: [],
    streams: [],
    rawDemoUrl: null,
    parserVersion: PARSER_VERSION,
    parseWarnings: [],
  };
}

export function parseMatchHtml(matchUrl: string, html: string): ParsedMatch {
  if (isCloudflareChallenge(html)) {
    return emptyParsed(matchUrl);
  }

  const warnings: string[] = [];
  const hltvMatchId = extractMatchIdFromUrl(matchUrl);
  const slug = extractMatchSlug(matchUrl);

  const { team1, team2 } = inferTeamSummaries(html);
  if (team1.hltvTeamId === null) warnings.push('team1 metadata missing');
  if (team2.hltvTeamId === null) warnings.push('team2 metadata missing');

  const team1Score = captureNumber(html, [
    /class="team1-gradient[\s\S]*?class="won"[^>]*>(\d+)/i,
    /class="team1-gradient[\s\S]*?class="score"[^>]*>(\d+)/i,
  ]);
  const team2Score = captureNumber(html, [
    /class="team2-gradient[\s\S]*?class="won"[^>]*>(\d+)/i,
    /class="team2-gradient[\s\S]*?class="score"[^>]*>(\d+)/i,
  ]);

  const event = inferEvent(html);
  if (event.eventHltvId === null) warnings.push('event link missing');

  const bestOf = captureNumber(html, [/Best of (\d+)/i, /bo(\d+)/i]);
  const scheduledUnix = captureNumber(html, [/data-unix="(\d{10,13})"/i]);
  const scheduledAt = scheduledUnix
    ? new Date(scheduledUnix > 9999999999 ? scheduledUnix : scheduledUnix * 1000).toISOString()
    : null;

  const matchStatus = inferMatchStatus(html);
  const matchMeta = inferMatchMeta(html);

  const maps = inferMaps(html, matchUrl, team1, team2);
  if (maps.length === 0) warnings.push('no maps found');

  const playerStats = inferPerMapStats(html, maps, team1, team2);
  const playerAggregateStats = inferAggregateStats(html, team1, team2);
  if (maps.length > 0 && playerStats.length === 0 && playerAggregateStats.length === 0) {
    warnings.push('no player stats found');
  }

  const vetoes = inferVetoes(html, [team1, team2]);
  const lineup = inferLineup(html, team1, team2);
  const streams = inferStreams(html);
  const rawDemoUrl = inferDemoUrl(html);

  let winnerTeamId: number | null = null;
  if (team1Score !== null && team2Score !== null) {
    winnerTeamId = team1Score > team2Score ? team1.hltvTeamId : team2Score > team1Score ? team2.hltvTeamId : null;
  }

  return {
    hltvMatchId,
    slug,
    sourceUrl: matchUrl,
    eventName: event.eventName,
    eventHltvId: event.eventHltvId,
    eventSourceUrl: event.eventSourceUrl,
    matchStage: matchMeta.matchStage,
    matchFormat: matchMeta.matchFormat,
    matchLocation: matchMeta.matchLocation,
    matchStatus,
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
    playerAggregateStats,
    vetoes,
    lineup,
    streams,
    rawDemoUrl,
    parserVersion: PARSER_VERSION,
    parseWarnings: warnings,
  };
}

export function discoverMatchUrls(baseUrl: string, html: string): string[] {
  const links = [...html.matchAll(/href="([^"]*\/matches\/\d+\/[^"]+)"/gi)]
    .map((m) => m[1])
    .filter((href): href is string => typeof href === 'string')
    .map((href) => (href.startsWith('http') ? href : `${baseUrl}${href}`));
  return [...new Set(links)];
}

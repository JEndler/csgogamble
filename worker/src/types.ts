import type { MatchStatus } from './contracts';

export type AcquisitionMode =
  | 'http'
  | 'http-stealth'
  | 'browser'
  | 'browser-native'
  | 'browser-stealth'
  | 'browser-session'
  | 'browser-session-stealth';

export interface DiscoverQueueMessage {
  type: 'discover-results';
  payload: {
    pageUrl?: string;
    html?: string;
    persistHtml?: boolean;
    source?: string;
    acquisitionMode?: AcquisitionMode;
    browserSessionKey?: string;
    maxMatches?: number;
    /**
     * Canary discoveries open the discovery circuit on the very first challenge
     * (threshold=1) and, on success, enqueue a follow-up fan-out discovery
     * sized by `followupMaxMatches`. This keeps a single bad cron tick from
     * fanning out into a full per-match acquisition storm.
     */
    canary?: boolean;
    followupMaxMatches?: number;
  };
}

export interface IngestMatchQueueMessage {
  type: 'ingest-match';
  payload: {
    matchUrl?: string;
    matchId?: number;
    html?: string;
    persistHtml?: boolean;
    source?: string;
    acquisitionMode?: AcquisitionMode;
    browserSessionKey?: string;
    /** Optional backfill bookkeeping: when present, the consumer finalizes the
     * candidate row after the ingest call completes (parsed, partial, challenge,
     * skipped, or failed_classified). */
    backfillRunId?: number;
    backfillCandidateId?: number;
  };
}

export type WorkerQueueMessage = DiscoverQueueMessage | IngestMatchQueueMessage;

/** Worker environment bindings used by HTTP handlers and persistence code. */
export interface Env {
  DB: D1Database;
  RAW_HTML: R2Bucket;
  DEMOS: R2Bucket;
  /**
   * Dedicated R2 bucket for Polymarket raw artifacts (gamma pages, CLOB
   * market detail, raw price-history JSON, normalized JSONL series). D1 only
   * stores manifest pointers; the actual payloads live here.
   */
  POLYMARKET_DATA: R2Bucket;
  BROWSER: Fetcher;
  BROWSER_SESSION: DurableObjectNamespace;
  HLTV_BASE_URL: string;
  INGESTION_QUEUE: Queue<WorkerQueueMessage>;
  ADMIN_TOKEN?: string;
}

/** Input body for `/ingest/match`. */
export interface MatchIngestRequest {
  matchUrl?: string;
  matchId?: number;
  html?: string;
  persistHtml?: boolean;
  acquisitionMode?: AcquisitionMode;
  browserSessionKey?: string;
}

/** Input body for `/discover/results`. */
export interface DiscoverRequest {
  pageUrl?: string;
  html?: string;
  acquisitionMode?: AcquisitionMode;
  browserSessionKey?: string;
  maxMatches?: number;
}

/** Input body for `/ingest/demo`. */
export interface DemoIngestRequest {
  matchId: number;
  rawDemoUrl: string;
  demoR2Key: string;
  downloadFileName?: string;
  contentType?: string;
  byteSize?: number;
}

/** Minimal team metadata parsed from an HLTV match page. */
export interface TeamSummary {
  hltvTeamId: number | null;
  name: string;
  rank: number | null;
}

/** Lifecycle status for a single map within a best-of-N match. */
export type MapStatus = 'played' | 'upcoming' | 'tba';

/** Map-level metadata parsed from an HLTV match page. */
export interface ParsedMap {
  hltvMapId: number | null;
  mapName: string;
  sourceUrl: string | null;
  team1Score: number | null;
  team2Score: number | null;
  order: number;
  status: MapStatus;
  pickTeamHltvId: number | null;
  winnerTeamHltvId: number | null;
  team1HalfScores: number[];
  team2HalfScores: number[];
  performanceUrl: string | null;
}

/** Per-player, per-map stats parsed from an HLTV match page. */
export interface ParsedPlayerStat {
  playerHltvId: number;
  nickname: string;
  teamHltvId: number | null;
  mapName: string;
  kills: number | null;
  deaths: number | null;
  kdDiff: number | null;
  firstKillDiff: number | null;
  adr: number | null;
  rating: number | null;
  ratingVersion: string | null;
  kast: number | null;
  sourceUrl: string | null;
}

/** Aggregate (all-maps) per-player stats parsed from the all-content stats section. */
export interface ParsedPlayerMatchStat {
  playerHltvId: number;
  nickname: string;
  teamHltvId: number | null;
  kills: number | null;
  deaths: number | null;
  kdDiff: number | null;
  firstKillDiff: number | null;
  adr: number | null;
  rating: number | null;
  ratingVersion: string | null;
  kast: number | null;
  sourceUrl: string | null;
}

/** Possible veto actions in the veto box. */
export type VetoAction = 'pick' | 'ban' | 'remainder';

/** A single step in the veto sequence. */
export interface ParsedVeto {
  order: number;
  action: VetoAction;
  teamHltvId: number | null;
  teamName: string | null;
  mapName: string | null;
}

/** A starting-lineup entry for a team in a match. */
export interface ParsedLineupPlayer {
  teamHltvId: number | null;
  playerHltvId: number;
  nickname: string;
}

/** A broadcast stream listed on the match page. */
export interface ParsedStream {
  name: string | null;
  url: string | null;
  language: string | null;
  viewers: number | null;
}

/** Fully parsed match payload before persistence. */
export interface ParsedMatch {
  hltvMatchId: number;
  slug: string | null;
  sourceUrl: string;
  eventName: string | null;
  eventHltvId: number | null;
  eventSourceUrl: string | null;
  matchStage: string | null;
  matchFormat: string | null;
  matchLocation: string | null;
  matchStatus: string | null;
  bestOf: number | null;
  scheduledAt: string | null;
  team1: TeamSummary;
  team2: TeamSummary;
  team1Score: number | null;
  team2Score: number | null;
  winnerTeamId: number | null;
  status: MatchStatus;
  maps: ParsedMap[];
  playerStats: ParsedPlayerStat[];
  playerAggregateStats: ParsedPlayerMatchStat[];
  vetoes: ParsedVeto[];
  lineup: ParsedLineupPlayer[];
  streams: ParsedStream[];
  rawDemoUrl: string | null;
  parserVersion: string;
  parseWarnings: string[];
}

/** Metadata returned after storing a raw artifact in R2. */
export interface PersistedArtifactResult {
  key: string;
  size: number;
  sha256: string;
}

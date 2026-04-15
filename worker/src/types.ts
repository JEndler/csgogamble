import type { MatchStatus } from './contracts';

export type AcquisitionMode = 'http' | 'browser' | 'browser-session';

export interface DiscoverQueueMessage {
  type: 'discover-results';
  payload: {
    pageUrl?: string;
    html?: string;
    persistHtml?: boolean;
    source?: string;
    acquisitionMode?: AcquisitionMode;
    browserSessionKey?: string;
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
  };
}

export type WorkerQueueMessage = DiscoverQueueMessage | IngestMatchQueueMessage;

/** Worker environment bindings used by HTTP handlers and persistence code. */
export interface Env {
  DB: D1Database;
  RAW_HTML: R2Bucket;
  DEMOS: R2Bucket;
  BROWSER: Fetcher;
  BROWSER_SESSION: DurableObjectNamespace;
  HLTV_BASE_URL: string;
  INGESTION_QUEUE: Queue<WorkerQueueMessage>;
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
}

/** Map-level metadata parsed from an HLTV match page. */
export interface ParsedMap {
  hltvMapId: number | null;
  mapName: string;
  sourceUrl: string | null;
  team1Score: number | null;
  team2Score: number | null;
}

/** Per-player, per-map stats parsed from an HLTV match page. */
export interface ParsedPlayerStat {
  playerHltvId: number;
  nickname: string;
  teamHltvId: number | null;
  mapName: string;
  kills: number | null;
  deaths: number | null;
  adr: number | null;
  rating: number | null;
  kast: number | null;
  sourceUrl: string | null;
}

/** Fully parsed match payload before persistence. */
export interface ParsedMatch {
  hltvMatchId: number;
  slug: string | null;
  sourceUrl: string;
  eventName: string | null;
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
  rawDemoUrl: string | null;
  parserVersion: string;
}

/** Metadata returned after storing a raw artifact in R2. */
export interface PersistedArtifactResult {
  key: string;
  size: number;
  sha256: string;
}

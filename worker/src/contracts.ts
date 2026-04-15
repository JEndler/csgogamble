import type {
  AcquisitionMode,
  DemoIngestRequest,
  DiscoverRequest,
  MatchIngestRequest,
  ParsedMatch,
  PersistedArtifactResult,
} from './types';

/** Canonical match lifecycle values persisted in D1. */
export type MatchStatus = 'pending' | 'parsed' | 'partial' | 'challenge' | 'error';

/** Base error response returned by HTTP handlers. */
export interface ErrorResponse {
  ok: false;
  error: string;
}

/** Health check response. */
export interface HealthResponse {
  ok: true;
  service: 'csgogamble-worker';
  hasRawHtmlBucket: boolean;
  hasDemoBucket: boolean;
}

/** Successful response for `/discover/results`. */
export interface DiscoverResultsResponse {
  ok: true;
  pageUrl: string;
  discovered: number;
  matchUrls: string[];
}

/** Successful response for `/ingest/demo`. */
export interface RecordDemoResponse {
  ok: true;
  matchId: number;
  demoR2Key: string;
  rawDemoUrl: string;
}

/** Successful response for `/ingest/match`. */
export interface IngestMatchResponse {
  ok: true;
  fetchedAt: string;
  parsed: ParsedMatch;
  artifact: PersistedArtifactResult | null;
  notes: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readOptionalAcquisitionMode(value: unknown): AcquisitionMode | undefined {
  return value === 'http' || value === 'browser' || value === 'browser-session' ? value : undefined;
}

/** Convert an unknown payload into a validated match-ingest request. */
export function parseMatchIngestRequest(payload: unknown): MatchIngestRequest {
  if (!isRecord(payload)) {
    throw new Error('Match ingest body must be an object');
  }

  const request: MatchIngestRequest = {
    matchUrl: readOptionalString(payload.matchUrl),
    matchId: readOptionalNumber(payload.matchId),
    html: readOptionalString(payload.html),
    persistHtml: readOptionalBoolean(payload.persistHtml),
    acquisitionMode: readOptionalAcquisitionMode(payload.acquisitionMode),
    browserSessionKey: readOptionalString(payload.browserSessionKey),
  };

  if (!request.matchUrl && request.matchId === undefined) {
    throw new Error('Expected either matchUrl or matchId');
  }

  return request;
}

/** Convert an unknown payload into a validated results-discovery request. */
export function parseDiscoverRequest(payload: unknown): DiscoverRequest {
  if (!isRecord(payload)) {
    throw new Error('Results discovery body must be an object');
  }

  return {
    pageUrl: readOptionalString(payload.pageUrl),
    html: readOptionalString(payload.html),
    acquisitionMode: readOptionalAcquisitionMode(payload.acquisitionMode),
    browserSessionKey: readOptionalString(payload.browserSessionKey),
    maxMatches: readOptionalPositiveInteger(payload.maxMatches),
  };
}

/** Convert an unknown payload into a validated demo-ingest request. */
export function parseDemoIngestRequest(payload: unknown): DemoIngestRequest {
  if (!isRecord(payload)) {
    throw new Error('Demo ingest body must be an object');
  }

  const matchId = readOptionalNumber(payload.matchId);
  const rawDemoUrl = readOptionalString(payload.rawDemoUrl);
  const demoR2Key = readOptionalString(payload.demoR2Key);

  if (matchId === undefined) {
    throw new Error('Demo ingest requires a numeric matchId');
  }
  if (!rawDemoUrl) {
    throw new Error('Demo ingest requires rawDemoUrl');
  }
  if (!demoR2Key) {
    throw new Error('Demo ingest requires demoR2Key');
  }

  return {
    matchId,
    rawDemoUrl,
    demoR2Key,
    downloadFileName: readOptionalString(payload.downloadFileName),
    contentType: readOptionalString(payload.contentType),
    byteSize: readOptionalNumber(payload.byteSize),
  };
}

import { acquirePageSnapshot } from './acquisition';
import type { DiscoverResultsResponse, IngestMatchResponse, RecordDemoResponse } from './contracts';
import { persistParsedMatch, recordDemoArtifact, recordIngestError, setCrawlCursor } from './db';
import {
  buildMatchUrl,
  buildResultsUrl,
  discoverMatchUrls,
  extractMatchIdFromUrl,
  isCloudflareChallenge,
  parseMatchHtml,
} from './hltv';
import { errorResponse, jsonResponse } from './http-response';
import { htmlStorageKey, putTextArtifact } from './storage';
import type { DemoIngestRequest, DiscoverRequest, Env, MatchIngestRequest } from './types';
import { nowIso } from './utils';

/** Fetch, parse, and persist a single match page. */
export async function handleIngestMatch(env: Env, request: MatchIngestRequest): Promise<Response> {
  const matchUrl = buildMatchUrl(env.HLTV_BASE_URL, request);
  const hltvMatchId = request.matchId ?? extractMatchIdFromUrl(matchUrl);

  try {
    const snapshot = request.html
      ? {
          requestedUrl: matchUrl,
          finalUrl: matchUrl,
          html: request.html,
          title: null,
        }
      : await acquirePageSnapshot(env, matchUrl, request.acquisitionMode, request.browserSessionKey);
    const parsed = parseMatchHtml(matchUrl, snapshot.html);
    const artifact =
      request.persistHtml === false
        ? null
        : await putTextArtifact(
            env.RAW_HTML,
            htmlStorageKey(parsed.hltvMatchId),
            snapshot.html,
            'text/html; charset=utf-8',
          );

    await persistParsedMatch(env, parsed, artifact);

    const notes = artifact ? [] : ['RAW_HTML persistence disabled for this request'];
    if (request.acquisitionMode && request.acquisitionMode !== 'http') {
      notes.push(`Acquired via ${request.acquisitionMode}`);
    }
    if (snapshot.finalUrl !== matchUrl) {
      notes.push(`Browser final URL differed from requested URL: ${snapshot.finalUrl}`);
    }

    const response: IngestMatchResponse = {
      ok: true,
      fetchedAt: nowIso(),
      parsed,
      artifact,
      notes,
    };

    return jsonResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordIngestError(env, hltvMatchId, matchUrl, message);
    return errorResponse(message, 500);
  }
}

/** Discover match URLs from an HLTV results page. */
export async function handleDiscoverResults(env: Env, request: DiscoverRequest): Promise<Response> {
  try {
    const pageUrl = buildResultsUrl(env.HLTV_BASE_URL, request);
    const snapshot = request.html
      ? {
          requestedUrl: pageUrl,
          finalUrl: pageUrl,
          html: request.html,
          title: null,
        }
      : await acquirePageSnapshot(env, pageUrl, request.acquisitionMode, request.browserSessionKey);
    if (isCloudflareChallenge(snapshot.html)) {
      return errorResponse('HLTV results discovery hit a Cloudflare challenge page', 503);
    }

    const matchUrls = discoverMatchUrls(env.HLTV_BASE_URL, snapshot.html);
    await setCrawlCursor(env, 'last_results_page', pageUrl);

    const response: DiscoverResultsResponse = {
      ok: true,
      pageUrl,
      discovered: matchUrls.length,
      matchUrls,
    };

    return jsonResponse(response);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to discover results', 500);
  }
}

/** Record metadata for a demo file that has already been uploaded to R2. */
export async function handleRecordDemo(env: Env, request: DemoIngestRequest): Promise<Response> {
  try {
    await recordDemoArtifact(
      env,
      request.matchId,
      request.rawDemoUrl,
      request.demoR2Key,
      request.byteSize ?? null,
      request.contentType ?? null,
    );

    const response: RecordDemoResponse = {
      ok: true,
      matchId: request.matchId,
      demoR2Key: request.demoR2Key,
      rawDemoUrl: request.rawDemoUrl,
    };

    return jsonResponse(response);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to record demo metadata', 500);
  }
}

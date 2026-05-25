// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: legacy parser/ops control-flow; refactor separately, do not block hygiene gate.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: legacy parser/test fixtures are intentionally dense; refactor separately.
import { handleAcquisitionCanary } from './acquisition-canary';
import { handleBackfillEnqueue, handleBackfillStart, handleBackfillStatus, handleDiscoveryEnqueue } from './admin';
import {
  handleBrowserHistoryDebug,
  handleBrowserLimitsDebug,
  handleBrowserMatchDebug,
  handleBrowserResultsDebug,
  handleBrowserSessionClose,
  handleBrowserSessionsDebug,
} from './browser-debug';
import {
  type HealthResponse,
  parseDemoIngestRequest,
  parseDiscoverRequest,
  parseMatchIngestRequest,
} from './contracts';
import { handleDiscoverResults, handleIngestMatch, handleRecordDemo } from './handlers';
import { errorResponse, jsonResponse } from './http-response';
import {
  handlePolymarketGammaRun,
  handlePolymarketPriceHistoryRun,
  handlePolymarketStatus,
} from './polymarket/handlers';
import type { Env } from './types';

function notFound(): Response {
  return errorResponse('Not found', 404);
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/health') {
    const response: HealthResponse = {
      ok: true,
      service: 'csgogamble-worker',
      hasRawHtmlBucket: Boolean(env.RAW_HTML),
      hasDemoBucket: Boolean(env.DEMOS),
      hasPolymarketDataBucket: Boolean(env.POLYMARKET_DATA),
    };
    return jsonResponse(response);
  }

  if (request.method === 'GET' && url.pathname === '/admin/polymarket/status') {
    return handlePolymarketStatus(request, env);
  }

  if (request.method === 'POST' && url.pathname === '/admin/polymarket/gamma/run') {
    try {
      return await handlePolymarketGammaRun(request, env);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Invalid Polymarket gamma request', 400);
    }
  }

  if (request.method === 'POST' && url.pathname === '/admin/polymarket/price-history/run') {
    try {
      return await handlePolymarketPriceHistoryRun(request, env);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Invalid Polymarket price-history request', 400);
    }
  }

  if (request.method === 'GET' && url.pathname === '/debug/browser/results') {
    return handleBrowserResultsDebug(env, url.searchParams.get('pageUrl') ?? undefined);
  }

  if (request.method === 'GET' && url.pathname === '/debug/browser/limits') {
    return handleBrowserLimitsDebug(env);
  }

  if (request.method === 'GET' && url.pathname === '/debug/browser/sessions') {
    return handleBrowserSessionsDebug(env);
  }

  if (request.method === 'GET' && url.pathname === '/debug/browser/history') {
    return handleBrowserHistoryDebug(env);
  }

  if (request.method === 'POST' && url.pathname === '/debug/browser/session/close') {
    return handleBrowserSessionClose(request, env);
  }

  if (request.method === 'POST' && url.pathname === '/debug/browser/match') {
    return handleBrowserMatchDebug(request, env);
  }

  if (request.method === 'POST' && url.pathname === '/ingest/match') {
    try {
      return await handleIngestMatch(env, parseMatchIngestRequest(await request.json()));
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Invalid match ingest body', 400);
    }
  }

  if (request.method === 'POST' && url.pathname === '/discover/results') {
    try {
      return await handleDiscoverResults(env, parseDiscoverRequest(await request.json()));
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Invalid discover body', 400);
    }
  }

  if (request.method === 'POST' && url.pathname === '/admin/acquisition/canary') {
    try {
      return await handleAcquisitionCanary(request, env);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Invalid acquisition canary body', 400);
    }
  }

  if (request.method === 'POST' && url.pathname === '/admin/discovery/enqueue') {
    try {
      return await handleDiscoveryEnqueue(request, env);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Invalid discovery enqueue body', 400);
    }
  }

  if (request.method === 'POST' && url.pathname === '/admin/backfill/start') {
    try {
      return await handleBackfillStart(request, env);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Invalid backfill start body', 400);
    }
  }

  if (request.method === 'POST' && url.pathname === '/admin/backfill/enqueue') {
    try {
      return await handleBackfillEnqueue(request, env);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Invalid backfill enqueue body', 400);
    }
  }

  if (request.method === 'POST' && url.pathname === '/admin/backfill/status') {
    try {
      return await handleBackfillStatus(request, env);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Invalid backfill status body', 400);
    }
  }

  if (request.method === 'POST' && url.pathname === '/ingest/demo') {
    try {
      return await handleRecordDemo(env, parseDemoIngestRequest(await request.json()));
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Invalid demo ingest body', 400);
    }
  }

  return notFound();
}

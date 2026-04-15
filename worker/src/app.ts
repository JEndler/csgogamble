import { handleBrowserMatchDebug, handleBrowserResultsDebug, handleBrowserSessionClose } from './browser-debug';
import {
  type HealthResponse,
  parseDemoIngestRequest,
  parseDiscoverRequest,
  parseMatchIngestRequest,
} from './contracts';
import { handleDiscoverResults, handleIngestMatch, handleRecordDemo } from './handlers';
import { errorResponse, jsonResponse } from './http-response';
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
    };
    return jsonResponse(response);
  }

  if (request.method === 'GET' && url.pathname === '/debug/browser/results') {
    return handleBrowserResultsDebug(env, url.searchParams.get('pageUrl') ?? undefined);
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

  if (request.method === 'POST' && url.pathname === '/ingest/demo') {
    try {
      return await handleRecordDemo(env, parseDemoIngestRequest(await request.json()));
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Invalid demo ingest body', 400);
    }
  }

  return notFound();
}

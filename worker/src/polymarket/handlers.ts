import { errorResponse, jsonResponse } from '../http-response';
import type { Env } from '../types';
import {
  type GammaIngestInput,
  getPolymarketStatus,
  type PriceHistoryIngestInput,
  runGammaIngest,
  runPriceHistoryIngest,
} from './ingest';

function isAuthorized(request: Request, env: Env): boolean {
  const adminToken = env.ADMIN_TOKEN;
  const header = request.headers.get('x-admin-token');
  return Boolean(adminToken) && Boolean(header) && header === adminToken;
}

function requireAdmin(request: Request, env: Env): Response | null {
  return isAuthorized(request, env) ? null : errorResponse('Unauthorized', 401);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseGammaBody(payload: unknown): GammaIngestInput {
  if (!isRecord(payload)) throw new Error('Polymarket gamma body must be an object');
  return {
    runId: readNumber(payload.runId),
    cursor: payload.cursor === null ? null : readString(payload.cursor),
    pageIndex: readNumber(payload.pageIndex),
    maxPages: readNumber(payload.maxPages),
    pageLimit: readNumber(payload.pageLimit),
    tagId: readNumber(payload.tagId),
    closed: readBoolean(payload.closed),
    archived: readBoolean(payload.archived),
  };
}

function parsePriceHistoryBody(payload: unknown): PriceHistoryIngestInput {
  if (!isRecord(payload)) throw new Error('Polymarket price-history body must be an object');
  const tokenIds = Array.isArray(payload.tokenIds)
    ? payload.tokenIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : undefined;
  const interval = readString(payload.interval) as PriceHistoryIngestInput['interval'];
  return {
    runId: readNumber(payload.runId),
    tokenIds,
    marketType: readString(payload.marketType) as PriceHistoryIngestInput['marketType'],
    limit: readNumber(payload.limit),
    interval,
    fidelityMinutes: readNumber(payload.fidelityMinutes),
    startTs: readNumber(payload.startTs),
    endTs: readNumber(payload.endTs),
    onlyMissing: readBoolean(payload.onlyMissing),
  };
}

export async function handlePolymarketGammaRun(request: Request, env: Env): Promise<Response> {
  const unauthorized = requireAdmin(request, env);
  if (unauthorized) return unauthorized;
  const input = parseGammaBody(await request.json());
  try {
    return jsonResponse(await runGammaIngest(env, input));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Polymarket gamma ingest failed', 500);
  }
}

export async function handlePolymarketPriceHistoryRun(request: Request, env: Env): Promise<Response> {
  const unauthorized = requireAdmin(request, env);
  if (unauthorized) return unauthorized;
  const input = parsePriceHistoryBody(await request.json());
  try {
    return jsonResponse(await runPriceHistoryIngest(env, input));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Polymarket price-history ingest failed', 500);
  }
}

export async function handlePolymarketStatus(request: Request, env: Env): Promise<Response> {
  const unauthorized = requireAdmin(request, env);
  if (unauthorized) return unauthorized;
  return jsonResponse(await getPolymarketStatus(env));
}

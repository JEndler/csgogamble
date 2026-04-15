import type { ErrorResponse } from './contracts';

/** Create a JSON response with a consistent content type header. */
export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

/** Create a structured error response for invalid requests or internal failures. */
export function errorResponse(error: string, status = 500): Response {
  const body: ErrorResponse = { ok: false, error };
  return jsonResponse(body, { status });
}

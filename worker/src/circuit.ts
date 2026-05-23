import type { Env } from './types';
import { nowIso } from './utils';

/** A canonical classification for any acquisition / discovery failure. */
export type FailureClass =
  | 'challenge'
  | 'browser_closed'
  | 'timeout'
  | 'navigation_error'
  | 'parse_error'
  | 'worker_error'
  | 'rate_limited'
  | 'unknown';

export interface CircuitState {
  consecutiveChallenges: number;
  lastFailureClass: FailureClass | null;
  lastFailureMessage: string | null;
  openedAtMs: number | null;
  cooldownUntilMs: number | null;
  updatedAtMs: number;
}

export interface CircuitDecision {
  open: boolean;
  cooldownRemainingMs: number;
  state: CircuitState;
}

export const SCHEDULED_DISCOVERY_CIRCUIT_KEY = 'discovery_circuit_v1';
export const DEFAULT_CHALLENGE_THRESHOLD = 2;
export const DEFAULT_COOLDOWN_MS = 30 * 60 * 1_000;

const CHALLENGE_PATTERNS = [/cloudflare challenge page/i, /just a moment/i, /attention required/i, /cf[- ]?challenge/i];
const BROWSER_CLOSED_PATTERNS = [/browser has been closed/i, /target.*closed/i, /session was destroyed/i];
const TIMEOUT_PATTERNS = [/timed?[ -]out/i, /timeout/i, /etimedout/i];
const NAVIGATION_PATTERNS = [/navigation/i, /net::err/i, /failed to navigate/i];
const PARSE_PATTERNS = [/parse/i, /could not extract/i];
const WORKER_ERROR_PATTERNS = [/internal\s.*request failed/i, /worker error/i];
const RATE_LIMIT_PATTERNS = [/status\s+429/i, /too many requests/i, /rate[- ]?limit/i];

/** Classify an error or response message into one of the canonical failure buckets. */
export function classifyFailure(input: unknown): FailureClass {
  const message = input instanceof Error ? input.message : String(input ?? '');
  if (!message) return 'unknown';
  if (CHALLENGE_PATTERNS.some((pattern) => pattern.test(message))) return 'challenge';
  if (BROWSER_CLOSED_PATTERNS.some((pattern) => pattern.test(message))) return 'browser_closed';
  if (TIMEOUT_PATTERNS.some((pattern) => pattern.test(message))) return 'timeout';
  if (NAVIGATION_PATTERNS.some((pattern) => pattern.test(message))) return 'navigation_error';
  if (PARSE_PATTERNS.some((pattern) => pattern.test(message))) return 'parse_error';
  if (WORKER_ERROR_PATTERNS.some((pattern) => pattern.test(message))) return 'worker_error';
  if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message))) return 'rate_limited';
  return 'unknown';
}

function emptyState(nowMs: number): CircuitState {
  return {
    consecutiveChallenges: 0,
    lastFailureClass: null,
    lastFailureMessage: null,
    openedAtMs: null,
    cooldownUntilMs: null,
    updatedAtMs: nowMs,
  };
}

function parseState(raw: string | null, nowMs: number): CircuitState {
  if (!raw) return emptyState(nowMs);
  try {
    const parsed = JSON.parse(raw) as Partial<CircuitState>;
    return {
      consecutiveChallenges: Number(parsed.consecutiveChallenges ?? 0),
      lastFailureClass: (parsed.lastFailureClass ?? null) as FailureClass | null,
      lastFailureMessage: parsed.lastFailureMessage ?? null,
      openedAtMs: parsed.openedAtMs ?? null,
      cooldownUntilMs: parsed.cooldownUntilMs ?? null,
      updatedAtMs: Number(parsed.updatedAtMs ?? nowMs),
    };
  } catch {
    return emptyState(nowMs);
  }
}

async function readState(env: Env, key: string, nowMs: number): Promise<CircuitState> {
  const row = await env.DB.prepare('SELECT value FROM crawl_state WHERE key = ?1').bind(key).first<{ value: string }>();
  return parseState(row?.value ?? null, nowMs);
}

async function writeState(env: Env, key: string, state: CircuitState): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO crawl_state (key, value, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, JSON.stringify(state), nowIso())
    .run();
}

/** Inspect circuit state to decide whether new acquisition attempts should be paused. */
export async function evaluateCircuit(
  env: Env,
  options: { key?: string; nowMs?: number } = {},
): Promise<CircuitDecision> {
  const nowMs = options.nowMs ?? Date.now();
  const key = options.key ?? SCHEDULED_DISCOVERY_CIRCUIT_KEY;
  const state = await readState(env, key, nowMs);
  const cooldownRemainingMs = state.cooldownUntilMs ? Math.max(0, state.cooldownUntilMs - nowMs) : 0;
  return { open: cooldownRemainingMs > 0, cooldownRemainingMs, state };
}

export interface RecordOptions {
  key?: string;
  nowMs?: number;
  threshold?: number;
  cooldownMs?: number;
}

/** Record a challenge or classified failure, possibly opening the circuit. */
export async function recordFailure(
  env: Env,
  failureClass: FailureClass,
  message: string,
  options: RecordOptions = {},
): Promise<CircuitState> {
  const nowMs = options.nowMs ?? Date.now();
  const key = options.key ?? SCHEDULED_DISCOVERY_CIRCUIT_KEY;
  const threshold = options.threshold ?? DEFAULT_CHALLENGE_THRESHOLD;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const previous = await readState(env, key, nowMs);

  const consecutiveChallenges = failureClass === 'challenge' ? previous.consecutiveChallenges + 1 : 0;
  const shouldOpen = failureClass === 'challenge' && consecutiveChallenges >= threshold;

  const next: CircuitState = {
    consecutiveChallenges,
    lastFailureClass: failureClass,
    lastFailureMessage: message.slice(0, 400),
    openedAtMs: shouldOpen ? nowMs : previous.openedAtMs,
    cooldownUntilMs: shouldOpen ? nowMs + cooldownMs : previous.cooldownUntilMs,
    updatedAtMs: nowMs,
  };

  await writeState(env, key, next);
  return next;
}

/** Record a successful acquisition: reset consecutive challenges and clear cooldown. */
export async function recordSuccess(env: Env, options: { key?: string; nowMs?: number } = {}): Promise<CircuitState> {
  const nowMs = options.nowMs ?? Date.now();
  const key = options.key ?? SCHEDULED_DISCOVERY_CIRCUIT_KEY;
  const next: CircuitState = {
    consecutiveChallenges: 0,
    lastFailureClass: null,
    lastFailureMessage: null,
    openedAtMs: null,
    cooldownUntilMs: null,
    updatedAtMs: nowMs,
  };
  await writeState(env, key, next);
  return next;
}

/** Force the circuit closed (operator command). */
export async function resetCircuit(env: Env, key: string = SCHEDULED_DISCOVERY_CIRCUIT_KEY): Promise<void> {
  await env.DB.prepare('DELETE FROM crawl_state WHERE key = ?1').bind(key).run();
}

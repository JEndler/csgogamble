// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: legacy parser/test fixtures are intentionally dense; refactor separately.
// biome-ignore-all lint/nursery/useExplicitReturnType: legacy test/CLI helper inference is acceptable here.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  classifyFailure,
  DEFAULT_CHALLENGE_THRESHOLD,
  DEFAULT_COOLDOWN_MS,
  evaluateCircuit,
  recordFailure,
  recordSuccess,
  resetCircuit,
  SCHEDULED_DISCOVERY_CIRCUIT_KEY,
} from '../src/circuit';
import type { Env } from '../src/types';

function inMemoryCrawlState(): { env: Env; store: Map<string, string> } {
  const store = new Map<string, string>();
  const DB = {
    prepare(sql: string) {
      type Bound = { sql: string; args: unknown[] };
      const ctx: Bound = { sql, args: [] };
      const api = {
        bind(...args: unknown[]) {
          ctx.args = args;
          return api;
        },
        async first<T>(): Promise<T | null> {
          if (/SELECT value FROM crawl_state WHERE key/.test(ctx.sql)) {
            const key = String(ctx.args[0]);
            const value = store.get(key);
            return value ? ({ value } as unknown as T) : null;
          }
          return null;
        },
        async run() {
          if (/INSERT INTO crawl_state/.test(ctx.sql)) {
            const [key, value] = ctx.args as [string, string];
            store.set(key, value);
          } else if (/DELETE FROM crawl_state/.test(ctx.sql)) {
            const [key] = ctx.args as [string];
            store.delete(key);
          }
          return { meta: { changed_db: true } };
        },
      };
      return api;
    },
  };
  return { env: { DB } as unknown as Env, store };
}

describe('classifyFailure', () => {
  it('detects cloudflare challenge messages', () => {
    expect(classifyFailure(new Error('HLTV results discovery hit a Cloudflare challenge page'))).toBe('challenge');
    expect(classifyFailure('Just a moment...')).toBe('challenge');
  });

  it('detects browser-closed errors', () => {
    expect(classifyFailure(new Error('Target page, context or browser has been closed'))).toBe('browser_closed');
  });

  it('detects timeouts and navigation errors', () => {
    expect(classifyFailure(new Error('Request timed out after 30s'))).toBe('timeout');
    expect(classifyFailure(new Error('navigation timed out')).length > 0).toBe(true);
    expect(classifyFailure(new Error('Failed to navigate to URL'))).toBe('navigation_error');
  });

  it('detects parse, worker, and rate-limit errors', () => {
    expect(classifyFailure(new Error('Could not extract match id from URL'))).toBe('parse_error');
    expect(classifyFailure(new Error('Internal /discover/results request failed with 500'))).toBe('worker_error');
    expect(classifyFailure(new Error('Fetch failed for https://www.hltv.org/matches/1/foo with status 429'))).toBe(
      'rate_limited',
    );
  });

  it('falls back to unknown', () => {
    expect(classifyFailure(new Error('database is locked'))).toBe('unknown');
    expect(classifyFailure(null)).toBe('unknown');
  });
});

describe('circuit state', () => {
  let env: Env;
  let store: Map<string, string>;
  beforeEach(() => {
    ({ env, store } = inMemoryCrawlState());
  });

  it('starts closed when no state is persisted', async () => {
    const decision = await evaluateCircuit(env);
    expect(decision.open).toBe(false);
    expect(decision.cooldownRemainingMs).toBe(0);
    expect(decision.state.consecutiveChallenges).toBe(0);
  });

  it('opens after the threshold of consecutive challenges', async () => {
    const nowMs = 1_000_000;
    for (let i = 1; i < DEFAULT_CHALLENGE_THRESHOLD; i++) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential by design.
      await recordFailure(env, 'challenge', 'cf challenge', { nowMs });
    }
    let decision = await evaluateCircuit(env, { nowMs });
    expect(decision.open).toBe(false);

    await recordFailure(env, 'challenge', 'cf challenge', { nowMs });
    decision = await evaluateCircuit(env, { nowMs });
    expect(decision.open).toBe(true);
    expect(decision.state.cooldownUntilMs).toBe(nowMs + DEFAULT_COOLDOWN_MS);
    expect(decision.state.consecutiveChallenges).toBe(DEFAULT_CHALLENGE_THRESHOLD);
  });

  it('closes after success', async () => {
    const nowMs = 1_000_000;
    for (let i = 0; i < DEFAULT_CHALLENGE_THRESHOLD; i++) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential by design.
      await recordFailure(env, 'challenge', 'cf challenge', { nowMs });
    }
    expect((await evaluateCircuit(env, { nowMs })).open).toBe(true);

    await recordSuccess(env, { nowMs: nowMs + 1 });
    const decision = await evaluateCircuit(env, { nowMs: nowMs + 2 });
    expect(decision.open).toBe(false);
    expect(decision.state.consecutiveChallenges).toBe(0);
    expect(decision.state.cooldownUntilMs).toBeNull();
  });

  it('non-challenge failures reset the consecutive challenge counter', async () => {
    const nowMs = 1_000_000;
    await recordFailure(env, 'challenge', 'cf challenge', { nowMs });
    await recordFailure(env, 'timeout', 'request timed out', { nowMs });
    const decision = await evaluateCircuit(env, { nowMs });
    expect(decision.open).toBe(false);
    expect(decision.state.consecutiveChallenges).toBe(0);
    expect(decision.state.lastFailureClass).toBe('timeout');
  });

  it('opens immediately on rate limits', async () => {
    const nowMs = 1_000_000;
    await recordFailure(env, 'rate_limited', 'Fetch failed with status 429', { nowMs });
    const decision = await evaluateCircuit(env, { nowMs });
    expect(decision.open).toBe(true);
    expect(decision.state.lastFailureClass).toBe('rate_limited');
    expect(decision.state.cooldownUntilMs).toBe(nowMs + DEFAULT_COOLDOWN_MS);
  });

  it('resetCircuit clears persisted state', async () => {
    await recordFailure(env, 'challenge', 'cf', {});
    await resetCircuit(env);
    expect(store.has(SCHEDULED_DISCOVERY_CIRCUIT_KEY)).toBe(false);
  });
});

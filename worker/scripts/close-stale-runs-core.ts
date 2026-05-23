/**
 * Pure helpers extracted from close-stale-runs.ts so they can be unit-tested
 * without pulling in the wrangler/D1 IO from ops-utils. Keep this file free of
 * node:* imports.
 */

/** Minimum threshold we'll honor — below this we risk closing runs that are
 * still legitimately in flight (browser sessions can run for several minutes). */
export const MIN_THRESHOLD_HOURS = 0.25;

export interface ParsedThreshold {
  /** SQLite-formatted modifier suitable for `datetime('now', ...)`. */
  modifier: string;
  /** Resolved numeric hours value, after normalization. */
  hours: number;
}

/**
 * Convert an arbitrary user-supplied threshold value into a SQLite `datetime`
 * modifier. Fractional thresholds are converted to whole minutes so we don't
 * end up with `'-2.5 hours'` (SQLite truncates the fractional part silently
 * and you get a threshold that's nothing like what the operator typed).
 */
export function parseThresholdHours(raw: unknown): ParsedThreshold {
  const hours = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`Invalid threshold-hours: ${raw} (must be a positive number)`);
  }
  if (hours < MIN_THRESHOLD_HOURS) {
    throw new Error(
      `Invalid threshold-hours: ${hours} (must be >= ${MIN_THRESHOLD_HOURS}h to avoid closing live runs)`,
    );
  }
  if (Number.isInteger(hours)) {
    return { hours, modifier: `-${hours} hours` };
  }
  // SQLite supports fractional units via minutes; round to whole minutes so the
  // generated SQL is always integer-valued.
  const minutes = Math.round(hours * 60);
  return { hours: minutes / 60, modifier: `-${minutes} minutes` };
}

export function nextStaleClosedStatus(currentStatus: string | null): string {
  if (currentStatus === 'skipped' || currentStatus === 'skipped_circuit_open') return 'skipped_stale_closed';
  return 'stale_closed';
}

export function buildStaleClosedMessage(input: {
  ageHours: number;
  message: string | null;
  status: string | null;
}): string {
  const prefix = `[stale-closed after ${input.ageHours}h]`;
  const original = input.message ?? `original status=${input.status ?? 'unknown'}`;
  const combined = `${prefix} ${original}`;
  return combined.length > 900 ? `${combined.slice(0, 900)}…` : combined;
}

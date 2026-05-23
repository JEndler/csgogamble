import { describe, expect, it } from 'vitest';
import { buildStaleClosedMessage, nextStaleClosedStatus, parseThresholdHours } from '../scripts/close-stale-runs-core';

describe('parseThresholdHours', () => {
  it('accepts integer hours and emits a whole-hours SQL modifier', () => {
    expect(parseThresholdHours(2)).toEqual({ hours: 2, modifier: '-2 hours' });
    expect(parseThresholdHours(24)).toEqual({ hours: 24, modifier: '-24 hours' });
  });

  it('accepts string-encoded integers', () => {
    expect(parseThresholdHours('6')).toEqual({ hours: 6, modifier: '-6 hours' });
  });

  it('converts fractional hours to whole-minute modifiers so SQLite does not truncate', () => {
    expect(parseThresholdHours(0.5)).toEqual({ hours: 0.5, modifier: '-30 minutes' });
    expect(parseThresholdHours(1.5)).toEqual({ hours: 1.5, modifier: '-90 minutes' });
  });

  it('rejects non-numeric input', () => {
    expect(() => parseThresholdHours('not a number')).toThrow('Invalid threshold-hours');
    expect(() => parseThresholdHours(NaN)).toThrow('Invalid threshold-hours');
    expect(() => parseThresholdHours(Number.POSITIVE_INFINITY)).toThrow('Invalid threshold-hours');
  });

  it('rejects zero, negative, or unsafely small thresholds', () => {
    expect(() => parseThresholdHours(0)).toThrow('must be a positive number');
    expect(() => parseThresholdHours(-1)).toThrow('must be a positive number');
    expect(() => parseThresholdHours(0.1)).toThrow('must be >= 0.25h');
  });
});

describe('nextStaleClosedStatus', () => {
  it('preserves the skipped lineage for already-skipped runs', () => {
    expect(nextStaleClosedStatus('skipped')).toBe('skipped_stale_closed');
    expect(nextStaleClosedStatus('skipped_circuit_open')).toBe('skipped_stale_closed');
  });

  it('uses the generic stale_closed bucket for other statuses', () => {
    expect(nextStaleClosedStatus('running')).toBe('stale_closed');
    expect(nextStaleClosedStatus(null)).toBe('stale_closed');
    expect(nextStaleClosedStatus('challenge')).toBe('stale_closed');
  });
});

describe('buildStaleClosedMessage', () => {
  it('prefixes the original message with the stale-closed marker and age', () => {
    expect(
      buildStaleClosedMessage({
        ageHours: 6.5,
        message: 'browser session crashed',
        status: 'running',
      }),
    ).toBe('[stale-closed after 6.5h] browser session crashed');
  });

  it('falls back to the original status when no message is available', () => {
    expect(
      buildStaleClosedMessage({
        ageHours: 3,
        message: null,
        status: 'challenge',
      }),
    ).toBe('[stale-closed after 3h] original status=challenge');
  });

  it('truncates excessively long messages so they fit in the column budget', () => {
    const huge = 'x'.repeat(2000);
    const built = buildStaleClosedMessage({ ageHours: 2, message: huge, status: 'running' });
    expect(built.length).toBeLessThanOrEqual(901);
    expect(built.endsWith('…')).toBe(true);
  });
});

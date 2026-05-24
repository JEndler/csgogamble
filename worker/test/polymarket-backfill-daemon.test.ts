import { describe, expect, it } from 'vitest';
import { parsePolymarketBackfillArgs } from '../scripts/polymarket-backfill-args';

describe('polymarket backfill daemon args', () => {
  it('defaults price-history interval to window when explicit bounds are provided', () => {
    const args = parsePolymarketBackfillArgs([
      '--phase',
      'price-history',
      '--start-ts',
      '1756684800',
      '--end-ts',
      '1769904000',
    ]);

    expect(args.interval).toBe('window');
    expect(args.checkpoint).toContain('price-history-match_winner-window-fidelity=60');
  });

  it('keeps the existing 1h default when price-history bounds are absent', () => {
    const args = parsePolymarketBackfillArgs(['--phase', 'price-history']);

    expect(args.interval).toBe('1h');
    expect(args.checkpoint).toContain('price-history-match_winner-1h-fidelity=60');
  });

  it('accepts explicit window interval in checkpoint key', () => {
    const args = parsePolymarketBackfillArgs(['--phase', 'price-history', '--interval', 'window']);

    expect(args.interval).toBe('window');
    expect(args.checkpoint).toContain('price-history-match_winner-window-fidelity=60');
  });
});

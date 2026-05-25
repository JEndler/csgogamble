// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: helper coverage is compact and table-driven enough for this ops script.
import { describe, expect, it } from 'vitest';
import {
  buildDateShards,
  buildOffsetShards,
  buildResultsPageUrl,
  extractMatchCandidate,
  parseHistoricalOverlapArgs,
  selectCandidatesToBackfill,
} from '../scripts/hltv-historical-overlap-core';

describe('hltv historical overlap ops script helpers', () => {
  const oneDayResultsUrl = `https://www.hltv.org/results?${new URLSearchParams({
    startDate: '2025-09-24',
    endDate: '2025-09-24',
  }).toString()}`;

  it('builds inclusive date shards capped by the requested end date', () => {
    expect(buildDateShards('2025-09-24', '2025-09-30', 3)).toEqual([
      { startDate: '2025-09-24', endDate: '2025-09-26' },
      { startDate: '2025-09-27', endDate: '2025-09-29' },
      { startDate: '2025-09-30', endDate: '2025-09-30' },
    ]);
  });

  it('builds offset shards for the HLTV results archive fallback', () => {
    expect(buildOffsetShards(5500, 5700, 100)).toEqual([{ offset: 5500 }, { offset: 5600 }, { offset: 5700 }]);
  });

  it('builds HLTV results page URLs with explicit start/end query params', () => {
    expect(buildResultsPageUrl('https://www.hltv.org', { startDate: '2025-09-24', endDate: '2025-09-24' })).toBe(
      oneDayResultsUrl,
    );
  });

  it('extracts candidate match ids and source URLs from returned HLTV match URLs', () => {
    expect(extractMatchCandidate('https://www.hltv.org/matches/2391234/furia-vs-9ine')).toEqual({
      matchId: 2391234,
      sourceUrl: 'https://www.hltv.org/matches/2391234/furia-vs-9ine',
    });
  });

  it('skips already parsed matches unless include-existing is enabled', () => {
    const candidates = [
      { matchId: 1, sourceUrl: 'https://www.hltv.org/matches/1/a' },
      { matchId: 2, sourceUrl: 'https://www.hltv.org/matches/2/b' },
      { matchId: 3, sourceUrl: 'https://www.hltv.org/matches/3/c' },
    ];
    const existing = new Map([
      [1, 'parsed'],
      [2, 'challenge'],
    ]);

    expect(selectCandidatesToBackfill(candidates, existing, false)).toEqual([
      { matchId: 2, sourceUrl: 'https://www.hltv.org/matches/2/b' },
      { matchId: 3, sourceUrl: 'https://www.hltv.org/matches/3/c' },
    ]);
    expect(selectCandidatesToBackfill(candidates, existing, true)).toEqual(candidates);
  });

  it('parses safe defaults for Polymarket match_winner overlap', () => {
    const args = parseHistoricalOverlapArgs([]);
    expect(args.startDate).toBe('2025-09-24');
    expect(args.endDate).toBe('2026-01-16');
    expect(args.marketType).toBe('match_winner');
    expect(args.acquisitionMode).toBe('http-stealth');
    expect(args.batchSize).toBe(10);
    expect(args.apply).toBe(false);
  });

  it('parses offset archive mode for historical runs when HLTV date filters are blocked', () => {
    const args = parseHistoricalOverlapArgs([
      '--shard-mode',
      'offset',
      '--offset-start',
      '5500',
      '--offset-end',
      '8700',
    ]);
    expect(args.shardMode).toBe('offset');
    expect(args.offsetStart).toBe(5500);
    expect(args.offsetEnd).toBe(8700);
    expect(args.offsetStep).toBe(100);
  });
});

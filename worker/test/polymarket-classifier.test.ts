// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: legacy parser/test fixtures are intentionally dense; refactor separately.
import { describe, expect, it } from 'vitest';
import { classifyMarket } from '../src/polymarket/classifier';
import type { NormalizedMarket } from '../src/polymarket/types';

function market(overrides: Partial<NormalizedMarket>): NormalizedMarket {
  return {
    conditionId: '0xdeadbeef',
    questionId: null,
    slug: null,
    question: null,
    description: null,
    closed: null,
    archived: null,
    active: null,
    acceptingOrders: null,
    endDate: null,
    startDate: null,
    resolutionSource: null,
    outcomes: [],
    ...overrides,
  };
}

describe('classifyMarket', () => {
  it('classifies a head-to-head match winner with two outcomes as match_winner', () => {
    const result = classifyMarket(
      market({
        question: 'Team Liquid vs Falcons',
        outcomes: [
          { index: 0, label: 'Team Liquid', tokenId: 't1', lastPrice: 0.55 },
          { index: 1, label: 'Falcons', tokenId: 't2', lastPrice: 0.45 },
        ],
      }),
    );
    expect(result.marketType).toBe('match_winner');
    expect(result.parsed.team1Name).toBe('Team Liquid');
    expect(result.parsed.team2Name).toBe('Falcons');
  });

  it('classifies a market with a map name and vs as map_winner', () => {
    const result = classifyMarket(
      market({
        question: 'Mirage winner: Liquid vs Falcons',
        outcomes: [
          { index: 0, label: 'Liquid', tokenId: 't1', lastPrice: 0.5 },
          { index: 1, label: 'Falcons', tokenId: 't2', lastPrice: 0.5 },
        ],
      }),
    );
    expect(result.marketType).toBe('map_winner');
    expect(result.parsed.mapName).toBe('Mirage');
  });

  it('classifies an over/under total maps market', () => {
    const result = classifyMarket(
      market({
        question: 'Total maps over 2.5 - Liquid vs Falcons',
        outcomes: [
          { index: 0, label: 'Over', tokenId: 't1', lastPrice: 0.6 },
          { index: 1, label: 'Under', tokenId: 't2', lastPrice: 0.4 },
        ],
      }),
    );
    expect(result.marketType).toBe('total_maps');
    expect(result.parsed.totalValue).toBe(2.5);
  });

  it('classifies handicap markets', () => {
    const result = classifyMarket(
      market({
        question: 'Map handicap +1.5 — Liquid vs Falcons',
        outcomes: [
          { index: 0, label: 'Yes', tokenId: 't1', lastPrice: 0.55 },
          { index: 1, label: 'No', tokenId: 't2', lastPrice: 0.45 },
        ],
      }),
    );
    expect(result.marketType).toBe('map_handicap');
    expect(result.parsed.handicapValue).toBe(1.5);
  });

  it('classifies player prop markets', () => {
    const result = classifyMarket(
      market({
        question: 'Most kills in the final — top fragger',
        outcomes: [
          { index: 0, label: 'donk', tokenId: 't1', lastPrice: 0.3 },
          { index: 1, label: 'sh1ro', tokenId: 't2', lastPrice: 0.2 },
        ],
      }),
    );
    expect(result.marketType).toBe('player_prop');
  });

  it('classifies tournament-winner outright markets', () => {
    const result = classifyMarket(
      market({
        question: 'Tournament winner of the Major',
        outcomes: [
          { index: 0, label: 'Liquid', tokenId: 't1', lastPrice: 0.2 },
          { index: 1, label: 'Falcons', tokenId: 't2', lastPrice: 0.15 },
          { index: 2, label: 'NaVi', tokenId: 't3', lastPrice: 0.15 },
        ],
      }),
    );
    expect(result.marketType).toBe('outright');
  });

  it('returns unknown for empty questions', () => {
    const result = classifyMarket(market({ question: null, description: null }));
    expect(result.marketType).toBe('unknown');
    expect(result.signals.notes).toContain('empty-question');
  });
});

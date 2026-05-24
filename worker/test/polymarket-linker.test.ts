import { describe, expect, it } from 'vitest';
import { classifyMarket } from '../src/polymarket/classifier';
import { scoreMarketAgainstMatches } from '../src/polymarket/linker';
import type { NormalizedMarket } from '../src/polymarket/types';

function market(overrides: Partial<NormalizedMarket>): NormalizedMarket {
  return {
    conditionId: '0xfeed',
    questionId: null,
    slug: null,
    question: 'Team Liquid vs Falcons',
    description: null,
    closed: null,
    archived: null,
    active: null,
    acceptingOrders: null,
    endDate: '2025-01-05T10:00:00Z',
    startDate: '2025-01-05T08:00:00Z',
    resolutionSource: null,
    outcomes: [
      { index: 0, label: 'Liquid', tokenId: 't1', lastPrice: 0.5 },
      { index: 1, label: 'Falcons', tokenId: 't2', lastPrice: 0.5 },
    ],
    ...overrides,
  };
}

describe('scoreMarketAgainstMatches', () => {
  it('auto-links when top score is high and gap is large', () => {
    const subject = market({});
    const classification = classifyMarket(subject);
    const result = scoreMarketAgainstMatches(subject, classification, [
      { hltvMatchId: 111, team1Name: 'Team Liquid', team2Name: 'Falcons', scheduledAt: '2025-01-05T10:00:00Z' },
      { hltvMatchId: 222, team1Name: 'NaVi', team2Name: 'Spirit', scheduledAt: '2025-01-05T09:00:00Z' },
    ]);
    expect(result.autoLinked).toBe(true);
    expect(result.topCandidate?.hltvMatchId).toBe(111);
    expect(result.topScore).toBeGreaterThanOrEqual(0.9);
    expect(result.gap).toBeGreaterThanOrEqual(0.1);
  });

  it('rejects auto-link when the score is too low', () => {
    const subject = market({ question: 'Astralis vs Vitality' });
    const classification = classifyMarket(subject);
    const result = scoreMarketAgainstMatches(subject, classification, [
      { hltvMatchId: 111, team1Name: 'Liquid', team2Name: 'Falcons', scheduledAt: '2025-01-05T10:00:00Z' },
    ]);
    expect(result.autoLinked).toBe(false);
    expect(['low_score', 'no_teams']).toContain(result.reason);
  });

  it('refuses to auto-link non match_winner markets', () => {
    const subject = market({ question: 'Tournament winner of the Major' });
    const classification = classifyMarket(subject);
    const result = scoreMarketAgainstMatches(subject, classification, [
      { hltvMatchId: 111, team1Name: 'Liquid', team2Name: 'Falcons', scheduledAt: '2025-01-05T10:00:00Z' },
    ]);
    expect(result.autoLinked).toBe(false);
    expect(result.reason).toBe('wrong_type');
  });

  it('rejects when there is no clear gap to the next candidate', () => {
    const subject = market({});
    const classification = classifyMarket(subject);
    const result = scoreMarketAgainstMatches(subject, classification, [
      { hltvMatchId: 1, team1Name: 'Team Liquid', team2Name: 'Falcons', scheduledAt: '2025-01-05T10:00:00Z' },
      { hltvMatchId: 2, team1Name: 'Team Liquid', team2Name: 'Falcons', scheduledAt: '2025-01-05T11:00:00Z' },
    ]);
    expect(result.autoLinked).toBe(false);
    expect(result.reason).toBe('low_gap');
  });

  it('handles markets with no candidates gracefully', () => {
    const subject = market({});
    const classification = classifyMarket(subject);
    const result = scoreMarketAgainstMatches(subject, classification, []);
    expect(result.autoLinked).toBe(false);
    expect(result.reason).toBe('no_candidates');
  });
});

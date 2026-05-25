import { describe, expect, it } from 'vitest';
import { computePriceFeatures, resolveOutcomeTeamAndTarget } from '../scripts/prediction-dataset-core';

describe('prediction dataset core', () => {
  it('computes leakage-safe price features before the cutoff', () => {
    const features = computePriceFeatures(
      [
        { t: 900, p: 0.4 },
        { t: 1_000, p: 0.45 },
        { t: 1_300, p: 0.6 },
        { t: 2_000, p: 0.9 },
      ],
      1_600,
    );

    expect(features.priceOpen).toBe(0.4);
    expect(features.priceLatest).toBe(0.6);
    expect(features.priceMin).toBe(0.4);
    expect(features.priceMax).toBe(0.6);
    expect(features.pricePointCount).toBe(3);
  });

  it('ignores post-cutoff prices', () => {
    const features = computePriceFeatures(
      [
        { t: 1_000, p: 0.3 },
        { t: 2_000, p: 0.8 },
      ],
      1_500,
    );

    expect(features.priceLatest).toBe(0.3);
    expect(features.priceMax).toBe(0.3);
    expect(features.pricePointCount).toBe(1);
  });

  it('resolves outcome team and target by matching outcome label to teams', () => {
    expect(
      resolveOutcomeTeamAndTarget({
        outcomeLabel: 'Natus Vincere',
        pmTeam1Name: 'NAVI',
        pmTeam2Name: 'Vitality',
        hltvTeam1Name: 'Natus Vincere',
        hltvTeam2Name: 'Vitality',
        team1HltvId: 4608,
        team2HltvId: 9565,
        winnerTeamId: 4608,
      }),
    ).toEqual({ outcomeTeamHltvId: 4608, targetWin: 1 });
  });
});

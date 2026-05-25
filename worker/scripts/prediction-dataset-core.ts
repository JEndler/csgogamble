import { nameSimilarity } from '../src/polymarket/normalize';

export interface PricePoint {
  t: number;
  p: number;
}

export interface PriceFeatures {
  priceOpen: number | null;
  priceLatest: number | null;
  priceMin: number | null;
  priceMax: number | null;
  priceMean: number | null;
  priceStddev: number | null;
  pricePointCount: number;
}

export interface OutcomeResolutionInput {
  outcomeLabel: string | null;
  pmTeam1Name: string | null;
  pmTeam2Name: string | null;
  hltvTeam1Name: string | null;
  hltvTeam2Name: string | null;
  team1HltvId: number | null;
  team2HltvId: number | null;
  winnerTeamId: number | null;
}

export interface OutcomeResolution {
  outcomeTeamHltvId: number | null;
  targetWin: number | null;
}

export function computePriceFeatures(points: PricePoint[], cutoffTs: number): PriceFeatures {
  const usable = points
    .filter(
      (point) =>
        Number.isFinite(point.t) && Number.isFinite(point.p) && point.p >= 0 && point.p <= 1 && point.t <= cutoffTs,
    )
    .sort((a, b) => a.t - b.t);
  if (usable.length === 0) {
    return {
      priceOpen: null,
      priceLatest: null,
      priceMin: null,
      priceMax: null,
      priceMean: null,
      priceStddev: null,
      pricePointCount: 0,
    };
  }

  const values = usable.map((point) => point.p);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return {
    priceOpen: values[0] ?? null,
    priceLatest: values.at(-1) ?? null,
    priceMin: Math.min(...values),
    priceMax: Math.max(...values),
    priceMean: mean,
    priceStddev: Math.sqrt(variance),
    pricePointCount: usable.length,
  };
}

function bestTeam(label: string, team1: string | null, team2: string | null): 1 | 2 | null {
  if (!team1 && !team2) return null;
  const team1Score = team1 ? nameSimilarity(label, team1) : 0;
  const team2Score = team2 ? nameSimilarity(label, team2) : 0;
  const best = Math.max(team1Score, team2Score);
  if (best < 0.5 || Math.abs(team1Score - team2Score) < 0.05) return null;
  return team1Score > team2Score ? 1 : 2;
}

export function resolveOutcomeTeamAndTarget(input: OutcomeResolutionInput): OutcomeResolution {
  if (!input.outcomeLabel) return { outcomeTeamHltvId: null, targetWin: null };
  const pmSide = bestTeam(input.outcomeLabel, input.pmTeam1Name, input.pmTeam2Name);
  const hltvSide = bestTeam(input.outcomeLabel, input.hltvTeam1Name, input.hltvTeam2Name);
  const side = hltvSide ?? pmSide;
  const outcomeTeamHltvId = side === 1 ? input.team1HltvId : side === 2 ? input.team2HltvId : null;
  return {
    outcomeTeamHltvId,
    targetWin:
      outcomeTeamHltvId !== null && input.winnerTeamId !== null
        ? outcomeTeamHltvId === input.winnerTeamId
          ? 1
          : 0
        : null,
  };
}

export function unixSeconds(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

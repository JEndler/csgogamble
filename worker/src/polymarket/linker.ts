import type { Env } from '../types';
import { nowIso } from '../utils';
import { nameSimilarity, normalizeName } from './normalize';
import type { MarketClassification, NormalizedMarket } from './types';

/**
 * Deterministic linker between a Polymarket market and HLTV matches.
 *
 * The scorer is purposely simple: it relies on team-name similarity (with
 * optional `team_aliases` boost) and event-time proximity. Auto-link gates
 * are strict — top score >= 0.90, gap to next candidate >= 0.10, both teams
 * must match, and the market type must be `match_winner`. Anything weaker
 * stores all candidates for review without flipping `link_method = 'auto'`.
 */

export const AUTO_LINK_MIN_SCORE = 0.9;
export const AUTO_LINK_MIN_GAP = 0.1;

export interface HltvMatchSummaryRow {
  hltvMatchId: number;
  team1Name: string | null;
  team2Name: string | null;
  scheduledAt: string | null;
}

export interface LinkCandidate {
  hltvMatchId: number;
  score: number;
  team1Match: boolean;
  team2Match: boolean;
  signals: LinkCandidateSignals;
}

export interface LinkCandidateSignals {
  pmTeam1: string | null;
  pmTeam2: string | null;
  hltvTeam1: string | null;
  hltvTeam2: string | null;
  team1Similarity: number;
  team2Similarity: number;
  dateDeltaHours: number | null;
}

export interface LinkResult {
  topCandidate: LinkCandidate | null;
  candidates: LinkCandidate[];
  topScore: number;
  gap: number;
  autoLinked: boolean;
  reason: 'auto' | 'low_score' | 'low_gap' | 'no_teams' | 'wrong_type' | 'no_candidates';
}

const MAX_CANDIDATES = 5;

function hoursBetween(aIso: string | null, bIso: string | null): number | null {
  if (!aIso || !bIso) return null;
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.abs(a - b) / (1000 * 60 * 60);
}

function bestPairScore(
  pmTeam1: string,
  pmTeam2: string,
  hltvTeam1: string,
  hltvTeam2: string,
): { team1: number; team2: number; orderSwapped: boolean } {
  const straight = {
    team1: nameSimilarity(pmTeam1, hltvTeam1),
    team2: nameSimilarity(pmTeam2, hltvTeam2),
  };
  const swapped = {
    team1: nameSimilarity(pmTeam1, hltvTeam2),
    team2: nameSimilarity(pmTeam2, hltvTeam1),
  };
  const straightAvg = (straight.team1 + straight.team2) / 2;
  const swappedAvg = (swapped.team1 + swapped.team2) / 2;
  return swappedAvg > straightAvg
    ? { team1: swapped.team1, team2: swapped.team2, orderSwapped: true }
    : { team1: straight.team1, team2: straight.team2, orderSwapped: false };
}

function applyDateBonus(baseScore: number, deltaHours: number | null): number {
  if (deltaHours === null) return baseScore;
  if (deltaHours <= 6) return Math.min(1, baseScore + 0.05);
  if (deltaHours <= 24) return Math.min(1, baseScore + 0.02);
  if (deltaHours > 168) return Math.max(0, baseScore - 0.05);
  return baseScore;
}

/**
 * Deterministically score a market against a set of candidate HLTV matches.
 * Pure function — no I/O — so it is trivial to unit-test.
 */
export function scoreMarketAgainstMatches(
  market: NormalizedMarket,
  classification: MarketClassification,
  candidates: HltvMatchSummaryRow[],
): LinkResult {
  const pmTeam1 = classification.parsed.team1Name;
  const pmTeam2 = classification.parsed.team2Name;
  if (classification.marketType !== 'match_winner') {
    return {
      topCandidate: null,
      candidates: [],
      topScore: 0,
      gap: 0,
      autoLinked: false,
      reason: 'wrong_type',
    };
  }
  if (!pmTeam1 || !pmTeam2) {
    return {
      topCandidate: null,
      candidates: [],
      topScore: 0,
      gap: 0,
      autoLinked: false,
      reason: 'no_teams',
    };
  }

  const scored: LinkCandidate[] = candidates
    .filter((row) => row.team1Name && row.team2Name)
    .map((row) => {
      const pair = bestPairScore(pmTeam1, pmTeam2, row.team1Name ?? '', row.team2Name ?? '');
      const dateDeltaHours = hoursBetween(market.endDate ?? market.startDate, row.scheduledAt);
      const teamComponent = (pair.team1 + pair.team2) / 2;
      const score = applyDateBonus(teamComponent, dateDeltaHours);
      return {
        hltvMatchId: row.hltvMatchId,
        score,
        team1Match: pair.team1 >= 0.5,
        team2Match: pair.team2 >= 0.5,
        signals: {
          pmTeam1,
          pmTeam2,
          hltvTeam1: row.team1Name,
          hltvTeam2: row.team2Name,
          team1Similarity: pair.team1,
          team2Similarity: pair.team2,
          dateDeltaHours,
        },
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);

  if (scored.length === 0) {
    return { topCandidate: null, candidates: [], topScore: 0, gap: 0, autoLinked: false, reason: 'no_candidates' };
  }

  const top = scored[0];
  if (!top) {
    return { topCandidate: null, candidates: [], topScore: 0, gap: 0, autoLinked: false, reason: 'no_candidates' };
  }
  const gap = scored.length > 1 ? top.score - (scored[1]?.score ?? 0) : top.score;
  let autoLinked = false;
  let reason: LinkResult['reason'] = 'low_score';
  if (top.score < AUTO_LINK_MIN_SCORE) {
    reason = 'low_score';
  } else if (gap < AUTO_LINK_MIN_GAP) {
    reason = 'low_gap';
  } else if (!top.team1Match || !top.team2Match) {
    reason = 'no_teams';
  } else {
    autoLinked = true;
    reason = 'auto';
  }

  return { topCandidate: top, candidates: scored, topScore: top.score, gap, autoLinked, reason };
}

/**
 * Load matches whose scheduled date sits within `windowHours` of the
 * market's end/start date. Falls back to a recent-results window when no
 * date hint is available.
 */
export async function loadCandidateHltvMatches(
  env: Env,
  market: NormalizedMarket,
  windowHours = 72,
  limit = 50,
): Promise<HltvMatchSummaryRow[]> {
  const dateHint = market.endDate ?? market.startDate;
  if (dateHint) {
    const dateMs = Date.parse(dateHint);
    if (!Number.isNaN(dateMs)) {
      const startIso = new Date(dateMs - windowHours * 3600 * 1000).toISOString();
      const endIso = new Date(dateMs + windowHours * 3600 * 1000).toISOString();
      const rows = await env.DB.prepare(
        `SELECT hltv_match_id, team1_name, team2_name, scheduled_at
           FROM matches
          WHERE scheduled_at BETWEEN ?1 AND ?2
          ORDER BY scheduled_at
          LIMIT ?3`,
      )
        .bind(startIso, endIso, limit)
        .all<{
          hltv_match_id: number;
          team1_name: string | null;
          team2_name: string | null;
          scheduled_at: string | null;
        }>();
      return (rows.results ?? []).map((row) => ({
        hltvMatchId: Number(row.hltv_match_id),
        team1Name: row.team1_name,
        team2Name: row.team2_name,
        scheduledAt: row.scheduled_at,
      }));
    }
  }

  const fallback = await env.DB.prepare(
    `SELECT hltv_match_id, team1_name, team2_name, scheduled_at
       FROM matches
      WHERE scheduled_at IS NOT NULL
      ORDER BY scheduled_at DESC
      LIMIT ?1`,
  )
    .bind(limit)
    .all<{
      hltv_match_id: number;
      team1_name: string | null;
      team2_name: string | null;
      scheduled_at: string | null;
    }>();
  return (fallback.results ?? []).map((row) => ({
    hltvMatchId: Number(row.hltv_match_id),
    team1Name: row.team1_name,
    team2Name: row.team2_name,
    scheduledAt: row.scheduled_at,
  }));
}

export interface PersistLinkCandidatesInput {
  marketId: number;
  result: LinkResult;
}

export async function persistLinkCandidates(env: Env, input: PersistLinkCandidatesInput): Promise<void> {
  const { marketId, result } = input;
  if (result.candidates.length === 0) return;
  const timestamp = nowIso();
  const chosenId = result.autoLinked ? (result.topCandidate?.hltvMatchId ?? null) : null;
  const linkMethod = result.autoLinked ? 'auto' : 'rejected';
  const statements: D1PreparedStatement[] = result.candidates.map((candidate) =>
    env.DB.prepare(
      `INSERT INTO polymarket_hltv_link_candidates
          (market_id, hltv_match_id, score, gap, team1_match, team2_match,
           signals_json, chosen, link_method, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(market_id, hltv_match_id) DO UPDATE SET
           score = excluded.score,
           gap = excluded.gap,
           team1_match = excluded.team1_match,
           team2_match = excluded.team2_match,
           signals_json = excluded.signals_json,
           chosen = excluded.chosen,
           link_method = excluded.link_method`,
    ).bind(
      marketId,
      candidate.hltvMatchId,
      candidate.score,
      result.gap,
      candidate.team1Match ? 1 : 0,
      candidate.team2Match ? 1 : 0,
      JSON.stringify(candidate.signals),
      candidate.hltvMatchId === chosenId ? 1 : 0,
      candidate.hltvMatchId === chosenId ? linkMethod : null,
      timestamp,
    ),
  );

  if (result.autoLinked && result.topCandidate) {
    statements.push(
      env.DB.prepare(
        `UPDATE polymarket_markets
            SET hltv_match_id = ?2,
                link_method = 'auto',
                link_score = ?3,
                last_seen_at = ?4
          WHERE id = ?1`,
      ).bind(marketId, result.topCandidate.hltvMatchId, result.topScore, timestamp),
    );
  }
  await env.DB.batch(statements);
}

/** Load alias overrides from D1; used to boost similarity for known team renames. */
export async function loadTeamAliases(env: Env): Promise<Map<string, number>> {
  const rows = await env.DB.prepare('SELECT hltv_team_id, alias_normalized FROM team_aliases').all<{
    hltv_team_id: number;
    alias_normalized: string;
  }>();
  const map = new Map<string, number>();
  for (const row of rows.results ?? []) {
    map.set(row.alias_normalized, Number(row.hltv_team_id));
  }
  return map;
}

/** Convenience: normalize for use as a `team_aliases.alias_normalized` lookup key. */
export function aliasKey(name: string): string {
  return normalizeName(name);
}

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: operator script keeps CLI flow explicit.
// biome-ignore-all lint/performance/noAwaitInLoops: remote D1 batches are intentionally sequential for operational safety.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nameSimilarity } from '../src/polymarket/normalize';
import { queryD1, sqlString, toNullableString, toNumber, wrangler } from './ops-utils';

interface MarketRow {
  id: number;
  startDate: string | null;
  endDate: string | null;
  team1: string;
  team2: string;
}

interface MatchRow {
  hltvMatchId: number;
  scheduledAt: string | null;
  team1: string | null;
  team2: string | null;
}

interface Candidate {
  hltvMatchId: number;
  score: number;
  team1Match: boolean;
  team2Match: boolean;
  signals: Record<string, unknown>;
}

function argValue(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function hoursBetween(aIso: string | null, bIso: string | null): number | null {
  if (!aIso || !bIso) return null;
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.abs(a - b) / 3_600_000;
}

function applyDateBonus(baseScore: number, deltaHours: number | null): number {
  if (deltaHours === null) return baseScore;
  if (deltaHours <= 6) return Math.min(1, baseScore + 0.05);
  if (deltaHours <= 24) return Math.min(1, baseScore + 0.02);
  if (deltaHours > 168) return Math.max(0, baseScore - 0.05);
  return baseScore;
}

function scoreCandidate(market: MarketRow, match: MatchRow): Candidate | null {
  if (!match.team1 || !match.team2) return null;
  const straight = {
    team1: nameSimilarity(market.team1, match.team1),
    team2: nameSimilarity(market.team2, match.team2),
  };
  const swapped = {
    team1: nameSimilarity(market.team1, match.team2),
    team2: nameSimilarity(market.team2, match.team1),
  };
  const straightAvg = (straight.team1 + straight.team2) / 2;
  const swappedAvg = (swapped.team1 + swapped.team2) / 2;
  const pair = swappedAvg > straightAvg ? swapped : straight;
  const orderSwapped = swappedAvg > straightAvg;
  const dateDeltaHours = hoursBetween(market.endDate ?? market.startDate, match.scheduledAt);
  return {
    hltvMatchId: match.hltvMatchId,
    score: applyDateBonus((pair.team1 + pair.team2) / 2, dateDeltaHours),
    team1Match: pair.team1 >= 0.5,
    team2Match: pair.team2 >= 0.5,
    signals: {
      pmTeam1: market.team1,
      pmTeam2: market.team2,
      hltvTeam1: match.team1,
      hltvTeam2: match.team2,
      team1Similarity: pair.team1,
      team2Similarity: pair.team2,
      dateDeltaHours,
      orderSwapped,
    },
  };
}

function marketDateMs(market: MarketRow): number | null {
  const value = market.endDate ?? market.startDate;
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function candidateMatchesForMarket(market: MarketRow, matches: MatchRow[], windowHours: number): MatchRow[] {
  const dateMs = marketDateMs(market);
  if (dateMs === null) return matches;
  const windowMs = windowHours * 3_600_000;
  return matches.filter((match) => {
    if (!match.scheduledAt) return false;
    const matchMs = Date.parse(match.scheduledAt);
    return !Number.isNaN(matchMs) && Math.abs(matchMs - dateMs) <= windowMs;
  });
}

function linkSql(market: MarketRow, candidates: Candidate[], gap: number, autoLinked: boolean): string[] {
  const timestamp = new Date().toISOString();
  const top = candidates[0];
  const statements = candidates.map((candidate) => {
    const chosen = autoLinked && top?.hltvMatchId === candidate.hltvMatchId;
    return `INSERT INTO polymarket_hltv_link_candidates
      (market_id, hltv_match_id, score, gap, team1_match, team2_match, signals_json, chosen, link_method, created_at)
      VALUES (${market.id}, ${candidate.hltvMatchId}, ${candidate.score}, ${gap}, ${candidate.team1Match ? 1 : 0}, ${
        candidate.team2Match ? 1 : 0
      }, ${sqlString(JSON.stringify(candidate.signals))}, ${chosen ? 1 : 0}, ${chosen ? sqlString('auto') : 'NULL'}, ${sqlString(timestamp)})
      ON CONFLICT(market_id, hltv_match_id) DO UPDATE SET
        score=excluded.score,
        gap=excluded.gap,
        team1_match=excluded.team1_match,
        team2_match=excluded.team2_match,
        signals_json=excluded.signals_json,
        chosen=excluded.chosen,
        link_method=excluded.link_method;`;
  });
  if (autoLinked && top) {
    statements.push(
      `UPDATE polymarket_markets SET hltv_match_id=${top.hltvMatchId}, link_method='auto', link_score=${top.score}, last_seen_at=${sqlString(
        timestamp,
      )} WHERE id=${market.id};`,
    );
  }
  return statements;
}

async function executeSqlChunks(statements: string[], chunkSize: number): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'pm-link-'));
  try {
    for (let index = 0; index < statements.length; index += chunkSize) {
      const filePath = join(dir, `chunk-${index}.sql`);
      writeFileSync(filePath, statements.slice(index, index + chunkSize).join('\n'));
      await wrangler(['d1', 'execute', 'csgogamble', '--remote', '--file', filePath]);
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

async function main(): Promise<void> {
  const apply = hasArg('--apply');
  const limit = Number(argValue('--limit', '5000'));
  const windowHours = Number(argValue('--window-hours', '96'));
  const chunkSize = Number(argValue('--chunk-size', '250'));

  const markets = await queryD1<MarketRow>(
    `SELECT id, start_date, end_date, parsed_team1_name, parsed_team2_name
       FROM polymarket_markets
      WHERE market_type='match_winner'
        AND hltv_match_id IS NULL
        AND parsed_team1_name IS NOT NULL
        AND parsed_team2_name IS NOT NULL
      ORDER BY COALESCE(end_date, start_date), id
      LIMIT ${Number.isFinite(limit) ? Math.trunc(limit) : 5000}`,
    (row) => ({
      id: toNumber(row.id),
      startDate: toNullableString(row.start_date),
      endDate: toNullableString(row.end_date),
      team1: String(row.parsed_team1_name),
      team2: String(row.parsed_team2_name),
    }),
  );
  const matches = await queryD1<MatchRow>(
    `SELECT hltv_match_id, scheduled_at, team1_name, team2_name
       FROM matches
      WHERE scheduled_at IS NOT NULL
        AND team1_name IS NOT NULL
        AND team2_name IS NOT NULL
        AND status IN ('parsed', 'partial')`,
    (row) => ({
      hltvMatchId: toNumber(row.hltv_match_id),
      scheduledAt: toNullableString(row.scheduled_at),
      team1: toNullableString(row.team1_name),
      team2: toNullableString(row.team2_name),
    }),
  );

  let autoLinked = 0;
  let rejected = 0;
  let noCandidates = 0;
  const statements: string[] = [];
  for (const market of markets) {
    const scored = candidateMatchesForMarket(market, matches, windowHours)
      .map((match) => scoreCandidate(market, match))
      .filter((candidate): candidate is Candidate => candidate !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const top = scored[0];
    if (!top) {
      noCandidates += 1;
      continue;
    }
    const gap = scored.length > 1 ? top.score - (scored[1]?.score ?? 0) : top.score;
    const canAutoLink = top.score >= 0.9 && gap >= 0.1 && top.team1Match && top.team2Match;
    if (canAutoLink) autoLinked += 1;
    else rejected += 1;
    statements.push(...linkSql(market, scored, gap, canAutoLink));
  }

  if (apply && statements.length > 0) {
    await executeSqlChunks(statements, chunkSize);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        apply,
        markets: markets.length,
        hltvMatches: matches.length,
        autoLinked,
        rejected,
        noCandidates,
        sqlStatements: statements.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});

import { PARSER_VERSION } from './constants';
import type {
  Env,
  ParsedLineupPlayer,
  ParsedMatch,
  ParsedPlayerMatchStat,
  ParsedPlayerStat,
  ParsedStream,
  ParsedVeto,
  PersistedArtifactResult,
  TeamSummary,
} from './types';
import { nowIso } from './utils';

function buildUpsertTeamStatement(db: D1Database, team: TeamSummary, timestamp: string): D1PreparedStatement | null {
  if (!team.hltvTeamId) {
    return null;
  }

  return db
    .prepare(
      `INSERT INTO teams (hltv_team_id, name, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(hltv_team_id) DO UPDATE SET
         name = excluded.name,
         updated_at = excluded.updated_at`,
    )
    .bind(team.hltvTeamId, team.name, timestamp);
}

function buildUpsertMatchStatement(
  db: D1Database,
  parsed: ParsedMatch,
  htmlR2Key: string | null,
  timestamp: string,
): D1PreparedStatement {
  const parseWarnings = parsed.parseWarnings.length > 0 ? JSON.stringify(parsed.parseWarnings) : null;

  return db
    .prepare(
      `INSERT INTO matches (
        hltv_match_id, slug, source_url, event_name, event_hltv_id, event_source_url,
        match_stage, match_format, match_location, match_status,
        best_of, scheduled_at,
        winner_team_id, team1_hltv_id, team2_hltv_id, team1_name, team2_name,
        team1_score, team2_score, team1_rank, team2_rank,
        status, html_r2_key, raw_demo_url, parser_version, parse_warnings,
        last_ingested_at, ingest_error
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6,
        ?7, ?8, ?9, ?10,
        ?11, ?12,
        ?13, ?14, ?15, ?16, ?17,
        ?18, ?19, ?20, ?21,
        ?22, ?23, ?24, ?25, ?26,
        ?27, NULL
      )
      ON CONFLICT(hltv_match_id) DO UPDATE SET
        slug = excluded.slug,
        source_url = excluded.source_url,
        event_name = excluded.event_name,
        event_hltv_id = excluded.event_hltv_id,
        event_source_url = excluded.event_source_url,
        match_stage = excluded.match_stage,
        match_format = excluded.match_format,
        match_location = excluded.match_location,
        match_status = excluded.match_status,
        best_of = excluded.best_of,
        scheduled_at = excluded.scheduled_at,
        winner_team_id = excluded.winner_team_id,
        team1_hltv_id = excluded.team1_hltv_id,
        team2_hltv_id = excluded.team2_hltv_id,
        team1_name = excluded.team1_name,
        team2_name = excluded.team2_name,
        team1_score = excluded.team1_score,
        team2_score = excluded.team2_score,
        team1_rank = excluded.team1_rank,
        team2_rank = excluded.team2_rank,
        status = excluded.status,
        html_r2_key = COALESCE(excluded.html_r2_key, matches.html_r2_key),
        raw_demo_url = excluded.raw_demo_url,
        parser_version = excluded.parser_version,
        parse_warnings = excluded.parse_warnings,
        last_ingested_at = excluded.last_ingested_at,
        ingest_error = NULL`,
    )
    .bind(
      parsed.hltvMatchId,
      parsed.slug,
      parsed.sourceUrl,
      parsed.eventName,
      parsed.eventHltvId,
      parsed.eventSourceUrl,
      parsed.matchStage,
      parsed.matchFormat,
      parsed.matchLocation,
      parsed.matchStatus,
      parsed.bestOf,
      parsed.scheduledAt,
      parsed.winnerTeamId,
      parsed.team1.hltvTeamId,
      parsed.team2.hltvTeamId,
      parsed.team1.name,
      parsed.team2.name,
      parsed.team1Score,
      parsed.team2Score,
      parsed.team1.rank,
      parsed.team2.rank,
      parsed.status,
      htmlR2Key,
      parsed.rawDemoUrl,
      parsed.parserVersion,
      parseWarnings,
      timestamp,
    );
}

function buildMapStatements(db: D1Database, parsed: ParsedMatch): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM maps WHERE match_hltv_id = ?1').bind(parsed.hltvMatchId),
  ];

  for (const map of parsed.maps) {
    statements.push(
      db
        .prepare(
          `INSERT INTO maps (
            match_hltv_id, hltv_map_id, map_name, source_url, team1_score, team2_score,
            map_order, map_status, pick_team_hltv_id, winner_team_hltv_id,
            team1_half_scores, team2_half_scores, performance_url
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
        )
        .bind(
          parsed.hltvMatchId,
          map.hltvMapId,
          map.mapName,
          map.sourceUrl,
          map.team1Score,
          map.team2Score,
          map.order,
          map.status,
          map.pickTeamHltvId,
          map.winnerTeamHltvId,
          map.team1HalfScores.length > 0 ? JSON.stringify(map.team1HalfScores) : null,
          map.team2HalfScores.length > 0 ? JSON.stringify(map.team2HalfScores) : null,
          map.performanceUrl,
        ),
    );
  }

  return statements;
}

function buildPlayerStatements(db: D1Database, parsed: ParsedMatch, timestamp: string): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM player_map_stats WHERE match_hltv_id = ?1').bind(parsed.hltvMatchId),
  ];

  for (const stat of parsed.playerStats) {
    statements.push(
      db
        .prepare(
          `INSERT INTO players (hltv_player_id, nickname, updated_at)
           VALUES (?1, ?2, ?3)
           ON CONFLICT(hltv_player_id) DO UPDATE SET
             nickname = excluded.nickname,
             updated_at = excluded.updated_at`,
        )
        .bind(stat.playerHltvId, stat.nickname, timestamp),
    );

    statements.push(buildPlayerMapStatStatement(db, parsed.hltvMatchId, stat, timestamp));
  }

  return statements;
}

function buildPlayerMapStatStatement(
  db: D1Database,
  matchHltvId: number,
  stat: ParsedPlayerStat,
  timestamp: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO player_map_stats (
        match_hltv_id, map_name, player_hltv_id, team_hltv_id,
        kills, deaths, kd_diff, first_kill_diff,
        adr, rating, rating_version, kast,
        source_url, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    )
    .bind(
      matchHltvId,
      stat.mapName,
      stat.playerHltvId,
      stat.teamHltvId,
      stat.kills,
      stat.deaths,
      stat.kdDiff,
      stat.firstKillDiff,
      stat.adr,
      stat.rating,
      stat.ratingVersion,
      stat.kast,
      stat.sourceUrl,
      timestamp,
    );
}

function buildPlayerMatchStatStatements(
  db: D1Database,
  matchHltvId: number,
  stats: ParsedPlayerMatchStat[],
  timestamp: string,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM player_match_stats WHERE match_hltv_id = ?1').bind(matchHltvId),
  ];

  for (const stat of stats) {
    statements.push(
      db
        .prepare(
          `INSERT INTO players (hltv_player_id, nickname, updated_at)
           VALUES (?1, ?2, ?3)
           ON CONFLICT(hltv_player_id) DO UPDATE SET
             nickname = excluded.nickname,
             updated_at = excluded.updated_at`,
        )
        .bind(stat.playerHltvId, stat.nickname, timestamp),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO player_match_stats (
            match_hltv_id, player_hltv_id, team_hltv_id,
            kills, deaths, kd_diff, first_kill_diff,
            adr, rating, rating_version, kast,
            source_url, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
        )
        .bind(
          matchHltvId,
          stat.playerHltvId,
          stat.teamHltvId,
          stat.kills,
          stat.deaths,
          stat.kdDiff,
          stat.firstKillDiff,
          stat.adr,
          stat.rating,
          stat.ratingVersion,
          stat.kast,
          stat.sourceUrl,
          timestamp,
        ),
    );
  }

  return statements;
}

function buildVetoStatements(db: D1Database, matchHltvId: number, vetoes: ParsedVeto[]): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM match_vetoes WHERE match_hltv_id = ?1').bind(matchHltvId),
  ];
  for (const veto of vetoes) {
    statements.push(
      db
        .prepare(
          `INSERT INTO match_vetoes (match_hltv_id, veto_order, action, team_hltv_id, team_name, map_name)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(matchHltvId, veto.order, veto.action, veto.teamHltvId, veto.teamName, veto.mapName),
    );
  }
  return statements;
}

function buildLineupStatements(
  db: D1Database,
  matchHltvId: number,
  lineup: ParsedLineupPlayer[],
  timestamp: string,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM match_lineup WHERE match_hltv_id = ?1').bind(matchHltvId),
  ];
  for (const entry of lineup) {
    statements.push(
      db
        .prepare(
          `INSERT INTO players (hltv_player_id, nickname, updated_at)
           VALUES (?1, ?2, ?3)
           ON CONFLICT(hltv_player_id) DO UPDATE SET
             nickname = excluded.nickname,
             updated_at = excluded.updated_at`,
        )
        .bind(entry.playerHltvId, entry.nickname, timestamp),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO match_lineup (match_hltv_id, team_hltv_id, player_hltv_id, nickname)
           VALUES (?1, ?2, ?3, ?4)`,
        )
        .bind(matchHltvId, entry.teamHltvId, entry.playerHltvId, entry.nickname),
    );
  }
  return statements;
}

function buildStreamStatements(db: D1Database, matchHltvId: number, streams: ParsedStream[]): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM match_streams WHERE match_hltv_id = ?1').bind(matchHltvId),
  ];
  for (const stream of streams) {
    statements.push(
      db
        .prepare(
          `INSERT INTO match_streams (match_hltv_id, name, url, language, viewers)
           VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
        .bind(matchHltvId, stream.name, stream.url, stream.language, stream.viewers),
    );
  }
  return statements;
}

function hasUsefulParsedChildren(parsed: ParsedMatch): boolean {
  return (
    parsed.maps.length > 0 ||
    parsed.playerStats.length > 0 ||
    parsed.playerAggregateStats.length > 0 ||
    parsed.vetoes.length > 0 ||
    parsed.lineup.length > 0 ||
    parsed.streams.length > 0
  );
}

function buildHtmlArtifactStatement(
  db: D1Database,
  matchId: number,
  sourceUrl: string,
  artifact: PersistedArtifactResult,
  timestamp: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO artifacts (
        artifact_type, match_hltv_id, source_url, r2_key, content_type, byte_size, checksum_sha256, status, updated_at
      ) VALUES ('raw_html', ?1, ?2, ?3, 'text/html; charset=utf-8', ?4, ?5, 'stored', ?6)
      ON CONFLICT(artifact_type, r2_key) DO UPDATE SET
        match_hltv_id = excluded.match_hltv_id,
        source_url = excluded.source_url,
        content_type = excluded.content_type,
        byte_size = excluded.byte_size,
        checksum_sha256 = excluded.checksum_sha256,
        status = excluded.status,
        updated_at = excluded.updated_at`,
    )
    .bind(matchId, sourceUrl, artifact.key, artifact.size, artifact.sha256, timestamp);
}

/** Persist a parsed match and its related rows using batched D1 statements. */
export async function persistParsedMatch(
  env: Env,
  parsed: ParsedMatch,
  htmlArtifact: PersistedArtifactResult | null,
): Promise<void> {
  const timestamp = nowIso();
  const statements: D1PreparedStatement[] = [];

  const teamStatements = [
    buildUpsertTeamStatement(env.DB, parsed.team1, timestamp),
    buildUpsertTeamStatement(env.DB, parsed.team2, timestamp),
  ].filter((statement): statement is D1PreparedStatement => statement !== null);

  statements.push(...teamStatements);
  statements.push(buildUpsertMatchStatement(env.DB, parsed, htmlArtifact?.key ?? null, timestamp));
  if (htmlArtifact) {
    statements.push(buildHtmlArtifactStatement(env.DB, parsed.hltvMatchId, parsed.sourceUrl, htmlArtifact, timestamp));
  }
  if (hasUsefulParsedChildren(parsed)) {
    if (parsed.maps.length > 0) {
      statements.push(...buildMapStatements(env.DB, parsed));
    }
    if (parsed.playerStats.length > 0) {
      statements.push(...buildPlayerStatements(env.DB, parsed, timestamp));
    }
    if (parsed.playerAggregateStats.length > 0) {
      statements.push(
        ...buildPlayerMatchStatStatements(env.DB, parsed.hltvMatchId, parsed.playerAggregateStats, timestamp),
      );
    }
    if (parsed.vetoes.length > 0) {
      statements.push(...buildVetoStatements(env.DB, parsed.hltvMatchId, parsed.vetoes));
    }
    if (parsed.lineup.length > 0) {
      statements.push(...buildLineupStatements(env.DB, parsed.hltvMatchId, parsed.lineup, timestamp));
    }
    if (parsed.streams.length > 0) {
      statements.push(...buildStreamStatements(env.DB, parsed.hltvMatchId, parsed.streams));
    }
  }

  await env.DB.batch(statements);
}

/** Record a challenge page without destructively replacing previously parsed normalized rows. */
export async function recordIngestChallenge(
  env: Env,
  hltvMatchId: number,
  sourceUrl: string,
  htmlR2Key: string | null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO matches (hltv_match_id, source_url, status, html_r2_key, parser_version, ingest_error, last_ingested_at)
       VALUES (?1, ?2, 'challenge', ?3, ?4, 'HLTV challenge page', ?5)
       ON CONFLICT(hltv_match_id) DO UPDATE SET
         source_url = excluded.source_url,
         status = excluded.status,
         html_r2_key = COALESCE(excluded.html_r2_key, matches.html_r2_key),
         parser_version = excluded.parser_version,
         ingest_error = excluded.ingest_error,
         last_ingested_at = excluded.last_ingested_at`,
  )
    .bind(hltvMatchId, sourceUrl, htmlR2Key, PARSER_VERSION, nowIso())
    .run();
}

/** Record a failed ingest attempt while preserving the most recent failure message. */
export async function recordIngestError(
  env: Env,
  hltvMatchId: number,
  sourceUrl: string,
  error: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO matches (hltv_match_id, source_url, status, parser_version, ingest_error, last_ingested_at)
       VALUES (?1, ?2, 'error', ?3, ?4, ?5)
       ON CONFLICT(hltv_match_id) DO UPDATE SET
         source_url = excluded.source_url,
         status = excluded.status,
         ingest_error = excluded.ingest_error,
         last_ingested_at = excluded.last_ingested_at`,
  )
    .bind(hltvMatchId, sourceUrl, PARSER_VERSION, error, nowIso())
    .run();
}

/** Update a single crawl-state cursor. */
export async function setCrawlCursor(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO crawl_state (key, value, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, value, nowIso())
    .run();
}

export async function tryAcquireCrawlLock(env: Env, key: string, token: string, ttlMs: number): Promise<boolean> {
  const nowMs = Date.now();
  const lockValue = JSON.stringify({ token, expiresAtMs: nowMs + ttlMs });
  const result = await env.DB.prepare(
    `INSERT INTO crawl_state (key, value, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at
       WHERE json_extract(crawl_state.value, '$.expiresAtMs') IS NULL
         OR CAST(json_extract(crawl_state.value, '$.expiresAtMs') AS INTEGER) < ?4`,
  )
    .bind(key, lockValue, nowIso(), nowMs)
    .run();

  return Boolean(result.meta.changed_db);
}

export async function releaseCrawlLock(env: Env, key: string, token: string): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM crawl_state
      WHERE key = ?1
        AND json_extract(value, '$.token') = ?2`,
  )
    .bind(key, token)
    .run();
}

export async function createIngestRun(
  env: Env,
  scope: string,
  target: string | null,
  status: string,
  message: string | null,
): Promise<number> {
  const result = await env.DB.prepare(
    `INSERT INTO ingest_runs (scope, target, status, message)
       VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(scope, target, status, message)
    .run();

  return Number(result.meta.last_row_id ?? 0);
}

export async function finishIngestRun(env: Env, id: number, status: string, message: string | null): Promise<void> {
  await env.DB.prepare(
    `UPDATE ingest_runs
        SET status = ?2,
            message = ?3,
            finished_at = ?4
      WHERE id = ?1`,
  )
    .bind(id, status, message, nowIso())
    .run();
}

/** Persist demo artifact metadata after the actual file has been uploaded to R2. */
export async function recordDemoArtifact(
  env: Env,
  matchId: number,
  rawDemoUrl: string,
  demoR2Key: string,
  byteSize: number | null,
  contentType: string | null,
): Promise<void> {
  const existing = await env.DB.prepare('SELECT 1 as present FROM matches WHERE hltv_match_id = ?1')
    .bind(matchId)
    .first();
  if (!existing) {
    throw new Error(`Cannot record demo for unknown match ${matchId}`);
  }

  const timestamp = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE matches
         SET raw_demo_url = ?2,
             demo_r2_key = ?3,
             last_ingested_at = ?4
         WHERE hltv_match_id = ?1`,
    ).bind(matchId, rawDemoUrl, demoR2Key, timestamp),
    env.DB.prepare(
      `INSERT INTO artifacts (
          artifact_type, match_hltv_id, source_url, r2_key, content_type, byte_size, status, updated_at
        ) VALUES ('demo', ?1, ?2, ?3, ?4, ?5, 'stored', ?6)
        ON CONFLICT(artifact_type, r2_key) DO UPDATE SET
          match_hltv_id = excluded.match_hltv_id,
          source_url = excluded.source_url,
          content_type = excluded.content_type,
          byte_size = excluded.byte_size,
          status = excluded.status,
          updated_at = excluded.updated_at`,
    ).bind(matchId, rawDemoUrl, demoR2Key, contentType, byteSize, timestamp),
  ]);
}

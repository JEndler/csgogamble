import { PARSER_VERSION } from './constants';
import type { Env, ParsedMatch, ParsedPlayerStat, PersistedArtifactResult, TeamSummary } from './types';
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
  return db
    .prepare(
      `INSERT INTO matches (
        hltv_match_id, slug, source_url, event_name, best_of, scheduled_at,
        winner_team_id, team1_hltv_id, team2_hltv_id, team1_name, team2_name,
        team1_score, team2_score, status, html_r2_key, raw_demo_url, parser_version,
        last_ingested_at, ingest_error
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, NULL)
      ON CONFLICT(hltv_match_id) DO UPDATE SET
        slug = excluded.slug,
        source_url = excluded.source_url,
        event_name = excluded.event_name,
        best_of = excluded.best_of,
        scheduled_at = excluded.scheduled_at,
        winner_team_id = excluded.winner_team_id,
        team1_hltv_id = excluded.team1_hltv_id,
        team2_hltv_id = excluded.team2_hltv_id,
        team1_name = excluded.team1_name,
        team2_name = excluded.team2_name,
        team1_score = excluded.team1_score,
        team2_score = excluded.team2_score,
        status = excluded.status,
        html_r2_key = COALESCE(excluded.html_r2_key, matches.html_r2_key),
        raw_demo_url = excluded.raw_demo_url,
        parser_version = excluded.parser_version,
        last_ingested_at = excluded.last_ingested_at,
        ingest_error = NULL`,
    )
    .bind(
      parsed.hltvMatchId,
      parsed.slug,
      parsed.sourceUrl,
      parsed.eventName,
      parsed.bestOf,
      parsed.scheduledAt,
      parsed.winnerTeamId,
      parsed.team1.hltvTeamId,
      parsed.team2.hltvTeamId,
      parsed.team1.name,
      parsed.team2.name,
      parsed.team1Score,
      parsed.team2Score,
      parsed.status,
      htmlR2Key,
      parsed.rawDemoUrl,
      parsed.parserVersion,
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
          `INSERT INTO maps (match_hltv_id, hltv_map_id, map_name, source_url, team1_score, team2_score)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(parsed.hltvMatchId, map.hltvMapId, map.mapName, map.sourceUrl, map.team1Score, map.team2Score),
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
        kills, deaths, adr, rating, kast, source_url, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
    .bind(
      matchHltvId,
      stat.mapName,
      stat.playerHltvId,
      stat.teamHltvId,
      stat.kills,
      stat.deaths,
      stat.adr,
      stat.rating,
      stat.kast,
      stat.sourceUrl,
      timestamp,
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
  statements.push(...buildMapStatements(env.DB, parsed));
  statements.push(...buildPlayerStatements(env.DB, parsed, timestamp));

  await env.DB.batch(statements);
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

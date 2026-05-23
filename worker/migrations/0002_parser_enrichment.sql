-- Forward-only migration adding parser-enrichment columns and child tables.
-- Augments the schema defined in 0001_initial.sql; do not edit 0001.

ALTER TABLE matches ADD COLUMN event_hltv_id INTEGER;
ALTER TABLE matches ADD COLUMN event_source_url TEXT;
ALTER TABLE matches ADD COLUMN match_stage TEXT;
ALTER TABLE matches ADD COLUMN match_format TEXT;
ALTER TABLE matches ADD COLUMN match_location TEXT;
ALTER TABLE matches ADD COLUMN match_status TEXT;
ALTER TABLE matches ADD COLUMN team1_rank INTEGER;
ALTER TABLE matches ADD COLUMN team2_rank INTEGER;
ALTER TABLE matches ADD COLUMN parse_warnings TEXT;
CREATE INDEX IF NOT EXISTS idx_matches_event_hltv_id ON matches(event_hltv_id);

ALTER TABLE maps ADD COLUMN map_order INTEGER;
ALTER TABLE maps ADD COLUMN map_status TEXT;
ALTER TABLE maps ADD COLUMN pick_team_hltv_id INTEGER;
ALTER TABLE maps ADD COLUMN winner_team_hltv_id INTEGER;
ALTER TABLE maps ADD COLUMN team1_half_scores TEXT;
ALTER TABLE maps ADD COLUMN team2_half_scores TEXT;
ALTER TABLE maps ADD COLUMN performance_url TEXT;

ALTER TABLE player_map_stats ADD COLUMN kd_diff INTEGER;
ALTER TABLE player_map_stats ADD COLUMN first_kill_diff INTEGER;
ALTER TABLE player_map_stats ADD COLUMN rating_version TEXT;

CREATE TABLE IF NOT EXISTS player_match_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_hltv_id INTEGER NOT NULL,
  player_hltv_id INTEGER NOT NULL,
  team_hltv_id INTEGER,
  kills INTEGER,
  deaths INTEGER,
  kd_diff INTEGER,
  first_kill_diff INTEGER,
  adr REAL,
  rating REAL,
  rating_version TEXT,
  kast REAL,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(match_hltv_id, player_hltv_id),
  FOREIGN KEY (match_hltv_id) REFERENCES matches(hltv_match_id) ON DELETE CASCADE,
  FOREIGN KEY (player_hltv_id) REFERENCES players(hltv_player_id),
  FOREIGN KEY (team_hltv_id) REFERENCES teams(hltv_team_id)
);
CREATE INDEX IF NOT EXISTS idx_player_match_stats_match ON player_match_stats(match_hltv_id);
CREATE INDEX IF NOT EXISTS idx_player_match_stats_player ON player_match_stats(player_hltv_id);

CREATE TABLE IF NOT EXISTS match_vetoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_hltv_id INTEGER NOT NULL,
  veto_order INTEGER NOT NULL,
  action TEXT NOT NULL,
  team_hltv_id INTEGER,
  team_name TEXT,
  map_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(match_hltv_id, veto_order),
  FOREIGN KEY (match_hltv_id) REFERENCES matches(hltv_match_id) ON DELETE CASCADE,
  FOREIGN KEY (team_hltv_id) REFERENCES teams(hltv_team_id)
);
CREATE INDEX IF NOT EXISTS idx_match_vetoes_match ON match_vetoes(match_hltv_id);

CREATE TABLE IF NOT EXISTS match_lineup (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_hltv_id INTEGER NOT NULL,
  team_hltv_id INTEGER,
  player_hltv_id INTEGER NOT NULL,
  nickname TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(match_hltv_id, team_hltv_id, player_hltv_id),
  FOREIGN KEY (match_hltv_id) REFERENCES matches(hltv_match_id) ON DELETE CASCADE,
  FOREIGN KEY (player_hltv_id) REFERENCES players(hltv_player_id),
  FOREIGN KEY (team_hltv_id) REFERENCES teams(hltv_team_id)
);
CREATE INDEX IF NOT EXISTS idx_match_lineup_match ON match_lineup(match_hltv_id);

CREATE TABLE IF NOT EXISTS match_streams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_hltv_id INTEGER NOT NULL,
  name TEXT,
  url TEXT,
  language TEXT,
  viewers INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_hltv_id) REFERENCES matches(hltv_match_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_match_streams_match ON match_streams(match_hltv_id);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hltv_team_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hltv_player_id INTEGER NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  real_name TEXT,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hltv_match_id INTEGER NOT NULL UNIQUE,
  slug TEXT,
  source_url TEXT NOT NULL,
  event_name TEXT,
  best_of INTEGER,
  scheduled_at TEXT,
  winner_team_id INTEGER,
  team1_hltv_id INTEGER,
  team2_hltv_id INTEGER,
  team1_name TEXT,
  team2_name TEXT,
  team1_score INTEGER,
  team2_score INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  html_r2_key TEXT,
  demo_r2_key TEXT,
  raw_demo_url TEXT,
  ingest_error TEXT,
  parser_version TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_ingested_at TEXT,
  FOREIGN KEY (winner_team_id) REFERENCES teams(hltv_team_id)
);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_scheduled_at ON matches(scheduled_at);

CREATE TABLE IF NOT EXISTS maps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_hltv_id INTEGER NOT NULL,
  hltv_map_id INTEGER,
  map_name TEXT NOT NULL,
  source_url TEXT,
  team1_score INTEGER,
  team2_score INTEGER,
  round_history TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(match_hltv_id, map_name),
  UNIQUE(hltv_map_id),
  FOREIGN KEY (match_hltv_id) REFERENCES matches(hltv_match_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_maps_match_hltv_id ON maps(match_hltv_id);

CREATE TABLE IF NOT EXISTS player_map_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_hltv_id INTEGER NOT NULL,
  map_name TEXT NOT NULL,
  player_hltv_id INTEGER NOT NULL,
  team_hltv_id INTEGER,
  kills INTEGER,
  deaths INTEGER,
  adr REAL,
  rating REAL,
  kast REAL,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(match_hltv_id, map_name, player_hltv_id),
  FOREIGN KEY (match_hltv_id) REFERENCES matches(hltv_match_id) ON DELETE CASCADE,
  FOREIGN KEY (player_hltv_id) REFERENCES players(hltv_player_id),
  FOREIGN KEY (team_hltv_id) REFERENCES teams(hltv_team_id)
);
CREATE INDEX IF NOT EXISTS idx_player_map_stats_match_hltv_id ON player_map_stats(match_hltv_id);
CREATE INDEX IF NOT EXISTS idx_player_map_stats_player_hltv_id ON player_map_stats(player_hltv_id);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  target TEXT,
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_type TEXT NOT NULL,
  match_hltv_id INTEGER,
  source_url TEXT,
  r2_key TEXT,
  content_type TEXT,
  byte_size INTEGER,
  checksum_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(artifact_type, r2_key),
  FOREIGN KEY (match_hltv_id) REFERENCES matches(hltv_match_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_artifacts_match_hltv_id ON artifacts(match_hltv_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_type_status ON artifacts(artifact_type, status);

CREATE TABLE IF NOT EXISTS crawl_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Forward-only migration adding Polymarket H1 (events/markets/outcomes catalog)
-- and H2 (price-history manifests) infrastructure. Heavy/raw payloads (gamma
-- API JSON, CLOB market detail, raw price history points, normalized JSONL
-- series) stay in R2 under the POLYMARKET_DATA bucket. D1 stores only
-- metadata, control state, and manifest pointers so the catalog stays small
-- and queryable.
--
-- Augments earlier migrations; do not edit 0001/0002/0003.

-- polymarket_crawl_runs is the operational bookkeeping row for each
-- gamma/CLOB ingestion attempt. A run lives in D1 so a crashed/restarted
-- operator can resume and so health scripts can observe progress without
-- re-pulling artifacts.
CREATE TABLE IF NOT EXISTS polymarket_crawl_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_type TEXT NOT NULL,                   -- 'gamma_events' | 'clob_market' | 'price_history' | 'link' | 'other'
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  target TEXT,                              -- free-form pointer (cursor / market id / token id)
  options_json TEXT,                        -- run inputs (caps, filters, etc.)
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  events_seen INTEGER NOT NULL DEFAULT 0,
  markets_seen INTEGER NOT NULL DEFAULT 0,
  outcomes_seen INTEGER NOT NULL DEFAULT 0,
  classified_known INTEGER NOT NULL DEFAULT 0,
  classified_unknown INTEGER NOT NULL DEFAULT 0,
  price_history_manifests_written INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  failure_class TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_polymarket_crawl_runs_type_status
  ON polymarket_crawl_runs(run_type, status);
CREATE INDEX IF NOT EXISTS idx_polymarket_crawl_runs_created_at
  ON polymarket_crawl_runs(created_at);

-- polymarket_events is the H1 catalog row for a Gamma event (the "Liquid v
-- Falcons - Major Final" container that bundles many markets). slug is
-- derived from Gamma; polymarket_event_id is the Gamma numeric id when
-- present (NULL is tolerated because some experimental events expose only a
-- slug).
CREATE TABLE IF NOT EXISTS polymarket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  polymarket_event_id TEXT,
  slug TEXT NOT NULL,
  title TEXT,
  category TEXT,
  start_date TEXT,
  end_date TEXT,
  closed INTEGER,
  archived INTEGER,
  active INTEGER,
  volume REAL,
  liquidity REAL,
  raw_r2_key TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(slug)
);
CREATE INDEX IF NOT EXISTS idx_polymarket_events_event_id ON polymarket_events(polymarket_event_id);
CREATE INDEX IF NOT EXISTS idx_polymarket_events_category ON polymarket_events(category);

-- polymarket_markets is the H1 catalog row for a single market within an
-- event. condition_id is the canonical CLOB market identifier; question_id
-- is the underlying UMA question id when exposed. market_type is the
-- classifier output (match_winner / map_winner / total_maps / map_handicap
-- / outright / player_prop / other / unknown).
CREATE TABLE IF NOT EXISTS polymarket_markets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER,
  condition_id TEXT NOT NULL,
  question_id TEXT,
  slug TEXT,
  question TEXT,
  description TEXT,
  market_type TEXT NOT NULL DEFAULT 'unknown',
  classifier_version TEXT,
  classifier_signals TEXT,
  closed INTEGER,
  archived INTEGER,
  active INTEGER,
  accepting_orders INTEGER,
  end_date TEXT,
  start_date TEXT,
  resolution_source TEXT,
  parsed_team1_name TEXT,
  parsed_team2_name TEXT,
  parsed_map_name TEXT,
  parsed_total_value REAL,
  parsed_handicap_value REAL,
  hltv_match_id INTEGER,
  link_method TEXT,                         -- 'auto' | 'manual' | NULL
  link_score REAL,
  raw_r2_key TEXT,
  clob_raw_r2_key TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(condition_id),
  FOREIGN KEY (event_id) REFERENCES polymarket_events(id) ON DELETE SET NULL,
  FOREIGN KEY (hltv_match_id) REFERENCES matches(hltv_match_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_polymarket_markets_event ON polymarket_markets(event_id);
CREATE INDEX IF NOT EXISTS idx_polymarket_markets_type ON polymarket_markets(market_type);
CREATE INDEX IF NOT EXISTS idx_polymarket_markets_hltv ON polymarket_markets(hltv_match_id);
CREATE INDEX IF NOT EXISTS idx_polymarket_markets_question ON polymarket_markets(question_id);

-- polymarket_outcomes is the per-outcome row exploded out from a market's
-- JSON-string fields (outcomes / outcomePrices / clobTokenIds). token_id is
-- the value historical price history must be queried against.
CREATE TABLE IF NOT EXISTS polymarket_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id INTEGER NOT NULL,
  outcome_index INTEGER NOT NULL,
  label TEXT,
  token_id TEXT,
  last_price REAL,
  winner INTEGER,
  parsed_team_name TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(market_id, outcome_index),
  FOREIGN KEY (market_id) REFERENCES polymarket_markets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_polymarket_outcomes_token ON polymarket_outcomes(token_id);

-- polymarket_gamma_pages tracks each Gamma keyset page we acquired into R2.
-- One row per page lets us reparse without re-fetching the public API.
CREATE TABLE IF NOT EXISTS polymarket_gamma_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER,
  cursor TEXT,
  page_index INTEGER NOT NULL,
  fetched_url TEXT,
  items_count INTEGER NOT NULL DEFAULT 0,
  byte_size INTEGER,
  checksum_sha256 TEXT,
  r2_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'stored',
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(r2_key),
  FOREIGN KEY (run_id) REFERENCES polymarket_crawl_runs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_polymarket_gamma_pages_run ON polymarket_gamma_pages(run_id);

-- polymarket_hltv_link_candidates stores deterministic linker output. We
-- always store the top-N candidates per market, including the chosen one,
-- so manual review can adjust without re-running the linker.
CREATE TABLE IF NOT EXISTS polymarket_hltv_link_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id INTEGER NOT NULL,
  hltv_match_id INTEGER NOT NULL,
  score REAL NOT NULL,
  gap REAL,
  team1_match INTEGER,
  team2_match INTEGER,
  signals_json TEXT,
  chosen INTEGER NOT NULL DEFAULT 0,
  link_method TEXT,                         -- 'auto' | 'manual' | 'rejected'
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(market_id, hltv_match_id),
  FOREIGN KEY (market_id) REFERENCES polymarket_markets(id) ON DELETE CASCADE,
  FOREIGN KEY (hltv_match_id) REFERENCES matches(hltv_match_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_polymarket_link_candidates_market
  ON polymarket_hltv_link_candidates(market_id);
CREATE INDEX IF NOT EXISTS idx_polymarket_link_candidates_match
  ON polymarket_hltv_link_candidates(hltv_match_id);

-- team_aliases lets the linker map Polymarket name renderings ("Team
-- Liquid", "LIQUID", "TL") onto a canonical HLTV team. Manually curated
-- over time; seeded as empty.
CREATE TABLE IF NOT EXISTS team_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hltv_team_id INTEGER NOT NULL,
  alias TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(alias_normalized),
  FOREIGN KEY (hltv_team_id) REFERENCES teams(hltv_team_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_team_aliases_team ON team_aliases(hltv_team_id);

-- polymarket_price_history_manifests is one row per token_id whose price
-- history we have ever written to R2. raw_r2_key points at the unmodified
-- CLOB prices-history JSON; series_r2_key points at the normalized JSONL
-- (one minute-bucketed sample per line) we produce alongside. Manifests
-- only — actual points stay in R2.
CREATE TABLE IF NOT EXISTS polymarket_price_history_manifests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id INTEGER,
  outcome_id INTEGER,
  token_id TEXT NOT NULL,
  interval TEXT,                            -- '1m' | '1h' | '1d' | '1w' | 'max'
  fidelity_minutes INTEGER,
  start_ts TEXT,
  end_ts TEXT,
  point_count INTEGER NOT NULL DEFAULT 0,
  raw_r2_key TEXT,
  series_r2_key TEXT,
  raw_byte_size INTEGER,
  series_byte_size INTEGER,
  checksum_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'stored',    -- 'pending' | 'stored' | 'partial' | 'failed'
  message TEXT,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(token_id, interval, fidelity_minutes, start_ts, end_ts),
  FOREIGN KEY (market_id) REFERENCES polymarket_markets(id) ON DELETE SET NULL,
  FOREIGN KEY (outcome_id) REFERENCES polymarket_outcomes(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_polymarket_price_history_market
  ON polymarket_price_history_manifests(market_id);
CREATE INDEX IF NOT EXISTS idx_polymarket_price_history_token
  ON polymarket_price_history_manifests(token_id);

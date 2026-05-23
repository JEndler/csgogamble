-- Forward-only migration adding circuit-breaker classification on ingest_runs
-- and the D1-backed backfill daemon schema. Augments earlier migrations; do not
-- edit 0001/0002.

-- ingest_runs gains a structured failure_class so health/ops can separate
-- challenge storms from genuine errors. Existing rows stay NULL.
ALTER TABLE ingest_runs ADD COLUMN failure_class TEXT;
CREATE INDEX IF NOT EXISTS idx_ingest_runs_scope_status ON ingest_runs(scope, status);
CREATE INDEX IF NOT EXISTS idx_ingest_runs_created_at ON ingest_runs(created_at);

-- backfill_runs is the durable checkpoint for daemon-style historical runs.
-- A run lives in D1 so a crashed/restarted operator can resume without losing
-- track of which candidates were already processed. The counter column names
-- match the canonical candidate terminal vocabulary (parsed, partial, challenge,
-- skipped, failed_classified) so reporting/health code can index by state name.
CREATE TABLE IF NOT EXISTS backfill_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'pending',
  candidate_filter TEXT,
  total_candidates INTEGER NOT NULL DEFAULT 0,
  enqueued INTEGER NOT NULL DEFAULT 0,
  parsed INTEGER NOT NULL DEFAULT 0,
  partial INTEGER NOT NULL DEFAULT 0,
  challenge INTEGER NOT NULL DEFAULT 0,
  failed_classified INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  options_json TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_backfill_runs_status ON backfill_runs(status);

-- backfill_candidates tracks the per-match lifecycle inside a backfill run.
-- States: pending -> enqueued -> { parsed | partial | challenge | skipped | failed_classified }.
-- enqueued is a claim marker; the admin enqueue path claims first, then sends to
-- the queue, then rolls back to pending if the send fails. The queue ingest
-- consumer finalizes each candidate to one of the terminal states after the
-- per-match ingest call completes.
CREATE TABLE IF NOT EXISTS backfill_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  hltv_match_id INTEGER NOT NULL,
  source_url TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  failure_class TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  finished_at TEXT,
  message TEXT,
  UNIQUE(run_id, hltv_match_id),
  FOREIGN KEY (run_id) REFERENCES backfill_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_backfill_candidates_run_state ON backfill_candidates(run_id, state);
CREATE INDEX IF NOT EXISTS idx_backfill_candidates_match ON backfill_candidates(hltv_match_id);

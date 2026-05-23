# TODO

## Done: ingestion health report

Implemented as a one-command remote D1 health check.

Command:

```bash
cd worker
npm run health:ingest
npm run health:ingest -- --json
npm run health:ingest -- --strict --samples 10
```

Current behavior:

- Reports match counts and parsed / partial / challenge / error percentages.
- Reports latest ingest timestamp and freshness gate.
- Reports current parser-version coverage.
- Reports raw HTML artifact coverage and suspicious-small-artifact checks.
- Reports enriched child-table coverage for maps, player stats, vetoes, lineups, and streams.
- Reports parser warnings, missing critical parsed fields, recent 24h/7d status, stale parser samples, and remediation samples.
- Exits nonzero on hard health failures, and also on warnings when `--strict` is used.

Remaining cleanup:

- Add focused unit tests for threshold/gate behavior when the script is split into testable modules.
- Add a small operational command for closing stale `ingest_runs` rows rather than doing manual D1 SQL.

## 1. Reliable Cloudflare-native acquisition

Goal: make acquisition scale predictably while respecting the hard boundary: no protected-source local scraping by default. Acquisition should run through deployed Workers / Cloudflare Browser Rendering; local work is limited to tests, D1/R2 inspection, parser replay, and docs.

Success is operational reliability, not “we scraped more pages once.” Measure success across five gates:

1. Challenge containment
   - Primary metric: scheduled discovery challenge storm rate drops to near zero.
   - Success:
     - if HLTV challenges us, cron stops hammering within 1-2 failed canaries
     - repeated cron ticks write `skipped_circuit_open` during cooldown, not endless error rows
     - 24h scheduled-discovery challenge fan-out count is <= 2 per circuit event
   - Failure:
     - every 15-minute cron tick keeps creating `HLTV results discovery hit a Cloudflare challenge page` errors

2. Acquisition throughput
   - Primary metric: matches acquired per successful acquisition window.
   - Success tiers:
     - canary: 10 matches, zero worker crashes, health stays green
     - small batch: 50 matches, >= 85% usable rows (`parsed + partial`), <= 5% challenge, 0 unclassified errors
     - medium batch: 500 matches, resumes cleanly after interruption, no duplicate work
     - production run: 2k+ candidates over multiple hours with bounded retries and no manual babysitting
   - `partial` rows count as usable for initial volume because raw HTML is retained and metadata is often still useful.

3. Data quality after acquisition
   - Primary metric: enrichment coverage does not regress from the current baseline.
   - Current baseline:
     - parsed: 88.6%
     - partial: 8.43%
     - challenge: 2.97%
     - error: 0%
     - parser current: 99.88%
     - raw artifact coverage: 97.86%
     - maps/mapStats/aggStats/lineup: 100%
     - vetoes: 99.87%
     - streams: 93.16%
   - Success after acquisition:
     - error rate remains <= 1-2%
     - challenge rate stays <= 5-8% over new rows
     - raw HTML artifact coverage >= 98% for attempted acquisitions
     - current parser coverage >= 99%
     - parsed rows with maps/player stats remain >= 95%
     - missing critical parsed fields remains 0, or every exception is explicitly understood
   - Failure:
     - volume increases but data quality is poisoned: missing teams, missing maps, no raw artifacts, stale parser versions, or high challenge/error rows

4. Backfill daemon behavior
   - Primary metric: runs are resumable and self-reporting.
   - Success:
     - every backfill has a run id
     - every candidate ends in one terminal state: `parsed`, `partial`, `challenge`, `skipped`, or `failed_classified`
     - SIGINT/crash/redeploy does not lose cursor
     - resume does not duplicate work
     - one bad browser/page/session does not kill the full run
     - final summary includes attempted, succeeded, partial, challenged, failed by class, retried, skipped, final cursor, elapsed time, and health delta
   - Failure:
     - “It crashed somewhere around match 237, unclear what happened.”

5. Operator health loop
   - Primary metric: one command tells us whether to scale, pause, or repair.
   - Success:
     - preflight `npm run health:ingest` is green or gives a concrete blocker
     - post-run health delta shows whether the batch improved coverage or caused regression
     - stale runs are cleaned by `npm run ops:close-stale-runs`, not manual D1 SQL
     - alerts stay silent when healthy and noisy only when action is required

Concrete acceptance tests:

- Phase A: circuit breaker
  - Force or observe a challenge condition.
  - Verify only 1-2 real acquisition attempts happen.
  - Verify subsequent cron ticks create `skipped_circuit_open`, not error spam.
  - Verify health reports discovery challenged / circuit open while parser/data health remains separately visible.

- Phase B: 50-match canary
  - Preflight health is green.
  - Run Worker-native 50-match acquisition.
  - Post-run checks:
    - no stuck `ingest_runs`
    - no unclassified errors
    - raw artifact coverage >= 98% for attempted rows
    - parsed + partial >= 85%
    - challenge <= 8%
    - health stays green or only emits expected challenge warning

- Phase C: 500-match resumability test
  - Start a 500-match run.
  - Interrupt around mid-run.
  - Resume.
  - Verify no duplicate candidate processing, cursor advances correctly, terminal summary matches D1 counts, and no stale locks/runs are left open.

If all three phases pass, acquisition is reliable enough to scale. If not, it is still a toy.

### 1.1 Stop repeated challenged scheduled discovery

Problem observed: scheduled discovery is currently producing repeated `HLTV results discovery hit a Cloudflare challenge page` errors.

Plan:

- Split discovery health from parser/data health in `npm run health:ingest` so challenge storms are visible without obscuring parser coverage.
- Add a circuit breaker for scheduled discovery:
  - track consecutive challenge failures per discovery target/window
  - pause new discovery attempts after threshold
  - write a clear `skipped_circuit_open` ingest_run instead of hammering HLTV every cron tick
  - auto-resume after a cooldown or explicit operator command
- Persist failure classification on each run:
  - `challenge`
  - `browser_closed`
  - `timeout`
  - `navigation_error`
  - `parse_error`
  - `worker_error`
  - `unknown`
- Add challenge-rate gates for scheduled discovery over 1h / 24h / 7d.
- Add a canary discovery mode that fetches one small known page before scheduled fan-out. Abort the fan-out if the canary is challenged.

Definition of done:

- Cron no longer spams repeated challenge acquisitions while the source is blocking us.
- Health report clearly distinguishes “parser/data healthy” from “live discovery challenged.”
- A canary failure prevents batch fan-out.

### 1.2 Make stale run/lock cleanup first-class

Problem observed: old `ingest_runs.finished_at IS NULL` rows can make health red even when they are stale bookkeeping residue.

Plan:

- Add an ops script: `npm run ops:close-stale-runs`.
- Default to dry-run; require `--apply` for writes.
- Only close rows older than a configurable threshold, default 2h.
- Mark rows as `stale_closed` or `skipped_stale_closed`, preserve the original message, and set `finished_at`.
- Teach `npm run health:ingest` to count active stuck runs separately from stale-closed historical rows.
- Add tests for SQL generation / threshold filtering if practical.

Definition of done:

- No manual D1 SQL is needed to recover from stale run bookkeeping.
- Health only fails for actually-active stuck runs or excessive stale-run accumulation.

### 1.3 Daemon-grade historical backfill through deployed Worker paths

Goal: run hundreds/thousands of match acquisitions without one bad browser session killing the whole operation.

Requirements:

- Candidate source:
  - D1 query for missing/stale/partial/challenge candidates
  - optional explicit match-id list
  - dry-run/list mode before enqueueing
- Persistent checkpointing:
  - D1-backed run id + cursor
  - resumable after crash/interruption
  - no duplicate work when resumed
- Retry policy:
  - bounded attempts per match URL/id
  - exponential backoff with jitter
  - classify and persist final failure type
- Worker-native execution:
  - enqueue Cloudflare Queue messages or call Worker debug/admin endpoint
  - no local HLTV acquisition unless `--allow-local-hltv` is explicitly passed
- Batch control:
  - `--max <n>`
  - `--batch-size <n>`
  - `--concurrency <n>`
  - `--resume`
  - `--run-id <id>`
  - `--json`
- Health integration:
  - preflight `npm run health:ingest`
  - abort on hard health failures unless `--force`
  - post-run health delta summary

Definition of done:

- A 50-match canary can run unattended and produce a useful before/after health delta.
- A 500-match run can resume after interruption without duplicate work.
- Browser-closed / challenge / timeout failures are classified and do not crash the whole run.

### 1.4 Observability and operator feedback

Plan:

- Add structured run summaries for scheduled discovery, backfill, and queue ingestion.
- Add `npm run health:ingest -- --json` output suitable for cron/watchdog consumption.
- Add a small watchdog cron in Hermes only after the repo command is stable:
  - alert when latest ingest is stale
  - alert when challenge/error rates cross threshold
  - stay silent when healthy
- Add README/CLAUDE.md operator snippets for:
  - preflight
  - canary
  - resume
  - stale-run cleanup
  - post-run verification

Definition of done:

- We can tell within one command whether acquisition, parser, storage, and enrichment are healthy.
- Failures point to a concrete next action instead of just dumping counts.

## 2. Next product/data work after acquisition is stable

- Design odds ingestion before writing first market scraper.
- Add leakage-safe feature export v0 from D1.
- Start model-training baseline once acquisition volume is reliable.
- Keep raw artifacts in R2 as the source of truth for parser replay.

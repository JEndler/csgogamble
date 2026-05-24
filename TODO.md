# TODO

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
- Add focused unit tests for health threshold/gate behavior when the script is split into testable modules.
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

## 2. Historical Polymarket CS2 market data baseline

Goal: build the historical market dataset that lets us train and backtest market-vs-match-state signals before we have our own live WebSocket tape. Treat historical public data as useful for signal backtests, not as proof of executable fills: public history gives sampled prices and trades, not historical bid/ask/orderbook depth.

Architecture posture:

- D1 is the metadata, manifest, linking, and latest-state/control-plane store.
- R2 is the append-only data lake for raw API responses, historical price series, trades, derived bars, and future Parquet exports.
- Do not store high-frequency or large historical market series primarily in D1.
- Preserve raw Polymarket API responses in R2 before/alongside normalized outputs so parsers can be replayed.
- Use Gamma/CLOB/Data API public endpoints for historical Polymarket data. Do not scrape protected sources locally.

### H1. Canonical historical market metadata

Goal: discover closed and active CS2 Polymarket markets, classify them, and link direct match-winner markets to HLTV matches.

Implementation todo:

- Discover CS2 events/markets through Gamma keyset pagination using `tag_id=100780`.
- Persist raw discovery pages to R2 with request URL, params, fetched_at, page cursor, response checksum, and source API version if available.
- Normalize into canonical tables/records:
  - Polymarket event id, slug, title, tags, volume/liquidity/open-interest fields, created/end/close timestamps.
  - market id, slug, question, conditionId, marketType, active/closed/resolved flags, resolution outcome.
  - outcome/token records from `outcomes`, `outcomePrices`, and `clobTokenIds`.
  - CLOB detail fields, especially `game_start_time`, when available.
- Classify markets into at least:
  - `match_winner`
  - `map_winner`
  - `total_maps`
  - `map_handicap`
  - `outright`
  - `player_prop`
  - `other`
- Link only `match_winner` markets directly to HLTV matches in v0.
- Implement scored HLTV linking using teams/outcomes, CLOB `game_start_time`, event similarity, BO agreement, and an alias table. Do not rely on Polymarket slug abbreviations.
- Store ambiguous candidates instead of forcing links.

Acceptance criteria:

- A full Gamma keyset crawl for `tag_id=100780` can run resumably and idempotently.
- Raw discovery responses are present in R2 and referenced by D1/manifests.
- Every normalized market has a stable canonical key: `conditionId` plus token ids.
- Main match-winner classifier precision is high enough for auto-linking: no known map/outright/prop markets are linked as match winners in a reviewed sample.
- Auto-link only when:
  - market type is `match_winner`
  - both teams match
  - top score >= 0.90
  - runner-up gap >= 0.10
- Lower-confidence candidates are stored with scores and reasons for review.
- Linked rows include HLTV match id, Polymarket conditionId, matched teams, scheduled/game_start_time delta, score, status, and review reason.
- The ingestion can be rerun without duplicating markets, outcomes, or links.

### H2. Historical odds curves from CLOB price history

Goal: pull the best available public historical odds curve for each linked match-winner market.

Implementation todo:

- For each linked match-winner market, pull CLOB `/prices-history` for both outcome token ids.
- Use the highest practical fidelity available; public docs define fidelity in minutes, so treat v0 as minute-level, not second-level.
- Pull windows needed for modeling:
  - all available history when practical
  - final 24h before game start
  - final 1h before game start
  - final 10m before game start
  - scheduled/game start through close/resolution
- Use batch price-history endpoint where it reduces request overhead, respecting its max token count.
- Store raw responses in R2 and normalized price points in partitioned R2 objects.
- D1 stores only manifests/index rows and lightweight summaries.
- Record endpoint params (`interval`, `startTs`, `endTs`, `fidelity`) on every object/manifest.

Acceptance criteria:

- For a reviewed sample of linked markets, both outcome tokens have price-history attempts with status recorded: `ok`, `empty`, `not_found`, `rate_limited`, or `failed_classified`.
- Normalized rows include conditionId, token_id, outcome label, timestamp, price, source endpoint, request window, and fidelity.
- Duplicate pulls are idempotent by conditionId/token/window/fidelity/checksum.
- The pipeline distinguishes missing API history from true zero data; empty histories do not silently look like successful dense curves.
- Derived final-odds fields can be computed for every market with sufficient data:
  - price 10m before start
  - price 5m before start
  - price 1m before start
  - price nearest scheduled start
  - min/max/volatility during live window where timestamps overlap
- Documentation explicitly labels this series as sampled/display/midpoint-ish odds, not executable bid/ask.

### H3. Historical trades / prints

Goal: collect executed trades for each historical CS2 match-winner market and derive volume/last-trade features.

Implementation todo:

- Pull Data API trades for each linked conditionId.
- Handle pagination/offset limits by partitioning requests when needed.
- Normalize trades with a deterministic dedupe key built from transactionHash + conditionId + asset/token + side + wallet/proxyWallet + timestamp + size + price.
- Preserve raw trade responses in R2.
- Store normalized trade data in R2, partitioned by market/date where practical.
- Store D1 summaries/manifests only.
- Add optional later path for on-chain validation if Data API gaps are discovered; do not block v0 on on-chain reconstruction.

Acceptance criteria:

- Every linked market has a trade-ingestion status and count.
- Trades are deduped deterministically and re-running ingestion does not inflate counts.
- Normalized trades include conditionId, token/asset id, outcome, side, size, price, timestamp, transactionHash, wallet/proxyWallet when available, and source metadata.
- Derived bars/features are produced at 1m granularity at minimum:
  - trade count
  - volume
  - VWAP
  - last trade price
  - largest trade size
  - price jump from prior trade/bar
- Low/no-trade markets are explicitly flagged as stale/illiquid rather than treated as dense price series.
- Data API trade totals are compared against market-level volume fields where possible and discrepancies are reported, not hidden.

### H4. Training feature tables

Goal: convert linked market metadata, historical odds curves, trades, and HLTV/demo match records into leakage-safe training examples.

Implementation todo:

- Build materialized/exportable feature datasets for pregame and live-replay modeling.
- Pregame feature rows should include market odds at fixed pre-start cutoffs and HLTV/team features available before that cutoff.
- Live feature rows should align market timestamps to demo-derived or match timeline timestamps when available, using nearest valid market observation at or before the feature time.
- Prevent leakage:
  - no post-cutoff market prices in pregame examples
  - no post-event game state in live examples
  - no resolved outcome fields in features
- Include liquidity/staleness flags so model training can weight or filter unreliable market data.
- Export to R2 as analysis-friendly files, preferably Parquet once the schema stabilizes; JSONL is acceptable for v0.
- Keep D1 manifests for dataset version, source object keys, row counts, schema version, and generation params.

Acceptance criteria:

- A reproducible command/job generates v0 training exports from stored R2/D1 data without hitting external APIs.
- Each row includes enough lineage to trace back to conditionId, HLTV match id, source price/trade object, and feature cutoff timestamp.
- Pregame rows include at minimum:
  - closing odds at 10m/5m/1m/start when available
  - market volume/liquidity/trade-count features before cutoff
  - linked HLTV teams/event/best-of/scheduled time
  - resolved label
- Live rows include at minimum:
  - nearest historical price observation at or before timestamp
  - trade/volume bars up to timestamp
  - staleness age of last price/trade
  - placeholder/join fields for future demo-derived state
  - resolved label
- Dataset generation emits quality metrics:
  - linked markets count
  - rows generated
  - missing odds counts by cutoff
  - stale-price distribution
  - illiquid/no-trade counts
  - label coverage
- A reviewer can run a small sample and manually verify no future price/outcome leakage in features.

### H5. Historical signal backtest v0

Goal: use historical market data for coarse signal backtests before we have executable orderbook tape.

Implementation todo:

- Implement a backtest harness that consumes H4 exports and evaluates model probability vs historical market probability.
- Start with signal-level backtests, not execution-perfect PnL.
- Support pregame strategies:
  - compare model probability to 10m/5m/1m/start market odds
  - bet only when edge exceeds configurable thresholds
- Support live-replay strategies once demo-derived state is available:
  - use nearest prior market price/trade-derived curve
  - reject decisions when price/trade data is stale beyond threshold
- Use conservative execution assumptions in v0:
  - no historical spread/orderbook available
  - configurable haircut/slippage proxy based on liquidity and trade volume
  - mark results as `signal_backtest`, not `execution_backtest`
- Produce per-market and aggregate reports.

Acceptance criteria:

- Backtest can run over historical linked markets without external API calls.
- Results separate:
  - model edge quality
  - simulated return under crude assumptions
  - coverage skipped due to stale/illiquid market data
- Reports include at minimum:
  - number of candidate markets
  - number of bets selected
  - win/loss rate
  - average implied edge
  - Brier/log-loss vs market baseline when applicable
  - simulated ROI with assumptions printed beside it
  - sensitivity by edge threshold and slippage haircut
- The report clearly states limitations: no historical bid/ask/orderbook, no queue position, no true fill simulation.
- A future `execution_backtest` is explicitly gated on prospective WebSocket tape containing best_bid_ask / price_change / book events.

## 3. Prospective live Polymarket tape

Goal: collect true executable market microstructure from now forward using the Polymarket market WebSocket, separate from historical public API backfill.

Todo:

- Discover active CS2 match-winner markets and subscribe to both outcome token ids.
- Store raw WebSocket events in R2.
- Derive 1s snapshots/bars for best bid/ask, midpoint, spread, last trade, and status.
- Store D1 manifests/latest state only.
- Start collection 10m before CLOB `game_start_time` when known; if discovered earlier, collect earlier and phase-label the data.
- Continue through market close/resolution.

Acceptance criteria:

- Live collector survives reconnects and records gaps explicitly.
- Raw events and normalized 1s bars can be replayed into identical latest-state output.
- Data is sufficient for future execution-aware backtests.

## 4. Next product/data work after acquisition is stable

- Build H1-H5 historical Polymarket baseline before full live execution backtesting.
- Add leakage-safe feature export v0 from D1/R2.
- Start model-training baseline once acquisition volume and historical market linking are reliable.
- Keep raw artifacts in R2 as the source of truth for parser replay.

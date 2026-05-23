# csgogamble

Cloudflare-centric CS2 match ingestion and data platform.

The repo is being rebuilt around a TypeScript Cloudflare Worker that discovers HLTV matches, acquires raw HTML, parses detailed match data, stores normalized operational state in D1, and stores raw artifacts in R2.

What this repo is for:
- reliable match-data ingestion
- historical backfill
- live match tracking
- downstream feature generation for prediction models
- eventual betting automation against Polymarket

What this repo is not doing yet:
- demos at scale
- odds ingestion
- model training
- execution against betting venues

## Current architecture

Target runtime flow:

```text
Cron Trigger
  -> discovery job
  -> Queue messages per match
  -> acquisition
  -> parsing
  -> D1 persistence
  -> R2 raw artifact storage
```

Current state:
- the parser and persistence path are production-usable for match volume ingestion
- scheduled discovery runs through a canary-first `http-stealth` Worker fetch path
- regular cron fan-out is capped at 40 matches per tick with queue `max_concurrency=1`
- Browser Rendering remains wired for debug/spikes, but HLTV currently hard-challenges it

Primary production app:
- `worker/` — Cloudflare Worker, D1 migrations, parsing logic, ingestion scripts, tests

Supporting areas:
- `docs/` — architecture, ingestion flow, plans
- `archive/python-legacy/` — old Python code kept only for reference during the rebuild

## Design principles

- TypeScript-first
- Cloudflare-native control plane
- local-first development with Wrangler
- raw HTML retained for debugging and parser evolution
- acquisition separated from parsing/persistence
- operational ingest system first, ML pipeline second

## Repository layout

```text
csgogamble/
├── worker/
├── docs/
├── archive/python-legacy/
└── README.md
```

## Worker package

Inside `worker/`:
- HTTP endpoints for local verification and manual ingest
- HLTV parsing helpers
- D1 persistence layer
- R2 artifact storage
- Worker-native backfill and health scripts
- legacy local Playwright acquisition guarded behind explicit `--allow-local-hltv`

Useful commands:

```bash
cd worker
npm install
npm run check
npm test
npm run health:ingest -- --strict --samples 10
npm run backfill:daemon -- --list-only --filter partial --max 50
npm run backfill:daemon -- --apply --filter partial --max 50 --batch-size 10 --concurrency 1 --acquisition-mode http-stealth
npm run ops:close-stale-runs -- --threshold-hours 2 --limit 100
npm run health:ingest -- --strict --samples 20
```

## Operator runbook

Production-like acquisition runs through the deployed Worker / Cloudflare-native path. Current HLTV default is Worker `fetch` with browser-shaped headers (`http-stealth`), not Cloudflare Browser Rendering. Do not run local browser scraping against HLTV unless Jakob explicitly approves that run.

Required environment for Worker-native backfill commands:

```bash
export WORKER_URL="https://<deployed-worker-host>"
export ADMIN_TOKEN="<worker-admin-token>"
```

Preflight:

```bash
cd worker
npm run ops:preflight
npm run health:ingest -- --json
```

50-match canary:

```bash
cd worker
npm run ops:canary
```

40-match regular cron posture:

```bash
# configured in worker/src/scheduled.ts
# canary first: maxMatches=1
# follow-up fan-out: maxMatches=40
# queue consumer max_concurrency=1 in wrangler.jsonc
```

Stress-test result: 30, 40, 45, 50, 75, and 100-match scheduled-style runs completed cleanly when the queue consumer was capped at concurrency 1. A 50-match run before that cap produced transient HLTV 429s, then recovered after paced retry. Keep the regular schedule at 40 until we add explicit rate-limited retry/backoff in the queue path.

Resume an interrupted run:

```bash
cd worker
npm run ops:resume -- --run-id <run-id> --batch-size 10 --concurrency 1 --acquisition-mode http-stealth
```

Stale-run cleanup is dry-run by default; only add `--apply` after reviewing rows:

```bash
cd worker
npm run ops:close-stale-runs -- --threshold-hours 2 --limit 100
npm run ops:close-stale-runs -- --threshold-hours 2 --limit 100 --apply
```

Post-run verification:

```bash
cd worker
npm run ops:verify
npm run health:ingest -- --json
```

Canary success means: no Worker crashes, no unclassified errors, no unexplained active stuck runs, parsed + partial >= 85%, challenge <= 8%, and raw artifact/parser/enrichment coverage does not regress.

## Roadmap

Phase 0:
- clean repo structure
- archive old Python system
- rewrite docs to match reality

Phase 1:
- make the Worker the canonical application
- add scheduled and queue-driven orchestration
- improve module boundaries and observability

Phase 2:
- validate Cloudflare-native browser acquisition against HLTV
- fall back to an external acquisition seam if needed

Phase 3:
- historical backfill at scale
- richer match detail extraction
- feature exports for modeling

Phase 4:
- live tracking, prediction infrastructure, and market execution

## Hard truth

The parser is not the scary part anymore.
The real technical risk is reliable acquisition from HLTV under anti-bot protections.
So the rebuild is optimizing around that reality instead of pretending plain fetch will somehow start working out of nowhere.

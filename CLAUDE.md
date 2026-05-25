# csgogamble Agent Guide

## Mission

Build a Cloudflare-native CS2 match ingestion, feature-generation, and betting research platform. The business goal is to ingest rich HLTV match data, combine it with market data, model win probabilities, and eventually identify profitable Polymarket/Kalshi-style opportunities.

## Architecture

```text
HLTV / market sources
  -> Cloudflare Worker scheduled discovery
  -> Cloudflare Queue messages per match / market
  -> Cloudflare Browser Rendering acquisition
  -> parser / normalizer
  -> D1 operational + normalized relational storage
  -> R2 raw artifacts for replay/reparse
  -> downstream feature generation / modeling / betting automation
```

Primary application:

- `worker/` — TypeScript Cloudflare Worker, API handlers, scheduled jobs, queues, D1 persistence, R2 artifact storage, parsers, scripts, tests, and migrations.

Important Worker modules:

- `worker/src/handlers.ts` — HTTP routes, scheduled entrypoints, queue consumers, ingest orchestration.
- `worker/src/hltv.ts` — HLTV HTML parsing and match URL discovery. Parsing must be deterministic and covered by tests.
- `worker/src/db.ts` — D1 persistence. Keep schema writes idempotent and migration-compatible.
- `worker/src/types.ts` — shared parser/persistence types.
- `worker/migrations/` — forward-only D1 migrations. Never edit an applied migration; add a new one.
- `worker/test/` — Vitest coverage for parsing, orchestration, and browser-session behavior.
- `worker/scripts/` — operational scripts. These may inspect local files/D1, but must not scrape protected sources locally unless explicitly allowed by the user.

Data stores:

- D1: normalized state and queryable match data.
- R2: raw HTML and future heavy artifacts. Raw artifacts are sacred because they let us reparse historical data after parser improvements.
- Queues: ingestion work distribution.
- Browser Rendering: acquisition runtime for protected pages.

## Non-negotiable operating rules

1. Never parse/acquire HLTV from local machine by default.
   - Use deployed Workers / Cloudflare-native acquisition.
   - Local execution is fine for tests, parser replay against stored artifacts, D1 analysis, migrations, typechecks, and debugging.
   - Do not run local browser scraping against HLTV or Polymarket unless Jakob explicitly asks for it for that run.

2. Commit liberally once a coherent body of work is done.
   - Act like the repo owner.
   - Keep commits reviewable and conventional.
   - Do not leave finished work uncommitted.

3. Document work thoroughly.
   - Update this file, README, docs, migrations, comments, or operational notes when behavior changes.
   - Mention production commands and verification results in commit messages when useful.

4. Prefer tests first for parser and persistence work.
   - Add or update fixtures/tests before changing parser behavior.
   - Parser regressions are expensive because they corrupt data silently.

5. Protect secrets.
   - Never print or commit `.dev.vars`, API tokens, account IDs where avoidable, cookies, or credentials.
   - `worker/.dev.vars` is intentionally ignored.

6. Separate acquisition from parsing.
   - Acquisition gets raw HTML/artifacts.
   - Parsing turns artifacts into typed normalized records.
   - Persistence writes idempotently to D1.

## Quality gates

Run from `worker/` before committing code changes:

```bash
npm run check
npm test
npm run duplicate-check
npm run reparse:raw-html -- --limit 10
npm run reparse:raw-html -- --apply --resume --limit 25 --batch-size 5
```

`npm run check` includes TypeScript and Biome. Biome is intentionally strict. Fix warnings instead of weakening rules unless there is a strong documented reason.

## Operator acquisition loop

Use deployed Worker / Cloudflare-native acquisition for production-like runs. Local execution is allowed for tests, parser replay against stored artifacts, D1/R2 inspection, migrations, typechecks, health checks, and docs. Do not locally scrape protected sources.

Run from `worker/`.

Required for Worker-native backfill:

```bash
export WORKER_URL="https://<deployed-worker-host>"
export ADMIN_TOKEN="<worker-admin-token>"
```

Preflight:

```bash
npm run ops:preflight
npm run health:ingest -- --json
```

Canary batch:

```bash
npm run ops:canary
```

Resume:

```bash
npm run ops:resume -- --run-id <run-id> --batch-size 10 --concurrency 1 --acquisition-mode http-stealth
```

Close stale bookkeeping rows:

```bash
npm run ops:close-stale-runs -- --threshold-hours 2 --limit 100
npm run ops:close-stale-runs -- --threshold-hours 2 --limit 100 --apply
```

Post-run verification:

```bash
npm run ops:verify
npm run health:ingest -- --json
```

Operator checks:

- preflight must pass hard gates before scaling
- stale `ingest_runs` are closed with `npm run ops:close-stale-runs`, not manual D1 SQL
- canary success means no crashes, no unclassified errors, no unexplained active stuck runs, parsed + partial >= 85%, challenge <= 8%, and raw artifact/enrichment coverage does not regress
- regular scheduled discovery uses `http-stealth`, canary maxMatches=1, follow-up fan-out maxMatches=11 (~1,056 match fetches/day), queue consumer `max_concurrency=1`, and scheduled HTTP ingest pacing/jitter; keep this posture while measuring 429/challenge rates before raising volume
- resume must use the existing run id and must not duplicate candidate processing

## Current production posture

The parser is production-usable and stores richer match metadata, maps, vetoes, lineups, streams, and player stats. Acquisition remains the highest-risk system boundary because protected sources can challenge or rate-limit, but current HLTV production posture is canary-first `http-stealth` through the deployed Worker, not Browser Rendering.

When evaluating ingestion health, check both:

- code health: `npm run check`, `npm test`, `npm run duplicate-check`
- live data health: D1 status counts, latest ingest timestamp, partial/challenge/error ratios, and enriched child-table coverage

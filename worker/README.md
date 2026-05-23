# csgogamble worker

Cloudflare Worker for HLTV match ingestion.

What this package owns:
- HTTP endpoints for local verification and manual ingestion
- Cron-driven discovery entrypoints
- Queue-driven orchestration for discovery and match ingest jobs
- HLTV HTML parsing
- D1 persistence
- R2 raw artifact storage
- local Playwright-based acquisition scripts for development and backfill
- experimental Cloudflare Browser Rendering debug endpoints for HLTV fetch validation

What this package does not own:
- UI
- model training
- betting execution
- long-term large-scale analytics exports

## Runtime flow

```text
scheduled() 
  -> enqueue discovery job
  -> queue consumer discovers match URLs
  -> queue consumer enqueues ingest jobs
  -> queue consumer ingests match HTML into D1 + R2
```

Current state:
- this orchestration path is implemented
- local verification is straightforward
- Cloudflare-native acquisition against HLTV still needs hard validation under anti-bot pressure

## Commands

Development and verification:

- `npm run dev` — start local worker via Wrangler
- `npm run format` — format all files with Biome
- `npm run check` — TypeScript + Biome verification
- `npm test` — run unit tests
- `npm run duplicate-check` — duplicate-code check
- `npm run reparse:raw-html -- --limit 10` — dry-run parser replay against stored raw HTML
- `npm run reparse:raw-html -- --apply --resume --limit 25 --batch-size 5` — apply parser replay in bounded batches

Operator health:

- `npm run health:ingest` — human-readable remote D1 ingestion health report
- `npm run health:ingest -- --strict --samples 10` — preflight gate; exits nonzero on failures or warnings
- `npm run health:ingest -- --json` — structured health output for cron/watchdog consumption
- `npm run ops:preflight` — strict preflight alias
- `npm run ops:verify` — strict post-run verification alias

Worker-native acquisition/backfill:

- `npm run backfill:daemon -- --list-only --filter partial --max 50` — list candidates only; no acquisition
- `npm run backfill:daemon -- --apply --filter partial --max 50 --batch-size 10 --concurrency 1 --acquisition-mode browser-session` — 50-match canary through deployed Worker/admin endpoints
- `npm run backfill:daemon -- --apply --resume --run-id <run-id> --batch-size 10 --concurrency 1 --acquisition-mode browser-session` — resume an interrupted run
- `npm run ops:canary` — canary alias
- `npm run ops:resume -- --run-id <run-id>` — resume alias

Stale-run cleanup:

- `npm run ops:close-stale-runs -- --threshold-hours 2 --limit 100` — dry-run stale `ingest_runs` cleanup
- `npm run ops:close-stale-runs -- --threshold-hours 2 --limit 100 --apply` — close reviewed stale rows

Debug only:

- `npm run backfill -- --allow-local-hltv --max 10` — legacy local Playwright backfill, only for explicitly approved local HLTV runs
- `curl http://127.0.0.1:8787/debug/browser/results` — test Browser Rendering against HLTV results
- `curl -X POST http://127.0.0.1:8787/debug/browser/match -H 'content-type: application/json' -d '{"matchUrl":"https://www.hltv.org/matches/2384585/spirit-vs-natus-vincere"}'` — test Browser Rendering against one match page

Production-like acquisition must go through the deployed Worker / Cloudflare Browser Rendering path. Do not run local browser scraping against HLTV unless explicitly approved for that run.

## Common local workflow

1. `npm install`
2. `npm run dev`
3. in another shell: `npm test && npm run check`
4. inspect local D1 with `npx wrangler d1 execute csgogamble --local --command "select status, count(*) from matches group by status;"`

## Notes

- HLTV blocks plain HTTP fetches often enough that acquisition strategy remains the hard part.
- Browser Rendering is now wired as a small spike only; it returns compact JSON summaries instead of raw HTML.
- The current production shape aims to keep acquisition separate from parsing and persistence.
- Some match pages legitimately do not expose player stats sections. Those remain `partial`.
- Demo artifacts can be very large, so demos are not part of the immediate ingestion focus.
- Cron Triggers and Queues are configured in `wrangler.jsonc`, and the `BROWSER` binding uses `remote: true` so `wrangler dev` can exercise Cloudflare Browser Rendering remotely.

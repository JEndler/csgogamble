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

- `npm run dev` — start local worker via Wrangler
- `npm run format` — format all files with Biome
- `npm run check` — TypeScript + Biome verification
- `npm test` — run unit tests
- `npm run backfill -- --max 100` — local Playwright backfill into the local worker
- `npm run download-demo -- <match-url>` — fetch one HLTV demo and record it
- `curl http://127.0.0.1:8787/debug/browser/results` — test Browser Rendering against HLTV results
- `curl -X POST http://127.0.0.1:8787/debug/browser/match -H 'content-type: application/json' -d '{"matchUrl":"https://www.hltv.org/matches/2384585/spirit-vs-natus-vincere"}'` — test Browser Rendering against one match page

## Common local workflow

1. `npm install`
2. `npx playwright install chromium`
3. `npm run dev`
4. in another shell: `npm run backfill -- --max 10`
5. verify with `npx wrangler d1 execute csgogamble --local --command "select status, count(*) from matches group by status;"`

## Notes

- HLTV blocks plain HTTP fetches often enough that acquisition strategy remains the hard part.
- Browser Rendering is now wired as a small spike only; it returns compact JSON summaries instead of raw HTML.
- The current production shape aims to keep acquisition separate from parsing and persistence.
- Some match pages legitimately do not expose player stats sections. Those remain `partial`.
- Demo artifacts can be very large, so demos are not part of the immediate ingestion focus.
- Cron Triggers and Queues are configured in `wrangler.jsonc`, and the `BROWSER` binding uses `remote: true` so `wrangler dev` can exercise Cloudflare Browser Rendering remotely.

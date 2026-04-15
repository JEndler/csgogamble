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
- the parser and persistence path work locally
- the cron + queue orchestration skeleton exists in `worker/`
- reliable Cloudflare-native acquisition against HLTV is still the main open risk

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
- local Playwright-based acquisition scripts

Useful commands:

```bash
cd worker
npm install
npx playwright install chromium
npm run check
npm test
npm run dev
npm run backfill -- --max 10
```

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

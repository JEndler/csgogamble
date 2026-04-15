# csgogamble - Development Guide

This repo is now Worker-first and TypeScript-first.

## Project direction

`worker/` is the canonical application.

The goal is to build a Cloudflare-centric ingestion platform for HLTV match data:
- scheduled discovery
- queued ingestion
- acquisition of raw HTML
- parsing into normalized match/map/player data
- D1 as the operational store
- R2 as the raw artifact store

Legacy Python code lives under `archive/python-legacy/` for reference only. Do not build new production code there.

## Current priorities

1. Make scheduled ingestion run reliably on Cloudflare.
2. Keep the parsing/persistence layer clean and strongly typed.
3. Preserve raw HTML for debugging and parser iteration.
4. Build a sane foundation for later ML and live prediction work.

## Standards

### TypeScript
- strict typing
- no `any` unless there is a very good reason
- small, boring modules over giant files
- prefer explicit request/response contracts
- document parser assumptions when HTML is brittle

### Formatting and linting
- formatter: Biome
- linting: Biome
- typecheck: `tsc --noEmit`
- tests: Vitest

### Cloudflare
- use Wrangler for local development and deploys
- D1 migrations live in `worker/migrations/`
- R2 is for raw HTML and later large artifacts
- Cron Triggers should drive recurring jobs
- Queues should decouple discovery from ingest work

## Repo structure

```text
csgogamble/
├── worker/                  # production app
├── docs/                    # architecture and plans
├── archive/python-legacy/   # historical Python code only
└── README.md
```

## Worker workflow

```bash
cd worker
npm install
npx playwright install chromium
npm run check
npm test
npm run dev
```

Useful local verification:

```bash
curl http://127.0.0.1:8787/health
npm run backfill -- --max 3
npx wrangler d1 execute csgogamble --local --command "select status, count(*) from matches group by status;"
```

## Architecture rule

Keep acquisition separate from parsing.

If Cloudflare-native browser acquisition works reliably, use it.
If HLTV still blocks it, use an external acquisition seam that returns raw HTML to the Worker.
Do not smear scraping hacks across the whole codebase.

## What not to do

- do not revive the old Python production path
- do not hardcode credentials or secrets anywhere
- do not treat local scripts as the long-term orchestration layer
- do not mix ML/training code into the Worker runtime

## Documentation

Keep these files current when architecture changes:
- `README.md`
- `docs/architecture.md`
- `docs/ingestion.md`
- `worker/README.md`

# csgogamble architecture

## Goal

Build a Cloudflare-centric ingestion system for CS2 match data that supports:
- recurring discovery
- historical backfill
- live match tracking
- later feature generation for prediction models

## Production shape

```text
Cron Trigger
  -> discovery logic
  -> Cloudflare Queue messages
  -> acquisition step
  -> parsing step
  -> D1 persistence
  -> R2 artifact storage
```

## Components

### `worker/`
The canonical application.

Responsibilities:
- scheduled jobs
- queue consumers
- request contracts
- HTML parsing
- D1 writes
- R2 writes
- debug/manual HTTP endpoints

### D1
Operational relational store.

Primary data:
- matches
- teams
- players
- maps
- player_map_stats
- artifacts
- crawl_state
- ingest_runs and future ingest job state

### R2
Raw object storage.

Current use:
- raw HTML snapshots for ingested matches

Future use:
- exported features
- optional large artifacts

### Queues
Used to decouple discovery from match ingestion.

Why:
- controlled fanout
- retries
- dead-letter handling
- clearer operational state

### Cron Triggers
Used for:
- live/recent discovery
- retry sweeps
- historical refill windows

### Acquisition layer
This is the risky part.

Preferred path:
- Cloudflare Browser Rendering with session reuse
- Durable Object if browser session persistence materially helps

Fallback path:
- external acquisition service returns raw HTML only
- Worker remains source of truth for parsing and persistence

## Architecture rules

1. Keep parsing separate from acquisition.
2. Keep operational ingestion separate from ML/training.
3. Preserve raw HTML whenever practical.
4. Prefer explicit status transitions over vague errors.
5. Build for restartability and resumability.

## Repo boundaries

Production code:
- `worker/`

Reference only:
- `archive/python-legacy/`

Docs:
- `docs/`

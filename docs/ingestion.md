# ingestion flow

## Overview

The ingestion pipeline is intentionally split into stages so acquisition problems do not poison parsing and persistence design.

```text
scheduled job
  -> discover result pages / match URLs
  -> enqueue match ingest jobs
  -> acquire match HTML
  -> parse structured data
  -> persist to D1
  -> store raw HTML in R2
```

## Stage 1: discovery

Discovery finds candidate match URLs.

Sources now:
- HLTV results pages
- manual backfill requests

Planned next:
- retry scans for partial/challenge/error rows
- future live/recent match sweeps

Output:
- queue messages containing match id, url, priority, and reason

## Stage 2: queueing

Queue messages provide:
- buffering
- retries
- separation between scheduling and ingestion work

Planned next:
- dead-letter handling
- richer retry policies by job type

Suggested message shape:

```ts
interface MatchIngestMessage {
  matchUrl: string;
  hltvMatchId: number;
  priority: 'live' | 'recent' | 'historical';
  reason: 'cron-results' | 'retry' | 'manual-backfill';
  discoveredAt: string;
}
```

## Stage 3: acquisition

Acquisition gets raw HTML for one match page.

Preferred approach:
- Cloudflare Browser Rendering

Fallback approach:
- external acquisition service

Important rule:
- the acquisition layer returns HTML
- it does not own parsing, schema, or business logic

## Stage 4: parsing

Parsing extracts:
- match metadata
- teams
- maps
- player map stats
- raw demo URL metadata when present

Status outcomes:
- parsed
- partial
- challenge
- error

## Stage 5: persistence

D1 stores normalized records.
R2 stores raw HTML.

Persistence should be:
- idempotent by HLTV ids
- resumable
- explicit about status and last error

## Stage 6: downstream use

Once ingestion is stable, downstream jobs can:
- export curated features
- build training datasets
- support live prediction systems

These concerns should not be mixed into the ingest runtime.

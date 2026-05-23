# csgogamble Progress

## Current strategic sequence

1. Reparse existing R2 raw HTML into the enriched schema. Done.
2. Build one-command ingestion health reporting. Done.
3. Make acquisition reliable under repeated challenge / stale-run conditions.
4. Make backfill daemon-grade for unattended multi-thousand-match runs.
5. Design odds ingestion before writing the first market scraper.
6. Add leakage-safe feature export v0.
7. Burn down strict Biome warnings in focused refactor slices.

## Completed work: R2 artifact reparse

Goal: use stored raw HTML artifacts to populate the enriched parser schema without touching HLTV locally.

Status: implemented and run against all eligible remote raw HTML candidates. One historical challenge artifact remains on parser `0.1.0` by design because the script skips challenge pages unless explicitly forced.

Requirements:

- Do not acquire protected sources locally.
- Read existing raw artifacts from Cloudflare R2 / D1 metadata only.
- Re-run `parseMatchHtml` against stored HTML.
- Persist results through the same D1 persistence path used by live ingestion.
- Support `--dry-run`.
- Support bounded `--limit` / `--batch-size`.
- Support resumable cursor/checkpointing.
- Print before/after coverage metrics.
- Keep raw artifacts intact.
- Verify with tests/checks before committing.

Command:

```bash
cd worker
npm run reparse:raw-html -- --limit 10
npm run reparse:raw-html -- --apply --resume --limit 25 --batch-size 5
```

## Latest reparse result

After replaying stored R2 raw HTML through the enriched parser:

- matches: 842
- parsed: 746
- partial: 71
- challenge: 25
- error: 0
- current parser version: 841 / 842
- aggregate player stats coverage: 747 matches
- veto coverage: 754 matches
- lineup coverage: 819 matches
- stream coverage: 767 matches

## Completed

- One-command ingestion health report: `worker/scripts/ingestion-health.ts` via `npm run health:ingest`.
- R2 raw HTML reparse script: `worker/scripts/reparse-raw-html.ts`.
- D1 migration for enriched match/map/player/veto/lineup/stream data.
- Challenge-page handling so challenge rows do not poison parsed rows.
- Backfill runner timeout/resume and browser-closed recovery improvements.
- `CLAUDE.md` repo operating manual.
- `AGENTS.md -> CLAUDE.md` symlink.
- Strict-practical Biome setup.
- `jscpd` duplicate threshold at 5%.

## Notes

Parser is production-usable. Acquisition is still the highest-risk boundary. Before scraping all old remaining matches, run `npm run health:ingest` and only scale if hard gates pass. Fix hard health failures first, then run a bounded canary batch, inspect health deltas, and only then increase volume.

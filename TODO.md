# TODO: Polymarket -> HLTV Linking Push

Goal: increase high-confidence `match_winner` Polymarket -> HLTV links from the current small seed set to a modeling-usable dataset without poisoning labels.

Current baseline, verified 2026-05-26:

- Polymarket `match_winner` markets: 1,570
- Polymarket outcome tokens: 3,140
- 1-minute price-history coverage: 3,140 / 3,140 tokens, 7,203,251 points
- HLTV matches in D1: 1,516 total, 1,496 usable (`parsed + partial`)
- HLTV date range: 2025-04-09 -> 2026-06-11
- Existing linked `match_winner` markets: 26
- Link candidates stored: 1,721
- Strict dataset export currently produces only 12 rows / 6 linked markets with labels, so modeling is not worth doing yet.

Hard rule: prefer false negatives over false positives. A bad link corrupts labels and destroys backtest credibility.

---

## Acceptance criteria

### Minimum viable linking milestone

We can start first real model/backtest work when all are true:

- At least 300 distinct `match_winner` markets are linked to distinct HLTV matches.
- At least 300 linked markets have:
  - resolved winner label
  - both Polymarket outcome token ids
  - both outcome price-history manifests at `fidelity_minutes=1`
  - HLTV teams, scheduled time, best-of, event name
- Dataset export produces at least 600 labeled outcome rows, two rows per market.
- Manual spot-check sample of 50 auto-links has zero known wrong links.
- Auto-link precision target: >= 98% on reviewed samples.
- Ambiguous matches are stored as candidates, not forced into links.
- No fuzzy-only auto-links are allowed.

### Auto-link gate

A market may be auto-linked only if all are true:

- `market_type = 'match_winner'`
- exactly two outcome labels and two token ids
- both outcome teams resolve to HLTV team ids unambiguously, or via an explicitly safe alias tier
- one candidate HLTV match contains both resolved teams, order-insensitive
- candidate is within strict time window:
  - primary: +/- 6h from CLOB `game_start_time` or Gamma fallback time
  - fallback: +/- 24h only if no competing same-team candidate exists
- top score >= 0.90
- runner-up gap >= 0.10
- best-of agrees when both sides provide it, or mismatch is explicitly explained in signals_json
- risky alias transformations are not used for auto-link unless curated

### Review/candidate criteria

Every non-auto-linked market must land in a reviewable state with a reason:

- `no_team_resolution`
- `ambiguous_team_alias`
- `no_time_candidate`
- `multiple_same_team_candidates`
- `event_mismatch`
- `best_of_mismatch`
- `low_score`
- `risky_alias`

Candidate rows must include enough debugging evidence:

- raw PM question/title
- raw outcome labels
- normalized/canonical team keys
- alias source/tier for each team
- candidate `hltv_match_id`
- candidate HLTV teams/event/best_of/scheduled_at
- time delta hours
- score and score components
- runner-up score/gap when applicable
- final decision reason

### Quality gates before any commit touching linker logic

Run from `worker/`:

```bash
npm test -- --run test/polymarket-linker.test.ts test/polymarket-normalize.test.ts test/prediction-dataset-core.test.ts
npm run check
npm run duplicate-check
```

Before claiming production improvement, also run:

```bash
set -a; . ./.env >/dev/null 2>&1; set +a
npm run polymarket:link-hltv -- --dry-run --limit 10000
npm run dataset:match-winner -- --output artifacts/prediction-datasets/linking-smoke.jsonl --no-price-features --limit 10000
```

Do not keep smoke output unless intentionally publishing an artifact.

---

## Options to try

### Option A: Conservative deterministic team-id + time-window linker

Recommendation: try this first. This should be the production auto-linking path.

Approach:

- Use Polymarket outcome labels as the primary team source, not slug abbreviations.
- Fix/verify parsing cleanup:
  - strip leading `Counter-Strike:` / `CS2:`
  - strip trailing `(BO1)` / `(BO3)` / `(BO5)`
  - avoid retaining event suffixes in team names
- Resolve both PM outcomes to HLTV team ids through canonical keys and safe aliases.
- Query candidate HLTV matches around CLOB `game_start_time`, falling back to Gamma `end_date` only when needed.
- Link only when the same HLTV match contains both resolved team ids.
- Use time delta, event similarity, and best-of agreement only as tie-breakers, not substitutes for team identity.

Why it is strong:

- High precision.
- Explainable.
- Easy to unit test.
- Bad cases naturally become review candidates.

Risks:

- Initial recall may be only 60-80% until aliases are improved.
- Requires careful alias hygiene.

Acceptance for Option A:

- Dry-run shows candidate decisions with reason codes for all 1,570 match_winner markets.
- Auto-linked sample of 50 has zero wrong links.
- At least 150 new auto-links on first pass without using fuzzy-only matching.
- No known academy/fe/young/prodigy/ex-team alias collision auto-links.

Implementation targets:

- `worker/src/polymarket/normalize.ts`
- `worker/src/polymarket/linker.ts`
- `worker/scripts/polymarket-link-hltv.ts`
- `worker/test/polymarket-normalize.test.ts`
- `worker/test/polymarket-linker.test.ts`

---

### Option B: Alias expansion + curated alias table

Recommendation: do this immediately after Option A baseline. This is the safest way to increase recall.

Approach:

Use alias tiers:

- Tier 1: exact canonical name
  - Example: `mouz` -> `MOUZ`
- Tier 2: safe generated org suffix aliases, only if unique
  - `Team Falcons` <-> `Falcons`
  - `Aurora Gaming` <-> `Aurora`
  - `BetBoom Team` <-> `BetBoom`
- Tier 3: curated aliases with explicit collision handling
  - `NAVI` / `NaVi` -> `Natus Vincere`
  - `NIP` -> `Ninjas in Pyjamas`
  - `VP` -> `Virtus.pro`, but never `VP.Prodigy`
  - `Liquid` -> `Team Liquid`
  - `Spirit` -> `Team Spirit`

Never blindly strip roster qualifiers:

- `Academy`
- `fe` / `Female`
- `Young`
- `NXT`
- `Prodigy`
- `ALTERS`
- `Impact`
- `SEA`
- `ex-`

Why it is strong:

- Most missing links are likely naming issues, not algorithm issues.
- Curated aliases are auditable.
- It improves recall without lowering score thresholds.

Risks:

- Alias collisions can silently poison labels if rules are too aggressive.
- Short aliases like `AM`, `XI`, `R2` are dangerous.

Acceptance for Option B:

- Alias resolution report lists every generated and curated alias, with collision count.
- Any alias key mapping to multiple HLTV teams is review-only, never auto-link.
- Reviewed sample of 50 alias-assisted auto-links has zero wrong links.
- New linked markets increase by at least 75 beyond Option A, or the alias report explains why not.

Implementation targets:

- Add/extend `team_aliases` usage or equivalent resolver source.
- Add fixture tests for dangerous near-misses:
  - `Eternal Fire Academy` != `Eternal Fire`
  - `FURIA fe` != `FURIA`
  - `VP.Prodigy` != `Virtus.pro`
  - `Sangal ALTERS` != `Sangal`
  - `ex-Imperial Valkyries` != `Imperial`

---

### Option C: Candidate review queue + manual promotion workflow

Recommendation: build after A/B if auto-links are still below 300.

Approach:

- Treat the linker as a candidate generator.
- Persist all plausible candidates with complete signals_json.
- Add an operator command to export ambiguous candidates for review.
- Add an apply command to promote reviewed links to `manual` link_method.

Why it is strong:

- Lets us safely recover recall where deterministic rules are uncertain.
- Creates a feedback loop for adding aliases.
- Keeps manual decisions explicit and auditable.

Risks:

- Slower than pure automation.
- Needs discipline: no bulk approving weak candidates.

Acceptance for Option C:

- Export command produces a compact review file ordered by highest expected value:
  - high score but gap too small
  - both teams resolved but time/event ambiguous
  - one alias collision blocking auto-link
- Manual promotion writes `link_method='manual'`, link score, reviewer note/reason, and timestamp if schema supports it.
- 50 reviewed/promoted links pass manual spot-check with zero known wrong links.
- Manual workflow adds at least 100 links or generates a clear alias backlog.

Implementation targets:

- `worker/scripts/polymarket-link-hltv.ts`
- optional: `worker/scripts/export-polymarket-link-review.ts`
- optional: `worker/scripts/apply-polymarket-link-review.ts`

---

### Option D: Fuzzy matching as review assist only

Recommendation: use only as a candidate-ranking assist, not auto-linking.

Approach:

- Compute string similarity between PM outcomes and HLTV team names/canonical aliases.
- Use fuzzy score to prioritize review candidates or suggest aliases.
- Never auto-link based only on fuzzy similarity.
- Require time window and no collision before a fuzzy-assisted candidate can be considered for manual review.

Why it is useful:

- Finds alias gaps quickly.
- Helps prioritize manual review.

Why it is dangerous:

- CS team names have many traps: short names, academy teams, female rosters, ex-org names, temporary stacks.
- Fuzzy matching will confidently suggest wrong org-level collapses.

Acceptance for Option D:

- Fuzzy-only candidates are labeled `review_only`.
- No `link_method='auto'` rows are created from fuzzy-only evidence.
- Fuzzy suggestions produce at least 25 actionable alias candidates with a reviewed false-positive rate below 10%.

Implementation targets:

- Resolver diagnostics in `worker/src/polymarket/linker.ts`
- Candidate review export script

---

### Option E: LLM-assisted review

Recommendation: defer. Use only if deterministic + alias + review queue still underperform.

Approach:

- Feed an LLM compact candidate bundles:
  - PM title/outcomes/event/time
  - top HLTV candidates with teams/event/time/best_of
  - known aliases
- Ask for recommendation plus explanation.
- Treat output as review guidance only, not direct DB writes.

Why it could help:

- Good for weird event/title naming and human-readable ambiguity.

Why it is not production-grade:

- Non-deterministic.
- Harder to regression test.
- Can hallucinate equivalences.

Acceptance for Option E:

- LLM output never directly writes links.
- Every accepted LLM-assisted link is promoted through the same manual workflow as Option C.
- LLM-assisted review must beat simple fuzzy review on throughput or precision, otherwise delete it.

---

## Execution order

1. Run current linker dry-run and candidate inventory.
2. Implement/verify Option A strict deterministic team-id + time-window auto-linking.
3. Add Option B alias expansion and collision reporting.
4. Run dry-run, inspect distribution, then apply strict auto-links.
5. Export strict dataset and verify row counts.
6. If linked markets < 300, build Option C review queue.
7. Use Option D fuzzy only to generate review/alias suggestions.
8. Defer Option E unless manual review becomes the bottleneck.

---

## Done for this linking push

- `match_winner` linked markets >= 300.
- Strict dataset export produces >= 600 labeled rows.
- All linked rows have 1-minute price-history coverage for both tokens.
- Manual QA sample of 50 auto-links has zero wrong links.
- Linker tests cover normalization, dangerous aliases, scoring gates, ambiguity handling, and dataset-export compatibility.
- `npm test`, `npm run check`, and `npm run duplicate-check` pass.
- A short note is added to `CLAUDE.md` if linker operation or acceptance criteria changes materially.

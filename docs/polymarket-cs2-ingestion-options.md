# Polymarket CS2 ingestion + HLTV mapping options

Date: 2026-05-23

## Executive summary

Polymarket has substantial CS2 coverage and the public APIs are enough for read-only ingestion.

Best discovery route:

- Gamma API events filtered by Counter-Strike 2 tag: `tag_id=100780`
- Match markets have titles like `Counter-Strike: Team Falcons vs MOUZ (BO3) - CS Asia Championships Playoffs`
- Main match market is usually the event slug itself; map/total/handicap child markets share the slug with suffixes
- CLOB `conditionId` + `clobTokenIds` give price/orderbook/history keys
- Data API trades by `conditionId` gives public executed trades

Best mapping route:

- Parse Polymarket event/market title + outcomes into `(team_a, team_b, best_of, event_text, start_time)`
- Candidate HLTV rows by team aliases and `scheduled_at` window
- Score both team orientations and time/event/BO similarity
- Store explicit link rows with confidence and method; do not silently assume one-to-one

Recommended first implementation: Option B below — build canonical Polymarket metadata + snapshots + link tables, then add matching as a deterministic pipeline with human-review states.

## Verified live examples

Gamma CS2 event query:

```text
GET https://gamma-api.polymarket.com/events?tag_id=100780&closed=false&limit=5&order=volume&ascending=false
```

Example current/recent high-volume event:

```json
{
  "id": "513258",
  "slug": "cs2-fal2-mouz-2026-05-23",
  "title": "Counter-Strike: Team Falcons vs MOUZ (BO3) - CS Asia Championships Playoffs",
  "endDate": "2026-05-23T11:00:00Z",
  "volume": 2346147.820857995,
  "markets": 12
}
```

Main match market:

```json
{
  "id": "2331373",
  "question": "Counter-Strike: Team Falcons vs MOUZ (BO3) - CS Asia Championships Playoffs",
  "conditionId": "0x895fc8443246da7a73306246887c73479997b535580006017235f26a10b7c527",
  "outcomes": "[\"Team Falcons\", \"MOUZ\"]",
  "clobTokenIds": "[\"66126499509109503882527587397580847380552807783469118232692069046963725214920\", \"115374538162714194443439522409685192483459174597066538188991073244415139493179\"]"
}
```

Matching HLTV row currently in our D1:

```text
hltv_match_id=2394225
team1_name=Falcons
team2_name=MOUZ
event_name=CS Asia Championships 2026
scheduled_at=2026-05-23T05:00:00.000Z
best_of=3
source_url=https://www.hltv.org/matches/2394225/falcons-vs-mouz-cs-asia-championships-2026
status=parsed
```

CLOB market detail shows a stronger match time than Gamma `endDate`:

```text
GET https://clob.polymarket.com/markets/0x895fc8443246da7a73306246887c73479997b535580006017235f26a10b7c527
```

Observed fields:

```json
{
  "condition_id": "0x895fc8443246da7a73306246887c73479997b535580006017235f26a10b7c527",
  "market_slug": "cs2-fal2-mouz-2026-05-23",
  "end_date_iso": "2026-05-23T00:00:00Z",
  "game_start_time": "2026-05-23T05:00:00Z",
  "active": true,
  "closed": true,
  "accepting_orders": false,
  "tokens": [
    { "outcome": "Team Falcons", "price": 1, "winner": true },
    { "outcome": "MOUZ", "price": 0, "winner": false }
  ]
}
```

For this example, `game_start_time` exactly matches HLTV `scheduled_at`; Gamma `endDate` does not. Use CLOB `game_start_time` when available.

## API surfaces

### Gamma API: discovery and metadata

Base: `https://gamma-api.polymarket.com`

Useful endpoints:

```text
GET /events/keyset?tag_id=100780&closed=false&limit=500
GET /events?tag_id=100780&closed=false&limit=100&order=volume&ascending=false
GET /events/slug/{event_slug}
GET /markets/keyset?tag_id=100780&closed=false&limit=100
GET /public-search?q=cs2&limit_per_type=10&search_tags=true
GET /tags/100780
GET /sports
```

CS2 tag reality:

- `100780` = `counter-strike-2`; best for generated CS2 match markets
- `100677` = `CS2`; exists but is less clean for match discovery
- common related tags: `64` esports, `100639` games, `1` sports

Gamma caveats:

- `outcomes`, `outcomePrices`, and `clobTokenIds` are JSON strings. Parse them.
- Search parameters on list endpoints are weak/ignored in some probes. Use `tag_id` + keyset pagination.
- `closed=false` can include active broad markets and stale/near-settled markets. Filter titles and `groupItemTitle`.
- Gamma `endDate` is not always exact match start; prefer CLOB `game_start_time`.

### CLOB API: price/orderbook/history

Base: `https://clob.polymarket.com`

Useful endpoints:

```text
GET /markets/{condition_id}
GET /book?token_id={token_id}
GET /price?token_id={token_id}&side=buy
GET /midpoint?token_id={token_id}
GET /spread?token_id={token_id}
GET /prices-history?market={token_id}&interval=1d&fidelity=60
POST /batch-prices-history
```

Important key distinction:

- Gamma/CLOB/Data market identity: `conditionId` / `condition_id`
- Outcome identity: `clobTokenIds[]` / `tokens[].token_id`
- Price history uses token/asset id, not condition id
- Data API trades filter by condition id

### Data API: public trades

Base: `https://data-api.polymarket.com`

```text
GET /trades?market={conditionId}&limit=100&offset=0&takerOnly=false
```

Trade rows include:

- `conditionId`
- `asset` token id
- `side`
- `size`
- `price`
- `timestamp`
- `title`
- `slug`
- `eventSlug`
- `outcome`
- `outcomeIndex`
- `transactionHash`

Caveat: no single row id. Store a deterministic composite hash over transactionHash + conditionId + asset + side + proxyWallet + timestamp + size + price.

## Options

### Option A — Minimal match-winner odds snapshots

Ingest only main match-winner markets and latest prices.

Tables:

- `polymarket_markets`
- `polymarket_outcomes`
- `polymarket_market_snapshots`
- `polymarket_hltv_match_links`
- `team_aliases`

Flow:

1. Discover events via `events/keyset?tag_id=100780&closed=false`.
2. Keep events with title pattern `Counter-Strike: A vs B (BOx)`.
3. Select market where `market.slug == event.slug` or question exactly equals event title.
4. Parse two outcomes as team names.
5. Fetch CLOB market detail for `game_start_time`.
6. Candidate match query by team aliases + time window.
7. Store market, outcome tokens, current CLOB midpoint/book snapshot.
8. Link to HLTV if score >= threshold.

Pros:

- Fastest to implement.
- Directly useful for model-vs-market edge.
- Avoids messy map/prop/outright markets.

Cons:

- No historical price curve unless added separately.
- Misses map winner and derivative markets.
- Needs later migration if we want trades/orderbook depth.

Use if: we want a quick signal pipeline and paper-trading edge calculation.

### Option B — Canonical market metadata + prices + links

Ingest event/market/outcome metadata, snapshots, price history, and links. Defer trades.

Tables:

- `polymarket_events`
- `polymarket_markets`
- `polymarket_outcomes`
- `polymarket_market_snapshots`
- `polymarket_price_history`
- `polymarket_hltv_match_links`
- `team_aliases`
- optional `polymarket_raw_artifacts`

Flow:

1. Keyset page CS2 events by tag.
2. Persist raw Gamma JSON to R2 and normalized metadata to D1.
3. Classify market type:
   - `match_winner`
   - `map_winner`
   - `total_maps`
   - `map_handicap`
   - `outright`
   - `player_prop`
   - `other`
4. For `match_winner`, fetch CLOB detail, orderbook, midpoint, and bounded price history.
5. Run HLTV linker.
6. Store link confidence and all candidates, not just winners.

Pros:

- Good foundation.
- Reparseable and auditable.
- Supports backtesting with price history.
- Easy to extend to trades later.

Cons:

- More schema upfront.
- Need careful pagination/checkpointing.

Use if: we are serious about Polymarket as a durable data source. This is the recommended route.

### Option C — Full market microstructure ingestion

Add executed trades and orderbook snapshots at higher cadence.

Additional tables:

- `polymarket_trades`
- `polymarket_orderbook_snapshots`
- `polymarket_orderbook_levels`
- later `paper_bets` / `signals`

Flow:

1. Option B metadata pipeline.
2. For linked active match-winner markets, poll CLOB books every N minutes until match start.
3. Pull Data API trades by condition id.
4. Build VWAP/liquidity/slippage features.

Pros:

- Best for execution and strategy research.
- Lets us model not just implied probability, but fill feasibility.

Cons:

- More storage and scheduling complexity.
- Premature if no model baseline exists.

Use if: we are close to actual betting or want liquidity-aware backtests.

### Option D — Event-level broad market ingestion

Also ingest outrights like tournament winner, qualify to playoffs, roster changes, rankings.

Pros:

- More market coverage.
- Some markets have huge volume.

Cons:

- Does not map cleanly to a single HLTV match.
- Needs event/team/time-series model, not match model.

Use later. Not the next move.

## Recommended schema v0

```sql
CREATE TABLE polymarket_events (
  polymarket_event_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  game_id TEXT,
  category TEXT,
  tags_json TEXT,
  start_time TEXT,
  end_time TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  volume REAL,
  liquidity REAL,
  raw_json_r2_key TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE polymarket_markets (
  condition_id TEXT PRIMARY KEY,
  polymarket_market_id TEXT UNIQUE,
  polymarket_event_id TEXT,
  slug TEXT NOT NULL,
  question TEXT NOT NULL,
  market_type TEXT NOT NULL DEFAULT 'unknown',
  group_item_title TEXT,
  question_id TEXT,
  description TEXT,
  resolution_source TEXT,
  start_time TEXT,
  end_time TEXT,
  game_start_time TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0,
  accepting_orders INTEGER NOT NULL DEFAULT 0,
  min_order_size REAL,
  min_tick_size REAL,
  volume REAL,
  liquidity REAL,
  raw_json_r2_key TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (polymarket_event_id) REFERENCES polymarket_events(polymarket_event_id)
);

CREATE TABLE polymarket_outcomes (
  token_id TEXT PRIMARY KEY,
  condition_id TEXT NOT NULL,
  outcome_index INTEGER NOT NULL,
  outcome_name TEXT NOT NULL,
  latest_price REAL,
  winner INTEGER,
  FOREIGN KEY (condition_id) REFERENCES polymarket_markets(condition_id)
);

CREATE TABLE polymarket_market_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  condition_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  outcome_prices_json TEXT,
  midpoint_json TEXT,
  spread_json TEXT,
  best_bid_json TEXT,
  best_ask_json TEXT,
  volume REAL,
  liquidity REAL,
  raw_json_r2_key TEXT,
  UNIQUE(condition_id, observed_at)
);

CREATE TABLE polymarket_price_history (
  token_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  price REAL NOT NULL,
  source_interval TEXT,
  fidelity_minutes INTEGER,
  ingested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(token_id, ts)
);

CREATE TABLE team_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hltv_team_id INTEGER,
  canonical_name TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'observed',
  confidence REAL NOT NULL DEFAULT 1.0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(normalized_alias, hltv_team_id)
);

CREATE TABLE polymarket_hltv_match_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  condition_id TEXT NOT NULL,
  hltv_match_id INTEGER NOT NULL,
  link_status TEXT NOT NULL DEFAULT 'candidate',
  confidence REAL NOT NULL,
  match_method TEXT NOT NULL,
  team_order_status TEXT NOT NULL DEFAULT 'unknown',
  market_type TEXT NOT NULL,
  polymarket_team1_text TEXT,
  polymarket_team2_text TEXT,
  hltv_team1_id INTEGER,
  hltv_team2_id INTEGER,
  hltv_team1_name TEXT,
  hltv_team2_name TEXT,
  time_delta_minutes INTEGER,
  event_similarity REAL,
  team_similarity REAL,
  extracted_json TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(condition_id, hltv_match_id),
  FOREIGN KEY (condition_id) REFERENCES polymarket_markets(condition_id),
  FOREIGN KEY (hltv_match_id) REFERENCES matches(hltv_match_id)
);
```

## Matching algorithm

### 1. Classify market type

Main match winner:

- `market.slug == event.slug`, or
- question equals event title, or
- title matches `Counter-Strike: A vs B (BOx) - Event`, and
- outcomes are two team names, not `Yes/No`, `Over/Under`, map handicap, odd/even.

Map winner:

- question contains `Map 1 Winner`, `Map 2 Winner`, etc.

Derivative:

- `Games Total`, `Map Handicap`, `Odd/Even`, `O/U`.

Outright:

- question starts `Will X win EVENT?`, event is tournament winner, qualify, roster, ranking.

Only `match_winner` links directly to `matches` v0.

### 2. Normalize names

Normalize all market and HLTV text:

- lowercase
- Unicode NFKD
- remove punctuation and apostrophes
- normalize whitespace
- strip words: `team`, `esports`, `gaming`, `counter strike`, `cs2`
- map aliases via `team_aliases`

Seed aliases from observed examples:

- `Team Falcons` -> `Falcons`
- `TheMongolz` -> `The MongolZ`
- `NAVI` -> `Natus Vincere`
- `G2` -> `G2 Esports`
- `MOUZ` -> `MOUZ`

### 3. Candidate query

Use CLOB `game_start_time` if present; else Gamma `endDate`; else slug date.

Candidate SQL shape:

```sql
SELECT * FROM matches
WHERE scheduled_at BETWEEN ?start AND ?end
  AND (
    normalized(team1_name) IN (?, ?) OR
    normalized(team2_name) IN (?, ?) OR
    team1_hltv_id IN (?, ?) OR
    team2_hltv_id IN (?, ?)
  )
ORDER BY scheduled_at;
```

Initial window:

- high confidence: ±6h around `game_start_time`
- fallback: ±24h
- if no exact team alias: same calendar day ±12h

### 4. Score both orientations

Suggested score:

- team match: 0.55 max
- time: 0.25 max
- event similarity: 0.15 max
- best-of agreement: 0.05 max

Auto-link if:

- top score >= 0.90
- runner-up gap >= 0.10
- market_type is `match_winner`
- both teams matched

Candidate/manual review if:

- 0.75 <= score < 0.90, or
- top score high but runner-up gap < 0.10

Reject/ignore if:

- score < 0.75
- derivative/outright market in v0

### 5. Validate after resolution

When both Polymarket and HLTV are resolved:

- Compare CLOB `tokens[].winner` or resolved market outcome to `matches.winner_team_id`
- If mismatch, flag link as `ambiguous`/`mismatch`, do not delete
- This catches bad mapping, voids, market wording mismatch, and team renames

## Operational architecture

Cloudflare-native flow:

```text
Cron: polymarket discovery
  -> Gamma events keyset by tag_id=100780
  -> persist raw Gamma event JSON to R2
  -> normalize events/markets/outcomes to D1
  -> enqueue market detail jobs

Queue: market detail
  -> CLOB /markets/{condition_id}
  -> CLOB book/midpoint/spread for active match_winner markets
  -> CLOB prices-history backfill by token id
  -> Data API trades by condition id later
  -> run HLTV linker
  -> persist link candidates
```

Suggested schedules:

- Discovery of active CS2 events: every 15 minutes
- CLOB snapshots for linked active match-winner markets: every 5-15 minutes until game_start_time
- Price history backfill: once per market after discovery, then once after close
- Trades: defer until model/paper-trading phase

Rate limits are generous, but still implement exponential backoff:

- Gamma `/events`: 500 req / 10s
- Gamma `/markets`: 300 req / 10s
- Data `/trades`: 200 req / 10s
- CLOB `/prices-history`: 1000 req / 10s
- CLOB `/book`/`price`/`midpoint`: 1500 req / 10s

## Risks

- `tag_id=100780` captures non-match CS2 markets too. Need type classifier.
- Gamma `endDate` can be market/event close, not exact match start. Prefer CLOB `game_start_time`.
- Some titles use abbreviations (`fal2`, `mglz`, etc.) in slugs. Do not rely on slug for team names.
- Same teams can play more than once in same event/day. Time and stage matter.
- Map markets share teams with match markets; do not accidentally link map prices as match winner prices.
- Trades have no single explicit row id.
- Existing HLTV DB may not contain all future Polymarket match rows yet; linker must support pending/unmatched markets and re-run later.

## Recommendation

Build Option B.

Phase 1 implementation slice:

1. Migration for events/markets/outcomes/snapshots/price_history/team_aliases/links.
2. `src/polymarket.ts` parser/client:
   - fetch CS2 events by tag
   - parse encoded fields
   - classify market type
   - normalize team/event/BO/time fields
3. D1 persistence helpers with idempotent upserts.
4. Linker with deterministic confidence scoring and tests using Falcons vs MOUZ fixture.
5. Admin/debug endpoint and script:
   - discover 10 events
   - dry-run link candidates
   - apply metadata only
6. Then schedule it.

Do not start with trades. They are useful, but metadata + snapshots + reliable mapping come first.

# Cloudflare MVP Historical Ingest Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a local-first Cloudflare Worker MVP that can discover historical HLTV matches, ingest a single match, store structured metadata in D1, and archive raw HTML in R2 when enabled.

**Architecture:** A TypeScript Worker acts as the control plane. It exposes simple HTTP endpoints for local testing, persists normalized metadata to D1, and writes raw artifacts to R2 when available. HLTV fetching is abstracted behind fetch + parse helpers so we can later swap in Browser Rendering or Containers if challenge pages block normal requests.

**Tech Stack:** Cloudflare Workers, Wrangler, D1, R2, TypeScript, Vitest.

---

### Task 1: Scaffold the Worker package

**Objective:** Create a dedicated TypeScript Cloudflare Worker workspace inside the repo.

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.jsonc`
- Create: `worker/worker-configuration.d.ts`

**Verification:**
- Run: `cd worker && npm install`
- Run: `cd worker && npm run check`
- Expected: TypeScript config loads with no missing package errors.

### Task 2: Add the initial D1 schema

**Objective:** Define the MVP relational schema for matches, teams, maps, players, player stats, artifacts, and crawl state.

**Files:**
- Create: `worker/migrations/0001_initial.sql`

**Verification:**
- Run: `cd worker && npx wrangler d1 migrations apply csgogamble --local`
- Expected: Migration applies against local D1 without SQL errors.

### Task 3: Implement HLTV fetch + parse primitives

**Objective:** Add helper modules for URL construction, challenge detection, results discovery, and match parsing.

**Files:**
- Create: `worker/src/constants.ts`
- Create: `worker/src/types.ts`
- Create: `worker/src/http.ts`
- Create: `worker/src/hltv.ts`

**Verification:**
- Run: `cd worker && npm test`
- Expected: parser/discovery unit tests pass.

### Task 4: Implement persistence + request handlers

**Objective:** Persist parsed payloads into D1 and expose local-first HTTP endpoints for `/health`, `/discover/results`, and `/ingest/match`.

**Files:**
- Create: `worker/src/utils.ts`
- Create: `worker/src/db.ts`
- Create: `worker/src/handlers.ts`
- Create: `worker/src/index.ts`

**Verification:**
- Run: `cd worker && npm run check`
- Run: `cd worker && npm test`
- Expected: typecheck and tests pass.

### Task 5: Enable local verification workflow

**Objective:** Add test config and prove the worker can run locally against local D1 state.

**Files:**
- Create: `worker/vitest.config.ts`
- Create: `worker/test/hltv.test.ts`

**Verification:**
- Run: `cd worker && npm run dev`
- Run: `curl http://127.0.0.1:8787/health`
- Expected: JSON health response.

### Task 6: Close the R2 gap and harden live fetch strategy

**Objective:** Enable R2 in Cloudflare dashboard, provision buckets, and decide whether plain fetch is sufficient or Browser Rendering is required.

**Files:**
- Modify later: `worker/wrangler.jsonc`
- Add later: optional Browser Rendering or Queue config

**Verification:**
- Enable R2 in dashboard and create buckets remotely.
- Run a single real match ingest.
- Expected: raw HTML stored in R2 or challenge page explicitly recorded.

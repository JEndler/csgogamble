# Worker Foundation Hardening Plan

> For Hermes: Use subagent-driven-development principles. Keep the worker local-first and Cloudflare-native, but raise implementation quality to review-ready standards.

Goal: Turn the `worker/` package into a clean, typed, reviewable foundation with stronger contracts, better module boundaries, safer request handling, improved DB persistence ergonomics, documented parsing helpers, and reusable script infrastructure.

Architecture: The Worker remains the control plane for parsing and persistence. Browser automation stays in local scripts. The hardening pass should reduce ad-hoc shapes, centralize types and validation, split unrelated utilities into clearer modules, batch D1 writes where practical, and document the parser enough that future HTML changes are maintainable.

Tech stack: TypeScript, Cloudflare Workers, D1, R2, Wrangler, Biome, Vitest, Playwright.

---

Task 1: Contracts and runtime validation
- Create a single source of truth for environment types, request payloads, response payloads, and status enums.
- Add small runtime validators / parsers for each HTTP endpoint body.
- Replace unsafe `as` casts in `src/index.ts`.
- Return 400 responses for invalid bodies.

Files:
- Modify: `worker/src/types.ts`
- Create/modify: `worker/src/contracts.ts` or equivalent
- Modify: `worker/src/index.ts`
- Modify: `worker/src/handlers.ts`

Verification:
- `cd worker && npm run check`
- `cd worker && npm test`

Task 2: Module boundaries and utilities cleanup
- Split unrelated helpers out of `utils.ts`.
- Centralize path/key generation and artifact helpers.
- Remove duplicated match-id parsing and hardcoded parser version strings.
- Remove unused production dependencies.

Files:
- Modify: `worker/src/utils.ts`
- Create/modify: `worker/src/storage.ts`, `worker/src/http-response.ts`, `worker/src/constants.ts`, or equivalent
- Modify: `worker/src/db.ts`
- Modify: `worker/package.json`

Verification:
- `cd worker && npm run check`
- `cd worker && npm test`

Task 3: DB persistence hardening
- Reduce N+1-style persistence where sensible.
- Use a clearer persistence API and stronger typing.
- Ensure parsed match persistence is internally consistent.
- Keep behavior stable with local D1.

Files:
- Modify: `worker/src/db.ts`
- Add tests if practical

Verification:
- `cd worker && npm run check`
- `cd worker && npm test`

Task 4: Parser maintainability pass
- Add named parser helpers and comments/docstrings for important HTML assumptions.
- Replace brittle positional extraction where practical.
- Improve status classification (`parsed`, `partial`, `challenge`, etc.) based on actual data completeness.
- Keep the current player stats and demo extraction working.

Files:
- Modify: `worker/src/hltv.ts`
- Modify: `worker/test/hltv.test.ts`

Verification:
- `cd worker && npm run check`
- `cd worker && npm test`
- `cd worker && npx tsx scripts/debug-player-stats.ts <known-match-url>`

Task 5: Script ergonomics and docs
- Extract shared Playwright browser bootstrap for scripts.
- Reduce repeated boilerplate across scripts.
- Add clear top-of-file comments/docstrings and usage notes.
- Keep scripts operational:
  - `backfill`
  - `download-demo`
  - debug/inspection scripts

Files:
- Modify: `worker/scripts/*.ts`
- Create: `worker/scripts/lib/browser.ts` or equivalent
- Optionally add: `worker/README.md`

Verification:
- `cd worker && npm run check`
- `cd worker && npm test`
- `cd worker && npm run backfill -- --max 3`

Task 6: Review-grade verification
- Run Biome format/check, TypeScript, tests.
- Re-run a small ingest verification.
- Perform an independent code review pass and fix findings.

Verification:
- `cd worker && npm run format`
- `cd worker && npm run check`
- `cd worker && npm test`
- `cd worker && npm run backfill -- --max 3`

Success criteria
- Stronger typing across request/response boundaries
- Clearer internal module structure
- No unsafe body casts
- No dead dependencies
- Parser code better documented and easier to change
- Scripts share browser bootstrap and are easier to maintain
- Project passes local quality gates cleanly

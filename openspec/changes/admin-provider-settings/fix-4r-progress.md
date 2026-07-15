# Fix Log — admin-provider-settings 4R review findings

> Change: `admin-provider-settings` · Phase: fix-4r · Strict TDD ACTIVE (`cd apps/backend && pnpm test:unit`)
> Branch: `feat/provider-settings-01-persistence` (working tree only — no commits/pushes/PRs)
> Scope: 4 confirmed 4R findings (FIX 1 SSRF/secret-exfil GATING, FIX 2 CI GATING, FIX 3 credential-read timeout, FIX 4 storefront/route timeout+never-5xx). Out of scope: readability HIGH, module-key contract test, secret/public split dedup.

## Status: COMPLETE (FIX 1–4 done) — pending maintainer CI green-run acceptance for FIX 2

---

## FIX 1 (GATING, security) — Skydropx test-connection baseUrl SSRF + stored-secret exfiltration

Status: DONE (GREEN, 270/270 unit tests)

### Defect recap
Admin could POST `/admin/provider-settings/skydropx/test-connection` with `{"baseUrl":"http://attacker"}` and no apiKey; `mergeProbeCredentials` overlaid the candidate `baseUrl` onto STORED creds and `probeSkydropx` then sent `Authorization: Token token=${stored.apiKey}` to the attacker host → SSRF + exfiltration of a secret the admin can never read.

### RED evidence
Added SSRF cases to two existing specs, ran `pnpm test:unit` → **8 failed / 262 passed**:
- `resolve-probe-credentials.unit.spec.ts`: non-https candidate baseUrl must fail without exposing stored apiKey; cloud-metadata (`169.254.169.254`), `localhost`, `127.0.0.1`, non-skydropx https all fail; re-entered https skydropx baseUrl+apiKey passes; stored-only (no candidate baseUrl) uses safe stored base.
- `probes.unit.spec.ts`: probe refuses to call fetch at all for a non-skydropx base (apiKey never sent); the pre-existing "stored baseUrl override" test was retargeted from the arbitrary `api.skydropx.test` host to the allowlisted `api-sandbox.skydropx.com` (behavior intentionally tightened).

### GREEN fix (chosen design = allowlist, option (a), which still permits re-entered https skydropx baseUrl+apiKey together)
- `probes/skydropx.ts`: new exported `isAllowedSkydropxBaseUrl(value)` — requires `https:` + host `skydropx.com` or `*.skydropx.com`. `probeSkydropx` refuses (returns `{ok:false}`) BEFORE issuing the request when a baseUrl fails the allowlist, so the apiKey is never transmitted. Undefined baseUrl → safe default `https://api.skydropx.com/v1`.
- `resolve-probe-credentials.ts`: after building `creds`, skydropx creds whose `baseUrl` fails the allowlist fail the merge BEFORE returning creds (secret never handed to the probe). Covers both candidate- and stored-origin baseUrl.
- `api/middlewares.ts`: `TestProviderConnectionBody` changed from `z.object({}).passthrough()` to a strict per-field allowlist with `.strip()` (unknown/hostile keys dropped; `baseUrl` must be a valid URL). No blanket passthrough of a baseUrl reaching an outbound request.
- `probes/types.ts` (LOW info-leak): `probeFailure` no longer echoes raw `error.message` into the admin-facing `detail`; it logs specifics server-side via `console.error` and returns a generic reason. Timeout detail simplified to `"… probe timed out."`.

### Triangulate
SSRF targets (`http://169.254.169.254/…`, `http://localhost`, `http://127.0.0.1`, `https://evil.example.com`) all fail safe; legit re-entered `{apiKey, baseUrl: https://api-sandbox.skydropx.com}` passes; stored-cred probe with no candidate baseUrl uses the safe stored/default base. Verified apiKey absent from the failed-merge result via `JSON.stringify(result)` scan.

### Files
`apps/backend/src/workflows/steps/probes/skydropx.ts`, `apps/backend/src/workflows/steps/resolve-probe-credentials.ts`, `apps/backend/src/api/middlewares.ts`, `apps/backend/src/workflows/steps/probes/types.ts`, `+tests` in `resolve-probe-credentials.unit.spec.ts` & `probes/__tests__/probes.unit.spec.ts`.

## FIX 2 (GATING, reliability/CI) — CI can't run the integration suites

Status: DONE (YAML valid; **CI green run is the maintainer's acceptance step** — no Postgres in this sandbox to run the suites locally)

### Defect recap
Backend CI job ran `pnpm test:integration:modules` with NO Postgres service and NO `DATABASE_URL`; `test:integration:http` never ran; the focused-test guard only scanned `apps/backend/src` (missing `apps/backend/integration-tests/`).

### Fix (`.github/workflows/ci.yml`, backend job)
- Added a health-checked `postgres:16` service (`pg_isready` health cmd, 10 retries) on `localhost:5432` with db `medusa_test`.
- Added job-level env: `DATABASE_URL` (superuser — the integration runners CREATE/DROP throwaway DBs), `NODE_ENV=test`, deterministic `PROVIDER_SETTINGS_ENCRYPTION_KEY` (mirrors `integration-tests/setup.js`), `JWT_SECRET`/`COOKIE_SECRET`, and `STORE_CORS`/`ADMIN_CORS`/`AUTH_CORS`.
- Wired BOTH `pnpm test:integration:modules` AND a new `pnpm test:integration:http` step (build step unchanged, still last).
- Extended the focused-test guard grep to also scan `apps/backend/integration-tests`.
- Did NOT weaken any existing step (unit → modules → http → build order preserved; storefront job untouched).

### Cross-slice edit required for the suites to actually connect
`apps/backend/medusa-config.ts` (slice-3 file): the SSL gate was `NODE_ENV !== 'development'`, which forced SSL for `NODE_ENV=test` too — the Medusa integration runners force `NODE_ENV=test`, so against a local non-SSL Postgres the connection would fail (`server does not support SSL`). Changed the gate to `NODE_ENV !== 'development' && NODE_ENV !== 'test'`. Production still gets SSL; development and test (CI + local) connect to non-SSL Postgres. This also unblocks running the module/http suites against a local dev Postgres, not just CI.

### Validation done in-sandbox
YAML parses cleanly (`js-yaml` OK, no tabs). Suites NOT run locally (no Postgres). **Acceptance = a green CI run the maintainer must confirm.**

## FIX 3 (hardening, resilience) — Unbounded credential DB read on the hot path

Status: DONE (GREEN)

### Defect recap
`makeDbCredentialSource` (called per payment/webhook op) awaited `getResolvedCredentials` with no timeout; a slow-but-up DB could hang `initiatePayment`/`authorizePayment`/`verifyWebhookAuth`/quotations.

### RED evidence
Added 3 tests to `src/lib/__tests__/provider-credentials.unit.spec.ts`, ran the suite → **2 failed / 10 passed** (the never-resolving read hung until the fail-safe assertion could not be met; fast-path passed pre-fix).

### GREEN fix (`src/lib/provider-credentials.ts`)
- New `CREDENTIAL_RESOLUTION_TIMEOUT_MS = 3_000` (named constant; generous for one indexed single-row SELECT + one AES-GCM decrypt).
- `makeDbCredentialSource(provider, options?)` now races the read against a `setTimeout` promise. `settled` maps both resolve/reject to a non-throwing shape so a timed-out read cannot surface an unhandled rejection. On timeout → return `null` (provider resolves unconfigured, same as the existing DB-down fail-safe), never throws on the hot path.
- Timeout logs are rate-limited to once per 30s per source (closure-local `lastTimeoutLogAt`) and are secret-free.
- `options` (`timeoutMs`, `logger`, `now`) are injectable for tests; production providers still call `makeDbCredentialSource(IDENTIFIER)` unchanged (defaults apply).

### Triangulate
Hanging read → null within the bound; fast read → creds returned normally; two consecutive timeouts → logged exactly once, and the log message contains no `sk_`/`privateKey`/`token`. No change to `CredentialResolver` (TTL cache + fingerprint rebuild untouched) — cache hits are memory reads well under the bound, only misses can time out and a timeout null is NOT cached (retried next call).

## FIX 4 (hardening, resilience) — Storefront /store/provider-config fetch has no timeout; route can 5xx

Status: DONE (backend GREEN; storefront build-verified)

### 4a — storefront fetch timeout (`apps/storefront/src/lib/data/provider-config.ts`)
Added `signal: AbortSignal.timeout(3_000)` to the `sdk.client.fetch` call (new `PROVIDER_CONFIG_TIMEOUT_MS`). A slow/hung endpoint now aborts and rejects, funnelling into the EXISTING catch → `EMPTY_CONFIG` degradation (warn + disable Openpay card, rest of checkout intact) — exact current behavior, just reached fast instead of stalling the render. `revalidate:60` + tag preserved. Storefront isn't jest-testable here; verified `AbortSignal.timeout` is in-lib (`dom`+`esnext`, target es5) and introduces no new `tsc` error in this file.

### 4b — backend route never-5xx (`src/api/store/provider-config/route.ts`)
RED: new `__tests__/route.unit.spec.ts` → **1 failed / 1 passed** (throw case rejected pre-fix).
GREEN: wrapped `listProviderSettings` in try/catch; on read failure `rows` stays `[]` so `buildPublicProviderConfig([])` returns the empty all-null projection `{openpay:null, mercadopago:null}` (honors the documented never-5xx contract). Failure logged server-side only; response never leaks internal detail.
Triangulate: read throws → `{openpay:null,mercadopago:null}` and `GET` resolves (no throw); successful read → whitelisted openpay projection + mercadopago null.

---

## Final test/build state

- `cd apps/backend && pnpm test:unit` → **19 suites / 275 tests, all green** (was 18/270 pre-fix: +3 FIX 3 tests, +2 FIX 4b tests in a new route suite; FIX 1 added SSRF cases within existing suites). provider-ids contract test intact.
- backend `npx tsc --noEmit` → **CLEAN** (exit 0)
- admin `npx tsc -p src/admin/tsconfig.json --noEmit` → **CLEAN** (exit 0)
- `cd apps/backend && pnpm build` → **GREEN** (backend 26.78s + frontend/admin 122.00s)
- storefront: `provider-config.ts` change introduces no new `tsc` error; full `next build` SSG still needs a reachable backend (pre-existing env blocker, same caveat as prior slices) — maintainer build-verify against a live backend.
- Focused-test guard (incl. new `integration-tests` scan) → no focused tests found.
- **FIX 2 CI acceptance:** a green CI run (with the new Postgres service running both integration suites) is the step the maintainer must confirm — no Postgres in this sandbox.

### Cross-slice / cross-file edits made
| File | Slice origin | Fix | Nature |
|------|--------------|-----|--------|
| `apps/backend/src/workflows/steps/probes/skydropx.ts` | slice 2 | FIX 1 | add `isAllowedSkydropxBaseUrl` + probe guard |
| `apps/backend/src/workflows/steps/resolve-probe-credentials.ts` | slice 2 | FIX 1 | allowlist guard before returning creds |
| `apps/backend/src/api/middlewares.ts` | slice 2 | FIX 1 | strict test-connection body allowlist |
| `apps/backend/src/workflows/steps/probes/types.ts` | slice 2 | FIX 1 | generic `probeFailure` detail + server log |
| `.github/workflows/ci.yml` | pre-existing | FIX 2 | Postgres service, env, both integration steps, guard scan |
| `apps/backend/medusa-config.ts` | slice 3 | FIX 2 | SSL gate excludes `NODE_ENV=test` so CI/test PG connects |
| `apps/backend/src/lib/provider-credentials.ts` | slice 3 | FIX 3 | bounded credential resolution + fail-safe null |
| `apps/storefront/src/lib/data/provider-config.ts` | slice 5 | FIX 4a | `AbortSignal.timeout` fetch bound |
| `apps/backend/src/api/store/provider-config/route.ts` | slice 5 | FIX 4b | try/catch → empty projection (never-5xx) |
| tests: `resolve-probe-credentials.unit.spec.ts`, `probes/__tests__/probes.unit.spec.ts`, `lib/__tests__/provider-credentials.unit.spec.ts`, new `api/store/provider-config/__tests__/route.unit.spec.ts` | — | 1/3/4b | RED-first coverage |

---

## Follow-up: degraded-response caching (resilience re-review, MEDIUM)

**Defect (introduced by FIX 4b):** the never-5xx fail-safe served the degraded, all-null projection with the SAME `Cache-Control: public, max-age=60` as the success path. Combined with the storefront `next: { revalidate: 60 }`, a transient backend/DB blip could cache the degraded response (Openpay card disabled) for up to 60s (Next Data Cache + CDN) even after the DB recovered — a user-visible payments-method outage with no recovery signal.

**Fix (both layers, tiny diff):**
- Backend `apps/backend/src/api/store/provider-config/route.ts`: track a `degraded` flag set only in the catch branch. SUCCESS path (including the healthy-but-unconfigured case where rows are simply absent, no error) keeps `Cache-Control: public, max-age=60`. Only the catch/degraded path now sets `Cache-Control: no-store`. Normal "unconfigured" stays fast + cacheable; only the error path is uncacheable.
- Storefront `apps/storefront/src/lib/data/provider-config.ts`: documented the two-layer caching contract. Healthy 200 → backend `max-age=60` + `revalidate:60` → cached 60s. Degraded 200 → backend `no-store`, which Next 15 honors over the requested revalidate → NOT persisted → next render picks up recovery. Fetch error/timeout → fetch rejects → nothing cached → catch returns EMPTY_CONFIG for that render only. Degradation UX unchanged (warn + Openpay card disabled, rest of checkout intact).

### RED → GREEN evidence
- **RED:** extended `apps/backend/src/api/store/provider-config/__tests__/route.unit.spec.ts` with a degraded-path assertion (`Cache-Control` === `no-store`, not `max-age=60`), plus success-path and healthy-but-empty assertions (both keep `public, max-age=60`). First run: **1 failed, 276 passed** — the degraded test failed with `Expected: "no-store" / Received: "public, max-age=60"`, pinning the defect.
- **GREEN:** after the route `degraded` flag change: `cd apps/backend && pnpm test:unit` → **277 passed, 277 total**.

### Finish gates
- `cd apps/backend && pnpm test:unit` → **GREEN** (277 passed)
- backend `npx tsc --noEmit` → **CLEAN** (exit 0)
- admin `npx tsc -p src/admin/tsconfig.json --noEmit` → **CLEAN** (exit 0)
- `cd apps/backend && pnpm build` → **GREEN** (backend 32.61s + frontend 127.71s)
- storefront: `npx tsc --noEmit` shows no new `provider-config` type error; full `next build` SSG still needs a reachable backend (pre-existing env blocker) — maintainer build-verify against a live backend, confirming Next honors the backend `no-store` on the degraded path.

### Cross-slice / cross-file edits made
| File | Fix | Nature |
|------|-----|--------|
| `apps/backend/src/api/store/provider-config/route.ts` | Follow-up 4b | `degraded` flag → `no-store` on catch path only; success/healthy-empty keep `max-age=60` |
| `apps/storefront/src/lib/data/provider-config.ts` | Follow-up 4b | documented two-layer caching contract (no code behavior change; relies on backend header) |
| `apps/backend/src/api/store/provider-config/__tests__/route.unit.spec.ts` | Follow-up 4b | RED-first cache-header coverage (degraded no-store, healthy/empty max-age=60) |

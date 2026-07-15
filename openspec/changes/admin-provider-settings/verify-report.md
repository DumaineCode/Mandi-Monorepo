# Verify Report — admin-provider-settings

> Change: `admin-provider-settings` · Store: openspec · Phase: verify · Date: 2026-07-14
> Inputs read: `specs/provider-settings/spec.md` (15 requirements), `tasks.md`, `apply-progress.md` (Batches 1–6), `design.md`, `openspec/config.yaml`.
> Strict TDD: ACTIVE (`cd apps/backend && pnpm test:unit`).
> Environment: local sandbox — no Postgres, no live Medusa/storefront backend. Integration + live gates are DEFERRED (see §7), not failed.

## Verdict: READY-WITH-DEFERRALS

The implementation is complete against the spec at the unit/build/type layer, with strong TDD evidence and all security-critical invariants pinned by real assertions. **Merge is conditional on running the deferred integration and live-sandbox gates (§7) in a Postgres/live-backend environment.** No CRITICAL or blocking defects were found in what could be executed here.

- Unit suite: **18 suites / 260 tests green**, provider-ids contract test intact.
- `npx tsc --noEmit` (server): **clean**. `npx tsc -p src/admin/tsconfig.json --noEmit` (admin): **clean**.
- `pnpm build`: **green** (backend 2.39s + frontend 12.46s).
- Task checkboxes: only `5.5` unchecked — a `TODO(sandbox-verify)` best-effort gate, non-blocking by design (proposal risk table). Not a completeness blocker.

---

## 1. Verification commands (run this session, verbatim)

| Command | Result |
|---|---|
| `cd apps/backend && pnpm test:unit` | ✅ **18 suites, 260 tests passed** (8.485s). `src/lib/__tests__/provider-ids.unit.spec.ts` PASS (contract test intact). |
| `cd apps/backend && npx tsc --noEmit` | ✅ exit 0 (server target clean) |
| `cd apps/backend && npx tsc -p src/admin/tsconfig.json --noEmit` | ✅ exit 0 (admin target clean) |
| `cd apps/backend && pnpm build` | ✅ exit 0 — Backend build 2.39s, Frontend (admin bundle) 12.46s |

All unit tests transform `.ts` only (jest); pure logic seams (crypto, service resolver, validation, probes, masking, public-config, form-model, seed core) carry the behavioral coverage. React/SDK/container shells are covered by `tsc` + `pnpm build`.

---

## 2. Requirement-by-requirement traceability

Legend: **VERIFIED** = behavior proven by an executed unit test; **CODE-PRESENT** = implemented + build/type-verified, deeper proof deferred to integration/live gate; **GAP** = not implemented/covered.

| # | Spec Requirement | Implementing code (spot-checked, exists) | Covering test(s) (executed green) | Status |
|---|---|---|---|---|
| 1 | Persisted Provider Credential Sets (single active, upsert) | `modules/provider-settings/models/provider-setting.ts` (`provider` unique), `service.ts` (`prepareProviderSettingRow`), `workflows/steps/encrypt-and-upsert-provider-setting.ts` | `service.unit.spec.ts`, `encrypt-and-upsert-provider-setting.unit.spec.ts` (upsert single row, retained-merge) | **VERIFIED** (unit) · single-row DB CRUD deferred to `modules` integration |
| 2 | Secrets Encrypted at Rest (AES-256-GCM, KEK, fail-safe decrypt) | `modules/provider-settings/crypto.ts` (`pset.v1` envelope, AAD `${provider}:v1`, KEK 32-byte b64/hex) | `crypto.unit.spec.ts` (roundtrip; tamper tag/IV/ct → null; wrong KEK → null; AAD mismatch → null; malformed → null; invalid KEK → encrypt throws / decrypt null / logged once, no secret material) | **VERIFIED** |
| 3 | Masked Secret Reads (`••••`+last4, metadata, never plaintext) | `api/admin/provider-settings/helpers.ts` (`toMaskedProviderSetting` — reads `secret_hints` only, **never decrypts**) | `masking.unit.spec.ts`; http `provider-settings.spec.ts` asserts `••••5678`/`••••••••` + no-plaintext scan (deferred layer) | **VERIFIED** (unit masking) · full API shape deferred to `http` integration |
| 4 | Admin Settings API (GET/POST/DELETE, workflows, validation, auth) | `api/admin/provider-settings/route.ts`, `[provider]/route.ts`, `[provider]/test-connection/route.ts` (`AuthenticatedMedusaRequest<T>`); workflows `upsert-/delete-provider-settings.ts`; `api/middlewares.ts` | `validate-provider-payload.unit.spec.ts` (missing field → descriptive error, nothing persisted); http suite (401, partial→400, DELETE→unconfigured) deferred | **VERIFIED** (validation unit) · auth/HTTP wiring **CODE-PRESENT** (deferred to `http`) |
| 5 | Test Connection (candidate-or-stored, bounded, best-effort labels) | `workflows/steps/probes/{openpay,skydropx,mercadopago}.ts` (8s AbortController), `resolve-probe-credentials.ts`, `test-provider-connection.ts` | `probes.unit.spec.ts` (pass/401/403/404/timeout/network + MP live_mode mismatch), `resolve-probe-credentials.unit.spec.ts` (candidate overlay, never persist) | **VERIFIED** (unit) · Openpay wire shape best-effort (gate S2.0c, §7) |
| 6 | Always-Registered + Runtime Credential Resolution | `medusa-config.ts` (openpay+skydropx unconditional, `options: {}`), `lib/provider-credentials.ts` (per-call resolve, `allowUnregistered`, never in ctor), openpay/skydropx `service.ts` (`getClient()` fingerprint cache) | `provider-credentials.unit.spec.ts` (unresolved/throws/null → null; per-call; fingerprint), openpay/skydropx `service.unit.spec.ts` (rotation → client rebuild) | **VERIFIED** (unit) · real boot-with-zero-env deferred to integration (§7) |
| 7 | Fail-Safe Unconfigured Behavior (no crash/5xx, checkout excludes, reject-all) | openpay `service.ts` (unconfigured → `MedusaError(INVALID_DATA, "not configured")`), skydropx `service.ts` (quote/label → INVALID_DATA, cancel log-and-proceed) | openpay `service.unit.spec.ts` (5 ops parametrized reject + never call API), skydropx `service.unit.spec.ts` ("unconfigured → INVALID_DATA, never calls the API") | **VERIFIED** (unit) · boot fail-safe deferred to integration |
| 8 | DB Strictly Authoritative After Seed (incl. `SKYDROPX_TAX_INCLUSIVE`) | skydropx `service.ts` (env read **deleted**), `medusa-config.ts` (no `providerEnvReady`), `scripts/seed-provider-settings.core.ts` | skydropx `service.unit.spec.ts` ("NEVER consults SKYDROPX_TAX_INCLUSIVE env"), grep confirms zero runtime env reads | **VERIFIED** |
| 9 | One-Time Idempotent Env Seed (partial-skip, no dup, logged, no secret logs) | `scripts/seed-provider-settings.core.ts` (`seedFromEnv`), `seed-provider-settings.ts` (exec wrapper) | `seed-provider-settings.unit.spec.ts` (all-seeded; skipped-incomplete WARN naming missing; skipped-existing preserves edits/no dup; no-secret-in-log scan; invalid KEK aborts) | **VERIFIED** (unit) · twice-run against live DB deferred (§7) |
| 10 | DB-Resolved Webhook Verification (per-delivery, rotation, reject-all) | openpay `service.ts` (`verifyWebhookAuth` async, DB-resolved user/pass, `timingSafeEqual` + length guard) | openpay `webhook.unit.spec.ts` (reject-all when source→null; password A rejected / B accepted no restart; odd-length guard; never logs password) | **VERIFIED** |
| 11 | Public Store Config Endpoint (whitelist, no secret, null-not-5xx) | `api/store/provider-config/route.ts` (reads `public_config` via `listProviderSettings`, never decrypts), `public-config.ts` (strict whitelist) | `public-config.unit.spec.ts` (hostile extra `privateKey`/`webhookPassword`/`accessToken` NEVER in serialized output; exact `Object.keys` asserted; skydropx omitted; unconfigured/disabled→null) | **VERIFIED** (unit) · http shape deferred to `http` integration |
| 12 | Storefront Runtime Config Consumption (props, graceful degrade) | `apps/storefront/src/lib/data/provider-config.ts` (server fetch, `revalidate:60`, null-safe), `openpay-wrapper.tsx` (`NEXT_PUBLIC_OPENPAY_*` removed, config as props, degrade path preserved), `payment-wrapper/index.tsx`, `checkout/page.tsx` | Storefront shells build-verified (`next build` compiled successfully). `constants.tsx`/`paymentInfoMap` no diff. | **CODE-PRESENT** · SSG + live tokenization deferred (§7) |
| 13 | Mode Toggle — Single Active Set with Re-Entry | `workflows/steps/validate-provider-payload.ts` (mode switch w/o re-entry → reject), `admin/routes/provider-settings/form-model.ts` (`deriveSecretState`, `buildUpsertBody`) | `validate-provider-payload.unit.spec.ts` (mode-switch reject / re-entry accept), `form-model.unit.spec.ts` (clear+require+warn on mode switch, toggle-alone no mutate) | **VERIFIED** |
| 14 | Admin Provider Settings UI (list, forms, toggle, masked, test, save/clear) | `admin/routes/provider-settings/page.tsx`, `components/provider-panel.tsx`, `api.ts`, `lib/client.ts`, `form-model.ts` | `form-model.unit.spec.ts` (17 tests: field split, hydrate w/o secrets, upsert body, test candidate). Presentational shells build-verified (admin bundle + admin tsc clean) | **VERIFIED** (model logic) · UI render **CODE-PRESENT** · browser smoke deferred (§7) |
| 15 | Mercado Pago Settings-Only (store/validate/mask/test, no module) | `types.ts` (MP shape), `validate-provider-payload.ts`, `probes/mercadopago.ts`, `public-config.ts` (MP publicKey); `medusa-config.ts` MP block commented/unregistered | `validate-provider-payload.unit.spec.ts` (MP shape), `probes.unit.spec.ts` (MP token/live_mode), `public-config.unit.spec.ts` (MP whitelist), `seed` MP mapping | **VERIFIED** (unit) · no MP payment option (build/config verified) |

**Uncovered requirements: none (0 GAPs).** Two sub-behaviors are best-effort by design, not gaps: Openpay probe wire shape (task 2.6, gate S2.0c) and live Openpay tokenization (task 5.5, gate S5.0b) — both `TODO(sandbox-verify)`, non-blocking per the proposal risk table.

---

## 3. Strict TDD compliance (ACTIVE)

**COMPLIANT.** `apply-progress.md` contains a per-batch `TDD Cycle Evidence` table (Cycles 1–15) with explicit RED (failing "Cannot find module" / assertion-fail runs) → GREEN (passing counts) → TRIANGULATE/REFACTOR for every pure-logic seam. Cross-referenced against the codebase:

- Every claimed test file **exists and runs green** (18 suites confirmed this session). No hallucinated test files.
- RED evidence is concrete (module-not-found suite failures with running counts) and monotonic test-count growth is consistent across batches (146 → 192 → 220 → 237 → 248 → 260).
- The apply phase is honest about the TDD split: pure logic is TDD'd; thin React/SDK/container shells are build/type-verified only (jest node env cannot render them). This is a legitimate and clearly-documented boundary, not a TDD evasion.

---

## 4. Assertion quality audit (changed/created tests)

**PASS — no anti-patterns found.** Spot-checked the security-critical suites:

- `crypto.unit.spec.ts`: real fail-safe assertions (`toBeNull` on tamper/wrong-KEK/AAD-mismatch/malformed; roundtrip `toEqual`). No tautologies.
- openpay `service.unit.spec.ts` / `webhook.unit.spec.ts`: parametrized `rejects.toMatchObject({ type: INVALID_DATA, message: stringContaining("not configured") })`, `never calls the API` spies, rotation A-rejected/B-accepted, "never logs the webhook password". Behavioral, not type-only.
- `public-config.unit.spec.ts`: **strongest safety assertion in the change** — serialized output scanned for hostile injected secrets (`not.toContain("sk_LEAK")`, `not.toMatch(/privateKey|webhookPassword|accessToken|encrypted_secrets/)`) AND exact `Object.keys(...).sort()` whitelist. No ghost loops, no smoke-only.
- `provider-settings.spec.ts` (http, deferred layer): iterates all response strings asserting `not.toContain(secret)` for every stored plaintext — pins success criterion #2 at the API layer.

No tautologies, ghost loops, type-only-alone, smoke-only, or implementation-detail CSS assertions observed.

---

## 5. Security spot-checks (crypto/secrets/payments change)

| Check | Result |
|---|---|
| Masked reads never decrypt | ✅ `grep decrypt apps/backend/src/api` finds only comments stating "never decrypts". `helpers.ts` masks purely from `secret_hints`; admin route header comment confirms. |
| `/store/provider-config` is a whitelist with NO secret fields | ✅ `public-config.ts` builds only `{merchantId,publicKey,sandbox}` / `{publicKey,sandbox}`; `encrypted_secrets` used solely as a boolean `isServable` check. No-leak unit test asserts exact keys + hostile-field exclusion. |
| Decrypt failure → null fail-safe path exists & tested | ✅ `crypto.decryptSecrets(...) → null` on all failure modes; service `CredentialResolver` returns null on decrypt failure (per apply-progress + service tests). Read path never throws. |
| Fail-safe unconfigured (payment reject / webhook reject-all) tested | ✅ openpay unconfigured → INVALID_DATA (5 ops, never calls API); webhook source→null → reject-all; skydropx quote/label → INVALID_DATA never calls API. |
| Fail-safe boot (unconfigured/always-registered doesn't crash boot) | ✅ Represented at unit level: `provider-credentials.ts` returns null on unresolved module (`allowUnregistered`), providers resolve inert. `medusa-config.ts` registers both unconditionally with `options: {}`. **Real boot deferred to integration (§7)** — apply-progress notes a live-boot observation during `db:migrate` (module booted KEK-less, logged single ERROR, boot continued). |

No plaintext-secret leakage path found in any executed read path. `secret_hints` (last4 only) is the sole write-time masking source.

---

## 6. Review workload / PR boundary findings

`tasks.md` Review Workload Forecast: **Chained PRs recommended: Yes**, delivery `auto-chain`, chain strategy `pending`, budget 600 changed lines/PR. Apply-progress recorded a per-slice PR boundary and the actual overages honestly:

| Slice | Forecast | Actual reviewable src | Note |
|---|---|---|---|
| 1 | ~550 | ~410 src (+240 generated migration) | Escape hatch: `size:generated`; optional 1a/1b split recorded |
| 2 | ~550 | ~1,362 src (comment-heavy) | **Over 600** — `size:exception` or 2a/2b split recorded |
| 3 | ~450 | ~420 src | Within budget; lands alone (highest-risk revert point) ✅ |
| 4 | ~500 | 697 src | ~97 over — `size:exception` or 4a/4b split recorded |
| 5 | ~350 | ~255 src | Within budget ✅ |
| 6 | ~250 | ~275 src | Within budget ✅ |

**Findings:**
- **No scope creep.** Each batch's "Cross-slice edits" ledger shows slices touched only their own files; shared files (`medusa-config.ts`, `setup.js`, `integration-tests/http/provider-settings.spec.ts`, `package.json`, `.env.template`) carry cleanly-separated additive hunks with documented provenance. No slice mutated a prior slice's logic.
- **Chain strategy was never resolved** (`pending` in tasks.md). All six slices were implemented on a single uncommitted branch `feat/provider-settings-01-persistence` with recorded-but-not-executed split recommendations. **WARNING (process, non-blocking):** the `auto-chain` delivery strategy implies chained PRs, but the actual PR/branch boundary has not been cut — this is a maintainer decision surfaced correctly by apply, not a code defect. Before opening PRs, decide: single `size:exception` PR vs. the recorded per-slice/2a-2b/4a-4b splits.
- Slices 2 and 4 exceed the 600 budget on reviewable src; `size:exception` must be explicitly recorded on the PR(s) or the recorded splits applied.

---

## 7. DEFERRED gates (preconditions to merge — NOT failures)

These require Postgres and/or a live backend absent from this sandbox. Each was written/type-checked; only the live run remains.

| Gate | Command / environment | Pass criteria |
|---|---|---|
| Module integration | `cd apps/backend && pnpm test:integration:modules` (needs Postgres) | `provider-settings.spec.ts` green: settings CRUD + migration up/down against real Postgres |
| HTTP integration | `cd apps/backend && pnpm test:integration:http` (needs Postgres) | `provider-settings.spec.ts` green: 401 unauth; upsert→masked GET with **no response string equal to any stored plaintext**; partial save→400 naming field, prior row unchanged; test-connection (fetch-mocked) stamps `last_verified_at`; DELETE→unconfigured; `GET /store/provider-config` whitelist + null-on-unconfigured. Watch two live-run assumptions flagged by apply: (a) admin JWT via `generateJwtToken`+`http.jwtSecret`; (b) publishable-key acceptance for the custom store GET without sales-channel association. |
| Seed idempotency (live) | `npx medusa exec ./src/scripts/seed-provider-settings.ts` run twice against a dev DB | 2nd run logs `skipped-existing` for all seeded providers, zero duplicate rows, admin-edited keys preserved |
| Boot fail-safe (live) | Boot backend with zero provider env + KEK set | Boot succeeds; openpay+skydropx registered + inert; webhook to unconfigured Openpay rejected; checkout excludes/gracefully rejects unconfigured providers |
| Storefront SSG | `cd apps/storefront && pnpm build` against a **reachable** backend | `next build` completes SSG "Collecting page data" (this session it compiled ✓ but SSG hit pre-existing `ECONNREFUSED` — no backend). |
| S2.0c — Openpay probe wire shape | Openpay sandbox account | Confirm `GET {base}/v1/{merchantId}/charges?limit=1` 200/401/403/404 mapping; drop `TODO(sandbox-verify)` |
| S5.0b — Openpay tokenization (task 5.5) | Openpay sandbox + rotated public key | New checkout session tokenizes with rotated key after propagation window, no storefront redeploy. Non-blocking per proposal. |

---

## 8. Pre-existing noise (NOT regressions — do not attribute to this change)

- **~466 storefront `tsc` `TS2786`/ReactNode errors**: pre-existing global duplicate `@types/react` (React 19) issue on **untouched** files (`layout.tsx`, `Spinner`, account pages). `next build` authoritatively "Skipping validation of types". Confirmed by apply-progress and not introduced by any slice-5 storefront edit (new `provider-config.ts` has zero tsc errors). Pre-dates this change.
- **`npx medusa db:migrate` against Neon dev DB** fails without the `NODE_ENV=production` workaround (SSL driver disabled in development) — pre-existing `medusa-config.ts` behavior, not changed here.
- **Storefront `pnpm build` SSG `ECONNREFUSED`** — environmental (no live backend in sandbox), not a code defect; compile step passes.

---

## 9. Task checkbox status

Scanned `tasks.md` for `^\s*- \[ \]`:

- **1 unchecked line:**
  `- [ ] 5.5 **best-effort, TODO(sandbox-verify) (gate S5.0b)**: end-to-end tokenization check with rotated public key against Openpay sandbox — document as pending gate in the PR description, do not block merge on it`

This is intentionally deferred, best-effort, and **non-blocking by design** (proposal risk table + spec "Uncovered requirements: none"). It is a pending live gate (§7), not incomplete implementation scope. **All implementation tasks (1.1–4.6, 5.1–5.4, 5.6, 6.1–6.5, 7.1) are checked.** Per the archive-readiness rule this single non-critical, by-design deferred verification gate does not constitute an incomplete implementation task; archive may proceed once the §7 integration gates are run, with 5.5 tracked as a post-merge sandbox gate.

---

## 10. Structured status & actionContext findings

- Artifact store: `openspec` (authoritative). All six apply batches consumed slice-scoped structured status with edit roots inside `apps/backend/**` / `apps/storefront/src/**` / `docs/` / change artifacts; no `actionContext` warnings reported and none found.
- Ownership proven: all changed files resolve inside the authoritative workspace; cross-slice edit ledgers are consistent with the working tree described.
- Engram mirror of apply artifacts was attempted but the Engram server was unreachable during several batches; openspec files remain the authoritative store — consistent with this verify run.

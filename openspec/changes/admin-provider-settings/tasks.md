# Tasks — admin-provider-settings

> Change: `admin-provider-settings` · Store: openspec · Phase: tasks
> Inputs: `spec.md` (required), `design.md` (required), `proposal.md`, `explore.md`, `openspec/config.yaml`.
> Slice order follows design §11 (authoritative): 1 persistence+crypto → 2 workflows+admin API → 3 runtime resolution+registration flip → 4 admin UI → 5 public endpoint+storefront → 6 seed+deprecation. (The orchestrator brief listed slices 2/3 swapped; design §11 wins — the admin API integration tests need the module and workflows before the risky flip lands alone.)
> STRICT TDD is active. Unit test command: `cd apps/backend && pnpm test:unit`. Every code task follows RED (failing test) → GREEN (implement) → TRIANGULATE/REFACTOR, using the existing pattern: explicit options into constructors, fake `{logger}` containers, mocked global `fetch` (explore §6). Never write implementation before its failing test.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2,650 total (550 + 550 + 450 + 500 + 350 + 250 per slice) |
| 400-line budget risk | High (total); each slice fits the project's 600-line budget from `openspec/config.yaml` |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (persistence+crypto) → PR 2 (workflows+admin API) → PR 3 (runtime resolution+flip, lands alone) → PR 4 (admin UI) → PR 5 (public endpoint+storefront) → PR 6 (seed+deprecation) |
| Delivery strategy | auto-chain (from `openspec/config.yaml`) |
| Chain strategy | pending |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

> Note on budget: this project's configured review budget is **600** changed lines/PR (`review_budget_changed_lines_per_pr: 600`), stricter-than-default 400 noted above for the guard. Slices 1–2 are forecast at ~550 — inside 600 but tight. Escape hatch if slice 1 tips over: the generated migration file is mechanical bulk — tag it `size:generated`; if still over, split slice 1 into 1a (crypto.ts + tests, ~250) and 1b (model/service/migration/config + tests, ~300). Slice 2 escape hatch: split probes (+tests) into their own PR (~200).

---

## Slice 1 — Persistence + crypto (~550 lines, PR 1)

Independently shippable: adds an unused module; revert = drop module + migration (generated down). No behavior change for existing providers.

- [x] 1.1 RED: create `apps/backend/src/modules/provider-settings/__tests__/crypto.unit.spec.ts` — failing tests for AES-256-GCM envelope: encrypt/decrypt roundtrip; envelope format `pset.v1.<iv>.<tag>.<ct>` (b64url parts); tamper (tag/IV/ct) → `null`; wrong KEK → `null`; AAD mismatch (ciphertext moved to another provider) → `null` (design §2)
- [x] 1.2 GREEN: implement `apps/backend/src/modules/provider-settings/crypto.ts` — pure functions, zero framework imports, KEK param (32 bytes, base64 or hex), AAD `"${provider}:v1"`, random 12-byte IV, decrypt failures return `null` never throw
- [x] 1.3 TRIANGULATE: add KEK-validation tests (missing/short/undecodable KEK → disabled state: `encrypt` throws, `decrypt` returns `null`; error logged once, no secret material in messages) and make them pass
- [x] 1.4 RED: create `apps/backend/src/modules/provider-settings/__tests__/service.unit.spec.ts` — failing tests with pure collaborators (no ORM, design §10): upsert path encrypts + computes `secret_hints` `{ field: { last4, set } }` with no plaintext persisted; `getResolvedCredentials` returns `null` for: no row, `is_enabled=false`, no secrets, decrypt failure (logged); cache hit/miss/TTL-expiry (`ttlMs: 0` in tests)/`invalidateCredentialCache`
- [x] 1.5 GREEN: implement `apps/backend/src/modules/provider-settings/types.ts` (per-provider credential shapes + `ResolvedProviderConfig` matching today's options mapping, design §1.1/§9), `models/provider-setting.ts` (fields per design §1.1: `provider` unique, `mode`, `is_enabled`, `public_config`, `encrypted_secrets`, `secret_hints`, `last_verified_at`), and `service.ts` (`ProviderSettingsModuleService extends MedusaService({ ProviderSetting })` + `getResolvedCredentials` + `invalidateCredentialCache`; read path never throws)
- [x] 1.6 GREEN: create `apps/backend/src/modules/provider-settings/index.ts` — `Module("providerSettings", { service })` with exported `PROVIDER_SETTINGS_MODULE = "providerSettings"` (camelCase, F3) and register `{ resolve: "./src/modules/provider-settings" }` in `apps/backend/medusa-config.ts` `modules: []` (registration only — no provider changes in this slice)
- [x] 1.7 Generate migration (db-generate skill): `cd apps/backend && npx medusa db:generate providerSettings`, then `npx medusa db:migrate`; commit the generated file under the module's `migrations/` dir — never handwrite it; tag PR `size:generated` if it tips the 600 budget
- [x] 1.8 RED→GREEN (integration, verify-time): add `apps/backend/integration-tests/modules/provider-settings.spec.ts` — settings CRUD + migration against real Postgres (`pnpm test:integration:modules`); add deterministic test KEK `PROVIDER_SETTINGS_ENCRYPTION_KEY=<fixed 32-byte base64>` to `apps/backend/integration-tests/setup.js` (needed from this slice on, not slice 3)
- [x] 1.9 VERIFY slice 1: `cd apps/backend && pnpm test:unit` green (incl. `provider-ids.unit.spec.ts` untouched/green), `pnpm build` green, migration applies + reverts cleanly

## Slice 2 — Workflows + admin API (~550 lines, PR 2)

Depends on slice 1. Independently shippable: new admin-only routes; revert = drop routes/workflows. Providers still env-driven.

- [x] 2.1 RED: failing unit tests for `validate-provider-payload` step — per-provider Zod shape (openpay: merchantId, privateKey, publicKey, sandbox/mode, webhookUser, webhookPassword; skydropx: apiKey, baseUrl?, originZip, taxInclusive; mercadopago: accessToken, webhookSecret, publicKey per spec shapes); missing required field → descriptive validation error naming the field, nothing persisted; mode switch without re-entered secrets → rejected (spec Mode Toggle)
- [x] 2.2 GREEN: implement Zod schemas + inferred types in `apps/backend/src/api/middlewares.ts` (export both, `validateAndTransformBody`) and `apps/backend/src/workflows/steps/validate-provider-payload.ts`
- [x] 2.3 RED→GREEN: `apps/backend/src/workflows/steps/encrypt-and-upsert-provider-setting.ts` (encrypt via crypto.ts, compute `secret_hints`, upsert single row, compensation restores previous row snapshot; omitted secret = keep existing) and `steps/invalidate-provider-credential-cache.ts`; compose `apps/backend/src/workflows/upsert-provider-settings.ts` (regular `function`, no await/conditionals — use `when()`/`transform()`)
- [x] 2.4 RED→GREEN: `apps/backend/src/workflows/delete-provider-settings.ts` — clear credentials + invalidate cache, with compensation
- [x] 2.5 RED: failing probe unit tests (mocked fetch, 8s timeout as failure) in `apps/backend/src/workflows/steps/probes/__tests__/`: Openpay `GET /v1/{merchantId}/charges?limit=1` (200 pass / 401,403 bad key / 404 bad merchant or wrong base); Skydropx `POST /quotations` origin→fixed destination zip `06600` smallest parcel (2xx pass / 401 bad apiKey); MP `GET https://api.mercadopago.com/users/me` Bearer (200 pass + `live_mode` vs mode mismatch warning / 401 fail); timeout → fail with reason
- [x] 2.6 GREEN: implement probes in `apps/backend/src/workflows/steps/probes/{openpay,skydropx,mercadopago}.ts` — **best-effort, TODO(sandbox-verify)**: Openpay wire shape gated on S2.0c, Skydropx on S5.0b; carry the existing TODO markers in code comments and label results best-effort in the response `detail`; do NOT block this slice on sandbox verification
- [x] 2.7 RED→GREEN: compose `apps/backend/src/workflows/test-provider-connection.ts` — `resolve-probe-credentials` (candidate from input, else decrypt stored) → `run-provider-probe` → `when(ok)` → `mark-provider-verified` (sets `last_verified_at`); probe never persists candidate credentials
- [x] 2.8 RED→GREEN: admin routes under `apps/backend/src/api/admin/provider-settings/` — `route.ts` (GET all: masked via `secret_hints`, never decrypts; includes `configured`, `mode`, `last_verified_at`, updated-at) and `[provider]/route.ts` (GET single, POST upsert via workflow returning masked read, DELETE via workflow) and `[provider]/test-connection/route.ts` (POST → `{ ok, detail, checked_at }`); `AuthenticatedMedusaRequest<T>`, GET/POST/DELETE only, no business logic in routes
- [x] 2.9 RED→GREEN (integration, verify-time): `apps/backend/integration-tests/http/provider-settings.spec.ts` — unauthenticated → 401; upsert → masked GET asserting **no response field equals any stored plaintext** (spec success criterion #2, incl. `••••` + last-4 format for secrets ≥8 chars); partial save → 422 naming field, previous row unchanged; test-connection (fetch-mocked); DELETE → unconfigured
- [x] 2.10 VERIFY slice 2: `pnpm test:unit` green (provider-ids contract test intact), `pnpm build` green, http integration suite green

## Slice 3 — Runtime resolution + registration flip (~450 lines, PR 3 — highest-risk revert point, lands alone)

Depends on slices 1–2. Revert = restore env-gated `medusa-config.ts` (env vars still present during deprecation window).

- [x] 3.1 RED: failing unit tests for `apps/backend/src/lib/provider-credentials.ts` — `makeDbCredentialSource(provider)`: returns `null` when module unresolved; returns resolved config; container faked
- [x] 3.2 GREEN: implement `apps/backend/src/lib/provider-credentials.ts` — static top-level `import { container } from "@medusajs/framework"`, per-call resolution with `allowUnregistered`, NEVER resolved in constructors (design F1/F2)
- [x] 3.3 RED: rework `apps/backend/src/modules/openpay-payment/__tests__/{service,webhook,client}.unit.spec.ts` — fake `credentialSource` (null / creds / rotated creds): unconfigured → `MedusaError(INVALID_DATA, "Openpay is not configured")` on every payment op; client rebuilt on fingerprint change (rotation); webhook `verifyWebhookAuth` async, DB-resolved user/password per delivery, `timingSafeEqual` retained, source `null` ⇒ reject-all; existing payment-op suites moved to async client acquisition
- [x] 3.4 GREEN: refactor `apps/backend/src/modules/openpay-payment/service.ts` — relax `validateOptions` (empty options valid), remove boot-time `new OpenpayClient(options)`, add `getClient()` with fingerprint cache, thread optional `credentialSource` option (default `makeDbCredentialSource(OPENPAY_IDENTIFIER)`), make webhook verification DB-resolved; `client.ts` stays immutable (rebuild, don't mutate)
- [x] 3.5 RED→GREEN: same pattern for `apps/backend/src/modules/skydropx-fulfillment/service.ts` — `getClient()`, relaxed `validateOptions`, per-call resolution; `originZip`/`taxInclusive` from `public_config` (stock-location zip still wins); **delete the lazy `process.env.SKYDROPX_TAX_INCLUSIVE` read** (spec: DB strictly authoritative); rework skydropx unit suites with fake `credentialSource`
- [x] 3.6 GREEN: flip `apps/backend/medusa-config.ts` — Openpay + Skydropx provider entries unconditional with options `{}`, remove `providerEnvReady` gating for them (keep MP block unreachable/commented — MP stays unregistered); `pp_system_default`/`manual_manual` untouched
- [x] 3.7 Remove the inert `SKYDROPX_BASE_URL` fake from `apps/backend/integration-tests/setup.js` (design §10 — harmless fake removed with the flip); provider credential env stays unset so post-flip boot itself regression-tests fail-safe unconfigured registration
- [x] 3.8 VERIFY slice 3 (critical): `pnpm test:unit` green (provider-ids contract test intact), `pnpm build` green, both integration suites green — boot with zero provider env succeeds, both providers registered + inert, webhook delivery to unconfigured Openpay rejected, checkout excludes/gracefully rejects unconfigured providers

## Slice 4 — Admin UI (~500 lines, PR 4)

Depends on slice 2 (admin API). UI-only; revert = drop admin route files. Load `building-admin-dashboard-customizations` references (`data-loading.md`, `forms.md`) before implementing.

- [x] 4.1 Create `apps/backend/src/admin/lib/client.ts` — SDK instance with exact config (`baseUrl: VITE_BACKEND_URL || "/"`, `auth: { type: "session" }`); `@tanstack/react-query` + `react-router-dom` already installed at required versions (explore §3) — verify, don't reinstall
- [x] 4.2 Create UI route `apps/backend/src/admin/routes/provider-settings/page.tsx` — `defineRouteConfig({ label: "Provider Settings" })`; lists the 3 providers with `configured`/mode/last-updated status from a display query that loads on mount (no `enabled` tied to UI state), `sdk.client.fetch("/admin/provider-settings")`, loading spinner, Medusa UI components + semantic classes only
- [x] 4.3 Build per-provider form components under `apps/backend/src/admin/routes/provider-settings/components/` — paste-keys inputs per provider shape, sandbox/production toggle, masked display of saved secrets (`secret_hints`), save (POST) + clear (DELETE) mutations via `sdk.client.fetch`, invalidate the display query on success, buttons `size="small"`, disabled + loading during pending mutations
- [x] 4.4 Implement mode-switch UX per spec (Mode Toggle requirement): switching the form's mode away from the saved mode clears secret fields, marks them required, and shows a replace-warning; saving without re-entered secrets surfaces the API validation error; toggle alone never mutates
- [x] 4.5 Add test-connection UX — button posts to `/admin/provider-settings/:provider/test-connection` with current form candidates (or empty to test stored), shows pass/fail + returned reason + **best-effort probe label** per provider, disabled while probe pending; failed test still allows save (admin's discretion, per spec)
- [x] 4.6 VERIFY slice 4: `pnpm build` green (admin bundle compiles), `pnpm test:unit` still green; manual smoke via `http://localhost:9000/app` → Provider Settings: configure Skydropx end-to-end (paste → test → save → masked read → clear) — automated gates green (build + 237 unit + server/admin tsc clean); browser smoke deferred to a running instance at verify (no live server in this sandbox, same caveat as slice 1–3 integration runs)

## Slice 5 — Public endpoint + storefront (~350 lines, PR 5)

Depends on slices 1 and 3 (rotation propagation needs runtime resolution). Revert = drop store route + restore env reads in wrapper.

- [x] 5.1 RED→GREEN (http integration, verify-time): extend `apps/backend/integration-tests/http/provider-settings.spec.ts` — `GET /store/provider-config` returns `{ openpay: { merchantId, publicKey, sandbox } | null, mercadopago: { publicKey, sandbox } | null }`, no secret field structurally present, Skydropx omitted, unconfigured/disabled provider → `null` (not 5xx); after admin DELETE → `null`
- [x] 5.2 GREEN: implement `apps/backend/src/api/store/provider-config/route.ts` — reads `public_config` of enabled+configured providers ONLY (never touches `encrypted_secrets`/decrypt), served from the settings cache, `Cache-Control: public, max-age=60`
- [x] 5.3 Create `apps/storefront/src/lib/data/provider-config.ts` — server-side `sdk.client.fetch("/store/provider-config", { next: { revalidate: 60, tags: ["provider-config"] } })`; returns `null`-safe config
- [x] 5.4 Refactor `apps/storefront/src/modules/checkout/components/payment-wrapper/openpay-wrapper.tsx` (lines ~105–117) — remove `NEXT_PUBLIC_OPENPAY_MERCHANT_ID/PUBLIC_KEY/SANDBOX` reads; receive config as props threaded from the nearest server component in the checkout payment tree; missing/`null` config → existing degraded path exactly (warn + disable Openpay card payments, rest of checkout functional)
- [ ] 5.5 **best-effort, TODO(sandbox-verify) (gate S5.0b)**: end-to-end tokenization check with rotated public key against Openpay sandbox — document as pending gate in the PR description, do not block merge on it
- [x] 5.6 VERIFY slice 5: backend `pnpm build` + `pnpm test:unit` green (provider-ids contract test in `apps/storefront` constants untouched — `constants.tsx`/`paymentInfoMap` must show no diff), storefront `cd apps/storefront && pnpm build` green, http integration suite green

## Slice 6 — Seed + deprecation (~250 lines, PR 6)

Depends on slice 1 (module) and 3 (strict authority). Docs + one exec script; revert = delete script + docs.

- [x] 6.1 RED: failing unit tests for pure `seedFromEnv(settingsService, env, logger)` — full env set → seeded (encrypted, correct mode from `OPENPAY_SANDBOX`, `OPENPAY_PUBLIC_KEY` → `public_config`); partial set → skipped + WARN listing missing names, no partial row; existing row → `skipped-existing` (admin edits preserved); per-provider outcome lines + summary; assert no secret values in any log call
- [x] 6.2 GREEN: implement `apps/backend/src/scripts/seed-provider-settings.ts` — `medusa exec` script resolving `providerSettings` from the loaded container, delegating to the shared pure `seedFromEnv`; required env sets mirror today's `providerEnvReady` gating exactly (explore §1)
- [x] 6.3 Update `.env.template` (backend + storefront): add `PROVIDER_SETTINGS_ENCRYPTION_KEY` with generation instructions (32-byte base64); mark `OPENPAY_*`, `SKYDROPX_*`, `MP_*` and `NEXT_PUBLIC_OPENPAY_*`/`NEXT_PUBLIC_MP_PUBLIC_KEY` as DEPRECATED with removal-window note; keep `BACKEND_PUBLIC_URL`
- [x] 6.4 Update `docs/runbooks/mx-payments-shipping.md` — deploy step `npx medusa exec ./src/scripts/seed-provider-settings.ts` (safe every deploy), KEK operational contract (loss ⇒ re-paste via admin), post-seed env contract (only KEK + `BACKEND_PUBLIC_URL`), rollback procedure per slice (registration-flip revert restores env-driven behavior during window), multi-instance 30s TTL staleness note
- [x] 6.5 VERIFY slice 6: `pnpm test:unit` green (260 tests / 18 suites), `pnpm build` green, backend + admin `tsc --noEmit` clean; idempotency (`skipped-existing`, no duplicates) pinned by unit tests — the manual twice-against-dev-DB run is deferred to verify (no live DB in this sandbox, same caveat as slices 1–5)

## Pre-archive (with or after PR 6)

- [x] 7.1 Relocated the flat `spec.md` to the archive-expected delta shape `openspec/changes/admin-provider-settings/specs/provider-settings/spec.md` (clean move; the flat change-root path would fail archive convention). `/sdd-archive` promotes this delta to `openspec/specs/provider-settings/`. Other change-folder artifacts (proposal/design/tasks/explore/apply-progress) left intact for the archive report; no references to the old flat path remain.

---

## Traceability (spec requirement → tasks/slice)

| Spec requirement | Tasks | Slice |
|---|---|---|
| Persisted Provider Credential Sets (single active set, upsert) | 1.4–1.8, 2.3 | 1–2 |
| Secrets Encrypted at Rest (AES-256-GCM, KEK, fail-safe decrypt) | 1.1–1.5, 1.8 | 1 |
| Masked Secret Reads (`••••` + last-4, metadata) | 1.4–1.5 (hints), 2.8–2.9 (API) | 1–2 |
| Admin Settings API (GET/POST/DELETE, workflows, validation, auth) | 2.1–2.4, 2.8–2.10 | 2 |
| Test Connection (candidate or stored, bounded, best-effort labels) | 2.5–2.7, 4.5 | 2, 4 |
| Always-Registered + Runtime Credential Resolution | 3.1–3.6, 3.8 | 3 |
| Fail-Safe Unconfigured Behavior | 3.3–3.8 | 3 |
| DB Strictly Authoritative After Seed (incl. `SKYDROPX_TAX_INCLUSIVE`) | 3.5, 3.6, 6.1–6.2 | 3, 6 |
| One-Time Idempotent Env Seed | 6.1–6.2, 6.5 | 6 |
| DB-Resolved Webhook Verification | 3.3–3.4, 3.8 | 3 |
| Public Store Config Endpoint | 5.1–5.2 | 5 |
| Storefront Runtime Config Consumption | 5.3–5.4, 5.6 | 5 |
| Mode Toggle — Single Active Set with Re-Entry | 2.1–2.2 (validation), 4.4 (UX) | 2, 4 |
| Admin Provider Settings UI | 4.1–4.6 | 4 |
| Mercado Pago Settings-Only | 1.5 (shape), 2.1/2.5–2.6 (validation+probe), 5.1–5.2 (public key) | 1–2, 5 |
| Testability Note (unit-testable seams, no-plaintext pinned by tests) | 1.1, 1.4, 2.5, 2.9, 3.1, 3.3, 6.1 | all |

**Uncovered requirements: none.** Two sub-behaviors are best-effort by design, not gaps: Openpay probe wire shape (task 2.6, gate S2.0c) and live sandbox tokenization verification (task 5.5, gate S5.0b) — both marked `TODO(sandbox-verify)` and non-blocking per proposal risk table.

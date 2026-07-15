# Design — admin-provider-settings

> Change: `admin-provider-settings` · Store: openspec · Phase: design
> Inputs: `proposal.md` (required), `explore.md`, `openspec/config.yaml`, skills (`building-with-medusa` + `reference/custom-modules.md`, `building-admin-dashboard-customizations`, `building-storefronts`), installed `@medusajs/*` 2.15.5 source.
> Authoritative decision (orchestrator, resolves proposal OQ #1): **post-seed, the DB is STRICTLY authoritative.** Env vars are read exactly once at seed time. No runtime env fallback. Missing/corrupt DB row = provider unconfigured (fail-safe).
> Spec-owned (designed as mechanisms only): mode-toggle UX (OQ #3), masked-read display format (OQ #6).

## 0. Verified framework facts (do not re-litigate in later phases)

| # | Fact | Evidence |
|---|------|----------|
| F1 | `@medusajs/framework` exports a global `container` (`createMedusaContainer()`) | `apps/backend/node_modules/@medusajs/framework/dist/container.js:20`, `container.d.ts` |
| F2 | The app loader registers **every loaded module's service** into that global container under its module key | `apps/backend/node_modules/@medusajs/framework/dist/medusa-app-loader.js:242` — `container_1.container.register(loadedModule.__definition.key, asValue(moduleService))`; unresolved modules registered as `undefined` (`:247-248`) |
| F3 | Module keys must be camelCase; `MedusaService` auto-generates CRUD; migrations via `npx medusa db:generate <module>` + `npx medusa db:migrate` | skill `reference/custom-modules.md` |
| F4 | Providers receive `(cradle, options)` at boot; options are injected once; existing clients bake auth/baseUrl as readonly fields | `apps/backend/src/modules/openpay-payment/service.ts:151+`, `client.ts`; explore §1–2 |
| F5 | `pp_system_default` and `manual_manual` are registered unconditionally — safe boot baseline exists | explore §2 |

**Consequence of F1+F2:** a provider service reaches the settings module by lazily resolving the global container at request time (`import { container } from "@medusajs/framework"` at file top — static import, per `import-top-level`). It must NEVER resolve in its constructor (module load order is not guaranteed; unresolved keys are `undefined` per F2). This avoids passing services through provider options and avoids raw cross-module table reads.

## 1. Settings module (`providerSettings`)

First custom module with a data model in this repo — follows `reference/custom-modules.md` exactly.

```
apps/backend/src/modules/provider-settings/
├── models/provider-setting.ts
├── crypto.ts            # pure AES-256-GCM envelope functions (no framework imports)
├── service.ts           # ProviderSettingsModuleService extends MedusaService({ ProviderSetting })
├── types.ts             # credential shapes per provider, module options
└── index.ts             # Module("providerSettings", { service })
```

Module key: `PROVIDER_SETTINGS_MODULE = "providerSettings"` (camelCase — F3). Registered in `medusa-config.ts` `modules: [{ resolve: "./src/modules/provider-settings" }]`.

### 1.1 Data model

```ts
// models/provider-setting.ts
const ProviderSetting = model.define("provider_setting", {
  id: model.id().primaryKey(),
  provider: model.text().unique(),          // "openpay" | "mercadopago" | "skydropx" (constants.ts identifiers)
  mode: model.text().default("sandbox"),    // "sandbox" | "production" — single active set per provider
  is_enabled: model.boolean().default(true),// operator kill-switch without deleting credentials
  public_config: model.json().nullable(),   // NON-secret fields, servable to storefront where applicable
  encrypted_secrets: model.text().nullable(),// AES-256-GCM envelope of a JSON object of ALL secret fields
  secret_hints: model.json().nullable(),    // non-secret masking hints (e.g., last4 per field) computed AT WRITE TIME
  last_verified_at: model.dateTime().nullable(), // last successful test-connection
})
```

One row per provider (unique). `created_at/updated_at/deleted_at` are automatic — not declared.

Per-provider field split (secret → inside `encrypted_secrets`; non-secret → `public_config`):

| Provider | Secrets (encrypted) | public_config (non-secret) |
|----------|--------------------|-----------------------------|
| openpay | `privateKey`, `webhookUser`, `webhookPassword` | `merchantId`, `publicKey`, `sandbox` (derived from mode) |
| mercadopago | `accessToken`, `webhookSecret` | `publicKey`, `sandbox` |
| skydropx | `apiKey` | `baseUrl` (optional override), `originZip`, `taxInclusive` |

Notes:
- Openpay `merchantId` is treated as non-secret (already shipped to browsers via `NEXT_PUBLIC_OPENPAY_MERCHANT_ID`).
- Skydropx `public_config` is admin-facing non-secret config, **never** served by the public store endpoint (§7).
- `secret_hints` lets masked reads work without decrypting; exact display format is spec-owned (OQ #6) — the hint structure `{ field: { last4, set: true } }` supports any format the spec picks.
- Mode switch mechanism (OQ #3 spec-owned): the upsert workflow (§5) accepts `mode` and supports clearing `encrypted_secrets` on mode change; whether it clears automatically or requires re-entry is the spec's call — storage and API support both.

### 1.2 Migration

Generated, never handwritten: `npx medusa db:generate providerSettings` → `npx medusa db:migrate` (F3). This is the repo's first migration; the generated file lands under the module's `migrations/` dir and is committed.

### 1.3 Service API

`ProviderSettingsModuleService extends MedusaService({ ProviderSetting })` gets auto-CRUD (`listProviderSettings`, `updateProviderSettings`, …). Custom methods (thin — heavy logic lives in `crypto.ts` and workflow steps per `logic-module-service`):

```ts
// service.ts (module options: { ttlMs?: number } — tests pass ttlMs: 0)
getResolvedCredentials(provider): Promise<ResolvedProviderConfig | null>
  // cache-aware read → decrypt → merge public_config; null when: no row, is_enabled=false,
  // no secrets, decrypt failure (logged), or invalid KEK. NEVER throws on the read path.
invalidateCredentialCache(provider?): void   // called by upsert/delete workflow steps
```

`ResolvedProviderConfig` is the exact options shape each provider consumes today (explore §1 options mapping), so provider internals change minimally.

## 2. Encryption seam (`crypto.ts`)

- **Algorithm:** AES-256-GCM (`node:crypto`), random 12-byte IV per encryption, 16-byte auth tag.
- **KEK env var:** `PROVIDER_SETTINGS_ENCRYPTION_KEY` — the single remaining credential env var (plus `BACKEND_PUBLIC_URL`). Accepted encodings: base64 or hex decoding to exactly 32 bytes. No KDF: the KEK is used directly as the AES key (single-purpose key; rotation story = re-paste via admin, per proposal §7). Rejecting derivation keeps the seam auditable; HKDF adds nothing for one key.
- **AAD:** `"${provider}:v1"` — binds ciphertext to its provider row; a ciphertext copied to another row fails authentication. (Mode is NOT in AAD so a mode toggle that retains secrets — if the spec chooses that — doesn't invalidate them.)
- **Ciphertext envelope (string column):** `pset.v1.<iv_b64url>.<tag_b64url>.<ct_b64url>`. Version prefix enables future algorithm migration.
- **Failure semantics (fail-safe, per authoritative decision):**
  - KEK missing/undecodable/wrong length at module init → log ERROR once; `encrypt()` throws (admin save returns a clear 500-class error); `decrypt()` returns `null` → all providers resolve unconfigured. **Boot never fails.**
  - Decrypt failure (tag mismatch, corrupt envelope, wrong KEK) → `null` + rate-limited ERROR log → provider unconfigured. No env fallback, ever.
- Pure functions, zero framework imports → trivially unit-testable (strict TDD entry point, §10).

## 3. Runtime credential resolution (providers)

### 3.1 Seam

Both provider services gain a lazy credential source with an injectable seam that preserves the existing unit-test pattern (explicit options/fakes, explore §6):

```ts
// src/lib/provider-credentials.ts
import { container } from "@medusajs/framework"   // static top-level import (F1, import-top-level)
export type CredentialSource<T> = () => Promise<T | null>
export function makeDbCredentialSource<T>(provider: string): CredentialSource<T> {
  return async () => {
    const settings = container.resolve<ProviderSettingsModuleService>("providerSettings", { allowUnregistered: true } as never)
    return settings ? await settings.getResolvedCredentials(provider) as T | null : null
  }
}
```

- Resolution happens **per call, never in the constructor** (F2 ordering caveat).
- Providers accept an optional `credentialSource` via their options for tests only (options objects flow in-memory by reference through the provider loader; production `medusa-config.ts` sets no credential options at all). Default = `makeDbCredentialSource(IDENTIFIER)`.

### 3.2 Provider service changes

`openpay-payment/service.ts`:
- `validateOptions()` relaxed: empty options are valid (always-registered). Shape checks apply only to fields actually present.
- Remove boot-time `new OpenpayClient(options)`. Add:
  ```ts
  private clientCache_?: { fingerprint: string; client: OpenpayClient }
  private async getClient(): Promise<OpenpayClient>  // throws MedusaError(INVALID_DATA, "Openpay is not configured") when source → null
  ```
  Fingerprint = short hash of resolved credentials; credentials change (save/rotation) → new immutable `OpenpayClient` (client stays exactly as designed: readonly baked auth/baseUrl — we rebuild instead of mutating).
- Every payment op (`initiatePayment`, `capturePayment`, …) awaits `getClient()`. Unconfigured → MedusaError, checkout degrades to remaining providers (`pp_system_default` baseline, F5).
- **Webhook secrets:** `verifyWebhookAuth()` becomes async and reads `webhookUser/webhookPassword` from the same resolved credentials per delivery. Source → null ⇒ reject-all (current fail-safe behavior preserved; timingSafeEqual retained). Rotating the webhook password in admin takes effect on the next delivery — success criterion #6.

`skydropx-fulfillment/service.ts`: identical pattern (`getClient()`, relaxed `validateOptions`, per-call resolution). `originZip` / `taxInclusive` resolve from `public_config` (stock-location zip still wins for origin, as today); the lazy `process.env.SKYDROPX_TAX_INCLUSIVE` read is **removed** (DB strictly authoritative).

### 3.3 Caching & latency (resolves proposal OQ #2)

- Cache lives in the settings service (one place, not per provider): in-process `Map<provider, { value, expiresAt }>`.
- **Save-triggered invalidation** (workflow step calls `invalidateCredentialCache`) + **TTL backstop 30s** (module option, tests use 0).
- Hot-path cost: cache hit = memory read; miss = one unique-index single-row SELECT + one AES-GCM decrypt (~sub-ms) — measured before optimizing further, per proposal.
- Multi-instance deployments: save-invalidation is process-local, so cross-instance staleness is bounded by the 30s TTL. Documented as an accepted limitation (no Redis in this stack — explore §1); if Redis lands later, invalidation can move to an event.

## 4. Registration flip (`medusa-config.ts`)

- Openpay and Skydropx provider entries become **unconditional** — `providerEnvReady()` gating removed for them. Options: `{}` (no credentials; nothing static remains).
- Unconfigured = inert by §2/§3 fail-safe: boot succeeds, payment ops throw a typed MedusaError, quotations fail gracefully, webhooks reject-all.
- `pp_system_default` (registered unconditionally by the payment module loader) and `manual_manual` stay untouched — the safe baseline (F5).
- **Mercado Pago stays unregistered** — the module directory does not exist (S4, explore §1). Its settings are persisted/validated only (§9). The defensive MP config block remains commented/unreachable.
- `providerSettings` module added to `modules: []`.
- One consequence to name explicitly: always-registered providers appear in Medusa's payment-provider listings even when unconfigured. Storefront display is driven by the public config endpoint (§7) — unconfigured Openpay renders exactly today's degraded state (warn + card payments disabled). Region enable/disable in Medusa admin remains available to operators but is out of scope.

## 5. Admin API + workflows

Architecture: Module → Workflow → API Route; mutations only via workflows; GET/POST/DELETE only. Zod schemas + `validateAndTransformBody` in `src/api/middlewares.ts` (schemas + inferred types exported); routes use `AuthenticatedMedusaRequest<T>`.

### Routes (`src/api/admin/provider-settings/...`)

| Route | Verb | Behavior |
|-------|------|----------|
| `/admin/provider-settings` | GET | All three providers: `mode`, `is_enabled`, `public_config`, `secret_hints` (masked), `last_verified_at`, `configured` flag. **Never decrypts** — masking is server-side at the API layer via `secret_hints`; plaintext secrets never leave the service (success criterion #2). |
| `/admin/provider-settings/:provider` | GET | Single provider, same masked shape. |
| `/admin/provider-settings/:provider` | POST | Upsert via `upsertProviderSettingsWorkflow`. Body: `mode`, `is_enabled?`, non-secret fields, secret fields (optional — omitted secret = keep existing; mechanism supports spec's mode-switch choice). Returns masked read. |
| `/admin/provider-settings/:provider` | DELETE | `deleteProviderSettingsWorkflow` — clears credentials (row soft-deleted or secrets nulled), provider reverts to unconfigured/inert. |
| `/admin/provider-settings/:provider/test-connection` | POST | `testProviderConnectionWorkflow`. Body may carry candidate credentials (test-before-save) or be empty (test stored). Returns `{ ok, detail, checked_at }`. |

### Workflows (`src/workflows/`, steps in `src/workflows/steps/`)

- `upsert-provider-settings.ts` — steps: `validate-provider-payload` (business validation lives here, not in the route) → `encrypt-and-upsert-provider-setting` (encrypt via `crypto.ts`, compute `secret_hints`, upsert row; compensation restores the previous row snapshot) → `invalidate-provider-credential-cache`.
- `delete-provider-settings.ts` — clear + invalidate, with compensation.
- `test-provider-connection.ts` — steps: `resolve-probe-credentials` (candidate from input, else decrypt stored) → `run-provider-probe` (§6) → `when(ok)` → `mark-provider-verified` (sets `last_verified_at`; the only mutation, hence workflow). Composition uses `when()`/`transform()` — no conditionals/await in the composer.

## 6. Test-connection probes (`src/workflows/steps/probes/`)

Probes are read-only (or side-effect-minimal), authenticated calls with a short timeout (8s), labeled best-effort in the UI (proposal risk table). Uneven fidelity is accepted and surfaced per provider.

| Provider | Probe | Pass/fail signal |
|----------|-------|------------------|
| **Openpay** (resolves OQ #4) | `GET {base}/v1/{merchantId}/charges?limit=1` — cheapest read-only authenticated call available in the wrapped surface; the client already has bounded-retry GET infra | 200 = pass; 401/403 = bad private key; 404 = bad merchantId or wrong sandbox/production base. Wire shape carries the existing `TODO(sandbox-verify)` caveat (gates S2.0c open) |
| **Skydropx** | `POST /quotations` with `originZip` (from settings) → fixed well-known destination zip (e.g., CDMX `06600`), smallest parcel | 2xx = pass; 401 = bad apiKey; labeled best-effort (quotation success also depends on carrier availability) |
| **Mercado Pago** (settings-only) | `GET https://api.mercadopago.com/users/me` with `Bearer {accessToken}` | 200 = pass (+ compare response `live_mode` against selected mode → warn on mismatch); 401 = invalid token. No MP module required — plain fetch inside the probe step |

## 7. Public store config endpoint + storefront

### Endpoint

`GET /store/provider-config` (`src/api/store/provider-config/route.ts`, publishable-key protected like all store routes):

```jsonc
{
  "openpay":      { "merchantId": "...", "publicKey": "...", "sandbox": true } | null,
  "mercadopago":  { "publicKey": "...", "sandbox": true } | null
}
```

- Sourced from `public_config` of enabled, configured providers only. **No secret field can structurally appear** — the route reads `public_config` exclusively and never touches `encrypted_secrets`/decrypt. Skydropx is omitted entirely (nothing public to serve).
- Provider `null` when unconfigured/disabled → storefront degrades exactly as today (warn + disable card payments).

### Caching (resolves OQ #5)

- Backend: served from the same settings cache (§3.3); response header `Cache-Control: public, max-age=60`.
- Storefront: **server-side fetch with Next revalidation**, not per-render and not build-time:
  ```ts
  // apps/storefront/src/lib/data/provider-config.ts
  sdk.client.fetch("/store/provider-config", { next: { revalidate: 60, tags: ["provider-config"] } })
  ```
- Worst-case rotation propagation: ~60s (Next) + 30s (backend TTL) — vs. today's "full rebuild + redeploy". Accepted.

### Storefront consumption changes

- `openpay-wrapper.tsx` stops reading `NEXT_PUBLIC_OPENPAY_MERCHANT_ID/PUBLIC_KEY/SANDBOX` (lines 105–117): config arrives **as props** threaded from the nearest server component in the checkout payment tree (fetched via the lib function above). Missing/null config → existing degraded path (warn, disable card payments) — behavior contract unchanged.
- `NEXT_PUBLIC_OPENPAY_*` / `NEXT_PUBLIC_MP_PUBLIC_KEY` documented deprecated; removed from templates/runbook in the final slice.
- Provider IDs / `paymentInfoMap` in `constants.tsx` untouched (non-goal).

## 8. One-time env seed

- **Mechanism:** idempotent `medusa exec` script — `apps/backend/src/scripts/seed-provider-settings.ts` (`npx medusa exec ./src/scripts/seed-provider-settings.ts`). Exec scripts receive the fully-loaded container → resolve `providerSettings` and run the upsert path (same encryption code as the workflow step, via a shared pure `seedFromEnv(settingsService, env, logger)` function — unit-testable).
- A module-loader auto-seed at boot was considered and **rejected**: loaders run during module bootstrap where resolving the module's own registered service is not a verified-supported pattern in 2.15, and boot-time seeding couples boot to env parsing we're deprecating. One documented deploy command is the explicit, auditable trade.
- **Idempotence:** per provider — seed **only if no `provider_setting` row exists** for it AND its full env set is present (same required sets as today's `providerEnvReady`, explore §1; incl. `OPENPAY_PUBLIC_KEY` → `public_config`, `OPENPAY_SANDBOX` → mode). Partial env set → log WARN with the missing names, skip (never writes a partial row — addresses the partial-seed risk). Existing row → log `skipped (already configured)`. Safe to run on every deploy.
- **Logging:** one line per provider: `seeded` / `skipped-existing` / `skipped-incomplete [missing: ...]`, plus a final summary. No secret values ever logged.
- **Post-seed env contract:** only `PROVIDER_SETTINGS_ENCRYPTION_KEY` (KEK) and `BACKEND_PUBLIC_URL` remain env-based for provider concerns (plus unrelated `DATABASE_URL`/JWT/COOKIE/CORS). Provider env vars are read by nothing at runtime (strictly authoritative DB); runbook documents them deprecated with a removal window. Rollback story per proposal §10: reverting the registration-flip slice restores env-driven behavior during the window.

## 9. MP settings shape for S4

Stored today, consumed by the future MP provider module without rework:

```ts
// resolved via getResolvedCredentials("mercadopago") — matches medusa-config's planned options mapping
{ accessToken: string, webhookSecret: string, backendUrl: string /* mapped from env BACKEND_PUBLIC_URL at resolution time — NOT stored in DB */ }
// public_config: { publicKey, sandbox } — served to storefront by §7
```

S4's module will use the same `CredentialSource` seam (§3.1) — registration in `medusa-config.ts` stays credential-less from day one.

## 10. Testing strategy (strict TDD active)

Unit (per-cycle, `pnpm test:unit`, red→green→refactor; existing pattern: explicit options/fakes, mocked global fetch — explore §6):

| Seam | Tests |
|------|-------|
| `crypto.ts` | roundtrip; tamper (tag/IV/ct) → null; wrong KEK → null; AAD mismatch (provider swap) → null; envelope version/format; KEK validation (missing/short/bad encoding → disabled state, encrypt throws, decrypt null) |
| settings service | upsert encrypts + computes hints (no plaintext persisted); `getResolvedCredentials`: hit/miss/TTL-expiry/invalidation; decrypt failure → null; `is_enabled=false` → null. Cache+crypto composition isolated in pure collaborators so units don't need the ORM |
| provider services | fake `credentialSource` (null / creds / rotated creds): unconfigured → MedusaError + webhook reject-all; client rebuild on fingerprint change; existing payment-op suites reworked to async client acquisition |
| probe steps | mocked fetch per provider: pass, 401, 404, timeout; MP `live_mode` mismatch warning |
| seed function | full env → seeded; partial → skipped + warn; existing row → skipped; log assertions |

Integration:
- `setup.js`: add deterministic test KEK (`PROVIDER_SETTINGS_ENCRYPTION_KEY=<fixed 32-byte base64>`); provider credential env stays **unset** — post-flip boot with always-registered, unconfigured providers is itself the fail-safe regression test. Skydropx inert `SKYDROPX_BASE_URL` fake remains harmless and is removed with the flip slice.
- `integration-tests/http/provider-settings.spec.ts`: admin upsert → masked GET (no plaintext) → test-connection (fetch-mocked) → store `/store/provider-config` shows public fields → DELETE → store endpoint returns null.
- `integration-tests/modules`: settings service CRUD + migration against real Postgres.

## 11. Risk register updates, rollback, chained-PR forecast

Risk deltas vs proposal §7:
- Cross-module resolution risk **retired** — verified seam (F1/F2), lazy per-call resolution.
- New: global-container coupling in `src/lib/provider-credentials.ts` relies on framework-internal-but-exported behavior (F2). Mitigation: single 15-line factory, unit-faked everywhere; a framework change breaks one file.
- New: always-registered providers visible in provider listings while unconfigured (§4). Mitigation: storefront driven by config endpoint; typed error on session creation.
- Multi-instance cache staleness bounded at 30s TTL (§3.3) — documented, acceptable for credential rotation.

Chained PRs (600-line budget, `auto-chain`; seams match proposal §9 — each slice independently revertible, flip isolated as the high-risk revert point):

| # | Slice | Contents | Est. changed lines |
|---|-------|----------|--------------------|
| 1 | Persistence + crypto | module (model/service/crypto/types/index), migration, config registration, unit tests | ~550 (tests ≈ half; migration is generated bulk — flag `size:generated` if it tips the budget) |
| 2 | Workflows + admin API | 3 workflows + steps, probes, routes, middlewares/zod, http integration tests | ~550 |
| 3 | Runtime resolution + registration flip | provider service/client refactors, `provider-credentials.ts`, medusa-config flip, setup.js KEK, reworked provider units | ~450 · **highest-risk revert point, lands alone** |
| 4 | Admin UI | `src/admin/lib/client.ts`, `routes/provider-settings/page.tsx`, per-provider forms, test-connection UX | ~500 |
| 5 | Public endpoint + storefront | store route, storefront lib fetch, wrapper prop-threading, http tests | ~350 |
| 6 | Seed + deprecation | exec script + unit tests, runbook/env-template deprecation docs | ~250 |

Rollback per slice: 1–2 are additive (revert = drop unused module/routes; migration reverts via generated down); 3 reverts to env-gated boot (env vars still present during window); 4–5 are UI/consumption-only; 6 is docs+script. KEK stays env-based throughout, so infra rollback never orphans secret handling (proposal §10).

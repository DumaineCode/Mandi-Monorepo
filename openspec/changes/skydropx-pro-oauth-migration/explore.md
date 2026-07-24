# Exploration — skydropx-pro-oauth-migration

## Goal (restated)
Migrate the `skydropx-fulfillment` module off the deprecated **Skydropx legacy v1 REST API** (API-Key / `Authorization: Token token={key}`, base `https://api.skydropx.com/v1`) to **Skydropx PRO** (OAuth2 client-credentials: Client ID + Client Secret → bearer token, at `pro.skydropx.com`, new quotation/label endpoints). This also closes long-deferred gate **S5.0b**. **Scope of this doc: map current state only — no solution design.**

---

## 1. Current Skydropx implementation

### `apps/backend/src/modules/skydropx-fulfillment/client.ts`
Thin native-`fetch` client. Key facts:
- `DEFAULT_BASE_URL = "https://api.skydropx.com/v1"` (legacy v1).
- Auth is hard-coded legacy: `this.authHeader = ` + "`Token token=${options.apiKey}`" + `. **Single-key contract.**
- `ClientOptions = Pick<SkydropxCredentials, "apiKey" | "baseUrl">`.
- Timeouts: `SKYDROPX_QUOTATION_TIMEOUT_MS = 8_000` (checkout), `SKYDROPX_REQUEST_TIMEOUT_MS = 15_000` (admin), via `AbortController`.
- Endpoints (all legacy paths): `POST /quotations`, `POST /shipments`, `POST /labels`, `GET /labels/{id}`, `POST /labels/{id}/cancel` (cancel path carries a `TODO(sandbox-verify)`).
- Non-2xx → typed `SkydropxApiError`; timeout → `SkydropxApiError(0, "timeout", ...)`.
- **Design intent already documented in-file:** "a migration to the Pro/OAuth generation only touches this file (design R3)." This is the primary migration seam.

### `apps/backend/src/modules/skydropx-fulfillment/service.ts`
`SkydropxFulfillmentProviderService extends AbstractFulfillmentProviderService`, `static identifier = SKYDROPX_IDENTIFIER` (`"skydropx"`).
- Credentials resolved lazily per-operation via `makeDbCredentialSource<SkydropxCredentials>(SKYDROPX_IDENTIFIER)` (container never touched at construction).
- Client cache keyed by `credentialFingerprint(config)` — rotation rebuilds client.
- `toParcelItems` — **the R10 seam** (only place cart/order line items → parcel inputs; S5.0a fallback isolated here).
- `selectCheapestRate` — deterministic: cheapest `total_pricing`, then fewest `days`, then carrier name alpha. Shared by quote + label.
- `calculatePrice`: builds `{ zip_from, zip_to, parcel }`, calls `client.createQuotation`; returns `calculated_amount: Number(rate.total_pricing)` (as-is MXN, never cent-converted) and `is_calculated_price_tax_inclusive: config.taxInclusive ?? true` (**default true, pinned pending S5.0b IVA verification**).
- `createFulfillment`: `createShipment` → `selectCheapestRate` → `createLabel` → bounded `IN_PROGRESS` polling (`LABEL_POLL_BOUND_MS = 30_000`, `LABEL_POLL_INTERVAL_MS = 2_000`) → tracking data + `labels[]`. Logs quote-vs-label rate delta.
- Failure modes: quote → graceful `MedusaError` (checkout degrades to manual, SD-3); label → `MedusaError.UNEXPECTED_STATE` + best-effort `abandonLabel_` (SD-4); `cancelFulfillment` log-and-proceed.
- `validateOptions`: EMPTY options valid (DB-resolved); present-but-malformed `apiKey` still throws. **← references `apiKey` by name.**

### `apps/backend/src/modules/skydropx-fulfillment/types.ts` — enumerated `TODO(sandbox-verify)` markers
1. File header — API generation pinned legacy; **"If the account turns out to be Pro/OAuth, only client.ts changes (design R3)."**
2. `SkydropxCredentials.taxInclusive` — default pinned pending S5.0b IVA.
3. `SkydropxQuotationRequest` / quotation request+response shapes — field names unverified.
4. `SkydropxRate` — `id`, `provider`, `total_pricing` (string vs number), `days`; and whether `total_pricing` is IVA-inclusive.
5. `SkydropxQuotationResponse` — bare array vs envelope.
6. `SkydropxAddress` — shipment address field names.
7. `SkydropxShipment` — shipment envelope + embedded rates shape.
8. `SkydropxLabel` — status values + tracking field names.
9. `SkydropxErrorBody` — error body shape.

Current `SkydropxCredentials` interface: `{ apiKey: string; baseUrl?: string; originZip?: string; taxInclusive?: boolean }`.

### `apps/backend/src/modules/skydropx-fulfillment/index.ts`
`ModuleProvider(Modules.FULFILLMENT, { services: [SkydropxFulfillmentProviderService] })`. Registered from `medusa-config.ts` with id `"skydropx"` → runtime provider id `skydropx_skydropx`.

### `apps/backend/src/modules/skydropx-fulfillment/parcel.ts`
Pure `buildParcel` (grams/cm → kg/cm). Unaffected by auth migration; wire shapes of the parcel object may still need PRO verification.

### `apps/backend/src/workflows/steps/probes/skydropx.ts` (health/test-connection probe)
- `DEFAULT_BASE_URL = "https://api.skydropx.com/v1"`, `PROBE_DESTINATION_ZIP = "06600"`.
- `isAllowedSkydropxBaseUrl` — SSRF guard: only `https` on `skydropx.com` / `*.skydropx.com` (**PRO host `pro.skydropx.com` matches this allowlist; a token endpoint on a different host would not**).
- Sends `Authorization: Token token=${creds.apiKey}` to `${base}/quotations`. **← legacy auth, needs OAuth rework.**
- `SkydropxProbeCredentials = { apiKey; originZip; baseUrl? }`.
- Duplicated `TODO(sandbox-verify)` on wire shape (S5.0b).

### `__tests__/service.unit.spec.ts` (what the specs lock in)
Hermetic, mocked `fetch`. Pins:
- Identifier `"skydropx"`; single option `{ id: "skydropx-standard", name: "Envío estándar" }`.
- Quotation URL asserted literally: `https://api.skydropx.com/v1/quotations`; body `{ zip_from, zip_to, parcel }`.
- Auth header asserted literally: `Token token=${API_KEY}` and rotation to `Token token=sk_rotated`. **← these assertions will break under OAuth bearer; must be rewritten.**
- `calculated_amount` as-is; `is_calculated_price_tax_inclusive` default `true`, honors DB `taxInclusive:false`, **NEVER reads `SKYDROPX_TAX_INCLUSIVE` env**.
- Cheapest-rate + tie-breaks; missing-dims / zero-rates / API-error / 8s-timeout → graceful MedusaError.
- Shipment→label flow, IN_PROGRESS polling bound, orphaned-label cancel, unconfigured fail-safe, `validateOptions` empty-ok / present-empty-apiKey-throws.
- `config = { apiKey, originZip }` fixture throughout. **← every fixture uses `apiKey`.**

---

## 2. Credential resolution path (how skydropx creds flow today)

Flow: **DB (`provider_setting` row, encrypted) → `providerSettings.getResolvedCredentials("skydropx")` → `makeDbCredentialSource` seam → provider service (per-operation, cached by fingerprint)**.

- **`provider-settings/types.ts`** — `SkydropxResolvedConfig = { apiKey: string; baseUrl: string; originZip: string; taxInclusive?: boolean }`. Doc table: secrets = `apiKey`; public_config = `baseUrl (optional), originZip, taxInclusive`. **`SKYDROPX_DEFAULT_BASE_URL = "https://api.skydropx.com/v1"`.**
- **`provider-settings/service.ts`** — `mergeResolvedConfig`: `if (provider === "skydropx" && merged.baseUrl === undefined) merged.baseUrl = SKYDROPX_DEFAULT_BASE_URL`. Read path fail-safe (null on no-row/disabled/no-secrets/decrypt-fail), cache-aware.
- **`scripts/seed-provider-settings.core.ts`** — skydropx mapping: `requiredEnv: ["SKYDROPX_API_KEY", "SKYDROPX_ORIGIN_ZIP"]`; `secretEnv: { apiKey: "SKYDROPX_API_KEY" }`; `publicEnv: { originZip, baseUrl: "SKYDROPX_BASE_URL", taxInclusive: "SKYDROPX_TAX_INCLUSIVE" }`; `mode: () => "sandbox"`; `taxInclusive` coerce `raw !== "false"`.
- **Write-path validation** — `workflows/steps/validate-provider-payload.ts`:
  - `skydropxUpsertSchema = baseSchema.extend({ originZip: min(1), baseUrl: url().optional(), taxInclusive: boolean().optional(), apiKey: min(1).optional() })`.
  - `PROVIDER_SECRET_FIELDS.skydropx = ["apiKey"]`; `PROVIDER_PUBLIC_FIELDS.skydropx = ["baseUrl","originZip","taxInclusive"]`.
- **Admin API middlewares** — `api/admin/provider-settings/middlewares.ts`: union zod schema with `apiKey`, `originZip`, `baseUrl: url().optional()`, `taxInclusive`.
- **Admin form** — `admin/routes/provider-settings/form-model.ts`: `PROVIDER_FORMS.skydropx.fields = [originZip(text), baseUrl(text,optional), taxInclusive(boolean), apiKey(password,secret)]`. `KNOWN_PROVIDERS` includes `skydropx`.
- **Store public-config** — `api/store/provider-config/*`: **Skydropx intentionally omitted** (`PUBLIC_PROVIDERS = ["openpay","mercadopago"]`); a unit test pins skydropx is never in the output. No storefront change expected from this migration.
- **Probe credential resolution** — `workflows/steps/resolve-probe-credentials.ts`: `PROBE_REQUIRED_FIELDS.skydropx = ["apiKey","originZip"]`; SSRF guard on baseUrl.

### Credential schema migration impact: `apiKey` → `clientId` + `clientSecret`
PRO replaces the single `apiKey` secret with **two secrets** (`clientId`, `clientSecret`). Every `apiKey`-named touchpoint below is impacted:

| Layer | File | Current | Impact |
|---|---|---|---|
| Client auth | `skydropx-fulfillment/client.ts` | `Token token=${apiKey}` | OAuth token fetch + `Authorization: Bearer` |
| Provider creds type | `skydropx-fulfillment/types.ts` `SkydropxCredentials` | `apiKey` | `clientId`+`clientSecret` (+ maybe token endpoint/base) |
| Resolved config | `provider-settings/types.ts` `SkydropxResolvedConfig` | `apiKey` | two-secret shape; `SKYDROPX_DEFAULT_BASE_URL` → PRO |
| Merge default | `provider-settings/service.ts` | legacy baseUrl default | PRO base default |
| Seed mapping | `seed-provider-settings.core.ts` | `SKYDROPX_API_KEY` | new `SKYDROPX_CLIENT_ID` / `SKYDROPX_CLIENT_SECRET` env(s) |
| Write validation | `validate-provider-payload.ts` | `PROVIDER_SECRET_FIELDS.skydropx=["apiKey"]` | `["clientId","clientSecret"]` + schema |
| Admin API schema | `api/admin/.../middlewares.ts` | `apiKey` | add `clientId`/`clientSecret` |
| Admin form | `form-model.ts` `PROVIDER_FORMS.skydropx` | `apiKey` field | two secret fields |
| Probe | `probes/skydropx.ts` + `resolve-probe-credentials.ts` | `apiKey` header + required | OAuth probe + `["clientId","clientSecret"]` |
| `validateOptions` | `skydropx-fulfillment/service.ts` | checks `apiKey` | update option-name guard |
| Tests | `service.unit.spec.ts` + provider-settings/probe specs | `apiKey` fixtures + literal `Token token=` + literal v1 URLs | rewrite auth/URL assertions, two-secret fixtures |

**Masking note:** `SecretHint.last4` computed at write-time only when plaintext ≥ 8 chars — `clientSecret` fine; `clientId` may be short → fully masked (behavior already handled generically).

---

## 3. Registration — `apps/backend/medusa-config.ts`
Fulfillment module providers: `@medusajs/medusa/fulfillment-manual` (id `manual`, the SD-3 graceful-degradation path — **must stay**) and `./src/modules/skydropx-fulfillment` (id `skydropx`, empty options, always registered, DB-resolved). No auth-model change needed here; registration flip is orthogonal. Rollback lever documented in runbook §7.3.

---

## 4. Deferred gates (runbook `docs/runbooks/mx-payments-shipping.md` §5) touched by this change
- **S5.0a** — Variant weight/dims presence in the 2.15.5 `calculatePrice` context. Fallback = explicit variant query inside the provider, isolated in the `toParcelItems` seam. *Touched only incidentally* (seam unchanged by auth migration, but live PRO quote in S5.5 will exercise it).
- **S5.0b** — **Primary gate this change resolves.** Skydropx API generation (**legacy Token vs Pro OAuth**) + whether `total_pricing` includes IVA (`is_calculated_price_tax_inclusive` default / `SKYDROPX_TAX_INCLUSIVE`). Deliverable: remove `TODO(sandbox-verify)` markers in `types.ts`.
- **S5.5** — Live sandbox quote at checkout + admin label purchase with tracking visible; missing-dims degrades to manual. This migration is a precondition for closing S5.5 against PRO.
- Deprecated env vars (§1a / §7.1): `SKYDROPX_API_KEY`, `SKYDROPX_BASE_URL`, `SKYDROPX_ORIGIN_ZIP`, `SKYDROPX_TAX_INCLUSIVE` — seed-only, DB strictly authoritative at runtime. Runbook prose + env template + log-signals table (`Skydropx quotation failed`, `Skydropx label abandoned`) reference the legacy model and will need updates.

---

## 5. External — Skydropx PRO API (documented vs needs-verification)
References: https://pro.skydropx.com/es-MX/api-docs , https://docs.skydropx.com/

**Documented / expected (PRO):**
- Auth: **OAuth2 client-credentials** — POST Client ID + Client Secret to a **token endpoint** (commonly `POST /api/v1/oauth/token` with `grant_type=client_credentials`) → short-lived **bearer** access token. Host `pro.skydropx.com`.
- New **quotations** endpoint (PRO shipments/quotations model), **shipments/labels** endpoint, **tracking**.

**Needs PRO sandbox verification (open — could NOT be confirmed from code; external docs not fetched here):**
- Exact token endpoint path, base URL, token TTL, whether token is cacheable/refreshable, scopes.
- Exact PRO quotation request/response JSON (field names, `rates` envelope vs array, `total_pricing` type, `days`, currency).
- Whether PRO `total_pricing` is **IVA-inclusive** (S5.0b).
- PRO shipment/label creation shape, label status enum + polling model, tracking fields.
- PRO error body shape + auth-failure status codes (401 vs 403 vs token-expired).
- Cancel endpoint (label vs shipment) under PRO.
- Whether the token endpoint host stays under `*.skydropx.com` (SSRF allowlist compatibility).

---

## Risk hotspots
- **R-A (test churn):** unit specs assert legacy auth header and literal v1 URLs — high-volume rewrite; risk of losing behavioral coverage during migration.
- **R-B (two-secret propagation):** `apiKey` is referenced across ~10 files/layers; a missed touchpoint = silent unconfigured/fail-safe (no loud error, since resolution is fail-safe-null).
- **R-C (token lifecycle):** OAuth adds a token-fetch round-trip inside the 8s checkout budget; caching/expiry handling is new surface not present in the current single-header client.
- **R-D (SSRF allowlist):** `isAllowedSkydropxBaseUrl` only allows `*.skydropx.com` https — verify PRO token + API hosts comply; a token endpoint elsewhere would be refused.
- **R-E (IVA correctness):** `is_calculated_price_tax_inclusive` default `true` is a guess (S5.0b); wrong value = double-tax or under-tax at checkout.
- **R-F (unverified wire shapes):** 9 `TODO(sandbox-verify)` shapes; PRO field renames could break quote/label parsing at runtime, not compile time.
- **R-G (existing DB row migration):** existing DB rows hold legacy `apiKey`; migrating to two-secret rows needs a re-seed/admin re-entry story (out of scope here, flag for proposal).

## Affected files (map)
- `apps/backend/src/modules/skydropx-fulfillment/client.ts` (auth + base URL + token flow) — **primary**
- `apps/backend/src/modules/skydropx-fulfillment/types.ts` (`SkydropxCredentials`, wire shapes, TODO markers)
- `apps/backend/src/modules/skydropx-fulfillment/service.ts` (`validateOptions` apiKey guard, IVA default)
- `apps/backend/src/modules/skydropx-fulfillment/__tests__/service.unit.spec.ts` (auth/URL/fixtures)
- `apps/backend/src/workflows/steps/probes/skydropx.ts` (probe auth + base)
- `apps/backend/src/workflows/steps/probes/index.ts` (skydropx probe cred mapping)
- `apps/backend/src/workflows/steps/resolve-probe-credentials.ts` (`PROBE_REQUIRED_FIELDS.skydropx`)
- `apps/backend/src/workflows/steps/validate-provider-payload.ts` (schema, `PROVIDER_SECRET_FIELDS`/`PUBLIC_FIELDS`)
- `apps/backend/src/modules/provider-settings/types.ts` (`SkydropxResolvedConfig`, `SKYDROPX_DEFAULT_BASE_URL`)
- `apps/backend/src/modules/provider-settings/service.ts` (`mergeResolvedConfig` skydropx branch)
- `apps/backend/src/scripts/seed-provider-settings.core.ts` (env mapping)
- `apps/backend/src/api/admin/provider-settings/middlewares.ts` (validation union)
- `apps/backend/src/admin/routes/provider-settings/form-model.ts` (`PROVIDER_FORMS.skydropx`)
- `apps/backend/medusa-config.ts` (no auth change; registration context only)
- `docs/runbooks/mx-payments-shipping.md` (§1a env, §5 gates, §7 signals) + backend `.env.template`
- Related test specs: `provider-settings/__tests__/service.unit.spec.ts`, `steps/__tests__/validate-provider-payload.unit.spec.ts`, `steps/__tests__/resolve-probe-credentials.unit.spec.ts`, `steps/probes/__tests__/probes.unit.spec.ts`, `admin/routes/provider-settings/__tests__/form-model.unit.spec.ts`
- **Not affected:** `parcel.ts` logic, store `provider-config` (skydropx omitted), storefront.

## Open questions for proposal/design phase
1. PRO token endpoint path/host/TTL and token-caching strategy within the 8s checkout budget?
2. Confirm PRO quotation/shipment/label wire shapes + `total_pricing` IVA inclusion (S5.0b)?
3. Migration story for existing DB `apiKey` rows → `clientId`/`clientSecret` (re-seed vs admin re-entry)?
4. Keep single migration seam in `client.ts` (design R3 promise) or does OAuth force wider changes?
5. SSRF allowlist: are PRO token + API hosts under `*.skydropx.com`?
6. Do we keep legacy support behind a flag during cutover, or hard-swap?

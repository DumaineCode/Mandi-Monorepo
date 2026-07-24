# Design — skydropx-pro-oauth-migration

Status: design decides open questions with recommendations (user-delegated).
Scope: `apps/backend/src` — fulfillment provider internals + credential layers. No new
API routes, module links, or data models (see §11).

## 0. Design intent

Honor the in-file R3 promise ("a migration to Pro/OAuth only touches client.ts") **as far
as the wire protocol allows**, and treat every unavoidable spill into `service.ts` as an
explicit, isolated seam:

1. `client.ts` absorbs 100% of the auth/token/URL/endpoint change.
2. `service.ts` changes are confined to three named seams: **address sourcing** (`toAddress`),
   **IVA pin** (already isolated in `calculatePrice`), and the **`validateOptions` guard**.
3. Rate-shape field renames (`total_pricing`→`total`, `provider`→`provider_name`) touch
   `selectCheapestRate` and `calculatePrice`; these are type-driven and caught at compile time.

The async quotation model is the one place the seam widens: polling is control flow that
belongs in the client (loop + deadline) with the service only supplying the shared budget.

---

## 1. Decisions table

| # | Question | Decision | Rationale | Sandbox-verify? |
|---|----------|----------|-----------|-----------------|
| D1 | Exact host + how to represent it | `SKYDROPX_DEFAULT_BASE_URL = "https://api-pro.skydropx.com/api/v1"`. Token URL derived as `${baseUrl}/oauth/token`; all paths joined against baseUrl (`/quotations`, `/shipments`, …). | Doc note pins `api-pro.skydropx.com` as the correct host; putting `/api/v1` in the base keeps client path-joining identical to today (single seam). Same host for token + API → no second host config. SSRF allowlist `host.endsWith(".skydropx.com")` matches `api-pro.skydropx.com` — verified in code, allowlist unchanged. | **Yes** — confirm `api-pro` vs `pro` host and that token+API share it. Fallback flip is a one-line default. |
| D2 | `consignment_note` + `package_type` sourcing | Provider-level configurable default in `public_config` (`consignmentNote`, `packageType`), surfaced as admin settings fields. Optional per-product `metadata` override is a **later** enhancement (out of first slice). MX label with neither → **fail loud (SD-4)**. | Minimal viable source that gives domestic-MX label parity today without a product-schema change. A wrong SAT code is worse than a loud failure. | **Yes** — valid SAT `consignment_note` code(s) + accepted `package_type` enum for the store's goods. |
| D3 | Address sourcing at `calculatePrice` | New `toAddress` seam in `service.ts`. `country_code = shipping_address.country_code` (upper), `postal_code`, `area_level1 = normalizeState(province)`, `area_level2 = city`, `area_level3 = shipping_address.address_2 \|\| metadata.colonia \|\| undefined` (best-effort colonia sourcing). `area_level1` + `area_level2` are **required**; `area_level3` is **included when the cart provides it**. If PRO *requires* `area_level3` and the cart cannot supply it → **degrade to manual (SD-3)**, satisfying spec Capability 4's degrade scenario. | Reconciles with spec Capability 4 (the hierarchy must be *present when available*, not silently dropped). Medusa 2.15.5 cart `shipping_address` exposes `province`/`city`/`postal_code`/`country_code`/`address_2`/`metadata`; colonia has no first-class field, so it is sourced best-effort from `address_2`/metadata. `province` is often an ISO/abbrev code (e.g. `NL`) while PRO expects the full state name (`Nuevo León`) → `normalizeState` maps known MX subdivision codes to names (pass-through if already a name). | **Yes (S5.0a)** — confirm (a) whether PRO mandates `area_level3`, (b) `province` code-vs-name acceptance, (c) `address_2`/metadata is a viable colonia source; if PRO mandates colonia and no source exists, a postal-code→colonia lookup is the follow-up, still inside `toAddress`. |
| D4 | Label endpoint | **Two-step** `POST /shipments` with a `rate_id` from a **fresh quotation created at fulfillment time** (not a stored checkout rate). | Preserves the deterministic `selectCheapestRate` behavior (needs a multi-rate list), matches today's "re-quote at label time" shape (`createShipment→select→createLabel`), reuses the `createQuotation`+poll seam. `/rate/shipments` one-shot would drop cross-carrier cheapest selection. Rates are only valid 24h, so a stored checkout rate would go stale anyway. Tradeoff: one extra quote call on the admin (15s) path. | No (behavioral); **Yes** — confirm `GET /shipments/{id}` poll path + `workflow_status` enum. |
| D5 | `requires_origin_verification` | **Fail loud (SD-4)**: detect the flag on the selected rate before `POST /shipments`; throw `MedusaError.UNEXPECTED_STATE` with an admin-actionable message + runbook §7 note. No auto-verify. | Origin verification is a carrier-side, per-carrier one-time action outside checkout/label scope. A clear error + runbook is safer and cheaper than an auto-verify flow. Tradeoff: operator does a one-time manual verify per carrier. | No (behavioral). |
| D6 | Token cache strategy | Per-credential-fingerprint in-process token cache **inside `SkydropxClient`**, layered on the existing service-level `clientCache_` (fingerprint-keyed). Token held with `expiresAt`; refresh on expiry (60s skew) and **on 401 (clear + one retry)**. 2h TTL. | The service instance is long-lived and already caches the client by fingerprint, so the token survives across operations until rotation or expiry. Warm checkout pays **zero** token cost inside the 8s budget. Rotation rebuilds the client → drops the token naturally. | No (design); TTL from reference (`expires_in: 7200`). |

---

## 2. D1 — Host & URL representation (detail)

- `provider-settings/types.ts`: `SKYDROPX_DEFAULT_BASE_URL = "https://api-pro.skydropx.com/api/v1"`.
- `provider-settings/service.ts` `mergeResolvedConfig`: skydropx branch defaults `baseUrl` to the
  new PRO base when undefined (same shape as today, new value).
- `client.ts`: `baseUrl` strips trailing slash (unchanged); token endpoint = `${baseUrl}/oauth/token`.
- SSRF: `isAllowedSkydropxBaseUrl` **is NOT sufficient as-is** — today it is enforced ONLY in
  `probes/skydropx.ts` + `resolve-probe-credentials.ts`. The write path is `baseUrl:
  z.string().url().optional()` (shape-only, no host allowlist) and neither the client nor the
  upsert re-checks the host. Because the migration now POSTs `clientId`+`clientSecret` to
  `${baseUrl}/oauth/token` on every cold checkout, an admin-stored non-`skydropx.com` `baseUrl`
  would exfiltrate BOTH secrets to an arbitrary host. **Fix (required):** enforce
  `isAllowedSkydropxBaseUrl` (1) in the `skydropxUpsertSchema` refinement in
  `validate-provider-payload.ts` (reject on save) AND (2) defensively in the `SkydropxClient`
  constructor (throw before any request). `api-pro.skydropx.com`.endsWith(`.skydropx.com`) ⇒
  `true`, so the pinned host passes; do **not** widen the allowlist. Add specs: PRO host passes,
  non-skydropx host is rejected at save and refused by the client.
- Sandbox action: confirm host, then keep or flip the one-line default.

---

## 3. `client.ts` — internal structure

Single migration seam. Native `fetch` only. New responsibilities: token acquisition, token
reuse, refresh-on-401, PRO endpoints, quotation polling helper.

```
DEFAULT_BASE_URL = "https://api-pro.skydropx.com/api/v1"
SKYDROPX_QUOTATION_TIMEOUT_MS = 8_000    // checkout overall deadline
SKYDROPX_REQUEST_TIMEOUT_MS   = 15_000   // admin per-request
SKYDROPX_TOKEN_TIMEOUT_MS     = 3_000    // token sub-bound (capped by remaining budget)
TOKEN_EXPIRY_SKEW_MS          = 60_000
QUOTE_POLL_INTERVAL_MS        = 1_000    // ≤ 1 req/s < 2 req/s cap

class SkydropxClient {
  private baseUrl
  private clientId, clientSecret
  private token_?: { accessToken: string; expiresAt: number }   // in-process token cache (D6)
  private tokenInFlight_?: Promise<string>                       // single-flight guard (W4)

  constructor({ clientId, clientSecret, baseUrl })
    // defensive SSRF (W3): throw INVALID_DATA if !isAllowedSkydropxBaseUrl(baseUrl)

  // ── auth ──────────────────────────────────────────────
  private async getToken_(deadline?): Promise<string>
    // return cached token if now < expiresAt - SKEW
    // SINGLE-FLIGHT (W4): await tokenInFlight_ if present; else set it, await, clear it
    //   (prevents concurrent cold checkouts from stampeding /oauth/token; 2 req/s safety)
    // POST /oauth/token, Content-Type: application/json (form fallback if a sandbox 400s)
    //   body: grant_type=client_credentials, client_id, client_secret
    // set token_ = { accessToken, expiresAt: now + expires_in*1000 }
    // sub-bounded by min(SKYDROPX_TOKEN_TIMEOUT_MS, remaining budget); NEVER log token/secret

  private async authed_<T>(method, path, body?, timeoutMs?, deadline?): Promise<T>
    // 1. token = await getToken_(deadline)
    // 2. fetch with Authorization: Bearer ${token}
    // 3. on 401 once: token_ = undefined; token = getToken_(); retry
    // 4. non-2xx → SkydropxApiError(status, code, msg) where code=body.error,
    //      msg=body.error_description || JSON(body.errors) (uniform PRO error shape, I2);
    //    abort → SkydropxApiError(0,"timeout")

  // ── PRO endpoints ─────────────────────────────────────
  createQuotation(body, deadline)  // POST /quotations   → SkydropxQuotation (may be incomplete)
  getQuotation(id, deadline)       // GET  /quotations/{id}
  async quoteAndPoll_(body, deadline): SkydropxRate[]
    // POST, then loop getQuotation; before each sleep re-check deadline and
    //   sleep_(min(QUOTE_POLL_INTERVAL_MS, remaining)) so total elapsed ≤ budget + ≤1 interval (I1)
    // until is_completed && rates.length, or now >= deadline → SkydropxApiError(0,"timeout")

  createShipment(body)             // POST /shipments (202)  admin 15s
  getShipment(id)                  // GET  /shipments/{id}   poll workflow_status;
                                   //   fast-fail if error_detail present (don't burn the 30s bound)
  cancelShipment(shipmentId, reason) // POST /shipments/{id}/cancellations
}
```

`quoteAndPoll_` centralizes the async model so `service.ts` only passes a deadline. The
service's `fetchRates_` wrapper (error→MedusaError translation, SD-3) stays and now wraps
`quoteAndPoll_`.

---

## 4. `service.ts` — the three seams

1. **Address sourcing (`toAddress`)** — new pure helper mirroring `toParcelItems`, used by BOTH
   `calculatePrice` (from cart `shipping_address`) and `createFulfillment` (from
   `order.shipping_address`):
   ```
   const toAddress = (a) => ({
     country_code: a.country_code?.toUpperCase(),
     postal_code:  a.postal_code,
     area_level1:  normalizeState(a.province) || undefined,   // code→name (W5)
     area_level2:  a.city || undefined,
     area_level3:  a.address_2 || a.metadata?.colonia || undefined,  // best-effort colonia (C1)
   })
   ```
   `normalizeState` maps known MX ISO-3166-2 subdivision codes (e.g. `NL`→`Nuevo León`) to the
   full state name PRO expects; pass-through if already a name.
   `calculatePrice` context read expands from `{ postal_code }` to
   `{ postal_code, province, city, country_code, address_2, metadata }`. Origin uses
   `from_location.address` fields (or `originZip` fallback for the zip).
   **area_level1 + area_level2 are required; area_level3 is included when the cart supplies it.**
   Missing destination postal_code / area_level1 / area_level2 / origin zip → graceful
   `MedusaError` **before** any API call (SD-3). If sandbox (S5.0a) shows PRO *mandates*
   `area_level3` and no cart source exists → also degrade to manual (spec Capability 4 scenario).

   For `createFulfillment`, the PRO **ship** address (`SkydropxShipAddress`, §5) is `street1`-based
   (name/company/phone/email/reference/tax_id); `toAddress` supplies the quote-shape address for
   the fresh label-time quotation, and a separate `toShipAddress(order.shipping_address)` maps the
   contact/street fields for `POST /shipments`.

2. **IVA pin** — already isolated:
   `is_calculated_price_tax_inclusive: config.taxInclusive ?? true` (now **resolved**, not a
   guess — reference confirms `rate.total` is IVA-inclusive), `calculated_amount = Number(rate.total)`.
   Remove the `TODO(sandbox-verify)` comment. Re-confirm `vat_fee` reconciles live before
   closing S5.0b.

3. **`validateOptions` guard** — swap the `apiKey` presence guard for `clientId`/`clientSecret`:
   empty options still valid (DB-resolved); a present-but-empty `clientId` **or** `clientSecret`
   throws `INVALID_DATA`.

Rate-shape follow-through (compile-time):
- **Usable-rate filter (before selection):** keep only rates where `success === true` AND
  `Number.isFinite(Number(r.total))` AND `r.status` is not a non-priced state
  (`no_coverage`/`tariff_price_not_found`/`not_applicable`/`pending`). PRO fills rates
  progressively and returns unpriced rates, so an unfiltered sort could produce `NaN` and
  emit `calculated_amount: NaN` to checkout. If the filtered list is empty → graceful
  `MedusaError` → manual (SD-3), satisfying spec Capability 3 "zero usable rates".
- `selectCheapestRate`: on the filtered list, sort by `Number(a.total)`, then `days`, then `provider_name`.
- `calculatePrice`: `Number(rate.total)`.

**Origin address (`address_from`).** Origin also needs the hierarchy: apply the same
`toAddress`/`normalizeState` to `from_location.address` (state/city), `originZip` fallback for
the zip. Pre-flight guard rejects (→ manual, SD-3) when origin state/city (not just zip) are
absent, so a misconfigured stock location fails pre-flight rather than 422-ing at the API.

`createFulfillment` (admin, 15s path):
```
fresh quotation → quoteAndPoll_ → selectCheapestRate
  ↓ guard: rate.requires_origin_verification === true → MedusaError.UNEXPECTED_STATE (D5, SD-4)
  ↓ resolve consignment_note/package_type: product override ?? config default; MX + absent → fail loud (D2, SD-4)
  ↓ createShipment({ shipment: { rate_id, address_from, address_to, packages:[{...consignment_note, package_type}] } })
  ↓ poll getShipment until workflow_status === "success" (bounded, existing LABEL_POLL_*)
  ↓ read included[0].attributes.{tracking_number,label_url}; master_tracking_number fallback
```
`abandonLabel_`/`cancelFulfillment` call `cancelShipment(shipment_id, reason)` (label→shipment
cancel). `data.shipment_id` becomes the cancellation key; `label_id` retained if present.

---

## 5. Data / type shapes (`types.ts`, remove ALL `TODO(sandbox-verify)`)

```ts
export interface SkydropxCredentials {
  clientId: string
  clientSecret: string
  baseUrl?: string          // default https://api-pro.skydropx.com/api/v1
  originZip?: string
  taxInclusive?: boolean     // default true (S5.0b resolved)
  consignmentNote?: string   // MX Carta Porte SAT code default (D2)
  packageType?: string       // MX package_type default (D2)
}

interface SkydropxTokenResponse {
  access_token: string; token_type: "Bearer"; expires_in: number
  scope?: string; created_at?: number
}

// Quotation
interface SkydropxQuoteAddress {
  country_code: string; postal_code: string
  area_level1?: string; area_level2?: string; area_level3?: string
  tax_id_number?: string
}
interface SkydropxParcel {
  length: number; width: number; height: number; weight: number
  package_protected?: boolean; declared_value?: number
}
interface SkydropxQuotationRequest {
  quotation: {
    address_from: SkydropxQuoteAddress
    address_to: SkydropxQuoteAddress
    parcels: SkydropxParcel[]
    requested_carriers?: string[]
  }
}
interface SkydropxRate {
  id: string; success?: boolean; status?: string
  provider_name: string; provider_service_name?: string; provider_service_code?: string
  currency_code?: string
  amount: string          // NO IVA
  total: string           // IVA-inclusive ← used
  vat_fee?: string | null
  days?: number; service_fee?: number | null
  requires_origin_verification?: boolean
  shipment_creation_type?: "single" | "multipackage" | "multishipment"
}
interface SkydropxQuotation { id: string; is_completed: boolean; rates?: SkydropxRate[] }

// Shipment / label
interface SkydropxShipAddress {
  street1: string; name?: string; company?: string; phone?: string
  email?: string; reference?: string; tax_id_number?: string
}
interface SkydropxShipPackage {
  package_number: string; package_protected?: boolean; declared_value?: number
  consignment_note: string; package_type: string
}
interface SkydropxCreateShipmentRequest {
  shipment: {
    rate_id: string
    address_from: SkydropxShipAddress
    address_to: SkydropxShipAddress
    packages: SkydropxShipPackage[]
  }
}
interface SkydropxShipment {
  id: string; workflow_status?: "pending" | "success"
  master_tracking_number?: string; label_url?: string
  included?: { attributes?: { tracking_number?: string; label_url?: string; tracking_status?: string } }[]
  error_detail?: { error_code?: string; error_message?: string; error_message_detail?: string }
}
interface SkydropxCancellation { id: string; reason?: string; status?: string; success?: boolean }

interface SkydropxErrorBody {   // uniform PRO errors
  error?: string; error_description?: string
  errors?: Record<string, string[]>
}
```

`provider-settings/types.ts` `SkydropxResolvedConfig` mirrors `SkydropxCredentials`
(`clientId`, `clientSecret`, `baseUrl`, `originZip`, `taxInclusive`, `consignmentNote`, `packageType`).

**`consignmentNote` + `packageType` public-field propagation (W2).** These two are NON-secret
`public_config` fields and MUST be threaded through the same layers as `originZip`/`taxInclusive`,
or `mergeResolvedConfig` never surfaces them and D2's "MX + absent → fail loud" fires on every label:
- `validate-provider-payload.ts`: add to `PROVIDER_PUBLIC_FIELDS.skydropx`
  (currently `["baseUrl","originZip","taxInclusive"]`) and to `skydropxUpsertSchema`
  (`consignmentNote: z.string().optional()`, `packageType: z.string().optional()`).
- admin `form-model.ts` `PROVIDER_FORMS.skydropx`: two new text fields.
- `provider-settings/service.ts` `mergeResolvedConfig`: carry them through (no special default).
- `seed-provider-settings.core.ts` `publicEnv`: optional `SKYDROPX_CONSIGNMENT_NOTE`,
  `SKYDROPX_PACKAGE_TYPE` mappings.

`SkydropxProbeCredentials` (`probes/skydropx.ts`): `{ clientId, clientSecret, originZip, baseUrl? }`.

---

## 6. 8s budget allocation (checkout `calculatePrice`)

Shared deadline `deadline = Date.now() + SKYDROPX_QUOTATION_TIMEOUT_MS (8000)`, threaded into every
call so any sub-step aborts against the same wall clock.

| Step | Warm | Cold | Bound |
|------|------|------|-------|
| `getToken_` (POST /oauth/token) | 0ms (cached) | target ≤ 1500ms | `min(3000, remaining)` |
| POST /quotations | ~1 req | ~1 req | `remaining` |
| Poll GET /quotations/{id} | interval 1000ms | interval 1000ms | until `is_completed` or `deadline` (~4–6 attempts) |

- On any `deadline` overrun → `SkydropxApiError(0,"timeout")` → graceful `MedusaError` → manual (SD-3).
- **Rate limit (2 req/s):** poll interval 1000ms = 1 req/s. Token+POST are sequential awaited calls
  spaced by round-trip latency; steady state (warm) issues only POST + polls. Safe under 2 req/s
  with margin; no explicit pacer required (add a 500ms min-gap only if sandbox shows 429s).
- Admin label path uses `SKYDROPX_REQUEST_TIMEOUT_MS` (15s) per request and the existing
  `LABEL_POLL_BOUND_MS=30000` / `LABEL_POLL_INTERVAL_MS=2000` for shipment polling — not the 8s budget.

---

## 7. Test strategy (strict TDD — RED per layer, hermetic mocked `fetch`)

Preserve **every** existing behavioral case; only swap auth/URL/fixtures. Use injected clock /
fake timers for token expiry and poll bounds. All fetch mocked (no network).

**`client.ts` (new coverage):**
- token fetch hits `/oauth/token` with `grant_type=client_credentials` + both secrets → caches token.
- subsequent call sends `Authorization: Bearer …` and does **not** re-fetch the token (cache reuse).
- token expiry (advance clock past `expiresAt-skew`) → re-fetches.
- 401 on an API call → clears token, re-fetches, retries **once**, succeeds; second 401 → surfaces error.
- `quoteAndPoll_`: incomplete→complete transition; `is_completed` never within deadline → timeout error.
- `createShipment`/`getShipment` poll to `workflow_status:"success"`; fast-fail on `error_detail`; `cancelShipment` posts cancellations.
- **single-flight (W4):** two concurrent `getToken_` calls on a cold cache issue exactly ONE `/oauth/token` POST.
- **no-logging:** capture the logger; assert neither the access token nor `clientSecret` appears in any log line.
- **SSRF constructor (W3):** constructing with a non-`skydropx.com` `baseUrl` throws before any fetch.
- `quoteAndPoll_` never overruns the deadline by more than one poll interval (I1).
- timeout → `SkydropxApiError(0,"timeout")`.

**`service.ts` (preserve + adapt):**
- `toAddress` maps `normalizeState(province)`→area_level1 (code→name), city→area_level2, `address_2`/`metadata.colonia`→area_level3, country upper-cased; missing area_level1/2 → degrade to manual.
- quote-vs-label rate-delta log is still emitted (preserve existing behavioral case, spec Capability 6).
- `calculated_amount = Number(rate.total)`; `is_calculated_price_tax_inclusive` default `true`, honors
  DB `taxInclusive:false`, **never** reads env.
- cheapest-rate + tie-breaks now on `total`/`days`/`provider_name`.
- missing-dims / zero-rates / API-error / 8s-timeout → graceful `MedusaError` (checkout keeps manual).
- `createFulfillment`: fresh quote+poll → select → shipment; `requires_origin_verification:true` → fail
  loud; MX label missing `consignment_note`/`package_type` → fail loud; shipment poll bound;
  orphaned-shipment cancel via `cancelShipment`.
- `validateOptions`: empty ok; present-empty `clientId`/`clientSecret` throws.

**Credential-layer specs** (`provider-settings`, `validate-provider-payload`,
`resolve-probe-credentials`, `probes`, `form-model`, **`scripts/seed-provider-settings.core`**,
and the admin **`api/middlewares.ts` `TestProviderConnectionBody`**): swap
`apiKey`→`clientId`/`clientSecret` fixtures/assertions; assert two-secret required fields; assert
PRO default base URL; assert `consignmentNote`/`packageType` public-field round-trip; probe now
does OAuth token then quote; SSRF: upsert schema **rejects** a non-skydropx `baseUrl` and accepts
`api-pro.skydropx.com`. The **seed** spec (`scripts/__tests__/seed-provider-settings.unit.spec.ts`,
currently asserting `{ apiKey }`) is rewritten to require `SKYDROPX_CLIENT_ID`+`SKYDROPX_CLIENT_SECRET`
and write `{ clientId, clientSecret }`. The **middleware** spec asserts `clientId`/`clientSecret`
survive `TestProviderConnectionBody` (which uses `.strip()` — unlisted fields are silently dropped).

**R-B guard:** each of the ~10 layers gets a two-secret presence assertion so a missed touchpoint
fails a test rather than silently fail-safe-nulling.

---

## 8. Rollback / degradation coherence

- `manual` fallback provider stays registered (`medusa-config.ts` unchanged) → failed PRO quote/label
  degrades to manual checkout (SD-3). Fail-safe-null credential resolution unchanged.
- No data migration: operator deletes legacy `apiKey` row, re-enters `clientId`/`clientSecret` in Admin
  (documented). Rollback = revert the changeset (per chained-PR slice if split). Runbook §7.3 updated
  to the PRO model + origin-verification runbook note (D5).
- Client rotation (fingerprint change) drops the token cache automatically → no stale-token risk on
  credential change.

---

## 9. Skydropx probe rework

`probeSkydropx`: resolve token via `/oauth/token` (both secrets), then best-effort `POST /quotations`
with the minimal parcel + `PROBE_DESTINATION_ZIP`. 401 on token → "rejected credentials". SSRF guard
unchanged. `PROBE_REQUIRED_FIELDS.skydropx = ["clientId","clientSecret","originZip"]`.

**Probe dispatcher (`workflows/steps/probes/index.ts`):** the mapping that currently builds
`{ apiKey: String(creds.apiKey) }` MUST flip to `{ clientId, clientSecret, originZip, baseUrl }`,
or the probe path fail-safe-nulls. Add it to the enumerated credential layers.

**Test-connection middleware & Carta Porte fields (spec/design reconciliation):** for symmetry with
spec Capability 1, `TestProviderConnectionBody` lists `consignmentNote`/`packageType` too; they are
harmless to the probe (unused) but keeping the list symmetric avoids `.strip()` surprises later.

---

## 10. Residual risks after design

- D1/D2/D3 carry sandbox-verify flags (host, SAT/package enum, area_level3 tolerance) — none block
  code; each has a coded fallback.
- Async poll under load could brush 2 req/s if token+POST+poll compress; mitigated by 1s poll interval
  and warm-token reuse; add 500ms pacer only if 429s observed.

---

## 11. Medusa architecture confirmation

- **No new API routes.** The existing `api/admin/provider-settings` route only gets schema updates
  (two secrets). The admin validation touchpoint is **`api/middlewares.ts` `TestProviderConnectionBody`**
  (NOT `api/admin/provider-settings/middlewares.ts`, which does not exist — correcting proposal §4).
  That body uses **`.strip()`**, so `clientId`/`clientSecret` MUST be added explicitly or they are
  silently dropped (fail-safe-null). Only GET/POST/DELETE in play; no PUT/PATCH.
- **No new module links.** Credentials remain in the generic `provider_setting` encrypted-secret JSON —
  `clientId`/`clientSecret` fit the existing shape; no schema/migration.
- **No new data models.** Fulfillment provider internals only.
- Mutations still flow through the existing `validate-provider-payload` workflow step (business
  validation in the step, not the route). This change is a provider-internals swap, not a new surface.

---

## 12. Note on D4 (correction vs proposal §9)

Proposal §9 phrased D4 as "rate_id from a **stored** quotation." Design recommends a **fresh**
quotation at fulfillment time instead: the stored checkout rate can be stale (24h validity) and
reusing it would drop the deterministic cross-carrier `selectCheapestRate` that the unit tests lock
in. Fresh re-quote at label time is the least-churn path matching today's `createShipment→select→createLabel`
shape.

# Tasks — skydropx-pro-oauth-migration

Strict TDD is ACTIVE. Runner: `cd apps/backend && pnpm test:unit`. Build gate: `cd apps/backend && pnpm build`.
All fetch is mocked (hermetic, no network). Use injected clock / fake timers for token expiry and poll bounds.
Every slice sequences RED → GREEN → TRIANGULATE → REFACTOR, then a per-slice verification gate.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,700–1,900 total (S1 ~550, S2 ~560, S3 ~520, S4 ~130) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (S1 credential schema) → PR 2 (S2 client.ts OAuth+endpoints) → PR 3 (S3 service.ts seams + probe) → PR 4 (S4 docs & env) |
| Delivery strategy | auto-forecast (auto-chain candidate; orchestrator applies cached strategy) |
| Chain strategy | pending |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main|feature-branch-chain|size-exception|pending
400-line budget risk: High
```

**Split rationale.** The proposal's S2 (client + service in one PR) plus new + rewritten specs exceeds 600
lines on its own, so this breakdown splits the behavior swap into **S2 = `client.ts` (transport/OAuth) +
`client.unit.spec.ts`** and **S3 = `service.ts` seams + probe OAuth rework + `service.unit.spec.ts`**, per the
design's "may split client vs service" allowance. Each slice stays ≤ 600 changed lines and is independently
green + buildable. The chain is dependency-ordered: S1 lands the PRO-shaped credentials (no behavior change),
S2 lands the transport, S3 flips the behavior end-to-end, S4 documents it.

> **Live PRO gates (apply-time, NOT unit-coverable).** S5.0a (host / `province` code-vs-name / `area_level3`
> mandate), S5.0b (IVA `vat_fee` reconcile), and S5.5 (live quote + label + cancel) require live PRO
> credentials and are executed during apply against sandbox — see the final section. They gate closing the
> runbook, not the unit suite.

---

## S1 — Credential schema (clientId/clientSecret) across all layers

Goal: replace the single `apiKey` secret with two secrets (`clientId` + `clientSecret`) and thread the new
`consignmentNote`/`packageType` public fields through every layer. **No behavior swap** — the client still
talks legacy until S2/S3; this slice ends green with PRO-shaped credentials. Enumerates all ~10 layers so a
missed touchpoint fails a test rather than silently fail-safe-nulling (R-B). Estimated ~550 changed lines.

### RED — write/adjust failing specs first

- [x] S1-R1 — `modules/provider-settings/__tests__/service.unit.spec.ts`: replace `{ apiKey }` fixtures with
  `{ clientId, clientSecret }`; assert resolved config exposes `clientId`, `clientSecret`, `baseUrl`,
  `originZip`, `taxInclusive`, optional `consignmentNote`/`packageType`, and **no** `apiKey`; assert the
  missing-`baseUrl` default now resolves to the PRO host and an explicit `baseUrl` is preserved.
- [x] S1-R2 — `workflows/steps/__tests__/validate-provider-payload.unit.spec.ts`: assert
  `PROVIDER_SECRET_FIELDS.skydropx = ["clientId","clientSecret"]` and
  `PROVIDER_PUBLIC_FIELDS.skydropx = ["baseUrl","originZip","taxInclusive","consignmentNote","packageType"]`;
  a two-secret upsert validates; `apiKey` is not a valid skydropx field; **SSRF-reject** case (non-`skydropx.com`
  `baseUrl` rejected on save) and **SSRF-accept** case (`api-pro.skydropx.com` accepted).
- [x] S1-R3 — `workflows/steps/__tests__/resolve-probe-credentials.unit.spec.ts`: assert
  `PROBE_REQUIRED_FIELDS.skydropx = ["clientId","clientSecret","originZip"]`; `apiKey` no longer required.
- [x] S1-R4 — `workflows/steps/probes/__tests__/probes.unit.spec.ts`: assert the dispatcher maps resolved
  creds to `{ clientId, clientSecret, originZip, baseUrl }` (not `{ apiKey }`).
- [x] S1-R5 — `admin/routes/provider-settings/__tests__/form-model.unit.spec.ts`: assert
  `PROVIDER_FORMS.skydropx` renders two masked secret fields (`clientId`, `clientSecret`), plus `originZip`,
  `baseUrl`, `taxInclusive`, and new `consignmentNote`/`packageType` text fields; no `apiKey` field; assert
  `buildUpsertBody` round-trips the two secrets + public fields.
- [x] S1-R6 — `scripts/__tests__/seed-provider-settings.unit.spec.ts`: rewrite to require
  `SKYDROPX_CLIENT_ID` + `SKYDROPX_CLIENT_SECRET`, write `{ clientId, clientSecret }`, map `originZip`/`baseUrl`/
  `taxInclusive` (+ optional `consignmentNote`/`packageType`); assert a partial single-secret env writes **no**
  row; assert `SKYDROPX_API_KEY` is never read.
- [x] S1-R7 — add/extend a spec for `api/middlewares.ts` `TestProviderConnectionBody`: assert `clientId` and
  `clientSecret` (+ `consignmentNote`/`packageType`) survive `.strip()` for a skydropx body; assert `apiKey`
  is dropped/absent. (R-B two-secret presence assertion for the middleware layer.)

### GREEN — make each layer PRO-shaped

- [x] S1-G1 — `modules/skydropx-fulfillment/types.ts`: define `SkydropxCredentials` with `clientId`,
  `clientSecret`, optional `baseUrl`, `originZip`, `taxInclusive`, `consignmentNote`, `packageType`; remove
  `apiKey`. (Wire shapes / `TODO(sandbox-verify)` removal happen in S2/S3.)
- [x] S1-G2 — `modules/provider-settings/types.ts`: flip `SKYDROPX_DEFAULT_BASE_URL` to
  `https://api-pro.skydropx.com/api/v1`; rewrite `SkydropxResolvedConfig` to mirror `SkydropxCredentials`
  (`clientId`, `clientSecret`, `baseUrl`, `originZip`, `taxInclusive`, `consignmentNote`, `packageType`);
  update the header doc comment; remove the `apiKey` reference.
- [x] S1-G3 — `modules/provider-settings/service.ts` `mergeResolvedConfig` skydropx branch: carry
  `consignmentNote`/`packageType` through (no special default); keep the `baseUrl` default flip to the new PRO
  constant.
- [x] S1-G4 — `scripts/seed-provider-settings.core.ts`: `requiredEnv = ["SKYDROPX_CLIENT_ID",
  "SKYDROPX_CLIENT_SECRET", "SKYDROPX_ORIGIN_ZIP"]`; `secretEnv = { clientId: "SKYDROPX_CLIENT_ID",
  clientSecret: "SKYDROPX_CLIENT_SECRET" }`; `publicEnv` adds optional
  `consignmentNote: "SKYDROPX_CONSIGNMENT_NOTE"`, `packageType: "SKYDROPX_PACKAGE_TYPE"`; drop `SKYDROPX_API_KEY`.
- [x] S1-G5 — `workflows/steps/validate-provider-payload.ts`: `PROVIDER_SECRET_FIELDS.skydropx =
  ["clientId","clientSecret"]`; `PROVIDER_PUBLIC_FIELDS.skydropx` adds `consignmentNote`, `packageType`;
  `skydropxUpsertSchema` gets `clientId`/`clientSecret` (`z.string().min(1).optional()`) + `consignmentNote`/
  `packageType` (`z.string().optional()`); add an **`isAllowedSkydropxBaseUrl` refinement** rejecting a
  non-`skydropx.com` `baseUrl` on save (design D1 / SSRF write-path fix); remove `apiKey`.
- [x] S1-G6 — `api/middlewares.ts` `TestProviderConnectionBody`: add `clientId`, `clientSecret`,
  `consignmentNote`, `packageType` (and keep `baseUrl` url-optional, `originZip`, `taxInclusive`); remove
  `apiKey` (line 50). `.strip()` drops anything unlisted, so both secrets must be listed explicitly.
- [x] S1-G7 — `admin/routes/provider-settings/form-model.ts` `PROVIDER_FORMS.skydropx`: two secret/password
  fields (`clientId`, `clientSecret`) + `consignmentNote`/`packageType` text fields; keep `originZip`,
  `baseUrl`, `taxInclusive`; remove the `apiKey` field (line 100).
- [x] S1-G8 — `workflows/steps/resolve-probe-credentials.ts`: `PROBE_REQUIRED_FIELDS.skydropx =
  ["clientId","clientSecret","originZip"]`.
- [x] S1-G9 — `workflows/steps/probes/index.ts` dispatcher: build
  `{ clientId: String(creds.clientId), clientSecret: String(creds.clientSecret), originZip, baseUrl }` instead
  of `{ apiKey }` (line 32). (Probe implementation OAuth rework is S3; here just fix the mapping so the layer
  is not fail-safe-nulled.)

### TRIANGULATE

- [x] S1-T1 — add edge cases: masking unchanged (`clientSecret` ≥ 8 chars → `last4`; short `clientId` fully
  masked, spec Capability 1); partial-secret upsert (one of two secrets) behaves like today's partial-update.

### REFACTOR

- [x] S1-F1 — remove now-dead `apiKey` references/comments across the touched files; grep skydropx scope for
  `apiKey` / `SKYDROPX_API_KEY` and confirm only S2/S3-owned files (client/service wire shapes) remain.

### Verification

- [x] S1-V1 — `cd apps/backend && pnpm test:unit` green; `cd apps/backend && pnpm build` green.

---

## S2 — OAuth token client + PRO endpoints (client.ts)

Goal: absorb 100% of the auth/token/URL/endpoint change into `modules/skydropx-fulfillment/client.ts` (design
§3). New `client.unit.spec.ts`. Service still calls the legacy method names until S3, so this slice is scoped
to transport + a compile-time-compatible client surface. Estimated ~560 changed lines.

### RED — new client spec first (`modules/skydropx-fulfillment/__tests__/client.unit.spec.ts`)

- [x] S2-R1 — token fetch hits `POST ${baseUrl}/oauth/token` with `grant_type=client_credentials` + both
  secrets; caches `{ accessToken, expiresAt }`.
- [x] S2-R2 — subsequent call sends `Authorization: Bearer …` and does **not** re-fetch (cache reuse);
  no header ever contains `Token token=`.
- [ ] S2-R3 — token expiry (advance clock past `expiresAt - 60s` skew) → re-fetches.
- [x] S2-R4 — 401 on an API call → clears token, re-fetches, retries **once**, succeeds; a second 401 →
  surfaces a typed `SkydropxApiError` (no infinite loop).
- [ ] S2-R5 — **single-flight (W4):** two concurrent `getToken_` on a cold cache issue exactly ONE
  `/oauth/token` POST.
- [x] S2-R6 — **no-logging:** capture the logger; assert neither the access token nor `clientSecret` appears
  in any log line.
- [x] S2-R7 — **SSRF constructor (W3):** constructing with a non-`skydropx.com` `baseUrl` throws
  `INVALID_DATA` before any fetch; `api-pro.skydropx.com` constructs fine.
- [x] S2-R8 — `quoteAndPoll_`: `is_completed:false`→`true` transition reads `rates[]` only when complete;
  never overruns the shared deadline by more than one poll interval (I1); `is_completed` never within deadline →
  `SkydropxApiError(0,"timeout")`.
- [x] S2-R9 — error-body mapping (I2): non-2xx → `SkydropxApiError(status, code=body.error,
  msg=body.error_description || JSON(body.errors))`; abort/timeout → `SkydropxApiError(0,"timeout")`.
- [x] S2-R10 — `createShipment`/`getShipment` poll to `workflow_status:"success"`; `getShipment` fast-fails
  when `error_detail` is present (don't burn the poll bound); `cancelShipment` POSTs
  `/shipments/{id}/cancellations` with `{ reason }`.

### GREEN — implement client.ts (design §3)

- [x] S2-G1 — `types.ts` wire shapes (owned here since the client consumes them): add
  `SkydropxTokenResponse`, `SkydropxQuoteAddress`, `SkydropxParcel`, `SkydropxQuotationRequest`,
  `SkydropxRate` (with `success`, `status`, `total`, `vat_fee`, `days`, `provider_name`,
  `requires_origin_verification`, `shipment_creation_type`), `SkydropxQuotation`, `SkydropxShipAddress`,
  `SkydropxShipPackage`, `SkydropxCreateShipmentRequest`, `SkydropxShipment`, `SkydropxCancellation`,
  `SkydropxErrorBody`; **remove ALL `TODO(sandbox-verify)` markers**.
- [x] S2-G2 — constants: `DEFAULT_BASE_URL`, `SKYDROPX_QUOTATION_TIMEOUT_MS=8000`,
  `SKYDROPX_REQUEST_TIMEOUT_MS=15000`, `SKYDROPX_TOKEN_TIMEOUT_MS=3000`, `TOKEN_EXPIRY_SKEW_MS=60000`,
  `QUOTE_POLL_INTERVAL_MS=1000`.
- [x] S2-G3 — constructor: store `clientId`/`clientSecret`/`baseUrl` (strip trailing slash); defensive SSRF —
  throw `INVALID_DATA` if `!isAllowedSkydropxBaseUrl(baseUrl)` before any request.
- [x] S2-G4 — `getToken_(deadline?)`: return cached token if `now < expiresAt - skew`; single-flight via
  `tokenInFlight_`; POST `/oauth/token` JSON (form fallback on a sandbox 400); set
  `expiresAt = now + expires_in*1000`; sub-bound by `min(SKYDROPX_TOKEN_TIMEOUT_MS, remaining budget)`;
  **never log** token/secret.
- [x] S2-G5 — `authed_<T>(method, path, body?, timeoutMs?, deadline?)`: `Bearer` header; on 401 once clear
  token + refresh + retry; non-2xx → mapped `SkydropxApiError` (error-body mapping); abort → timeout error.
- [x] S2-G6 — PRO endpoint methods: `createQuotation`, `getQuotation`, `quoteAndPoll_` (deadline-bounded,
  `sleep_(min(interval, remaining))`), `createShipment`, `getShipment` (fast-fail on `error_detail`),
  `cancelShipment`. Keep a service-compatible surface so S2 compiles against the current `service.ts`
  (adapt/alias legacy method names if needed; the true call-site rewrite is S3).

### TRIANGULATE

- [ ] S2-T1 — token-time-counts-against-budget case: a cold quote's token fetch consumes the same 8s
  `AbortController` budget as create+poll (spec Capability 3).

### REFACTOR

- [x] S2-F1 — factor the fetch+abort+error-map helper so token and API calls share one path; confirm zero
  `Token token=` / legacy v1 URL literals remain in `client.ts`.

### Verification

- [x] S2-V1 — `cd apps/backend && pnpm test:unit` green; `cd apps/backend && pnpm build` green.

---

## S3 — service.ts seams + async quote/label wiring + probe OAuth rework

Goal: flip behavior end-to-end through the three named seams (address sourcing, IVA pin, `validateOptions`
guard) plus the async quote/label rewrite and the OAuth probe. Rewrites `service.unit.spec.ts`. Estimated
~520 changed lines.

### RED — rewrite/extend specs first

- [x] S3-R1 — `modules/skydropx-fulfillment/__tests__/service.unit.spec.ts` `toAddress`/`normalizeState`:
  `normalizeState(province)`→`area_level1` (code→name, e.g. `NL`→`Nuevo León`, pass-through if already a
  name), `city`→`area_level2`, `address_2`/`metadata.colonia`→`area_level3` (omitted, not fabricated, when
  absent), `country_code` upper-cased; missing `area_level1`/`area_level2` → degrade to manual before any API
  call (spec Capability 4).
- [x] S3-R2 — usable-rate filter + selection: keep only `success===true` AND finite `Number(total)` AND
  `status` not in `no_coverage`/`tariff_price_not_found`/`not_applicable`/`pending`; empty filtered list →
  graceful `MedusaError` (manual, SD-3); `calculated_amount` never `NaN`; cheapest by `total`, tie-break
  `days` then `provider_name`.
- [x] S3-R3 — IVA: `calculated_amount = Number(rate.total)` (no cent conversion; `"99.90"`→`99.90`);
  `is_calculated_price_tax_inclusive` default `true`, honors DB `taxInclusive:false`, **never** reads
  `SKYDROPX_TAX_INCLUSIVE`.
- [x] S3-R4 — `validateOptions`: empty options OK; present-but-empty `clientId` **or** `clientSecret` throws
  `INVALID_DATA`.
- [x] S3-R5 — `createFulfillment`: fresh quote+poll → select → `requires_origin_verification:true` →
  `MedusaError.UNEXPECTED_STATE` fail-loud (D5); MX + missing `consignment_note`/`package_type` (product
  override ?? config default) → fail-loud (D2); success reads
  `included[0].attributes.{tracking_number,label_url}` with `master_tracking_number` fallback; shipment poll
  bounded (`LABEL_POLL_*`); orphaned-shipment best-effort cancel via `cancelShipment`.
- [x] S3-R6 — degrade/preserve cases: missing-dims, zero/unusable rates, API error, 8s timeout → graceful
  `MedusaError` (manual); **quote-vs-label rate-delta log still emitted** (preserve, spec Capability 6);
  origin-address pre-flight rejects when origin state/city (not just zip) absent.
- [x] S3-R7 — `workflows/steps/probes/__tests__/probes.unit.spec.ts`: probe now resolves an OAuth token via
  `/oauth/token` then best-effort `POST /quotations`; 401 on token → "rejected credentials"; SSRF guard
  unchanged.

### GREEN — implement seams + wiring

- [x] S3-G1 — `modules/skydropx-fulfillment/service.ts`: add `normalizeState` (MX ISO-3166-2 code→name map,
  pass-through) and `toAddress` pure helper (used by `calculatePrice` and `createFulfillment`); expand the
  `calculatePrice` context read from `{ postal_code }` to
  `{ postal_code, province, city, country_code, address_2, metadata }`.
- [x] S3-G2 — add `toShipAddress(order.shipping_address)` (`street1`/name/company/phone/email/reference/
  tax_id) for `POST /shipments`; origin uses `from_location.address` + `originZip` zip fallback via the same
  `toAddress`/`normalizeState`.
- [x] S3-G3 — usable-rate filter helper + update `selectCheapestRate` to sort on `Number(total)` → `days` →
  `provider_name`; `calculatePrice` uses `Number(rate.total)`.
- [x] S3-G4 — IVA pin: `is_calculated_price_tax_inclusive: config.taxInclusive ?? true`,
  `calculated_amount = Number(rate.total)`; remove the `TODO(sandbox-verify)` comment (line ~121 region).
- [x] S3-G5 — `validateOptions`: replace the `apiKey` guard with `clientId`/`clientSecret` presence checks
  (empty options still valid).
- [x] S3-G6 — rewrite `createFulfillment` to the D4 fresh-quote flow: `quoteAndPoll_` → `selectCheapestRate`
  → origin-verification guard (SD-4) → resolve `consignment_note`/`package_type` (product override ?? config
  default; MX + absent → fail loud) → `createShipment` → poll `getShipment` → read tracking/label; wire
  `abandonLabel_`/`cancelFulfillment` to `cancelShipment(shipment_id, reason)`; `data.shipment_id` becomes the
  cancellation key.
- [x] S3-G7 — thread the shared `deadline = Date.now() + SKYDROPX_QUOTATION_TIMEOUT_MS` from `calculatePrice`
  into `quoteAndPoll_`; keep `fetchRates_` error→`MedusaError` translation (SD-3) wrapping `quoteAndPoll_`.
- [x] S3-G8 — `workflows/steps/probes/skydropx.ts`: `SkydropxProbeCredentials =
  { clientId, clientSecret, originZip, baseUrl? }`; `probeSkydropx` resolves a token then best-effort quotes
  with the minimal parcel + `PROBE_DESTINATION_ZIP`; SSRF guard unchanged.

### TRIANGULATE

- [x] S3-T1 — `normalizeState` pass-through when `province` is already a full name; `area_level3`
  metadata.colonia path when `address_2` is empty; DB `taxInclusive:false` override end-to-end.

### REFACTOR

- [x] S3-F1 — collapse duplicate address-mapping between quote and label paths through the shared `toAddress`;
  grep skydropx scope confirms zero `apiKey` / `Token token=` / v1 URL remain anywhere (spec Capability 6).

### Verification

- [x] S3-V1 — `cd apps/backend && pnpm test:unit` green; `cd apps/backend && pnpm build` green.

---

## S4 — Docs & env

Goal: docs land in the same change (proposal Goal 8). Estimated ~130 changed lines. No unit tests (docs/env).

- [ ] S4-1 — `docs/runbooks/mx-payments-shipping.md` §1a: env vars `SKYDROPX_CLIENT_ID`/`SKYDROPX_CLIENT_SECRET`
  replace `SKYDROPX_API_KEY` (+ optional `SKYDROPX_CONSIGNMENT_NOTE`/`SKYDROPX_PACKAGE_TYPE`).
- [ ] S4-2 — §5: mark **S5.0b CLOSED**; document the S5.0a and S5.5 sandbox steps as apply-time live gates.
- [ ] S4-3 — §7: OAuth log signals, `requires_origin_verification` origin-verification note, and the updated
  §7.3 rollback lever (disable provider → fail-safe-null → manual; manual `clientId`/`clientSecret` re-entry).
- [ ] S4-4 — `apps/backend/.env.template`: add `SKYDROPX_CLIENT_ID`, `SKYDROPX_CLIENT_SECRET`,
  `SKYDROPX_CONSIGNMENT_NOTE`, `SKYDROPX_PACKAGE_TYPE`; remove `SKYDROPX_API_KEY`.
- [ ] S4-5 — `docs/runbooks/obtener-credenciales-proveedores.md`: rewrite the Skydropx section to PRO OAuth
  (Conexiones > API → Client ID / Client Secret).
- [ ] S4-6 — grep repo-wide (code + docs + fixtures) for `apiKey` / `SKYDROPX_API_KEY` / `Token token=` in
  skydropx scope → zero remaining (spec Capability 6 close-out).
- [ ] S4-V1 — `cd apps/backend && pnpm build` green (docs slice has no unit tests).

---

## Apply-time live PRO gates (require live credentials — run during apply, after S2/S3 land)

These are NOT unit-coverable and depend on live sandbox PRO credentials. They close the runbook gates and
confirm the design's sandbox-verify flags. Execute against the operator's PRO creds during apply; on
mismatch, apply the coded fallback the design already provides.

- [ ] G-S5.0a — **host + address acceptance**: confirm the exact host (`api-pro.skydropx.com` vs
  `pro.skydropx.com`) and that token + API share it (D1); confirm PRO accepts `province` as a full state name
  via `normalizeState` (or adjust the map); confirm whether PRO **mandates** `area_level3` — if yes and no
  cart source exists, confirm degrade-to-manual holds (spec Capability 4).
- [ ] G-S5.0b — **IVA reconcile**: on a live quote, confirm `rate.total` is IVA-inclusive and `vat_fee`
  reconciles against `total` (no double/under-tax) → S5.0b CLOSED.
- [ ] G-S5.5 — **live quote + label + cancel**: a checkout quote returns a rate within the 8s budget; an admin
  label purchase yields a valid `label_url` + tracking number with a real `consignment_note`/`package_type`;
  cancel succeeds via `POST /shipments/{id}/cancellations`.

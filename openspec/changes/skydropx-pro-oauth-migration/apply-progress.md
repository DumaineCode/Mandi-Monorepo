# Apply Progress — skydropx-pro-oauth-migration

Strict TDD active. Runner: `cd apps/backend && pnpm test:unit`. Build gate: `cd apps/backend && pnpm build`.
Delivery: interactive, single-slice (chained PRs). This document covers **slice S1 only**.

---

## Slice S1 — Credential schema (clientId/clientSecret) — COMPLETE ✅

Goal delivered: replaced the single `apiKey` secret with two secrets (`clientId` + `clientSecret`)
and threaded the new `consignmentNote`/`packageType` public fields through every credential layer,
plus the SSRF `baseUrl` write-path refinement and the PRO default-host flip. **No behavior swap** —
the client/service still talk legacy until S2/S3.

### Verification (S1-V1) — GREEN
- `cd apps/backend && pnpm test:unit` → **22 suites, 335 tests passed**.
- `cd apps/backend && pnpm build` → **backend + frontend build completed successfully**.
- `cd apps/backend && npx tsc --noEmit` → **exit 0, zero type errors** (SWC build does not typecheck,
  so this was run additionally to prove type consistency of the reshape).

### Persisted task checkboxes updated (tasks.md)
All S1 boxes flipped `- [ ]` → `- [x]`: S1-R1..R7, S1-G1..G9, S1-T1, S1-F1, S1-V1 (19 tasks).
S2/S3/S4 and the G-S5.* live gates remain `- [ ]` (out of this slice).

### TDD Cycle Evidence (RED → GREEN → TRIANGULATE → REFACTOR)
| Phase | Evidence |
|-------|----------|
| RED | Rewrote the 7 credential-layer specs (R1–R7) first; targeted run reported **7 suites failed, 21 tests failed** (e.g. resolved config still `{ apiKey }`, `PROVIDER_SECRET_FIELDS.skydropx === ["apiKey"]`, form field `apiKey`, seed `SKYDROPX_API_KEY`, dispatcher header `Token token=undefined`). |
| GREEN | Implemented G1–G9 + forced compile bridges; same targeted run → **7 suites, 103 tests passed**. |
| TRIANGULATE (S1-T1) | Added masking edge case (skydropx `clientSecret` ≥8 → `last4`, short `clientId` → `null`) and a same-mode partial-secret upsert (one of two retained) → both pass; suite total 335. |
| REFACTOR (S1-F1) | Grepped skydropx scope for `apiKey`/`SKYDROPX_API_KEY`: remaining references live **only** in the S2/S3-owned client/service wire-shape files (`types.ts` transitional field, `client.ts`, `service.ts`, and their `__tests__`), plus intentional negative "no apiKey" assertions in the migrated specs. All credential-layer files are clean. |

### Files changed — S1

Production (GREEN):
- `apps/backend/src/modules/provider-settings/types.ts` — `SKYDROPX_DEFAULT_BASE_URL` flipped to `https://api-pro.skydropx.com/api/v1`; `SkydropxResolvedConfig` reshaped to `clientId`/`clientSecret`/`baseUrl`/`originZip`/`taxInclusive`/`consignmentNote`/`packageType` (no `apiKey`); header doc table updated. (G2)
- `apps/backend/src/modules/skydropx-fulfillment/types.ts` — `SkydropxCredentials` gains `clientId`/`clientSecret`/`consignmentNote`/`packageType`. (G1 — see Deviation D-1)
- `apps/backend/src/scripts/seed-provider-settings.core.ts` — skydropx `requiredEnv`/`secretEnv` → `SKYDROPX_CLIENT_ID`+`SKYDROPX_CLIENT_SECRET`; `publicEnv` adds `SKYDROPX_CONSIGNMENT_NOTE`/`SKYDROPX_PACKAGE_TYPE`; `SKYDROPX_API_KEY` dropped. (G4)
- `apps/backend/src/workflows/steps/validate-provider-payload.ts` — `PROVIDER_SECRET_FIELDS.skydropx = ["clientId","clientSecret"]`; `PROVIDER_PUBLIC_FIELDS.skydropx` adds `consignmentNote`/`packageType`; `skydropxUpsertSchema` gains the two secrets + Carta Porte fields and an `isAllowedSkydropxBaseUrl` `.refine()` (SSRF write-path guard, design D1); `apiKey` removed. (G5)
- `apps/backend/src/api/middlewares.ts` — `TestProviderConnectionBody` lists `clientId`/`clientSecret`/`consignmentNote`/`packageType` (survive `.strip()`); `apiKey` removed. (G6)
- `apps/backend/src/admin/routes/provider-settings/form-model.ts` — `PROVIDER_FORMS.skydropx` renders `clientId`/`clientSecret` password fields + `consignmentNote`/`packageType` text fields; `apiKey` field removed. (G7)
- `apps/backend/src/workflows/steps/resolve-probe-credentials.ts` — `PROBE_REQUIRED_FIELDS.skydropx = ["clientId","clientSecret","originZip"]`. (G8)
- `apps/backend/src/workflows/steps/probes/index.ts` — dispatcher maps `{ clientId, clientSecret, originZip, baseUrl }` (was `{ apiKey }`). (G9)
- `apps/backend/src/workflows/steps/probes/skydropx.ts` — `SkydropxProbeCredentials` reshaped to the two secrets; legacy `Token token=` header now sourced from `clientSecret` with a `TODO(S3)` for the OAuth rework (forced interface bridge for G9; probe OAuth rework is S3-G8).

Specs (RED / TRIANGULATE):
- `apps/backend/src/modules/provider-settings/__tests__/service.unit.spec.ts` (R1 + T1 masking)
- `apps/backend/src/workflows/steps/__tests__/validate-provider-payload.unit.spec.ts` (R2 + T1 partial-secret)
- `apps/backend/src/workflows/steps/__tests__/resolve-probe-credentials.unit.spec.ts` (R3)
- `apps/backend/src/workflows/steps/probes/__tests__/probes.unit.spec.ts` (R4)
- `apps/backend/src/admin/routes/provider-settings/__tests__/form-model.unit.spec.ts` (R5)
- `apps/backend/src/scripts/__tests__/seed-provider-settings.unit.spec.ts` (R6)
- `apps/backend/src/api/admin/provider-settings/__tests__/middlewares.unit.spec.ts` (R7 — **new file**)

### G3 note (no code change required)
`provider-settings/service.ts` `mergeResolvedConfig` merges `public_config` generically
(`{ ...publicConfig, ...secrets }`), so `consignmentNote`/`packageType` already carry through
with no special default; the `baseUrl` default now resolves to the PRO constant via G2. No edit was
needed in `service.ts` — confirmed by the R1 spec's "preserves an explicit baseUrl and carries
consignmentNote/packageType" case (green).

### Deviations from design / plan
- **D-1 (intentional, scoped):** S1-G1 literally says "remove `apiKey`" from `SkydropxCredentials`.
  Doing so would break the **S2-owned** `client.ts` transport and its spec, and the **S3-owned**
  `service.ts` `validateOptions` guard and its spec — i.e. it would force the S2/S3 behavior rewrite
  inside S1, contradicting the parent guardrail "do NOT rewrite client.ts transport / service.ts
  seams" and "no behavior swap." Resolution: `apiKey` is **retained as a `@deprecated` optional
  field** on `SkydropxCredentials` with a `TODO(S2)` marker, while every credential **layer**
  (resolved config, merge, seed, write-path validation, admin API schema, admin form-model, probe
  resolution + dispatcher) drops `apiKey` and adopts `clientId`/`clientSecret` now. This is exactly
  the end-state S1-F1 describes ("confirm only S2/S3-owned files — client/service wire shapes —
  remain"). S2-G1 removes the transitional field when `client.ts` adopts the OAuth Bearer flow.
  Net effect: **zero touches to `client.ts`, `service.ts`, `client.unit.spec.ts`,
  `service.unit.spec.ts`** — all remained green unchanged.
- **D-2 (forced bridge):** `probes/skydropx.ts` had to accept the reshaped `SkydropxProbeCredentials`
  so the G9 dispatcher compiles/runs. Change is minimal (interface + one header line sourced from
  `clientSecret`, `TODO(S3)`); the probe's OAuth token-exchange rework stays owned by S3-G8. The
  probe's legacy default base URL and `Token token=` transport are left for S3.

### Scope guardrails honored
- Touched only the S1 layers (G1–G9) + their specs (R1–R7) + T1/F1, plus the two documented forced
  bridges (D-1 field retention, D-2 probe interface). Did **not** rewrite `client.ts` transport (S2)
  or `service.ts` seams (S3); `TODO(S2)`/`TODO(S3)` markers left in place.

---

## Slices S2 + S3 — PRO OAuth client + service seams (FUNCTIONAL CORE) — COMPLETE ✅

Delivered together as the functional end-to-end path (checkout quote + admin label) on Skydropx PRO.
LEAN mode: essential behaviors covered with high-value tests; deferred hardening enumerated below.
The OAuth test-connection probe (`probes/skydropx.ts`) already landed in `ea1b935` and is consistent
with the new client (same `/oauth/token`, same `isAllowedSkydropxBaseUrl` guard) — not redone.

### Verification (S2-V1 / S3-V1) — GREEN
- `cd apps/backend && pnpm test:unit` → **22 suites, 331 tests passed** (client 12 + service 24 rewritten).
- `cd apps/backend && pnpm build` → **backend + frontend build completed successfully**.
- `cd apps/backend && npx tsc --noEmit` → **exit 0** (SWC build does not typecheck; ran additionally).
- Regression grep (spec Capability 6): zero `apiKey` / `Token token=` / legacy `v1` / `total_pricing`
  in `src/modules/skydropx-fulfillment/` production code — only intentional negative test assertions
  reference `Token token=`. Zero `TODO(sandbox-verify)` / `@deprecated apiKey` / `TODO(S2|S3)` remain.

### TDD Cycle Evidence (RED → GREEN → TRIANGULATE → REFACTOR)
| Phase | Evidence |
|-------|----------|
| RED | Rewrote `client.unit.spec.ts` (OAuth Bearer, cache reuse, 401-retry, async poll, error mapping, SSRF ctor, cancellations) and `service.unit.spec.ts` (address hierarchy, usable-rate filter, IVA `Number(rate.total)`, createFulfillment fresh-quote flow, origin-verif + Carta Porte fail-loud, orphan cancel). Against the legacy client/service both suites failed to compile/pass (legacy `total_pricing`/`Token token=`/`/labels`). |
| GREEN | Rewrote `types.ts` (PRO wire shapes), `client.ts` (OAuth2 client-credentials + async quote poll + PRO endpoints), `service.ts` (three seams + async quote/label wiring). Targeted run → **2 suites, 36 tests passed**; full suite → **331 passed**. |
| TRIANGULATE | `normalizeState` pass-through when already a full name; `area_level3` from `address_2` present-vs-omitted; DB `taxInclusive:false` honored end-to-end while `SKYDROPX_TAX_INCLUSIVE` env is set to `true` (never read); usable-rate filter drops NaN/`no_coverage`/`success:false` before cheapest selection. |
| REFACTOR | Single `fetch_` helper shared by token + API calls (abort + error-map in one path); `toAddress` shared by quote and label paths; `fetchUsableRates_` centralizes error→MedusaError + filter. |

### Files changed — S2 + S3 (production)
- `apps/backend/src/modules/skydropx-fulfillment/types.ts` — replaced legacy shapes with PRO wire types
  (`SkydropxTokenResponse`, `SkydropxQuoteAddress`, `SkydropxParcel` (extended), `SkydropxQuotationRequest`,
  `SkydropxRate` with `success`/`status`/`total`/`vat_fee`/`days`/`provider_name`/`requires_origin_verification`,
  `SkydropxQuotation`, `SkydropxShipAddress`, `SkydropxShipPackage`, `SkydropxCreateShipmentRequest`,
  `SkydropxShipment`, `SkydropxCancellation`, `SkydropxErrorBody`); removed `apiKey` and ALL `TODO(sandbox-verify)`.
  `SkydropxCredentials.clientId`/`clientSecret` now required strings. (S2-G1)
- `apps/backend/src/modules/skydropx-fulfillment/client.ts` — rewritten to PRO OAuth2: token cache
  `{accessToken,expiresAt}` with 60s skew + single-flight; `getToken_`/`authed_` (Bearer, 401→clear+refresh+retry-once);
  `createQuotation`/`getQuotation`/`quoteAndPoll_` (deadline-bounded), `createShipment`/`getShipment`
  (fast-fail on `error_detail`)/`cancelShipment`; defensive SSRF in ctor via `isAllowedSkydropxBaseUrl`;
  error-body mapping `code=body.error`, `msg=body.error_description || JSON(errors)`; constants (`DEFAULT_BASE_URL`
  = `https://api-pro.skydropx.com/api/v1`, quotation 8s / request 15s / token 3s / skew 60s / poll 1s). (S2-G2..G6)
- `apps/backend/src/modules/skydropx-fulfillment/service.ts` — three seams + async wiring: `normalizeState`
  (MX ISO-3166-2 code→name map, pass-through), `toAddress` (quote hierarchy, degrade when country/postal/state/city
  absent), `toShipAddress` (PRO ship contact/street), usable-rate filter + `selectCheapestRate` on
  `total`/`days`/`provider_name`; `calculatePrice` expanded context read + `Number(rate.total)` +
  `taxInclusive ?? true`; `validateOptions` clientId/clientSecret; `createFulfillment` D4 fresh-quote flow
  (origin-verif fail-loud D5, Carta Porte fail-loud D2, shipment poll bound, `included[0].attributes` tracking/label
  with `master_tracking_number` fallback, orphaned-shipment best-effort `cancelShipment`); `cancelFulfillment`
  keyed on `shipment_id`. (S3-G1..G7)

### Files changed — S2 + S3 (specs, rewritten)
- `apps/backend/src/modules/skydropx-fulfillment/__tests__/client.unit.spec.ts` (S2 RED)
- `apps/backend/src/modules/skydropx-fulfillment/__tests__/service.unit.spec.ts` (S3 RED/TRIANGULATE)

### Persisted task checkboxes updated (tasks.md)
Checked: S2-R1,R2,R4,R6,R7,R8,R9,R10, S2-G1..G6, S2-F1, S2-V1; S3-R1..R7, S3-G1..G8, S3-T1, S3-F1, S3-V1.
S3-G8 (probe OAuth rework) satisfied by the prior `ea1b935` commit and confirmed consistent.

### Deferred (LEAN — impl present, dedicated test deferred per Steering)
- **S2-R3** (token-expiry re-fetch): expiry+60s-skew refresh IS implemented in `getToken_`; no dedicated
  fake-timer test written.
- **S2-R5** (single-flight concurrency): `tokenInFlight_` single-flight IS implemented; no concurrent-callers test.
- **S2-T1** (token-time-counts-against-budget triangulation): `remaining_(...)` threads the shared deadline into
  the token fetch; no dedicated budget-accounting test.
- Also deferred (hardening, not blocking the functional path): OAuth form-body fallback on a sandbox 400
  (JSON only today), quoteAndPoll overrun-by-≤one-interval assertion, exhaustive error-body permutations,
  `area_level3` metadata.colonia-only path test, service-level 8s-timeout translation test (covered at client level),
  per-product Carta Porte override (D2 — config default only for now).

## Remaining tasks (out of this slice)

S4 (docs & `.env.template`) and the apply-time live PRO gates (`G-S5.0a`, `G-S5.0b`, `G-S5.5`, which require
live sandbox credentials) remain `- [ ]` in `tasks.md`, plus the deferred lean-hardening items listed above.
Next dependency-ready slice is **S4** (docs/env) or `sdd-verify`.

## Workload / PR boundary
- Chain strategy: chained PRs. **PR 1 (S1 — credential schema)** landed `656f4b8`; the OAuth probe landed
  `ea1b935`. This progress covers the combined **S2 + S3 functional core** (client OAuth transport + service
  seams) as one buildable, green slice — the shipping path now works end-to-end on PRO. Next PR: **S4 (docs & env)**.

## Structured status consumed / produced (S1)
- Consumed: parent-provided authoritative SDD status (artifact store `openspec`, Engram DOWN, active
  change `skydropx-pro-oauth-migration`, branch `feat/skydropx-pro-oauth`, strict TDD active,
  single-slice S1). No `actionContext` warnings; all edits inside the workspace root.
- Produced: this `apply-progress.md`; S1 task checkboxes flipped to `- [x]`.

## Structured status consumed / produced (S2 + S3)
- Consumed: parent-provided authoritative SDD status (artifact store `openspec` FILES only, Engram DOWN,
  active change `skydropx-pro-oauth-migration`, branch `feat/skydropx-pro-oauth`, strict TDD active). No
  `actionContext` warnings; all edits inside the workspace root
  (`apps/backend/src/modules/skydropx-fulfillment/**` + tasks/apply-progress). Storefront and docs (S4)
  untouched per boundaries.
- Produced: merged S2+S3 progress into this `apply-progress.md`; S2/S3 task checkboxes flipped to `- [x]`
  (deferred lean items left `- [ ]` with rationale).

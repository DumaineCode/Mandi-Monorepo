# Skydropx Fulfillment (PRO / OAuth2) Specification

## Purpose

Define the behavior the `skydropx-fulfillment` module MUST exhibit after migrating
from the deprecated Skydropx legacy v1 REST API (API-Key `Token token=`, synchronous
quotation, single-step label) to **Skydropx PRO** (OAuth2 client-credentials, async
two-step quotation, Carta Porte-aware labels).

This spec describes WHAT must be true — wire behavior, credential shape, degradation
rules, and regression invariants — not HOW it is implemented. It closes runbook gate
**S5.0b** (API generation + IVA) and enables closing **S5.0a** (address sourcing) and
**S5.5** (live sandbox quote + label).

Requirements are grouped by capability. Each requirement carries a gate mapping where
one applies. Where a requirement depends on an unresolved design question, the
dependency is stated explicitly; the spec does NOT resolve it.

Authoritative wire shapes: `openspec/changes/skydropx-pro-oauth-migration/pro-api-reference.md`.

---

## Requirements

## Capability 1 — Credential schema (two-secret: clientId + clientSecret)

> Gate: **S5.0b** (auth generation). Risk mitigations: R-B (two-secret propagation), R-D (SSRF host).

### Requirement: Provider secrets are clientId + clientSecret (encrypted)

The system MUST model Skydropx provider credentials as **two encrypted secrets**,
`clientId` and `clientSecret`, replacing the single legacy `apiKey` secret. The
`public_config` MUST retain `originZip` and `taxInclusive`, MUST carry `baseUrl`
whose default flips to the Skydropx PRO host (see Requirement: PRO base URL default),
and MUST support optional `consignmentNote` (MX Carta Porte SAT code default) and
`packageType` (MX package_type default) used for label creation. These two public fields
MUST be propagated through every layer that carries public config (resolved config, merge,
seed, write-path validation, admin API schema, admin form-model) so they reach
`createFulfillment`. No layer MAY continue to model `apiKey` as a Skydropx secret.

#### Scenario: Resolved config exposes two secrets and public config

- GIVEN a stored, enabled Skydropx `provider_setting` row with encrypted `clientId` and `clientSecret`
- WHEN provider settings resolve the Skydropx credential
- THEN the resolved config exposes `clientId`, `clientSecret`, `baseUrl`, `originZip`, and optional `taxInclusive`
- AND it exposes NO `apiKey` field

#### Scenario: Legacy apiKey field is absent from the resolved config type

- GIVEN the Skydropx resolved-config contract
- WHEN a consumer reads the credential shape
- THEN `apiKey` is not a member of the Skydropx resolved-config type anywhere in the codebase

### Requirement: PRO base URL default

The system MUST default the Skydropx `baseUrl` to the Skydropx PRO host when no
`baseUrl` is supplied in public config. The legacy default
`https://api.skydropx.com/v1` MUST NOT remain the default.

> **Dependency (Open Question 1):** the exact PRO host (`api-pro.skydropx.com` per doc
> note vs `pro.skydropx.com` per doc curl examples) is unresolved and MUST be pinned in
> design/apply against live sandbox creds. This requirement fixes the *behavior* (default
> flips to a PRO host under `*.skydropx.com`); the exact string is a design decision.

#### Scenario: Missing baseUrl resolves to the PRO default host

- GIVEN a Skydropx credential row with no `baseUrl` in public config
- WHEN the resolved config is merged
- THEN `baseUrl` is set to the configured Skydropx PRO default host
- AND that host is under `*.skydropx.com` (SSRF allowlist compatible)

#### Scenario: Explicit baseUrl is preserved

- GIVEN a Skydropx credential row with an explicit `baseUrl` in public config
- WHEN the resolved config is merged
- THEN the explicit `baseUrl` is preserved unchanged

### Requirement: Seed env mapping uses PRO client credentials

The seed MUST map Skydropx credentials from `SKYDROPX_CLIENT_ID` and
`SKYDROPX_CLIENT_SECRET` (both in the required-env set), and MUST retain
`originZip`, `baseUrl`, and `taxInclusive` public mappings. The seed MUST NOT
reference `SKYDROPX_API_KEY`. Seed remains sandbox-mode; DB is authoritative at runtime.

#### Scenario: Seed maps both client secrets from env

- GIVEN env with `SKYDROPX_CLIENT_ID` and `SKYDROPX_CLIENT_SECRET` set
- WHEN the seed builds the Skydropx credential payload
- THEN it maps `clientId` from `SKYDROPX_CLIENT_ID` and `clientSecret` from `SKYDROPX_CLIENT_SECRET`
- AND it maps `originZip`, `baseUrl`, `taxInclusive` from their existing public env vars

#### Scenario: Seed requires both client secrets

- GIVEN env missing `SKYDROPX_CLIENT_ID` or `SKYDROPX_CLIENT_SECRET`
- WHEN the seed validates required env for Skydropx
- THEN seeding of the Skydropx credential is treated as not-configured (skipped/failed per existing required-env behavior)
- AND no partial single-secret row is written

### Requirement: Write-path validation enforces the two-secret shape

The write-path validation MUST list `clientId` and `clientSecret` as Skydropx secret
fields and `baseUrl`, `originZip`, `taxInclusive` as public fields, and its zod schema
MUST accept `clientId` and `clientSecret` (optional on upsert, consistent with
partial-secret update behavior) plus the existing public fields. It MUST NOT accept or
route `apiKey` as a Skydropx field.

#### Scenario: Valid two-secret upsert passes validation

- GIVEN an admin upsert payload for skydropx with `clientId`, `clientSecret`, `originZip`
- WHEN the write-path validation runs
- THEN the payload validates
- AND `clientId`/`clientSecret` are classified as secret fields and `originZip`/`baseUrl`/`taxInclusive` as public fields

#### Scenario: Legacy apiKey field is rejected or ignored per schema

- GIVEN an admin upsert payload for skydropx containing `apiKey`
- WHEN the write-path validation runs
- THEN `apiKey` is not treated as a valid Skydropx secret field

### Requirement: Admin API middleware schema accepts two secrets

The admin provider-settings API middleware validation (the `TestProviderConnectionBody`
schema in `api/middlewares.ts`, which uses `.strip()`) MUST explicitly accept `clientId`,
`clientSecret`, `originZip`, `baseUrl` (url, optional), `taxInclusive`, `consignmentNote`,
and `packageType` for skydropx, and MUST NOT accept `apiKey`. Because the schema strips
unlisted fields, any secret not listed is silently dropped — so both secrets MUST be listed.

#### Scenario: Two secrets survive the stripping schema

- GIVEN a POST to the admin provider-settings test-connection route with a skydropx body carrying `clientId`, `clientSecret`, `originZip`
- WHEN the middleware validates and strips the body
- THEN `clientId` and `clientSecret` are retained (not stripped) and validation succeeds

### Requirement: Stored baseUrl is SSRF-allowlisted at write time

The write path MUST reject a Skydropx `baseUrl` whose host is not under `*.skydropx.com`
(reusing `isAllowedSkydropxBaseUrl`), and the client MUST defensively refuse a
non-allowlisted host before any request. This prevents a stored `baseUrl` from exfiltrating
`clientId`/`clientSecret` to an arbitrary host via the OAuth token POST.

#### Scenario: Non-skydropx baseUrl is rejected on save

- GIVEN an admin upsert with a `baseUrl` whose host is not under `skydropx.com`
- WHEN the write-path validation runs
- THEN the upsert is rejected (not persisted)

#### Scenario: Client refuses a non-allowlisted host

- GIVEN a client constructed with a non-`skydropx.com` `baseUrl`
- WHEN any request is attempted
- THEN the client throws before issuing the request (no secrets leave the process)

### Requirement: Admin form-model exposes two secret fields

The admin form-model for skydropx MUST render two secret/password fields (`clientId`
and `clientSecret`) alongside the existing `originZip` (text), `baseUrl` (text,
optional), and `taxInclusive` (boolean) fields. Skydropx MUST remain a known provider.

#### Scenario: Skydropx form shows two masked secret inputs

- GIVEN the admin provider-settings form for skydropx
- WHEN it renders
- THEN it presents a `clientId` secret/password field and a `clientSecret` secret/password field
- AND it presents `originZip`, `baseUrl`, and `taxInclusive` fields
- AND it presents no `apiKey` field

### Requirement: Probe required fields are the two secrets

The probe credential resolution MUST require `clientId` and `clientSecret` (plus
`originZip`) for skydropx, replacing the `apiKey` requirement.

#### Scenario: Probe requires both client secrets

- GIVEN a skydropx probe credential resolution
- WHEN required fields are checked
- THEN `clientId`, `clientSecret`, and `originZip` are required
- AND `apiKey` is not required

### Requirement: Masking behavior is unchanged

The system MUST preserve the existing generic secret-masking behavior for the new
secrets. `SecretHint.last4` MUST be computed only when the plaintext is ≥ 8 chars;
short `clientId` values are fully masked, and `clientSecret` follows the same generic
rule. No skydropx-specific masking logic is introduced.

#### Scenario: Long secret shows last4, short secret is fully masked

- GIVEN a `clientSecret` of ≥ 8 chars and a `clientId` shorter than 8 chars
- WHEN masking hints are produced at write time
- THEN `clientSecret` yields a `last4` hint
- AND `clientId` is fully masked with no `last4`

---

## Capability 2 — OAuth2 token client (client-credentials Bearer)

> Gate: **S5.0b** (auth generation). Risk mitigations: R-C (token lifecycle vs 8s budget), R-D (SSRF), R-rate-limit.

### Requirement: Bearer token is fetched via client-credentials grant

The client MUST obtain an access token by `POST`ing to the PRO OAuth token endpoint
(`/api/v1/oauth/token`) with `grant_type=client_credentials`, `client_id`, and
`client_secret`, and MUST read `access_token` and `expires_in` from the 200 response.
All subsequent API calls MUST send `Authorization: Bearer {access_token}`. No request
MAY send the legacy `Authorization: Token token=` header.

#### Scenario: Token obtained then used as Bearer

- GIVEN valid `clientId` and `clientSecret`
- WHEN the client makes its first API call
- THEN it first POSTs `grant_type=client_credentials` with the two secrets to `/api/v1/oauth/token`
- AND it uses the returned `access_token` as `Authorization: Bearer {access_token}` on the API call

#### Scenario: No legacy auth header is ever sent

- GIVEN any Skydropx API request in the migrated client
- WHEN the request headers are inspected
- THEN no header equals or contains `Token token=`

### Requirement: Token is cached ~2h and refreshed on expiry

The client MUST cache the Bearer token for its lifetime (per `expires_in`, ~7200s / 2h)
and reuse it across calls, so only the first call (or a call after expiry) pays a token
round-trip. The client MUST refresh (re-fetch) the token when it is expired.

> **Dependency (Open Question 6):** the token cache scope (per-credential-fingerprint
> in-process cache vs shared store) is a design decision. This requirement fixes the
> observable behavior (reuse within TTL, refresh on expiry) regardless of cache location.

#### Scenario: Second call within TTL reuses the cached token

- GIVEN a token was fetched and its `expires_in` has not elapsed
- WHEN a second API call is made with the same credentials
- THEN no new token request is issued
- AND the cached token is reused

#### Scenario: Call after expiry re-fetches the token

- GIVEN a cached token whose lifetime has elapsed
- WHEN a new API call is made
- THEN the client fetches a fresh token before the call

### Requirement: 401 triggers a single token refresh and one retry

When an authenticated API call returns 401, the client MUST refresh the token once and
retry the call a single time. If the retry also fails, the failure MUST surface (no
infinite retry loop).

#### Scenario: 401 then success after refresh

- GIVEN an API call that returns 401 with a stale cached token
- WHEN the client handles the 401
- THEN it refreshes the token once and retries the call once
- AND if the retry returns 2xx, the operation succeeds

#### Scenario: 401 on retry surfaces the failure

- GIVEN an API call that returns 401, and the retried call after refresh also returns 401
- WHEN the client exhausts its single retry
- THEN the failure propagates as a typed API error (no further retries)

### Requirement: Token fetch failure degrades quotation gracefully

If the token fetch itself fails (network error, non-2xx from the token endpoint, or
timeout), a quotation MUST fail gracefully via `MedusaError`, degrading checkout to the
`manual` provider (SD-3). It MUST NOT crash checkout.

#### Scenario: Token endpoint failure degrades quote to manual

- GIVEN the token endpoint returns an error or times out
- WHEN `calculatePrice` runs
- THEN the quotation fails with a graceful `MedusaError`
- AND checkout degrades to the `manual` provider without crashing

### Requirement: SSRF allowlist restricts hosts to *.skydropx.com

All Skydropx HTTP calls (token endpoint and API endpoints) MUST target `https` hosts
under `*.skydropx.com`; the existing `isAllowedSkydropxBaseUrl` guard MUST remain in
force and MUST NOT be widened to admit non-`skydropx.com` hosts.

> **Dependency (Open Question 1 / R-D):** that the pinned PRO host (`api-pro.skydropx.com`)
> matches the allowlist MUST be verified in sandbox during design/apply. The allowlist is
> not to be broadened blindly.

#### Scenario: Non-skydropx host is refused

- GIVEN a configured `baseUrl` whose host is not under `skydropx.com`
- WHEN a Skydropx call is attempted
- THEN the SSRF guard refuses the request

#### Scenario: PRO host under skydropx.com is allowed

- GIVEN the pinned PRO host under `*.skydropx.com` over `https`
- WHEN the SSRF guard evaluates it
- THEN the host is allowed

### Requirement: Respect the 2 req/s rate limit

The client MUST operate within the Skydropx 2 requests/second limit. Reuse of the
cached token, a single in-flight quote per checkout, and a poll interval no shorter
than the rate limit MUST be honored so token fetch + quote poll do not exceed the cap.

#### Scenario: Poll interval respects the rate cap

- GIVEN an async quotation being polled
- WHEN successive poll requests are issued
- THEN the interval between requests is ≥ the 2 req/s limit
- AND the cached token is reused rather than re-fetched per poll

---

## Capability 3 — Async quotation (two-step) within the 8s checkout budget

> Gates: **S5.0b** (IVA), **S5.5** (live quote). Risk mitigations: R-async poll latency, R-C, R-E (IVA).

### Requirement: Quotation is created then polled to completion

The client MUST create a quotation via `POST /api/v1/quotations` (returning `{ id,
is_completed, rates }`) and then poll `GET /api/v1/quotations/{id}` until
`is_completed: true`, at which point it reads `rates[]`. Rates fill progressively; the
client MUST NOT read rates as final while `is_completed` is false.

#### Scenario: Create then poll until completed

- GIVEN a create-quotation response with `is_completed: false`
- WHEN the client polls the quotation
- THEN it repeats `GET /quotations/{id}` until `is_completed: true`
- AND only then reads `rates[]`

### Requirement: Whole quote flow stays inside the shared 8s budget

The token fetch (if any), quotation create, and completion polling MUST all share a
single `SKYDROPX_QUOTATION_TIMEOUT_MS` (8s) budget enforced by one `AbortController`.
If the quotation does not complete within the budget, the client MUST treat it as a
quote failure.

#### Scenario: Timeout before completion degrades to manual

- GIVEN a quotation that never reaches `is_completed: true` within 8s
- WHEN the shared budget elapses
- THEN the quote fails with a graceful `MedusaError`
- AND checkout degrades to the `manual` provider (SD-3)

#### Scenario: Token fetch time counts against the same budget

- GIVEN a first-call quote that must also fetch a token
- WHEN the budget is measured
- THEN token fetch, create, and poll all consume the single 8s `AbortController` budget

### Requirement: Cheapest rate selection is deterministic (tie-break preserved)

From the completed `rates[]`, the client MUST select the cheapest by `rate.total`
(numeric), breaking ties by fewest `days`, then by carrier name alphabetically —
preserving the existing deterministic tie-break used by both quote and label paths.

#### Scenario: Cheapest total wins

- GIVEN rates with distinct `total` values
- WHEN selection runs
- THEN the rate with the lowest numeric `total` is selected

#### Scenario: Tie on total broken by days then carrier

- GIVEN two rates with equal `total`
- WHEN selection runs
- THEN the rate with fewer `days` is selected
- AND if `days` are also equal, the carrier earliest alphabetically is selected

### Requirement: calculated_amount and IVA treatment are pinned

The quote result MUST set `calculated_amount = Number(rate.total)` (MXN as-is, never
cent-converted) and `is_calculated_price_tax_inclusive: true`, because `rate.total` is
IVA-inclusive per the PRO reference. All `TODO(sandbox-verify)` IVA markers MUST be
removed (gate S5.0b closed). The DB `taxInclusive` override MUST continue to be honored,
and the value MUST NOT be read from any `SKYDROPX_TAX_INCLUSIVE` env at runtime.

> Gate: **S5.0b — CLOSED.** Live reconciliation (`vat_fee` reconciles against `total`)
> is confirmed at S5.5.

#### Scenario: Amount taken from rate.total tax-inclusive

- GIVEN a selected rate with `total: "123.45"`
- WHEN the quote result is built
- THEN `calculated_amount` equals `123.45` (numeric, not multiplied by 100)
- AND `is_calculated_price_tax_inclusive` is `true`

#### Scenario: DB taxInclusive:false override is honored

- GIVEN a resolved config with `taxInclusive: false`
- WHEN the quote result is built
- THEN `is_calculated_price_tax_inclusive` is `false`
- AND no `SKYDROPX_TAX_INCLUSIVE` env is read at runtime

### Requirement: Empty/failed quotation degrades to manual

If the quotation returns zero usable rates, errors, or the poll/timeout fails, the
client MUST fail gracefully with a `MedusaError` and degrade checkout to `manual` (SD-3).

#### Scenario: Zero rates degrades to manual

- GIVEN a completed quotation whose `rates[]` is empty (or all rates unusable)
- WHEN `calculatePrice` runs
- THEN it fails with a graceful `MedusaError`
- AND checkout degrades to `manual` without crashing

#### Scenario: Unpriced/no-coverage rates are filtered before selection

- GIVEN a completed quotation whose `rates[]` mixes priced rates with unpriced ones (`success:false`, `status` in `no_coverage`/`tariff_price_not_found`/`not_applicable`/`pending`, or non-finite `total`)
- WHEN the cheapest rate is selected
- THEN only usable rates (`success:true` AND finite numeric `total`) are considered
- AND `calculated_amount` is never `NaN`
- AND if no usable rate remains, checkout degrades to `manual` (SD-3)

---

## Capability 4 — Full destination address sourcing at calculatePrice

> Gate: **S5.0a** (address sourcing, expanded). Risk mitigations: R (missing-address degrade).

### Requirement: Quotation sends the destination address hierarchy (area_level3 best-effort)

At `calculatePrice`, the quotation MUST source and send `country_code`, `postal_code`,
`area_level1` (state), and `area_level2` (city) as **required** fields, replacing the
legacy zip-only (`zip_from`/`zip_to`) model. `area_level3` (neighborhood/colonia) MUST be
included **when the cart provides it** (best-effort sourcing); it is not fabricated when
absent. `area_level1` MUST be sent in the format PRO expects (full state name), normalizing
any ISO/abbreviated `province` code.

> **Dependency (Open Question 3 / gate S5.0a):** the sourcing of `area_level1/2/3` from the
> Medusa `calculatePrice` context (shipping-address `province`/`city`/`address_2`/`metadata`,
> code→name normalization, or a postal-code lookup) is a design decision, and whether PRO
> *mandates* `area_level3` MUST be confirmed in sandbox. If PRO mandates `area_level3` and the
> cart cannot supply it, the provider degrades to manual (see the degrade requirement below).

#### Scenario: Address present on the quotation request

- GIVEN a cart whose shipping address yields country, postal code, state, and city
- WHEN the quotation request is built
- THEN `address_to` includes `country_code`, `postal_code`, `area_level1` (normalized state name), `area_level2`

#### Scenario: Neighborhood included only when available

- GIVEN a cart shipping address that carries a colonia (via `address_2` or metadata)
- WHEN the quotation request is built
- THEN `address_to.area_level3` is populated from that source
- AND GIVEN a cart with no colonia source, `area_level3` is omitted (not fabricated)

### Requirement: Missing destination address degrades to manual (no crash)

If any required destination address component is missing at `calculatePrice`, the
provider MUST degrade gracefully to `manual` (SD-3) rather than crash checkout —
consistent with the existing missing-dims fallback isolated in the `toParcelItems` seam.

#### Scenario: Missing required state/city degrades gracefully

- GIVEN a cart shipping address missing `area_level1` or `area_level2`
- WHEN `calculatePrice` runs
- THEN the provider degrades to `manual` (SD-3) before any API call
- AND checkout does not crash

#### Scenario: PRO-mandated neighborhood with no source degrades gracefully

- GIVEN sandbox confirms PRO mandates `area_level3` AND the cart has no colonia source
- WHEN `calculatePrice` runs
- THEN the provider degrades to `manual` (SD-3)
- AND checkout does not crash

#### Scenario: Missing dimensions still degrades gracefully

- GIVEN a cart line item with no resolvable weight/dimensions
- WHEN `calculatePrice` runs
- THEN the provider degrades to `manual` via the existing seam fallback without crashing

---

## Capability 5 — Label purchase and cancellation (PRO shipment model)

> Gates: **S5.5** (admin label + tracking). Risk mitigations: R-Carta Porte, R-requires_origin_verification, SD-4.

### Requirement: Label creation uses the PRO shipment model with MX required fields

Admin label purchase MUST create a shipment against the PRO API using the selected
`rate_id`, full `address_from`/`address_to` fields, and `packages[]` that include the
MX-required `consignment_note` (Carta Porte SAT code) and `package_type`. It MUST then
resolve `label_url` and `tracking` (master tracking number), polling for label
readiness within the existing bounded label-poll window.

> **Dependency (Open Question 2):** how `consignment_note` and `package_type` are sourced
> per product/carrier is unresolved. Until design resolves sourcing, MX label purchase
> MUST fail loudly (SD-4) rather than send a wrong SAT code (see next requirement).
>
> **Dependency (Open Question 4):** the endpoint choice — two-step `POST /api/v1/shipments`
> from a quotation `rate_id` vs one-shot `POST /api/v1/rate/shipments` — is a design
> decision. This requirement fixes the required inputs and outputs, not the endpoint.

#### Scenario: Successful label produces url and tracking

- GIVEN a selected rate and complete address + package data (including `consignment_note` and `package_type`)
- WHEN the admin purchases a label
- THEN a shipment is created and polled to readiness within the label-poll bound
- AND the result carries `label_url` and a tracking number

### Requirement: Missing Carta Porte data or origin verification fails loudly

If `consignment_note`/`package_type` cannot be sourced, or the selected rate carries
`requires_origin_verification: true`, admin label purchase MUST fail with a clear
`MedusaError.UNEXPECTED_STATE` (SD-4) and MUST NOT send a wrong SAT code or a rate that
will 422. Any orphaned/partial label MUST be best-effort abandoned.

> **Dependency (Open Question 5):** whether `requires_origin_verification` is surfaced as
> a "fail loudly" error or as an admin action to verify origin is a design decision; this
> requirement fixes the minimum safe behavior (fail loudly, no wrong SAT code).

#### Scenario: Unsourceable Carta Porte code fails loudly

- GIVEN a label request where `consignment_note`/`package_type` cannot be determined
- WHEN the admin attempts the purchase
- THEN it fails with `MedusaError.UNEXPECTED_STATE` (SD-4)
- AND no shipment is created with a guessed/wrong SAT code

#### Scenario: requires_origin_verification surfaces a clear error

- GIVEN a selected rate with `requires_origin_verification: true`
- WHEN the admin attempts the purchase
- THEN a clear admin error is surfaced (not a raw 422)

### Requirement: Label failure abandons best-effort

If shipment/label creation fails after partial progress, the provider MUST raise
`MedusaError.UNEXPECTED_STATE` (SD-4) and MUST attempt a best-effort abandon/cancel of
any orphaned label so no dangling label persists.

#### Scenario: Orphaned label is abandoned on failure

- GIVEN a label creation that fails after a shipment/label resource was created
- WHEN the failure is handled
- THEN a best-effort abandon is attempted for the orphaned resource
- AND the operation fails with `MedusaError.UNEXPECTED_STATE`

### Requirement: Cancellation uses the PRO cancellations endpoint

Cancellation MUST call `POST /api/v1/shipments/{shipment_id}/cancellations` (replacing
the legacy `POST /labels/{id}/cancel`). The existing log-and-proceed behavior of
`cancelFulfillment` is preserved.

#### Scenario: Cancel hits the cancellations endpoint

- GIVEN an existing shipment to cancel
- WHEN cancellation runs
- THEN it POSTs to `/api/v1/shipments/{shipment_id}/cancellations`
- AND the legacy `/labels/{id}/cancel` path is not used

---

## Capability 6 — Regression invariants (MUST hold)

> Cross-cutting. Risk mitigations: R-A (test churn), R-B (fail-safe-null).

### Requirement: No legacy auth artifacts remain anywhere

The system MUST retain no reference to `apiKey`, `SKYDROPX_API_KEY`, or the
`Authorization: Token token=` header in code, seed, validation, admin, probes,
fixtures, or docs for skydropx.

#### Scenario: Codebase is free of legacy auth references

- GIVEN the migrated codebase and fixtures
- WHEN searched for `apiKey`, `SKYDROPX_API_KEY`, and `Token token=` in skydropx scope
- THEN no such reference remains

### Requirement: Manual fallback provider stays registered

The `manual` fulfillment provider MUST remain registered so any failed PRO quote or
label always degrades to manual checkout (SD-3). The skydropx registration in
`medusa-config.ts` MUST be unchanged by this migration.

#### Scenario: Manual provider available on PRO failure

- GIVEN a PRO quote or label failure
- WHEN checkout resolves shipping options
- THEN the `manual` provider is available as the degradation path

### Requirement: Unconfigured provider is inert and fail-safe

With no configured skydropx credentials (no row / disabled / no secrets / decrypt fail),
credential resolution MUST return null and the provider MUST behave as unconfigured
(inert), never throwing loudly at construction and never touching the container at
construction time.

#### Scenario: No credentials resolves as unconfigured

- GIVEN no enabled skydropx credential row
- WHEN the provider resolves credentials for an operation
- THEN resolution returns null and the provider is inert (no crash, no container access at construction)

### Requirement: validateOptions accepts empty options

`validateOptions` MUST accept EMPTY options as valid (credentials are DB-resolved), and
MUST update any option-name guard away from `apiKey`.

#### Scenario: Empty options are valid

- GIVEN empty provider options
- WHEN `validateOptions` runs
- THEN it does not throw

### Requirement: Prices are stored as-is (no cent conversion)

The provider MUST NOT multiply by 100 when saving or divide by 100 when displaying
prices. `calculated_amount` MUST equal `Number(rate.total)` in MXN as-is.

#### Scenario: No cent conversion applied

- GIVEN `rate.total = "99.90"`
- WHEN the quote result is built
- THEN `calculated_amount` equals `99.90` (not `9990`)

### Requirement: Migration is developed under strict TDD

All changed behavior MUST be covered by rewritten unit specs that preserve every
existing behavioral case (cheapest-rate tie-breaks, timeout → graceful, poll bound,
orphaned-label cancel, unconfigured fail-safe, `validateOptions` empty-ok, IVA default
and DB override) while updating auth/URL/two-secret fixtures. No behavioral case MAY be
silently dropped during the test rewrite.

#### Scenario: Behavioral coverage preserved through rewrite

- GIVEN the pre-migration behavioral test cases
- WHEN the specs are rewritten for PRO auth/URLs/two-secret fixtures
- THEN each pre-existing behavioral case has an equivalent case in the new specs
- AND all migrated unit specs are green

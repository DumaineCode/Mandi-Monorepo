# Proposal — skydropx-pro-oauth-migration

## 1. Problem & motivation

The `skydropx-fulfillment` module talks to the **deprecated Skydropx legacy v1 REST API**
(API-Key auth `Authorization: Token token={key}`, base `https://api.skydropx.com/v1`,
synchronous quotation, single-step label). Skydropx has moved shipping onto **Skydropx PRO**
(OAuth2 client-credentials, host `api-pro.skydropx.com`, async two-step quotation, Carta
Porte-aware labels). The legacy generation is on a deprecation path; leaving it in place puts
**domestic MX checkout shipping quotes and admin label purchase** — the only live shipping
flows in production — at risk of breaking with no warning.

This migration is also the mechanism that finally **closes gate S5.0b** (Skydropx API
generation + IVA treatment), which has sat as `TODO(sandbox-verify)` in `types.ts` since the
module was written. The operator now holds Skydropx PRO credentials, so this change targets
closing S5.0b live rather than deferring it again.

The authoritative PRO wire shapes are captured in
`openspec/changes/skydropx-pro-oauth-migration/pro-api-reference.md` (fetched from the official
api-docs) and already resolve most of the previously-unverified shapes.

## 2. Goals

1. **Hard-swap** the module and all its credential/probe/validation layers from legacy v1 to
   Skydropx PRO. Legacy code paths are **removed**, not flag-gated (settled decision).
2. Replace the single `apiKey` secret with **two secrets `clientId` + `clientSecret`** across
   every layer that references the credential (~10 files), plus admin form, seed, and validation.
3. Implement an **OAuth2 client-credentials token client**: `POST /api/v1/oauth/token` →
   cached Bearer token (TTL 7200s / 2h), refreshed on expiry/401, respecting the 2 req/s limit.
4. Rewrite quotation to the **async two-step model** (`POST /api/v1/quotations` →
   poll `GET /api/v1/quotations/{id}` until `is_completed`) and keep it **inside the existing
   8s checkout budget** (`SKYDROPX_QUOTATION_TIMEOUT_MS`).
5. Source the **full destination address hierarchy** (`country_code`, `postal_code`,
   `area_level1`=state, `area_level2`=city, `area_level3`=neighborhood) at `calculatePrice`
   time — expanding the S5.0a sourcing responsibility, isolated in the `toParcelItems` seam.
6. Rewrite admin **label purchase** to the PRO shipment model (`POST /api/v1/shipments` two-step
   or `POST /api/v1/rate/shipments` one-shot) including MX-required `consignment_note`
   (Carta Porte SAT code) + `package_type`, and **cancel** via
   `POST /api/v1/shipments/{id}/cancellations`.
7. Confirm and pin **IVA treatment**: `rate.total` is IVA-inclusive → keep
   `is_calculated_price_tax_inclusive: true`, use `calculated_amount = Number(rate.total)`
   (no cent conversion — Medusa stores prices as-is).
8. Update **docs alongside code in the same change**:
   `docs/runbooks/mx-payments-shipping.md` (§1a env, §5 gates, §7 signals),
   `apps/backend/.env.template`, `docs/runbooks/obtener-credenciales-proveedores.md`.
9. Keep the migration seam narrow: business logic stays in the provider service + workflow
   probe steps; **no new API routes, module links, or data models** are introduced (Medusa
   architecture: this is a fulfillment provider change, not a new module surface).

## 3. Non-goals (explicitly out of scope for this change)

- International shipping (non-MX `country_code`), multi-package / multishipment, pickups,
  office/drop-off points (`office_points`), and order sync.
- Skydropx **webhooks / tracking event ingestion** (HMAC-SHA512). Tracking stays at the
  current bounded-poll model; no webhook endpoint is added.
- **Data-migration script** for existing DB credential rows. Migration is **manual re-entry
  in Admin** (operator deletes the old `apiKey` row, pastes `clientId`/`clientSecret`) — settled
  decision, no automated backfill.
- Storefront changes. Skydropx is intentionally omitted from public `provider-config`
  (`PUBLIC_PROVIDERS = ["openpay","mercadopago"]`); that stays.
- Registration/auth-model changes in `medusa-config.ts` (the `manual` fallback provider and
  `skydropx` registration are unchanged; only the module internals swap).
- Carrier selection UX / `requested_carriers` tuning beyond parity with today's behavior.

**First slice = domestic MX quote + label parity with what works today, on PRO.**

## 4. Scope & affected areas

Primary seam (design R3 promise — "a migration to Pro/OAuth only touches this file"):
- `modules/skydropx-fulfillment/client.ts` — OAuth token flow, Bearer auth, PRO base URL,
  async quote poll, PRO shipment/label/cancel endpoints.

Credential two-secret propagation (`apiKey` → `clientId` + `clientSecret`):
- `modules/skydropx-fulfillment/types.ts` (`SkydropxCredentials`, wire shapes, remove TODO markers)
- `modules/skydropx-fulfillment/service.ts` (`validateOptions` guard, IVA default, address sourcing)
- `modules/provider-settings/types.ts` (`SkydropxResolvedConfig`, `SKYDROPX_DEFAULT_BASE_URL` → PRO)
- `modules/provider-settings/service.ts` (`mergeResolvedConfig` skydropx branch)
- `scripts/seed-provider-settings.core.ts` (env mapping → `SKYDROPX_CLIENT_ID`/`SKYDROPX_CLIENT_SECRET`)
- `workflows/steps/validate-provider-payload.ts` (`PROVIDER_SECRET_FIELDS`/`PUBLIC_FIELDS`, zod schema)
- `api/admin/provider-settings/middlewares.ts` (validation union)
- `admin/routes/provider-settings/form-model.ts` (`PROVIDER_FORMS.skydropx` two secret fields)
- `workflows/steps/probes/skydropx.ts` + `workflows/steps/probes/index.ts` (OAuth probe)
- `workflows/steps/resolve-probe-credentials.ts` (`PROBE_REQUIRED_FIELDS.skydropx`)

Tests to rewrite (high churn — auth header, literal v1 URLs, `apiKey` fixtures):
- `modules/skydropx-fulfillment/__tests__/service.unit.spec.ts`
- `modules/provider-settings/__tests__/service.unit.spec.ts`
- `workflows/steps/__tests__/validate-provider-payload.unit.spec.ts`
- `workflows/steps/__tests__/resolve-probe-credentials.unit.spec.ts`
- `workflows/steps/probes/__tests__/probes.unit.spec.ts`
- `admin/routes/provider-settings/__tests__/form-model.unit.spec.ts`

Docs:
- `docs/runbooks/mx-payments-shipping.md` (§1a, §5, §7)
- `apps/backend/.env.template`
- `docs/runbooks/obtener-credenciales-proveedores.md`

`public_config` keeps `originZip`, `taxInclusive`; `baseUrl` default flips to the PRO host.
**Not affected:** `parcel.ts` logic (grams/cm→kg/cm math unchanged; parcel field names verified),
store `provider-config`, storefront.

## 5. Delivery — review budget & proposed slice split (NOT finalized)

**Forecast: this change very likely exceeds the 600-line review budget** (two-secret propagation
across ~10 files + 6 test specs + client rewrite + docs). Auto-forecast flags **chained PRs
recommended**. Proposed split for review sanity — to be confirmed at tasks/apply time, not
finalized here:

- **S1 — Credential schema (clientId/clientSecret) across all layers**: types, provider-settings
  (types/service/merge-default), seed, validate-provider-payload (secret/public maps + zod),
  admin middlewares, admin form-model, plus the fixtures/assertions in the affected non-client
  specs. Ships a coherent "PRO-shaped credentials" slice with green tests, no behavior swap yet.
- **S2 — OAuth token client + quote/label rewrite** in `client.ts` and `service.ts`: token
  caching/refresh, Bearer auth, PRO endpoints, IVA pin, `validateOptions` guard. Rewrites
  `service.unit.spec.ts` auth/URL assertions.
- **S3 — Async quotation polling + full-address sourcing**: two-step quote within the 8s budget,
  `area_level1/2/3` sourcing in the `toParcelItems`/`calculatePrice` seam, `consignment_note` +
  `package_type` sourcing for labels, probe OAuth rework.
- **S4 — Docs & env**: runbook §1a/§5/§7, `.env.template`, credentials runbook.

Boundaries between S2/S3 may move (the client and service touch each other); the orchestrator
should apply the cached delivery strategy and confirm the chain before apply. **Do not treat this
split as final.**

## 6. Success criteria

Mapped to the deferred runbook gates:

- **S5.0a (address sourcing) — expanded & exercised**: at `calculatePrice`, the cart's shipping
  address yields `country_code`/`postal_code`/`area_level1`/`area_level2`/`area_level3`; a
  missing-address / missing-dims cart degrades gracefully to `manual` (SD-3), no checkout crash.
- **S5.0b (API generation + IVA) — CLOSED**: all `TODO(sandbox-verify)` markers removed from
  `types.ts`; auth is OAuth2 client-credentials against PRO; `calculated_amount = Number(rate.total)`
  with `is_calculated_price_tax_inclusive: true`, verified against a live PRO quote (no double/under-tax).
- **S5.5 (live sandbox) — closeable against PRO**: a live checkout quote returns a rate within the
  8s budget, and an admin label purchase produces a valid label + tracking number; cancel works via
  the new cancellations endpoint.
- OAuth token is fetched once and **cached ~2h**, refreshed on expiry/401, without blowing the 8s
  quote budget or the 2 req/s limit.
- No `apiKey` reference remains anywhere in code, seed, validation, admin, probes, or fixtures;
  all unit specs green.
- Existing DB rows: operator can delete the legacy `apiKey` row and re-enter `clientId`/`clientSecret`
  in Admin, and the provider resolves and quotes correctly (manual re-entry path documented).
- Docs (runbook §1a/§5/§7, `.env.template`, credentials runbook) reflect PRO env vars, OAuth model,
  closed gates, and updated log signals.

## 7. Risks & mitigations

- **R-C Token lifecycle vs 8s budget** — OAuth adds a token round-trip inside checkout. *Mitigation:*
  cache the Bearer token (2h TTL) keyed alongside the credential fingerprint; only the first call or
  a post-expiry/401 call pays the token fetch; both token fetch and quote poll share the 8s
  `AbortController` budget; on timeout degrade to manual (SD-3).
- **R-async poll latency** — quotation is now async; rates fill progressively. *Mitigation:* bounded
  poll of `GET /quotations/{id}` inside the 8s budget with a short interval; if `is_completed` never
  arrives in budget, treat as quote failure → graceful `MedusaError` → manual checkout.
- **R-B Fail-safe-null hiding a missed credential layer** — credential resolution returns null on
  no-secrets, so a missed `apiKey`→two-secret touchpoint silently yields "unconfigured" instead of a
  loud error. *Mitigation:* enumerate all ~10 layers in tasks (S1 slice), assert two-secret presence
  in unit tests for each layer, and probe-verify end-to-end before closing S5.5.
- **R-Carta Porte sourcing** — MX labels require `consignment_note` (SAT code) + `package_type`, new
  fields with no current source. *Mitigation:* resolve sourcing strategy in design (per-product /
  per-carrier default vs configurable); until resolved, label purchase for MX must fail loudly (SD-4)
  rather than send a wrong SAT code. Open question below.
- **R-requires_origin_verification** — a rate may carry `requires_origin_verification: true`, causing
  shipment creation to fail until the carrier verifies the origin. *Mitigation:* detect the flag on the
  selected rate and surface a clear admin error (SD-4) instead of a raw 422; document in runbook §7.
- **R-D SSRF host allowlist** — `isAllowedSkydropxBaseUrl` only permits `https` on `*.skydropx.com`.
  `api-pro.skydropx.com` matches the pattern but must be **explicitly verified** in sandbox; a token
  endpoint on a non-`skydropx.com` host would be refused. *Mitigation:* verify the exact host during
  design/apply against live creds; keep the allowlist, don't widen it blindly.
- **R-E IVA correctness** — wrong `is_calculated_price_tax_inclusive` = double/under-tax at checkout.
  *Mitigation:* pro-api-reference confirms `rate.total` is IVA-inclusive; re-confirm against a live
  sandbox quote before closing S5.0b (`vat_fee` should reconcile).
- **R-A Test churn** — specs assert legacy `Token token=` headers and literal v1 URLs; large rewrite
  risks silently dropping behavioral coverage. *Mitigation:* rewrite assertions to PRO
  auth/URLs/two-secret fixtures while **preserving every behavioral case** (cheapest-rate tie-breaks,
  8s timeout → graceful, IN_PROGRESS poll bound, orphaned-label cancel, unconfigured fail-safe,
  `validateOptions` empty-ok); strict-TDD applies.
- **R-rate-limit** — 2 req/s cap; async poll + token fetch could brush it. *Mitigation:* keep poll
  interval ≥ the limit, reuse cached token, single in-flight quote per checkout.

## 8. Rollback

- **Code**: the migration is a hard-swap concentrated in `client.ts` + the credential layers; the
  registration in `medusa-config.ts` is unchanged, and the `manual` fallback provider stays
  registered, so a failed PRO quote/label always degrades to manual checkout (SD-3) rather than
  hard-failing orders. Full rollback = revert the change set (per chained-PR slice if split).
- **Operational**: the legacy `apiKey` DB row must be manually re-entered as `clientId`/`clientSecret`;
  if PRO is misbehaving, the operator can disable the skydropx provider setting (fail-safe-null →
  provider resolves as unconfigured → checkout uses manual). Runbook §7.3 rollback lever updated to
  the PRO model.
- No data migration to unwind (manual re-entry only).

## 9. Open questions (resolve in spec/design)

1. **Exact host per environment**: `api-pro.skydropx.com` (doc note) vs `pro.skydropx.com` (doc curl
   examples) — confirm token host and API host against live sandbox creds, and verify SSRF allowlist match.
2. **`consignment_note` + `package_type` sourcing**: how is the Carta Porte SAT code and package type
   chosen per product / per carrier at label time? Static default, product attribute, or admin input?
3. **Cart shipping address sourcing at `calculatePrice`**: where do `area_level1` (state),
   `area_level2` (city), `area_level3` (neighborhood) come from in the 2.15.5 `calculatePrice` context?
   Cart shipping address fields, a postal-code lookup, or provider-side enrichment in `toParcelItems`?
4. **Label endpoint choice**: two-step `POST /shipments` (from quotation `rate_id`) vs one-shot
   `POST /rate/shipments` for admin purchase — which matches today's admin flow with least churn?
5. **`requires_origin_verification` handling**: fail loudly vs surface an admin action to verify origin?
6. **Token cache scope**: per-credential-fingerprint in-process cache vs shared store — sufficient for
   the 2h TTL under the current per-operation client model?

# Tasks: checkout-shipping-quote-reliability

Authoritative source: `design.md` (r2, 821 lines). Slice plan committed: **S0 → S1 → S2 → S3 → S4a → S4b → S5**, `stacked-to-main`, strict TDD both apps. RED test named before every behavioral task; `.tsx`-only rules are marked `MANUAL`.

- Storefront acceptance: `pnpm --filter @dtc/storefront test` (vitest, node-only, NO jsdom)
- Backend acceptance: `pnpm --filter @dtc/backend test:unit` (jest)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (total) | ~1,090 across 7 slices |
| 400-line budget risk | Medium (per-slice: all ≤ 400) |
| Chained PRs recommended | Yes |
| Suggested split | S0 → S1 → S2 → S3 → S4a → S4b → S5 (7 stacked PRs) |
| Delivery strategy | force-chained |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

**Per-slice line estimate vs 400 budget** (all individually under budget — NO slice needs sub-splitting):

| Slice | App | Est. lines | vs 400 | Sub-split? |
|-------|-----|-----------|--------|-----------|
| S0 | storefront | ~120 | OK | No |
| S1 | backend | ~130 | OK | No |
| S2 | storefront | ~150 | OK | No |
| S3 | storefront | ~200 | OK | No |
| S4a | backend | ~150 | OK | No |
| S4b | backend | ~180 | OK | No |
| S5 | backend | ~260 | OK | No |

**Last slice that must land to unblock purchase (front-loaded revenue):** **S1**. S0 unblocks any cart carrying a presentable flat option immediately (storefront-only, zero backend dep, works with Skydropx fully down). **S1 is the last mandatory revenue slice** — it unblocks calculated-shipping carts whose colonia is already populated (returning customers / saved addresses) by fixing the arithmetic-floor budget defect. S2–S5 add correctness/latency but are NOT required to restore first-purchase revenue on the returning-customer cohort.

**Decision inputs required before apply:**
1. **S4b existing-order `address_2` count** (CRITICAL-5b, design §7): read-only count of open/unfulfilled orders missing `address_2` MUST be known, and the backfill + residual remediation stated in the S4b PR body, before S4b ships. **Do not ship S4b until this count is known.**
2. **MAJ-4 warm-path measurement** (design §4.3, §7): re-read `refreshCartShippingMethodsWorkflow` and measure the same-shopper warm path BEFORE S5 is scheduled.

### Apply-time preconditions (carry forward)

- **Merge collision** `service.ts:816-829` with `skydropx-webhook-and-carrier-selection` (proposal §5). **This change lands first.** Do NOT modify `openspec/changes/skydropx-webhook-and-carrier-selection/`. If that change lands first instead, S5 must populate cache-key segment 4 (`requested_carriers`) and bump `QUOTE_CACHE_VERSION`.
- Two runtime measurements owed: **S4b existing-order `address_2` count** (before S4b); **MAJ-4 warm-path re-read/measure** (before S5).
- S5 is FIRST TO DROP if budget runs out — no correctness content.
- **Untouchables** (proposal §9): `?? null` never `?? 0`; unconditional terminal `QUOTE_READY` dispatch; single-writer scheduler; `hasShippingMethod` failing closed; `selectShouldLookUpPostalCode`; storefront redaction `:1473-1474`; container-free constructor. If a task appears to need one, the task is wrong — flag and re-cut.

### Suggested Work Units

| Unit | Goal | PR | Notes |
|------|------|----|-------|
| S0 | Flat-option rescue — unblocks flat carts | PR 1 → main | storefront; `checkout-context.tsx` untouched |
| S1 | Budget split + floor guards — unblocks saved-colonia carts | PR 2 → main | backend; gated on M0(a)(b) |
| S2 | Colonia retention | PR 3 → main | storefront; prereq for S3 |
| S3 | Colonia in signature + MAJ-1/MAJ-2 | PR 4 → main | storefront; hard dep S2; **reverts paired with S4b** |
| S4a | Backend plumbing, guard OFF | PR 5 → main | backend; independently revertible |
| S4b | Guard ON | PR 6 → main | backend; **needs order-count decision first**; **reverts paired with S3** |
| S5 | Quotation cache | PR 7 → main | backend; **needs MAJ-4 measurement**; drop-first |

---

## Phase S0 — Flat-option rescue (storefront, ~120) — depends on: none

- [x] S0.1 RED: in `lib/util/shipping-quote.spec.ts` add assertions — all-flat list with every `amount:null` → `classifyQuoteResult` returns `"unpriceable"`; mixed list with one presentable flat option → `"priced"`; empty list → `"priced"`; free-shipping `amount:0` (finite) is presentable via `readPresentableAmount` (`Number.isFinite`, not truthiness). Run `pnpm --filter @dtc/storefront test` → RED.
- [x] S0.2 GREEN: in `lib/util/shipping-quote.ts` add `readPresentableAmount(option, prices)`, add `QuotedOption.amount?: number|null`, widen `classifyQuoteResult` to `.some(readPresentableAmount !== null)`. Test → green.
- [x] S0.3 RED+GREEN: in `state/checkout-reducer.spec.ts` assert `selectCarrierRatesUnavailable(state)` is `true` only when status `quoted` AND a calculated row is unpresentable, `false` in every other state. Add the selector to `checkout-reducer.ts`; refactor `selectShippingChoices` (`:861-873`) to call `readPresentableAmount` — behaviour-identical. Test → green.
- [x] S0.4 MANUAL: `components/shipping-section/index.tsx` renders the "carrier rates unavailable" annotation from `selectCarrierRatesUnavailable`, fixed copy (`.tsx`, not node-testable). `checkout-context.tsx` NOT touched.
- [x] S0.5 Acceptance: `pnpm --filter @dtc/storefront test` green.

## Phase S1 — Budget split + floor guards (backend, ~130) — depends on: M0(a)(b)

- [x] S1.1 RED: in `skydropx-fulfillment/__tests__/constants.unit.spec.ts` — KEEP `:89` (now `SKYDROPX_QUOTATION_REQUEST_TIMEOUT_MS <= LABEL_QUOTE_BUDGET_MS`); ADD `SKYDROPX_QUOTE_CYCLE_BUDGET_MS >= MIN_VIABLE_QUOTE_BUDGET_MS` and `LABEL_QUOTE_BUDGET_MS >= MIN_VIABLE_QUOTE_BUDGET_MS`; ADD `readQuoteCycleBudget` cases (unset→18_000 clamped; non-numeric/`<floor`→warn+clamped default; `>=floor`→passthrough). Run `pnpm --filter @dtc/backend test:unit` → RED.
- [x] S1.2 GREEN: in `client.ts` split constant — `SKYDROPX_QUOTATION_REQUEST_TIMEOUT_MS`≈8_000 (used `:310`,`:323` both paths) + `SKYDROPX_QUOTE_CYCLE_BUDGET_MS` (via `readQuoteCycleBudget`); add measurement constants `SKYDROPX_COLD_QUOTE_P95_MS`,`_MAX_MS`,`MIN_VIABLE_QUOTE_BUDGET_MS`,`TAIL_ALLOWANCE_MS`,`DERIVED_QUOTE_CYCLE_BUDGET_MS`; add clamped `readQuoteCycleBudget(raw,warn)`. Drop `CHECKOUT_QUOTE_CEILING_MS`. `client.ts` must NOT import `service.ts`. Test → green.
- [x] S1.3 GREEN: in `service.ts:815` use `SKYDROPX_QUOTE_CYCLE_BUDGET_MS` (checkout cycle only); `:927` label path untouched. Raise `MIN_VIABLE_GATEWAY_TIMEOUT_MS` derivation (from `MIN_VIABLE_QUOTE_BUDGET_MS / 0.45` + purchase/cancel reserve) and enforce inside `readGatewayTimeout`. Test → green.
- [x] S1.4 STATIC: correct docstrings `client.ts:13-16` (split per-request vs cycle) and `:36`; no bare budget literal remains.
- [x] S1.5 Acceptance: `pnpm --filter @dtc/backend test:unit` green.

## Phase S2 — Colonia retention (storefront, ~150) — depends on: none

- [x] S2.1 RED: in `state/checkout-reducer.spec.ts` — `CP_LOOKUP_NOT_NEEDED` sets `cpStatus:"idle"` only (colonias/coloniaManual untouched); `CP_LOOKUP_DISCARDED` sets `cpStatus:"idle"`, `colonias:[]`, clears `coloniasPostalCode`, leaves `coloniaManual`. `selectPostalCodeIsUsable`: false on non-`MX_POSTAL_CODE_PATTERN`; false when `colonias.length>0 && coloniasPostalCode !== cp`; true when list empty or matches cp (the B→A→B retention edge). Both actions keep no-op short-circuit (stable identity). Run → RED.
- [x] S2.2 GREEN: in `checkout-reducer.ts` split `CP_LOOKUP_RESET` into the two actions; add `selectPostalCodeIsUsable(state)`; add `coloniasPostalCode: string|null` written by `CP_LOOKUP_FOUND`, `null` in `initFromServer`, cleared by `CP_LOOKUP_DISCARDED`. Do NOT weaken `selectShouldLookUpPostalCode`. Test → green.
- [x] S2.3 STATIC: `state/checkout-context.tsx` routing only — one dispatch line chooses the action from `selectPostalCodeIsUsable`. No rules in `.tsx`.
- [x] S2.4 Acceptance: `pnpm --filter @dtc/storefront test` green.

## Phase S3 — Colonia in signature + MAJ-1/MAJ-2 (storefront, ~200) — depends on: S2 (hard). Reverts as a PAIR with S4b.

- [x] S3.1 RED: in `lib/util/shipping-quote.spec.ts` assert `QuoteRelevantAddress` gains `address_2`; `selectQuoteRelevantAddress` projects `draft.address_2`; `buildQuoteSignature` includes it as the 5th component under existing normalization (NFC→strip C0→collapse ws→trim→lowercase, `\u001f` delim) — `"  Centro  "` and `"centro"` collapse equal. Run → RED.
- [x] S3.2 GREEN: in `shipping-quote.ts` add the 5th component; correct docstring `:14-39` (street half stands, colonia half rewritten with §0/422 evidence). Test → green.
- [x] S3.3 RED (MAJ-2): in `state/checkout-reducer.spec.ts` assert `commitDraft` clears `quotedSignature` whenever it clears `calculatedPrices` (colonia X→Y→X → `quotedSignature` null). Run → RED.
- [x] S3.4 RED (MAJ-1): in `state/checkout-reducer.spec.ts` assert `COLONIA_MANUAL_REQUESTED` routed through `commitDraft` → draft-derived signature goes non-null → null on that action. Run → RED.
- [x] S3.5 GREEN: in `checkout-reducer.ts` project `draft.address_2`; `commitDraft` clears `quotedSignature` with `calculatedPrices` (MAJ-2); route `COLONIA_MANUAL_REQUESTED` through `commitDraft` (MAJ-1). Tests → green.
- [x] S3.6 RED+GREEN: in `lib/util/checkout-readiness.spec.ts` assert `colonia` at position 3.5, message `Elige tu colonia.`, kept OUT of `REQUIRED_ADDRESS_FIELDS`. Add to `checkout-readiness.ts`. Test → green.
- [x] S3.7 MANUAL: copy-only tweak to `idle` branch of `shipping-section/index.tsx` ("…y elige tu colonia") — UX hole design §7; `.tsx`, belongs in S3 PR.
- [x] S3.8 Acceptance: `pnpm --filter @dtc/storefront test` green.

## Phase S4a — Backend plumbing, guard OFF (backend, ~150) — depends on: S3. Independently revertible.

- [ ] S4a.1 RED: in `provider-settings/__tests__/form-model.unit.spec.ts` assert `PROVIDER_FORMS.skydropx` exposes `originColonia` (`optional:false` at form layer). Run → RED.
- [ ] S4a.2 RED: in `skydropx-fulfillment/__tests__/service.unit.spec.ts` assert `withOriginColonia_` — stock-location non-blank wins; blank setting falls to stock value; `"   "` trimmed via `text()`; both blank → origin colonia absent. `readColonia(address)` = `text(address_2) ?? text(metadata?.colonia)`. Run → RED.
- [ ] S4a.3 GREEN: add `originColonia` to `form-model.ts`; `.optional()` in `skydropxUpsertSchema` (`workflows/steps/validate-provider-payload.ts`) for old rows; add fields to `skydropx-fulfillment/types.ts` + `provider-settings/types.ts`; in `service.ts` ship `withOriginColonia_` (mirror `withOriginZip_` `:1435-1448` verbatim incl. `text()` guard), extract shared `readColonia` (MAJ-3), add `QUOTE_FIELD_LABELS`, `DESTINATION_FIX_HINTS.address_2`, `ORIGIN_FIX_HINTS.address_2`. **No `toAddress` change, no guard wired.** Tests → green.
- [ ] S4a.4 Acceptance: `pnpm --filter @dtc/backend test:unit` green; storefront + label behaviour unchanged.

## Phase S4b — Guard ON (backend, ~180) — depends on: S4a + order-count decision. Reverts as a PAIR with S3.

- [ ] S4b.0 PRECONDITION: existing-order `address_2` count known; backfill + residual remediation in PR body (CRITICAL-5b). Do NOT proceed until known.
- [ ] S4b.1 RED: NEW loop-based `provider-settings/__tests__/origin-contract.unit.spec.ts` iterating EVERY field `missingOriginFields` can emit against `PROVIDER_FORMS.skydropx` (+ destination pinning); asserts guard and wire builder read identical source via `readColonia` (MAJ-3). Do NOT rely on the old hand-asserted file. Run → RED.
- [ ] S4b.2 RED: in `service.unit.spec.ts` assert `toAddress` returns `undefined` without `area_level3`; `missingDestinationFields` includes `address_2` (label branch `:1416-1422` unreachable again); `missingQuoteDestinationFields` = 4 components + `address_2`; `missingOriginFields` gains `address_2` gated "setting present OR stock-location value present"; storefront-audience message uses `QUOTE_FIELD_LABELS` (`colonia`, never `area_level3`), origin gap carries no field detail on public path; redaction `:1473-1474` NOT loosened. Run → RED.
- [ ] S4b.3 GREEN: in `service.ts` make `toAddress` require `area_level3`; add `address_2` to `missingDestinationFields` + `missingQuoteDestinationFields` + gated `missingOriginFields`; audience-split leak-safe message. Green via S4a form, NEVER by weakening the guard. Tests → green.
- [ ] S4b.4 Acceptance: `pnpm --filter @dtc/backend test:unit` green.

## Phase S5 — Quotation cache (backend, ~260) — depends on: M0(c) + MAJ-4 measurement. DROP-FIRST.

- [ ] S5.0 PRECONDITION: MAJ-4 warm-path re-read/measure done (design §4.3).
- [ ] S5.1 RED: NEW `skydropx-fulfillment/__tests__/quote-cache.unit.spec.ts` — key stability; miss on differing credential-fingerprint / colonia / parcel / origin; TTL expiry; throwing `get` AND throwing `set` → fall-through; **hanging `get` AND hanging `set` resolve within `QUOTE_CACHE_TIMEOUT_MS`** (CRITICAL-4); malformed entry → null. Run → RED.
- [ ] S5.2 GREEN: NEW `quote-cache.ts` — `QUOTE_CACHE_TIMEOUT_MS`≈300; key `skydropx:quote:v${VERSION}:${sha256(canonical).slice(0,32)}` with `credentialFingerprint(config)` as segment 0, ordered named `\u001f`-joined component list; `makeMedusaQuoteCache()` racing `get`+`set` via `Promise.race` inside try/catch (fail-open on timeout/throw/unregistered/malformed). Test → green.
- [ ] S5.3 GREEN: in `service.ts` inject `quoteCacheSource_` (resolved per-operation, never in constructor); cache `SkydropxRate[]`; placed after `requireConfig_`+address construction (post-`withOriginZip_`/`withOriginColonia_`), BEFORE `getClient_`; fail-open to live quote always; single-flight in-flight quotations by cache key (MAJ-6, `getToken_` pattern). Add `SkydropxOptions.quoteCacheSource` to `types.ts`. Test → green.
- [ ] S5.4 Acceptance: `pnpm --filter @dtc/backend test:unit` green; reverting removes cache, never a price path.

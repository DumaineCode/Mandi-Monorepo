# Proposal — checkout-shipping-quote-reliability

> Diagnosis is not restated here. It lives in `explore.md` (same folder) and Engram
> `sdd/checkout-shipping-quote-reliability/explore` (obs #251). Every claim below was verified
> there or by the orchestrator's independent spot-check.

## 1. Problem — in business terms

**Customers cannot pay us.** Checkout shows "no pudimos calcular el envío" and the CTA never arms.

- Live, through our own endpoint: `POST /store/shipping-options/{id}/calculate` fails at **8.102 s**
  with `unexpected_state: "Skydropx could not quote this shipment."` The **immediate retry returns
  200, amount 35.47** — same cart, same address.
- Cold Skydropx quotation completes in **12811 / 11353 / 12043 ms**. Our checkout budget is
  **8000 ms**. **Every first purchase to a new destination fails by construction.** A retry only
  works because Skydropx cached the quote server-side (**996 ms** warm on an identical payload) —
  we are relying on someone else's cache to close sales.
- A second, independent stopper: Skydropx PRO rejects a quote with no colonia —
  `422 {"address_to":{"area_level3":["no puede estar en blanco"]}}` — and the storefront wipes the
  colonia list one tick after it arrives. So the background quote fires on a payload that is
  **guaranteed** to be rejected, and because `buildQuoteSignature` excludes the colonia, picking one
  later never re-fires it. The quote stays parked on the failure forever.

This is a revenue stopper. Free-shipping (`Gratis`) carts that need no carrier at all are **also**
blocked today, because one failed calculated option empties the entire option list.

## 2. The reframe — stated without hedging

The request was: *don't just raise the timeout, build the proper async pre-warm.* Rejecting a lazy
patch was right. The finding is that **the async pre-warm already exists, and already fires at the
earliest possible moment.**

`commitDraft` recomputes the quote signature on every draft commit; the signature completes the
instant the postal code resolves (`CP_LOOKUP_FOUND` fills province + city offline); a 600 ms
debounced effect then runs the whole quote round in the background. `calculatePriceForShippingOption`
carries **no `AbortSignal`** — a 20 s backend response reaches the browser intact. **The 12 s is
already spent in parallel with the customer typing.** Nobody stares at a spinner for 12 s unless they
complete address + phone + card in under 12 s.

Therefore, plainly:

- **Raising the budget is not the patch that was rejected. It is the arithmetic floor.** The
  *identical* `quoteAndPoll_` call on the admin label path is granted
  `LABEL_QUOTE_BUDGET_MS = floor(SKYDROPX_FULFILLMENT_BUDGET_MS * 0.45)` = **17 100 ms**. Checkout
  gets an unmeasured literal **8 000 ms** (`client.ts:36`), whose docstring presents it as a designed
  trade-off. It was never measured against anything. A budget arithmetically incapable of completing
  the call is a defect, full stop.
- **Building a new async transport would be building something that already exists.** Worse: a
  two-phase route cannot replace the synchronous path, because `refreshCartShippingMethodsWorkflow`
  re-invokes `calculatePrice` whenever a shipping method is set. We would ship two quote paths and
  leave the one that actually prices the cart still broken.

**Approach: calibrate the budget from measurement (A) + a server-side quotation cache (B). C and D
deferred.** Both docstrings that assert the falsified reasoning (`client.ts:15-16`,
`shipping-quote.ts:14-39`) are **corrected in place with the new evidence**, not silently contradicted.

## 3. Scope — slices, in landing order

`delivery_strategy: force-chained`, `chain_strategy: stacked-to-main`, **400 changed lines per PR**.
Stacked-to-main means main is *partially fixed between merges*, so ordering front-loads revenue.

**Gate M0 (design phase, zero production diff — not a PR):** probe (a) p99 of cold quotation over a
widened sample, (b) whether the proxy/platform holds a ~20 s response on `.../calculate` on both
apps, (c) whether `Modules.CACHE` resolves inside a fulfillment provider context. S1 and S5 do not
start before their probe answers.

| # | Slice | App | Est. | Depends on | Can main sell after this merges? |
|---|---|---|---|---|---|
| **S0** | **Flat-option rescue** — `classifyQuoteResult` judges *"is any option presentable"*, not *"did the calculated subset price"*; caller stops turning that into `QUOTE_FAILED`; additive "carrier rates unavailable" annotation | storefront | ~120 | none | **YES — immediately, for any cart with a flat option, even with Skydropx fully down.** |
| **S1** | **Budget calibration** — measured `SKYDROPX_QUOTE_COMPLETION_P99_MS` constant with date + provenance; checkout budget *derived* with headroom, never a literal; load-time floor guard in the style of `readGatewayTimeout`; correct the `client.ts:15-16` / `:36` docstrings | backend | ~100 | M0(a)(b) | **YES — for carts whose `address_2` is already populated** (returning customers, saved addresses). |
| **S2** | **Colonia retention** — split `CP_LOOKUP_RESET` into two actions behind a new pure `selectPostalCodeIsUsable`; mount guard `selectShouldLookUpPostalCode` untouched | storefront | ~150 | none | No change — a colonia that survives is strictly an improvement. Prerequisite for S3. |
| **S3** | **Colonia as quote-relevant + required** — colonia becomes a full `buildQuoteSignature` component (variant (i)); own `MissingRequirementCode` modelled on the `phone` rule; correct the falsified `shipping-quote.ts:14-39` docstring | storefront | ~180 | **S2 (hard)** | No — and it makes main **stricter**: carts could previously reach the CTA with no colonia and produce orders Skydropx can never label. Intentional narrowing, stated here so it is not discovered in production. |
| **S4** | **Backend colonia enforcement** — destination `area_level3` hard-required with an actionable pre-flight `INVALID_DATA` *before* any network call; `originColonia` setting + `withOriginColonia_` mirroring `withOriginZip_` verbatim; extend both missing-field guards and both `ORIGIN_FIX_HINTS`/destination hint maps | backend | ~200 | S3 | No — changes *which* error you get, not whether. Trades a 12 s 422 for an instant, actionable message. |
| **S5** | **Quotation cache** — injectable `quoteCacheSource` seam (same shape as `credentialSource_`/`stockLocationSource_`), Medusa cache module resolved lazily with `allowUnregistered: true`, normalized `origin ⨯ destination ⨯ parcel` key, TTL, **fail-open** | backend | ~250 | M0(c), S1 | No — pure latency multiplier. **The only slice with no correctness content; drop it first if budget runs out.** |

**S0 first, alone — claim evaluated and accepted.** It is the smallest diff, storefront-only, has zero
carrier and zero backend dependency, and it only *widens* what is presentable — it cannot make any
currently-working cart worse. It restores revenue on flat-rate carts on day one. Everything else may
slip; S0 must not.

**S1 before S4 is deliberate.** Between them, main spends up to ~20 s on requests that still 422 for
empty-colonia carts. That is added latency on a path that **already fails today** — not new breakage —
and it buys the returning-customer cohort days earlier. Swapping S1↔S4 is safe but costs revenue.

**S2 → S3 is a hard dependency. Do not land S3 without S2** — colonia in the signature while the
colonia is still being wiped makes the signature permanently `null` and stops quoting entirely.

**Strict TDD, RED first, both apps.** Storefront `pnpm --filter @dtc/storefront test`;
backend `pnpm --filter @dtc/backend test:unit`. The storefront vitest harness is **node-only, no
jsdom, no `@testing-library`** — a deliberate existing constraint. **Every rule in this change lands
in a pure reducer/selector/util, never in a `.tsx`.** `checkout-context.tsx` is untestable by
construction and its own docstring says so. S4 will turn
`provider-settings/__tests__/origin-contract.unit.spec.ts` **RED by design** — it pins the origin
guard against `PROVIDER_FORMS.skydropx` in both directions. That is the guard working.

## 4. Non-goals

| Not doing | Why |
|---|---|
| **Two-phase kick-off store route** (`POST/GET /store/shipping-quotes`) — explore option C / S6 | **Deferred behind M0(b).** It cannot replace the synchronous `calculatePrice`, which `refreshCartShippingMethodsWorkflow` re-invokes at method selection. Without B it is two code paths and zero speedup on the path that prices the cart. It is a way to *warm B's cache earlier*, not an alternative to it. Revisit only if M0(b) shows the platform will not hold ~20 s. |
| **`cart.updated` pre-warm subscriber** — explore option D / S6 | **Deferred behind measurement.** With today's constants (`AUTOSAVE_DEBOUNCE_MS = 400` vs `QUOTE_DEBOUNCE_MS = 600`) the head start is **200 ms**, not 12 s. Every blur is an address write, so a naive subscriber fires live carrier quotes on partial addresses against a 2 req/s cap. Refinement of B once B exists and a measurement justifies it. |
| `openspec/changes/skydropx-webhook-and-carrier-selection/` — webhooks, `requested_carriers`, carrier-selection UX | Separate change. See §5. |
| A seventh `QuoteStatus` value | Leaning the orthogonal additive selector (`selectCarrierRatesUnavailable`) over `partially_quoted`; a seventh value touches every branch of the exhaustive switch in `shipping-section/index.tsx:241-281`. Final call in spec/design. |
| Adding a client-side `AbortSignal` to `calculatePriceForShippingOption` | Would re-create the exact defect at a new layer. |
| Loosening the storefront-audience error redaction (`service.ts:1473-1474`) | Deliberate. Any richer banner copy must come from HTTP status or an explicit non-secret code, never from the upstream message. |
| jsdom / `@testing-library` / Playwright | Explicit harness non-goal. |
| Deriving our TTL from Skydropx's server-side cache | One warm observation on one payload. Not a distribution. |

## 5. Confirmed collision — `skydropx-webhook-and-carrier-selection`

**Real, specific, and confirmed.** Their §8.1 threads `requested_carriers` into the quotation body
literal, naming `| calculatePrice (checkout quote) | service.ts:816-829 | "storefront" |`.
**`service.ts:816-829` is the exact block S1, S4 and S5 rewrite** — deadline anchor, address
construction, cache lookup. Further overlap: `fetchUsableRates_` (`:1454-1487`, their OQ-11 vs our §5
read of the redaction at `:1473-1474`), and both changes extend
`modules/skydropx-fulfillment/__tests__/service.unit.spec.ts`.

**Recommended landing order: this change first.** A revenue stopper outranks a feature. The webhook
change rebases.

**If it lands first instead:** S1/S4/S5 rebase onto their body literal, and **`requested_carriers`
becomes a mandatory component of S5's cache key** — otherwise a carrier-restricted quote and an
unrestricted one collide on the same key and we sell a price for carriers we did not offer.

**Either way, the two must not be developed in parallel against that block.**

## 6. Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `storefront-checkout`: quote-round classification (a presentable flat option keeps the list alive
  and the round non-`failed`); colonia retention across postal-code lookup resets; colonia as a
  quote-signature component and as its own missing-requirement code — **R4 degrades from "a postal
  code alone shows a price" to "a postal code plus a colonia shows a price"**, a real product change
  that belongs in the delta spec; additive "carrier rates unavailable" annotation.
- `skydropx-fulfillment`: checkout quotation budget derived from a measured, documented constant with
  a load-time floor guard; destination colonia (`area_level3`) hard-required pre-flight with an
  actionable error; configurable `originColonia` with fallback; short-TTL cross-cart quotation cache
  behind an injectable, fail-open seam.

## 7. Affected areas

| Area | Impact | Slice |
|---|---|---|
| `apps/storefront/src/lib/util/shipping-quote.ts` | Modified — `classifyQuoteResult` condition, colonia in `buildQuoteSignature`, docstring correction | S0, S3 |
| `apps/storefront/src/modules/checkout/state/checkout-reducer.ts` | Modified — `CP_LOOKUP_RESET` split, `selectPostalCodeIsUsable`, `selectCarrierRatesUnavailable` | S0, S2 |
| `apps/storefront/src/modules/checkout/state/checkout-context.tsx` | Modified — thin wiring only (which action to dispatch); **no rules** | S0, S2 |
| `apps/storefront/src/lib/util/checkout-readiness.ts` | Modified — new `MissingRequirementCode` + message | S3 |
| `apps/storefront/src/modules/checkout/components/shipping-section/index.tsx` | Modified — render the annotation | S0 |
| `apps/backend/src/modules/skydropx-fulfillment/client.ts` | Modified — derived budget, docstring correction | S1 |
| `apps/backend/src/modules/skydropx-fulfillment/service.ts` | Modified — pre-flight colonia guard, `withOriginColonia_`, cache seam at `:816-829` | S1, S4, S5 |
| `apps/backend/src/modules/provider-settings/*` (form model, hint maps, origin contract) | Modified — colonia marked required | S4 |
| `apps/backend/src/modules/skydropx-fulfillment/__tests__/` (+ new `quote-cache.unit.spec.ts`) | New/Modified | S1, S4, S5 |

## 8. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Budget set from three samples, not a p99.** A number chosen from 11.4–12.8 s fails at a lower, harder-to-reproduce rate — strictly worse than today, because nobody reproduces a rare failure. | High | **M0(a) gate: widen the sample before fixing the constant.** Encode it as a dated constant with provenance + a load-time floor guard, so no future literal can silently undercut it again. Target ~20 s (max observed ≈12.8 s + ~55 % headroom); below 15 s is betting against the distribution. |
| **Proxy / platform may not hold a ~20 s response** on `.../calculate`. `ASSUMED_GATEWAY_TIMEOUT_MS = 60_000` is an assumption by its own name, used for the admin path only. The storefront's server-side execution cap is likewise unknown, and there is no client-side abort to bound it. | Medium | **M0(b) gate, blocking S1.** If the platform cuts below the derived budget, option C stops being deferrable and this proposal is amended, not quietly ignored. |
| **`Modules.CACHE` may not resolve inside a fulfillment provider context.** `provider-credentials.ts:57-62` proves the *mechanism* for a custom module key, not for a Medusa infra module. | Medium | **M0(c) runtime probe, blocking S5 design.** If it fails, S5 degrades to a per-replica in-process cache — materially weaker beyond one container — or is dropped. Fail-open either way. |
| **S3 narrows what can be purchased.** Carts mid-checkout when it lands find the CTA newly blocked until a colonia is picked. | High (by design) | Stated here, in the delta spec, and in the PR body. The colonia field is the very next control after the postal code. Those carts were producing unlabelable orders. |
| **A cached rate is a price we charge.** TTL is a revenue decision, not a performance knob. | Medium | Short TTL, decided in design with an explicit invalidation story; fail-open on cache error. |
| **Merge conflict with the webhook change** at `service.ts:816-829`. | High | §5 — land this first; no parallel development against that block. |
| `origin-contract.unit.spec.ts` goes RED in S4. | Certain | Intended signal. S4 must also mark colonia required in `PROVIDER_FORMS.skydropx`. |

### Open questions carried into design
Beyond M0(a)(b)(c): does `area_level3` move the rate *value* or only pass validation (if only
validation, the cheaper signature variant (ii) opens up); Skydropx's own cache key/TTL; whether the
2 req/s cap is per-account or per-endpoint; whether `refreshCartShippingMethodsWorkflow` re-invokes
`calculatePrice` on every address write (relying on a recorded finding, not re-read); cache
invalidation on a carrier price change; where `colonia` slots into the asserted
`MissingRequirementCode` order; seventh `QuoteStatus` value vs. orthogonal selector.

## 9. What must not be touched

Each of these encodes a **specific past regression**. They are load-bearing.

- `?? null`, **never** `?? 0`, on quote amounts (`checkout-context.tsx:432-441`).
- The **unconditional terminal `QUOTE_READY` dispatch** (`:462-485`) — a `cancelled` early-return
  once permanently leaked `inFlightSignature`.
- The **single-writer** `checkout-write-scheduler.ts` — a second writer re-opens the `em.create`
  PII-destruction path.
- `hasShippingMethod: (… ?? 0) > 0` **failing closed** (`checkout-readiness.ts:431-437`).
- The controlled RadioGroup.
- The mount guard `selectShouldLookUpPostalCode` (`checkout-reducer.ts:931-943`) — it exists because
  `CP_LOOKUP_FOUND` rewrote `"CDMX"` → `"Ciudad de México"` on mount and dropped a returning
  customer's selection. S2 fixes the **mis-shaped action**, not this guard.
- Failure parking (`selectQuoteIsBlockedByFailure` + `QUOTE_RETRY`) — without it a failed address
  retries in a tight loop, one live carrier quote per pass.
- The storefront-audience error redaction (`service.ts:1473-1474`).
- The container-free provider constructor (module load order at boot is not guaranteed).

**Rule: no slice in this change requires touching any of them. If a slice starts needing to, the
slice is wrong — stop and re-cut it.**

## 10. Constraints (binding on every slice)

- Prices as-is. **Never** `/100` or `*100`.
- Storefront reaches the backend only through the `sdk` from `src/lib/config.ts`.
- Medusa mutations go through workflows; HTTP `GET`/`POST`/`DELETE` only. *(This change adds no
  route and no mutation — it is a fulfillment-provider + storefront-state change.)*
- Storefront rules live in pure modules only (node-only vitest, no jsdom).

## 11. Rollback

Every slice is an independent revert. S0/S2 revert to today's behaviour with no data implication.
S1 reverts to the 8 s literal (back to today's failure, no worse). S3 reverts the narrowing, so any
cart blocked on colonia unblocks immediately. S4 reverts to the pre-flight-free path — carts fall
back to the carrier 422. S5 is fail-open by construction: reverting it removes a cache, never a
price path. The `manual` fulfillment provider stays registered throughout, so no slice can hard-fail
an order.

## 12. Success criteria

- [ ] A cart with a flat `Gratis` option is purchasable **while Skydropx returns errors** (S0).
- [ ] A first-ever quote to a **new** destination succeeds on the **first attempt**, no retry (S1 + M0(a)).
- [ ] The checkout budget is a **derived expression** of a dated, measured constant; a load-time
      guard refuses any budget below the measured floor; no bare quote-timeout literal remains (S1).
- [ ] Selecting a colonia after a postal-code lookup **re-fires the quote**; the list survives the
      reset (S2 + S3).
- [ ] A cart with no colonia is blocked in the storefront with a **single-field** message, and the
      backend rejects it **before any network call** with an actionable error (S3 + S4).
- [ ] A second customer to the same colonia with the same parcel is served from cache (S5).
- [ ] Both falsified docstrings (`client.ts:15-16`, `shipping-quote.ts:14-39`) carry the new evidence.
- [ ] Every PR ≤ 400 changed lines; every slice RED-first; both suites green at each merge.

# Tasks — checkout-single-page-flow

Change: `checkout-single-page-flow`
Scope: `apps/storefront` only. No backend changes.
Artifact store: `both` (this file + Engram `sdd/checkout-single-page-flow/tasks`).

Inputs, all authoritative and all re-read for this phase:
[`proposal.md`](./proposal.md) (R1–R8, C1–C3, §9 RESOLVED) ·
[`specs/storefront-checkout/spec.md`](./specs/storefront-checkout/spec.md) (18 requirements, ~55 scenarios) ·
[`design.md`](./design.md) (D1–D10, §0 F1/F2/F3 + CONFLICT-1 RESOLUTION, §10 PR split, §13 RESOLVED) ·
[`explore.md`](./explore.md) (evidence, `file:line`).

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | **~2 870** across 5 PRs (PR1a ~280 · PR1b ~720 · PR2a ~1 060 · PR2b ~650 · PR2c ~900) |
| 400-line budget risk | **High** (project budget is 600; 4 of 5 PRs exceed it) |
| Chained PRs recommended | **Yes** |
| Suggested split | PR1a → PR1b → PR2a → PR2b → PR2c |
| Delivery strategy | auto-chain (settled — `design.md` §13 decision 3) |
| Chain strategy | feature-branch-chain (settled — `design.md` §13 decision 4) |

```text
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High
```

Every delivery decision is settled in `proposal.md` §9 and `design.md` §13. Nothing below reopens them.

---

## Testing reality — read before writing any task off as "covered"

`openspec/config.yaml` declares `testing.strict_tdd: true` with `runner: jest`. **That applies to `apps/backend` only.** This change is 100 % `apps/storefront`, which runs **vitest**:

- command: `cd apps/storefront && pnpm test`
- config: `environment: "node"`, `include: ["src/**/*.spec.ts"]`
- **no jsdom, no `@testing-library`, no Playwright** — adding them is an explicit non-goal (`proposal.md` §4).

**Consequence, encoded throughout this file:** only pure modules under `src/lib/util/` and `src/modules/checkout/state/checkout-reducer.ts` are automatable. Every component, effect, network sequence and payment flow is verified by a human or not at all. Manual QA items below are **real checklist tasks and merge gates**, not a footnote.

STRICT TDD MODE IS ACTIVE for all four pure modules. Every one follows **RED → GREEN → TRIANGULATE → REFACTOR** with evidence per cycle. RED means: write the spec, run `cd apps/storefront && pnpm test`, paste the failing output into the PR. No implementation before a red run exists.

---

## Reconciliation ledger — conflicts resolved before task breakdown

Four contradictions between the inputs. Each is resolved here, with the ruling and the reason. Silently picking one would have been the failure mode.

### RC-1 — Pure-module API names: **spec wins**

`spec.md` and `design.md` §2 name the same functions differently. `design.md`'s own preamble states *"`sdd-spec` … owns the WHAT. This document owns the HOW."* The exported contract is a WHAT.

| Spec name (**use this**) | Design name (superseded) |
|---|---|
| `getMissingOrderRequirements` | `resolveMissingCheckoutItems` |
| `MissingRequirement { code, message }` | `MissingItem { code, label }` |
| `MissingRequirementCode` | `MissingCode` |
| `evaluateQuoteReadiness` → `QuoteDecision { action, reason, signature, supersedes }` | `decideQuoteAction` → `QuoteDecision { kind }` |
| `buildQuoteSignature` → `string \| null` | `buildQuoteSignature` → `string` (`""` sentinel) |
| `QuoteRelevantAddress` | `QuoteAddressDraft` |
| `canPlaceOrder` | `canPlaceOrder` (agree) |

Design-only exports with no spec counterpart are **kept**, because they come from settled decision 8 which post-dates the spec: `isShippingSelectionStale`, `isQuotable`. `null` beats the `""` sentinel: it is unrepresentable-as-a-real-signature by construction rather than by convention.

### RC-2 — The missing-requirement catalogue gains a 9th code

`spec.md` declares the 8-code catalogue *"exhaustive and fixed"*. `design.md` §2 adds `shipping_method_stale`. **Ruling: the catalogue gains it**, at position 5.5 (immediately after `shipping_method`).

Reason: settled decision 8 (`proposal.md` §9, resolved after the spec was written) makes it load-bearing. Per F1 there is **no store API to remove a shipping method**, so the spec's own scenario *"THEN `cart.shipping_methods` is empty"* is unachievable. Per F2 the backend silently **re-prices** the surviving method. Without `shipping_method_stale` the CTA has no way to block an order placed against a superseded quote — which is the entire product guarantee decision 1 asked for. This is a spec amendment (task **1b.13**), not drift.

Message: `Vuelve a elegir el método de envío: cambiaste el código postal.` (Mexican `tú` form, per the spec's copy-register correction — **not** the voseo in `proposal.md` R8 or `design.md` §2.)

### RC-3 — Three spec scenarios are superseded by F1/F2

Under *"A Quote-Signature Change Clears the Selected Shipping Method"*, the scenarios asserting `cart.shipping_methods` is empty describe a cart mutation that F1 proves is not expressible. Restated as client-side invalidation + provisional total (task **1b.13**). The **product outcome is unchanged**: the customer re-picks, no silently changed total.

### RC-4 — `isStripeLike` cannot be deleted from `lib/constants.tsx`

`design.md` §0 says *"remove `isStripeLike` from `lib/constants.tsx` **once it has no callers**"*. Verified: it still has one — `modules/order/components/payment-details/index.tsx:43`, which is **outside checkout scope**. The condition is unmet.

**Ruling: keep `isStripeLike` and the `pp_stripe_*` `paymentInfoMap` entries in `lib/constants.tsx`.** Delete only the checkout callers. Widening this change into the order module to satisfy a conditional clause would be scope creep on a PR that already carries a `size:exception`. Recorded as a follow-up (task **2c.14**).

---

## Delivery plan

Chain strategy **`feature-branch-chain`**. Only the tracker merges to `main`, so `main` never holds a half-migrated checkout.

**PR1a is the exception, deliberately: it targets `main` directly.** It is a pure data-layer bug fix with zero UI change, and `design.md` §12 requires it to be independently re-landable if the rest is rolled back. Chaining it onto the tracker would make it revertible only as part of the whole change — the opposite of what §12 asks for. The tracker branches off `main` *after* PR1a merges.

| PR | Branch | Targets | Est. changed | `size:exception` |
|---|---|---|---|---|
| **PR1a** | `fix/checkout-persist-draft-address-id` | `main` | **~280** | No |
| — | `feat/checkout-single-page-flow` *(tracker)* | `main` | — | — |
| **PR1b** | `feat/checkout-pure-rules` | tracker | **~720** | **Yes** |
| **PR2a** | `feat/checkout-state-core-datos` | `feat/checkout-pure-rules` | **~1 060** | **Yes** |
| **PR2b** | `feat/checkout-envio` | `feat/checkout-state-core-datos` | **~650** | **Borderline** — see 2b.10 |
| **PR2c** | `feat/checkout-pago-cta` | `feat/checkout-envio` | **~900** | **Yes** |

### Estimate corrections against `design.md` §10

- **PR1a: 150 → ~280.** The spec requires `buildPartialShippingAddressPayload` as a **pure, `AUTO`-verified** function (Group C). `design.md` D3 has that construction inline in `persistCheckoutDraft`. Extracting it adds `cart-address-payload.ts` (~40) + `.spec.ts` (~90) to PR1a. This is strictly better: the highest-consequence fix in the change ships **with its automated proof in the same PR**, instead of shipping a live-bug fix whose only evidence is a manual QA note. Still well under 600.
- **PR1b: 650 → ~720.** Gains the `stripe-wrapper.tsx` deletion (54) and the Stripe branch removal from `payment-wrapper/index.tsx` (~20), both landing with the C1 inversion because they are the same file and the same decision tree.
- **PR2c: 1 000 → ~900.** The Stripe deletion nets out: `-25` on `payment-section`, `-50` on `payment-button`, `+65` for the `StripeCardContainer` deletion, `+2` for the dependency drop. `design.md` §0 claims the deletion *"shrinks PR2c, which was over budget"* — directionally correct, but **PR2c is still ~50 % over budget**. Deletions count as changed lines under the settled rule that line count stays the metric. Stating it plainly rather than shaving the number.

---

## PR1a — Live data-destruction bug + cache correctness

Branch `fix/checkout-persist-draft-address-id` → `main`. **~280 changed lines. No exception needed. Ships first and standalone.**

Closes the bug in `lib/data/cart.ts:109-155` that is destroying customer PII in production today (`explore §3`). Zero UI change. Merge before anything else on this change.

### Pure module — `buildPartialShippingAddressPayload` (strict TDD)

- [x] **1a.1 — RED.** Create `apps/storefront/src/lib/util/cart-address-payload.spec.ts`. Import from `./cart-address-payload` (does not exist yet). Write the four spec scenarios from *Every Partial Shipping-Address Write Carries `shipping_address.id`*: existing id propagated; cart with no address omits the `id` key entirely (assert `"id" in payload.shipping_address === false`, **not** `id: null`/`undefined`/`""`); only patched keys are sent; null/undefined cart tolerated. Run `cd apps/storefront && pnpm test` and record the failing output in the PR.
- [x] **1a.2 — GREEN.** Create `apps/storefront/src/lib/util/cart-address-payload.ts`. Export `CheckoutDraftAddress` (the 10 fields from `design.md` D3) and `buildPartialShippingAddressPayload(cart, patch)`. Pure: no `fetch`, no React, no `window`, type-only `@medusajs/types` imports. Run the suite green.
- [x] **1a.3 — TRIANGULATE.** Add cases that would pass a naive implementation but must not: a patch key whose value is `undefined` must be omitted, not sent as `undefined`; a patch key whose value is `""` **must** be sent (clearing a field is legitimate); an `id` present in the patch must never override the cart's id. Watch each fail, then fix.
- [x] **1a.4 — REFACTOR.** Extract the key-filter helper if it repeats. Write the docstring: the `EntityAssigner.js:77-98` mechanism, why a missing `id` means `em.create` and not a merge, and that `StoreCartUpsertAddress` (`validators.js:38-40`) accepts the optional `id`. Suite stays green.

### `lib/data/cart.ts`

- [x] **1a.5** Add `retrieveCartFresh(cartId?, fields?)` to `apps/storefront/src/lib/data/cart.ts`: identical to `retrieveCart` but `cache: "no-store"` and **no** `next` options. Docstring must state the reason — `revalidateTag`-then-read in the same request is not a documented Next 15 ordering guarantee, and with a possibly-empty tag it is a silent stale read, not a safe no-op (`design.md` D1). Satisfies D1.
- [x] **1a.6** Rename `persistShippingForCalc` → `persistCheckoutDraft` in `lib/data/cart.ts` and implement the D3 contract: signature `(addr, email, addressIdHint?)`, return `{ ok: true; cart } | { ok: false; error }`. Implement the 8-step id-resolution algorithm from `design.md` D3 verbatim, calling `buildPartialShippingAddressPayload` from **1a.2** at step 4. Keep `revalidateTag(getCacheTag("fulfillment"))`; keep **not** revalidating `carts`. Satisfies C2, R6, spec *Group C*.
- [x] **1a.7** Implement the D3 **step-6 post-condition tripwire**: after the write, if an `id` was sent and `cart.shipping_address?.id !== id`, `console.error` with `cartId`, the id sent and the id received. **Do not throw** — the write already happened. This is the only runtime assertion of success criterion S7 that exists; there is no automated equivalent.
- [x] **1a.8** Change `setShippingMethod` in `lib/data/cart.ts` to return `Promise<HttpTypes.StoreCart>` (it already resolves `{ cart }` at `:315-317` and discards it). Satisfies D1.
- [x] **1a.9** Change `applyPromotions` in `lib/data/cart.ts` to return the updated cart. Satisfies D1, spec *Cart Mutations During Checkout Re-Derive Price and Readiness*.
- [x] **1a.10** Update every existing caller of `persistShippingForCalc` / `setShippingMethod` / `applyPromotions` to the new signatures **without behaviour change**. PR1a must leave the current four-step checkout working exactly as it does today. Grep the callers first; `shipping-address/index.tsx` and `shipping/index.tsx` are the known ones.

### `lib/data/fulfillment.ts`

- [x] **1a.11** In `apps/storefront/src/lib/data/fulfillment.ts`, change `listCartShippingMethods` from `next: getCacheOptions("fulfillment")` + `cache: "force-cache"` to `cache: "no-store"` + `signal: AbortSignal.timeout(SHIPPING_OPTIONS_TIMEOUT_MS)` with `SHIPPING_OPTIONS_TIMEOUT_MS = 5_000`. Satisfies C3, D6, spec *Shipping Options Are Refetched When the Quote Signature Changes*.
- [x] **1a.12** Write the timeout comment **accurately**: per finding F3, `listShippingOptionsForCartWorkflow` does **not** call the carrier. Do not copy the justification from `listCartOptions`' `CART_OPTIONS_TIMEOUT_MS` — that comment is wrong for this route and copying it propagates the error. State it as symmetry and cheap insurance.
- [x] **1a.13** In `calculatePriceForShippingOption`, replace the bare `.catch((_e) => null)` (`fulfillment.ts:60-63`) with a `console.error` carrying `optionId`, `cartId` and the error before returning `null`. The `MissingDimensionsError` path is otherwise invisible to the team (spec: *the failure MUST be observable*). Return value stays `null` — callers are unchanged in PR1a.

### PR1a gate

- [x] **1a.14** Run `cd apps/storefront && pnpm test`. All pre-existing specs plus `cart-address-payload.spec.ts` green. Spec-file count goes **up**, never down (S10).
> **Remediation pass (post-review) — no new task numbers, several amended.**
> Two fresh-context reviews converged on seven findings; the fixes land inside tasks already ticked above, so no checkbox changed state.
> Amended: **1a.5/1a.6** (`addressIdHint` deleted — security; `retrieveCartFresh` now returns a discriminated result and `persistCheckoutDraft` ABORTS instead of writing id-less when the read failed; 5 s read timeout), **1a.7** (tripwire no longer logs raw cart ids), **1a.11/1a.12** (one bounded retry; the `getCacheTag` "never reachable" claim corrected), **1a.13** (logs `optionId` + status + message, never the raw error object or cart id), **1a.2/1a.3** (`CheckoutDraftAddress` now derived from `PERSISTABLE_ADDRESS_FIELDS`; exhaustiveness and three missing edge cases pinned by spec).
> Added: `lib/util/log-safe.ts` and a contained `CheckoutUnavailable` error state so a shipping-options failure can no longer render a blank checkout.
> Full detail, TDD evidence and deferred follow-ups: `apply-progress.md` § "Remediation pass" and `design.md` §14.

> **SECOND remediation pass (post second blind dual review) — no new task numbers, several amended again.**
>
> A second blind `review-reliability` + `review-risk` pair converged on seven further findings, two of them against the FIRST remediation's own work. All fixed.
>
> Amended: **1a.1–1a.4** (`resolveShippingAddressId` no longer fails unsafe — a projection that does not deliver the relation now resolves to `unresolved`, and the FK scalar `shipping_address_id` is read as a second independent signal), **1a.5/1a.6** (projection switched from `id,*shipping_address` to Medusa's own `id,shipping_address_id,shipping_address.id`; backend error text no longer crosses the `"use server"` boundary to the browser), **1a.7** (tripwire now covered by tests, not only by reading), **1a.11** (retry no longer fires on 4xx), **1a.13** (`describeError` now redacts entity ids out of the backend's own message text, which previously printed the cart id in full right beside the masked one).
>
> **New test infrastructure, resolving deferred item §14.2:** `apps/storefront/src/lib/data/cart.spec.ts` (23 tests) and `fulfillment.spec.ts` (16 tests), built on `vi.mock` + `vi.hoisted`. `persistCheckoutDraft`'s abort guarantee and `listCartShippingMethods`' retry policy are now asserted against the actual SDK call arguments. Suite: **150 → 211 tests**, 6 → 8 spec files.
>
> **1a.15 gains a third check:** on a cart that has NEVER had a shipping address, the first autosave must still produce a `POST /store/carts/:id`. If it does not, the backend omits `shipping_address_id` for empty relations and the projection guard needs a different signal. This is the one assumption in the fix that no automated test can settle.
>
> **1a.15 gains two checks:** (a) with the backend stopped, the checkout must render the "No pudimos cargar el checkout" state with a working Reintentar button — never a blank page; (b) no raw `cart_...` id may appear in the server log.

- [x] **1a.15 — MANUAL QA (blocking merge).** *(API-level evidence captured, 2026-08-05.)* Verified directly against the running backend instead of through the browser, which is stronger evidence for this particular claim:
  - **Bug reproduced.** Full address, then a partial write WITHOUT `id`: `caaddr_...MTDK` -> `caaddr_...VN49`, and `first_name`/`last_name`/`company`/`phone` all `None`.
  - **Fix confirmed.** Same partial write WITH `shipping_address.id`: id unchanged, all four fields intact, `postal_code` updated 44160 -> 06700. A real field-level merge.
  - **FK assumption confirmed (risk 1 closed).** With the projection the code actually uses, `"id,shipping_address_id,shipping_address.id"`, Medusa returns `shipping_address_id` as a materialised scalar on both a brand-new cart and one with a full address. The corroboration signal is real. Note a narrower projection such as `"id,shipping_address.id"` does NOT return the FK — the code's projection is load-bearing and must not be narrowed.
  - **New carts already own an address row.** A freshly created cart returns `shipping_address` with a real id, so the `absent` branch is close to unreachable in practice, which makes the destructive direction even harder to hit.
  - Still open in browser form: the `console.error` tripwire firing under a real autosave, and the blank-page regression check.
- [ ] **1a.15b — MANUAL QA (browser).** *(design §11 item 4 — the S7 tripwire.)* Against a running backend: fill the full checkout address including `first_name`, `last_name`, `company`, `phone`; submit the address step; then trigger a partial persist by editing and blurring the postal code; reload. **All four fields must still be present** and `cart.shipping_address.id` unchanged. Watch the server log for the 1a.7 `console.error` — it must not fire.
- [ ] **1a.16 — MANUAL QA (blocking merge).** Full regression of the **existing** four-step checkout, Openpay happy path end to end. PR1a changes no UI; if anything in the corridor breaks, 1a.10 is wrong.
- [ ] **1a.17** PR description: title the live bug, link `explore §3`, state that reverting this PR reintroduces PII destruction (`design.md` §12), and paste the 1a.15 QA evidence.

---

## PR1b — Pure rules + Openpay wrapper inversion + `?step=` writers

Branch `feat/checkout-pure-rules` → `feat/checkout-single-page-flow` (tracker).
**~720 changed lines. `size:exception` required.**

### The unconsumed-exports seam — read this before starting

`design.md` §13 and the spec both flag it: the **rule** for *"a quote-signature change clears the shipping method"* lands here (`isShippingSelectionStale`, `shipping_method_stale`), but its **effect** does not land until PR2a (reducer) and PR2b (Envío UI). To a reviewer, PR1b ships rules with no callers.

**Decision taken: keep the seam. Do not restructure. Make it explicit and auditable from the diff itself.**

Why not move the stale rule forward into PR2a:
1. It would mean PR1b ships an **under-strict** `getMissingOrderRequirements` and PR2c amends it later — two touches of the strictness floor. Risk #5 says this predicate is the only guard against orders Skydropx can never label, and the spec forbids a second copy of the rule precisely because copies drift. The catalogue must be complete the moment it lands.
2. `checkout-readiness.spec.ts` must be complete on arrival anyway: the ported `hasCompleteShippingContact` incident cases go in at the same moment `checkout-step.ts` is deleted (`design.md` D8 mandatory ordering). Splitting the file splits that port.
3. PR1b is **by design** a PR whose new modules have no consumers (`design.md` §10: *"New modules have no consumers yet"*). `isShippingSelectionStale` is not an anomaly inside it; it is the same shape as everything else in the PR.

Mitigation is tasks **1b.14** and **1b.15** — a source-level `@see` pointer and a named PR-description section, so the reviewer learns it from the code, not only from the PR body.

### Pure module A — `checkout-readiness.ts` (strict TDD)

- [x] **1b.1 — RED.** Create `apps/storefront/src/lib/util/checkout-readiness.spec.ts`. Import from `./checkout-readiness` (does not exist). Cover every scenario in spec Group A: fully-ready cart → `[]`; multiple missing all reported (exactly 4); ordering `email` → `shipping_method` → `payment_method`; whitespace-only counts as absent; `null` cart → `cart_empty` only and does not throw; `cart_empty` short-circuits everything; Openpay + incomplete card → exactly `card_details`; card completeness ignored for Mercado Pago; partial address → `shipping_address`. Run `cd apps/storefront && pnpm test`, record the red output.
- [x] **1b.2 — RED (port, non-negotiable ordering).** In the **same** spec file, port every case from `apps/storefront/src/lib/util/checkout-step.spec.ts` against the new signature — `hasCompleteShippingContact`'s `address_1` + `email` + `phone` rule, blank-vs-present only, whitespace-as-absent. `design.md` D8 forbids deleting `checkout-step.spec.ts` before these exist here. Red.
- [x] **1b.3 — RED.** Add the `shipping_method_stale` cases (RC-2): `hasShippingMethod: true` with `selectionSignature !== currentQuoteSignature` → the code is present; equal signatures → absent; `selectionSignature: null` with a method present → absent (a method selected before any signature existed is not stale). Red.
- [x] **1b.4 — GREEN.** Create `apps/storefront/src/lib/util/checkout-readiness.ts`. Export `MissingRequirementCode` (spec's 8 + `shipping_method_stale`), `MissingRequirement { code, message }`, `OrderReadinessInput`, `getMissingOrderRequirements`, `canPlaceOrder`. `canPlaceOrder` MUST be literally `getMissingOrderRequirements(input).length === 0` — never a re-derivation. Messages verbatim from the spec catalogue, Mexican `tú` form. Pure. Green.
- [x] **1b.5 — TRIANGULATE.** Add the strictness-floor cases: for each condition in today's `notReady` (`payment-button/index.tsx:26-31`), a cart that today would be blocked must still be blocked. Plus the gift-card bypass (`paidByGiftCard`) and full 9-code ordering with everything missing at once. Watch fail, fix.
- [x] **1b.6 — REFACTOR.** Move the `hasCompleteShippingContact` docstring from `checkout-step.ts:5-27` **verbatim** onto the `phone` case. It is the record of a real post-sale Skydropx labelling failure; losing it in the move is the failure mode `design.md` D8 warns about. Green.
- [x] **1b.7** Add `toReadinessInput(cart, client)` to the same file — the pure adapter from `design.md` D2, plus its own spec cases. Same file so the mapping is spec'd next to the rule it feeds.

### Pure module B — `shipping-quote.ts` (strict TDD)

- [x] **1b.8 — RED.** Create `apps/storefront/src/lib/util/shipping-quote.spec.ts`. Cover spec *The Quote-Relevant Address Signature Contains Exactly Four Fields*: four fields → stable non-null signature; `address_1`/`address_2` differences produce the **same** signature; case/whitespace normalization (`"CIUDAD DE  MÉXICO"` ≡ `"ciudad de méxico"`); malformed CP (`"067"`) → `null`; missing city → `null`; and the collision case — `{city:"a", province:"b"}` must not equal `{city:"a|b", province:""}` (delimiter must be unrepresentable in a normalized value). Red.
- [x] **1b.9 — RED.** In the same file, cover spec *Quotation Readiness Is a Pure Decision Function*: the five ordered rules; `no_cart`; `incomplete_address`; `already_in_flight`; `already_quoted`; `quote` with `supersedes` non-null only when a **different** request is in flight; and the retryability case — a failed quote left `lastRequestedSignature` unchanged, so the same address re-quotes rather than silently no-op'ing. Red.
- [x] **1b.10 — GREEN.** Create `apps/storefront/src/lib/util/shipping-quote.ts`. Export `QuoteRelevantAddress`, `MX_POSTAL_CODE_PATTERN` (`/^\d{5}$/`), `buildQuoteSignature` → `string | null`, `QuoteDecision`, `evaluateQuoteReadiness`, `isQuotable`, `isShippingSelectionStale`, `QUOTE_DEBOUNCE_MS = 600` and `AUTOSAVE_DEBOUNCE_MS = 400`. Both constants exported here so no component repeats a literal (spec: single source of truth). Green.
- [x] **1b.11 — TRIANGULATE.** Add: unicode normalization of accented city names; a `province` that differs only by trailing whitespace; `isShippingSelectionStale(null, "sig")` → `false`; `isShippingSelectionStale("sig", null)` → `true`. Watch fail, fix.
- [x] **1b.12 — REFACTOR.** Docstring the deliberate field-set narrowing: `address_1`/`address_2` are **excluded** because F2 shows the backend re-lists on `country_code | province | city | postal_expression` only and `explore §4` shows Skydropx ignores street on the quote path. Cite both. This is the single change that makes R4 possible. Green.

### Spec amendments (RC-2, RC-3)

- [x] **1b.13** Amend `openspec/changes/checkout-single-page-flow/specs/storefront-checkout/spec.md`: (a) add `shipping_method_stale` to the catalogue at position 5.5 with its message and the note that it is F1/F2-driven; (b) restate the three scenarios under *A Quote-Signature Change Clears the Selected Shipping Method* as client-side invalidation + provisional total, replacing the `cart.shipping_methods` is empty assertions; (c) add a one-paragraph note recording that F1 makes cart-side removal inexpressible. **Product outcome is unchanged** — say so explicitly in the amendment.

### Seam disclosure

- [x] **1b.14** Add a `@see` docstring block to `isShippingSelectionStale` and to the `shipping_method_stale` case naming the consumer that does not exist yet: `checkout-reducer.ts` (PR2a) and `shipping-section/index.tsx` (PR2b). A reviewer must be able to answer "who calls this?" from the file, not from the PR body.
- [ ] **1b.15** PR1b description gets a **"Deliberately unconsumed in this PR"** section listing every export with no caller yet, its consumer file, and its PR. Justify the seam with the three reasons above. This is the mitigation the design flagged as required — do not skip it.

### C1 — Openpay wrapper inversion + Stripe deletion

- [x] **1b.16** Rewrite `apps/storefront/src/modules/checkout/components/payment-wrapper/index.tsx`: mount `OpenpayWrapper` from `openpayConfig` (non-null) instead of from a `pending` payment session. Remove the `paymentSession` lookup entirely — the wrapper must not read `cart.payment_collection.payment_sessions` at all. Preserve the `configMissing` short-circuit. Satisfies C1, D5, spec *The Openpay Wrapper Mounts from Provider Configuration*.
- [x] **1b.17** In the same file, delete the Stripe branch, the `loadStripe` import, `stripeKey`, `medusaAccountId` and `stripePromise`. Per `design.md` §0 CONFLICT-1 RESOLUTION, `apps/backend/medusa-config.ts` registers only `openpay` and `mercadopago`, so this branch is unreachable.
- [x] **1b.18** Delete `apps/storefront/src/modules/checkout/components/payment-wrapper/stripe-wrapper.tsx` (54 lines). Grep for remaining `StripeContext` importers — `payment-container/index.tsx:16` is one and is handled in PR2c (**2c.4**); if PR2c has not landed, keep this deletion and the `payment-container` edit **in the same commit** so the branch never has a dangling import.
- [x] **1b.19** Verify the storefront still builds after 1b.16–1b.18 (`pnpm build` in `apps/storefront`). A dangling `@stripe/*` import is the likely failure and it must not reach the tracker.

### `checkout-step.ts` retirement (ordering is mandatory)

- [x] **1b.20** Only after **1b.2** and **1b.6** are green: delete `apps/storefront/src/lib/util/checkout-step.ts` and `apps/storefront/src/lib/util/checkout-step.spec.ts`. Deleting earlier drops the incident coverage into an unguarded window (`design.md` D8).

### `?step=` writers outside checkout

- [x] **1b.21** `apps/storefront/src/modules/cart/templates/summary.tsx`: drop the `getCheckoutStep` import (`:6`), the `step` local (`:14`) and the step query (`:29`). `href` becomes `/checkout`. This is the prerequisite for 1b.20 — `summary.tsx` is `getCheckoutStep`'s only consumer.
- [x] **1b.22** `apps/storefront/src/app/[countryCode]/(checkout)/payment/openpay/return/route.ts:22`: redirect to `/{cc}/checkout?error=payment_failed`. Remove the step parameter **only**. Keep `error=payment_failed` — surfacing it is an explicit non-goal, and dropping the parameter would destroy signal for free.
- [x] **1b.23** `apps/storefront/src/app/[countryCode]/(checkout)/payment/mercadopago/failure/route.ts:19`: same edit, same constraint.

### PR1b gate

- [x] **1b.24** Run `cd apps/storefront && pnpm test`. Green, and the spec-file **count is higher** than before this PR despite deleting `checkout-step.spec.ts` (S10).
- [x] **1b.25** `grep -rn "step=" apps/storefront/src` — zero **writer** occurrences remain. Readers still exist (deleted in PR2a–PR2c); S5 is not fully met until then. Record the remaining reader count in the PR so the target is auditable.
- [ ] **1b.26 — MANUAL QA (blocking merge).** Existing checkout still reaches payment. Openpay card fields render and accept input, and `deviceSessionId` becomes available — C1 changed **when** `openpay.js` mounts, so verify on a cold load and a throttled connection (`lazyOnload` defers past hydration). This is risk #6. **AMENDED by remediation H2 — this task now has two halves, and the second one is new:** (a) in a region where Openpay **IS** an available payment method, everything above must hold; (b) in a region where Openpay is **NOT** offered (disable it backend-side for that region while leaving the merchant's Openpay keys in `/store/provider-config`), **neither `openpay.v1.min.js` nor `openpay-data.v1.min.js` may appear in the network tab at all.** Half (b) is the actual proof of the H2 fix and cannot be inferred from half (a) — before H2 both scripts loaded in that region and fingerprinted the visitor.
- [ ] **1b.27 — MANUAL QA (blocking merge).** Cart summary CTA navigates to `/checkout` with no step parameter. Trigger a Mercado Pago failure return and confirm the customer lands on a coherent checkout.
- [ ] **1b.28** Apply the `size:exception` label with a one-line justification: the pure modules and their specs are ~600 of the ~720 lines and cannot ship without each other under strict TDD.

> **PR1b implementation notes — corrections to the task text, recorded rather than absorbed.**
>
> **Module order inverted.** `shipping-quote.ts` (1b.8–1b.12) was implemented BEFORE `checkout-readiness.ts` (1b.1–1b.7). `getMissingOrderRequirements`' rule 5.5 consumes `isShippingSelectionStale`, and re-deriving that comparison inside the readiness module would have been exactly the second copy the spec forbids. Building A first would have required either a stub or a duplicated rule. The only ordering the design declares mandatory — D8's "port before delete" — is untouched: 1b.2 and 1b.6 were green before 1b.20 ran.
>
> **1b.4/1b.7 — spec contract amended, not just implemented.** `OrderReadinessInput` is a plain snapshot, not `{cart, selectedPaymentMethod, isCardDataComplete}`: `selectionSignature`/`currentQuoteSignature` are client state and are not on the cart at all, so the spec's original shape cannot express staleness — the condition the whole F1/F2 mitigation rests on. Recorded in the spec as **Amendment A1**, alongside A2 (the ninth code) and A3 (client-side invalidation) from 1b.13.
>
> **1b.18 reached one file further than the task text anticipated.** Deleting `stripe-wrapper.tsx` required deleting `StripeCardContainer` from `payment-container/index.tsx` (as the task says) AND removing its only consumer, the `isStripeLike` branch in `payment/index.tsx:259-267`, which the task did not name. Without that third edit the branch has a dangling import and `pnpm build` fails — which is precisely what 1b.19 exists to catch. `payment/index.tsx` is deleted wholesale in 2c.19; this is a minimal excision, not an early start on PR2c.
>
> **`lib/constants.tsx` gained a small edit not in any 1b task.** `isOpenpay` now delegates to `isOpenpayProviderId` in `checkout-readiness.ts`. The readiness module needs the predicate for the `card_details` rule and cannot import `constants.tsx` — it is a `.tsx` carrying JSX icon elements, and importing it would drag React into a module whose purity is the only reason it is testable under `environment: "node"`. The alternative was a duplicated `"pp_openpay_"` literal. RC-4 is respected: `isStripeLike` and the `pp_stripe_*` `paymentInfoMap` entries are untouched.
>
> **1b.19 — `pnpm build` result stated precisely.** `✓ Compiled successfully` — which is the stage that resolves imports and therefore IS the dangling-`@stripe/*` gate. The build then fails at `Collecting page data` with `ECONNREFUSED`, because no Medusa backend is running in this environment. Verified pre-existing rather than assumed: the same command on a clean worktree of HEAD fails identically, same route (`/[countryCode]/collections/[handle]`), same error. **A build against a live backend is still owed before merge.**
>
> **1b.25 as written is not achievable in PR1b, and was not achieved.** The task says "zero **writer** occurrences remain"; the section heading it sits under is "`?step=` writers **outside checkout**", which is what 1b.21–1b.23 actually cover. Measured after this PR: **0** writers outside the checkout component tree (all 3 removed), **8** writers and **4** readers remaining, every one of them inside components that PR2a (`addresses`), PR2b (`shipping`) and PR2c (`payment`, `review`) delete outright. The spec's writer list also under-counts `payment/index.tsx`: it names 3 sites, there are 4 (`:100, :141, :161, :182`). Two grep false positives to ignore at 2c.22: a `?step=delivery` reference inside a comment at `lib/data/cart.ts:792`, and the unrelated `onboarding_step=` in `product-onboarding-cta/index.tsx:22`.
>
> **1b.15 left unticked deliberately.** It is a PR-description task and no PR exists yet. The exact text to paste is in `apply-progress.md` § "PR1b — ready-to-paste PR description sections".
>
> **Remediation PART 6 (findings H1–H5) completed no numbered task, and none was ticked.** It was a review-driven correction pass on already-implemented code, so there was nothing to check off; 1b.15/1b.26/1b.27/1b.28 remain the only open PR1b items. Two things it produced that the task list did not anticipate: (1) **`payment-wrapper` gained a second mount condition** — Openpay must be an available payment method for the cart's region, not merely configured, because mounting the wrapper loads Openpay's device-fingerprinting collector and gating on provider config alone fingerprinted visitors in regions where Openpay was switched off. This required hoisting the existing `listCartPaymentMethods` call from `checkout-form/index.tsx` up to `checkout/page.tsx` and passing the list to both consumers — one fetch, no duplication, no layout change, and **not** the PR2a page hoisting. (2) **`checkout-readiness.ts` gained `isOpenpayOffered`**, extracted rather than inlined because the harness is node-only and a rule left in a `.tsx` client component cannot be tested at all — and that particular one-liner is the gate on third-party fingerprinting. Full evidence, including the four mutants that survived a green suite before this pass, is in `apply-progress.md` PART 6.
>
> **1b.28's justification no longer holds numerically.** Measured diff for PR1b is **2 491 changed lines** (2 082 + / 409 −) against the ~720 estimate — 3.4× over, not 1.2×. See `apply-progress.md` § "Line budget" for the breakdown and a proposed three-way split. **This is a delivery decision for the maintainer, not one taken here.**

---

## PR2a — State core + Datos

Branch `feat/checkout-state-core-datos` → `feat/checkout-pure-rules`.
**~1 060 changed lines. `size:exception` required.**

Floor is structural: the reducer, its spec and the `shipping-address` rewrite must land together or *Datos* has state with no form, or a form with no state (`design.md` §10).

### Pure module C — `checkout-reducer.ts` (strict TDD)

- [x] **2a.1 — RED.** Create `apps/storefront/src/modules/checkout/state/checkout-reducer.spec.ts`. Import from `./checkout-reducer` (does not exist). Cover the D1 transitions: `FIELD_BLUR` on a quote-relevant field recomputes `quoteSignature` **and** clears `selectedShippingOptionId` **in the same transition** when `isShippingSelectionStale` holds; `FIELD_BLUR` on `address_1` does neither. Red.
- [x] **2a.2 — RED.** Add: `QUOTE_READY` whose `signature` ≠ current `quoteSignature` is **dropped entirely**, never merged; `QUOTE_STARTED` sets `inFlightSignature`; a failed quote leaves `quotedSignature` unchanged so the same address is retryable (spec). Red.
- [x] **2a.3 — RED.** Add: `CART_UPDATED` replaces `state.cart` and refreshes `shippingAddressId` / `billingAddressId` from the returned cart; `SELECT_SHIPPING_OPTION` records `selectionSignature` from the current `quoteSignature`; `initFromServer` derives `quoteSignature` from `cart.shipping_address` for the returning-cart case. Red.
- [x] **2a.4 — GREEN.** Create `apps/storefront/src/modules/checkout/state/checkout-reducer.ts`. Implement `CheckoutState` per `design.md` D1, with `quoteStatus` using the **spec's** six customer-visible states — `idle | looking_up | quoting | quoted | not_serviceable | failed` — not the design's `incomplete/loading/ready/unserviceable` naming (RC-1 applies to state names too). Keep `cpStatus` internal for the SEPOMEX lookup; `looking_up` is derived from it. Pure: no `fetch`, no effects, no `window`. Green.
- [x] **2a.5 — TRIANGULATE.** Add the ordering traps: two `QUOTE_READY` arriving out of order (older last) — the older must be dropped; `FIELD_BLUR` fired **while** a quote is in flight for a now-superseded signature; `CART_UPDATED` arriving after the address id changed server-side. Watch fail, fix.
- [x] **2a.6 — REFACTOR.** Docstring the reducer as the replacement for the `useRef` cascade it retires — `hydratedRef`, `lastPrefetchedSignature`, `initiatedDefaultRef` (`shipping-address/index.tsx:83,90,96`; `payment/index.tsx:186`) — and state that centralising the transition is what removes that class of ordering bug rather than relocating it. Green.

### Context and orchestration

- [x] **2a.7** Create `apps/storefront/src/modules/checkout/state/checkout-context.tsx`: `CheckoutProvider` + `useCheckout()`, wrapping `useReducer(checkoutReducer, initFromServer(props))`. No new dependency — `useReducer` + Context only (D1 rejected react-query/SWR/Zustand explicitly).
- [x] **2a.8** Implement the **autosave effect** in the provider: fires on `FIELD_BLUR`, debounced `AUTOSAVE_DEBOUNCE_MS` (400) from `shipping-quote.ts`, skips when the draft is shallow-equal to the last successful save, skips entirely when the changed fields are outside both the quote signature and the persisted set. Calls `persistCheckoutDraft(draft, email, state.shippingAddressId)` → `dispatch(CART_UPDATED)`. Persists **invalid values anyway** (settled decision 3). Satisfies R6, spec *Autosave Persists Field-Level Without Clobbering Untouched Fields*.
- [x] **2a.9** Implement the **requote effect** per `design.md` D6: consult `evaluateQuoteReadiness`; on `action: "quote"` run `QUOTE_STARTED` → `persistCheckoutDraft` → `listCartShippingMethods` → `Promise.allSettled` of `calculatePriceForShippingOption` for `price_type === "calculated"` options → drop the whole result if the signature moved → `QUOTE_READY`. Debounce `QUOTE_DEBOUNCE_MS` (600), trailing edge. Autosave must **not** bypass the quote debounce (spec: independent concerns).
- [x] **2a.10** Wire the returning-cart case (spec *A Returning Cart Is Quoted on Load*): if `initFromServer` produced a quotable signature, fire one requote on mount **skipping the persist step** — the address is already persisted. Satisfies edge case 6.
- [x] **2a.11** Surface `autosaveStatus` as a quiet inline indicator. It must never block typing, clear a field, move focus, or gate interaction. A failed autosave is a status, not a wall.

### Page and layout

- [x] **2a.12** Rewrite `apps/storefront/src/app/[countryCode]/(checkout)/checkout/page.tsx`: hoist `listCartShippingMethods` and `listCartPaymentMethods` out of `checkout-form` into the RSC; mount `<CheckoutProvider initial={...}>`; pass `<ItemsPreviewTemplate cart={cart}/>` as a **slot** so that subtree stays server-rendered. Satisfies D7.
- [x] **2a.13** Rewrite `apps/storefront/src/modules/checkout/templates/checkout-form/index.tsx` as a **client layout component only** — no data fetching. Replace the `if (!shippingMethods || !paymentMethods) return null` bail (`:22-24`) with a **degraded render**: a checkout that renders nothing because the options endpoint hiccuped is worse than one that renders with an error in *Envío*.
- [x] **2a.14** Create `apps/storefront/src/modules/checkout/components/contact-address-section/index.tsx` — the "Datos" section. Always visible, always interactive, no `pointer-events-none`, no gating `opacity-50`. Satisfies R1, spec *No Checkout Section Is Ever Disabled*.
- [x] **2a.15** Gut `apps/storefront/src/modules/checkout/components/shipping-address/index.tsx` into a **controlled presentational form**. Every `useEffect`, `useRef` and signature helper moves to the reducer: `buildShippingSignature` (`:33-45`), `hydratedRef` (`:83`), `lastPrefetchedSignature` (`:90`), the `AbortController`/`cancelled` triad (`:307-370`), and the `address_1 && address_2` prefetch gate (`:296-305`). **The gate deletion is R4** — the single change that lets a postal code alone trigger a quote.
- [x] **2a.16** Preserve the SEPOMEX degradation path: `No encontramos ese código postal. Completa los datos a mano.` (`shipping-address/index.tsx:481`) verbatim, manual state/city entry still works, and a lookup failure **never** enters `failed` and never blocks the section. Satisfies edge case 1, spec *A SEPOMEX Failure Never Blocks Checkout*.
- [x] **2a.17** Form fields are **unchanged** (R7). No field reduction, no restructuring — that is a recorded non-goal.
- [x] **2a.18** Delete `apps/storefront/src/modules/checkout/components/addresses/index.tsx` (215 lines) and `apps/storefront/src/modules/checkout/components/address-shipping-group/index.tsx` (56 lines). The latter's own docstring states its only job is threading one value between two siblings; Context subsumes it and the server-rendered children it protected no longer exist.
- [x] **2a.19** Add the mobile scroll clearance to the form column: `pb-[calc(6rem+env(safe-area-inset-bottom))] small:pb-12`, so PR2c's sticky bar cannot cover the last field. Landing it here avoids a layout regression window on the chain.

### PR2a gate

- [x] **2a.20** `cd apps/storefront && pnpm test` green, `checkout-reducer.spec.ts` included. **Re-verified after the PART 8 remediation: 537 tests / 11 files green** (was 470/10).

### PR2a remediation — `review-reliability` findings (added by the PART 8 pass)

None of these existed as numbered tasks; they came from a fresh-context reliability review of the staged
PR2a diff. All were independently re-confirmed before any code was written. Evidence in `apply-progress.md`
PART 8.

- [x] **2a.R1 (B1, BLOCKER)** Close the two-concurrent-`persistCheckoutDraft`-writers race that reopened PR1a's `em.create` PII-destruction path. Extracted `state/checkout-write-scheduler.ts`: at most one write in flight, and a queued write re-derives its patch against the cart the previous write actually persisted (`selectWriteBaseCart`, compared by sequence). Both effects funnel through it. Both failure modes reproduced as tests.
- [x] **2a.R2 (B1)** Correct the false `CART_UPDATED` docstring that claimed *"the shipping address has exactly ONE writer, the autosave"*. It now states that sequencing orders responses, that the `absent` TOCTOU is on the request side and is **not** closed by it, and that PR2c's `syncCheckoutAddresses` must go through the scheduler.
- [x] **2a.R3 (B2, BLOCKER)** The PART 7 claim of "47/47 mutants killed" was false — re-measured, **16 of 16 survived** a green 470-test suite. All 16 killed. Radius widened by 19 further mutants over the new code. **Final: 35 mutants, 35 killed, 0 survivors** (25 reducer + 10 scheduler).
- [x] **2a.R4 (C3, CRITICAL)** Stop the duplicate live carrier quote rounds caused by `shippingOptions` array-identity churn. Added `selectShippingOptionsKey`; the provider memoizes on it. `shipping/index.tsx` deliberately untouched — PR2b rewrites it.
- [x] **2a.R5 (C4, CRITICAL)** `QUOTE_RETRY` had zero dispatchers, making `failed` terminal. Added `components/quote-retry-notice` (Mexican Spanish, `tú`, existing design system, `aria-live="polite"`), mounted in `checkout-form`. Does not render for `not_serviceable`.
- [x] **2a.R6 (W5)** Extract the 400/600 debounce composition out of the untestable `.tsx` and test it under `vi.useFakeTimers()` in node. This is what makes 2a.R1 verifiable rather than asserted.
- [x] **2a.R7 (W6)** React correctness: `stateRef` assignment moved out of render into an effect; context split into actions / cart / state so the tree no longer re-renders per keystroke; `selectShouldLookUpPostalCode` dep gap closed **without** touching the mount-case fix.
- [x] **2a.R8 (W7)** `billingDraft` now mirrors the shipping draft while `sameAsBilling` is true, so unchecking the box yields a prefilled billing form instead of an empty one. PR2c still owns the billing write.
- [ ] **2a.R9 — MANUAL QA (blocking merge).** On a **new** cart with a throttled connection, type a postal code and blur a field in the same moment. Confirm in the database that exactly ONE shipping address row was created and that `province`/`city` are present. The scheduler spec proves the ordering; only this proves the row count.
- [ ] **2a.R10 — MANUAL QA (blocking merge).** Force a quote failure: the retry notice appears, *Intentar de nuevo* actually re-requests, and a genuinely unserviceable address does **not** show it.
- [ ] **2a.R11 — MANUAL QA.** Network tab, load checkout, type nothing, count `calculatePriceForShippingOption` rounds — C3's fix should reduce the three observed rounds.
- [ ] **2a.R12 — MANUAL QA.** Fill the shipping address, uncheck *same as billing*, confirm the billing form arrives prefilled (W7).
- [ ] **2a.R13** Consider deduping `@types/react` (18.3.31 + 19.0.5 both installed) as a follow-up. Every design-system component in JSX emits TS2786 because of it, which makes the tsc gate nearly unreadable: baseline 293, now 298, and all 5 new entries are that same pre-existing defect.
- [ ] **2a.21 — MANUAL QA (blocking merge).** Fill contact + address, blurring each field; reload before pressing anything. **Every blurred field repopulates** (S6). Then confirm `first_name`/`last_name`/`company`/`phone` survive a postal-code-only change (S7 again, now via the autosave path — this is the path that made the bug critical).
- [ ] **2a.22 — MANUAL QA (blocking merge).** *(design §11 item 6.)* Block `/store/postal-codes/*` in devtools. Enter a valid CP: the degradation message appears, state and city are manually enterable, the Envío section stays visible, and quoting proceeds once both are present.
- [ ] **2a.23 — MANUAL QA (blocking merge).** Enter **only** a valid 5-digit postal code, nothing else. A quote is requested (S3). Then type into `address_1` — **no** quote is requested.
- [ ] **2a.24** Apply `size:exception` with the `design.md` §10 floor justification: reducer + spec + `shipping-address` rewrite are atomic. **The justification must be rewritten against the COMBINED figure** — the PART 8 remediation added ~2 077 changed lines (of which ~1 264 are tests) on top of PART 7's already-over-budget total. The PART 7 number is stale.

---

## PR2b — Envío

Branch `feat/checkout-envio` → `feat/checkout-state-core-datos`.
**~650 changed lines. Borderline — see 2b.10.**

This PR is where PR1b's stale-selection rule finally gets its effect. Reference **1b.15** in the description.

- [x] **2b.1** Create `apps/storefront/src/modules/checkout/components/shipping-section/index.tsx` rendering **exactly one** of the six states from spec *The Quotation Lifecycle Has Six Customer-Visible States*, and always one: `idle` → `Ingresa tu código postal para ver las opciones y el costo de envío.`; `looking_up` → `Buscando código postal…` (existing copy, `shipping-address/index.tsx:476`); `quoting` → loading, with previously quoted prices **not** left visible as if current; `quoted` → real prices; `not_serviceable`; `failed`.
- [x] **2b.2** Implement `idle` as an **instructional placeholder** (R3): no option rows, no `—` placeholder prices. A fake list is worse than an honest instruction.
- [x] **2b.3** Implement `not_serviceable` (settled decision 4): `Todavía no llegamos a esa zona. Prueba con otro código postal.` **No fallback path** — no manual-quote form, no contact-support link, because no such channel exists in checkout today. Satisfies edge case 2.
- [x] **2b.4** Implement `failed` (edge case 3, `design.md` D4): entered when the option list is **non-empty** but every calculated price is `null` — the `MissingDimensionsError` signature. Message `No pudimos calcular el envío. Verifica tu código postal e inténtalo de nuevo.` must **not** blame the address, because the address is not the problem and the customer cannot fix it. An **empty** list stays `not_serviceable`. Retry must work without a page reload.
- [x] **2b.5** Wire selection: `SELECT_SHIPPING_OPTION` → `setShippingMethod` → `dispatch(CART_UPDATED)` with the returned cart. Per F1 the POST is replace-all, so the previous method is removed atomically in the same request — no orphan, no separate delete.
- [x] **2b.6** Implement the **stale-selection effect** (settled decision 1 via F1/F2 — the RC-3 mechanism): on a quote-signature change the reducer has already cleared `selectedShippingOptionId`, so **no radio is checked** after a postal-code change. Confirm no `useEffect` re-selects it. Consumes `isShippingSelectionStale` from PR1b — this is the seam closing.
- [x] **2b.7** Rewrite `apps/storefront/src/modules/checkout/templates/checkout-summary/index.tsx` as a client component reading `state.cart` for totals, accepting the items slot from **2a.12**, and rendering the **provisional total** state from `design.md` D4: when `shipping_method_stale` is present, the shipping line and grand total are visually de-emphasised with `El costo de envío se recalcula cuando elijas el método.` The summary must **never** present a re-priced number the customer never agreed to as final. Satisfies spec *The summary never shows a stale shipping price*.
- [x] **2b.8** Update `apps/storefront/src/modules/checkout/components/discount-code/index.tsx` to dispatch `CART_UPDATED` with the cart returned by `applyPromotions` (**1a.9**), instead of relying on tag revalidation the client no longer reads. Satisfies edge case 7, spec *Cart Mutations During Checkout Re-Derive Price and Readiness*.
- [x] **2b.9** Delete `apps/storefront/src/modules/checkout/components/shipping/index.tsx` (420 lines), including the `?step=` reader at `:107` and the writers at `:164,168`, and the duplicate `buildCartShippingSignature`/`hasValidPrefetch` helpers now owned by `shipping-quote.ts`.
- [x] **2b.10** Measure the actual diff before opening the PR. `design.md` §10 estimates ~650 but §13 decision 3 lists exceptions only for PR1b, PR2a and PR2c — an inconsistency in the design. If the diff lands ≤ 600, no exception. If it lands over, apply `size:exception` and note that the design's exception list was incomplete rather than that the scope grew.

### PR2b gate

- [x] **2b.11** `cd apps/storefront && pnpm test` green (no new specs expected — this PR is all UI).
- [ ] **2b.12 — MANUAL QA (blocking merge).** *(design §11 item 5.)* Select a shipping method, then change the postal code. The radio **clears**, the CTA blocks with `Vuelve a elegir el método de envío: cambiaste el código postal.`, and the summary total renders as provisional. Then edit `address_1` and blur — the selection must **survive**.
- [ ] **2b.13 — MANUAL QA (blocking merge).** *(design §11 item 7.)* Enter a valid but unserviceable CP. The decision-4 message shows, no empty list, no fallback offered, CTA reports `Elige un método de envío.`
- [ ] **2b.14 — MANUAL QA (blocking merge).** *(design §11 item 8.)* Add a variant with no weight or missing L/W/H to the cart. The `failed` message shows, does **not** blame the address, and the **2c/1a.13** `console.error` appears in the log.
- [ ] **2b.15 — MANUAL QA (blocking merge).** *(design §11 item 10 — the F2 warning.)* With a shipping method already selected, type through the full address blurring each field. **Watch backend Skydropx call volume.** Every `updateCart` triggers `refreshCartShippingMethodsWorkflow` → a live carrier quote. If the 400 ms debounce and the unchanged-draft skip are not collapsing these, the mitigation is not working — record the observed count in the PR.

---

## PR2c
> **Settled decision added after PR1b review — Openpay fingerprinting trigger.**
> The Openpay scripts must load when the customer **selects Openpay as their payment
> method**, NOT on checkout mount. See `design.md` §12b. PR1b left the mount gated on
> `openpayConfig && isOpenpayOffered(...)`; PR2c must move the trigger to selection.
> The wrapper must still NOT depend on a payment session existing — that is what makes
> R5 possible. Surface the script-load delay as a pending state on the card fields,
> never as a blocked section.

 — Pago + CTA

Branch `feat/checkout-pago-cta` → `feat/checkout-envio`.
**~900 changed lines. `size:exception` required.**

Floor is the CTA: `payment-section`, `payment-button` and `place-order-bar` are one flow, and the `review` deletion must land in the same commit as the CTA that replaces it or there is a window with no way to place an order.

### Payment section

- [ ] **2c.1** Create `apps/storefront/src/modules/checkout/components/payment-section/index.tsx`: renders `availablePaymentMethods` as radios. Selecting one dispatches `SELECT_PAYMENT_PROVIDER` — **pure client state, zero network** (R5). Openpay card fields render on selection with **no session required** (C1). Satisfies spec *No Payment Session Exists Before the Final CTA Is Clicked*.
- [ ] **2c.2** Delete the one-shot `initiatedDefaultRef` guard logic entirely (was `payment/index.tsx:186-205`). It cannot re-initiate after a session wipe and has no purpose once initiation moves to the CTA. Any "payment ready" state must derive from live cart state and the customer's selection, **never** from a one-shot flag.
- [ ] **2c.3** No Stripe branch in the new section. Per `design.md` §0 CONFLICT-1 RESOLUTION, `apps/backend/medusa-config.ts` registers only `openpay` and `mercadopago`; **R5 applies universally with no provider carve-out.**
- [x] **2c.4** ~~Delete `StripeCardContainer` from `apps/storefront/src/modules/checkout/components/payment-container/index.tsx` (`:79-140`) plus the `@stripe/react-stripe-js`, `@stripe/stripe-js` and `StripeContext` imports (`:9,10,16`). Keep `PaymentContainer` and `OpenpayCardContainer`.~~ **DONE IN PR1b as part of 1b.18** — `StripeCardContainer` was the only consumer of `StripeContext`, so it had to be deleted in the same commit as `stripe-wrapper.tsx` or the branch would have carried a dangling import. `PaymentContainer` and `OpenpayCardContainer` were kept. Ticked here so PR2c does not look for work that no longer exists. **Nothing remains for PR2c under this task.**

### CTA and place-order flow

- [ ] **2c.5** Rewrite `apps/storefront/src/modules/checkout/components/payment-button/index.tsx` to dispatch on **`state.selectedPaymentProviderId`**, not on `cart.payment_collection?.payment_sessions?.[0]?.provider_id` (`:33-59`). Under R5 that array is empty at render, so the old dispatch would render the disabled default branch forever and no order could ever be placed. **This retires explore risk #8 rather than deferring it** — the `payment_sessions[0]` vs `status === "pending"` asymmetry disappears because the dispatch stops reading sessions at all. Record it as resolved in the PR, not as a follow-up.
- [x] **2c.6** ~~Delete `StripePaymentButton` (`payment-button/index.tsx:70-180ish`) and the `useElements`/`useStripe` imports (`:12`). Keep the disabled `Selecciona un método de pago` default branch.~~ **DONE IN PR1b — pulled forward.** 1b.18 deleted `stripe-wrapper.tsx`, which removed the app's only `<Elements>` provider; `useStripe()`/`useElements()` THROW outside that provider, so leaving this component would have left the branch carrying a crash-on-mount component and a live import of a package PR1b drops. The `case isStripeLike(...)` dispatch arm went with it; the disabled `Selecciona un método de pago` default branch was kept. **Nothing remains for PR2c under this task.**
- [x] **2c.7** Implement `placeOrderFlow()` in `checkout-context.tsx` per `design.md` D5, in exactly this order: (0) defensive `canPlaceOrder` re-check — a disabled button is an affordance, not a lock; (1) **provider pre-flight before any backend mutation** — Openpay tokenizes in the browser and asserts `deviceSessionId` is non-null; (2) `syncCheckoutAddresses` with **both** addresses carrying their ids; (3) **total-change guard**; (4) `initiatePaymentSession`; (5) provider tail. Step 1 before step 2 is deliberate: a card that fails tokenization must not have caused a single backend write.
- [x] **2c.8** Implement the **total-change guard** (D5 step 3): if the cart returned by step 2 has `total !== state.totalAtRender`, dispatch `CART_UPDATED` and an error — `El costo de envío cambió. Revisa el total y confirma de nuevo.` — and **abort**. Step 2 runs `updateCartWorkflow`, which per F2 re-prices shipping via a live carrier quote; charging a total the customer never saw is not acceptable, and Medusa would destroy the session we are about to create anyway (`explore §2b`). One honest extra click beats a mystery failure.
- [x] **2c.9** Implement the **Openpay tail** per spec *Openpay Places the Order in Tokenize → Initiate → Complete Order*: tokenize → `initiatePaymentSession` with `{ token_id, device_session_id, return_url, customer }` → `placeOrder()` → redirect to `/{countryCode}/order/{id}/confirmed`. On throw, re-read the cart and follow `requires_more` → `data.redirect_url` (3DS). **Every CTA click re-tokenizes** — an Openpay token is single-use and reusing one from a failed attempt is forbidden. If `deviceSessionId` is unavailable, fail with an inline Spanish error rather than initiating with `device_session_id: null`.
- [x] **2c.10** Implement the **Mercado Pago tail** per spec: `initiatePaymentSession` with `{ back_urls_base }` → read `init_point` → `window.location.href`. **`placeOrder` is NOT called** — the webhook is the source of truth (`explore §6`). If the session returns without a usable `init_point`, show an inline Spanish error and **do not navigate**. Silently navigating to `undefined` is forbidden.
- [x] **2c.11** Implement the **manual tail**: `initiatePaymentSession` → `placeOrder()`. All three tails must show an inline Spanish error and **re-enable the button** on any failure.
- [x] **2c.12** Rename `setAddresses` → `syncCheckoutAddresses` in `apps/storefront/src/lib/data/cart.ts`: sends **both** shipping and billing addresses **with their ids** (same merge rule as D3 — billing is exposed to the identical `EntityAssigner` replacement hazard), returns `{ ok: true; cart } | { ok: false; error }`. Update callers.
- [x] **2c.13** ~~Drop `@stripe/react-stripe-js` and `@stripe/stripe-js` from `apps/storefront/package.json:25-26` and regenerate the lockfile. Do this **last**, after 2c.4 and 2c.6, and verify `pnpm build` passes.~~ **DONE IN PR1b — pulled forward with 2c.6.** Its stated precondition was met: 2c.4 and 2c.6 both landed in PR1b, and a repo-wide grep confirmed zero remaining `from "@stripe/*"` imports in `apps/storefront/src` before the drop. `pnpm build` reaches `✓ Compiled successfully` — the import-resolution stage, which is the actual dangling-import gate. **Nothing remains for PR2c under this task.**
- [ ] **2c.14** **STILL OPEN AND STILL CORRECT** — unaffected by the 2c.4/2c.6/2c.13 pull-forward. **Do not** remove `isStripeLike` or the `pp_stripe_*` `paymentInfoMap` entries from `apps/storefront/src/lib/constants.tsx`. Per RC-4 it still has a live caller at `modules/order/components/payment-details/index.tsx:43`, which is outside this change's scope. `design.md` §0's condition ("once it has no callers") is unmet. Add a one-line code comment recording the remaining caller and open a follow-up issue.

> **PR2c SLICE 1 implementation notes — corrections to the task text, recorded rather than absorbed.**
>
> Slice 1 = **2c.7–2c.12 only** (the data + flow core). `payment-section`, `payment-button`,
> `missing-items-list`, `place-order-bar`, `legal-notice` and the `payment`/`review` deletions are
> **slice 2** and were deliberately not touched, so the existing four-step components still work
> exactly as they did. Branch `feat/checkout-place-order-flow`.
>
> **The delivery plan's base is stale, and this is a correction not a deviation.** Line 104 says PR2c
> branches from `feat/checkout-envio` on a feature-branch chain. PR1a, PR1b, PR2a and PR2b have all
> been MERGED to `main` (merge `390da52` plus later commits) and **zero `checkout*` branches remain**
> (`git branch -a`). The chain has collapsed, so slice 1 branches off `main` at `a344eb9`. The
> tracker-only-merges-to-`main` protection the chain existed to provide is already spent.
>
> **2c.7 — `placeOrderFlow` is NOT in `checkout-context.tsx`, and that is deliberate.** It lives in
> `modules/checkout/state/place-order-flow.ts` as a dependency-injected orchestrator. `design.md` D5
> says "in `checkout-context.tsx`"; taken literally that puts the ordering rule that decides whether a
> customer is charged, charged twice, or told why they were not, into the one file the node-only runner
> cannot load. This change has already shipped three rules that way — PR2a's two concurrent writers,
> PR2b's `classifyQuoteResult`, PR1b's fingerprinting gate — each defended by a confident docstring and
> asserted nowhere. Same precedent and same shape as `checkout-write-scheduler.ts`. **Every step and
> their order are D5's, unchanged; only the file placement differs.**
>
> **2c.7 — the Openpay gateway is a per-CALL argument, not a provider-held value.** `CheckoutProvider`
> is mounted OUTSIDE `PaymentWrapper` (`checkout/page.tsx:64-83`), which is what supplies
> `OpenpayContext`. A provider reading that context would get the DEFAULT value — `deviceSessionId:
> null`, `tokenize` rejects — and every Openpay charge would fail, invisibly to any unit test. Slice 2's
> CTA lives inside the wrapper and must call `placeOrderFlow(openpay)` with the live context value.
>
> **2c.8 — the flow does NOT dispatch `CART_UPDATED` itself.** D5 step 3 lists it inline, but that was
> written before the write scheduler existed. `syncCheckoutAddresses` runs through
> `scheduler.runExclusive`, which already dispatches it with the correct sequence; a second dispatch
> would carry an already-superseded sequence and be dropped. The summary still shows the new total
> before the customer re-confirms.
>
> **2c.8 — `state.totalAtRender` does not exist and was not added.** D5 names it as a state field. It
> would be a second copy of `state.cart.total`, which is the value `CheckoutSummary` actually renders,
> and the whole change treats a second copy of a rule as the defect. The guard compares the pre-write
> `state.cart.total` against the cart the write returned — same number, one source.
>
> **2c.12 — "Update all callers" had no callers to update.** `setAddresses` was left with ZERO
> production callers when PR2a deleted `addresses/index.tsx`. It was dead code still carrying the
> id-less write that PR1a's whole finding is about. Verified by grep before and after.
>
> **New: `scheduler.runExclusive`.** PR2b's handoff said *"PR2c's `syncCheckoutAddresses` DOES write the
> address and MUST go through the scheduler"*. `persistNow` could not be reused (its payload is the
> unsaved-draft diff), so the scheduler gained one method that puts a foreign write on the same FIFO
> chain under the same sequence counter.
>
> **New: `PLACE_ORDER_STARTED` / `PLACE_ORDER_SETTLED` + `state.placingOrder`.** Needed for 2c.11's
> "re-enable the button on any failure". The authoritative re-entrancy guard is a SYNCHRONOUS closure
> flag inside the flow, not this field: the provider reads state through a ref assigned in an effect,
> so it lags a commit and two clicks in one commit would both see `false` and both charge the card.
>
> **New: `isMercadopagoProviderId` / `isManualProviderId` in `checkout-readiness.ts`.** Same reason
> `isOpenpayProviderId` is there (PR1b): `lib/constants.tsx` carries JSX and cannot be imported by a
> node-tested module. `constants.tsx` delegates, so each prefix still has one definition. RC-4 respected
> — `isStripeLike` and the `pp_stripe_*` entries are untouched.
>
> ### ⚠️ BLOCKER FOUND, NOT FIXED — the billing-address deadlock (owner: slice 2)
>
> `getMissingOrderRequirements` emits `billing_address` whenever `cart.billing_address` is falsy
> (`checkout-readiness.ts:325`). After the single-page migration the **only** production writer of
> `billing_address` in the entire storefront is `syncCheckoutAddresses` — which runs on the CTA click,
> behind the very check blocking it. `persistCheckoutDraft` never writes billing by design (D3), and
> `setAddresses`, which used to write it at the address step, was deleted by this slice.
>
> **A cart that has never had a billing address can therefore never place an order.** The CTA reports
> `Falta tu dirección de facturación.` forever. This is the same shape as the `?step=payment` deadlock
> PR2c exists to remove. Verified by grep: `billing_address:` has exactly one production writer.
>
> Not fixed here because the fix is in `toReadinessInput`, whose `hasBillingAddress` is a CART fact and
> probably wants to be a CLIENT one — precisely the `hasShippingMethod` vs `hasSelectedShippingOption`
> split that file already makes, for the identical F1 reason. That is a strictness-floor change, which
> this file calls a product decision rather than a refactor, and it is outside 2c.7–2c.12.
>
> **Pinned by a tripwire test** in `place-order-flow.spec.ts` ("TRIPWIRE: billing-address deadlock").
> It is EXPECTED to fail the moment slice 2 addresses it — that failure is the handoff working.

### CTA presentation

- [ ] **2c.15** Create `apps/storefront/src/modules/checkout/components/missing-items-list/index.tsx`: renders **all** entries from `getMissingOrderRequirements` in the returned order, one per line, updating reactively. The container carries `role="status"` and `aria-live="polite"` and lives **outside** the button and always in the DOM — a `disabled` button is removed from the tab order and skipped by screen readers, so putting the explanation inside it would defeat R8 entirely. Do **not** add `aria-disabled` alongside `disabled`.
- [ ] **2c.16** Create `apps/storefront/src/modules/checkout/components/place-order-bar/index.tsx` with two variants per `design.md` D9: `inline` (`hidden small:block`, end of the form column) and `sticky` (`small:hidden fixed inset-x-0 bottom-0`, mobile only). Both share enabled/disabled state. Label `Realizar pedido`.
- [ ] **2c.17** Sticky variant specifics: `pb-[calc(0.75rem+env(safe-area-inset-bottom))]` so the iOS home indicator never cuts off the purchase button; the **cart total** sourced from the same value `CheckoutSummary` displays so the two can never disagree; de-emphasised as provisional when `shipping_method_stale` is present; **only the first** missing message (the full list renders in the page flow above); existing `Button size="large"` is already `h-12` (48 px) so no touch-target change. Satisfies settled decision 5, spec *Mobile Renders a Sticky Bottom CTA Bar*.
- [ ] **2c.18** Create `apps/storefront/src/modules/checkout/components/legal-notice/index.tsx` with the copy **verbatim** from `review/index.tsx:43-46`: `Al hacer clic en Realizar pedido, confirmas que leíste, entendiste y aceptas nuestros Términos de uso, Términos de venta y Política de devoluciones, y reconoces que leíste la Política de privacidad de MANDO.` Renders directly above the inline CTA. **Informational only** (settled decision 2) — not a checkbox, never a `MissingRequirementCode`. On mobile it stays in document flow above the sticky bar.

### Deletions

- [ ] **2c.19** Delete `apps/storefront/src/modules/checkout/components/payment/index.tsx` (330 lines) — including the `?step=` reader at `:68` and writers at `:136,155,172`.
- [ ] **2c.20** Delete `apps/storefront/src/modules/checkout/components/review/index.tsx` (60 lines) and its directory — the `?step=` reader at `:12` goes with it. **Same commit as 2c.16/2c.18**, or the branch has a window with no way to place an order.

### PR2c gate — the full acceptance pass

- [ ] **2c.21** `cd apps/storefront && pnpm test` green. Spec count is higher than at the start of the change (S10): `+cart-address-payload` `+checkout-readiness` `+shipping-quote` `+checkout-reducer` `−checkout-step`.
- [ ] **2c.22 — STATIC (S5).** `grep -rn "step=" apps/storefront/src` → **zero** checkout-navigation occurrences, readers and writers. This is where S5 is finally met.
- [ ] **2c.23 — STATIC (S4).** Inspect all three section containers: no `pointer-events-none`, no gating `opacity-50`, no `disabled` container.
- [ ] **2c.24 — STATIC (S2).** Exactly one order-placement button, labelled `Realizar pedido`. `submit-address-button`, `submit-delivery-option-button` and `submit-payment-button` no longer exist anywhere in `apps/storefront/src`.
- [ ] **2c.25 — MANUAL QA (blocking merge).** *(design §11 item 1.)* **Openpay happy path**: CP → options → method → card → CTA → 3DS → confirmation page. Then a rejected card: inline error, button re-enabled, `payment_sessions` still empty. Then retry: a **new** token is requested.
- [ ] **2c.26 — MANUAL QA (blocking merge).** *(design §11 item 2.)* **Mercado Pago**: CTA → exactly **one** preference created (S8) → `init_point` redirect → failure return → data intact, no `?step=` in the URL → retry mints a fresh preference. Confirm `placeOrder` is never called for MP.
- [ ] **2c.27 — MANUAL QA (blocking merge).** *(design §11 item 3.)* **Manual provider**, if enabled in the environment. If not enabled, record that explicitly — do not silently skip a gate.
- [ ] **2c.28 — MANUAL QA (blocking merge).** *(design §11 item 9.)* **Mobile**: sticky bar clears the last form field and the legal text; respects the iOS home indicator; the bar total equals the `CheckoutSummary` total with a promotion applied; the disabled state announces its reasons to a screen reader.
- [ ] **2c.29 — MANUAL QA (blocking merge).** **Browsing creates no session** (R5, the core claim): load checkout, select a payment method, change shipping method, apply a promotion. `cart.payment_collection?.payment_sessions` stays **empty** throughout and no MP preference call is made.
- [ ] **2c.30 — MANUAL QA (blocking merge).** **CTA itemization** (R8/S9): with an empty cart, only `Tu carrito está vacío.` shows. Fill fields one at a time and confirm the list shrinks in order and the CTA enables **exactly** when the list empties. Remove the last line item and confirm the CTA reports only the empty-cart message.
- [ ] **2c.31 — MANUAL QA (blocking merge).** **Total-change guard** (2c.8): force a shipping re-price between render and CTA click; confirm the abort + `El costo de envío cambió…` message rather than a silent charge.
- [ ] **2c.32** Apply `size:exception` with the `design.md` §10 floor justification, and note that the Stripe deletion reduced this PR from ~1 000 to ~900 but did **not** bring it under the 600 budget.

---

## Tracker merge

- [ ] **T.1** With PR1b → PR2c all merged into `feat/checkout-single-page-flow`, re-run `cd apps/storefront && pnpm test` and `pnpm build` on the tracker.
- [ ] **T.2** Re-run the full success-criteria table from `proposal.md` §7 against the tracker branch: S1 (0 RSC chains on section movement), S2 (1 button), S3 (CP only), S4 (0 disabled sections), S5 (0 `?step=`), S6 (reload preserves), S7 (fields survive), S8 (1 MP preference), S9 (itemized), S10 (specs green and more numerous). **S1, S2, S4, S5 are static; S3, S6, S7, S8, S9 are manual; S10 is the only automated one.** Do not claim otherwise.
- [ ] **T.3** One final end-to-end manual pass **per payment provider** on the assembled tracker, because each child PR was QA'd against a partially migrated checkout.
- [ ] **T.4** Merge the tracker to `main`. This is the only merge to `main` in the chain besides PR1a.
- [ ] **T.5** Open the recorded follow-ups, none of them in scope here: `retrieveCart`'s own `force-cache`-with-possibly-empty-tag issue (`design.md` §13); surfacing `error=payment_failed` (non-goal); `isStripeLike` removal once the order module drops it (RC-4); variant dimension data quality (`proposal.md` §4).

---

## Non-goals — do not plan or implement

Recorded in `proposal.md` §4 and confirmed in `design.md` §13. Any task touching these is out of scope:

- Reducing or restructuring form fields (R7).
- Making `error=payment_failed` visible to the customer.
- Adding jsdom, `@testing-library` or Playwright to `apps/storefront`.
- Variant dimension data quality (`buildParcel` / `MissingDimensionsError`) — surfaced honestly, not fixed.
- `retrieveCart` cache follow-up.
- Backend changes of any kind.

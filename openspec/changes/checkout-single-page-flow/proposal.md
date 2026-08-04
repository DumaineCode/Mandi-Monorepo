# Proposal — checkout-single-page-flow

Change: `checkout-single-page-flow`
Scope: `apps/storefront` only. No backend changes.
Artifact store: `both` (this file + Engram `sdd/checkout-single-page-flow/proposal`).
Required input: [`explore.md`](./explore.md) (Engram `sdd/checkout-single-page-flow/explore`, obs. 218). Every technical claim below is sourced there; section references are given as `explore §N`.

---

## 1. Business problem

Checkout is the last and most expensive point of the funnel. Today the storefront makes the customer walk a four-stop, server-rendered corridor before they can even see what shipping costs:

- Sections are gated behind a `?step=` URL parameter (`explore §1`). Each transition is a full Next.js RSC re-render that re-runs `retrieveCart()` → `retrieveCustomer()` → `getProviderConfig()` → `listCartShippingMethods()` → `listCartPaymentMethods()` **sequentially** (`checkout/page.tsx:15,21,22`; `checkout-form/index.tsx:18,19`). Four transitions = four full round-trip chains just to move around a page the customer never left.
- Inactive sections render as inert, greyed-out blocks. The customer cannot see what is coming, cannot see the shipping cost, and cannot judge the total commitment until the third stop.
- Shipping is only quoted once the customer has filled in nearly the entire address form. The prefetch gate at `shipping-address/index.tsx:296-305` requires `address_1` **and** `address_2` before it will even try. Skydropx needs neither: `calculatePrice` only requires `country_code`, `postal_code`, `province`, `city` on the destination — no street, no name, no phone (`explore §4`, `skydropx-fulfillment/service.ts:774-840`, `:431-456`). The gate is self-imposed friction, not a carrier constraint.
- A dedicated "Review" step exists whose entire job — showing the customer what they are buying — is already done by the persistent `CheckoutSummary` in the right column. It is a click that buys nothing.

**Why it matters commercially:** every mandatory click and every full-page reload before the "Place order" button is a documented abandonment surface. This checkout charges the customer four navigation clicks and four server round-trips for zero informational gain, and hides the single number that most determines whether they complete — the shipping cost — until the very end. The storefront best-practices reference is explicit that 4+ step checkouts kill conversion and that single-page is the right pattern for mobile-heavy, low-friction stores. This change removes the corridor.

## 2. Current-state gap

| Today | Problem |
|---|---|
| Section visibility driven by `?step=` in the URL, read in 4 components, written in 8 places including two payment-return routes (`explore §1`) | Navigation is a server concern; every move costs a full RSC chain |
| Inactive sections are `opacity-50 pointer-events-none` | Customer cannot preview or plan; perceived length is maximal |
| Shipping quote gated on a near-complete address | Cost is revealed late; the gate exceeds what the carrier actually requires |
| Separate "Review" step | Duplicates `CheckoutSummary`; pure friction |
| Payment session created while browsing / on method selection | Wasted work: Medusa **deletes every payment session** whenever `cart.raw_total` changes, and choosing a shipping method changes it (`explore §2b`). For Mercado Pago each init is a real outbound Checkout Pro preference call that is then thrown away (`explore §2c`) |
| `persistShippingForCalc` sends a partial `shipping_address` with **no `id`** (`lib/data/cart.ts:109-155`) | Medusa/MikroORM treats an id-less nested address as a **replacement, not a merge** — it creates a new `cart_address` row and repoints the FK, destroying `first_name`, `last_name`, `company`, `phone` (`explore §3`). This is a **live bug today**, masked only by the step gating we are removing |
| Data is only persisted on step submit | A reload mid-form loses everything the customer typed |
| `listCartShippingMethods` uses `cache: "force-cache"` with a tag that can be `""` (`explore §5`) | Uninvalidatable cache entry; the shipping-option list is address-filtered by `postal_expression`/`city`/`province_code`, so a stale list is a wrong list. Today the accidental full remounts from step navigation are what keep it fresh — removing them removes the accident |

## 3. Proposed outcome (product terms)

A single-page checkout where the customer sees the whole job at once, gets a real shipping price the moment they type their postal code, and presses one button at the end.

Three always-visible sections — **Datos** (contact + address), **Envío**, **Pago** — stacked in the left column, with the existing `CheckoutSummary` sticky in the right column. Legal text sits directly above one final CTA, **"Realizar pedido"**.

### Settled requirements

These are decisions the user has already made. They are encoded here as requirements, not reopened.

- **R1 — Single-page.** `?step=` navigation is removed entirely from checkout. Section state is client-side. The three sections are always visible, always interactive; no section is ever disabled, greyed out, or `pointer-events-none`.
- **R2 — No Review step.** The Review section is removed. Legal text moves above the single final CTA. The order summary responsibility stays with `CheckoutSummary`.
- **R3 — Empty shipping section is instructional, not fake.** Before a postal code exists, Envío renders a placeholder telling the customer to enter their postal code to see shipping options and cost. It does **not** render a list of options with `—` prices.
- **R4 — A valid 5-digit postal code alone triggers quotation.** SEPOMEX (`getPostalCode`) resolves state + city, the cart shipping address is persisted, and calculated prices are fetched. No dependency on street, colonia, name, or phone. Justified by `explore §4`.
- **R5 — Payment session creation moves to the final CTA click.** No session is created while the customer browses or selects a method. This is the accepted resolution for the session-deletion behaviour in `explore §2b` and it eliminates the wasted Mercado Pago preference calls in `explore §2c`.
- **R6 — Autosave on field blur.** Customer data persists to the cart as they go. A page reload must not lose entered data.
- **R7 — Form fields unchanged.** No field reduction in this change.
- **R8 — The final CTA is the only gate.** It is disabled until the order can actually be placed, and when disabled it shows an **explicit, itemized list of what is missing** (e.g. "Falta tu teléfono", "Elegí un método de envío"). Sections themselves are never blocked.

### Consequences the user has already accepted

- **C1 — Openpay wrapper mounts from provider configuration, not from session existence.** Today `payment-wrapper/index.tsx:37` selects the wrapper from an existing `pending` payment session. Under R5 there is no session until the very end, but the card form needs `openpay.js` mounted in the browser to tokenize. So the wrapper must mount based on `getProviderConfig`. `explore §6` verified that mounting the Openpay wrapper without a session is harmless — it reads no session data. **In scope.**
- **C2 — `persistShippingForCalc` must send `shipping_address.id`.** `StoreCartUpsertAddress` accepts an optional `id` (`validators.js:38-40`), and with `id` present MikroORM performs a true field-level merge (`explore §3`). Without it, autosave destroys customer data. **In scope, and it fixes a live bug.**
- **C3 — Shipping options must be refetched when the postal code changes**, and the `force-cache`-with-empty-tag problem on `listCartShippingMethods` must be addressed, because step navigation was the accidental cache refresh (`explore §5`). **In scope.**

### Deliverable shape imposed by testing reality

`apps/storefront` runs **vitest**, `environment: "node"`, `include: ["src/**/*.spec.ts"]`, command `cd apps/storefront && pnpm test` (`explore §8`). There is **no component test harness and no e2e**. (`testing.runner: jest` in `openspec/config.yaml` applies to `apps/backend` only.)

Therefore, any behaviour that must be verifiable under strict TDD has to live in **pure modules under `src/lib/util/`**. Two rules are non-negotiable candidates:

- the **CTA enable predicate** — given a cart, what is missing, and can the order be placed;
- the **quotation-trigger readiness rule** — given form/address state, should a quote be requested and with what inputs.

This is stated as a deliverable shape, not as an implementation design. `sdd-design` owns the module boundaries.

## 4. Scope

### In scope

- Removal of `?step=` as checkout navigation, including all readers and writers listed in `explore §1` — the four section components, `modules/cart/templates/summary.tsx:29`, and the two payment-return routes (`payment/openpay/return/route.ts:22`, `payment/mercadopago/failure/route.ts:19`).
- Restructuring of the checkout page and its sections into always-visible client-managed sections: `checkout/page.tsx`, `checkout-form`, `addresses`, `shipping`, `payment`, `address-shipping-group`, `shipping-address`; deletion of `review`.
- Postal-code-triggered quotation: SEPOMEX resolve → persist shipping address → fetch calculated prices.
- Autosave on blur.
- `persistShippingForCalc` correctness fix (`shipping_address.id`).
- Shipping-option refetch on postal-code change + cache-invalidation correctness for `listCartShippingMethods`.
- Openpay payment-wrapper mounting inverted to provider configuration.
- Deferred payment-session creation at the final CTA.
- New pure `src/lib/util/` modules for the CTA gate and quotation readiness, each with a `.spec.ts` under vitest.
- Whatever minimal touch of the `payment-button` dispatch path R5 forces (see non-goals).

### Non-goals (recorded, deliberately not solved here)

- **Reducing or restructuring form fields.** R7.
- **Making `error=payment_failed` visible.** No component reads `searchParams.get("error")` today (`explore §1`); the param is silently dropped. The return routes must be edited anyway because they write `?step=`, but the edit is limited to removing the step parameter. Surfacing the error to the customer is a separate change.
- **Fixing the `payment-button` `payment_sessions[0]` vs `status === "pending"` inconsistency** (`explore` risk #8) — **except** where R5 forces touching that dispatch path. In that case the change stays minimal and is explicitly noted for follow-up.
- **Adding jsdom / @testing-library / Playwright to `apps/storefront`.** That is its own scoped change with its own review cost.
- **Backend changes of any kind.** This change is storefront-only.
- **Variant dimension data quality.** `buildParcel` throws `MissingDimensionsError` if any cart item lacks weight or any of L/W/H (`explore §4`, `parcel.ts:49-79`), which fails the quote deterministically before any API call. This is a hard precondition for quoting but it is a **data problem**, not a checkout-flow problem.

## 5. Impact and implications

### Customer-facing

Shipping cost becomes visible early, at the cheapest possible information price (one postal code). Perceived checkout length collapses from four stops to one page. Nothing is greyed out, so the customer can fill the form in whatever order they prefer. When they cannot place the order, they are told exactly what is missing instead of being silently blocked.

### Engineering / operational

- **CRITICAL risk #1 — partial address update destroys customer fields (`explore §3`).** Autosave (R6) plus postal-code-only persistence (R4) makes this bug fire on every keystroke pause, in production, with user-visible data loss. C2 is the mitigation and it is mandatory, not optional. This is the single highest-consequence item in the change: getting it wrong turns a UX improvement into a data-loss incident.
- **CRITICAL risk #2 — Medusa deletes every payment session when `cart.raw_total` changes (`explore §2b`).** Choosing or changing a shipping method, or applying a promotion, wipes the session. R5 (create the session only at the final CTA) sidesteps this entirely: there is nothing to wipe while the customer is still deciding. It also retires the incompatible one-shot `initiatedDefaultRef` guard at `payment/index.tsx:186-205` and removes the wasted Mercado Pago preference calls.
- **Server load drops materially.** Four full RSC chains per checkout become one initial render.
- **The order-placement gate becomes a product-owned rule enforced client-side.** The backend's `completeCart` validates only that the cart has items and that the payment collection holds at least one session in an acceptable status — **no address, no email, no shipping-method check** (`explore §7`). If R8's predicate is loosened, orders can be created that Skydropx can never label. That is a documented prior incident and the reason `hasCompleteShippingContact` includes `phone` (`lib/util/checkout-step.ts:10-27`). The predicate must remain at least as strict as today's `notReady` in `payment-button/index.tsx:26-31` **plus** the phone rule.
- **No automated safety net.** There are no e2e tests and no component tests; renaming or removing `submit-address-button`, `submit-delivery-option-button`, `submit-payment-button` and `submit-order-button` breaks **zero** automated tests (`explore §9`) — which also means zero automated tests will catch a regression. Manual QA of the full checkout, per payment provider, is a required part of this change.
- **`checkout-step.ts` partially retires.** `getCheckoutStep` becomes dead for routing (its only consumer is `summary.tsx:6`), but `hasCompleteShippingContact` remains the incident-driven phone-completeness rule and should be preserved or folded into the new CTA predicate — not deleted.
- **Support burden should fall**, since "why can't I continue?" is replaced by an itemized missing-fields list.

## 6. Edge cases (PRD level)

1. **SEPOMEX lookup fails or returns nothing** for a syntactically valid postal code (outage, unknown CP). The customer **must** be able to enter state and city manually and continue. A geo-lookup failure must never block checkout or hide the shipping section.
2. **Postal code resolves but no shipping option is serviceable.** The Envío section must say so in plain language and tell the customer what to do next. The CTA stays disabled with "Elegí un método de envío" — but the customer must not be left staring at an empty list with no explanation.
3. **Cart contains an item with missing dimensions.** The quote fails deterministically before any carrier call (`explore §4`). This is not the customer's fault and not fixable by them. The message must not blame the address, and the failure must be observable to the team.
4. **Customer changes the postal code after selecting a shipping method.** The option list is address-filtered (`explore §5`), so the previously chosen method may no longer exist or may now cost differently. The selection must be re-validated against the refetched list, and the order total must never display a price derived from a stale quote. Whether to auto-reselect an equivalent option or force a fresh choice is an open product question (§9).
5. **Mercado Pago redirect-away-and-return.** MP sends the customer off-site to `init_point` and back through `mercadopago/failure/route.ts`; `placeOrder` is never called for MP — the webhook is the source of truth (`explore §6`). On return, the customer must land on a coherent single-page checkout (no `?step=`) with their data intact and be able to retry.
6. **Returning cart that already has a complete address.** On load, shipping must already be quoted and options shown — the customer should not have to re-touch the postal code field to trigger it.
7. **Promotion applied or line item edited from the summary while on checkout.** `cart.raw_total` changes; under R5 there is no session to destroy, but the shipping price and the CTA predicate must both reflect the new state.

## 7. Success criteria (observable)

| # | Criterion | Baseline (today) | Target |
|---|---|---|---|
| S1 | Full RSC round-trip chains required to move between checkout sections | 4 (each re-running `retrieveCart` → `retrieveCustomer` → `getProviderConfig` → `listCartShippingMethods` → `listCartPaymentMethods` sequentially) | **0** — one initial render, section movement is client-side |
| S2 | Mandatory button presses inside checkout to reach a placed order | 4 (`submit-address-button`, `submit-delivery-option-button`, `submit-payment-button`, `submit-order-button`) | **1** (`Realizar pedido`), plus content choices (shipping method, payment method) that are selections, not navigation |
| S3 | Customer input required before a real shipping price is displayed | Full address incl. `address_1` **and** `address_2` (`shipping-address/index.tsx:296-305`) | **A valid 5-digit postal code** |
| S4 | Disabled sections in the checkout UI | 3 of 4 at any time | **0** — no section is ever disabled or `pointer-events-none` |
| S5 | `?step=` occurrences in `apps/storefront/src` | 4 readers + 8 writers (`explore §1`) | **0** |
| S6 | Data survival across a mid-form page reload | Data entered since the last step submit is lost | **Preserved** — autosave on blur (R6) |
| S7 | Customer fields (`first_name`, `last_name`, `company`, `phone`) after a postal-code-triggered persist | Destroyed (`explore §3`) | **Preserved** — verified by an explicit check |
| S8 | Mercado Pago preference API calls per checkout session | 1 per payment-method init, discarded on every total change | **1**, at the final CTA |
| S9 | Disabled-CTA feedback | Generic / silent block | **Itemized list of exactly what is missing** |
| S10 | Vitest suite | 4 spec files green | **Green**, plus new specs for the CTA predicate and the quotation-readiness rule |

**Verification note:** S1, S2, S4, S5, S7 are inspectable statically or by manual QA. S10 is the only criterion covered by automated tests, because the storefront has no component or e2e harness. `sdd-verify` must not claim coverage it does not have.

## 8. Review workload forecast

Delivery strategy: **chained PRs** (user decision, supersedes the session's `single-pr-default` preflight choice), budget **600 changed lines** per PR.

Files expected to change (from `explore §9` plus the accepted consequences):

- Restructured: `checkout/page.tsx`, `checkout-form`, `addresses`, `shipping`, `payment`, `address-shipping-group`, `shipping-address` (7)
- Deleted: `review` (1)
- Adjusted: `payment-wrapper/index.tsx` (C1), `payment-button/index.tsx` (minimal, R5-forced), `cart/templates/summary.tsx`, `payment/openpay/return/route.ts`, `payment/mercadopago/failure/route.ts`, `lib/data/cart.ts` (C2), `lib/data/fulfillment.ts` (C3), `lib/util/checkout-step.ts` (7)
- New: pure `lib/util/` modules + their `.spec.ts` files (2–4)

**Estimated 750–950 changed lines — over the 600-line budget.** `shipping-address` and `payment` are the two largest components and both are substantially rewritten.

**RESOLVED — the user chose chained PRs.** `sdd-tasks` must produce two PR-sized task groups:
- **PR1 — data layer & correctness**: `persistShippingForCalc` `shipping_address.id` fix, shipping-options cache/refetch correctness, the pure predicate modules under `src/lib/util/` with their vitest specs, and the Openpay wrapper inversion. Independently reviewable, independently shippable, and it closes a bug that is live today.
- **PR2 — UI restructure**: the single-page checkout that consumes PR1.

Original recommendation, retained for context: treat this as **chained PRs**, not a single PR. A natural seam exists between (a) the data-layer and correctness work — `persistShippingForCalc` id fix, cache/refetch correctness, the pure predicate modules with their vitest specs, Openpay wrapper inversion — all of which is independently reviewable and shippable, and (b) the UI restructure that consumes it. `sdd-tasks` owns the actual boundary; this is a forecast, not a task breakdown. If the user prefers a single PR, it needs an explicit `size:exception`.

## 9. Proposal question round — RESOLVED

All six open gaps were put to the user and answered. These are now settled decisions,
at the same level of authority as R1–R8. Design must encode them, not reopen them.

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Postal code changed after a shipping method was selected | **Clear the selection.** The customer re-picks. Auto-reselect was rejected: the shipping price changes with the postal code, and a silently changed total is worse than one extra click. Implies the cart's shipping method must be removed when the quote-relevant address signature changes. |
| 2 | Legal text above the CTA | **Informational only**, same copy as today's Review step. Not a checkbox, and therefore NOT an item in R8's missing list. |
| 3 | Autosave with an invalid field value | **Persist anyway.** The backend normalizes the phone, and format validation is the CTA predicate's job. Losing what the customer typed is worse than a dirty cart. |
| 4 | No serviceable shipping option for the postal code | **Clear message, no fallback path.** Tell the customer we do not deliver to that area yet. No manual-quote or contact-support flow — no such channel exists in the checkout today. |
| 5 | Mobile CTA | **Sticky bottom bar with the total visible.** Standard for long single-page checkouts. Requires `env(safe-area-inset-bottom)` handling. In scope, ~60 lines. |
| 6 | Delivery shape (from §8) | **SUPERSEDED after design.** Now **five** chained PRs on a `feature-branch-chain`, PR1a standalone first. See `design.md` §10 and §13. |
| 7 | Dead Stripe code (raised during design) | **Delete it, in scope.** `apps/backend/medusa-config.ts` registers only `openpay` and `mercadopago`, so every Stripe branch in the storefront is unreachable starter code still shipping `@stripe/*` into the bundle. Removing it dissolves design CONFLICT-1 and is a net line reduction. See `design.md` §0 CONFLICT-1 RESOLUTION. |
| 8 | Shipping-method clearing mechanism (F1/F2) | **Client-side invalidation + provisional total.** Medusa exposes no way to remove a shipping method, and it silently re-prices on every address write. Product outcome unchanged. See `design.md` §0 F1/F2 and D4. |

## 10. Rollback

The change is storefront-only and contains no migrations, no backend changes, and no persisted schema or data shape changes. `?step=` removal is a UI concern; carts written by the new flow are ordinary Medusa carts readable by the old flow.

Rollback is therefore **revert-and-redeploy** on `apps/storefront`, with one caveat: the C2 fix (`shipping_address.id`) repairs a live data-destruction bug. Reverting reintroduces it. If a rollback becomes necessary, C2 should be re-landed on its own — it is independently valid and is one of the reasons the chained-PR split in §8 is recommended.

## 11. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Partial address update destroys `first_name`/`last_name`/`company`/`phone`; autosave makes it fire constantly (`explore §3`) | **CRITICAL** | C2: send `shipping_address.id` on every partial persist. Success criterion S7 verifies it explicitly |
| 2 | Payment sessions are deleted on every `cart.raw_total` change (`explore §2b`) | **CRITICAL** | R5: create the session only at the final CTA. Retire the `initiatedDefaultRef` one-shot guard |
| 3 | Shipping-option list is address-filtered and cached under a possibly-empty tag; step navigation was the accidental refresh (`explore §5`) | **HIGH** | C3: explicit refetch on postal-code change + fix the cache/tag handling |
| 4 | No component or e2e tests; testids protect nothing (`explore §8`, `§9`) | **HIGH** | Push the two testable rules into pure `lib/util/` modules with vitest specs; require a manual QA pass per payment provider before merge. Do **not** claim coverage that does not exist |
| 5 | Backend does not enforce address/email/shipping on complete (`explore §7`); a loosened CTA predicate can create unlabelable orders | **MEDIUM** | R8's predicate must be at least as strict as today's `notReady` plus the `phone` rule from `hasCompleteShippingContact` |
| 6 | Openpay wrapper inversion (C1) changes when `openpay.js` mounts and when `deviceSessionId` becomes available (`payment/index.tsx:120-124`) | **MEDIUM** | Verified harmless to mount without a session (`explore §6`), but `deviceSessionId` availability at CTA time must be explicitly designed and manually QA'd |
| 7 | Variant dimensions are a hard quote precondition; a dimensionless item fails every quote (`explore §4`). `listCartShippingMethods` has no timeout, unlike `listCartOptions` | **MEDIUM** | Out of scope as a data problem, but the failure must be surfaced honestly to the customer and observably to the team (edge case 3) |
| 8 | Change exceeds the 600-line review budget (§8) | **MEDIUM** | RESOLVED — user chose chained PRs (2 PRs, see §8) |
| 9 | `payment-button` dispatches on `payment_sessions[0]` rather than the pending session (`explore` risk #8), and R5 forces touching that path | **LOW** | Keep the touch minimal, note it explicitly, defer the real fix |

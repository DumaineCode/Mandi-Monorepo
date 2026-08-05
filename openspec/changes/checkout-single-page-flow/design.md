# Design — checkout-single-page-flow

Change: `checkout-single-page-flow`
Scope: `apps/storefront` only. No backend changes.
Artifact store: `both` (this file + Engram `sdd/checkout-single-page-flow/design`).

Required inputs, both authoritative and both re-read for this phase:
- [`proposal.md`](./proposal.md) — R1–R8, C1–C3, non-goals, and §9 (six settled decisions, encoded here, not reopened).
- [`explore.md`](./explore.md) — evidence base with `file:line` for every claim.

`sdd-spec` runs in parallel on the same proposal and owns the WHAT. This document owns the HOW.

**Tooling note:** `.codegraph/` holds only a `.gitignore` (no index) and this context has no shell tool, so `codegraph init` could not be run. Fallback was Read/Grep, same as `explore`. Every new claim below carries an explicit `file:line`.

---

## 0. Findings that correct the inputs

Two verification passes contradict premises carried in the proposal. Both are surfaced rather than absorbed, because both change what "correct" means for a settled decision.

### F1 — There is no store API to remove a shipping method. `POST .../shipping-methods` is replace-all.

Proposal §9 decision 1 says the postal-code change "implies the cart's shipping method must be **removed** when the quote-relevant address signature changes." Verified against installed source, that removal is not expressible:

- `apps/backend/node_modules/@medusajs/medusa/dist/api/store/carts/[id]/shipping-methods/route.js` exports **`POST` only**. No `DELETE`.
- `apps/backend/node_modules/@medusajs/medusa/dist/api/store/carts/validators.js` — `StoreUpdateCart` has **no `shipping_methods` key**, so the cart-update route cannot clear them either.
- `node_modules/.pnpm/node_modules/@medusajs/core-flows/dist/cart/workflows/add-shipping-method-to-cart.js` runs
  `parallelize(removeShippingMethodFromCartStep({ shipping_method_ids: currentShippingMethods }), addShippingMethodToCartStep({...}))`.
  So the POST is a **replace-all**, and it is the *only* way to reach `removeShippingMethodFromCartStep` from the storefront — and it requires a replacement option id, which is precisely what decision 1 forbids auto-picking.

### F2 — The backend already re-prices a still-valid shipping method on every address write. Silently.

- `.../core-flows/dist/cart/workflows/update-cart.js:233` — `updateCartWorkflow` unconditionally runs `refreshCartItemsWorkflow`.
- `.../core-flows/dist/cart/workflows/refresh-cart-items.js:130` — that unconditionally runs `refreshCartShippingMethodsWorkflow`.
- `.../core-flows/dist/cart/workflows/refresh-cart-shipping-methods.js:90-138` — for each existing shipping method it re-lists options **for the new cart context** via `listShippingOptionsForCartWithPricingWorkflow`, then:
  - methods whose option is absent or priceless for the new address → `removeShippingMethodFromCartStep` (**auto-removed**);
  - methods whose option is still valid → `updateShippingMethodsStep` with `amount: shippingOption.calculated_price.calculated_amount` (**auto-re-priced**).

Half of this is a gift: a now-unserviceable method disappears by itself. The other half is exactly the failure mode decision 1 exists to prevent — **the total silently changes under the customer**.

**Consequence for the design.** "Clear the selection" is implemented as **client-side selection invalidation plus an explicit provisional-total state**, not as a cart mutation. The product decision is honored in full (customer re-picks, no silent total change); only the mechanism differs from the one the proposal assumed. See D4.

### F3 — `listShippingOptionsForCartWorkflow` does not call the carrier (minor evidence correction)

`apps/backend/node_modules/@medusajs/medusa/dist/api/store/shipping-options/route.js` dispatches to `listShippingOptionsForCartWorkflow`, whose own docstring (`.../list-shipping-options-for-cart.js:17-18`) states it "doesn't retrieve the calculated prices". It reads `calculated_price` from the price set (`:243`, `:273`).

The comment on `listCartOptions` (`lib/data/cart.ts`, `CART_OPTIONS_TIMEOUT_MS`) claiming this endpoint "waits on a live carrier quote (Skydropx)" is therefore **inaccurate for this route**. The carrier-calling paths are `POST /store/shipping-options/:id/calculate` and `POST /store/carts/:id/shipping-methods` (which uses `listShippingOptionsForCartWithPricingWorkflow` → `calculateShippingOptionsPricesStep`, `.../list-shipping-options-for-cart-with-pricing.js:269`), plus every `refreshCartShippingMethods` triggered by F2.

This does not change the recommendation to add a timeout (D6); it changes its justification from "hot fix" to "cheap symmetry".

### CONFLICT-1 — R5 is structurally incompatible with the Stripe card flow

`payment-wrapper/stripe-wrapper.tsx:39-43` **throws** when `paymentSession.data.client_secret` is absent. Under R5 ("no session until the final CTA click") there is no session at render, so mounting `StripeWrapper` would crash checkout, and not mounting it makes Stripe card entry impossible.

Resolution taken (see D5): **R5 applies to Openpay, Mercado Pago and manual. Stripe-like providers keep session-on-selection as a narrow, documented exception.** R5's stated business goals — stop wasting Mercado Pago preference calls (S8), stop fighting session deletion (`explore §2b`) — are fully met by the three live providers. Making R5 absolute would trade a real conversion win for a hard crash on a provider the store may still have enabled. `listCartPaymentMethods` is backend-driven (`lib/data/payment.ts:16`) so we cannot assume Stripe is off.

**This narrows R5 and needs the user's acknowledgement.** It is not a reopening of the decision; it is the smallest carve-out that keeps the decision implementable.

### CONFLICT-1 RESOLUTION — the carve-out is unnecessary; the Stripe code is dead

Parent verification after this design was written: **Stripe is not registered in the backend.** `apps/backend/medusa-config.ts` registers exactly two payment providers under `@medusajs/medusa/payment` — `./src/modules/openpay-payment` (id `openpay`) and `./src/modules/mercadopago-payment` (id `mercadopago`). There is no Stripe provider and no `stripe` dependency in `apps/backend/package.json`.

Therefore `listCartPaymentMethods` (`lib/data/payment.ts`) can never return a Stripe-like provider id, and every Stripe branch in the checkout is unreachable code inherited from the Medusa starter — while still shipping `@stripe/react-stripe-js` and `@stripe/stripe-js` (`apps/storefront/package.json:25-26`) into the bundle.

**Decision (user-approved): delete the dead Stripe code as part of this change.** In scope:

- delete `modules/checkout/components/payment-wrapper/stripe-wrapper.tsx`
- delete `StripeCardContainer` from `modules/checkout/components/payment-container/`
- remove the `isStripeLike` branches from the new payment section and from `payment-button`
- remove `isStripeLike` from `lib/constants.tsx` once it has no callers
- drop `@stripe/react-stripe-js` and `@stripe/stripe-js` from `apps/storefront/package.json`

Consequences: **R5 applies universally — no provider exception.** The `payment-wrapper` decision tree in D5 collapses to Openpay (config-driven mount), Mercado Pago (no mount) and manual (no mount). This is a **net line reduction** (~-200) and it shrinks PR2c, which was over budget.

If Stripe is ever enabled server-side, reintroducing it is a fresh, self-contained change against a checkout that no longer has to keep a dead branch alive.

---

## 1. D1 — Client state architecture

### Available primitives (verified, not assumed)

`apps/storefront/package.json:20-45`: React `19.0.5`, Next `15.5.18`, `@headlessui/react`, `@radix-ui/react-accordion`, `@stripe/*`, `lodash`, `clsx`.
**No `@tanstack/react-query`. No SWR. No Zustand/Redux/Jotai.** There is no client data-fetching layer at all — every read and write goes through `"use server"` actions in `src/lib/data/*`.

### Decision

**A single `CheckoutProvider` client component owning a `useReducer` store, exposed through React Context.**

```
src/modules/checkout/state/checkout-reducer.ts    ← pure reducer + types (spec'd under vitest)
src/modules/checkout/state/checkout-context.tsx   ← Provider, useCheckout(), effect orchestration
```

The reducer is a **pure function in its own file** so it lands under `src/**/*.spec.ts` and gets real test coverage — a second, unplanned win for a codebase with no component harness.

**Rationale.** The three sections are not independent. A postal-code blur in *Datos* must invalidate the selection in *Envío* and re-evaluate the CTA in *Pago*. That is one atomic transition, and a reducer expresses it as one `case`. The current code fights the same coupling with `useRef` mirrors, `hydratedRef` lockouts, `lastPrefetchedSignature` dedupe and an `initiatedDefaultRef` one-shot guard (`shipping-address/index.tsx:83,90,96`; `payment/index.tsx:186`) — a cascade of `useEffect`s each patching the previous one's ordering bug. Centralising the transition removes that class of bug rather than relocating it.

**Rejected alternatives:**

| Alternative | Why rejected |
|---|---|
| Add react-query / SWR | New runtime dependency for one page. There is no client fetch layer to unify — everything is server actions, which react-query does not manage. Adds ~13–40 kB to the highest-intent page in the funnel. Dependency additions are adjacent to the "no new test infra" non-goal in spirit: they buy review cost, not customer value. |
| Zustand / Jotai | Same objection, less justification. `useReducer` + Context is already in React. |
| One mega client component owning all state | `storefront-best-practices` explicitly calls this out: "❌ Building entire checkout as one massive component… ✅ Separate components for each step, shared state management in parent." It would also produce one unreviewable 900-line file against a 600-line budget. |
| Prop-drilling from a single owner | This is what `address-shipping-group` already is — a component whose only job is threading one value between two siblings (see its own docstring). With three sections and eight shared values it becomes a prop-thread of thirty props. |
| Keep per-section `useState` (today's shape) | Cannot express the cross-section invalidation rule at all. It is the reason the staleness bug in F2 is invisible today. |

### State shape

```ts
export type CheckoutState = {
  // server-owned, refreshed from every mutating action's return value
  cart: HttpTypes.StoreCart
  shippingOptions: HttpTypes.StoreCartShippingOption[]

  // address draft (client is source of truth once the customer types)
  draft: Record<string, string>          // same keys as today's shipping-address formData
  sameAsBilling: boolean
  shippingAddressId: string | null
  billingAddressId: string | null

  // quotation
  quoteSignature: string | null          // signature of the CURRENT draft
  quotedSignature: string | null         // signature the current prices/options belong to
  quoteStatus: "idle" | "incomplete" | "loading" | "ready" | "unserviceable" | "failed"
  calculatedPrices: Record<string, number>
  cpStatus: "idle" | "loading" | "found" | "not_found"
  colonias: string[]

  // shipping selection
  selectedShippingOptionId: string | null
  selectionSignature: string | null      // signature at the moment of selection

  // payment
  selectedPaymentProviderId: string | null
  paymentDetailsComplete: boolean

  // ui
  autosaveStatus: "idle" | "saving" | "saved" | "error"
  placingOrder: boolean
  error: string | null
  totalAtRender: number                  // guards the CTA-time re-price (D5)
}
```

### How fresh cart data reaches the client after mutations

**Decision: mutating server actions return the updated cart. `router.refresh()` is not used for in-flight mutations.**

Two independent reasons, both verified:

1. **`router.refresh()` re-runs the entire RSC chain** — `retrieveCart` → `retrieveCustomer` → `getProviderConfig` (`checkout/page.tsx:15,21,22`) → `listCartShippingMethods` → `listCartPaymentMethods` (`checkout-form/index.tsx:18,19`), all sequential. That is precisely the cost S1 exists to eliminate. Firing it per blur would make the new checkout *slower* than the four-step one it replaces.
2. **`router.refresh()` is not even reliably fresh.** `retrieveCart` uses `cache: "force-cache"` with `next: getCacheOptions("carts")` (`lib/data/cart.ts:44-51`), and `getCacheTag` returns `""` whenever the `_medusa_cache_id` cookie is absent (`lib/data/cookies.ts:22-34`). `getCacheOptions` then returns `{}`. A `force-cache` fetch with no tags cannot be invalidated by `revalidateTag` at all, so the RSC may re-render against a stale cart. The middleware sets that cookie (`middleware.ts:122`) but only on a country-prefixed path and only for 24 h — it is not a guarantee.

So: **the RSC render supplies the initial cart only.** After mount, `state.cart` is authoritative and is replaced by the cart each action returns.

**Server actions that must start returning the cart** (all three already have it in hand and throw it away):

| Action | Today | After | Evidence it is free |
|---|---|---|---|
| `persistShippingForCalc` → renamed `persistCheckoutDraft` | `Promise<{ok:boolean}>`, discards SDK response | `Promise<{ok:true,cart} \| {ok:false,error}>` | `sdk.store.cart.update` resolves `{ cart }`; `cart.ts:131-144` awaits and drops it |
| `setShippingMethod` | `Promise<void>` | `Promise<HttpTypes.StoreCart>` | `sdk.store.cart.addShippingMethod(...).then(async () => {...})` — `cart.ts:315-317` ignores the resolved `{ cart }` |
| `setAddresses` → renamed `syncCheckoutAddresses` | `string \| {ok:true}` | `{ok:true,cart} \| {ok:false,error}` | delegates to `updateCart`, which already returns the cart (`cart.ts:167-176`) and then discards it (`cart.ts:588`) |
| `initiatePaymentSession` | SDK `{ payment_collection }` | `{ paymentCollection, cart }` | needs a companion read — see below |

`initiatePaymentSession` is the one that needs a new read, because the SDK helper returns a payment collection, not a cart, and the button needs `payment_sessions` on a cart-shaped object.

**New export `retrieveCartFresh(cartId?)` in `lib/data/cart.ts`:** identical to `retrieveCart` but `cache: "no-store"` and no `next` options. Rationale: `revalidateTag` followed by a read **in the same request** is not a documented ordering guarantee in Next 15, and with a possibly-empty tag it is not even a no-op-with-fallback — it is a silent stale read. `no-store` is deterministic. Used by `initiatePaymentSession` and by the CTA's pre-flight total check (D5).

**Scope note (honest boundary):** `retrieveCart`'s own `force-cache`-with-possibly-empty-tag problem is the same bug as C3 but on a different function. This design does **not** fix it — the new architecture stops depending on RSC re-render for freshness, so it is no longer on the critical path. Recorded as a follow-up, not silently expanded into scope.

### Data-flow diagram

```
RSC checkout/page.tsx
  retrieveCart / retrieveCustomer / getProviderConfig   (once, on load)
  listCartShippingMethods / listCartPaymentMethods      (once, on load)
        │  initial props
        ▼
  CheckoutProvider  ── useReducer(checkoutReducer, initFromServer(props))
        │
        ├─ Datos     → dispatch(FIELD_BLUR) ──┐
        ├─ Envío     → dispatch(SELECT_SHIPPING_OPTION)
        ├─ Pago      → dispatch(SELECT_PAYMENT_PROVIDER)
        └─ CTA       → placeOrderFlow()
                                              │
   effects in CheckoutProvider (debounced, signature-guarded):
        │
        ├─ autosave       persistCheckoutDraft(draft, email)         → cart  → dispatch(CART_UPDATED)
        └─ requote        listCartShippingMethods(cartId)            → options
                          calculatePriceForShippingOption(...) x N   → prices
                                                                     → dispatch(QUOTE_READY{signature,...})
                                                                        (dropped if signature !== state.quoteSignature)
```

Every server round trip in the steady state is a direct server-action call. Zero RSC re-renders. S1 target met.

---

## 2. D2 — The two pure modules

Both live under `src/lib/util/`, matching vitest `include: ["src/**/*.spec.ts"]` and the `@lib` alias (`vitest.config.ts:16,27`). Both are pure: no `fetch`, no React, no server actions, no `window`. Type-only imports from `@medusajs/types` are erased at compile time and are safe under `environment: "node"`.

### Module A — `src/lib/util/shipping-quote.ts`

Owns the quotation-readiness rule, the quote-relevant signature, and the staleness rule.

```ts
/** The four fields Skydropx's calculatePrice actually requires on the destination
 *  (explore §4, skydropx-fulfillment/service.ts:431-456). No street, no colonia,
 *  no name, no phone. */
export type QuoteAddressDraft = {
  postal_code?: string | null
  province?: string | null
  city?: string | null
  country_code?: string | null
}

export const MX_POSTAL_CODE_PATTERN: RegExp

/** R4: a valid 5-digit CP plus the province/city it resolves to. */
export function isQuotable(draft: QuoteAddressDraft): boolean

/** Deterministic, order-stable, trim-normalised, lowercase country code.
 *  Empty string when not quotable, so "" can never equal a real signature. */
export function buildQuoteSignature(draft: QuoteAddressDraft): string

export type QuoteDecision =
  | { kind: "noop" }                        // same signature already quoted, or nothing to do
  | { kind: "invalidate" }                  // draft no longer quotable → drop prices + selection
  | { kind: "quote"; signature: string }    // fetch options + prices for this signature

export function decideQuoteAction(input: {
  draft: QuoteAddressDraft
  quotedSignature: string | null
  inFlightSignature: string | null
}): QuoteDecision

/** Settled decision 1: a selection made under a different quote signature is stale. */
export function isShippingSelectionStale(
  selectionSignature: string | null,
  currentSignature: string | null
): boolean
```

`decideQuoteAction` is the dedupe/invalidate rule that today is scattered across `lastPrefetchedSignature` (`shipping-address/index.tsx:90`), `buildShippingSignature` (`:33-45`), `buildCartShippingSignature` (`shipping/index.tsx:33-45`) and `hasValidPrefetch` (`shipping/index.tsx:88-97`) — four near-duplicate implementations of one rule, two of which include `address_1`/`address_2` and two of which must agree exactly or the prefetch is silently discarded. One function, one spec.

**Signature field set changes deliberately:** `postal_code | province | city | country_code`. `address_1` and `address_2` are dropped, because F2 shows the backend re-lists and re-prices on `country_code | province | city | postal_expression` only (`.../list-shipping-options-for-cart.js:200-206`), and `explore §4` shows Skydropx ignores street on the quote path. Keeping them in the signature would re-quote on every street edit for zero price change — friction with no carrier justification, the same self-imposed gate R4 removes.

### Module B — `src/lib/util/checkout-readiness.ts`

Owns R8: what is missing, and can the order be placed.

```ts
export type MissingCode =
  | "empty_cart"
  | "first_name" | "last_name"
  | "address_1" | "address_2"
  | "postal_code" | "city" | "province" | "country_code"
  | "email" | "phone"
  | "billing_address"
  | "shipping_method"
  | "shipping_method_stale"
  | "payment_method"
  | "card_details"

export type MissingItem = { code: MissingCode; label: string }

/** Plain POJO on purpose: the predicate must be testable from fixtures without
 *  constructing a StoreCart, and must not drift when Medusa's types move. */
export type CheckoutReadinessInput = {
  itemCount: number
  email?: string | null
  shippingAddress?: CheckoutAddressSnapshot | null
  hasBillingAddress: boolean
  hasShippingMethod: boolean
  selectionSignature: string | null
  currentQuoteSignature: string | null
  selectedPaymentProviderId: string | null
  paymentDetailsComplete: boolean
  paidByGiftCard: boolean
}

/** Ordered top-to-bottom in reading order of the page, so the itemized list
 *  matches the order the customer will scan (R8 / S9). */
export function resolveMissingCheckoutItems(
  input: CheckoutReadinessInput
): MissingItem[]

export function canPlaceOrder(input: CheckoutReadinessInput): boolean
  // === resolveMissingCheckoutItems(input).length === 0

/** Thin, pure adapter. Kept in this file so the mapping is spec'd alongside
 *  the rule it feeds. */
export function toReadinessInput(
  cart: HttpTypes.StoreCart,
  client: {
    selectionSignature: string | null
    currentQuoteSignature: string | null
    selectedPaymentProviderId: string | null
    paymentDetailsComplete: boolean
  }
): CheckoutReadinessInput
```

**Strictness floor (R8, risk #5).** The predicate must be at least as strict as today's `notReady` (`payment-button/index.tsx:26-31`) **plus** the phone rule. Mapping:

| Today | New `MissingCode` |
|---|---|
| `!cart.shipping_address` | the individual address field codes |
| `!cart.billing_address` | `billing_address` |
| `!cart.email` | `email` |
| `shipping_methods.length < 1` | `shipping_method` |
| `hasCompleteShippingContact`: `address_1` + `email` + `phone`, blank-vs-present, whitespace = absent | `address_1`, `email`, `phone` |
| default branch "Selecciona un método de pago" | `payment_method` |
| card providers with incomplete form | `card_details` |
| *(new — settled decision 1 + F2)* | `shipping_method_stale` |

`shipping_method_stale` is the F1/F2 mitigation: `hasShippingMethod` can be `true` while the selection belongs to a superseded address. The predicate reports it as missing, so the CTA blocks and the customer re-picks — decision 1 satisfied without any cart mutation.

**Phone rule preserved verbatim.** Blank-vs-present only. Format is the input's `pattern` job (`lib/util/phone.ts`) and the backend normalises. The incident docstring from `checkout-step.ts:10-27` moves onto the `phone` case unchanged — it is the record of a real post-sale Skydropx labelling failure and must not be lost in the move.

**Labels are Spanish, customer-facing** (`"Falta tu teléfono"`, `"Elegí un método de envío"`, `"Volvé a elegir el método de envío: cambiaste el código postal"`), consistent with the rest of checkout. Everything else in these modules — identifiers, comments, types — is English.

### Why these two and not more

They are the only two rules that are (a) product decisions rather than glue, (b) high-consequence if loosened, and (c) expressible without a DOM. Everything else in this change is component wiring, which the storefront cannot test and this design will not pretend it can (proposal §7 verification note).

---

## 3. D3 — Address persistence: the CRITICAL fix

### The bug, restated precisely

`persistShippingForCalc` (`lib/data/cart.ts:109-155`) sends `shipping_address` **without `id`**. Traced in `explore §3`: `EntityAssigner.js:81` computes `pk = Utils.extractPK(value)`; with no `id` the pk is `undefined`, so line 92 takes `assignReference`, which for a plain object with no `merge` flag calls `em.create(prop.type, value)` — **a new `cart_address` row, with the cart FK repointed at it.** `first_name`, `last_name`, `company`, `phone`, `address_1`, `address_2` are gone.

The escape hatch is supported API: `StoreCartUpsertAddress = AddressPayload.merge(z.object({ id: z.string().optional() }))` (`validators.js:38-40`). With `id` present, `extractPK` succeeds, `sameTarget` holds, and `EntityAssigner.js:89` performs a true field-level merge.

Today this is masked by the `address_1 && address_2` prefetch gate (`shipping-address/index.tsx:296-305`) plus `setAddresses` re-sending the full payload on submit. R4 + R6 remove both masks. **Without this fix, autosave becomes a PII shredder that fires on every blur.**

### One write path, not two

The proposal implies two writes: the R6 autosave (full customer data) and the R4 quote persist (four fields). They are collapsed into one.

**Rationale:** two partial writers against the same nested entity is exactly the shape that produced this bug. One writer with one id-resolution rule is auditable; two are a race waiting to be discovered in production. And the four quote fields are a strict subset of the autosave payload — the second write buys nothing.

### `persistCheckoutDraft` — full contract

```ts
"use server"

export type CheckoutDraftAddress = Pick<
  HttpTypes.StoreCartAddress,
  | "first_name" | "last_name" | "company"
  | "address_1"  | "address_2"
  | "postal_code" | "city" | "province" | "country_code" | "phone"
>

export type PersistDraftResult =
  | { ok: true; cart: HttpTypes.StoreCart }
  | { ok: false; error: string }

/**
 * Autosave writer for the checkout address draft (R6) and the sole trigger for
 * shipping re-quotation (R4).
 *
 * MUST send `shipping_address.id` whenever the cart already has an address.
 * Without it MikroORM treats the nested object as a REPLACEMENT and creates a
 * new cart_address row, destroying first_name/last_name/company/phone
 * (explore §3, EntityAssigner.js:77-98). This is not an optimisation; it is the
 * difference between an autosave and a data-loss incident.
 *
 * NEVER writes billing_address, promo codes, or region. Billing is written by
 * syncCheckoutAddresses at CTA time (D5).
 */
export async function persistCheckoutDraft(
  addr: Partial<CheckoutDraftAddress>,
  email: string | null
): Promise<PersistDraftResult>
```

### Id resolution, and the very first write

```
1. cartId = await getCartId()            → no cart ⇒ { ok:false }
2. read = await retrieveCartFresh(cartId, "id,*shipping_address")  // discriminated, 5 s abort
   resolution = resolveShippingAddressId(read)                     // resolved | absent | unresolved
3. if (resolution.status === "unresolved") ⇒ return { ok:false }   // ABORT, never write blind
   id = resolution.status === "resolved" ? resolution.id : null     // "absent" = the safe id-less write
4. payload.shipping_address = id ? { id, ...fields } : { ...fields }
5. { cart } = await sdk.store.cart.update(cartId, payload, {}, headers)
6. POST-CONDITION GUARD:
       if (id && cart.shipping_address?.id !== id)
           console.error("cart_address row was REPLACED, not merged", { cartId, sent: id, got: ... })
       // do not throw — the write already happened; this is the S7 tripwire
7. revalidateTag(await getCacheTag("fulfillment"))   // unchanged: options are address-filtered
   // deliberately NOT the carts tag — client state is authoritative now (D1)
8. return { ok: true, cart }
```

**Step 2/3 — the id is resolved server-side, ALWAYS. `addressIdHint` is REJECTED.**

This design originally passed an `addressIdHint` from PR2a React state, with the fallback read only when the hint was absent. **That parameter was removed during PR1a remediation and must NOT be reintroduced.** Two independent fresh-context reviews converged on it as a blocker:

- **Security.** `lib/data/cart.ts` is `"use server"`, so `persistCheckoutDraft` is a publicly reachable POST endpoint whose arguments are entirely client-controlled. The hint was injected verbatim as a `cart_address` primary key with no check that the row belongs to `cartId`. That defeats this design's own invariant — "the cart is the only id authority" — by entering through a different door.
- **Correctness.** It is self-staling. `setAddresses` sends `shipping_address` WITHOUT an id, so every form submit churns the address row id and any hint the client captured goes stale. A stale id is as destructive as no id (`sameTarget` fails → same `assignReference` → `em.create` path), and a colliding one risks a primary-key 500.

A hint that has to be verified server-side is not an optimisation — verifying it costs the same read it was meant to save. **PR2a must not add an id parameter to any cart-writing server action.** The reducer may still hold `shippingAddressId` for rendering, but it is not an input to a write.

**Step 3 — failure is not absence.** `retrieveCartFresh` returns a discriminated `FreshCartRead`, and `resolveShippingAddressId` maps it to `resolved | absent | unresolved`. A `.catch(() => null)` here would collapse "the cart has no address" (safe — `em.create` is correct) into "the read failed" (destructive — recreates the bug). Since the fresh read is the ONLY id source, `unresolved` **aborts the write** and returns `{ ok:false }`. A skipped quote is recoverable by typing one more character; destroyed PII is not. The read carries a 5 s `AbortSignal.timeout` because it now sits sequentially in front of every autosave write.

**Step 4 — the very first write.** A cart with no `shipping_address` has no id to send. Sending the payload **without** `id` is then correct: `assignReference` → `em.create` creates the row, and there is nothing to destroy. The next write picks up the id from the returned cart (or the fallback read) and merges from then on. This is the only moment the id-less path is legitimate, and it is self-limiting.

**Step 6 — the tripwire.** S7 ("customer fields preserved after a postal-code-triggered persist") is otherwise verifiable only by manual QA. This turns it into a production-observable assertion at the cost of one comparison. Given risk #1 is the highest-consequence item in the change and there is no automated safety net (risk #4), a log line that fires the moment the invariant breaks is worth more than the same claim in a spec that cannot run.

### Autosave trigger

- **On `blur`**, not on change. Blur is the natural "I'm done with this field" boundary, halves the write volume versus keystroke debouncing, and is what R6 specifies.
- **Debounce 400 ms** after the last blur, coalescing tab-through sequences into one write. Shorter than today's `PREFETCH_DEBOUNCE_MS = 600` because blur is already a coarse event.
- **Skip when the draft is unchanged** since the last successful save (shallow compare on the draft object).
- **Persist invalid values anyway** (settled decision 3). The backend normalises the phone; format is the CTA predicate's job. Losing what the customer typed is worse than a dirty cart.
- **`autosaveStatus`** is surfaced as a quiet inline indicator, never as a blocking state. A failed autosave must never prevent typing.

### Performance warning (from F2)

Once a shipping method exists on the cart, **every** `updateCart` — therefore every autosave — triggers `refreshCartShippingMethodsWorkflow`, which calls `listShippingOptionsForCartWithPricingWorkflow` → `calculateShippingOptionsPricesStep` → **a live Skydropx quote, server-side** (`.../refresh-cart-shipping-methods.js:93`, `.../list-shipping-options-for-cart-with-pricing.js:269`). The `when("should-prepare-shipping-methods")` guard at `:90` means this only happens when at least one shipping method is present — but that is exactly the state the customer is in while filling the last few fields.

Mitigations, in order of preference:
1. The 400 ms blur debounce plus the unchanged-draft skip already collapse most of it.
2. **Skip the autosave entirely when the changed fields are outside both the quote signature and the persisted set** — i.e. no-op writes are never sent.
3. Accept the remainder. It is bounded by the number of address fields (10), and it is the price of R6.

This must be called out in manual QA: watch backend Skydropx call volume during a full address entry with a method already selected.

---

## 4. D4 — Shipping method invalidation (settled decision 1)

### Mechanism, given F1 and F2

**There is no cart mutation available.** Invalidation is therefore three coordinated client-side facts:

1. **Selection invalidation.** The reducer stores `selectionSignature` at the moment of `SELECT_SHIPPING_OPTION`. On every `FIELD_BLUR` that changes `quoteSignature`, `isShippingSelectionStale(selectionSignature, quoteSignature)` becomes true and the reducer clears `selectedShippingOptionId` in the *same* transition. No radio is checked. No `useEffect` chain.
2. **CTA blocking.** `resolveMissingCheckoutItems` emits `shipping_method_stale` → `"Volvé a elegir el método de envío: cambiaste el código postal"`. The order cannot be placed against a superseded quote. This is the guarantee decision 1 actually asked for.
3. **Provisional total.** Because the backend may have silently re-priced the surviving method (F2), `CheckoutSummary` renders the shipping line and the grand total in a **provisional** state while `shipping_method_stale` is present — visually de-emphasised with a one-line note ("El costo de envío se recalcula cuando elijas el método"). It must not present a number the customer never agreed to as if it were final.

When the customer re-picks, `setShippingMethod` fires `POST /store/carts/:id/shipping-methods`, which per F1 replaces the old method atomically. The stale row is gone in the same request. No orphan.

**Rejected alternatives:**

| Alternative | Why rejected |
|---|---|
| Auto-reselect the equivalent option | Explicitly rejected by settled decision 1. F2 makes it worse than the proposal assumed: the backend has *already* silently changed the price, so auto-reselect would mean the customer never sees that the number moved. |
| Re-POST the same option id to force a visible re-price | This *is* auto-reselect with extra steps, and it burns a carrier quote per address edit. |
| Ask the backend for a delete endpoint | Backend changes are a hard non-goal. |
| Leave the stale method and show the re-priced total as final | The exact "silently changed total" failure decision 1 exists to prevent. |

### Edge case 2 — no serviceable option (settled decision 4)

`quoteStatus: "unserviceable"` when the refetched option list is empty or every calculated price resolves to `null`. *Envío* renders a plain-language message ("Todavía no hacemos envíos a esa zona") with **no fallback path** — no manual-quote form, no contact-support link, because no such channel exists in checkout today. The CTA reports `shipping_method`.

### Edge case 3 — missing variant dimensions

`buildParcel` throws `MissingDimensionsError` before any carrier call when any item lacks weight or L/W/H (`explore §4`, `parcel.ts:49-79`), surfacing as `INVALID_DATA` at `service.ts:790-796`. `calculatePriceForShippingOption` swallows it and returns `null` (`lib/data/fulfillment.ts:60-63`).

The storefront cannot distinguish this from "unserviceable" through that `null`. Design decision: when **every** calculated option returns `null` while the option list is **non-empty**, set `quoteStatus: "failed"` (not `"unserviceable"`) and render a message that does **not** blame the address — "No pudimos calcular el envío para este pedido. Escribinos y lo resolvemos." — plus a `console.error` carrying `cartId` and the option ids, so the team can observe it. An empty option list stays `"unserviceable"`. This is the honest split available without a backend change.

---

## 5. D5 — Payment session lifecycle (R5, C1)

### Render time: no session, no network

*Pago* renders `availablePaymentMethods` (backend-driven, `lib/data/payment.ts:16`) as radios. Selecting one dispatches `SELECT_PAYMENT_PROVIDER` — **pure client state, zero requests** for Openpay, Mercado Pago and manual. The `initiatedDefaultRef` one-shot guard (`payment/index.tsx:186-205`) is deleted; it is incompatible with sessions that Medusa destroys on every total change (`explore §2b`) and there is now nothing for it to guard.

### C1 — `payment-wrapper/index.tsx` inversion

```tsx
// BEFORE: wrapper chosen from an existing pending session
const paymentSession = cart.payment_collection?.payment_sessions?.find(s => s.status === "pending")
if (isOpenpay(paymentSession?.provider_id) && paymentSession) { ... }

// AFTER: Openpay wrapper mounts from provider CONFIG; Stripe branch unchanged
if (openpayConfig) {
  return <OpenpayWrapper config={openpayConfig}>{children}</OpenpayWrapper>
}
```

Verified safe by `explore §6`: `OpenpayWrapper` reads no session data. It loads two scripts at `strategy="lazyOnload"`, then `setId/setApiKey/setSandboxMode` and `deviceData.setup()` (`openpay-wrapper.tsx:handleDataScriptLoaded`). `configMissing` already short-circuits to `unavailable` when merchantId/publicKey are absent, and `getProviderConfig` returns `{openpay:null}` rather than throwing on any failure (`provider-config.ts:83-89`). Mounting unconditionally on a non-null config strictly improves availability.

**`deviceSessionId` timing (risk #6) — resolved, and better than today.** It is produced by `handleDataScriptLoaded` at script load. Under the old design that could not happen until an Openpay session existed, i.e. at the payment step. Under C1 it happens at page load, minutes before the CTA. The CTA-time read at `payment/index.tsx:120-124` moves to the place-order flow and is *more* likely to be populated. QA must still confirm it on a cold, slow connection — `lazyOnload` defers past hydration — and the flow must fail with a clear message rather than sending `device_session_id: null`.

**Stripe branch: unchanged.** Per CONFLICT-1, `StripeWrapper` still requires a pending session with `client_secret` and still throws without one (`stripe-wrapper.tsx:39-43`). Leaving the branch exactly as it is means Stripe keeps working, and R5 does not have to be violated for the providers it was written for.

### The place-order flow

One entry point, `placeOrderFlow()` in `checkout-context.tsx`, with a per-provider tail.

```
0. guard: canPlaceOrder(toReadinessInput(state.cart, client)) — the button is already
   disabled, but the flow re-checks; a disabled button is a UI affordance, not a lock.

1. PROVIDER PRE-FLIGHT (before any backend mutation)
     Openpay      → tokenId = await openpay.tokenize(openpay.cardData)
                    fails fast, in the browser, with nothing written yet.
                    Also assert openpay.deviceSessionId is non-null.
     Stripe       → assert stripe && elements && card
     Mercado Pago → nothing
     Manual       → nothing

2. syncCheckoutAddresses({ shipping: draft, billing: sameAsBilling ? draft : billingDraft })
     - sends BOTH addresses WITH their ids (same merge rule as D3)
     - returns the updated cart

3. TOTAL-CHANGE GUARD
     if (cart.total !== state.totalAtRender):
         dispatch(CART_UPDATED)                     // summary shows the new number
         dispatch(ERROR "El costo de envío cambió. Revisá el total y confirmá de nuevo.")
         abort — the customer confirms once more
     Rationale: step 2 runs updateCartWorkflow, which per F2 re-prices shipping via a
     live carrier quote. Charging a total the customer never saw is not acceptable, and
     Medusa would destroy the session we are about to create anyway (explore §2b) —
     producing a mystery failure instead of an explanation. One honest extra click.

4. initiatePaymentSession(cart, { provider_id, data })   → { paymentCollection, cart }
     Openpay      data: { token_id, device_session_id, return_url, customer:{...billing} }
     Mercado Pago data: { back_urls_base }
     Stripe       (already initiated on selection — re-initiate only if the pending
                   session is gone, which happens whenever the total changed)
     Manual       no data

5. PROVIDER TAIL
     Openpay      → placeOrder()   → redirect on success; on throw, re-read the cart and
                                     follow requires_more → data.redirect_url (3DS),
                                     else surface the message. Unchanged logic, moved.
     Mercado Pago → read init_point from the returned paymentCollection's session
                    (fallback: the returned fresh cart), then window.location.href = it.
                    placeOrder is NOT called — the webhook is the source of truth.
     Stripe       → stripe.confirmCardPayment(client_secret, {...}) → placeOrder()
     Manual       → placeOrder()
```

Step 1 before step 2 is deliberate: a card that fails tokenisation must not have caused a single backend write. Step 2 before step 4 is mandatory: the Openpay session payload reads `cart.billing_address` for its `customer` object (`payment/index.tsx:128-133`), and the session snapshots `cart.raw_total` at creation (`explore §2a`).

**S8 satisfied:** exactly one Mercado Pago preference call per checkout, at the CTA. Today it is one per method init, discarded on every total change.

### `payment-button` dispatch without a session

Today: `switch (true)` on `cart.payment_collection?.payment_sessions?.[0]?.provider_id` (`payment-button/index.tsx:33-59`). Under R5 that array is empty at render, so every checkout would render the disabled default branch and no order could ever be placed.

**New dispatch key: `state.selectedPaymentProviderId`.** The customer's choice is the input; the session is an outcome. The component becomes:

```tsx
<PlaceOrderButton
  providerId={selectedPaymentProviderId}
  missing={missingItems}
  isPlacing={placingOrder}
  onPlace={placeOrderFlow}
/>
```

with `isStripeLike / isOpenpay / isMercadopago / isManual` (`lib/constants.tsx:63-82`) selecting the label and the tail, and the default branch still rendering a disabled "Selecciona un método de pago".

**This also retires explore risk #8 rather than deferring it.** The `payment_sessions[0]` vs `status === "pending"` asymmetry (`payment-button/index.tsx:36` vs `:98-100`) disappears because the dispatch stops reading sessions altogether. The proposal permitted a "minimal touch" here and flagged the real fix as follow-up; the minimal touch happens to *be* the fix. Recording it as resolved, not deferred, is more honest than leaving a dead follow-up ticket.

### Edge case 5 — Mercado Pago return

`payment/mercadopago/failure/route.ts:19` redirects to `?step=payment&error=payment_failed`. It becomes `/{cc}/checkout?error=payment_failed`. The customer lands on the single-page checkout, the cart is untouched, the address draft rehydrates from `cart.shipping_address` (persisted by autosave — R6 pays for itself here), and the CTA is immediately usable for a retry. Under R5 there is no dead session and no stale `init_point`: the next CTA click mints a fresh preference.

`error=payment_failed` is preserved but still read by nothing — surfacing it is an explicit non-goal. Dropping the parameter would destroy signal for free, so it stays.

---

## 6. D6 — Shipping-options freshness (C3)

### The cache fix

```ts
// lib/data/fulfillment.ts — listCartShippingMethods
// BEFORE
const next = { ...(await getCacheOptions("fulfillment")) }
... { method:"GET", query:{cart_id}, headers, next, cache:"force-cache" }

// AFTER
... { method:"GET", query:{cart_id}, headers, cache:"no-store",
      signal: AbortSignal.timeout(SHIPPING_OPTIONS_TIMEOUT_MS) }
```

**Rationale.** `getCacheTag` returns `""` when `_medusa_cache_id` is absent (`cookies.ts:22-34`), so `getCacheOptions` returns `{}` and `force-cache` produces an entry that `revalidateTag("fulfillment-…")` **can never reach**. The response is simultaneously per-cart *and* address-filtered on `country_code | province | city | postal_expression` (`.../list-shipping-options-for-cart.js:200-206`). A stale entry is not a slightly-old list; it is the **wrong** list for the customer's address. Step navigation was accidentally refreshing it (`explore §5`) and this change removes step navigation.

**Rejected: the `categories.ts` pattern** (`force-cache` → bounded `revalidate: 300`, `categories.ts:18`). That precedent exists in-repo for exactly this empty-tag reason and was the first thing considered. It is right for admin-edited category covers and wrong here: the filter inputs change within *seconds* of the customer typing a postal code, so any TTL greater than zero is a wrong list some of the time. The response is per-cart anyway, so the cache hit rate a shared cache would justify does not exist.

**Timeout.** `SHIPPING_OPTIONS_TIMEOUT_MS = 5_000`, mirroring `listCartOptions` (`cart.ts:CART_OPTIONS_TIMEOUT_MS`). Per F3 this endpoint does **not** call the carrier, so it is symmetry and cheap insurance rather than the hot fix `explore` risk #7 implied. The comment must be written accurately — copying `listCartOptions`' inaccurate justification would propagate the error.

### The refetch strategy

`lib/data/fulfillment.ts` is `"use server"`, so `listCartShippingMethods` and `calculatePriceForShippingOption` are directly callable from the client. No new API surface is needed.

The options list moves into `state.shippingOptions`, seeded from the RSC render and refetched by the requote effect:

```
on QuoteDecision.kind === "quote":
  1. dispatch(QUOTE_STARTED{ signature })
  2. persistCheckoutDraft(...)                     → cart          (address must land first)
  3. listCartShippingMethods(cart.id)              → options       (address-filtered, uncached)
  4. Promise.allSettled(
       options.filter(o => o.price_type === "calculated")
              .map(o => calculatePriceForShippingOption(o.id, cart.id))
     )                                             → prices
  5. if (signature !== getState().quoteSignature) DROP the whole result
  6. dispatch(QUOTE_READY{ signature, cart, options, prices })
```

Step 5 replaces today's `AbortController` + `lastPrefetchedSignature` + `cancelled` flag triad (`shipping-address/index.tsx:307-370`) with one comparison in one place. Superseded responses are dropped, never merged — the same discipline, centralised, and now covered by `checkout-reducer.spec.ts`.

**Edge case 6 — returning cart with a complete address.** `initFromServer` computes `quoteSignature` from `cart.shipping_address`. If it is quotable, the provider fires one requote on mount (skipping step 2, since the address is already persisted) so options and prices are on screen before the customer touches anything. No re-typing required.

**Edge case 7 — promotion applied from the summary.** `DiscountCode` currently calls `applyPromotions`, which revalidates tags the client no longer reads. It must dispatch `CART_UPDATED` with the returned cart so totals and the CTA predicate both react. `applyPromotions` therefore also returns the cart. Under R5 there is no session to destroy.

---

## 7. D7 — Component decomposition, file by file

### Target tree

```
checkout/page.tsx  (RSC)
  ├─ retrieveCart / retrieveCustomer / getProviderConfig
  ├─ listCartShippingMethods / listCartPaymentMethods   ← hoisted out of checkout-form
  └─ <CheckoutProvider initial={...}>
       ├─ <PaymentWrapper openpayConfig>          ← C1, config-driven
       │    └─ <CheckoutForm>                     ← client, layout only
       │         ├─ <ContactAddressSection/>      "Datos"
       │         ├─ <ShippingSection/>            "Envío"
       │         ├─ <PaymentSection/>             "Pago"
       │         ├─ <LegalNotice/>                informational (decision 2)
       │         └─ <PlaceOrderBar variant="inline"/>
       ├─ <CheckoutSummary itemsSlot={<ItemsPreviewTemplate cart={cart}/>}/>
       └─ <PlaceOrderBar variant="sticky"/>       mobile only
```

`listCartShippingMethods` / `listCartPaymentMethods` move from `checkout-form` into `page.tsx` so `CheckoutForm` can become a pure client layout component. Their `if (!shippingMethods || !paymentMethods) return null` bail (`checkout-form/index.tsx:22-24`) becomes a degraded render — a checkout that renders nothing because the options endpoint hiccuped is worse than one that renders with an error in *Envío*.

`ItemsPreviewTemplate` is passed as a **slot** rather than imported into the client subtree. Line items do not change during checkout, so keeping that subtree server-rendered costs nothing and sidesteps any question about whether it is an RSC. `CheckoutSummary` itself becomes a client component reading `state.cart` for totals plus the provisional flag from D4.

### `address-shipping-group` — does it survive?

**No. Deleted.** Its own docstring states its purpose: *"the smallest client boundary that lets the prefetch result flow between them while Payment and Review stay untouched server-rendered children"* — pure prop-threading between two siblings. Context subsumes it, and the "server-rendered children" it was protecting no longer exist under a single-page client-owned flow. Keeping it would mean keeping a component whose stated reason for existing is gone.

### `?step=` writers outside checkout

| File | Change |
|---|---|
| `modules/cart/templates/summary.tsx:6,14,29` | drop the `getCheckoutStep` import and the `step` local; `href="/checkout"` |
| `app/[countryCode]/(checkout)/payment/openpay/return/route.ts:22` | `/{cc}/checkout?error=payment_failed` |
| `app/[countryCode]/(checkout)/payment/mercadopago/failure/route.ts:19` | `/{cc}/checkout?error=payment_failed` |

All three are in **PR1**: mechanically trivial, independently shippable, and `summary.tsx` is the prerequisite for retiring `getCheckoutStep`. Target S5 (`?step=` occurrences → 0) is met by PR1 for writers and by PR2 for readers.

### Full file manifest

**Created**

| Path | PR | Est. |
|---|---|---|
| `src/lib/util/shipping-quote.ts` | 1 | 70 |
| `src/lib/util/shipping-quote.spec.ts` | 1 | 110 |
| `src/lib/util/checkout-readiness.ts` | 1 | 130 |
| `src/lib/util/checkout-readiness.spec.ts` | 1 | 190 |
| `src/modules/checkout/state/checkout-reducer.ts` | 2 | 180 |
| `src/modules/checkout/state/checkout-reducer.spec.ts` | 2 | 200 |
| `src/modules/checkout/state/checkout-context.tsx` | 2 | 150 |
| `src/modules/checkout/components/contact-address-section/index.tsx` | 2 | 90 |
| `src/modules/checkout/components/shipping-section/index.tsx` | 2 | 180 |
| `src/modules/checkout/components/payment-section/index.tsx` | 2 | 140 |
| `src/modules/checkout/components/legal-notice/index.tsx` | 2 | 25 |
| `src/modules/checkout/components/place-order-bar/index.tsx` | 2 | 90 |
| `src/modules/checkout/components/missing-items-list/index.tsx` | 2 | 40 |

**Modified**

| Path | PR | Change | Est. |
|---|---|---|---|
| `src/lib/data/cart.ts` | 1 | `persistCheckoutDraft` (+id, +cart, +tripwire), `setShippingMethod`→cart, `applyPromotions`→cart, `retrieveCartFresh` | 90 |
| `src/lib/data/fulfillment.ts` | 1 | `no-store` + timeout | 20 |
| `src/modules/checkout/components/payment-wrapper/index.tsx` | 1 | C1 inversion (Openpay only) | 30 |
| `src/modules/cart/templates/summary.tsx` | 1 | `?step=` drop | 6 |
| `.../payment/openpay/return/route.ts` | 1 | `?step=` drop | 3 |
| `.../payment/mercadopago/failure/route.ts` | 1 | `?step=` drop | 3 |
| `src/lib/data/cart.ts` (2nd pass) | 2 | `setAddresses`→`syncCheckoutAddresses` (+ids, +cart) | 60 |
| `src/app/[countryCode]/(checkout)/checkout/page.tsx` | 2 | provider + hoisted fetches + slot | 45 |
| `src/modules/checkout/templates/checkout-form/index.tsx` | 2 | client layout | 60 |
| `src/modules/checkout/templates/checkout-summary/index.tsx` | 2 | context totals + provisional + slot | 35 |
| `src/modules/checkout/components/shipping-address/index.tsx` | 2 | gutted to a controlled presentational form (all effects/refs → reducer) | 260 |
| `src/modules/checkout/components/payment-button/index.tsx` | 2 | dispatch on selected provider; tails become strategies | 160 |
| `src/modules/checkout/components/discount-code/index.tsx` | 2 | dispatch `CART_UPDATED` | 15 |

**Deleted**

| Path | PR | Lines |
|---|---|---|
| `src/lib/util/checkout-step.ts` | 1 | 55 |
| `src/lib/util/checkout-step.spec.ts` | 1 | ~90 |
| `src/modules/checkout/components/review/index.tsx` | 2 | 60 |
| `src/modules/checkout/components/address-shipping-group/index.tsx` | 2 | 56 |
| `src/modules/checkout/components/addresses/index.tsx` | 2 | 215 |
| `src/modules/checkout/components/shipping/index.tsx` | 2 | 420 |
| `src/modules/checkout/components/payment/index.tsx` | 2 | 330 |

`addresses` / `shipping` / `payment` are **deleted and replaced** rather than rewritten in place. The changed-line count is identical either way, but a reviewer reads a new 180-line file far faster than a 420-line interleaved diff where 90 % of the lines moved.

---

## 8. D8 — `checkout-step.ts`

| Symbol | Fate | Reason |
|---|---|---|
| `getCheckoutStep` | **Delete** | Its only consumer is `summary.tsx:6`, which loses its reason to exist in PR1. A dead router function in a codebase with no e2e tests is an invitation to drift. |
| `hasCompleteShippingContact` | **Fold into `checkout-readiness.ts`**, docstring verbatim | It is the incident record for a real post-sale Skydropx labelling failure (`phone: ""` orders). It must survive — but as three `MissingCode`s, not a boolean. |
| `checkout-step.ts` (file) | **Delete** | Empty after both moves. |
| `checkout-step.spec.ts` | **Delete — after its ~14 cases are ported** | Non-negotiable ordering. |

**Rejected: keep `checkout-step.ts` and import `hasCompleteShippingContact` from `checkout-readiness.ts`.** That splits one product rule across two files with two spec files — precisely what the function's own docstring warns against: *"Single source of truth: keep every 'where does this cart belong' decision here, so a second copy cannot drift away from the completeness rule above."* It also cannot work: R8 needs field-level `MissingCode`s for the itemized list, which a single boolean cannot express.

**Mandatory task ordering (strict TDD):**
1. Port every `hasCompleteShippingContact` case into `checkout-readiness.spec.ts` against the new signature. **Red.**
2. Implement `resolveMissingCheckoutItems`. **Green.**
3. Only then delete `checkout-step.ts` and `checkout-step.spec.ts`.

Deleting first would drop the incident coverage into a window where nothing enforces it. The spec count must go **up**, never down, across this change (S10).

---

## 9. D9 — Sticky mobile CTA (settled decision 5)

`place-order-bar/index.tsx`, one component, two variants.

```tsx
// inline (desktop): rendered at the end of the form column
<div className="hidden small:block">…</div>

// sticky (mobile): sibling of the summary, outside the form
<div className="small:hidden fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper
                px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
  <div className="mb-2 flex items-baseline justify-between">
    <span className="text-ink-muted">Total</span>
    <span className="font-bricolage text-xl text-ink">{formattedTotal}</span>
  </div>
  <Button size="large" className={CORAL_CTA} disabled={missing.length > 0} … >
    Realizar pedido
  </Button>
  <MissingItemsList items={missing} />
</div>
```

- **`env(safe-area-inset-bottom)`** wrapped in `calc()` with a `0.75rem` base so the bar is not flush against the screen edge on devices without a home indicator. Tailwind v3 arbitrary values (`tailwindcss ^3.0.23`, `package.json:41`) support this directly.
- **Scroll clearance:** the form column gets `pb-[calc(6rem+env(safe-area-inset-bottom))] small:pb-12` so the bar never covers the last field. Missing this is the single most common bug in sticky checkout bars.
- **Touch target:** the existing `Button size="large"` is `h-12` (48 px) — already above the 44 px floor. No change.
- **Total visible in the bar**, per decision 5, and de-emphasised as provisional when `shipping_method_stale` is present (D4).

### Accessibility of the disabled CTA (R8 / S9)

A `disabled` button is removed from the tab order and skipped by screen readers, so a customer using one would hear nothing about *why* they cannot continue — which would defeat R8 entirely.

```tsx
<Button disabled={missing.length > 0} …>Realizar pedido</Button>
<div role="status" aria-live="polite" className="mt-2">
  {missing.length > 0 && (
    <ul>{missing.map(m => <li key={m.code}>{m.label}</li>)}</ul>
  )}
</div>
```

The list lives **outside** the button, is always in the DOM, and announces on change. This generalises the `aria-live="polite"` cart-count rule from `storefront-best-practices`. `aria-disabled` is deliberately **not** added alongside `disabled` — the pair is redundant and the container carries the explanation.

**Rejected: keep the button enabled and validate on click.** It hides the gate until the customer commits, and R8 says the CTA is the gate and must show what is missing *before* the click.

### Legal text (settled decision 2)

`legal-notice/index.tsx`, informational only, same copy as today's `review/index.tsx:39-46`, rendered directly above the inline CTA. **Not a checkbox**, therefore **not** a `MissingCode`. On mobile it stays in the document flow above the sticky bar rather than being crammed into it.

---

## 10. D10 — PR split and line budget

Budget: **600 changed lines per PR**, delivery = chained PRs (settled decision 6: two).

### Raw estimates against that budget

| PR | Contents | Changed lines | Review surface (excl. specs + whole-file deletions) |
|---|---|---|---|
| **PR1** as scoped by the proposal | data layer, cache, pure modules + specs, C1 wrapper, `?step=` writers, `checkout-step` retirement | **~800** | ~355 |
| **PR2** as scoped by the proposal | full UI restructure | **~2 700** (1 081 of it deletions) | ~1 240 |

**Both are over budget. PR2 is over by more than 4×.** Stating this plainly, as instructed, rather than shaving the numbers.

### Where the estimates come from

PR1: new modules 300 + their specs 300 + `cart.ts` 90 + `fulfillment.ts` 20 + wrapper 30 + three `?step=` edits 12 + deletions 145 = **797**.

PR2: new state layer 530 + new sections 475 + rewrites 530 + page/form/summary 140 + `discount-code` 15 + deletions 1 081 = **2 771**.

### Recommended split — 5 PRs

| PR | Scope | Changed | Review surface | Ships alone? |
|---|---|---|---|---|
| **PR1a — live bug + cache** | `cart.ts` (`persistCheckoutDraft` id fix, cart returns, `retrieveCartFresh`, tripwire), `fulfillment.ts` (`no-store` + timeout) | **~150** | ~150 | **Yes.** Closes the data-destruction bug today, zero UI risk. |
| **PR1b — pure rules + wrapper + `?step=` writers** | both `lib/util` modules + specs, `checkout-step` retirement (specs ported first), `payment-wrapper` C1, `summary.tsx`, two return routes | **~650** | ~350 | Yes. New modules have no consumers yet; C1 and the route edits are independent. |
| **PR2a — state core + Datos** | `checkout-reducer` + spec, `checkout-context`, `page.tsx`, `checkout-form`, `contact-address-section`, `shipping-address` rewrite; delete `addresses`, `address-shipping-group` | **~1 060** | ~785 | No — depends on PR1b. |
| **PR2b — Envío** | `shipping-section`, `checkout-summary` (provisional total + slot), `discount-code`; delete `shipping` | **~650** | ~230 | No. |
| **PR2c — Pago + CTA** | `payment-section`, `payment-button` rewrite, `legal-notice`, `place-order-bar`, `missing-items-list`, `syncCheckoutAddresses`; delete `payment`, `review` | **~1 000** | ~530 | No. |

**PR2a and PR2c still exceed 600 changed lines and cannot be split further without leaving checkout broken on the branch.** PR2a's floor is set by the reducer plus its spec plus the `shipping-address` rewrite — they must land together or *Datos* has state with no form, or a form with no state. PR2c's floor is set by the CTA: `payment-section`, `payment-button` and `place-order-bar` are one flow, and the `review` deletion must land in the same commit as the CTA that replaces it or there is a window with no way to place an order.

### Decisions required from the user (not made here)

1. **Chain strategy.** With 5 chained PRs and 3 of them touching intermediate states, **`feature-branch-chain`** is the safer choice: only the tracker merges to `main`, so `main` never holds a half-migrated checkout. `stacked-to-main` would put PR2a on production with *Datos* rewritten and *Envío*/*Pago* still on the old components.
2. **Budget treatment.** Either (a) accept a **`size:exception`** on PR1b, PR2a and PR2c, or (b) redefine the budget as **review surface** (added + modified, excluding spec files and whole-file deletions), under which only PR2a (~785) exceeds it. Option (b) reflects actual reviewer burden — deleting a 420-line file that a new 180-line file replaces is not 420 lines of review.
3. **Settled decision 6 said two chained PRs.** This design says five. That is a departure from a settled decision and needs an explicit yes.

**PR1a should ship first and on its own regardless of what is decided above.** It is ~150 lines, it closes a bug that is destroying customer PII in production today, and rollback of the whole change would otherwise reintroduce it (proposal §10).

---

## 11. Testing and verification

### Automated (vitest, `cd apps/storefront && pnpm test`)

| Spec | Covers | PR |
|---|---|---|
| `shipping-quote.spec.ts` | `isQuotable` (R4: CP-only, no street/name/phone), `buildQuoteSignature` (trim/case/order stability, `""` for non-quotable), `decideQuoteAction` (dedupe, invalidate, in-flight supersession), `isShippingSelectionStale` | 1b |
| `checkout-readiness.spec.ts` | every `MissingCode`; **the ported `hasCompleteShippingContact` cases verbatim** (whitespace-as-absent, phone required, blank-vs-present only); the strictness floor vs today's `notReady`; `shipping_method_stale`; gift-card bypass; label ordering | 1b |
| `checkout-reducer.spec.ts` | `FIELD_BLUR` → signature recompute → selection invalidation as one transition; `QUOTE_READY` dropped on signature mismatch; `CART_UPDATED` merge; `shippingAddressId` refresh from returned carts | 2a |

Strict TDD applies: spec first (red), implementation second (green), for all three.

### Not automated — and this design will not pretend otherwise

The storefront has **no jsdom, no @testing-library, no Playwright** (`explore §8`), and adding them is an explicit non-goal. Removing `submit-address-button` / `submit-delivery-option-button` / `submit-payment-button` breaks **zero** tests (`explore §9`) — which cuts both ways: nothing will catch a regression either.

**Manual QA is a required merge gate, per payment provider:**

1. Openpay happy path: CP → options → method → card → CTA → 3DS → confirmation.
2. Mercado Pago: CTA → `init_point` redirect → failure return → data intact → retry.
3. Manual provider (if enabled).
4. **S7 tripwire:** enter the full address, blur the postal code, reload — `first_name`, `last_name`, `company`, `phone` must all still be there. Watch for the D3 step-6 `console.error`.
5. Postal-code change after selecting a method → radio clears, CTA blocks with the stale message, total shows as provisional.
6. SEPOMEX outage (block `/store/postal-codes/*`) → manual state/city entry still works, checkout not blocked.
7. Unserviceable CP → decision-4 message, no fallback offered.
8. Cart with a dimensionless variant → the D4 "failed" message, which must **not** blame the address.
9. Mobile: sticky bar clears the last field, respects the iOS home indicator, disabled state announces its reasons.
10. Backend Skydropx call volume during full address entry with a method already selected (the F2 warning).

---

## 12. Rollout and rollback

- Storefront-only. No migrations, no backend changes, no persisted schema change. Carts written by the new flow are ordinary Medusa carts readable by the old flow.
- Rollback is **revert-and-redeploy**, with one caveat carried from proposal §10: reverting **PR1a reintroduces the data-destruction bug**. PR1a is therefore first, standalone, and must be re-landed independently if the rest is rolled back. This is the primary reason the chained split is right.
- No feature flag. A flag would require both checkouts to coexist, which means keeping `?step=` alive — directly against R1/S5 — and doubling the manual QA matrix on a page with no automated coverage.

---

## 13. Open items for `sdd-tasks` — RESOLVED

All four decisions were put to the user and answered. `sdd-tasks` must treat these as settled.

| # | Item | Decision |
| --- | --- | --- |
| 1 | CONFLICT-1 (R5 vs the Stripe card flow) | **DISSOLVED — delete the dead Stripe code.** See §0 CONFLICT-1 RESOLUTION. R5 applies universally; no carve-out is needed. |
| 2 | F1/F2 mechanism for settled decision 1 | **CONFIRMED — client-side invalidation + provisional total.** No cart mutation. The replace-all workaround was explicitly rejected because it requires auto-picking a replacement option id. |
| 3 | PR count 2 → 5 and budget treatment | **APPROVED — 5 PRs**, with **PR1a landing first and standalone**. Line count stays the budget metric; PR1b, PR2a and PR2c carry a `size:exception`. The review-surface redefinition was NOT adopted. |
| 4 | Chain strategy | **`feature-branch-chain`.** PRs chain onto a tracker branch; only the tracker merges to `main`, so `main` never holds a half-migrated checkout. |

Still open, unchanged:

- `retrieveCart`'s own `force-cache`-with-possibly-empty-tag issue is **out of scope** here and recorded as a follow-up.
- `error=payment_failed` remains read by nothing — unchanged non-goal.

---

## 14. Open items raised by the PR1a review, deferred with an owner

Two independent fresh-context reviews of the PR1a diff converged on the findings below. The blockers were fixed in the PR1a remediation pass; these are the items deliberately NOT fixed there, each with the phase that owns it. They are recorded so they cannot be lost, not so they can be ignored.

| # | Item | Owner | Why deferred |
| --- | --- | --- | --- |
| 1 | **No supersession / sequence control on the debounced writer, AND the reorder window is now WIDER than when this item was written.** Two problems, one owner. (a) *Same-writer reordering*: two edits 700 ms apart can land out of order, so an older draft overwrites a newer one. (b) *The read-write interleave introduced by the PR1a remediation*: `persistCheckoutDraft` now performs a sequential `retrieveCartFresh` **in front of** every write, so each autosave is two round trips instead of one and the window in which a second autosave can overtake the first is wider by the full duration of that read (up to `CART_READ_TIMEOUT_MS` = 5 s). Worse, the `AbortController` created at `shipping-address/index.tsx:292` is **never passed into the server action** (`:352-353`), so aborting the effect cancels nothing — the write always lands, even for a signature the component has already discarded. Two autosaves can therefore interleave as read-A, read-B, write-B, write-A. | **PR2a** | The fix belongs in the reducer that PR2a introduces — a monotonically increasing write sequence, with a response dropped when a newer write has already been issued — and it must also thread a real cancellation signal through to the server action, or accept that server actions cannot be cancelled and rely on sequencing alone. Bolting a second ad-hoc guard onto the current effect would be the third overlapping cancellation mechanism in one component. **Explicitly widened by PR1a and accepted:** the id-resolving read is what makes the write non-destructive, so removing it is not an option, and reordering costs a stale-but-complete address whereas the bug it fixes costs the address entirely. |
| 1b | **The `absent` TOCTOU window.** `resolveShippingAddressId` returns `absent`, and before the write lands a concurrent `setAddresses` (form submit) creates the `cart_address` row. The now-stale `absent` verdict sends an id-less partial write against a cart that has acquired a row, which takes `assignReference` -> `em.create` and shreds the fields `setAddresses` just persisted. The read cannot close this: any check-then-act across two HTTP calls has a window. | **PR2a** | Same owner as #1 and the same mechanism closes it: a write sequence that lets the later writer win, plus PR2a's rule that the submit path and the autosave path are not both allowed to write the shipping address concurrently. Narrow today — it needs a submit to land inside one autosave's read-write gap — but it is the one remaining path to the original data-loss bug, and it must not be lost. |
| 2 | **`persistCheckoutDraft` unit tests — RESOLVED in the second remediation pass.** `apps/storefront/src/lib/data/cart.spec.ts` and `fulfillment.spec.ts` now exist, built on `vi.mock` + `vi.hoisted` infrastructure this repo did not previously have. They assert against the actual `sdk.store.cart.update` call arguments: the abort guarantee (7 ways a read can fail to establish an answer, each ending in zero writes), the exact id on the wire, key-absence on the legitimate id-less write, the projection field string, tripwire firing and silence, and what crosses the `"use server"` boundary back to the client. Deleting the `unresolved` guard now fails 7 tests; it previously left 150/150 green. | **DONE (PR1a)** | Kept in the table as the record of why it was deferred once and then not deferred again: the gap was real, the reviewer's mutation proved it, and the infrastructure cost was the only thing standing in the way. |
| 3 | **`retrieveCart` / `retrieveCartFresh` are near-identical siblings** differing only in a cache flag — now also in return type. Two 30-line functions that must stay in sync is a footgun; the next person to add a field to one will forget the other. | **Follow-up** | Collapsing them into one function with an options object touches every `retrieveCart` caller in the app, which is far outside a data-layer remediation pass. |
| 4 | **Remaining `force-cache` + `Authorization` sites** in `customer.ts`, `orders.ts`, `cart.ts` (`retrieveCart`, and the order lookup), and `payment.ts`. | **Follow-up** | Already recorded above as the `retrieveCart` cache issue; PR1a only fixed the two functions on the checkout autosave path. |
| 5 | **`revalidateTag(fulfillmentCacheTag)` is now inert.** After PR1a there is no cacheable fetch carrying the `fulfillment` tag — the only remaining `getCacheOptions("fulfillment")` is on a POST, which Next never caches. Six call sites now invalidate nothing. | **Follow-up** | Kept and documented in place rather than deleted: the tag is still the correct *expression* of "this cart's shipping options are stale", and removing every call means the day a cached fulfillment read returns, it returns silently wrong. Deleting six call sites is also not a data-layer remediation. |
| 5b | **`retrieveCartFresh` is a `"use server"` export taking a client-controlled `cartId` AND a client-controlled `fields` string.** Any browser can invoke it for an arbitrary cart id with an arbitrary projection, and `GET /store/carts/:id` has no customer authentication — the only gate is the browser-shipped publishable key. | **Follow-up** | **Not a regression in kind:** the pre-existing `retrieveCart` in the same module has exactly the same shape and the same exposure, so PR1a neither introduced nor widened the class. Recorded because "the sibling already does it" is a reason not to block this PR, not a reason for the property to go unwritten. The fix is to stop exporting caller-supplied `fields` across the server-action boundary at all — pin the projection server-side — which touches every `retrieveCart` caller. |
| 5c | **Worst-case checkout render is ~7 s PLUS an unbounded tail.** `checkout-form/index.tsx` awaits `listCartShippingMethods` and *then* `listCartPaymentMethods` sequentially. The first is bounded at 5 s + 2 s by PR1a; `payment.ts` has no timeout at all, so the total is bounded-plus-unbounded. | **PR2a** | Two separate fixes and neither belongs here: parallelising the two awaits is PR2a's `Promise.all`, and bounding `listCartPaymentMethods` is the same `force-cache`/timeout sweep as #4. Deliberately not parallelised in the remediation pass — changing the render order of the checkout page is not a bug fix. |
| 6 | **A bare-PK upsert (`{ shipping_address: { id } }`) is emitted when a patch has no persistable fields.** Pinned as intended in `cart-address-payload.spec.ts`: the address row is untouched, but `updateCartWorkflow` still runs. | **PR2a** | Suppressing the pointless round trip is the caller's job, and §D3's "skip when the draft is unchanged" rule already assigns it to the PR2a reducer. PR1a's single caller always passes six populated fields, so the case cannot occur yet. |

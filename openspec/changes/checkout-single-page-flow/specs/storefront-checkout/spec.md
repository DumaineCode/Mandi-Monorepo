# Storefront Checkout Specification

Change: `checkout-single-page-flow`
Domain: `storefront-checkout`
Scope: `apps/storefront` only. No backend changes.
Inputs: [`proposal.md`](../../proposal.md) (R1–R8, C1–C3, §9 settled decisions), [`explore.md`](../../explore.md) (evidence, `file:line`).

This is a **new domain spec** — no canonical `openspec/specs/storefront-checkout/spec.md` exists, so this is a full spec, not a delta.

---

## Purpose

Define the behaviour a single-page Medusa checkout must exhibit after this change: three always-visible sections, a shipping quote triggered by a postal code alone, autosave that does not destroy customer data, a payment session created only at the final CTA, and one gate — the CTA — that tells the customer exactly what is missing.

This document states **what must be true**. Module boundaries, component decomposition, hook design and file layout belong to `sdd-design`.

---

## Conventions

### Verification classes

Every requirement carries a verification class. The storefront has **vitest with `environment: "node"` and `include: ["src/**/*.spec.ts"]` only** — no jsdom, no `@testing-library`, no Playwright (`explore §8`). Coverage claims beyond that are forbidden.

| Class | Meaning |
|---|---|
| `AUTO` | Verifiable by `cd apps/storefront && pnpm test` (vitest). Only pure modules qualify. |
| `STATIC` | Verifiable by code inspection / grep against the working tree. Deterministic, no runtime. |
| `MANUAL` | Verifiable only by a human running the checkout in a browser. No automated safety net exists. |

A requirement may carry more than one class when parts of it are separable (e.g. a pure payload builder is `AUTO`, its wiring is `MANUAL`).

### PR tags

Delivery is **two chained PRs** (settled decision 6), 600 changed lines budget each.

- `PR1` — data layer & correctness: pure modules + specs, `persistShippingForCalc` id fix, shipping-option cache/refetch correctness, Openpay wrapper inversion. Independently shippable; closes a live bug.
- `PR2` — UI restructure: the single-page checkout that consumes PR1.

### Copy language

The spec is English. **All customer-facing copy is Mexican Spanish, `tú` form**, matching the storefront's existing register (`"Completa los datos a mano."` — `shipping-address/index.tsx:481`; `"Selecciona un método de pago"` — `payment-button/index.tsx:61`).

> **Deviation from the proposal, deliberate.** The proposal's R8 examples (`"Elegí un método de envío"`) are voseo (Rioplatense) and do not match the storefront. Every message below uses the Mexican imperative (`Elige`, `Completa`, `Ingresa`). This is a copy-register correction, not a scope change.

### Field-absence semantics

Throughout this spec, a string field is **absent** when it is `null`, `undefined`, or trims to `""`. This matches `hasCompleteShippingContact` (`lib/util/checkout-step.ts:29-35`) and the backend guards.

---

## Requirements

## Group A — Order-placement gate (PR1)

### Requirement: Order-Placement Readiness Is a Pure, Ordered, Itemized Predicate

`PR1` · `AUTO`

The system MUST expose a pure function that, given a cart and the customer's current payment selection, returns the **ordered list of everything preventing order placement**. It MUST be side-effect free: no network calls, no cart fetching, no DOM access, no timers, no reads of module-level mutable state. The same input MUST always produce the same output, including list order.

Contract:

```
type MissingRequirementCode =
  | "cart_empty"
  | "email"
  | "phone"
  | "shipping_address"
  | "billing_address"
  | "shipping_method"
  | "payment_method"
  | "card_details"

type MissingRequirement = {
  code: MissingRequirementCode
  message: string   // customer-facing, Mexican Spanish
}

type OrderReadinessInput = {
  cart: HttpTypes.StoreCart | null | undefined
  selectedPaymentMethod: string | null | undefined
  isCardDataComplete: boolean
}

getMissingOrderRequirements(input: OrderReadinessInput): MissingRequirement[]
canPlaceOrder(input: OrderReadinessInput): boolean
```

`canPlaceOrder(input)` MUST be exactly equivalent to `getMissingOrderRequirements(input).length === 0`. It MUST NOT re-derive the conditions independently — a second copy of the rule is how the two drift apart.

The predicate MUST be **at least as strict** as today's `notReady` (`payment-button/index.tsx:26-31`) plus the `phone` rule from `hasCompleteShippingContact`. Medusa's `completeCart` validates only "cart has items" and "payment collection holds ≥1 session in an acceptable status" — **no address, no email, no shipping-method check** (`explore §7`). This predicate is the only guard standing between the customer and an order Skydropx can never label. That is a documented prior incident.

#### Scenario: A fully ready cart returns an empty list

- GIVEN a cart with ≥1 line item, a non-empty `email`, a shipping address with non-empty `first_name`, `last_name`, `address_1`, `postal_code`, `city`, `province`, `country_code` and `phone`, a billing address, and ≥1 entry in `shipping_methods`
- AND `selectedPaymentMethod` is a non-empty provider id that is not Openpay
- WHEN `getMissingOrderRequirements` is called
- THEN it returns `[]`
- AND `canPlaceOrder` returns `true`

#### Scenario: Multiple missing requirements are all reported, not just the first

- GIVEN a cart with items but no `email`, no `phone`, and no shipping method
- AND `selectedPaymentMethod` is `null`
- WHEN `getMissingOrderRequirements` is called
- THEN the returned list contains entries for `email`, `phone`, `shipping_method` and `payment_method`
- AND the list length is exactly 4

#### Scenario: The list is ordered top-to-bottom by page position

- GIVEN a cart missing `email`, `shipping_method` and `payment_method`
- WHEN `getMissingOrderRequirements` is called
- THEN the returned codes appear in exactly this relative order: `email`, `shipping_method`, `payment_method`

#### Scenario: Whitespace-only values count as absent

- GIVEN a cart whose `email` is `"   "` and whose `shipping_address.phone` is `"\t"`
- WHEN `getMissingOrderRequirements` is called
- THEN the returned list contains `email` and `phone`

#### Scenario: A null or undefined cart reports the empty-cart condition only

- GIVEN `cart` is `null`
- WHEN `getMissingOrderRequirements` is called
- THEN the returned list is exactly `[{ code: "cart_empty", ... }]`
- AND the function does not throw

---

### Requirement: The Missing-Requirement Catalogue Is Exhaustive and Fixed

`PR1` · `AUTO`

The predicate MUST evaluate exactly the conditions in the table below, in the stated order, with the stated customer-facing message. No other condition may disable the CTA. Adding, removing or reordering an entry is a spec change.

| # | Code | Condition (all absence checks are trim-based) | Message |
|---|---|---|---|
| 0 | `cart_empty` | `cart` is null/undefined, **or** `cart.items` is absent or empty | `Tu carrito está vacío.` |
| 1 | `email` | `cart.email` absent | `Falta tu correo electrónico.` |
| 2 | `phone` | `cart.shipping_address.phone` absent | `Falta tu teléfono.` |
| 3 | `shipping_address` | `cart.shipping_address` absent, **or** any of `first_name`, `last_name`, `address_1`, `postal_code`, `city`, `province`, `country_code` absent | `Completa tu dirección de envío.` |
| 4 | `billing_address` | `cart.billing_address` absent | `Falta tu dirección de facturación.` |
| 5 | `shipping_method` | `cart.shipping_methods` absent or empty | `Elige un método de envío.` |
| 6 | `payment_method` | `selectedPaymentMethod` absent | `Elige un método de pago.` |
| 7 | `card_details` | `selectedPaymentMethod` is the Openpay provider **and** `isCardDataComplete` is `false` | `Completa los datos de tu tarjeta.` |

Rules that constrain the table:

- **`cart_empty` short-circuits.** When condition 0 holds, the returned list MUST contain that entry and nothing else. Listing "falta tu teléfono" to a customer with an empty cart is noise.
- **`phone` is separate from `shipping_address` on purpose.** A missing phone is a single actionable field and gets its own line; folding it into the generic address message would hide the exact cause of the documented Skydropx labelling incident (`lib/util/checkout-step.ts` docstring).
- **`card_details` is Openpay-only.** Mercado Pago collects card data off-site; Stripe's readiness is an element-mount concern, not a cart concern, and is not part of this predicate.
- **Legal-text acceptance is NOT in this table** (settled decision 2). The legal text is informational, not a checkbox, and therefore never appears in the missing list.
- **Format validity is NOT in this table** beyond presence. Phone/email *format* is the input `pattern`'s job (`lib/util/phone.ts`) and the backend normalizes. Re-checking format here risks trapping a customer behind a CTA they cannot satisfy — the same over-strictness that previously made the phone pattern a revenue stopper.

#### Scenario: Empty cart suppresses every other message

- GIVEN a cart with `items: []`, no email, no address and no shipping method
- WHEN `getMissingOrderRequirements` is called
- THEN the returned list is exactly one entry with code `cart_empty` and message `Tu carrito está vacío.`

#### Scenario: Openpay selected with incomplete card data

- GIVEN an otherwise fully ready cart
- AND `selectedPaymentMethod` is the Openpay provider id
- AND `isCardDataComplete` is `false`
- WHEN `getMissingOrderRequirements` is called
- THEN the returned list is exactly one entry with code `card_details`

#### Scenario: Card completeness is ignored for non-Openpay providers

- GIVEN an otherwise fully ready cart
- AND `selectedPaymentMethod` is the Mercado Pago provider id
- AND `isCardDataComplete` is `false`
- WHEN `getMissingOrderRequirements` is called
- THEN the returned list is `[]`

#### Scenario: A partially filled address still reports the address condition

- GIVEN a shipping address with `postal_code`, `city`, `province` and `country_code` set but `address_1` absent
- WHEN `getMissingOrderRequirements` is called
- THEN the returned list contains an entry with code `shipping_address`

---

## Group B — Quotation readiness (PR1)

### Requirement: The Quote-Relevant Address Signature Contains Exactly Four Fields

`PR1` · `AUTO`

The system MUST expose a pure function that builds a canonical signature from **only** `country_code`, `postal_code`, `province` and `city`. Skydropx's `calculatePrice` requires exactly these four on the destination and nothing else — no street, no colonia, no name, no phone (`explore §4`, `skydropx-fulfillment/service.ts:431-456`, `:774-840`).

```
type QuoteRelevantAddress = {
  country_code?: string | null
  postal_code?: string | null
  province?: string | null
  city?: string | null
}

buildQuoteSignature(address: QuoteRelevantAddress | null | undefined): string | null
```

- It MUST return `null` when any of the four fields is absent, or when `postal_code` does not match `/^\d{5}$/`.
- It MUST normalize before comparison: trim, lowercase, and collapse internal whitespace runs to a single space. `"CIUDAD DE  MÉXICO"` and `"ciudad de méxico"` are the same destination and MUST NOT trigger a redundant quote.
- It MUST NOT include `address_1` or `address_2`. This is the whole point of the change: today's `buildCartShippingSignature` (`shipping-address/index.tsx:33-45`) includes both, which is why quoting never happens early.
- Field values MUST be joined with a delimiter that cannot occur in a normalized value, so that `{city: "a", province: "b"}` and `{city: "a|b", province: ""}` cannot collide.

#### Scenario: Four fields present produces a stable signature

- GIVEN `{ country_code: "mx", postal_code: "06700", province: "CDMX", city: "Cuauhtémoc" }`
- WHEN `buildQuoteSignature` is called twice
- THEN both calls return the same non-null string

#### Scenario: Street fields do not affect the signature

- GIVEN two addresses identical in the four quote-relevant fields but differing in `address_1` and `address_2`
- WHEN `buildQuoteSignature` is called on each
- THEN both return the same signature

#### Scenario: Case and whitespace differences do not affect the signature

- GIVEN `{ country_code: "MX", postal_code: " 06700 ", province: "CDMX", city: "Ciudad  de  México" }`
- AND `{ country_code: "mx", postal_code: "06700", province: "cdmx", city: "ciudad de méxico" }`
- WHEN `buildQuoteSignature` is called on each
- THEN both return the same signature

#### Scenario: An incomplete or malformed postal code yields no signature

- GIVEN `{ country_code: "mx", postal_code: "067", province: "CDMX", city: "Cuauhtémoc" }`
- WHEN `buildQuoteSignature` is called
- THEN it returns `null`

#### Scenario: A missing city yields no signature

- GIVEN `{ country_code: "mx", postal_code: "06700", province: "CDMX", city: null }`
- WHEN `buildQuoteSignature` is called
- THEN it returns `null`

---

### Requirement: Quotation Readiness Is a Pure Decision Function

`PR1` · `AUTO`

The system MUST expose a pure function that decides whether a quote should be requested. It MUST NOT perform the request, start timers, or touch the network.

```
type QuoteReadinessInput = {
  draftAddress: QuoteRelevantAddress | null   // current form state
  lastRequestedSignature: string | null       // signature of the most recent request that succeeded
  inFlightSignature: string | null            // signature of a request currently running
  cartId: string | null | undefined
}

type QuoteDecision =
  | { action: "idle"; reason: "incomplete_address" | "no_cart" }
  | { action: "skip"; reason: "already_quoted" | "already_in_flight" }
  | { action: "quote"; signature: string; supersedes: string | null }

evaluateQuoteReadiness(input: QuoteReadinessInput): QuoteDecision
```

Decision rules, evaluated in this order:

1. `cartId` absent → `{ action: "idle", reason: "no_cart" }`.
2. `buildQuoteSignature(draftAddress)` is `null` → `{ action: "idle", reason: "incomplete_address" }`.
3. signature equals `inFlightSignature` → `{ action: "skip", reason: "already_in_flight" }`.
4. signature equals `lastRequestedSignature` → `{ action: "skip", reason: "already_quoted" }`.
5. otherwise → `{ action: "quote", signature, supersedes: inFlightSignature }`.

`supersedes` is non-null when a **different** request is in flight. The caller MUST abort that request; latest input wins. A stale response MUST never overwrite a newer quote.

`lastRequestedSignature` MUST be set only on **success**. A failed quote MUST leave it unchanged, so that re-entering the same postal code retries rather than silently doing nothing. This is what makes the `failed` state recoverable without a page reload.

#### Scenario: A complete new address requests a quote

- GIVEN a `cartId`, a complete draft address, `lastRequestedSignature: null` and `inFlightSignature: null`
- WHEN `evaluateQuoteReadiness` is called
- THEN it returns `action: "quote"` with the signature of the draft address and `supersedes: null`

#### Scenario: An unchanged address is deduped

- GIVEN a complete draft address whose signature equals `lastRequestedSignature`
- WHEN `evaluateQuoteReadiness` is called
- THEN it returns `{ action: "skip", reason: "already_quoted" }`

#### Scenario: A changed address while a request is in flight supersedes it

- GIVEN `inFlightSignature` is the signature of address A
- AND the draft address is B, with a different signature
- WHEN `evaluateQuoteReadiness` is called
- THEN it returns `action: "quote"` with B's signature and `supersedes` equal to A's signature

#### Scenario: Only a postal code and no cart stays idle

- GIVEN `cartId` is `null` and the draft address is complete
- WHEN `evaluateQuoteReadiness` is called
- THEN it returns `{ action: "idle", reason: "no_cart" }`

#### Scenario: A failed quote is retryable with the same address

- GIVEN a quote for signature S failed and `lastRequestedSignature` was therefore left at its previous value
- AND the draft address still produces signature S
- WHEN `evaluateQuoteReadiness` is called
- THEN it returns `action: "quote"` with signature S

---

### Requirement: Quote Requests Are Debounced on the Trailing Edge

`PR1` (constant + wrapper) · `AUTO` for the constant, `MANUAL` for the effect

Quote-relevant form input MUST be debounced before `evaluateQuoteReadiness` is consulted, at **600 ms**, trailing edge, preserving the existing `PREFETCH_DEBOUNCE_MS` value (`shipping-address/index.tsx:20`). The value MUST be exported as a named constant from the pure module so it is a single source of truth rather than a literal repeated in components.

- Every keystroke in a quote-relevant field MUST reset the timer.
- Keystrokes in non-quote-relevant fields (`address_1`, `address_2`, `first_name`, `last_name`, `company`, `phone`) MUST NOT reset it and MUST NOT schedule a quote.
- Blur-triggered autosave MUST NOT bypass the debounce for quoting purposes; autosave persistence and quote triggering are independent concerns.

#### Scenario: Rapid typing produces a single quote

- GIVEN the customer types the five digits of a postal code with less than 600 ms between keystrokes
- WHEN 600 ms elapse after the last keystroke
- THEN exactly one quote is requested

#### Scenario: Typing a street address does not trigger a quote

- GIVEN a complete quote-relevant address that has already been quoted
- WHEN the customer types into `address_1`
- THEN no quote is requested

---

## Group C — Address persistence correctness (PR1)

### Requirement: Every Partial Shipping-Address Write Carries `shipping_address.id`

`PR1` · `AUTO` (payload builder) + `STATIC` + `MANUAL`

Any cart update that sends a **partial** `shipping_address` MUST include `shipping_address.id` when `cart.shipping_address?.id` exists.

This is not a nicety. Medusa resolves a nested `shipping_address` through `EntityAssigner` with `updateByPrimaryKey: true`; with no `id` in the payload, `extractPK` returns undefined and the assigner falls through to `assignReference`, which calls `em.create(...)` — **a brand-new `cart_address` row, with the cart FK repointed** (`explore §3`, `EntityAssigner.js:77-98`, `:142-159`). Every field not present in the payload is therefore destroyed: `first_name`, `last_name`, `address_1`, `address_2`, `company`, `phone`.

`StoreCartUpsertAddress` explicitly accepts an optional `id` (`validators.js:38-40`); with it present, `sameTarget` holds and MikroORM performs a true field-level merge.

This is a **live bug today** in `persistShippingForCalc` (`lib/data/cart.ts:109-155`), currently masked by the `address_1 && address_2` prefetch gate this change removes. Under R4 + R6 it would fire on every keystroke pause, in production, with visible data loss. It is the single highest-consequence item in the change.

The payload construction MUST be extractable as a pure function so it is directly testable:

```
buildPartialShippingAddressPayload(
  cart: HttpTypes.StoreCart | null | undefined,
  patch: Partial<QuoteRelevantAddress & { address_1?, address_2?, first_name?, ... }>
): { shipping_address: Record<string, unknown> }
```

#### Scenario: An existing address id is propagated

- GIVEN a cart whose `shipping_address.id` is `"caaddr_01"`
- WHEN `buildPartialShippingAddressPayload` is called with a patch containing only `postal_code`, `city`, `province` and `country_code`
- THEN the returned payload's `shipping_address.id` equals `"caaddr_01"`

#### Scenario: A cart with no address omits the id rather than sending a falsy one

- GIVEN a cart with no `shipping_address`
- WHEN `buildPartialShippingAddressPayload` is called with a patch
- THEN the returned payload's `shipping_address` has no `id` key
- AND it does not contain `id: null`, `id: undefined` or `id: ""`

#### Scenario: Only patched keys are sent

- GIVEN a cart with a full shipping address
- WHEN the payload is built from a patch containing only `postal_code`
- THEN `shipping_address` contains `id` and `postal_code` and no other address keys

#### Scenario: Customer fields survive a postal-code-only persist (S7)

- GIVEN a cart whose shipping address has `first_name`, `last_name`, `company` and `phone` populated
- WHEN a postal-code-only persist is performed against a running backend
- THEN re-reading the cart shows `first_name`, `last_name`, `company` and `phone` unchanged
- AND `cart.shipping_address.id` is unchanged
- *(`MANUAL` — requires a live backend; this is success criterion S7 and is a required manual QA gate before PR1 merges.)*

---

### Requirement: Autosave Persists Field-Level Without Clobbering Untouched Fields

`PR1` (write path) + `PR2` (blur wiring) · `MANUAL`

Customer data MUST persist to the cart as the customer moves through the form, so that a mid-form page reload does not lose entered data (R6, S6).

- Autosave MUST fire on **field blur**, not on every keystroke.
- Each autosave MUST send only the changed field(s) plus the `id`, per the requirement above.
- Autosave MUST persist **even when the field value is invalid** (settled decision 3). The backend normalizes the phone, and format validation is the CTA predicate's job. Discarding what the customer typed is worse than a dirty cart.
- Autosave MUST NOT clear the field, move focus, or block interaction while in flight.
- Concurrent autosaves for different fields MUST NOT overwrite each other's values.

#### Scenario: Reload preserves entered data

- GIVEN the customer fills contact and address fields and blurs each one
- WHEN the page is reloaded before any button is pressed
- THEN every blurred field is repopulated with the entered value

#### Scenario: An invalid phone is still persisted

- GIVEN the customer types a phone that fails the `MX_PHONE_PATTERN`
- WHEN the field is blurred
- THEN the value is persisted to the cart
- AND the CTA reports the phone as present (presence, not format, per the catalogue)

#### Scenario: Blurring the postal code does not wipe the name

- GIVEN `first_name` and `last_name` are already persisted
- WHEN the customer changes the postal code and blurs it
- THEN `first_name` and `last_name` are unchanged in the cart

---

## Group D — Shipping options and invalidation (PR1)

### Requirement: Shipping Options Are Refetched When the Quote Signature Changes

`PR1` · `STATIC` + `MANUAL`

The shipping-option list returned by `listCartShippingMethods` is **filtered by the cart's shipping address** — `country_code`, `province_code`, `city`, `postal_expression` (`explore §5`, `list-shipping-options-for-cart.js`). A stale list is a wrong list.

- The option list MUST be refetched whenever the persisted cart's quote signature changes.
- `listCartShippingMethods` MUST NOT be served from a `force-cache` entry that carries no cache tag. `getCacheTag` returns `""` when the `_medusa_cache_id` cookie is absent, and `getCacheOptions` then returns `{}` (`lib/data/cookies.ts:22-48`), producing an entry `revalidateTag` can never invalidate.
- When no usable cache tag is available, the fetch MUST NOT use `force-cache`.
- Removing `?step=` navigation removes the accidental full remounts that keep this list fresh today. The refresh MUST become explicit.

#### Scenario: A postal-code change produces a fresh option list

- GIVEN options were fetched for postal code A
- WHEN the customer changes the postal code to B and the address is persisted
- THEN the option list is refetched and reflects B's service zone

#### Scenario: No cache tag means no force-cache

- GIVEN the `_medusa_cache_id` cookie is absent
- WHEN `listCartShippingMethods` is called
- THEN the request is not issued with `cache: "force-cache"`

---

### Requirement: A Quote-Signature Change Clears the Selected Shipping Method

`PR1` (rule) + `PR2` (effect) · `AUTO` for the rule, `MANUAL` for the effect

Per settled decision 1: when the quote-relevant address signature changes and the cart already has a shipping method, that method MUST be removed from the cart. The customer re-picks.

Auto-reselecting an equivalent option was **rejected**: the shipping price changes with the postal code, and a silently changed total is worse than one extra click.

- The trigger is a change in the signature defined above — `country_code`, `postal_code`, `province`, `city` **only**. Editing `address_1`, `address_2`, `company`, `first_name`, `last_name` or `phone` MUST NOT clear the shipping method.
- Observable outcome after clearing: `cart.shipping_methods` is empty; the Envío section shows the refetched options with none selected; the CTA is disabled and reports `Elige un método de envío.`; the order summary shows shipping as pending, never a price derived from the previous postal code.

#### Scenario: Changing the postal code clears the selection

- GIVEN a cart with a selected shipping method quoted for postal code A
- WHEN the customer changes the postal code to B and the address is persisted
- THEN `cart.shipping_methods` is empty
- AND no option is preselected in the Envío section
- AND the CTA is disabled with `Elige un método de envío.`

#### Scenario: Editing the street does not clear the selection

- GIVEN a cart with a selected shipping method
- WHEN the customer edits `address_1` and blurs it
- THEN `cart.shipping_methods` still contains the selected method

#### Scenario: The summary never shows a stale shipping price

- GIVEN a selected shipping method with a displayed price
- WHEN the quote signature changes
- THEN the summary stops displaying that price before any new price is displayed

---

## Group E — Payment session lifecycle (PR1 wrapper, PR2 flow)

### Requirement: No Payment Session Exists Before the Final CTA Is Clicked

`PR2` · `MANUAL`

Per R5, no payment session is created while the customer browses the checkout or selects a payment method.

Medusa **deletes every payment session** whenever `cart.raw_total` changes — choosing a shipping method, applying a promotion, editing a line item (`explore §2b`, `refresh-payment-collection.js`). A session created earlier is guaranteed to be destroyed. For Mercado Pago each init is a real outbound Checkout Pro preference call (`explore §2c`) that is then thrown away.

- Selecting a payment method MUST NOT call `initiatePaymentSession`.
- The one-shot `initiatedDefaultRef` guard (`payment/index.tsx:186-205`) MUST be removed. It cannot re-initiate after a session wipe and has no purpose once initiation moves to the CTA.
- Any "payment ready" state MUST be derived from live cart state and the customer's selection, never from a one-shot init flag.

#### Scenario: Browsing creates no session

- GIVEN a fresh checkout page load
- WHEN the customer selects a payment method, changes shipping method, and applies a promotion
- THEN `cart.payment_collection?.payment_sessions` remains empty
- AND no Mercado Pago preference call is made

#### Scenario: Exactly one Mercado Pago preference per checkout attempt (S8)

- GIVEN Mercado Pago is selected
- WHEN the customer clicks the CTA once
- THEN exactly one preference is created

---

### Requirement: Openpay Places the Order in Tokenize → Initiate → Complete Order

`PR2` · `MANUAL`

On CTA click with Openpay selected, the system MUST execute exactly this sequence:

1. Re-evaluate `canPlaceOrder`. If false, do nothing (the button is disabled; this is a defensive re-check).
2. **Tokenize in the browser** via `openpay.tokenize(cardData)`. Card data never reaches our backend.
3. `initiatePaymentSession(cart, { provider_id, data: { token_id, device_session_id, return_url, customer } })`.
4. `placeOrder()`. On `type === "order"`, redirect to `/{countryCode}/order/{id}/confirmed`. On `type === "cart"` (HTTP 200 = failed completion), `placeOrder` throws (`lib/data/cart.ts:592-640`).

Failure and recovery:

- A **tokenization failure** MUST throw before any backend mutation. No payment session is created, no order is attempted, an inline Spanish error is shown, and the button is re-enabled.
- An **initiate failure** MUST show an inline Spanish error and re-enable the button. No order is attempted.
- A **placeOrder failure** MUST show an inline Spanish error and re-enable the button.
- **Retry MUST re-tokenize.** An Openpay token is single-use; reusing a token from a failed attempt MUST NOT happen. Every CTA click starts at step 2.
- `deviceSessionId` MUST be available at click time. Under C1 the Openpay wrapper mounts from provider configuration rather than from an existing session, so `deviceData.setup()` has run by then. If `deviceSessionId` is unavailable, the flow MUST fail with an inline error rather than initiating a session without it.

#### Scenario: Successful Openpay order

- GIVEN a ready cart with Openpay selected and complete card data
- WHEN the customer clicks `Realizar pedido`
- THEN the card is tokenized, a session is initiated with the token, the cart is completed, and the browser lands on `/{countryCode}/order/{id}/confirmed`

#### Scenario: Tokenization failure creates no session

- GIVEN a ready cart with Openpay selected and a card the tokenizer rejects
- WHEN the customer clicks the CTA
- THEN an inline error is shown, the button is re-enabled, and `cart.payment_collection?.payment_sessions` remains empty

#### Scenario: Retry after a failure tokenizes again

- GIVEN a previous CTA click failed after tokenization
- WHEN the customer clicks the CTA again
- THEN a new token is requested and the previous token is not reused

---

### Requirement: Mercado Pago Redirects and Never Calls placeOrder

`PR2` · `MANUAL`

On CTA click with Mercado Pago selected, the system MUST execute exactly this sequence:

1. Re-evaluate `canPlaceOrder`. If false, do nothing.
2. `initiatePaymentSession(cart, { provider_id, data: { back_urls_base } })`. The backend creates a Checkout Pro preference and returns `init_point` (`mercadopago-payment/service.ts:184-218`).
3. Read `init_point` from the resulting pending session and set `window.location.href` to it.

`placeOrder` MUST NOT be called for Mercado Pago. The webhook is the source of truth (`explore §6`).

Failure and recovery:

- If the initiate call fails, an inline Spanish error MUST be shown, no redirect occurs, and the button is re-enabled.
- If the session returns without a usable `init_point`, the system MUST show an inline Spanish error and MUST NOT redirect. Silently navigating to `undefined` is forbidden.
- On return through `payment/mercadopago/failure/route.ts`, the customer MUST land on a coherent single-page checkout with cart data intact and be able to retry. A retry re-runs step 2 and creates a fresh preference.

#### Scenario: Successful Mercado Pago redirect

- GIVEN a ready cart with Mercado Pago selected
- WHEN the customer clicks the CTA
- THEN a session is initiated and the browser navigates to the returned `init_point`
- AND `placeOrder` is not called

#### Scenario: Missing init_point does not redirect

- GIVEN the initiate call returns a session with no `init_point`
- WHEN the customer clicks the CTA
- THEN an inline Spanish error is shown and the browser does not navigate away

#### Scenario: Return from a failed Mercado Pago payment is recoverable

- GIVEN the customer was redirected to Mercado Pago and returned through the failure route
- WHEN the checkout page renders
- THEN the URL has no `?step=` parameter
- AND contact, address and shipping selections are intact
- AND clicking the CTA again initiates a fresh session

---

### Requirement: The Openpay Wrapper Mounts from Provider Configuration

`PR1` · `STATIC` + `MANUAL`

Per C1, the payment wrapper MUST be selected from `getProviderConfig`, not from an existing `pending` payment session (`payment-wrapper/index.tsx:37-58`).

Under R5 there is no session until the CTA, but the card form needs `openpay.js` mounted in the browser to tokenize and to run `deviceData.setup()`. Mounting the Openpay wrapper without a session is harmless — it reads no session data (`explore §6`).

- The wrapper MUST NOT read `cart.payment_collection.payment_sessions` to decide what to mount.
- When Openpay credentials are missing, the existing `configMissing` short-circuit MUST be preserved.

#### Scenario: Card fields are usable with no session

- GIVEN Openpay is a configured provider and the cart has no payment session
- WHEN the customer selects Openpay
- THEN the card fields render and accept input
- AND `deviceSessionId` becomes available before the CTA is clicked

---

## Group F — Single-page structure (PR2)

### Requirement: Checkout Navigation Has No `?step=` Parameter

`PR2` · `STATIC` + `MANUAL`

`?step=` MUST be removed entirely from checkout — all 4 readers and all 8 writers (`explore §1`).

- Readers to remove: `addresses/index.tsx:32`, `shipping/index.tsx:107`, `payment/index.tsx:68`, `review/index.tsx:12`.
- Writers to remove: `addresses/index.tsx:41,68`, `shipping/index.tsx:164,168`, `payment/index.tsx:136,155,172`, `cart/templates/summary.tsx:29`, `payment/openpay/return/route.ts:22`, `payment/mercadopago/failure/route.ts:19`.
- The two payment-return routes MUST redirect to `/{countryCode}/checkout` without a step parameter. The `error=payment_failed` parameter is **out of scope** and its handling stays exactly as today: produced, read by nothing. Surfacing it is a separate change.
- Section state MUST be client-side. Moving between sections MUST NOT cause a Next.js RSC re-render (S1 target: 0 round-trip chains).
- `getCheckoutStep` becomes dead for routing. `hasCompleteShippingContact` MUST be preserved or folded into the CTA predicate — its phone rule is incident-driven and MUST NOT be deleted.

#### Scenario: No step parameter remains in the source (S5)

- GIVEN the change is complete
- WHEN `apps/storefront/src` is searched for `step=`
- THEN there are zero checkout-navigation occurrences

#### Scenario: Section movement costs no server round trip

- GIVEN the checkout page has loaded
- WHEN the customer moves focus between the Datos, Envío and Pago sections
- THEN no RSC navigation occurs and the URL does not change

---

### Requirement: No Checkout Section Is Ever Disabled

`PR2` · `STATIC` + `MANUAL`

All three sections — **Datos**, **Envío**, **Pago** — MUST be visible and interactive at all times (R1, S4).

- No section may be rendered with `pointer-events-none`, `opacity-50` as a gating device, `disabled` containers, or any equivalent that prevents interaction.
- The customer MUST be able to fill the form in any order, including selecting a payment method before entering an address.
- The **CTA is the only gate** (R8). Sections themselves are never blocked.

#### Scenario: Payment is interactive before an address exists

- GIVEN a fresh cart with no shipping address
- WHEN the checkout page renders
- THEN the Pago section renders its method list and the customer can select a method
- AND the CTA remains disabled, reporting the missing address items

#### Scenario: No gating classes remain

- GIVEN the change is complete
- WHEN the checkout section components are inspected
- THEN no section container carries `pointer-events-none` as a gating mechanism

---

### Requirement: Each Section Has a Defined Empty and Pending State

`PR2` · `MANUAL`

| Section | Empty / pending state |
|---|---|
| **Datos** | Always renders the full contact + address form, prefilled from the cart and, when signed in, the customer. Never a placeholder. Fields are unchanged from today (R7). |
| **Envío** | Before a quote signature exists, renders an **instructional placeholder**: `Ingresa tu código postal para ver las opciones y el costo de envío.` It MUST NOT render a list of options with `—` prices (R3). |
| **Pago** | Always renders the provider list from `listCartPaymentMethods`. Openpay card fields render when Openpay is selected, with no session required (C1). |

#### Scenario: Envío is instructional before a postal code

- GIVEN a cart with no postal code
- WHEN the checkout page renders
- THEN the Envío section shows the instructional message
- AND it renders no option rows and no placeholder prices

---

### Requirement: The Quotation Lifecycle Has Six Customer-Visible States

`PR2` · `MANUAL`

The Envío section MUST render exactly one of these states, and MUST always render one:

| State | Entered when | Customer sees |
|---|---|---|
| `idle` | No valid 5-digit postal code | `Ingresa tu código postal para ver las opciones y el costo de envío.` |
| `looking_up` | SEPOMEX (`getPostalCode`) request in flight | `Buscando código postal…` (existing copy, `shipping-address/index.tsx:476`) |
| `quoting` | A quote request is in flight | A loading state for the option list. Previously quoted prices MUST NOT remain visible as if current. |
| `quoted` | Options returned with ≥1 serviceable option | The option list with real prices, none preselected after a signature change |
| `not_serviceable` | Options returned but the list is empty | `Todavía no llegamos a esa zona. Prueba con otro código postal.` No fallback path — no manual-quote or contact-support flow exists (settled decision 4). |
| `failed` | The quote request errored or timed out | `No pudimos calcular el envío. Verifica tu código postal e inténtalo de nuevo.` Retry MUST be possible without a page reload. |

Constraints:

- A **SEPOMEX lookup failure MUST NOT enter `failed`** and MUST NOT block the section. It degrades to manual state/city entry (see the next requirement); once state and city are present the signature completes and quoting proceeds normally.
- A quote that fails because a cart item is **missing dimensions** (`buildParcel` throws `MissingDimensionsError` before any carrier call — `explore §4`, `parcel.ts:49-79`) MUST render the `failed` message. The message MUST NOT blame the address, because the address is not the problem and the customer cannot fix it. The failure MUST be observable to the team through logging; today `lib/data/fulfillment.ts:33-66` swallows all errors and returns `null`, which MUST NOT remain the only outcome.
- State transitions MUST be driven by the persisted cart signature and the in-flight request, never by a one-shot flag.

#### Scenario: Postal code alone produces a real price (S3)

- GIVEN a cart with items that have complete dimensions
- WHEN the customer enters a valid 5-digit postal code and nothing else
- THEN SEPOMEX resolves state and city, the address is persisted, options are quoted, and real prices are displayed

#### Scenario: An unserviceable postal code is explained

- GIVEN a valid postal code with no serviceable shipping option
- WHEN the quote returns
- THEN the `not_serviceable` message is shown
- AND the customer is not left staring at an empty list
- AND the CTA is disabled reporting `Elige un método de envío.`

#### Scenario: A dimensionless item fails without blaming the address

- GIVEN a cart containing a variant with no weight
- WHEN a quote is requested
- THEN the `failed` message is shown
- AND the message does not attribute the failure to the address
- AND the failure is logged

---

### Requirement: A SEPOMEX Failure Never Blocks Checkout

`PR2` · `MANUAL`

If the SEPOMEX lookup fails or returns nothing for a syntactically valid postal code, the customer MUST be able to enter state and city manually and continue.

- The existing degradation message `No encontramos ese código postal. Completa los datos a mano.` (`shipping-address/index.tsx:481`) MUST be preserved.
- The Envío section MUST remain visible.
- Once `province` and `city` are present by any means — SEPOMEX or manual entry — the quote signature completes and quoting proceeds identically.

#### Scenario: Manual entry after a lookup failure still quotes

- GIVEN SEPOMEX returns nothing for a valid postal code
- WHEN the customer types the state and city manually
- THEN the address is persisted and a quote is requested

---

### Requirement: A Returning Cart Is Quoted on Load

`PR2` · `MANUAL`

When the checkout page loads with a cart that already has a complete quote signature, shipping MUST already be quoted and options shown. The customer MUST NOT have to re-touch the postal-code field to trigger it.

#### Scenario: Returning cart shows options immediately

- GIVEN a cart with `country_code`, `postal_code`, `province` and `city` persisted
- WHEN the checkout page loads
- THEN the Envío section reaches `quoted` (or `not_serviceable`) without any customer input

---

### Requirement: The Review Step Is Removed and Legal Text Sits Above the CTA

`PR2` · `STATIC` + `MANUAL`

Per R2, the Review section is removed. Order-summary responsibility stays with the persistent `CheckoutSummary` in the right column.

- The legal text MUST be preserved **verbatim** from `review/index.tsx:43-46`: `Al hacer clic en Realizar pedido, confirmas que leíste, entendiste y aceptas nuestros Términos de uso, Términos de venta y Política de devoluciones, y reconoces que leíste la Política de privacidad de MANDO.`
- It MUST render directly above the single final CTA.
- It is **informational only** (settled decision 2). It MUST NOT be a checkbox and MUST NOT appear in the missing-requirements list.
- The `review` component directory is deleted.

#### Scenario: One CTA remains (S2)

- GIVEN the change is complete
- WHEN the checkout page is inspected
- THEN there is exactly one order-placement button, labelled `Realizar pedido`
- AND `submit-address-button`, `submit-delivery-option-button` and `submit-payment-button` no longer exist

---

### Requirement: The Disabled CTA Displays the Itemized Missing List

`PR2` · `MANUAL`

Per R8 and S9, when the CTA is disabled it MUST display the full ordered list from `getMissingOrderRequirements` — not a generic message, not silence.

- The list MUST render **all** entries, in the returned order, one per line.
- The list MUST update reactively as the customer fills fields.
- The list container MUST carry `aria-live="polite"` so screen-reader users hear what changed.
- The CTA MUST be disabled while a placement attempt is in flight, and re-enabled on failure.

#### Scenario: The list shrinks as the customer fills the form

- GIVEN the CTA reports missing email, phone and shipping method
- WHEN the customer enters and blurs the email
- THEN the list shows only phone and shipping method

#### Scenario: The CTA enables exactly when the list empties

- GIVEN the CTA reports one missing item
- WHEN that item is satisfied
- THEN the list disappears and the CTA becomes enabled

---

### Requirement: Mobile Renders a Sticky Bottom CTA Bar with Safe-Area Handling

`PR2` · `MANUAL`

Per settled decision 5, below the desktop breakpoint the checkout MUST render a sticky bottom bar.

- The bar MUST display the **cart total**, sourced from the same value `CheckoutSummary` displays, so the two can never disagree.
- The bar MUST contain the `Realizar pedido` CTA, with the same enabled/disabled state as the in-flow CTA.
- The bar MUST apply `env(safe-area-inset-bottom)` to its bottom padding. Without it the iOS home indicator cuts off the purchase button.
- The CTA touch target MUST be at least 44×44 px.
- The page MUST reserve bottom padding equal to the bar's height so the bar never covers the last form field or the legal text.
- When disabled, the bar MUST show the **first** missing-requirement message. The complete itemized list renders in the page flow above the CTA; repeating all of it inside a fixed bar is not viable on a small viewport.
- The bar MUST NOT render on desktop, where the in-flow CTA is already visible.

#### Scenario: The bar clears the iOS home indicator

- GIVEN an iOS device with a home indicator
- WHEN the checkout page renders at a mobile width
- THEN the CTA is fully tappable and not overlapped by the home indicator

#### Scenario: The last form field is reachable

- GIVEN the customer scrolls to the bottom of the checkout on mobile
- WHEN the page is fully scrolled
- THEN the legal text and the in-flow CTA are visible above the sticky bar, not underneath it

#### Scenario: The bar total matches the summary total

- GIVEN a cart with a shipping method and a promotion applied
- WHEN the mobile checkout renders
- THEN the total in the sticky bar equals the total in `CheckoutSummary`

---

### Requirement: Cart Mutations During Checkout Re-Derive Price and Readiness

`PR2` · `MANUAL`

When a promotion is applied or a line item is edited from the summary while the customer is on checkout, `cart.raw_total` changes.

- The shipping price and the order total MUST reflect the new state.
- The CTA predicate MUST be re-evaluated against the updated cart.
- Under R5 there is no payment session to destroy, so no session recovery is needed.
- If the cart becomes empty, the CTA MUST report `Tu carrito está vacío.` and nothing else.

#### Scenario: Applying a promotion updates the total and keeps the CTA coherent

- GIVEN a ready cart with the CTA enabled
- WHEN a promotion is applied from the summary
- THEN the total updates and the CTA remains enabled

#### Scenario: Removing the last item disables the CTA

- GIVEN a ready cart with one line item
- WHEN the item is removed from the summary
- THEN the CTA is disabled and reports only `Tu carrito está vacío.`

---

## Verification summary

| Class | Requirements | How |
|---|---|---|
| `AUTO` | Order-readiness predicate, missing-requirement catalogue, quote signature, quote-readiness decision, debounce constant, partial-address payload builder | `cd apps/storefront && pnpm test` — new `.spec.ts` files under `src/lib/util/`, joining the 4 existing spec files (S10) |
| `STATIC` | `?step=` removal, no gating classes, one CTA, `shipping_address.id` present, wrapper mounts from config, no tagless `force-cache` | Code inspection / grep |
| `MANUAL` | Everything involving rendering, network sequencing, payment providers, mobile layout, and live-backend persistence | Full checkout QA pass **per payment provider** (Openpay, Mercado Pago) before each PR merges |

**`sdd-verify` MUST NOT claim automated coverage of any `MANUAL` requirement.** There is no component harness and no e2e suite; removing or renaming the checkout testids breaks zero automated tests (`explore §9`). Manual QA is the only safety net for the UI layer, and it is a required part of this change.

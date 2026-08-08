# Storefront Checkout — Delta

Change: `checkout-shipping-quote-reliability`
Domain: `storefront-checkout`
Scope: `apps/storefront` only.
Inputs: [`proposal.md`](../../proposal.md) (§3 slices, §9 untouchables, §10 constraints), [`explore.md`](../../explore.md) (evidence, `file:line`).

## Baseline

`openspec/specs/` does not exist in this repo. The de-facto current spec for this domain is
`openspec/changes/checkout-single-page-flow/specs/storefront-checkout/spec.md`. Every `MODIFIED`
block below is the **full** requirement copied from that document and then edited, so archive-time
replacement loses nothing.

## Conventions

Verification classes are inherited from the baseline spec and are binding here:

| Class | Meaning |
|---|---|
| `AUTO` | Verifiable by `pnpm --filter @dtc/storefront test` (vitest, **node env, no jsdom, no `@testing-library`**). Only pure modules qualify. |
| `STATIC` | Verifiable by code inspection / grep against the working tree. |
| `MANUAL` | Verifiable only by a human running checkout in a browser. **No automated safety net exists.** |

Customer-facing copy is Mexican Spanish, `tú` imperative. Never voseo.

A string field is **absent** when it is `null`, `undefined`, or trims to `""`. The **colonia** is
`shipping_address.address_2` (the draft field `address_2`).

Prices are compared **as-is**. Never `/100`, never `*100`. **`0` is a real price (free shipping)** and
is never equivalent to "no price".

## Guards this delta MUST NOT touch

`?? null` never `?? 0` on calculated amounts; the unconditional terminal `QUOTE_READY` dispatch; the
single-writer cart scheduler; `hasShippingMethod` failing closed; the controlled RadioGroup; the mount
guard `selectShouldLookUpPostalCode`; failure parking. No requirement below requires touching any of
them. If an implementation starts needing to, the slice is wrong.

---

## ADDED Requirements

### Requirement: A Quote Round Is Classified by Whether Any Option Is Presentable

`S0` · `AUTO`

The system MUST classify the outcome of a quote round by asking **"is any option in the list
presentable to the customer?"**, not "did the calculated subset produce a price". An option is
**presentable** when it carries a finite numeric amount: a flat option's own `amount`, or a calculated
option's returned price.

- A round MUST be classified as priced whenever **at least one** option in the round is presentable.
- A round MUST be classified as unpriceable only when the round returned options and **none** of them
  is presentable.
- `0` MUST be treated as a presentable amount. A truthiness check on the amount is forbidden; the
  finiteness check is the rule. (An earlier revision used truthiness and rendered free shipping as
  having no price at all — the guard on the price type exists for exactly this.)
- A price key left over from an earlier round MUST NOT rescue an option that was not priced in this
  round. Prices are matched per option id.
- Presentability MUST be decided independently of inventory. An option that is presentable but out of
  stock is a presented, unselectable row, not a failed round.

(This extends behaviour the codebase already has for the all-flat case — an option set with zero
calculated options is already classified as priced — to the **mixed** case, which is where the revenue
loss is.)

#### Scenario: All calculated options price

- GIVEN a round with two calculated options and a finite price for each
- WHEN the round is classified
- THEN it is classified as priced

#### Scenario: A flat option rescues a round whose calculated options all failed

- GIVEN a round with a calculated option `Expres` that returned no price and a flat option `Gratis` with `amount: 0`
- WHEN the round is classified
- THEN it is classified as priced
- AND `Gratis` is presentable

#### Scenario: Some calculated options price and others do not

- GIVEN a round with calculated options A (price `35.47`) and B (no price)
- WHEN the round is classified
- THEN it is classified as priced
- AND A is presentable and B is not

#### Scenario: No option is presentable

- GIVEN a round whose only options are calculated and none returned a price, with no flat option present
- WHEN the round is classified
- THEN it is classified as unpriceable

#### Scenario: A flat option with no amount does not rescue the round

- GIVEN a round with a calculated option that returned no price and a flat option whose `amount` is `null`
- WHEN the round is classified
- THEN it is classified as unpriceable

#### Scenario: An empty option list is not a classification failure

- GIVEN a round that returned zero options
- WHEN the round is classified
- THEN it is not classified as unpriceable
- AND the customer-visible state is `not_serviceable`, not `failed`

---

### Requirement: A Presentable Round Keeps the Option List Alive

`S0` · `AUTO` (selectors) + `MANUAL` (rendering)

A round classified as priced MUST NOT put the quotation into `failed`, and the option list MUST be
rendered. Per-row rules are unchanged: unpriced rows are returned, rendered without an amount, and
unselectable.

- The caller of the classification MUST NOT convert a priced-but-partial round into a quote failure.
- A cart whose only presentable option is flat MUST be purchasable **while the carrier is returning
  errors or is fully down**.

#### Scenario: A Gratis cart is purchasable while the carrier is down

- GIVEN a cart with a calculated option that cannot be priced and a flat `Gratis` option with `amount: 0`
- WHEN the quote round completes
- THEN the customer-visible quotation state is `quoted`
- AND the option list contains both rows, with `Gratis` selectable at `0` and the calculated row unpriced and unselectable
- AND the CTA does not report `shipping_method` once `Gratis` is selected

#### Scenario: Free shipping is never displayed as unpriced

- GIVEN a presentable option whose amount is `0`
- WHEN the option row is derived
- THEN its amount is `0` and it is selectable
- AND it is not treated as having no price

---

### Requirement: Unavailable Carrier Rates Are an Annotation, Not a State

`S0` · `AUTO` (selector) + `MANUAL` (rendering)

The system MUST expose, as a fact **orthogonal** to the quotation state, whether the round left one or
more calculated options without a price. The quotation state set MUST remain **exactly six values**
(`idle`, `looking_up`, `quoting`, `quoted`, `not_serviceable`, `failed`).

> **Judgement call (open question 11 resolved here).** A seventh state value was rejected: the state
> is consumed by an exhaustive switch whose contract is "exactly one on screen, and always one", so a
> seventh value touches every branch and every assertion for a fact that is not a state. "Some
> carriers did not answer" is an annotation on `quoted`.

- The annotation MUST be `true` only when the state is `quoted` **and** at least one calculated option
  in the current round has no price.
- The annotation MUST be `false` in every other state, including `failed` and `not_serviceable`.
- The rendered note MUST NOT blame the address and MUST NOT claim the destination is unserviceable.
- The note's wording MUST NOT be derived from an upstream error message. The storefront cannot
  distinguish a budget timeout from a no-coverage answer from a missing-dimensions error, so the copy
  MUST stay at the level of "live carrier rates are unavailable right now".

#### Scenario: Annotation is raised on a partially priced round

- GIVEN a `quoted` round with a priced flat option and an unpriced calculated option
- WHEN the annotation is derived
- THEN it is `true`

#### Scenario: Annotation is not raised on a fully priced round

- GIVEN a `quoted` round in which every calculated option has a price
- WHEN the annotation is derived
- THEN it is `false`

#### Scenario: Annotation is suppressed outside the quoted state

- GIVEN a round in `failed` or `not_serviceable`
- WHEN the annotation is derived
- THEN it is `false`

#### Scenario: The note renders above an otherwise normal list

- GIVEN the annotation is `true`
- WHEN the Envío section renders
- THEN it renders the option list normally plus an inline note that live carrier rates are unavailable
- AND the note does not tell the customer their address is wrong
- *(`MANUAL` — component rendering has no harness in this repo.)*

---

### Requirement: The Colonia List Survives a Lookup That Is Merely Not Needed

`S2` · `AUTO` (reducer + selector) + `STATIC` (which action the effect dispatches)

"No postal-code lookup is in flight" and "there is no colonia list to show" are **two different
facts** and MUST be expressible independently. Today they are collapsed into one action, so a
successful SEPOMEX lookup is wiped one tick later by the autosave round-trip.

- The system MUST expose a pure predicate answering whether the current postal code is **usable** —
  i.e. whether a colonia list for it could still be meaningful.
- When the postal code is not usable, clearing the lookup status MUST also clear the colonia list.
- When the postal code is usable and a lookup is simply not needed again, clearing the lookup status
  MUST leave the colonia list **and** the manual-colonia flag untouched.
- The mount guard that decides whether a lookup should be **started** MUST NOT change. It exists
  because a lookup on mount once rewrote `"CDMX"` → `"Ciudad de México"`, moved the quote signature,
  and dropped a returning customer's shipping selection.
- A SEPOMEX miss MUST continue to clear the list, MUST NOT enter `failed`, and MUST degrade to manual
  state/city entry.

#### Scenario: A found list survives the autosave round-trip

- GIVEN a lookup for a valid postal code returned colonias and the draft still holds that postal code with province and city populated
- WHEN the effect concludes no lookup is needed and dispatches the reset for a usable postal code
- THEN the lookup status becomes idle
- AND the colonia list is unchanged
- AND the manual-colonia flag is unchanged

#### Scenario: An invalid postal code clears the list

- GIVEN a colonia list is present
- WHEN the customer edits the postal code to a value that is not five digits and the reset for an unusable postal code is dispatched
- THEN the lookup status becomes idle
- AND the colonia list is empty

#### Scenario: A returning cart with a complete saved address is not re-looked-up

- GIVEN a cart loaded from the server with postal code, province, city and a saved colonia
- WHEN the mount guard is evaluated
- THEN it reports that no lookup should be started
- AND the saved colonia remains in the draft and renders as free text
- AND province and city are not rewritten

#### Scenario: A SEPOMEX miss degrades to manual entry

- GIVEN a syntactically valid postal code for which SEPOMEX returns nothing
- WHEN the miss is applied
- THEN the colonia list is empty, the status reports not-found, and the state is not `failed`
- AND the customer can complete province, city and colonia by hand

#### Scenario: The reset action carries which of the two facts it asserts

- GIVEN the working tree after this slice
- WHEN the reset dispatch sites are inspected
- THEN each site chooses its action from the usable-postal-code predicate, and no rule lives in the provider component
- *(`STATIC` — the provider is a `.tsx` and is untestable by construction.)*

---

### Requirement: A Quote Round That Started Always Reaches a Terminal State

`S1` · `AUTO` (reducer) + `STATIC` (effect)

Independently of any budget value, a quote round that began MUST always end.

- For any round, the in-flight signature MUST be released when the round concludes — success, empty
  result, error, timeout, or supersession.
- No terminal outcome may leave the quotation reporting `quoting` forever.
- A budget exhaustion MUST surface as `failed`, never as `not_serviceable`. "We could not calculate"
  and "we do not ship there" are different statements to the customer and MUST NOT be interchangeable.
- The terminal dispatch MUST remain unconditional. An early return on the cancelled path once
  permanently leaked the in-flight signature and hard-locked checkout until reload.

#### Scenario: The in-flight signature is released on every terminal outcome

- GIVEN a round started for signature S
- WHEN the round concludes with success, with zero options, or with an error
- THEN the in-flight signature no longer equals S
- AND the derived state is one of `quoted`, `not_serviceable`, `failed`

#### Scenario: A timeout is not presented as no coverage

- GIVEN a round for signature S that ended because the server budget elapsed
- WHEN the state is derived
- THEN it is `failed`
- AND it is not `not_serviceable`

#### Scenario: The terminal dispatch has no early return

- GIVEN the working tree after this slice
- WHEN the requote effect's completion path is inspected
- THEN the terminal dispatch is reached on every path, including the cancelled one
- *(`STATIC`.)*

---

## MODIFIED Requirements

### Requirement: The Quote-Relevant Address Signature Contains Exactly Five Fields

`S3` · `AUTO`
(Previously: exactly four fields — `country_code`, `postal_code`, `province`, `city` — with
`address_2` deliberately excluded.)

The system MUST expose a pure function that builds a canonical signature from **only**
`country_code`, `postal_code`, `province`, `city` and `address_2` (the colonia).

```
type QuoteRelevantAddress = {
  country_code?: string | null
  postal_code?: string | null
  province?: string | null
  city?: string | null
  address_2?: string | null      // colonia — ADDED by this change
}

buildQuoteSignature(address: QuoteRelevantAddress | null | undefined): string | null
```

> **The excluded-colonia rationale is falsified and MUST be corrected in place, not silently
> contradicted.** The recorded reasoning was that the carrier's quote path reads country, postal code,
> state and city off the destination — "no street, no colonia". Skydropx PRO returns
> `422 {"errors":{"address_to":{"area_level3":["no puede estar en blanco"]}}}`. The **street** half of
> that reasoning is untouched and stays: `address_1` remains excluded.

- It MUST return `null` when any of the five fields is absent, or when `postal_code` does not match
  `/^\d{5}$/`.
- It MUST normalize before comparison: trim, lowercase, and collapse internal whitespace runs to a
  single space. `"CIUDAD DE  MÉXICO"` and `"ciudad de méxico"` are the same destination and MUST NOT
  trigger a redundant quote.
- It MUST NOT include `address_1`.
- Changing the colonia MUST move the signature. Without this, a quote parked on a colonia-less failure
  can never be re-fired by picking a colonia, because failure parking keys on the signature.
- Field values MUST be joined with a delimiter that cannot occur in a normalized value, so that
  `{city: "a", province: "b"}` and `{city: "a|b", province: ""}` cannot collide.

#### Scenario: Five fields present produces a stable signature

- GIVEN `{ country_code: "mx", postal_code: "06700", province: "CDMX", city: "Cuauhtémoc", address_2: "Roma Norte" }`
- WHEN `buildQuoteSignature` is called twice
- THEN both calls return the same non-null string

#### Scenario: Street does not affect the signature

- GIVEN two addresses identical in the five quote-relevant fields but differing in `address_1`
- WHEN `buildQuoteSignature` is called on each
- THEN both return the same signature

#### Scenario: Changing the colonia moves the signature

- GIVEN two addresses identical except `address_2` is `"Roma Norte"` in one and `"Roma Sur"` in the other
- WHEN `buildQuoteSignature` is called on each
- THEN the two signatures differ

#### Scenario: A missing colonia yields no signature

- GIVEN `{ country_code: "mx", postal_code: "06700", province: "CDMX", city: "Cuauhtémoc", address_2: "  " }`
- WHEN `buildQuoteSignature` is called
- THEN it returns `null`
- AND the address is therefore not quotable

#### Scenario: Picking a colonia re-fires a parked failed quote

- GIVEN a quote that failed for a signature built when the colonia was present, and the customer then changes the colonia
- WHEN quote readiness is evaluated for the new draft
- THEN it returns a quote action for the new signature
- AND the previous failure does not park the new signature

#### Scenario: Case and whitespace differences do not affect the signature

- GIVEN `{ country_code: "MX", postal_code: " 06700 ", province: "CDMX", city: "Ciudad  de  México", address_2: " Roma  Norte " }`
- AND `{ country_code: "mx", postal_code: "06700", province: "cdmx", city: "ciudad de méxico", address_2: "roma norte" }`
- WHEN `buildQuoteSignature` is called on each
- THEN both return the same signature

#### Scenario: An incomplete or malformed postal code yields no signature

- GIVEN `{ country_code: "mx", postal_code: "067", province: "CDMX", city: "Cuauhtémoc", address_2: "Roma Norte" }`
- WHEN `buildQuoteSignature` is called
- THEN it returns `null`

#### Scenario: A missing city yields no signature

- GIVEN `{ country_code: "mx", postal_code: "06700", province: "CDMX", city: null, address_2: "Roma Norte" }`
- WHEN `buildQuoteSignature` is called
- THEN it returns `null`

---

### Requirement: The Missing-Requirement Catalogue Is Exhaustive and Fixed

`S3` · `AUTO`
(Previously: a nine-code catalogue with no `colonia` entry.)

The predicate MUST evaluate exactly the conditions in the table below, in the stated order, with the
stated customer-facing message. No other condition may disable the CTA. Adding, removing or reordering
an entry is a spec change.

| # | Code | Condition (all absence checks are trim-based) | Message |
|---|---|---|---|
| 0 | `cart_empty` | `cart` is null/undefined, **or** `cart.items` is absent or empty | `Tu carrito está vacío.` |
| 1 | `email` | `cart.email` absent | `Falta tu correo electrónico.` |
| 2 | `phone` | `cart.shipping_address.phone` absent | `Falta tu teléfono.` |
| 3 | `shipping_address` | `cart.shipping_address` absent, **or** any of `first_name`, `last_name`, `address_1`, `postal_code`, `city`, `province`, `country_code` absent | `Completa tu dirección de envío.` |
| 3.5 | `colonia` | `cart.shipping_address.address_2` absent | `Elige tu colonia.` |
| 4 | `billing_address` | `cart.billing_address` absent | `Falta tu dirección de facturación.` |
| 5 | `shipping_method` | `hasShippingMethod` is `false` | `Elige un método de envío.` |
| 5.5 | `shipping_method_stale` | `hasShippingMethod` is `true` **and** `selectionSignature` is non-null **and** `selectionSignature !== currentQuoteSignature` | `Vuelve a elegir el método de envío: cambiaste el código postal.` |
| 6 | `payment_method` | `selectedPaymentProviderId` absent | `Elige un método de pago.` |
| 7 | `card_details` | `selectedPaymentProviderId` is the Openpay provider **and** `paymentDetailsComplete` is `false` | `Completa los datos de tu tarjeta.` |

#### Amendment A2 — the catalogue gains a ninth code

**Landed in PR1b of `checkout-single-page-flow`.** This section previously called the eight-code
catalogue "exhaustive and fixed". It gains `shipping_method_stale` at position 5.5. This is an
amendment, not drift:

- Settled decision 8 was resolved after that document was written and makes the code load-bearing.
- **Finding F1**: there is no store API to remove a shipping method. The outcome originally asserted,
  *"THEN `cart.shipping_methods` is empty"*, is **not expressible from the storefront**.
- **Finding F2**: `updateCartWorkflow` unconditionally runs `refreshCartShippingMethodsWorkflow`,
  which silently **re-prices** a surviving method to the new destination.

The two shipping codes are **mutually exclusive**: `shipping_method` already covers "nothing chosen".
A `null` `selectionSignature` is never stale.

#### Amendment A4 — the catalogue gains a tenth code, `colonia`

**Landed in this change (S3).** Skydropx PRO rejects a quote whose destination has no `area_level3`
with `422 {"address_to":{"area_level3":["no puede estar en blanco"]}}`. A cart that reaches the CTA
without a colonia produces an order that **can never be labelled** — the exact class of failure the
`phone` rule was added for, and it gets the same treatment: its own single-field code, so the customer
is told which one control to fix instead of being sent to re-read an address that is otherwise
correct.

**This narrows what can be purchased, deliberately.** Carts mid-checkout when this lands will find the
CTA newly blocked until a colonia is picked. That is stated here, in the proposal, and must be stated
in the PR body — it is not to be discovered in production. The colonia control is the very next
control after the postal code, so the cost is seconds of human time in exchange for a request that can
actually succeed.

> **Judgement call (open question 10 resolved here).** `colonia` sits at **3.5**, immediately after
> `shipping_address`. The catalogue's order is asserted and tracks page position; the colonia control
> lives inside the address block, and a customer missing the whole address should read "complete your
> address" before "pick your colonia". Design MAY move it, but moving it is a spec change and the
> ordering assertion must move with it.

Rules that constrain the table:

- **`cart_empty` short-circuits.** When condition 0 holds, the returned list MUST contain that entry
  and nothing else.
- **`phone` is separate from `shipping_address` on purpose.** A missing phone is a single actionable
  field; folding it in would hide the exact cause of the documented Skydropx labelling incident.
- **`colonia` is separate from `shipping_address` for the same reason**, and is therefore NOT added to
  the field set that `shipping_address` checks. Both codes MAY appear together when the address is
  empty; each names a different control.
- **`card_details` is Openpay-only.**
- **Legal-text acceptance is NOT in this table.**
- **`paidByGiftCard` suppresses conditions 6 and 7 and nothing else.**
- **Format validity is NOT in this table** beyond presence.

#### Scenario: A cart with everything but a colonia reports exactly one item

- GIVEN an otherwise fully ready cart whose `shipping_address.address_2` is absent
- WHEN `getMissingOrderRequirements` is called
- THEN the returned list is exactly one entry with code `colonia` and message `Elige tu colonia.`
- AND `canPlaceOrder` returns `false`

#### Scenario: A whitespace-only colonia counts as absent

- GIVEN an otherwise fully ready cart whose `address_2` is `"  "`
- WHEN `getMissingOrderRequirements` is called
- THEN the returned list contains `colonia`

#### Scenario: Colonia is reported after the generic address item

- GIVEN a cart missing `address_1`, `address_2` and `billing_address`
- WHEN `getMissingOrderRequirements` is called
- THEN the returned codes appear in exactly this relative order: `shipping_address`, `colonia`, `billing_address`

#### Scenario: Empty cart suppresses every other message

- GIVEN a cart with `items: []`, no email, no address, no colonia and no shipping method
- WHEN `getMissingOrderRequirements` is called
- THEN the returned list is exactly one entry with code `cart_empty` and message `Tu carrito está vacío.`

#### Scenario: Openpay selected with incomplete card data

- GIVEN an otherwise fully ready cart
- AND `selectedPaymentProviderId` is the Openpay provider id
- AND `paymentDetailsComplete` is `false`
- WHEN `getMissingOrderRequirements` is called
- THEN the returned list is exactly one entry with code `card_details`

#### Scenario: Card completeness is ignored for non-Openpay providers

- GIVEN an otherwise fully ready cart
- AND `selectedPaymentProviderId` is the Mercado Pago provider id
- AND `paymentDetailsComplete` is `false`
- WHEN `getMissingOrderRequirements` is called
- THEN the returned list is `[]`

#### Scenario: A partially filled address still reports the address condition

- GIVEN a shipping address with `postal_code`, `city`, `province` and `country_code` set but `address_1` absent
- WHEN `getMissingOrderRequirements` is called
- THEN the returned list contains an entry with code `shipping_address`

#### Scenario: The disabled CTA names the colonia in actionable terms

- GIVEN a cart blocked only on the colonia
- WHEN the CTA renders
- THEN it displays `Elige tu colonia.` and nothing else
- AND it does not display a generic "complete your address" message
- *(`MANUAL` — CTA rendering has no harness in this repo.)*

---

### Requirement: The Quotation Lifecycle Has Six Customer-Visible States

`S0` · `MANUAL` (rendering) + `AUTO` (state derivation)
(Previously: the same six states, with no statement about a partially priced round and no annotation.)

The Envío section MUST render exactly one of these states, and MUST always render one. The set MUST
remain **six values**.

| State | Entered when | Customer sees |
|---|---|---|
| `idle` | No complete quote signature | `Ingresa tu código postal para ver las opciones y el costo de envío.` |
| `looking_up` | SEPOMEX request in flight | `Buscando código postal…` |
| `quoting` | A quote request is in flight | A loading state for the option list. Previously quoted prices MUST NOT remain visible as if current. |
| `quoted` | Options returned and **at least one is presentable** | The option list with real prices, none preselected after a signature change. When some calculated options have no price, the carrier-rates-unavailable note renders above the list. |
| `not_serviceable` | Options returned but the list is empty | `Todavía no llegamos a esa zona. Prueba con otro código postal.` |
| `failed` | Options returned but **none is presentable**, or the round errored or timed out | Title `No pudimos calcular el envío de este pedido.` + detail `No es por tu dirección. Puede ser algo temporal de la paquetería, o un dato que le falta a un producto de tu carrito.` (the shipped copy at `shipping-section/index.tsx:282-283`). The copy MUST NOT blame the address. Retry MUST be possible without a page reload. |

Constraints:

- A **SEPOMEX lookup failure MUST NOT enter `failed`** and MUST NOT block the section. It degrades to
  manual state/city entry; once province, city and colonia are present the signature completes and
  quoting proceeds normally.
- A quote that fails because a cart item is **missing dimensions** MUST render the `failed` message and
  MUST NOT blame the address. The failure MUST be observable to the team through logging.
- A round in which the calculated subset failed but a flat option is presentable MUST reach `quoted`,
  **not** `failed`. This is the change: a sellable free-shipping option is no longer withheld while the
  screen says shipping cannot be calculated.
- A **budget timeout MUST render `failed`, never `not_serviceable`.**
- State transitions MUST be driven by the persisted cart signature and the in-flight request, never by
  a one-shot flag.

#### Scenario: A postal code plus a colonia produces a real price

- GIVEN a cart with items that have complete dimensions
- WHEN the customer enters a valid 5-digit postal code and picks a colonia
- THEN SEPOMEX resolves state and city, the address is persisted, options are quoted, and real prices are displayed

#### Scenario: A partially priced round reaches quoted, not failed

- GIVEN a valid destination whose calculated options cannot be priced and whose flat `Gratis` option is presentable
- WHEN the round completes
- THEN the state is `quoted` and the list renders
- AND the carrier-rates-unavailable note is shown

#### Scenario: An unserviceable postal code is explained

- GIVEN a valid postal code with no serviceable shipping option
- WHEN the quote returns
- THEN the `not_serviceable` message is shown
- AND the CTA is disabled reporting `Elige un método de envío.`

#### Scenario: A dimensionless item fails without blaming the address

- GIVEN a cart containing a variant with no weight
- WHEN a quote is requested
- THEN the `failed` message is shown, the message does not attribute the failure to the address, and the failure is logged

---

## Verification summary

| Class | Requirements | How |
|---|---|---|
| `AUTO` | Round classification, presentability, the carrier-rates annotation selector, colonia retention + usable-postal-code predicate, terminal-state release in the reducer, five-field signature, catalogue with `colonia` | `pnpm --filter @dtc/storefront test` |
| `STATIC` | The reset dispatch sites choosing from the predicate; the terminal dispatch having no early return | Code inspection |
| `MANUAL` | Rendering of the carrier-rates note, the newly-blocked CTA copy, the returning-cart load path end to end | Full checkout QA pass before each slice merges |

**`sdd-verify` MUST NOT claim automated coverage of any `MANUAL` requirement.** There is no component
harness, no jsdom, and no e2e suite in this repo.

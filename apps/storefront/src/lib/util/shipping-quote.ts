/**
 * The quotation rule set: what makes a destination quotable, what makes two
 * destinations the same, and when a quote should actually be requested.
 *
 * Pure by contract (`design.md` D2): no `fetch`, no React, no server actions,
 * no `window`, no timers, no module-level mutable state. Everything here is a
 * decision; the caller owns the effects.
 */

/**
 * The five fields Skydropx's quote path actually depends on — and, deliberately,
 * nothing else.
 *
 * ## Why `address_1` is absent but `address_2` (the colonia) is present
 *
 * The two street-like fields are NOT the same case, and an earlier revision of
 * this docstring wrongly lumped them together. They are split here because the
 * evidence splits them.
 *
 * `address_1` (the street) stays excluded, and the reasoning for that is
 * untouched:
 *
 * - `explore §4` / `skydropx-fulfillment/service.ts:431-456`, `:774-840` — the
 *   carrier's quote path reads country, postal code, state and city off the
 *   destination. It does not read the street.
 * - Finding F2 (`design.md` §0) — the backend re-lists options on
 *   `country_code | province | city | postal_expression` only
 *   (`list-shipping-options-for-cart.js:200-206`). A street edit cannot change
 *   which options exist either.
 *
 * `address_2` (the colonia) is INCLUDED as of S3, because the claim that it did
 * not affect a price was falsified by production. Skydropx PRO rejects a quote
 * whose destination carries no `area_level3` with
 * `422 {"errors":{"address_to":{"area_level3":["no puede estar en blanco"]}}}`,
 * and `toAddress` maps the colonia into `area_level3`. So the colonia is a
 * quote input after all: two colonias under one postal code are two different
 * destinations to the carrier, and a colonia-less draft is not quotable.
 *
 * That is why the colonia must move the signature rather than sit outside it.
 * Failure parking keys on the signature (`selectQuoteIsBlockedByFailure`); if
 * the colonia were excluded, a quote parked on a colonia-less 422 could never be
 * re-fired by the customer finally picking a colonia — the signature would not
 * move, so the effect's deps would not change and no retry would ever run.
 *
 * Today's four near-duplicate signature helpers — `buildShippingSignature`
 * (`shipping-address/index.tsx:33-45`), `lastPrefetchedSignature` (`:90`),
 * `buildCartShippingSignature` and `hasValidPrefetch` (`shipping/index.tsx:33-45`,
 * `:88-97`) — include BOTH street fields, so a street edit still spends a live
 * carrier call for zero price change. Narrowing to these five fields (street
 * out, colonia in) is what makes R4 expressible without re-introducing that
 * waste.
 */
export type QuoteRelevantAddress = {
  country_code?: string | null
  postal_code?: string | null
  province?: string | null
  city?: string | null
  /** The colonia — `area_level3` on the wire. ADDED by S3; see the note above. */
  address_2?: string | null
}

/**
 * Mexican postal codes are exactly five digits. Anchored and un-flagged on
 * purpose: a `g` flag would carry `lastIndex` between calls and make a shared
 * exported regex answer differently on alternate invocations.
 */
export const MX_POSTAL_CODE_PATTERN = /^\d{5}$/

/**
 * Trailing-edge debounce before a quote is requested, in milliseconds.
 *
 * Preserves today's `PREFETCH_DEBOUNCE_MS` (`shipping-address/index.tsx:20`).
 * Exported here so no component repeats the literal: per F2 every persisted
 * address write triggers `refreshCartShippingMethodsWorkflow` and a live carrier
 * quote, so this number is the throttle on real outbound carrier traffic, not a
 * UI nicety.
 */
export const QUOTE_DEBOUNCE_MS = 600

/**
 * Trailing-edge debounce before a blurred field is persisted, in milliseconds.
 *
 * Deliberately shorter than {@link QUOTE_DEBOUNCE_MS}: persistence is what makes
 * a mid-form reload non-destructive (R6/S6) and should win the race against the
 * customer closing the tab. Quoting is the expensive half and can wait.
 */
export const AUTOSAVE_DEBOUNCE_MS = 400

/**
 * The delimiter joining normalized signature components.
 *
 * ASCII unit separator, and the normalizer strips every C0 control character
 * before the join. That makes the delimiter *unrepresentable inside a
 * component* by construction rather than by convention, which is the property
 * the spec asks for: field boundaries cannot be shifted by a value, so
 * `{city:"a", province:"b"}` can never collide with a single field carrying the
 * separator. A printable delimiter such as `|` or `-` is only safe until a
 * customer types it.
 */
const SIGNATURE_DELIMITER = "\u001f"

/**
 * Canonicalizes one field so that two spellings of the same destination compare
 * equal.
 *
 * Unicode normalization comes first and is not optional: "México" typed with a
 * precomposed `é` (U+00E9) and the same word with `e` + combining acute
 * (U+0065 U+0301) are different strings with identical meaning. macOS and iOS
 * keyboards disagree about which they emit, so without NFC a customer switching
 * devices re-quotes for a destination they never changed.
 */
const normalizeComponent = (value: string): string =>
  value
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()

const readComponent = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null
  }

  const normalized = normalizeComponent(value)

  return normalized.length > 0 ? normalized : null
}

/**
 * Builds a canonical, order-stable signature for a destination, or `null` when
 * the destination cannot be quoted at all.
 *
 * `null` rather than an `""` sentinel (superseding `design.md` §2): an empty
 * string is a value the join could in principle produce, so "not quotable" would
 * be distinguishable from "quotable" only by convention. `null` is
 * unrepresentable as a real signature by construction, which matters because
 * every dedupe and staleness comparison in the checkout is an equality test
 * against this value.
 */
export function buildQuoteSignature(
  address: QuoteRelevantAddress | null | undefined
): string | null {
  if (!address) {
    return null
  }

  const postalCode = readComponent(address.postal_code)

  if (!postalCode || !MX_POSTAL_CODE_PATTERN.test(postalCode)) {
    return null
  }

  const components = [
    readComponent(address.country_code),
    postalCode,
    readComponent(address.province),
    readComponent(address.city),
    // S3: the colonia (`area_level3`) is a real quote input — see the type
    // docstring. A colonia-less draft has a `null` component here and is not
    // quotable, exactly like a missing city.
    readComponent(address.address_2),
  ]

  if (components.some((component) => component === null)) {
    return null
  }

  return components.join(SIGNATURE_DELIMITER)
}

/**
 * R4: can this address be quoted yet?
 *
 * Defined AS the existence of a signature rather than as its own field-by-field
 * check, so the two can never disagree about whether a quote is possible.
 */
export function isQuotable(
  address: QuoteRelevantAddress | null | undefined
): boolean {
  return buildQuoteSignature(address) !== null
}

export type QuoteReadinessInput = {
  /** Current form state, which may be ahead of what is persisted. */
  draftAddress: QuoteRelevantAddress | null | undefined
  /** Signature of the most recent request that SUCCEEDED. */
  lastRequestedSignature: string | null
  /** Signature of a request currently running. */
  inFlightSignature: string | null
  cartId: string | null | undefined
}

export type QuoteDecision =
  | { action: "idle"; reason: "incomplete_address" | "no_cart" }
  | { action: "skip"; reason: "already_quoted" | "already_in_flight" }
  | { action: "quote"; signature: string; supersedes: string | null }

/**
 * Decides whether a quote should be requested. Decides only — it does not
 * perform the request, start a timer or touch the network.
 *
 * The five rules are ordered, and the order is part of the contract:
 *
 * 1. no cart → `idle`/`no_cart`. Nothing can be quoted against nothing, and
 *    this outranks address completeness so a complete address on a dead cart
 *    reports the real reason rather than a misleading one.
 * 2. no signature → `idle`/`incomplete_address`.
 * 3. signature already in flight → `skip`/`already_in_flight`. Ahead of the
 *    dedupe below, because a request that is running has not produced a
 *    `lastRequestedSignature` yet; checking dedupe first would let a duplicate
 *    through on every re-render while the first request is open.
 * 4. signature already quoted → `skip`/`already_quoted`.
 * 5. otherwise quote, `supersedes` naming whatever different request is open.
 *
 * `supersedes` is the caller's abort instruction: latest input wins, and a stale
 * response must never overwrite a newer quote.
 *
 * ## Retryability, which is a product guarantee and not an implementation detail
 *
 * `lastRequestedSignature` advances on SUCCESS only. That is what makes the
 * `failed` state recoverable without a page reload: after a failure the same
 * address still produces `quote`, so re-entering the same postal code retries
 * instead of silently doing nothing. If a caller ever advances it on failure,
 * the customer is stranded with an error and no way to clear it.
 */
export function evaluateQuoteReadiness(
  input: QuoteReadinessInput
): QuoteDecision {
  if (!input.cartId) {
    return { action: "idle", reason: "no_cart" }
  }

  const signature = buildQuoteSignature(input.draftAddress)

  if (signature === null) {
    return { action: "idle", reason: "incomplete_address" }
  }

  if (signature === input.inFlightSignature) {
    return { action: "skip", reason: "already_in_flight" }
  }

  if (signature === input.lastRequestedSignature) {
    return { action: "skip", reason: "already_quoted" }
  }

  return { action: "quote", signature, supersedes: input.inFlightSignature }
}

/**
 * The shape `classifyQuoteResult` reads off an option. Structural rather than
 * `HttpTypes.StoreCartShippingOption` so this module keeps depending on the two
 * fields it actually looks at.
 */
export type QuotedOption = {
  id: string
  price_type?: string | null
  /**
   * ADDED (S0). A flat option carries its own amount and is never routed through
   * `calculatePriceForShippingOption`, so the price map says nothing about it.
   * Optional and structural: `HttpTypes.StoreCartShippingOption` already has this
   * field, so the CALL SITE passes `options` verbatim and does not change.
   */
  amount?: number | null
}

/**
 * The single definition of "does this row carry a price the customer can be
 * shown". A calculated option is priced by the quote round (its amount lives in
 * the price map); every other option carries its own `amount`.
 *
 * `Number.isFinite`, never truthiness: free shipping quotes `0`, and `0` is
 * falsy. A truthy check once hid a free `Gratis` option in production — this
 * function exists so the classifier and the row renderer can never disagree
 * about it again.
 */
export function readPresentableAmount(
  option: QuotedOption,
  prices: Readonly<Record<string, number | null | undefined>>
): number | null {
  const raw =
    option.price_type === "calculated" ? prices[option.id] : option.amount

  return typeof raw === "number" && Number.isFinite(raw) ? raw : null
}

/**
 * What a completed quote round actually produced.
 *
 * `"priced"` — the result is presentable. `"unpriceable"` — the backend returned
 * calculated options and not one of them came back with an amount.
 */
export type QuoteResultClass = "priced" | "unpriceable"

/**
 * Edge case 3: separates "we could not price this order" from "we do not ship
 * there", which read identically on the wire and must never read identically to
 * the customer.
 *
 * ## The two failures this tells apart, and why the difference is not cosmetic
 *
 * `buildParcel` throws `MissingDimensionsError` BEFORE any carrier call when any
 * cart item has no weight or no L/W/H (`explore §4`, `parcel.ts:49-79`). That
 * surfaces as `INVALID_DATA`, and `calculatePriceForShippingOption` swallows it
 * and returns `null` (`lib/data/fulfillment.ts`). So the storefront sees a
 * non-empty option list — the address IS serviceable, the backend said so by
 * returning options for it — in which every calculated price is missing.
 *
 * That is a CATALOGUE data problem. The customer cannot fix it, and re-typing a
 * postal code that was correct all along will never help. An empty option list
 * is the opposite: the address is the answer, and it is `not_serviceable`
 * (derived downstream from the option count — see `selectQuoteStatus`).
 *
 * Get this backwards and the storefront tells a customer their address is wrong
 * when the product data is.
 *
 * ## Why it is here and not inline at its call site
 *
 * Its call site is the requote effect in `checkout-context.tsx`, and this repo's
 * harness is node-only — no jsdom, no `@testing-library`, Playwright an explicit
 * non-goal — so a rule left inside that `.tsx` is a rule nothing can contradict.
 * It arrived there as a two-term boolean, which is exactly the size of expression
 * that looks too small to extract right up until it is the thing deciding which
 * of two contradictory sentences a customer reads.
 *
 * ## What counts, and why flat options now count too (S0)
 *
 * The round is classified by asking "is ANY option in the list presentable?",
 * via {@link readPresentableAmount} — a calculated option's returned price OR a
 * flat option's own finite `amount`. An earlier revision judged only the
 * calculated subset, so a cart carrying an unpriceable calculated `Expres`
 * beside a flat `Gratis` at `amount: 0` classified `unpriceable` and BOTH rows
 * vanished — a sellable free-shipping option withheld while the screen said
 * shipping could not be calculated. A presentable flat option now rescues the
 * round, and an all-flat list whose every amount is `null` is `unpriceable`
 * rather than falsely `priced`.
 *
 * @see `modules/checkout/state/checkout-context.tsx` — dispatches `QUOTE_FAILED`
 * on `"unpriceable"`.
 * @see `modules/checkout/components/shipping-section/index.tsx` — renders the
 * `failed` copy this decides on.
 */
export function classifyQuoteResult(input: {
  options: readonly QuotedOption[]
  /**
   * `number | null | undefined` and not `number`, because a price that came back
   * absent is the whole signal this function reads. An earlier revision typed it
   * `number` and the call site satisfied that type with `amount ?? 0` — which
   * laundered every missing price into free shipping one line before this
   * function could ever see it, and made the `Number.isFinite` care below
   * unreachable. The type now refuses that call site.
   */
  prices: Readonly<Record<string, number | null | undefined>>
}): QuoteResultClass {
  if (input.options.length === 0) {
    // An empty list is `not_serviceable` downstream (from the option count),
    // never `failed`.
    return "priced"
  }

  /**
   * Matched per option rather than by counting the map. The map is built from a
   * `Promise.allSettled` fan-out and a key left over from an earlier round would
   * otherwise rescue a list none of whose options were priced.
   *
   * `Number.isFinite` and not truthiness (inside {@link readPresentableAmount}):
   * free shipping quotes `0`, and `0` is falsy. The component this was extracted
   * from used a truthy check and therefore rendered a free option as having no
   * price at all.
   */
  return input.options.some(
    (option) => readPresentableAmount(option, input.prices) !== null
  )
    ? "priced"
    : "unpriceable"
}

/**
 * Settled decision 1: is a chosen shipping method bound to a destination the
 * customer has since moved away from?
 *
 * ## Why this rule exists at all, given F1 and F2
 *
 * The proposal asked for the shipping method to be REMOVED from the cart when
 * the quote signature changes. Finding F1 (`design.md` §0) proves that is not
 * expressible from the storefront: `POST /store/carts/:id/shipping-methods` is
 * replace-all and has no `DELETE`, `StoreUpdateCart` carries no
 * `shipping_methods` key, and the only path to `removeShippingMethodFromCartStep`
 * requires a replacement option id — precisely the auto-pick decision 1 forbids.
 *
 * Finding F2 makes doing nothing unacceptable: `updateCartWorkflow` runs
 * `refreshCartShippingMethodsWorkflow` on every address write, which silently
 * RE-PRICES a still-valid method to the new destination. Left alone, the
 * customer's total changes under them without a word.
 *
 * So the invalidation is client-side: the selection is marked stale, the CTA
 * blocks on `shipping_method_stale`, and the customer re-picks. The product
 * outcome decision 1 asked for is unchanged; only the mechanism differs.
 *
 * ## The asymmetry
 *
 * A `null` SELECTION signature is never stale — a method chosen before any
 * signature existed (a returning cart, before the client has derived one) is
 * not evidence that anything moved, and reporting it as stale would block an
 * order the customer cannot unblock. A `null` CURRENT signature IS stale: the
 * address stopped being quotable while a priced selection is still on screen,
 * so that price belongs to a destination that is no longer the destination.
 *
 * ## The seam is closed as of PR2b
 *
 * This export shipped in PR1b with no callers at all, which was a recorded
 * decision rather than an oversight. Both consumers now exist, and the sentence
 * that used to say "it does not exist yet" is gone rather than left to rot — a
 * docstring describing a state of the world that has moved on is how this change
 * has already lost two review cycles.
 *
 * @see `modules/checkout/state/checkout-reducer.ts` — PR2a. Clears
 * `selectedShippingOptionId` in the same transition that recomputes
 * `quoteSignature`, and `selectShippingIsProvisional` routes the summary's
 * provisional state through the CTA catalogue rather than through a second call
 * to this function.
 * @see `modules/checkout/components/shipping-section/index.tsx` — PR2b. Renders
 * the cleared radio group.
 */
export function isShippingSelectionStale(
  selectionSignature: string | null,
  currentSignature: string | null
): boolean {
  if (selectionSignature === null) {
    return false
  }

  return selectionSignature !== currentSignature
}

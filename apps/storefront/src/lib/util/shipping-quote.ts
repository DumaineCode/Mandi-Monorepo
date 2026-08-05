/**
 * The quotation rule set: what makes a destination quotable, what makes two
 * destinations the same, and when a quote should actually be requested.
 *
 * Pure by contract (`design.md` D2): no `fetch`, no React, no server actions,
 * no `window`, no timers, no module-level mutable state. Everything here is a
 * decision; the caller owns the effects.
 */

/**
 * The four fields Skydropx's `calculatePrice` actually requires on the
 * destination — and, deliberately, nothing else.
 *
 * ## Why `address_1` / `address_2` are absent, and why that is the change
 *
 * Two independent pieces of evidence say the street cannot move a price:
 *
 * - `explore §4` / `skydropx-fulfillment/service.ts:431-456`, `:774-840` — the
 *   carrier's quote path reads country, postal code, state and city off the
 *   destination. No street, no colonia, no name, no phone.
 * - Finding F2 (`design.md` §0) — the backend re-lists options on
 *   `country_code | province | city | postal_expression` only
 *   (`list-shipping-options-for-cart.js:200-206`). A street edit cannot change
 *   which options exist either.
 *
 * Today's four near-duplicate signature helpers — `buildShippingSignature`
 * (`shipping-address/index.tsx:33-45`), `lastPrefetchedSignature` (`:90`),
 * `buildCartShippingSignature` and `hasValidPrefetch` (`shipping/index.tsx:33-45`,
 * `:88-97`) — DO include both street fields. Two consequences, both bad:
 *
 * 1. no quote is ever requested until the customer has typed a street they have
 *    no reason to believe affects shipping. That is the self-imposed gate R4
 *    removes, and it is why a postal code alone shows no price today;
 * 2. every street edit invalidates the signature and re-quotes, which under F2
 *    means a live carrier call for zero price change.
 *
 * Narrowing the field set is therefore not a simplification. It is the single
 * change that makes R4 expressible.
 */
export type QuoteRelevantAddress = {
  country_code?: string | null
  postal_code?: string | null
  province?: string | null
  city?: string | null
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
 * @see `modules/checkout/state/checkout-reducer.ts` — PR2a. The reducer clears
 * `selectedShippingOptionId` in the same transition that recomputes
 * `quoteSignature`. It does not exist yet; this export is deliberately
 * unconsumed in PR1b (see the PR description, "Deliberately unconsumed in this
 * PR").
 * @see `modules/checkout/components/shipping-section/index.tsx` — PR2b. Renders
 * the cleared radio group and the provisional-total state.
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

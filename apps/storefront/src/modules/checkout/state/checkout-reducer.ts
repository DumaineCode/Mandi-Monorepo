import {
  PERSISTABLE_ADDRESS_FIELDS,
  type CheckoutDraftAddress,
} from "@lib/util/cart-address-payload"
import {
  getMissingOrderRequirements,
  toReadinessInput,
  type MissingRequirement,
  type OrderReadinessInput,
} from "@lib/util/checkout-readiness"
import {
  buildQuoteSignature,
  isShippingSelectionStale,
  MX_POSTAL_CODE_PATTERN,
  readPresentableAmount,
  type QuoteRelevantAddress,
} from "@lib/util/shipping-quote"
import type { HttpTypes } from "@medusajs/types"

/**
 * The single-page checkout's state machine.
 *
 * ## Why this is a reducer in its own file, and not `useState` in a component
 *
 * The three sections are not independent. A postal-code edit in *Datos* must
 * invalidate the selection in *Envío* and re-evaluate the CTA in *Pago*. That is
 * ONE transition, and a reducer expresses it as one `case`.
 *
 * The code this replaces fought the same coupling with a cascade of `useRef`
 * mirrors, each patching the previous one's ordering bug:
 *
 * - `hydratedRef` (`shipping-address/index.tsx:83`) — a one-shot lockout so a
 *   background cart refresh could not overwrite the field the customer was
 *   typing in;
 * - `lastPrefetchedSignature` (`:90`) — a dedupe guard that had to agree
 *   EXACTLY with `hasValidPrefetch` in a different file (`shipping/index.tsx:88`)
 *   or the prefetch was silently discarded;
 * - `initiatedDefaultRef` (`payment/index.tsx:186`) — a one-shot init guard that
 *   could not re-fire after Medusa destroyed the session on a total change;
 * - the `AbortController` + `cancelled` + `lastPrefetchedSignature` triad
 *   (`shipping-address/index.tsx:307-370`) — three overlapping cancellation
 *   mechanisms for one rule.
 *
 * Centralising the transition is what REMOVES that class of bug rather than
 * relocating it: every ordering rule below is a pure function of the previous
 * state and one action, so it can be asserted instead of reasoned about. That is
 * the point — in a codebase with no jsdom, no `@testing-library` and no
 * Playwright (all explicit non-goals), a rule left inside a `.tsx` is a rule
 * nothing verifies.
 *
 * Pure by contract: no `fetch`, no React, no server actions, no `window`, no
 * timers, no module-level mutable state. The effects live in
 * `checkout-context.tsx`; this file only decides.
 */

export type AddressField = (typeof PERSISTABLE_ADDRESS_FIELDS)[number]

/** The draft the customer is editing. Always strings — this is form state. */
export type AddressDraft = Record<AddressField, string>

/**
 * The six customer-visible quotation states from the spec.
 *
 * These names supersede `design.md` D1's `incomplete | loading | ready |
 * unserviceable`: per reconciliation RC-1 the spec owns the WHAT, and these are
 * the states the Envío section renders.
 *
 * Derived, never stored — see {@link selectQuoteStatus}. A stored copy is a
 * second source of truth that drifts from the facts it summarises.
 */
export type QuoteStatus =
  | "idle"
  | "looking_up"
  | "quoting"
  | "quoted"
  | "not_serviceable"
  | "failed"

/**
 * SEPOMEX lookup status. Internal: `looking_up` is derived from it and
 * `not_found` is NOT a quote failure — a postal-code lookup that comes back
 * empty degrades to manual state/city entry and must never block the section.
 */
export type CpStatus = "idle" | "loading" | "found" | "not_found"

export type AutosaveStatus = "idle" | "saving" | "saved" | "error"

export type CheckoutState = {
  /**
   * Server-owned, replaced by the cart every mutating action returns.
   *
   * `router.refresh()` is deliberately not used for in-flight mutations (D1):
   * it re-runs the whole RSC chain, which is the cost the single-page checkout
   * exists to remove, and `retrieveCart` is `force-cache` with a possibly-empty
   * tag so the refresh is not even reliably fresh.
   */
  cart: HttpTypes.StoreCart | null
  shippingOptions: HttpTypes.StoreCartShippingOption[]

  /** Client is the source of truth for the draft once the customer types. */
  draft: AddressDraft
  email: string
  billingDraft: AddressDraft
  sameAsBilling: boolean
  shippingAddressId: string | null
  billingAddressId: string | null

  /** Bumped on every blur. The autosave effect debounces off this. */
  blurSequence: number
  /** Highest write sequence ISSUED. See the supersession note below. */
  issuedWriteSequence: number
  /** Highest write sequence whose response has been APPLIED. */
  appliedWriteSequence: number
  autosaveStatus: AutosaveStatus

  /** Signature of the draft as it stands now. */
  quoteSignature: string | null
  /** Signature the held options and prices belong to. Advances on SUCCESS only. */
  quotedSignature: string | null
  /** Signature of a quote currently running. */
  inFlightSignature: string | null
  /** Signature of the most recent FAILED attempt. Gates the auto-retry. */
  failedSignature: string | null
  /**
   * `number | null` deliberately. A calculated option whose price came back
   * absent must stay absent all the way to {@link selectShippingChoices}, which
   * renders it unselectable. Collapsing it to `0` upstream would present it as
   * free shipping and let the order be placed with none.
   */
  calculatedPrices: Record<string, number | null>
  cpStatus: CpStatus
  colonias: string[]
  /**
   * The postal code the held {@link colonias} list was FETCHED for, or `null`
   * when no list is held.
   *
   * A colonia list is only meaningful for the postal code it was fetched under.
   * On the B -> A -> B path — cart holds B, customer types A, the lookup returns
   * A's list and overwrites province/city, customer types back to B — the mount
   * guard declines (postal matches the cart, province/city non-empty) so the
   * list is never refreshed, and without this field a naive reset split would
   * keep A's colonias under postal code B. Combined with the carrier accepting
   * any colonia string, the shopper could pick a colonia that does not exist for
   * B and the order would only fail at labelling. {@link selectPostalCodeIsUsable}
   * reads this to reject that case.
   */
  coloniasPostalCode: string | null
  coloniaManual: boolean

  selectedShippingOptionId: string | null
  /** Signature in force at the moment the option was picked. */
  selectionSignature: string | null

  /** @see `modules/checkout/components/payment-section` — PR2c. */
  selectedPaymentProviderId: string | null
  /** @see `modules/checkout/components/payment-section` — PR2c. */
  paymentDetailsComplete: boolean

  /**
   * Whether `placeOrderFlow` is mid-attempt.
   *
   * A UI affordance, not the re-entrancy guard. The flow keeps its own
   * synchronous flag, because this one is read through the provider's
   * `stateRef`, which is assigned in an effect and therefore lags by one
   * commit — two clicks inside the same commit would both see `false`. Ordering
   * a second charge is not an acceptable outcome of a double click, so the
   * authoritative guard lives where it can be synchronous.
   *
   * @see `modules/checkout/state/place-order-flow.ts`
   * @see `modules/checkout/components/place-order-bar` — PR2c slice 2.
   */
  placingOrder: boolean

  error: string | null
}

export type CheckoutInit = {
  cart: HttpTypes.StoreCart | null
  customer: HttpTypes.StoreCustomer | null
  shippingOptions: HttpTypes.StoreCartShippingOption[] | null
}

export type CheckoutAction =
  | { type: "FIELD_CHANGE"; field: AddressField | "email"; value: string }
  | { type: "FIELD_BLUR"; field: AddressField | "email"; value: string }
  | {
      type: "ADDRESS_PREFILL"
      address: Partial<Record<AddressField, string | null>>
      email?: string | null
    }
  | { type: "BILLING_FIELD_CHANGE"; field: AddressField; value: string }
  | { type: "TOGGLE_SAME_AS_BILLING" }
  | { type: "CP_LOOKUP_STARTED" }
  | {
      type: "CP_LOOKUP_FOUND"
      /**
       * The postal code this lookup was REQUESTED for.
       *
       * Required, not optional, and the reason the action exists in this shape: the
       * reducer is the only place that can tell a current result from a stale one,
       * and without this field it was structurally incapable of doing so. See
       * {@link isStalePostalCodeLookup}.
       */
      postalCode: string
      province: string
      city: string
      colonias: string[]
    }
  | { type: "CP_LOOKUP_NOT_FOUND"; postalCode: string }
  | { type: "CP_LOOKUP_NOT_NEEDED" }
  | { type: "CP_LOOKUP_DISCARDED" }
  | { type: "COLONIA_MANUAL_REQUESTED" }
  | { type: "CART_WRITE_STARTED"; sequence: number }
  | { type: "CART_WRITE_FAILED"; sequence: number }
  | { type: "CART_UPDATED"; cart: HttpTypes.StoreCart; sequence: number }
  | { type: "QUOTE_STARTED"; signature: string }
  | {
      type: "QUOTE_READY"
      signature: string
      options: HttpTypes.StoreCartShippingOption[]
      prices: Record<string, number | null>
    }
  | { type: "QUOTE_FAILED"; signature: string }
  | { type: "QUOTE_RETRY" }
  | {
      type: "SELECT_SHIPPING_OPTION"
      optionId: string
      /**
       * The quote signature as it was WHEN THE CUSTOMER CLICKED, captured by the
       * component before it awaits the round trip. Required, not optional: the
       * caller is the only party that knows which destination the price on the
       * row belonged to.
       */
      signature: string | null
    }
  | { type: "SELECT_PAYMENT_PROVIDER"; providerId: string }
  | { type: "SET_PAYMENT_DETAILS_COMPLETE"; complete: boolean }
  | { type: "PLACE_ORDER_STARTED" }
  | {
      type: "PLACE_ORDER_SETTLED"
      /**
       * Required, not optional. Every tail has to say explicitly whether it is
       * reporting a failure or standing down cleanly — `undefined` meaning "no
       * error" is how a tail that forgot to pass anything ends up looking like
       * a success.
       */
      error: string | null
    }
  | { type: "SET_ERROR"; error: string | null }

const draftFromAddress = (
  address?: Partial<Record<AddressField, string | null>> | null
): AddressDraft =>
  PERSISTABLE_ADDRESS_FIELDS.reduce((acc, field) => {
    acc[field] = address?.[field] ?? ""
    return acc
  }, {} as AddressDraft)

/**
 * The quote-relevant projection of a draft: the FIVE fields that can move a
 * price, and nothing else.
 *
 * There is no companion `isQuoteRelevant(field)` predicate, deliberately. A
 * separate list of "which fields matter" would be a second copy of this
 * projection, and the two would have to agree exactly — which is precisely the
 * failure the four near-duplicate signature helpers this change deletes were
 * built out of (`buildShippingSignature`, `lastPrefetchedSignature`,
 * `buildCartShippingSignature`, `hasValidPrefetch`). Instead, every draft change
 * recomputes the signature through this projection and compares the RESULT: a
 * field is quote-relevant if and only if changing it moves the signature. One
 * definition, and it cannot drift from itself.
 *
 * `address_2` (the colonia) is projected as of S3: Skydropx maps it to
 * `area_level3` and rejects a quote without it, so it is a real quote input and
 * the draft must carry it into the signature (see `shipping-quote.ts`).
 * `address_1` (the street) is still excluded — it cannot move a price.
 */
export const selectQuoteRelevantAddress = (
  draft: AddressDraft
): QuoteRelevantAddress => ({
  postal_code: draft.postal_code,
  city: draft.city,
  province: draft.province,
  country_code: draft.country_code,
  address_2: draft.address_2,
})

/**
 * Applies a draft change and, when the destination moved, everything that has
 * to move WITH it — in one transition.
 *
 * ## The invalidation rule, and the thing that is easy to get wrong
 *
 * When the signature changes and a selection was made under the old one, the
 * selected option id is cleared so no radio is checked (settled decision 1).
 *
 * `selectionSignature` is deliberately NOT cleared. Per finding F1 there is no
 * store API to remove a shipping method, so `cart.shipping_methods` still holds
 * the row and `toReadinessInput` still reports `hasShippingMethod: true`. Since
 * `isShippingSelectionStale(null, sig)` is documented to be `false`, clearing the
 * signature would leave the CTA enabled against a superseded quote on the
 * ORDINARY A -> B path — the exact failure the whole mechanism exists to prevent.
 *
 * Keeping it is necessary but was not sufficient, and the gap is worth stating
 * because it is invisible from this transition alone. A signature can return to a
 * value it held before; a cleared selection cannot. On A -> B -> A the signature
 * comes back to A, `isShippingSelectionStale(A, A)` answers `false` again, and
 * the cleared radio becomes invisible to the staleness comparison. So
 * `getMissingOrderRequirements` gates on the CLIENT SELECTION as well — see the
 * `shipping_method_stale` branch in `lib/util/checkout-readiness.ts`. This
 * transition clearing `selectedShippingOptionId` is what feeds that gate; the two
 * halves are one rule and neither works alone.
 *
 * Prices are dropped because a price quoted for the previous destination is not
 * a stale number, it is the WRONG number. The options list is kept: it is
 * address-filtered too, but {@link selectQuoteStatus} reports `quoting` while
 * `quotedSignature` lags, so it is never presented as current.
 */
/**
 * Stamped on a restored selection whose destination cannot be reconstructed.
 *
 * Not a real signature and never equal to one: `buildQuoteSignature` returns
 * either a joined address projection or `null`, so nothing can collide with
 * this. Its only job is to make {@link isShippingSelectionStale} answer `true`
 * for a selection we cannot vouch for.
 */
export const UNKNOWN_SELECTION_SIGNATURE = "__selection_signature_unknown__"

const commitDraft = (
  state: CheckoutState,
  next: { draft?: AddressDraft; email?: string }
): CheckoutState => {
  const draft = next.draft ?? state.draft
  const email = next.email ?? state.email
  const quoteSignature = buildQuoteSignature(selectQuoteRelevantAddress(draft))

  /**
   * W7: while the checkbox is on, the billing draft MIRRORS the shipping draft
   * rather than being copied across at the moment it is turned off.
   *
   * `sameAsBilling === true` is a claim that the two addresses are the same, so
   * a `billingDraft` holding anything else is state that contradicts the flag
   * stored next to it. Mirroring on every commit makes the claim true by
   * construction, and that is what makes unchecking the box hand the customer a
   * PREFILLED form instead of the empty one they used to get after typing a full
   * address.
   */
  const billingDraft = state.sameAsBilling ? draft : state.billingDraft

  if (quoteSignature === state.quoteSignature) {
    return { ...state, draft, email, billingDraft }
  }

  return {
    ...state,
    draft,
    email,
    billingDraft,
    quoteSignature,
    calculatedPrices: {},
    /**
     * MAJ-2: `quotedSignature` MUST be cleared alongside `calculatedPrices` —
     * they describe the SAME quote round, so dropping one without the other is
     * incoherent. Before S3 this was a rare postal A->B->A debounce race; with
     * the colonia now in the signature a colonia X->Y->X is two clicks, and
     * leaving `quotedSignature` at the returning value would make
     * {@link selectQuoteStatus} report `quoted` with every row unpriced
     * (`calculatedPrices === {}`), no retry, and S0's carrier-rates note firing
     * falsely. Clearing it forces a fresh quote for the returned-to destination.
     */
    quotedSignature: null,
    // A new destination deserves a fresh attempt: the previous failure was
    // about an address the customer has moved away from.
    failedSignature: null,
    selectedShippingOptionId: isShippingSelectionStale(
      state.selectionSignature,
      quoteSignature
    )
      ? null
      : state.selectedShippingOptionId,
  }
}

const withField = (
  state: CheckoutState,
  field: AddressField | "email",
  value: string
): CheckoutState =>
  field === "email"
    ? commitDraft(state, { email: value })
    : commitDraft(state, { draft: { ...state.draft, [field]: value } })

export function initFromServer(init: CheckoutInit): CheckoutState {
  const cart = init.cart
  const draft = draftFromAddress(
    cart?.shipping_address as Partial<
      Record<AddressField, string | null>
    > | null
  )
  const quoteSignature = buildQuoteSignature(selectQuoteRelevantAddress(draft))
  const selectedShippingOptionId =
    cart?.shipping_methods?.at(-1)?.shipping_option_id ?? null

  /**
   * Defaults to true, matching the checkbox the four-step flow shipped with.
   * A returning cart whose two addresses already differ is respected.
   */
  const sameAsBilling = !cart?.billing_address
    ? true
    : PERSISTABLE_ADDRESS_FIELDS.every(
        (field) =>
          (cart?.billing_address?.[field] ?? "") ===
          (cart?.shipping_address?.[field] ?? "")
      )

  return {
    cart: cart ?? null,
    shippingOptions: init.shippingOptions ?? [],

    draft,
    email: cart?.email ?? init.customer?.email ?? "",
    /**
     * W7: seeded from the shipping draft when the addresses are the same, so the
     * mirror invariant holds on the very first render — a cart with no billing
     * address used to seed this all-empty, which is the state that produced an
     * empty billing form the moment the customer unchecked the box.
     */
    billingDraft: sameAsBilling
      ? draft
      : draftFromAddress(
          cart?.billing_address as Partial<
            Record<AddressField, string | null>
          > | null
        ),
    sameAsBilling,
    shippingAddressId: cart?.shipping_address?.id ?? null,
    billingAddressId: cart?.billing_address?.id ?? null,

    blurSequence: 0,
    issuedWriteSequence: 0,
    appliedWriteSequence: 0,
    autosaveStatus: "idle",

    quoteSignature,
    quotedSignature: null,
    inFlightSignature: null,
    failedSignature: null,
    calculatedPrices: {},
    cpStatus: "idle",
    colonias: [],
    coloniasPostalCode: null,
    coloniaManual: false,

    selectedShippingOptionId,
    /**
     * A selection restored from a returning cart is NOT stale: it was made
     * against the address that is still on the cart. Seeding it with the derived
     * signature says exactly that, and `isShippingSelectionStale` then reports
     * `false` until the customer actually changes the destination.
     *
     * The third case is the one that bites. When the persisted address is not
     * QUOTABLE — no province, no city, a postal code that is not five digits,
     * which is the legacy and `AddressSelect` cohort the phone incident docstring
     * records — `quoteSignature` is `null` while the cart still carries a shipping
     * method. Seeding `null` there reads as "no selection to compare", and
     * `isShippingSelectionStale(null, …)` answers `false` FOREVER: no later
     * postal-code change can ever clear that radio, `shipping_method_stale` can
     * never fire, and the backend's silent re-pricing (finding F2) reaches the
     * summary as a final total the customer never agreed to.
     *
     * A selection whose provenance is unknown is not fresh, it is suspect.
     */
    selectionSignature: selectedShippingOptionId
      ? quoteSignature ?? UNKNOWN_SELECTION_SIGNATURE
      : null,

    selectedPaymentProviderId: null,
    paymentDetailsComplete: false,
    placingOrder: false,

    error: null,
  }
}

/**
 * Whether a SEPOMEX result belongs to a postal code the customer has since left.
 *
 * ## Why this lives here and not in the effect's cleanup
 *
 * It used to be a `cancelled` flag closed over by the lookup effect, set from the
 * cleanup function. That flag could not distinguish "the customer moved on" from
 * "React re-ran this effect for some other reason" — and the effect's dep array
 * includes `cart.shipping_address.postal_code`, which MOVES on the very autosave
 * the lookup itself arms. So the routine sequence "type a postal code, blur,
 * autosave persists it" re-ran the effect, cancelled the open lookup, and then
 * early-returned on the dedupe ref because the postal code had not actually
 * changed. Nothing was ever dispatched, `cpStatus` stayed `"loading"`, and
 * `selectQuoteStatus` short-circuits on `"loading"` ahead of every other rule —
 * the order could not be placed until the page was reloaded.
 *
 * Two guards owned one decision and disagreed. The dedupe ref legitimately guards
 * an EXTERNAL CALL (do not ask SEPOMEX the same question twice); staleness is a
 * STATE TRANSITION and belongs here, where a spec can contradict it.
 *
 * Compared against the DRAFT rather than the cart: the draft is what the effect
 * read when it issued the request and what the customer is looking at. Trimmed on
 * both sides because the effect trims before dispatching and the draft may not be.
 */
const isStalePostalCodeLookup = (
  state: CheckoutState,
  postalCode: string
): boolean => postalCode.trim() !== state.draft.postal_code.trim()

export function checkoutReducer(
  state: CheckoutState,
  action: CheckoutAction
): CheckoutState {
  switch (action.type) {
    case "FIELD_CHANGE":
      return withField(state, action.field, action.value)

    case "FIELD_BLUR": {
      const committed = withField(state, action.field, action.value)
      return { ...committed, blurSequence: state.blurSequence + 1 }
    }

    case "ADDRESS_PREFILL": {
      const draft = PERSISTABLE_ADDRESS_FIELDS.reduce((acc, field) => {
        acc[field] = action.address[field] ?? ""
        return acc
      }, {} as AddressDraft)

      const committed = commitDraft(state, {
        draft,
        email: action.email ?? state.email,
      })

      return { ...committed, blurSequence: state.blurSequence + 1 }
    }

    case "BILLING_FIELD_CHANGE":
      return {
        ...state,
        billingDraft: { ...state.billingDraft, [action.field]: action.value },
      }

    case "TOGGLE_SAME_AS_BILLING": {
      const sameAsBilling = !state.sameAsBilling

      /**
       * Turning it back ON re-adopts the shipping draft, so the mirror invariant
       * holds from the moment the flag flips rather than from the next keystroke.
       * Turning it OFF keeps whatever the mirror last wrote, which IS the
       * prefilled billing form the customer expects to edit.
       */
      return {
        ...state,
        sameAsBilling,
        billingDraft: sameAsBilling ? state.draft : state.billingDraft,
      }
    }

    case "CP_LOOKUP_STARTED":
      return { ...state, cpStatus: "loading" }

    case "CP_LOOKUP_FOUND": {
      /**
       * Dropped WHOLE when it is stale — not merged, not partially applied. The
       * postal code is authoritative for province and city, so applying a late
       * answer would stamp one destination's state and city onto another's postal
       * code and quote a place that does not exist.
       *
       * `cpStatus` is deliberately left untouched here. If this result is stale
       * the draft has moved, and the effect has either started a lookup for the
       * new postal code (so `"loading"` is honest) or dispatched one of the
       * lookup resets (`CP_LOOKUP_NOT_NEEDED` / `CP_LOOKUP_DISCARDED`, so
       * `"idle"` is). Either way there is nothing for this
       * branch to correct.
       */
      if (isStalePostalCodeLookup(state, action.postalCode)) {
        return state
      }

      /**
       * The postal code is authoritative for state and city, so it overwrites
       * them. This is also what makes R4 work: a customer who types five digits
       * and nothing else ends up with a complete quote signature.
       */
      const committed = commitDraft(state, {
        draft: {
          ...state.draft,
          province: action.province || state.draft.province,
          city: action.city || state.draft.city,
        },
      })

      const keptColonia = committed.draft.address_2

      return {
        ...committed,
        cpStatus: "found",
        colonias: action.colonias,
        /**
         * The list belongs to the postal code the draft now holds. Stored
         * trimmed so {@link selectPostalCodeIsUsable} can compare it against the
         * trimmed draft postal code without a normalization mismatch.
         */
        coloniasPostalCode: committed.draft.postal_code.trim(),
        /**
         * A colonia the customer already has that is not in the returned list
         * (typically from a saved address) survives as free text instead of
         * being silently wiped.
         */
        coloniaManual:
          keptColonia !== "" && !action.colonias.includes(keptColonia),
        blurSequence: state.blurSequence + 1,
      }
    }

    case "CP_LOOKUP_NOT_FOUND":
      /**
       * Stale misses are dropped for the same reason stale hits are, and the
       * damage is just as visible: a miss for an abandoned postal code would clear
       * the colonia list belonging to one SEPOMEX DID resolve, and put "no
       * encontramos ese código postal" under a postal code it found.
       */
      if (isStalePostalCodeLookup(state, action.postalCode)) {
        return state
      }

      /**
       * NOT a quote failure. A SEPOMEX miss degrades to manual state/city entry
       * and must never block the section or enter `failed` — the customer can
       * still complete the address by hand, and once province and city are
       * present the signature completes and quoting proceeds identically.
       */
      return { ...state, cpStatus: "not_found", colonias: [], coloniasPostalCode: null }

    case "CP_LOOKUP_NOT_NEEDED":
      /**
       * The postal code is usable and no lookup is in flight — clear only the
       * lookup status. The held colonia list (and the manual-colonia flag) is
       * still meaningful for the current postal code and MUST survive: this is
       * what stops the autosave round-trip from wiping a list the moment it
       * arrives. No-op short-circuit for stable identity across re-renders.
       */
      return state.cpStatus === "idle"
        ? state
        : { ...state, cpStatus: "idle" }

    case "CP_LOOKUP_DISCARDED":
      /**
       * The postal code is not usable — clear the lookup status AND the colonia
       * list it belonged to, and drop the list's postal code so the "no list"
       * invariant holds. `coloniaManual` is untouched (as the old collapsed
       * reset did). No-op short-circuit for stable identity.
       */
      return state.cpStatus === "idle" &&
        state.colonias.length === 0 &&
        state.coloniasPostalCode === null
        ? state
        : { ...state, cpStatus: "idle", colonias: [], coloniasPostalCode: null }

    case "COLONIA_MANUAL_REQUESTED":
      /**
       * MAJ-1: routed THROUGH `commitDraft` rather than patching `draft`
       * directly. Clearing `address_2` moves the destination now that the
       * colonia is in the signature (S3), so it must recompute `quoteSignature`,
       * drop `calculatedPrices`/`quotedSignature`, and re-evaluate the selection
       * exactly like any other draft edit. Patching the draft in place — as this
       * did before S3 — left `quoteSignature` pointing at a colonia just cleared,
       * so the section still reported `quoted` and rendered its prices.
       */
      return {
        ...commitDraft(state, {
          draft: { ...state.draft, address_2: "" },
        }),
        coloniaManual: true,
      }

    case "CART_WRITE_STARTED":
      return {
        ...state,
        issuedWriteSequence: Math.max(
          state.issuedWriteSequence,
          action.sequence
        ),
        autosaveStatus: "saving",
      }

    case "CART_WRITE_FAILED":
      /**
       * An OLD failure must not overwrite a NEWER success. Only the most
       * recently issued write owns the status line.
       */
      return action.sequence < state.issuedWriteSequence
        ? state
        : { ...state, autosaveStatus: "error" }

    case "CART_UPDATED": {
      /**
       * ## Supersession control — `design.md` §14 item 1
       *
       * The debounced writer had none. Two edits 700 ms apart could land out of
       * order and an older draft could overwrite a newer one, and PR1a widened
       * the window further by putting a sequential id-resolving read in front of
       * every write. The `AbortController` in `shipping-address` was never
       * passed into the server action, so aborting the effect cancelled nothing.
       *
       * Server actions cannot be cancelled, so the fix is sequencing rather than
       * cancellation: every cart write carries a monotonically increasing
       * sequence from ONE counter, and a response is applied only when
       *
       * - it is at least as new as the newest write ISSUED (nothing newer is
       *   already on its way to overwrite it), AND
       * - it is strictly newer than the newest response already APPLIED.
       *
       * The first condition is what the abort was trying and failing to express.
       *
       * ## The `absent` TOCTOU (§14 item 1b) is NOT closed by this
       *
       * Stated plainly, because an earlier version of this docstring claimed the
       * opposite and the claim was false.
       *
       * The sequence above orders RESPONSES — it decides which reply is allowed
       * to touch state. The `absent` window is on the REQUEST side, at the
       * server's `retrieveCartFresh` in front of the PATCH: two writes already
       * in the air both resolve the address as absent and both take the id-less
       * `em.create` path, and no amount of reply-ordering can un-send a request.
       *
       * Deleting `addresses/index.tsx` removed the `setAddresses` submit writer,
       * but it did NOT leave exactly one writer behind. The autosave (400 ms) and
       * the requote (600 ms) BOTH persisted the draft, and both were armed by the
       * SAME transition — `FIELD_BLUR` and `CP_LOOKUP_FOUND` bump `blurSequence`
       * and move `quoteSignature` together — so they raced by construction, on
       * the first checkout of every new cart.
       *
       * What actually closes it is serialisation at the writer:
       * `checkout-write-scheduler.ts` guarantees at most one
       * `persistCheckoutDraft` in flight and re-derives each queued write against
       * the cart the previous one actually persisted. Both effects funnel through
       * it. PR2c's `syncCheckoutAddresses` MUST go through the same scheduler —
       * drawing from the same counter is necessary but, as this bug proved, not
       * sufficient.
       *
       * @see `modules/checkout/state/checkout-write-scheduler.ts`
       */
      if (
        action.sequence < state.issuedWriteSequence ||
        action.sequence <= state.appliedWriteSequence
      ) {
        return state
      }

      return {
        ...state,
        cart: action.cart,
        shippingAddressId: action.cart.shipping_address?.id ?? null,
        billingAddressId: action.cart.billing_address?.id ?? null,
        appliedWriteSequence: action.sequence,
        autosaveStatus: "saved",
        /**
         * `draft`, `selectedShippingOptionId` and `selectionSignature` are
         * deliberately untouched. The cart still carries the shipping-method row
         * the reducer just invalidated (F1), so reading the selection back off
         * it would re-tick a radio the customer must re-choose, and overwriting
         * the draft is the bug `hydratedRef` existed to prevent.
         */
      }
    }

    case "QUOTE_STARTED":
      return { ...state, inFlightSignature: action.signature }

    case "QUOTE_READY": {
      if (action.signature !== state.quoteSignature) {
        /**
         * Superseded: the result is dropped WHOLE — no options, no prices, no
         * advance of `quotedSignature`. Merging "just the prices" is how a
         * customer ends up seeing a number quoted for a postal code they have
         * already changed.
         *
         * The one thing that IS reclaimed is the in-flight slot this request
         * occupied. Leaking it would make `evaluateQuoteReadiness` answer
         * `already_in_flight` forever if the customer typed their way back to
         * that address, and no quote would ever run again.
         */
        return state.inFlightSignature === action.signature
          ? { ...state, inFlightSignature: null }
          : state
      }

      return {
        ...state,
        quotedSignature: action.signature,
        shippingOptions: action.options,
        calculatedPrices: action.prices,
        inFlightSignature: null,
        failedSignature: null,
      }
    }

    case "QUOTE_FAILED": {
      const released =
        state.inFlightSignature === action.signature
          ? { ...state, inFlightSignature: null }
          : state

      /**
       * `quotedSignature` is NOT advanced. It tracks the last SUCCESS, so
       * `evaluateQuoteReadiness` still answers `quote` for this address and the
       * failure is recoverable without a page reload.
       */
      return action.signature === state.quoteSignature
        ? { ...released, failedSignature: action.signature }
        : released
    }

    case "QUOTE_RETRY":
      return { ...state, failedSignature: null }

    case "SELECT_SHIPPING_OPTION":
      /**
       * Stamped with the signature the customer SAW, not the one that happens to
       * be current when this reduces.
       *
       * `setShippingMethod` is awaited before this dispatches, and the customer
       * can edit the postal code during that round trip. Reading
       * `state.quoteSignature` here recorded the selection as belonging to the
       * NEW destination: `isShippingSelectionStale` then answered `false`,
       * `shipping_method_stale` never fired, the radio rendered checked for an
       * option only ever priced for the old postal code, and the summary
       * presented that total as final. Settled decision 1 exists to prevent
       * precisely that, and an awaited continuation walked straight through it.
       *
       * Carrying the click-time signature makes the staleness comparison
       * downstream true by construction: if the destination moved while the
       * request was in the air, the captured signature no longer matches and the
       * selection is stale the moment it lands.
       */
      return {
        ...state,
        selectedShippingOptionId: action.optionId,
        selectionSignature: action.signature,
      }

    case "SELECT_PAYMENT_PROVIDER":
      return { ...state, selectedPaymentProviderId: action.providerId }

    case "SET_PAYMENT_DETAILS_COMPLETE":
      return { ...state, paymentDetailsComplete: action.complete }

    /**
     * Clearing the error here is the point, not a side effect. A message left
     * over from the previous attempt sitting beside a spinner reads as if the
     * new attempt has already failed — and the most common reason for a second
     * attempt is the total-change guard, which is not a failure at all.
     */
    case "PLACE_ORDER_STARTED":
      return { ...state, placingOrder: true, error: null }

    case "PLACE_ORDER_SETTLED":
      return { ...state, placingOrder: false, error: action.error }

    case "SET_ERROR":
      return { ...state, error: action.error }
  }
}

/**
 * The six customer-visible states, derived from the facts rather than stored.
 *
 * Order matters and is part of the contract:
 *
 * 1. a SEPOMEX lookup in flight outranks everything — the customer typed a
 *    postal code and something is happening;
 * 2. no signature means there is nothing to quote, whatever else is true;
 * 3. a quote actually running for the current address is `quoting`;
 * 4. a failure recorded against the CURRENT address is `failed` — and it stays
 *    that way until the customer changes the address or asks to retry, which is
 *    what stops the effect from hammering the carrier;
 * 5. a success for the current address is `quoted`, or `not_serviceable` when
 *    the list came back empty;
 * 6. otherwise a quote for the current address has not landed yet — the debounce
 *    is still running — which is `quoting` too. Reporting `quoted` here is how
 *    prices from the PREVIOUS destination stay on screen looking current.
 */
export function selectQuoteStatus(state: CheckoutState): QuoteStatus {
  if (state.cpStatus === "loading") {
    return "looking_up"
  }

  if (state.quoteSignature === null) {
    return "idle"
  }

  if (state.inFlightSignature === state.quoteSignature) {
    return "quoting"
  }

  if (state.failedSignature === state.quoteSignature) {
    return "failed"
  }

  if (state.quotedSignature === state.quoteSignature) {
    return state.shippingOptions.length === 0 ? "not_serviceable" : "quoted"
  }

  return "quoting"
}

/**
 * One row of the Envío option list, as the customer will read it.
 *
 * `amount: null` means "this option has no price we can stand behind" and is the
 * ONLY way to say so. There is deliberately no placeholder, no `"-"`, no `0`
 * default: R3 is that a fake price is worse than an honest absence, and a `0`
 * default is indistinguishable from free shipping.
 */
export type ShippingChoice = {
  id: string
  name: string
  amount: number | null
  selectable: boolean
}

/**
 * What the Envío section is allowed to put on screen, and what may be picked.
 *
 * ## Empty unless the held quote belongs to the CURRENT destination
 *
 * This is the spec's "previously quoted prices MUST NOT remain visible as if
 * current", enforced here rather than by a conditional in the section's JSX.
 * `state.shippingOptions` survives a destination change on purpose (the list is
 * address-filtered too, but keeping it avoids a flash of nothing), and
 * `initFromServer` seeds it from the RSC render before any price exists at all.
 * So "the list is non-empty" is not a licence to render it — only
 * {@link selectQuoteStatus} reporting `quoted` is, because that is the single
 * place where "the prices in hand were quoted for the address on screen" is
 * decided.
 *
 * Rendering the list whenever it was non-empty is exactly what the component
 * this replaces did, and it is how a price quoted for a postal code the customer
 * had already changed stayed on screen looking current.
 *
 * ## Per-row rules
 *
 * - a `calculated` option is priced by the quote round, never by the option;
 * - anything else carries its own `amount` — flat rates are never routed through
 *   `calculatePriceForShippingOption`, so the price map says nothing about them,
 *   and a stray map entry must not be able to give one an amount;
 * - `Number.isFinite`, not truthiness. Free shipping quotes `0`, and the
 *   component this replaces rendered `0` as `-` and refused to let it be chosen;
 * - an option the warehouse cannot fulfil is shown and refused, rather than
 *   hidden: a row that vanishes reads as a store with fewer carriers, and the
 *   customer is left wondering where the option they used last time went.
 *
 * Unpriced rows are RETURNED, not filtered. The section renders them without an
 * amount and unselectable — which is the honest statement — and
 * {@link selectQuoteStatus} has already reported `failed` for the case where
 * NONE of them priced (@see `classifyQuoteResult`).
 *
 * @see `modules/checkout/components/shipping-section/index.tsx` — the consumer.
 */
export function selectShippingChoices(state: CheckoutState): ShippingChoice[] {
  if (selectQuoteStatus(state) !== "quoted") {
    return []
  }

  return state.shippingOptions.map((option) => {
    const amount = readPresentableAmount(option, state.calculatedPrices)

    return {
      id: option.id,
      name: option.name ?? "",
      amount,
      selectable: amount !== null && !option.insufficient_inventory,
    }
  })
}

/**
 * S0: whether this round left one or more calculated options without a price —
 * an annotation ORTHOGONAL to {@link selectQuoteStatus}, never a seventh state.
 *
 * `true` ONLY when the state is `quoted` AND at least one calculated option in
 * the current round is unpresentable; `false` in every other state by
 * construction (the `quoted` guard alone rules out `idle`, `looking_up`,
 * `quoting`, `failed` and `not_serviceable`). Flat options are excluded: a
 * missing flat amount is a catalogue gap, not a carrier that failed to answer.
 *
 * Reads presentability through the SAME {@link readPresentableAmount} the
 * classifier and {@link selectShippingChoices} use, so the note and the rows can
 * never disagree about whether a rate is missing.
 *
 * The copy the consumer renders is fixed and never derived from an upstream
 * message: the storefront cannot tell a timeout from a no-coverage answer.
 *
 * @see `modules/checkout/components/shipping-section/index.tsx` — renders the
 * carrier-rates-unavailable note above the list.
 */
export function selectCarrierRatesUnavailable(state: CheckoutState): boolean {
  return (
    selectQuoteStatus(state) === "quoted" &&
    state.shippingOptions.some(
      (option) =>
        option.price_type === "calculated" &&
        readPresentableAmount(option, state.calculatedPrices) === null
    )
  )
}

/**
 * A content-derived identity for the options list (C3).
 *
 * `QUOTE_READY` replaces `shippingOptions` with a freshly-built array on every
 * success, so the reference moves even when the carrier returned exactly the same
 * options. A consumer that keys an effect on the ARRAY therefore re-runs for a
 * list that did not change — and `shipping/index.tsx` keys its
 * `calculatePriceForShippingOption` fan-out exactly that way, which under finding
 * F2 costs a live Skydropx quote per calculated option per spurious re-run.
 *
 * The key is the ordered list of option ids. Order is significant because it is
 * the order the radios render in. The delimiter is the same ASCII unit separator
 * `shipping-quote.ts` uses for signatures: unrepresentable inside a backend id by
 * construction, so two genuinely different lists cannot collide because a value
 * happened to contain the separator.
 *
 * Deliberately ignores price. A consumer that re-prices does so from its own
 * fetch, and folding the amount in here would defeat the whole purpose by moving
 * the key every time a price moved.
 *
 * @see `modules/checkout/state/checkout-context.tsx` — memoizes on this.
 */
export function selectShippingOptionsKey(
  options: HttpTypes.StoreCartShippingOption[]
): string {
  return options.map((option) => option.id).join("\u001f")
}

/**
 * Whether the current postal code is USABLE — i.e. whether a colonia list for
 * it could still be meaningful. This is the pure decision the effect routes on
 * (`.tsx` chooses `CP_LOOKUP_NOT_NEEDED` vs `CP_LOOKUP_DISCARDED` from it), so
 * no rule lives in the provider.
 *
 * - `false` when the postal code does not match {@link MX_POSTAL_CODE_PATTERN}.
 * - `false` when a list IS held but was fetched for a DIFFERENT postal code —
 *   the B -> A -> B retention edge (see {@link CheckoutState.coloniasPostalCode}).
 * - `true` when no list is held (nothing to invalidate) OR the held list belongs
 *   to the current postal code.
 *
 * Distinct from {@link selectShouldLookUpPostalCode}: that decides whether to
 * START a lookup and is NOT weakened here. This decides whether an existing list
 * survives when a lookup is not (re-)started.
 */
export function selectPostalCodeIsUsable(state: CheckoutState): boolean {
  const cp = state.draft.postal_code.trim()

  if (!MX_POSTAL_CODE_PATTERN.test(cp)) {
    return false
  }

  // A list we hold is only meaningful for the postal code it was FETCHED for.
  return state.colonias.length === 0 || state.coloniasPostalCode === cp
}

/**
 * Whether the SEPOMEX lookup should run for the postal code currently in the
 * draft.
 *
 * ## The regression this exists to prevent
 *
 * `CP_LOOKUP_FOUND` treats the postal code as AUTHORITATIVE for province and
 * city and overwrites both — which is correct, and is the fix for the "-"
 * shipping price a missing state used to cause. But it means that firing the
 * lookup on MOUNT for an address the cart already has can rewrite
 * `"CDMX"` to `"Ciudad de México"`, move the quote signature, and drop a
 * returning customer's shipping selection while they are still reading the page
 * — for a destination they never changed.
 *
 * So the lookup runs when it has something to contribute:
 *
 * - the postal code differs from the one already persisted on the cart, i.e.
 *   the customer typed a new one; or
 * - province or city is missing, so there is genuinely something to fill in.
 *
 * A returning cart with a complete address is left alone. Its colonia renders
 * as free text from the draft rather than as a dropdown, which is exactly what
 * the old code did for a saved colonia that was not in the list.
 *
 * Pure and asserted here rather than left as a ref inside the provider, because
 * the provider is a `.tsx` and nothing in this repo can test one.
 */
export function selectShouldLookUpPostalCode(state: CheckoutState): boolean {
  const postalCode = state.draft.postal_code.trim()

  if (!MX_POSTAL_CODE_PATTERN.test(postalCode)) {
    return false
  }

  if (postalCode !== (state.cart?.shipping_address?.postal_code ?? "").trim()) {
    return true
  }

  return state.draft.province.trim() === "" || state.draft.city.trim() === ""
}

/**
 * Whether the requote effect may fire for the current address.
 *
 * The guard that is NOT in `evaluateQuoteReadiness` and has to be here: that
 * function advances `lastRequestedSignature` on success only — deliberately, so
 * a failed address stays retryable — which means it keeps answering `quote` for
 * an address that just failed. An effect that trusted it alone would retry in a
 * tight loop, and per finding F2 every one of those retries is a live carrier
 * quote. A failure therefore parks until the customer edits the address or
 * presses retry.
 */
export function selectQuoteIsBlockedByFailure(state: CheckoutState): boolean {
  return (
    state.failedSignature !== null &&
    state.failedSignature === state.quoteSignature
  )
}

/**
 * The persistable fields whose draft value differs from what is on the cart, or
 * `null` when there is nothing to write.
 *
 * This is `design.md` D3's "skip when the draft is unchanged" rule and §14
 * item 6's "do not emit a bare-PK upsert" rule, in one place and testable. Both
 * matter more than they look: per finding F2 every `updateCart` re-runs
 * `refreshCartShippingMethodsWorkflow` once a shipping method exists, and that
 * is a live Skydropx quote. A no-op write is not free, it is a carrier call.
 *
 * The comparison is against the CART, not against a remembered copy of the last
 * payload — the cart is what actually got persisted, so a write that partially
 * failed self-corrects on the next blur instead of being remembered as done.
 */
export function selectUnsavedDraftPatch(
  state: CheckoutState
): Partial<CheckoutDraftAddress> | null {
  return selectUnsavedDraftPatchAgainst(
    state.draft,
    state.cart?.shipping_address
  )
}

/**
 * The same rule, against an EXPLICIT persisted address rather than the one in
 * state.
 *
 * ## Why the parameterised form has to exist (B1)
 *
 * A cart write that is queued behind another one cannot compute its patch from
 * `state.cart`. Between the moment the first write dispatches `CART_UPDATED` and
 * the moment the second starts, React has not necessarily re-rendered, so
 * `state.cart` may still be the cart from BEFORE the first write. The second
 * write would then re-send fields that are already persisted — and under PR1a's
 * id-resolving read that is exactly the `absent` TOCTOU (§14 item 1b): two
 * writes, both resolving no address id, both taking the id-less `em.create`
 * path, the second orphaning the first one's row.
 *
 * So the serialiser passes the address its OWN last write returned, and
 * {@link selectWriteBaseCart} decides which of the two is newer. Keeping this as
 * one function with the state-level form delegating to it is deliberate: two
 * copies of "what counts as unsaved" is the drift this module exists to remove.
 *
 * @see `modules/checkout/state/checkout-write-scheduler.ts` — the only caller.
 */
export function selectUnsavedDraftPatchAgainst(
  draft: AddressDraft,
  persisted: Partial<Record<AddressField, string | null>> | null | undefined
): Partial<CheckoutDraftAddress> | null {
  const patch: Partial<Record<AddressField, string>> = {}

  for (const field of PERSISTABLE_ADDRESS_FIELDS) {
    if (draft[field] !== (persisted?.[field] ?? "")) {
      patch[field] = draft[field]
    }
  }

  return Object.keys(patch).length > 0 ? patch : null
}

/** The email to persist, or `null` when the cart already has this one. */
export function selectUnsavedEmail(state: CheckoutState): string | null {
  return selectUnsavedEmailAgainst(state.email, state.cart)
}

/** {@link selectUnsavedEmail} against an explicit cart. @see B1 note above. */
export function selectUnsavedEmailAgainst(
  email: string,
  persisted: HttpTypes.StoreCart | null | undefined
): string | null {
  return email !== (persisted?.email ?? "") ? email : null
}

/** A cart written by the scheduler, and the sequence it was written under. */
export type PendingWrite = {
  cart: HttpTypes.StoreCart
  sequence: number
} | null

/**
 * Which cart a queued write should compute its patch against (B1).
 *
 * The scheduler holds the cart its own most recent write returned. That cart is
 * newer than `state.cart` exactly while the reducer has not yet applied a
 * response at least as new as it — which is a SEQUENCE comparison, not an
 * identity check and not a timing assumption. Once `appliedWriteSequence` has
 * caught up, `state.cart` is authoritative again and is preferred, so a cart
 * updated by anything other than the scheduler (a discount code, PR2b's shipping
 * method) is never shadowed by a stale write result.
 */
export function selectWriteBaseCart(
  state: CheckoutState,
  pending: PendingWrite
): HttpTypes.StoreCart | null {
  if (pending !== null && state.appliedWriteSequence < pending.sequence) {
    return pending.cart
  }

  return state.cart
}

/**
 * Whether the summary must present its shipping line and grand total as
 * PROVISIONAL rather than final (D4 step 3).
 *
 * ## Why the summary needs a rule at all
 *
 * `CheckoutSummary` reads `cart.total` and `cart.shipping_subtotal` straight off
 * the cart, which is normally exactly right. Finding F2 is what breaks it: per F1
 * the storefront cannot remove a shipping method, and `updateCartWorkflow`
 * unconditionally re-runs `refreshCartShippingMethodsWorkflow`, which re-lists
 * options for the NEW destination and re-prices the surviving method to it. So
 * the first autosave after a postal-code change silently rewrites the customer's
 * total, and the summary would present the new number as if they had agreed to
 * it. That is the precise failure settled decision 1 exists to prevent.
 *
 * ## Defined as the CTA's own answer, never as a second derivation
 *
 * This is `shipping_method_stale` being present in
 * {@link getMissingOrderRequirements}, and nothing else. Re-deriving it from
 * `isShippingSelectionStale` here would be a second copy of the rule, and the two
 * would drift the day one of them grew a condition — leaving a checkout whose
 * button says "re-choose your shipping method" beside a total presented as final,
 * or the reverse.
 *
 * Routing through the catalogue also inherits two behaviours worth having for
 * free: it cannot fire when nothing was ever chosen (`shipping_method` covers
 * that case instead, and warning about the recalculation of a price that does not
 * exist is noise), and it cannot fire on an empty cart.
 *
 * @see `modules/checkout/templates/checkout-summary/index.tsx` — the consumer.
 */
export function selectShippingIsProvisional(state: CheckoutState): boolean {
  return selectPlaceOrderView(state).provisional
}

/**
 * Everything the final CTA renders — one derivation, three consumers.
 *
 * @see `modules/checkout/components/place-order-bar` — both variants.
 * @see `modules/checkout/components/missing-items-list` — the itemized list.
 */
export type PlaceOrderView = {
  /** Every unmet requirement, in catalogue order (R8 / S9). */
  missing: MissingRequirement[]
  /** The sticky bar's single line (D9). `null` when nothing is missing. */
  firstMissingMessage: string | null
  /** The `disabled` attribute for BOTH CTA variants. */
  disabled: boolean
  /** An attempt is in flight — the button's loading affordance. */
  placing: boolean
  /** The inline message under the CTA. */
  error: string | null
  /** `cart.total`, the field `CartTotals` renders. `null` before the cart resolves. */
  total: number | null
  currencyCode: string
  /** D4: the total is de-emphasised rather than presented as final. */
  provisional: boolean
}

/**
 * The single source for the CTA's rendered state (tasks 2c.15–2c.17).
 *
 * ## Why this is a selector and not three components each working it out
 *
 * `PlaceOrderBar` renders twice — `inline` on desktop, `sticky` on mobile (D9)
 * — and `MissingItemsList` renders the same catalogue a third time. All three
 * are `.tsx` files, which this repo's node-only runner cannot load, so any rule
 * left inside them is a rule nothing can contradict. Three independent
 * derivations of "is the button disabled" and "what is the total" is three
 * chances for the mobile bar to be enabled while the desktop one is not, or for
 * the bar's total to disagree with the summary's.
 *
 * ## Every field is a definition, not a second opinion
 *
 * - `disabled` is the emptiness of `missing` OR an attempt already running. It
 *   is never a re-reading of the conditions `getMissingOrderRequirements`
 *   already checked; that copy is exactly how a button and its explanation
 *   drift apart.
 * - `provisional` is the PRESENCE of `shipping_method_stale` in the very list
 *   the bar is rendering, which is why {@link selectShippingIsProvisional}
 *   delegates here rather than deriving it a second time.
 * - `total` is `cart.total` — the same field `CartTotals` renders — because the
 *   spec requires the bar and the summary to be incapable of disagreeing.
 *
 * `placing` is the AFFORDANCE. The authoritative re-entrancy lock is a
 * synchronous closure flag inside `place-order-flow.ts`, because this value
 * reaches the button through a ref that lags by one commit.
 */
export function selectPlaceOrderView(state: CheckoutState): PlaceOrderView {
  const missing = getMissingOrderRequirements(selectReadinessInput(state))

  return {
    missing,
    firstMissingMessage: missing.length > 0 ? missing[0].message : null,
    disabled: missing.length > 0 || state.placingOrder,
    placing: state.placingOrder,
    error: state.error,
    total: state.cart?.total ?? null,
    /**
     * `"mxn"` and not `""`: `convertToLocale` falls back to a BARE NUMBER when
     * the currency code is empty, so a cart fetched without `currency_code`
     * would put an unlabelled figure next to a purchase button.
     */
    currencyCode: state.cart?.currency_code ?? "mxn",
    provisional: missing.some(
      (requirement) => requirement.code === "shipping_method_stale"
    ),
  }
}

/**
 * The adapter into the CTA predicate.
 *
 * Built from the CART and not from the draft, deliberately: the cart is what
 * gets ordered, so a field the customer has typed but the autosave has not yet
 * persisted is genuinely not ready. The 400 ms debounce keeps the lag short.
 *
 * `canPlaceOrder` is NOT re-derived anywhere in this module — it is defined as
 * the emptiness of `getMissingOrderRequirements`, and a second copy is how the
 * button and its explanation drift apart.
 *
 * @see `modules/checkout/components/place-order-bar` — PR2c, first consumer.
 */
export function selectReadinessInput(
  state: CheckoutState
): OrderReadinessInput {
  return toReadinessInput(state.cart, {
    selectedShippingOptionId: state.selectedShippingOptionId,
    selectionSignature: state.selectionSignature,
    currentQuoteSignature: state.quoteSignature,
    selectedPaymentProviderId: state.selectedPaymentProviderId,
    paymentDetailsComplete: state.paymentDetailsComplete,
    /**
     * Amendment A5. Billing readiness is answered from the CHECKBOX and the
     * DRAFT, never from `state.cart.billing_address` — the column's only writer
     * runs at CTA time, behind the gate this feeds. See `toReadinessInput`.
     */
    sameAsBilling: state.sameAsBilling,
    billingDraft: state.billingDraft,
  })
}

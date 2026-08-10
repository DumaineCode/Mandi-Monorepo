import { getMissingOrderRequirements } from "@lib/util/checkout-readiness"
import { evaluateQuoteReadiness } from "@lib/util/shipping-quote"
import type { HttpTypes } from "@medusajs/types"
import { describe, expect, it } from "vitest"

import {
  checkoutReducer,
  initFromServer,
  selectCarrierRatesUnavailable,
  selectPlaceOrderView,
  selectPostalCodeIsUsable,
  selectQuoteIsBlockedByFailure,
  selectQuoteRelevantAddress,
  selectQuoteStatus,
  selectReadinessInput,
  selectShippingChoices,
  selectShippingIsProvisional,
  selectShippingOptionsKey,
  selectShouldLookUpPostalCode,
  selectUnsavedDraftPatch,
  selectUnsavedDraftPatchAgainst,
  selectUnsavedEmail,
  selectUnsavedEmailAgainst,
  selectWriteBaseCart,
  type CheckoutState,
} from "./checkout-reducer"

/**
 * Fixtures are written independently of the implementation on purpose.
 *
 * Nothing here imports a constant out of the module under test and then asserts
 * against it — `X === X` passes for every value of `X` and proves nothing. Where
 * a signature is involved the assertions are PROPERTIES (null / non-null, equal
 * to a previously captured value / different from it), because the signature
 * format belongs to `shipping-quote.ts` and this module must not depend on it.
 */

const CDMX = {
  first_name: "Ana",
  last_name: "Ruiz",
  company: "Mando",
  address_1: "Av. Álvaro Obregón 100",
  address_2: "Roma Norte",
  postal_code: "06700",
  city: "Ciudad de México",
  province: "CDMX",
  country_code: "mx",
  phone: "5512345678",
}

const cartWith = (
  overrides: Record<string, unknown> = {}
): HttpTypes.StoreCart =>
  ({
    id: "cart_01",
    email: "ana@example.com",
    items: [{ id: "li_01" }],
    shipping_methods: [],
    shipping_address: { id: "caaddr_01", ...CDMX },
    billing_address: null,
    region: { id: "reg_01", countries: [{ iso_2: "mx" }] },
    total: 1000,
    ...overrides,
  } as unknown as HttpTypes.StoreCart)

const option = (id: string, priceType = "calculated") =>
  ({
    id,
    name: id,
    price_type: priceType,
    amount: 0,
  } as unknown as HttpTypes.StoreCartShippingOption)

const baseState = (
  cartOverrides: Record<string, unknown> = {},
  options: HttpTypes.StoreCartShippingOption[] = [option("so_std")]
): CheckoutState =>
  initFromServer({
    cart: cartWith(cartOverrides),
    customer: null,
    shippingOptions: options,
  })

/** Applies a list of actions left-to-right. Keeps the arrange step readable. */
type CheckoutAction = Parameters<typeof checkoutReducer>[1]

/**
 * Accepts a thunk as well as a plain action, so a helper can build an action
 * against the state it is about to be reduced into. Needed because
 * `SELECT_SHIPPING_OPTION` now REQUIRES the signature the customer clicked
 * under, and in a multi-action `run(...)` the intermediate state is not
 * otherwise in scope.
 */
const run = (
  state: CheckoutState,
  ...actions: (CheckoutAction | ((state: CheckoutState) => CheckoutAction))[]
): CheckoutState =>
  actions.reduce(
    (current, action) =>
      checkoutReducer(
        current,
        typeof action === "function" ? action(current) : action
      ),
    state
  )

/**
 * The ordinary selection: the customer picks under the destination currently on
 * screen, having not touched the address during the round trip.
 *
 * The signature is a REQUIRED field on the action, not something the reducer
 * reads off its own state, because the caller is the only party that knows
 * which destination the price on the clicked row belonged to. Expressing that
 * here keeps the tests honest about who decides. The race that motivated it —
 * a postal-code edit landing while `setShippingMethod` is in flight — is
 * covered separately, by passing a signature that deliberately disagrees.
 */
const selectShipping =
  (optionId = "so_std") =>
  (state: CheckoutState): CheckoutAction => ({
    type: "SELECT_SHIPPING_OPTION",
    optionId,
    signature: state.quoteSignature,
  })

// ---------------------------------------------------------------------------
// 2a.1 — the transition that is the whole point of the reducer
// ---------------------------------------------------------------------------

describe("FIELD_BLUR on a quote-relevant field", () => {
  it("recomputes the quote signature", () => {
    const before = baseState()
    expect(before.quoteSignature).not.toBeNull()

    const after = checkoutReducer(before, {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })

    expect(after.quoteSignature).not.toBeNull()
    expect(after.quoteSignature).not.toBe(before.quoteSignature)
  })

  it("clears the selected shipping option in the SAME transition", () => {
    const selected = run(
      baseState({ shipping_methods: [{ shipping_option_id: "so_std" }] }),
      selectShipping("so_std")
    )
    expect(selected.selectedShippingOptionId).toBe("so_std")

    const after = checkoutReducer(selected, {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })

    expect(after.selectedShippingOptionId).toBeNull()
  })

  it("keeps the OLD selection signature so the CTA can still report staleness", () => {
    // The cart still carries the shipping-method row — per finding F1 there is
    // no store API to remove it. `hasShippingMethod` therefore stays true, and
    // the ONLY thing that can make `getMissingOrderRequirements` emit
    // `shipping_method_stale` is a selection signature that differs from the
    // current one. Clearing it to null would silently unblock the CTA.
    const selected = run(
      baseState({ shipping_methods: [{ shipping_option_id: "so_std" }] }),
      selectShipping("so_std")
    )
    const signatureAtSelection = selected.selectionSignature
    expect(signatureAtSelection).not.toBeNull()

    const after = checkoutReducer(selected, {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })

    expect(after.selectionSignature).toBe(signatureAtSelection)
    expect(after.selectionSignature).not.toBe(after.quoteSignature)
  })

  it("drops prices that belong to the previous destination", () => {
    const quoted = run(baseState(), {
      type: "QUOTE_READY",
      signature: baseState().quoteSignature!,
      options: [option("so_std")],
      prices: { so_std: 12900 },
    })
    expect(quoted.calculatedPrices).toEqual({ so_std: 12900 })

    const after = checkoutReducer(quoted, {
      type: "FIELD_BLUR",
      field: "city",
      value: "Guadalajara",
    })

    expect(after.calculatedPrices).toEqual({})
  })
})

describe("FIELD_BLUR on a non-quote-relevant field", () => {
  it("does not recompute the signature", () => {
    const before = baseState()

    const after = checkoutReducer(before, {
      type: "FIELD_BLUR",
      field: "address_1",
      value: "Otra calle 55",
    })

    expect(after.quoteSignature).toBe(before.quoteSignature)
    expect(after.draft.address_1).toBe("Otra calle 55")
  })

  it("does not clear the selected shipping option", () => {
    const selected = run(
      baseState({ shipping_methods: [{ shipping_option_id: "so_std" }] }),
      selectShipping("so_std")
    )

    const after = checkoutReducer(selected, {
      type: "FIELD_BLUR",
      field: "address_1",
      value: "Otra calle 55",
    })

    expect(after.selectedShippingOptionId).toBe("so_std")
  })

  it.each([
    "first_name",
    "last_name",
    "company",
    "phone",
    "address_1",
  ] as const)("leaves the signature untouched for %s", (field) => {
    const before = baseState()
    const after = checkoutReducer(before, {
      type: "FIELD_BLUR",
      field,
      value: "cambiado",
    })
    expect(after.quoteSignature).toBe(before.quoteSignature)
  })

  /**
   * S3: `address_2` (the colonia) IS quote-relevant now — this used to sit in
   * the list above and no longer can. Kept as an explicit counter-assertion so
   * the boundary is visible rather than silently dropped.
   */
  it("DOES move the signature for address_2 (the colonia, S3)", () => {
    const before = baseState()
    const after = checkoutReducer(before, {
      type: "FIELD_BLUR",
      field: "address_2",
      value: "Otra Colonia",
    })
    expect(after.quoteSignature).not.toBe(before.quoteSignature)
  })
})

describe("FIELD_CHANGE", () => {
  it("recomputes the signature while typing, without waiting for a blur", () => {
    // S3 / task 2a.23: a postal code ALONE must be able to trigger a quote. If
    // the signature only moved on blur, the customer would have to tab out of
    // the field before anything happened.
    const before = baseState()
    const after = checkoutReducer(before, {
      type: "FIELD_CHANGE",
      field: "postal_code",
      value: "44160",
    })

    expect(after.quoteSignature).not.toBe(before.quoteSignature)
  })

  it("does not arm the autosave", () => {
    const before = baseState()
    const after = checkoutReducer(before, {
      type: "FIELD_CHANGE",
      field: "postal_code",
      value: "44160",
    })

    expect(after.blurSequence).toBe(before.blurSequence)
  })
})

describe("the autosave trigger", () => {
  it("is armed by every blur — without this nothing is ever persisted", () => {
    const before = baseState()

    const once = checkoutReducer(before, {
      type: "FIELD_BLUR",
      field: "first_name",
      value: "Ana Sofía",
    })
    expect(once.blurSequence).toBe(before.blurSequence + 1)

    const twice = checkoutReducer(once, {
      type: "FIELD_BLUR",
      field: "last_name",
      value: "Ruiz Martínez",
    })
    expect(twice.blurSequence).toBe(before.blurSequence + 2)
  })

  it("is armed by a blur that changed nothing, so a retry after a failed write still fires", () => {
    const before = baseState()
    const after = checkoutReducer(before, {
      type: "FIELD_BLUR",
      field: "first_name",
      value: before.draft.first_name,
    })

    expect(after.blurSequence).toBe(before.blurSequence + 1)
  })

  it("is armed when a saved address is applied wholesale", () => {
    const before = baseState()
    const after = checkoutReducer(before, {
      type: "ADDRESS_PREFILL",
      address: { ...CDMX, postal_code: "44160", city: "Guadalajara" },
    })

    expect(after.blurSequence).toBe(before.blurSequence + 1)
    expect(after.draft.city).toBe("Guadalajara")
    expect(after.quoteSignature).not.toBe(before.quoteSignature)
  })
})

// ---------------------------------------------------------------------------
// 2a.2 — quote lifecycle and supersession
// ---------------------------------------------------------------------------

describe("QUOTE_READY", () => {
  it("is dropped entirely when its signature is not the current one", () => {
    const state = baseState()

    const after = checkoutReducer(state, {
      type: "QUOTE_READY",
      signature: "a-signature-from-a-previous-address",
      options: [option("so_ghost")],
      prices: { so_ghost: 99900 },
    })

    expect(after.calculatedPrices).toEqual({})
    expect(after.shippingOptions.map((o) => o.id)).toEqual(["so_std"])
    expect(after.quotedSignature).toBeNull()
  })

  it("never merges a superseded result into the current one", () => {
    const current = baseState().quoteSignature!
    const state = run(baseState(), {
      type: "QUOTE_READY",
      signature: current,
      options: [option("so_std")],
      prices: { so_std: 12900 },
    })

    const after = checkoutReducer(state, {
      type: "QUOTE_READY",
      signature: "stale",
      options: [option("so_ghost")],
      prices: { so_ghost: 1 },
    })

    expect(after.calculatedPrices).toEqual({ so_std: 12900 })
  })

  it("applies options, prices and the quoted signature when it matches", () => {
    const state = baseState()
    const after = checkoutReducer(state, {
      type: "QUOTE_READY",
      signature: state.quoteSignature!,
      options: [option("so_a"), option("so_b")],
      prices: { so_a: 100, so_b: 200 },
    })

    expect(after.quotedSignature).toBe(state.quoteSignature)
    expect(after.shippingOptions.map((o) => o.id)).toEqual(["so_a", "so_b"])
    expect(after.calculatedPrices).toEqual({ so_a: 100, so_b: 200 })
    expect(after.inFlightSignature).toBeNull()
  })
})

describe("QUOTE_STARTED", () => {
  it("records the in-flight signature", () => {
    const state = baseState()
    const after = checkoutReducer(state, {
      type: "QUOTE_STARTED",
      signature: state.quoteSignature!,
    })

    expect(after.inFlightSignature).toBe(state.quoteSignature)
  })
})

describe("QUOTE_FAILED", () => {
  it("does not advance quotedSignature, so the same address stays retryable", () => {
    const state = baseState()
    const signature = state.quoteSignature!

    // A quote is in flight for the current address; it then fails (no
    // destination move, so MAJ-2's commitDraft clearing is not involved here —
    // this isolates what QUOTE_FAILED itself does to quotedSignature).
    const started = checkoutReducer(state, {
      type: "QUOTE_STARTED",
      signature,
    })
    const failed = checkoutReducer(started, {
      type: "QUOTE_FAILED",
      signature,
    })

    // `QUOTE_FAILED` tracks the last SUCCESS only — it never advances
    // `quotedSignature` — so `evaluateQuoteReadiness` returns `quote` again for
    // the failed address instead of `already_quoted`.
    expect(failed.quotedSignature).toBe(state.quotedSignature)
    expect(failed.failedSignature).toBe(signature)
  })

  it("clears the held quote when a destination move precedes the failure (MAJ-2)", () => {
    const state = baseState()
    const quoted = run(state, {
      type: "QUOTE_READY",
      signature: state.quoteSignature!,
      options: [option("so_std")],
      prices: { so_std: 100 },
    })
    expect(quoted.quotedSignature).not.toBeNull()

    // Moving the destination clears the held quote via commitDraft (MAJ-2)
    // BEFORE any failure is recorded …
    const moved = checkoutReducer(quoted, {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })
    expect(moved.quotedSignature).toBeNull()

    const failed = checkoutReducer(moved, {
      type: "QUOTE_FAILED",
      signature: moved.quoteSignature!,
    })

    // … and QUOTE_FAILED leaves it cleared and parks the new signature.
    expect(failed.quotedSignature).toBeNull()
    expect(failed.failedSignature).toBe(moved.quoteSignature)
  })

  it("releases the in-flight slot", () => {
    const state = baseState()
    const started = checkoutReducer(state, {
      type: "QUOTE_STARTED",
      signature: state.quoteSignature!,
    })
    const failed = checkoutReducer(started, {
      type: "QUOTE_FAILED",
      signature: state.quoteSignature!,
    })

    expect(failed.inFlightSignature).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2a.3 — cart refresh, selection, and the returning cart
// ---------------------------------------------------------------------------

describe("CART_UPDATED", () => {
  it("replaces the cart and refreshes both address ids", () => {
    const state = baseState()
    const after = checkoutReducer(state, {
      type: "CART_UPDATED",
      sequence: 1,
      cart: cartWith({
        shipping_address: { id: "caaddr_99", ...CDMX },
        billing_address: { id: "baddr_77", ...CDMX },
      }),
    })

    expect(after.shippingAddressId).toBe("caaddr_99")
    expect(after.billingAddressId).toBe("baddr_77")
    expect(after.cart?.shipping_address?.id).toBe("caaddr_99")
  })

  it("never overwrites what the customer is typing", () => {
    const typed = checkoutReducer(baseState(), {
      type: "FIELD_CHANGE",
      field: "first_name",
      value: "Ana Sofía",
    })

    const after = checkoutReducer(typed, {
      type: "CART_UPDATED",
      sequence: 1,
      cart: cartWith({ shipping_address: { id: "caaddr_01", ...CDMX } }),
    })

    expect(after.draft.first_name).toBe("Ana Sofía")
  })

  it("does not re-select a shipping option the reducer just cleared", () => {
    // 2b.6 depends on this: after a postal-code change no radio may be checked,
    // and the cart STILL carries the method row (F1), so a naive
    // "read the selection back off the cart" would tick it again.
    const selected = run(
      baseState({ shipping_methods: [{ shipping_option_id: "so_std" }] }),
      selectShipping("so_std"),
      { type: "FIELD_BLUR", field: "postal_code", value: "44160" }
    )
    expect(selected.selectedShippingOptionId).toBeNull()

    const after = checkoutReducer(selected, {
      type: "CART_UPDATED",
      sequence: 1,
      cart: cartWith({ shipping_methods: [{ shipping_option_id: "so_std" }] }),
    })

    expect(after.selectedShippingOptionId).toBeNull()
  })
})

describe("SELECT_SHIPPING_OPTION", () => {
  it("records the signature in force at the moment of selection", () => {
    const state = baseState()
    const after = checkoutReducer(state, selectShipping("so_std")(state))

    expect(after.selectedShippingOptionId).toBe("so_std")
    expect(after.selectionSignature).toBe(state.quoteSignature)
  })

  /**
   * The race, and the reason `signature` is a required field on the action
   * rather than something the reducer reads off its own state.
   *
   * `setShippingMethod` is awaited before the dispatch, and a customer can edit
   * the postal code while that request is in the air. When the reducer stamped
   * `state.quoteSignature` at reduce time, the selection was recorded as
   * belonging to the destination that arrived DURING the round trip: the radio
   * rendered checked for an option only ever priced for the old postal code,
   * `shipping_method_stale` never fired, and the summary presented that total as
   * final. Settled decision 1 exists to prevent exactly that, and an awaited
   * continuation walked straight through it.
   *
   * Carrying the click-time signature makes the comparison downstream true by
   * construction: if the destination moved, the captured signature no longer
   * matches and the selection is stale the moment it lands.
   */
  it("lands STALE when the destination moved while the request was in flight", () => {
    // The cart carries the method row: per finding F1 there is no store API to
    // remove one, so `hasShippingMethod` stays true and the ONLY thing that can
    // raise `shipping_method_stale` is a selection signature that disagrees with
    // the current one. Without the row on the cart this test would pass for the
    // wrong reason.
    const onScreen = baseState({
      shipping_methods: [{ shipping_option_id: "so_std" }],
      billing_address: { id: "baddr_01", ...CDMX },
    })
    const signatureTheCustomerSaw = onScreen.quoteSignature
    expect(signatureTheCustomerSaw).not.toBeNull()

    // The customer edits the postal code while `setShippingMethod` is in flight.
    const moved = checkoutReducer(onScreen, {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })
    expect(moved.quoteSignature).not.toBe(signatureTheCustomerSaw)

    // The response lands, carrying the signature captured at click time.
    const landed = checkoutReducer(moved, {
      type: "SELECT_SHIPPING_OPTION",
      optionId: "so_std",
      signature: signatureTheCustomerSaw,
    })

    expect(landed.selectionSignature).toBe(signatureTheCustomerSaw)
    expect(landed.selectionSignature).not.toBe(landed.quoteSignature)
    expect(selectShippingIsProvisional(landed)).toBe(true)
    expect(
      getMissingOrderRequirements(selectReadinessInput(landed)).map((r) => r.code)
    ).toContain("shipping_method_stale")
  })
})

describe("initFromServer", () => {
  it("derives a quote signature from a returning cart's address", () => {
    expect(baseState().quoteSignature).not.toBeNull()
  })

  it("derives no signature when the persisted address is not quotable", () => {
    const state = baseState({
      shipping_address: { id: "caaddr_01", ...CDMX, postal_code: "" },
    })
    expect(state.quoteSignature).toBeNull()
  })

  it("seeds the draft from the persisted address", () => {
    expect(baseState().draft.first_name).toBe("Ana")
    expect(baseState().draft.postal_code).toBe("06700")
  })

  it("seeds the selection from the cart and does not mark it stale", () => {
    const state = baseState({
      shipping_methods: [{ shipping_option_id: "so_std" }],
    })

    expect(state.selectedShippingOptionId).toBe("so_std")
    expect(state.selectionSignature).toBe(state.quoteSignature)
  })

  it("falls back to the customer email when the cart has none", () => {
    const state = initFromServer({
      cart: cartWith({ email: null }),
      customer: { email: "socia@example.com" } as HttpTypes.StoreCustomer,
      shippingOptions: [],
    })

    expect(state.email).toBe("socia@example.com")
  })

  it("tolerates a null cart", () => {
    const state = initFromServer({
      cart: null,
      customer: null,
      shippingOptions: null,
    })

    expect(state.cart).toBeNull()
    expect(state.quoteSignature).toBeNull()
    expect(state.draft.postal_code).toBe("")
  })
})

// ---------------------------------------------------------------------------
// 2a.5 — TRIANGULATE. Ordering traps a naive implementation passes.
// ---------------------------------------------------------------------------

describe("write supersession (design.md §14 item 1)", () => {
  const cartNamed = (firstName: string) =>
    cartWith({
      shipping_address: { id: "caaddr_01", ...CDMX, first_name: firstName },
    })

  it("drops a response for a write that a newer write has already superseded", () => {
    // Write 1 issued, write 2 issued, THEN write 1 answers. Its cart is a
    // snapshot from before write 2 and applying it would undo write 2.
    const state = run(
      baseState(),
      { type: "CART_WRITE_STARTED", sequence: 1 },
      { type: "CART_WRITE_STARTED", sequence: 2 }
    )

    const after = checkoutReducer(state, {
      type: "CART_UPDATED",
      sequence: 1,
      cart: cartNamed("STALE"),
    })

    expect(after.cart?.shipping_address?.first_name).not.toBe("STALE")
    expect(after.appliedWriteSequence).toBe(0)
  })

  it("drops an older response that arrives after a newer one was applied", () => {
    const state = run(
      baseState(),
      { type: "CART_WRITE_STARTED", sequence: 1 },
      { type: "CART_WRITE_STARTED", sequence: 2 },
      { type: "CART_UPDATED", sequence: 2, cart: cartNamed("NEWEST") }
    )
    expect(state.cart?.shipping_address?.first_name).toBe("NEWEST")

    const after = checkoutReducer(state, {
      type: "CART_UPDATED",
      sequence: 1,
      cart: cartNamed("STALE"),
    })

    expect(after.cart?.shipping_address?.first_name).toBe("NEWEST")
  })

  it("applies responses that arrive in order", () => {
    const after = run(
      baseState(),
      { type: "CART_WRITE_STARTED", sequence: 1 },
      { type: "CART_UPDATED", sequence: 1, cart: cartNamed("UNO") },
      { type: "CART_WRITE_STARTED", sequence: 2 },
      { type: "CART_UPDATED", sequence: 2, cart: cartNamed("DOS") }
    )

    expect(after.cart?.shipping_address?.first_name).toBe("DOS")
    expect(after.appliedWriteSequence).toBe(2)
  })

  it("drops a duplicate response for a sequence already applied", () => {
    const state = run(
      baseState(),
      { type: "CART_WRITE_STARTED", sequence: 1 },
      { type: "CART_UPDATED", sequence: 1, cart: cartNamed("UNO") }
    )

    const after = checkoutReducer(state, {
      type: "CART_UPDATED",
      sequence: 1,
      cart: cartNamed("DUPLICADO"),
    })

    expect(after.cart?.shipping_address?.first_name).toBe("UNO")
  })

  it("refreshes the address id when the server hands back a different row", () => {
    // The destructive path this whole change exists to close: if the backend
    // ever DOES replace the row, the client must adopt the new id immediately
    // rather than keep pointing at a row that no longer exists.
    const after = run(
      baseState(),
      { type: "CART_WRITE_STARTED", sequence: 1 },
      {
        type: "CART_UPDATED",
        sequence: 1,
        cart: cartWith({ shipping_address: { id: "caaddr_NEW", ...CDMX } }),
      }
    )

    expect(after.shippingAddressId).toBe("caaddr_NEW")
  })

  it("lets an old failure overwrite neither a newer write's status nor its cart", () => {
    const state = run(
      baseState(),
      { type: "CART_WRITE_STARTED", sequence: 1 },
      { type: "CART_WRITE_STARTED", sequence: 2 },
      { type: "CART_UPDATED", sequence: 2, cart: cartNamed("NEWEST") }
    )
    expect(state.autosaveStatus).toBe("saved")

    const after = checkoutReducer(state, {
      type: "CART_WRITE_FAILED",
      sequence: 1,
    })

    expect(after.autosaveStatus).toBe("saved")
  })

  it("reports a failure of the newest write", () => {
    const after = run(
      baseState(),
      { type: "CART_WRITE_STARTED", sequence: 1 },
      { type: "CART_WRITE_FAILED", sequence: 1 }
    )

    expect(after.autosaveStatus).toBe("error")
  })
})

describe("quote ordering traps", () => {
  it("drops the older of two results that arrive out of order", () => {
    const first = baseState()
    const signatureA = first.quoteSignature!

    const movedToB = run(
      first,
      { type: "QUOTE_STARTED", signature: signatureA },
      { type: "FIELD_BLUR", field: "postal_code", value: "44160" }
    )
    const signatureB = movedToB.quoteSignature!
    expect(signatureB).not.toBe(signatureA)

    // B answers first…
    const withB = run(
      movedToB,
      { type: "QUOTE_STARTED", signature: signatureB },
      {
        type: "QUOTE_READY",
        signature: signatureB,
        options: [option("so_b")],
        prices: { so_b: 200 },
      }
    )
    // …then A, late, for an address the customer left.
    const withLateA = checkoutReducer(withB, {
      type: "QUOTE_READY",
      signature: signatureA,
      options: [option("so_a")],
      prices: { so_a: 100 },
    })

    expect(withLateA.calculatedPrices).toEqual({ so_b: 200 })
    expect(withLateA.quotedSignature).toBe(signatureB)
  })

  it("releases the in-flight slot when a superseded result lands", () => {
    // Without this the customer could type back to an address whose request is
    // still recorded as running, and `evaluateQuoteReadiness` would answer
    // `already_in_flight` forever.
    const first = baseState()
    const signatureA = first.quoteSignature!

    const stranded = run(
      first,
      { type: "QUOTE_STARTED", signature: signatureA },
      { type: "FIELD_BLUR", field: "postal_code", value: "0670" }
    )
    expect(stranded.quoteSignature).toBeNull()
    expect(stranded.inFlightSignature).toBe(signatureA)

    const released = checkoutReducer(stranded, {
      type: "QUOTE_READY",
      signature: signatureA,
      options: [option("so_a")],
      prices: { so_a: 100 },
    })

    expect(released.inFlightSignature).toBeNull()

    const backToA = checkoutReducer(released, {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "06700",
    })

    expect(
      evaluateQuoteReadiness({
        draftAddress: selectQuoteRelevantAddress(backToA.draft),
        lastRequestedSignature: backToA.quotedSignature,
        inFlightSignature: backToA.inFlightSignature,
        cartId: backToA.cart?.id,
      }).action
    ).toBe("quote")
  })

  /**
   * The customer-visible end of the release rule, and the contract the requote
   * effect now leans on entirely.
   *
   * `QUOTE_STARTED` claims `inFlightSignature`, and ONLY a `QUOTE_READY` or a
   * `QUOTE_FAILED` for that signature ever gives it back. The effect used to hold
   * a `cancelled` flag that returned WITHOUT dispatching on the success path — so
   * a customer who edited the postal code mid-flight leaked the slot, and typing
   * their way back to that address left `selectQuoteStatus` reporting `"quoting"`
   * forever with nothing running. That flag is gone; every completed round now
   * dispatches.
   *
   * Honest about what this test is: it is GREEN before the deletion too, because
   * the leak lived entirely in the `.tsx` effect and this repo's runner is
   * node-only. It is a regression guard on the reducer half of the contract — if
   * the superseded branch is ever "simplified" to a bare `return state`, this is
   * what objects, and the effect has no cancellation of its own left to hide it.
   */
  it("recovers a quotable status after a mid-flight edit and a return", () => {
    const first = baseState()
    const signatureA = first.quoteSignature!

    const movedAway = run(
      first,
      { type: "QUOTE_STARTED", signature: signatureA },
      { type: "FIELD_BLUR", field: "postal_code", value: "44160" }
    )
    expect(movedAway.inFlightSignature).toBe(signatureA)

    // A's round finishes for an address the customer has left. The effect
    // dispatches it anyway; the reducer decides.
    const superseded = checkoutReducer(movedAway, {
      type: "QUOTE_READY",
      signature: signatureA,
      options: [option("so_a")],
      prices: { so_a: 100 },
    })
    expect(superseded.quotedSignature).toBeNull()
    expect(superseded.inFlightSignature).toBeNull()

    const backToA = checkoutReducer(superseded, {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "06700",
    })
    expect(backToA.quoteSignature).toBe(signatureA)

    // Not permanently "quoting" with nothing running: a fresh round is allowed.
    expect(
      evaluateQuoteReadiness({
        draftAddress: selectQuoteRelevantAddress(backToA.draft),
        lastRequestedSignature: backToA.quotedSignature,
        inFlightSignature: backToA.inFlightSignature,
        cartId: backToA.cart?.id,
      })
    ).toMatchObject({ action: "quote", signature: signatureA })

    const requoted = run(
      backToA,
      { type: "QUOTE_STARTED", signature: signatureA },
      {
        type: "QUOTE_READY",
        signature: signatureA,
        options: [option("so_a")],
        prices: { so_a: 100 },
      }
    )
    expect(selectQuoteStatus(requoted)).toBe("quoted")
    expect(selectShippingChoices(requoted)).toHaveLength(1)
  })

  it("does not release an in-flight slot belonging to a different request", () => {
    const state = baseState()
    const started = checkoutReducer(state, {
      type: "QUOTE_STARTED",
      signature: state.quoteSignature!,
    })

    const after = checkoutReducer(started, {
      type: "QUOTE_READY",
      signature: "some-other-signature",
      options: [],
      prices: {},
    })

    expect(after.inFlightSignature).toBe(state.quoteSignature)
  })

  it("ignores a failure reported for an address the customer already left", () => {
    const state = baseState()
    const signatureA = state.quoteSignature!
    const moved = checkoutReducer(state, {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })

    const after = checkoutReducer(moved, {
      type: "QUOTE_FAILED",
      signature: signatureA,
    })

    expect(after.failedSignature).toBeNull()
    expect(selectQuoteIsBlockedByFailure(after)).toBe(false)
  })

  it("clears a recorded failure once the customer edits the destination", () => {
    const state = baseState()
    const failed = checkoutReducer(state, {
      type: "QUOTE_FAILED",
      signature: state.quoteSignature!,
    })
    expect(selectQuoteIsBlockedByFailure(failed)).toBe(true)

    const edited = checkoutReducer(failed, {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })

    expect(selectQuoteIsBlockedByFailure(edited)).toBe(false)
  })

  it("clears a recorded failure on an explicit retry", () => {
    const state = baseState()
    const failed = checkoutReducer(state, {
      type: "QUOTE_FAILED",
      signature: state.quoteSignature!,
    })

    expect(
      selectQuoteIsBlockedByFailure(
        checkoutReducer(failed, { type: "QUOTE_RETRY" })
      )
    ).toBe(false)
  })

  it("forgets a failure once the customer leaves and returns to that address", () => {
    // The failure record must not be a permanent mark on a destination. If it
    // survived a round trip A -> B -> A, the customer would be locked out of
    // the only address they want, with no way to clear it short of a reload.
    const state = baseState()
    const failed = checkoutReducer(state, {
      type: "QUOTE_FAILED",
      signature: state.quoteSignature!,
    })

    const roundTrip = run(
      failed,
      { type: "FIELD_BLUR", field: "postal_code", value: "44160" },
      { type: "FIELD_BLUR", field: "postal_code", value: "06700" }
    )

    expect(roundTrip.quoteSignature).toBe(state.quoteSignature)
    expect(roundTrip.failedSignature).toBeNull()
    expect(selectQuoteIsBlockedByFailure(roundTrip)).toBe(false)
  })

  it("keeps a street edit from disturbing an in-flight quote", () => {
    const state = baseState()
    const started = checkoutReducer(state, {
      type: "QUOTE_STARTED",
      signature: state.quoteSignature!,
    })

    const after = checkoutReducer(started, {
      type: "FIELD_BLUR",
      field: "address_1",
      value: "Otra calle 55",
    })

    expect(after.inFlightSignature).toBe(state.quoteSignature)
    expect(after.quoteSignature).toBe(state.quoteSignature)
  })
})

describe("selectQuoteStatus", () => {
  it("is idle before a valid postal code exists", () => {
    const state = baseState({
      shipping_address: { id: "caaddr_01", ...CDMX, postal_code: "" },
    })
    expect(selectQuoteStatus(state)).toBe("idle")
  })

  it("is looking_up while SEPOMEX is in flight, even with a complete address", () => {
    const state = checkoutReducer(baseState(), { type: "CP_LOOKUP_STARTED" })
    expect(selectQuoteStatus(state)).toBe("looking_up")
  })

  it("is quoting while a request for the current address runs", () => {
    const state = baseState()
    expect(
      selectQuoteStatus(
        checkoutReducer(state, {
          type: "QUOTE_STARTED",
          signature: state.quoteSignature!,
        })
      )
    ).toBe("quoting")
  })

  it("is quoting while the debounce is still pending, so old prices cannot look current", () => {
    const state = baseState()
    const quoted = checkoutReducer(state, {
      type: "QUOTE_READY",
      signature: state.quoteSignature!,
      options: [option("so_std")],
      prices: { so_std: 12900 },
    })
    const moved = checkoutReducer(quoted, {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })

    expect(selectQuoteStatus(moved)).toBe("quoting")
  })

  it("is quoted when options came back for the current address", () => {
    const state = baseState()
    expect(
      selectQuoteStatus(
        checkoutReducer(state, {
          type: "QUOTE_READY",
          signature: state.quoteSignature!,
          options: [option("so_std")],
          prices: { so_std: 12900 },
        })
      )
    ).toBe("quoted")
  })

  it("is not_serviceable when the list came back empty", () => {
    const state = baseState()
    expect(
      selectQuoteStatus(
        checkoutReducer(state, {
          type: "QUOTE_READY",
          signature: state.quoteSignature!,
          options: [],
          prices: {},
        })
      )
    ).toBe("not_serviceable")
  })

  it("is failed when the request for the current address errored", () => {
    const state = baseState()
    expect(
      selectQuoteStatus(
        checkoutReducer(state, {
          type: "QUOTE_FAILED",
          signature: state.quoteSignature!,
        })
      )
    ).toBe("failed")
  })

  it("goes back to quoting while a retry of a failed address is in flight", () => {
    // An in-flight request outranks the failure it is retrying. Reporting
    // `failed` here would show the customer an error and a Reintentar button
    // for a request that is running right now.
    const state = baseState()
    const retrying = run(
      state,
      { type: "QUOTE_FAILED", signature: state.quoteSignature! },
      { type: "QUOTE_RETRY" },
      { type: "QUOTE_STARTED", signature: state.quoteSignature! }
    )
    expect(selectQuoteStatus(retrying)).toBe("quoting")

    // …and even if the failure record were still present.
    expect(
      selectQuoteStatus({
        ...retrying,
        failedSignature: state.quoteSignature,
      })
    ).toBe("quoting")
  })

  it("never reports failed because SEPOMEX found nothing", () => {
    // A postal-code miss degrades to manual entry. It is not a quote failure and
    // must not present itself as one.
    const state = checkoutReducer(baseState(), { type: "CP_LOOKUP_NOT_FOUND", postalCode: "06700" })

    expect(state.cpStatus).toBe("not_found")
    expect(selectQuoteStatus(state)).not.toBe("failed")
  })
})

describe("SEPOMEX lookup", () => {
  it("completes the signature from a postal code alone (R4 / S3)", () => {
    const blank = initFromServer({
      cart: cartWith({ shipping_address: null }),
      customer: null,
      shippingOptions: [],
    })
    expect(blank.quoteSignature).toBeNull()

    const typed = run(
      blank,
      { type: "FIELD_CHANGE", field: "country_code", value: "mx" },
      { type: "FIELD_CHANGE", field: "postal_code", value: "06700" }
    )
    // Five digits and a country are still not quotable — no state, no city.
    expect(typed.quoteSignature).toBeNull()

    const resolved = checkoutReducer(typed, {
      type: "CP_LOOKUP_FOUND",
      postalCode: "06700",
      province: "CDMX",
      city: "Ciudad de México",
      colonias: ["Roma Norte", "Roma Sur"],
    })

    /**
     * S3: province + city from SEPOMEX is no longer sufficient — the colonia is
     * now a signature component, so the draft (which had no colonia) is still
     * not quotable. The street stays empty; the customer must pick a colonia.
     */
    expect(resolved.quoteSignature).toBeNull()
    expect(resolved.draft.address_1).toBe("")

    // Picking a colonia from the returned list completes the signature.
    const withColonia = checkoutReducer(resolved, {
      type: "FIELD_CHANGE",
      field: "address_2",
      value: "Roma Norte",
    })
    expect(withColonia.quoteSignature).not.toBeNull()
  })

  it("keeps a colonia that is not in the returned list as free text", () => {
    const state = checkoutReducer(baseState(), {
      type: "CP_LOOKUP_FOUND",
      postalCode: "06700",
      province: "CDMX",
      city: "Ciudad de México",
      colonias: ["Condesa", "Juárez"],
    })

    expect(state.draft.address_2).toBe("Roma Norte")
    expect(state.coloniaManual).toBe(true)
  })

  it("uses the dropdown when the saved colonia IS in the returned list", () => {
    const state = checkoutReducer(baseState(), {
      type: "CP_LOOKUP_FOUND",
      postalCode: "06700",
      province: "CDMX",
      city: "Ciudad de México",
      colonias: ["Roma Norte", "Roma Sur"],
    })

    expect(state.coloniaManual).toBe(false)
  })

  it("clears the message and the colonia list when the postal code stops being usable", () => {
    // Otherwise "No encontramos ese código postal" stays on screen after the
    // customer has deleted the digits it was about, and a colonia dropdown
    // keeps offering colonias for a postal code that is no longer entered.
    // The unusable-postal-code path is now CP_LOOKUP_DISCARDED (S2 split).
    const missed = checkoutReducer(baseState(), { type: "CP_LOOKUP_NOT_FOUND", postalCode: "06700" })
    expect(missed.cpStatus).toBe("not_found")

    expect(checkoutReducer(missed, { type: "CP_LOOKUP_DISCARDED" }).cpStatus).toBe(
      "idle"
    )

    const listed = checkoutReducer(baseState(), {
      type: "CP_LOOKUP_FOUND",
      postalCode: "06700",
      province: "CDMX",
      city: "Ciudad de México",
      colonias: ["Roma Norte", "Roma Sur"],
    })
    expect(listed.colonias).toHaveLength(2)

    expect(
      checkoutReducer(listed, { type: "CP_LOOKUP_DISCARDED" }).colonias
    ).toEqual([])
  })

  it("returns the identical state object when there is nothing to reset", () => {
    // Cheap, but not cosmetic: this action fires from an effect that runs on
    // every postal-code change, and a fresh object each time is a re-render of
    // the whole checkout tree for no reason.
    const state = baseState()
    expect(checkoutReducer(state, { type: "CP_LOOKUP_DISCARDED" })).toBe(state)
  })

  /**
   * ## The stale-lookup rule (D2)
   *
   * `CP_LOOKUP_FOUND` used to carry no postal code at all, which made the reducer
   * STRUCTURALLY incapable of rejecting a result for an address the customer had
   * already left. The provider compensated with a `cancelled` flag in the effect's
   * cleanup — and that flag is what stranded `cpStatus` at `"loading"` forever,
   * because it also swallowed results that were perfectly current.
   *
   * The repro was routine, not exotic: the customer types a postal code and blurs;
   * the 400 ms autosave persists it; `CART_UPDATED` moves
   * `cart.shipping_address.postal_code` from undefined to that code; the lookup
   * effect re-runs because that field is in its dep array; cleanup sets
   * `cancelled = true`; the new effect body early-returns on the dedupe ref because
   * the postal code did not change. SEPOMEX then answers into a dead callback.
   * `cpStatus` stays `"loading"`, `selectQuoteStatus` short-circuits on it and
   * returns `"looking_up"` ahead of everything else, and the order can never be
   * placed. Any SEPOMEX latency above roughly one autosave debounce plus a server
   * round trip reaches it.
   *
   * The decision moves here, where a spec can contradict it: the action carries the
   * postal code it was requested FOR, and the reducer compares it against the
   * draft. The effect keeps only its dedupe ref, which guards an external call
   * rather than a state transition — the two guards no longer own the same
   * decision.
   */
  describe("a result for a postal code the customer has left", () => {
    it("is dropped whole rather than overwriting the current destination", () => {
      // The customer typed 44100, then moved on to 06700 before SEPOMEX answered.
      // Applying the late answer writes Jalisco/Guadalajara onto a draft whose
      // postal code is 06700 — a destination that does not exist, quoted as if it
      // did.
      const moved = run(
        baseState(),
        { type: "FIELD_BLUR", field: "postal_code", value: "44100" },
        { type: "CP_LOOKUP_STARTED" },
        { type: "FIELD_BLUR", field: "postal_code", value: "06700" },
        { type: "CP_LOOKUP_STARTED" }
      )

      const late = checkoutReducer(moved, {
        type: "CP_LOOKUP_FOUND",
        postalCode: "44100",
        province: "Jalisco",
        city: "Guadalajara",
        colonias: ["Americana"],
      })

      expect(late.draft.province).toBe("CDMX")
      expect(late.draft.city).toBe("Ciudad de México")
      expect(late.colonias).toEqual([])
      // The lookup for 06700 is genuinely still running, so `loading` is the
      // honest answer — not a leftover.
      expect(late.cpStatus).toBe("loading")
      expect(late).toBe(moved)
    })

    it("does not let a late miss wipe a list that did resolve", () => {
      // 44100 misses, 06700 hits, and the miss lands last. Without the postal code
      // on the action the colonia dropdown vanishes for a postal code SEPOMEX
      // answered, and "No encontramos ese código postal" appears under one it
      // found.
      const resolved = run(
        baseState(),
        { type: "FIELD_BLUR", field: "postal_code", value: "44100" },
        { type: "CP_LOOKUP_STARTED" },
        { type: "FIELD_BLUR", field: "postal_code", value: "06700" },
        { type: "CP_LOOKUP_STARTED" },
        {
          type: "CP_LOOKUP_FOUND",
          postalCode: "06700",
          province: "CDMX",
          city: "Ciudad de México",
          colonias: ["Roma Norte", "Roma Sur"],
        }
      )
      expect(resolved.cpStatus).toBe("found")

      const late = checkoutReducer(resolved, {
        type: "CP_LOOKUP_NOT_FOUND",
        postalCode: "44100",
      })

      expect(late.cpStatus).toBe("found")
      expect(late.colonias).toEqual(["Roma Norte", "Roma Sur"])
      expect(late).toBe(resolved)
    })

    /**
     * The other half, and the one the effect now depends on: a result for the
     * postal code STILL in the draft must always land, however much else moved
     * while it was in the air. This is what makes dropping the `cancelled` flag
     * safe — the reducer, not the cleanup function, decides what is stale.
     */
    it("still applies once the autosave has caught the cart up", () => {
      const inFlight = run(
        baseState({ shipping_address: null }),
        { type: "FIELD_BLUR", field: "postal_code", value: "44100" },
        { type: "CP_LOOKUP_STARTED" }
      )
      expect(inFlight.cpStatus).toBe("loading")

      // The 400 ms autosave lands first — this is the dep-array change that used
      // to re-run the effect and set `cancelled`.
      const persisted = run(
        inFlight,
        { type: "CART_WRITE_STARTED", sequence: 1 },
        {
          type: "CART_UPDATED",
          sequence: 1,
          cart: cartWith({
            shipping_address: { id: "caaddr_01", ...CDMX, postal_code: "44100" },
          }),
        }
      )

      const found = checkoutReducer(persisted, {
        type: "CP_LOOKUP_FOUND",
        postalCode: "44100",
        province: "Jalisco",
        city: "Guadalajara",
        colonias: ["Americana"],
      })

      expect(found.cpStatus).toBe("found")
      expect(selectQuoteStatus(found)).not.toBe("looking_up")
    })

    it("compares on the trimmed postal code", () => {
      const typed = run(
        baseState(),
        { type: "FIELD_BLUR", field: "postal_code", value: "44100" },
        { type: "CP_LOOKUP_STARTED" }
      )

      const found = checkoutReducer(typed, {
        type: "CP_LOOKUP_FOUND",
        postalCode: " 44100 ",
        province: "Jalisco",
        city: "Guadalajara",
        colonias: [],
      })

      expect(found.cpStatus).toBe("found")
    })
  })

  it("clears the colonia when the customer asks to type one", () => {
    const state = checkoutReducer(baseState(), {
      type: "COLONIA_MANUAL_REQUESTED",
    })

    expect(state.coloniaManual).toBe(true)
    expect(state.draft.address_2).toBe("")
  })
})

/**
 * S3 — the colonia becomes a quote input.
 *
 * The colonia (`address_2`) now moves the signature (`shipping-quote.ts`), which
 * turns two latent defects into real ones and requires the draft projection to
 * carry the colonia through. All three are asserted here.
 */
describe("colonia in the quote signature (S3)", () => {
  it("projects the draft colonia into the quote-relevant address (S3.1)", () => {
    const draft = { ...baseState().draft, address_2: "Condesa" }

    expect(selectQuoteRelevantAddress(draft).address_2).toBe("Condesa")
  })

  it("moves the draft-derived signature when only the colonia changes", () => {
    const withNorte = run(baseState(), {
      type: "FIELD_CHANGE",
      field: "address_2",
      value: "Roma Norte",
    })
    const withSur = run(baseState(), {
      type: "FIELD_CHANGE",
      field: "address_2",
      value: "Roma Sur",
    })

    expect(withNorte.quoteSignature).not.toBeNull()
    expect(withNorte.quoteSignature).not.toBe(withSur.quoteSignature)
  })

  /**
   * MAJ-2. `commitDraft` clears `calculatedPrices` on a signature change but,
   * before S3, never cleared `quotedSignature`. With the colonia in the
   * signature a colonia X -> Y -> X round-trip inside the debounce leaves
   * `quoteSignature === quotedSignature` with `calculatedPrices === {}`, so the
   * section falsely reports `quoted` with every row unpriced and no retry. The
   * two facts describe the same round and MUST be cleared together.
   */
  describe("commitDraft clears quotedSignature with calculatedPrices (MAJ-2)", () => {
    const quotedAtNorte = () => {
      const draftNorte = run(baseState(), {
        type: "FIELD_CHANGE",
        field: "address_2",
        value: "Roma Norte",
      })
      const signatureNorte = draftNorte.quoteSignature as string

      // Land a successful quote for the current (Roma Norte) destination.
      return checkoutReducer(draftNorte, {
        type: "QUOTE_READY",
        signature: signatureNorte,
        options: [option("so_std")],
        prices: { so_std: 12345 },
      })
    }

    it("clears quotedSignature when a colonia change moves the destination", () => {
      const quoted = quotedAtNorte()
      expect(quoted.quotedSignature).toBe(quoted.quoteSignature)

      const movedToSur = checkoutReducer(quoted, {
        type: "FIELD_CHANGE",
        field: "address_2",
        value: "Roma Sur",
      })

      // The destination moved, so the held prices are dropped …
      expect(movedToSur.calculatedPrices).toEqual({})
      // … and `quotedSignature` MUST be dropped alongside them, or the section
      // reports `quoted` for a colonia whose prices were just discarded.
      expect(movedToSur.quotedSignature).toBeNull()
    })

    it("does not falsely report quoted on a colonia X -> Y -> X round-trip", () => {
      const quoted = quotedAtNorte()

      const bounced = run(
        quoted,
        { type: "FIELD_CHANGE", field: "address_2", value: "Roma Sur" },
        { type: "FIELD_CHANGE", field: "address_2", value: "Roma Norte" }
      )

      // Back at Roma Norte the signature equals the one we quoted, but the
      // prices are gone — so `quotedSignature` must NOT still equal it.
      expect(bounced.quotedSignature).toBeNull()
      expect(selectQuoteStatus(bounced)).not.toBe("quoted")
    })

    it("leaves quotedSignature intact when the draft change does not move the destination", () => {
      const quoted = quotedAtNorte()

      // A street edit cannot move the signature — the held quote stands.
      const streetEdit = checkoutReducer(quoted, {
        type: "FIELD_CHANGE",
        field: "address_1",
        value: "Calle Durango 12",
      })

      expect(streetEdit.quoteSignature).toBe(quoted.quoteSignature)
      expect(streetEdit.quotedSignature).toBe(quoted.quotedSignature)
      expect(streetEdit.calculatedPrices).toEqual(quoted.calculatedPrices)
    })
  })

  /**
   * MAJ-1. `COLONIA_MANUAL_REQUESTED` was the only draft write that bypassed
   * `commitDraft`: it cleared `address_2` while `quoteSignature` stayed put, so
   * with the colonia now in the signature the section kept reporting `quoted`
   * and rendering prices for a colonia just cleared. Routing it through
   * `commitDraft` makes the draft-derived signature go non-null -> null.
   */
  describe("COLONIA_MANUAL_REQUESTED routes through commitDraft (MAJ-1)", () => {
    it("drives the signature non-null -> null when it clears the colonia", () => {
      // Arrange a quotable draft (colonia present -> non-null signature).
      const quotable = run(baseState(), {
        type: "FIELD_CHANGE",
        field: "address_2",
        value: "Roma Norte",
      })
      expect(quotable.quoteSignature).not.toBeNull()

      const cleared = checkoutReducer(quotable, {
        type: "COLONIA_MANUAL_REQUESTED",
      })

      // The colonia is cleared AND the signature recomputes to null, so the
      // section can no longer report `quoted` for the cleared colonia.
      expect(cleared.draft.address_2).toBe("")
      expect(cleared.coloniaManual).toBe(true)
      expect(cleared.quoteSignature).toBeNull()
    })

    it("drops held prices and quotedSignature when it clears the colonia", () => {
      const draftNorte = run(baseState(), {
        type: "FIELD_CHANGE",
        field: "address_2",
        value: "Roma Norte",
      })
      const quoted = checkoutReducer(draftNorte, {
        type: "QUOTE_READY",
        signature: draftNorte.quoteSignature as string,
        options: [option("so_std")],
        prices: { so_std: 12345 },
      })
      expect(quoted.quotedSignature).not.toBeNull()

      const cleared = checkoutReducer(quoted, {
        type: "COLONIA_MANUAL_REQUESTED",
      })

      expect(cleared.calculatedPrices).toEqual({})
      expect(cleared.quotedSignature).toBeNull()
    })
  })
})

/**
 * S2 — the CP_LOOKUP_RESET split.
 *
 * The single collapsed reset conflates two facts: "no lookup is in flight" and
 * "there is no list to show". A usable postal code whose lookup merely finished
 * must keep its colonia list (otherwise the autosave round-trip wipes a list the
 * moment it arrives and `address_2` stays empty); an unusable postal code must
 * drop it. Two actions, chosen by the pure {@link selectPostalCodeIsUsable}.
 */
describe("CP_LOOKUP_NOT_NEEDED (usable postal code, no lookup in flight)", () => {
  const listed = () =>
    checkoutReducer(baseState(), {
      type: "CP_LOOKUP_FOUND",
      postalCode: "06700",
      province: "CDMX",
      city: "Ciudad de México",
      colonias: ["Roma Norte", "Roma Sur"],
    })

  it("sets cpStatus to idle and leaves the colonia list untouched", () => {
    const state = listed()
    expect(state.colonias).toHaveLength(2)

    const reset = checkoutReducer(state, { type: "CP_LOOKUP_NOT_NEEDED" })

    expect(reset.cpStatus).toBe("idle")
    expect(reset.colonias).toEqual(["Roma Norte", "Roma Sur"])
    expect(reset.coloniasPostalCode).toBe("06700")
  })

  it("leaves the manual-colonia flag untouched", () => {
    const manual = checkoutReducer(listed(), {
      type: "COLONIA_MANUAL_REQUESTED",
    })
    expect(manual.coloniaManual).toBe(true)

    const reset = checkoutReducer(manual, { type: "CP_LOOKUP_NOT_NEEDED" })

    expect(reset.coloniaManual).toBe(true)
  })

  it("returns the identical state object when the status is already idle", () => {
    // Fires from an effect on every postal-code change; a fresh object each
    // time re-renders the whole checkout tree for no reason.
    const state = baseState()
    expect(state.cpStatus).toBe("idle")
    expect(checkoutReducer(state, { type: "CP_LOOKUP_NOT_NEEDED" })).toBe(state)
  })
})

describe("CP_LOOKUP_DISCARDED (postal code not usable)", () => {
  const listed = () =>
    checkoutReducer(baseState(), {
      type: "CP_LOOKUP_FOUND",
      postalCode: "06700",
      province: "CDMX",
      city: "Ciudad de México",
      colonias: ["Roma Norte", "Roma Sur"],
    })

  it("sets cpStatus to idle, empties the list and clears its postal code", () => {
    const state = listed()
    expect(state.colonias).toHaveLength(2)
    expect(state.coloniasPostalCode).toBe("06700")

    const reset = checkoutReducer(state, { type: "CP_LOOKUP_DISCARDED" })

    expect(reset.cpStatus).toBe("idle")
    expect(reset.colonias).toEqual([])
    expect(reset.coloniasPostalCode).toBeNull()
  })

  it("leaves the manual-colonia flag untouched", () => {
    const manual = checkoutReducer(listed(), {
      type: "COLONIA_MANUAL_REQUESTED",
    })
    expect(manual.coloniaManual).toBe(true)

    const reset = checkoutReducer(manual, { type: "CP_LOOKUP_DISCARDED" })

    expect(reset.coloniaManual).toBe(true)
  })

  it("returns the identical state object when there is nothing to discard", () => {
    const state = baseState()
    expect(state.cpStatus).toBe("idle")
    expect(state.colonias).toEqual([])
    expect(checkoutReducer(state, { type: "CP_LOOKUP_DISCARDED" })).toBe(state)
  })
})

describe("selectPostalCodeIsUsable", () => {
  const listedFor = (postalCode: string) =>
    checkoutReducer(
      checkoutReducer(baseState({ shipping_address: null }), {
        type: "FIELD_CHANGE",
        field: "postal_code",
        value: postalCode,
      }),
      {
        type: "CP_LOOKUP_FOUND",
        postalCode,
        province: "CDMX",
        city: "Ciudad de México",
        colonias: ["Roma Norte", "Roma Sur"],
      }
    )

  it.each(["", "067", "0670a", "abcde", "067000"])(
    "is false for the postal code %o that fails the pattern",
    (value) => {
      const typed = checkoutReducer(baseState(), {
        type: "FIELD_CHANGE",
        field: "postal_code",
        value,
      })

      expect(selectPostalCodeIsUsable(typed)).toBe(false)
    }
  )

  it("is true when there is no list held (nothing to invalidate)", () => {
    const state = baseState()
    expect(state.colonias).toEqual([])
    expect(selectPostalCodeIsUsable(state)).toBe(true)
  })

  it("is true when the held list belongs to the current postal code", () => {
    const state = listedFor("06700")
    expect(state.colonias).toHaveLength(2)
    expect(state.draft.postal_code).toBe("06700")

    expect(selectPostalCodeIsUsable(state)).toBe(true)
  })

  it("is false when a held list belongs to a different postal code", () => {
    // The B -> A -> B retention edge. A list fetched for A must not be treated
    // as usable under a different postal code B, or the customer could pick a
    // colonia that does not exist for B and the order fails only at labelling.
    const listedForA = listedFor("06700")

    const backToB = checkoutReducer(listedForA, {
      type: "FIELD_CHANGE",
      field: "postal_code",
      value: "64000",
    })
    // The list still belongs to 06700, but the draft now reads 64000.
    expect(backToB.colonias).toHaveLength(2)
    expect(backToB.coloniasPostalCode).toBe("06700")
    expect(backToB.draft.postal_code).toBe("64000")

    expect(selectPostalCodeIsUsable(backToB)).toBe(false)
  })
})

describe("selectShouldLookUpPostalCode", () => {
  it("leaves a returning cart's complete address alone", () => {
    // The regression guard. `CP_LOOKUP_FOUND` overwrites province and city, so
    // a mount-time lookup that normalises "CDMX" to "Ciudad de México" would
    // move the signature and drop a shipping selection the customer made
    // against a destination they never changed.
    expect(selectShouldLookUpPostalCode(baseState())).toBe(false)
  })

  it("runs when the customer types a different postal code", () => {
    const typed = checkoutReducer(baseState(), {
      type: "FIELD_CHANGE",
      field: "postal_code",
      value: "44160",
    })

    expect(selectShouldLookUpPostalCode(typed)).toBe(true)
  })

  it("runs when the persisted address is missing its state", () => {
    const partial = baseState({
      shipping_address: { id: "caaddr_01", ...CDMX, province: "" },
    })

    expect(selectShouldLookUpPostalCode(partial)).toBe(true)
  })

  it("runs when the persisted address is missing its city", () => {
    const partial = baseState({
      shipping_address: { id: "caaddr_01", ...CDMX, city: "" },
    })

    expect(selectShouldLookUpPostalCode(partial)).toBe(true)
  })

  it("runs on a cart with no address at all", () => {
    const blank = initFromServer({
      cart: cartWith({ shipping_address: null }),
      customer: null,
      shippingOptions: [],
    })
    const typed = checkoutReducer(blank, {
      type: "FIELD_CHANGE",
      field: "postal_code",
      value: "06700",
    })

    expect(selectShouldLookUpPostalCode(typed)).toBe(true)
  })

  it.each(["", "067", "0670", "067000", "0670a", " 06700"])(
    "never runs for the malformed postal code %o",
    (value) => {
      const typed = checkoutReducer(baseState(), {
        type: "FIELD_CHANGE",
        field: "postal_code",
        value,
      })

      expect(selectShouldLookUpPostalCode(typed)).toBe(false)
    }
  )

  it("stops once the newly typed postal code has been persisted", () => {
    const typed = checkoutReducer(baseState(), {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })
    const resolved = checkoutReducer(typed, {
      type: "CP_LOOKUP_FOUND",
      postalCode: "44160",
      province: "Jalisco",
      city: "Guadalajara",
      colonias: ["Americana"],
    })

    const persisted = run(
      resolved,
      { type: "CART_WRITE_STARTED", sequence: 1 },
      {
        type: "CART_UPDATED",
        sequence: 1,
        cart: cartWith({
          shipping_address: {
            id: "caaddr_01",
            ...CDMX,
            postal_code: "44160",
            province: "Jalisco",
            city: "Guadalajara",
          },
        }),
      }
    )

    expect(selectShouldLookUpPostalCode(persisted)).toBe(false)
  })
})

describe("selectUnsavedDraftPatch", () => {
  it("is null when the draft matches the cart, so no pointless write is issued", () => {
    // §14 item 6: a patch with no persistable fields still emits a bare-PK
    // upsert, and per F2 every updateCart re-runs a live carrier quote once a
    // shipping method exists. A no-op write is not free.
    expect(selectUnsavedDraftPatch(baseState())).toBeNull()
  })

  it("contains only the fields the customer actually changed", () => {
    const state = checkoutReducer(baseState(), {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })

    expect(selectUnsavedDraftPatch(state)).toEqual({ postal_code: "44160" })
  })

  it("sends a CLEARED field, because clearing one is a legitimate edit", () => {
    const state = checkoutReducer(baseState(), {
      type: "FIELD_BLUR",
      field: "company",
      value: "",
    })

    expect(selectUnsavedDraftPatch(state)).toEqual({ company: "" })
  })

  it("treats an address the cart does not have yet as entirely unsaved", () => {
    const state = initFromServer({
      cart: cartWith({ shipping_address: null }),
      customer: null,
      shippingOptions: [],
    })
    const typed = checkoutReducer(state, {
      type: "FIELD_BLUR",
      field: "first_name",
      value: "Ana",
    })

    expect(selectUnsavedDraftPatch(typed)).toEqual({ first_name: "Ana" })
  })

  it("goes back to null once the write lands", () => {
    const state = checkoutReducer(baseState(), {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })

    const persisted = run(
      state,
      { type: "CART_WRITE_STARTED", sequence: 1 },
      {
        type: "CART_UPDATED",
        sequence: 1,
        cart: cartWith({
          shipping_address: { id: "caaddr_01", ...CDMX, postal_code: "44160" },
        }),
      }
    )

    expect(selectUnsavedDraftPatch(persisted)).toBeNull()
  })

  it("still reports a field the write did not actually persist", () => {
    // Compared against the CART, not against a remembered payload: a partially
    // applied write self-corrects on the next blur instead of being remembered
    // as done.
    const state = checkoutReducer(baseState(), {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })

    const persisted = run(
      state,
      { type: "CART_WRITE_STARTED", sequence: 1 },
      { type: "CART_UPDATED", sequence: 1, cart: cartWith() }
    )

    expect(selectUnsavedDraftPatch(persisted)).toEqual({ postal_code: "44160" })
  })
})

describe("selectUnsavedEmail", () => {
  it("is null when the cart already carries it", () => {
    expect(selectUnsavedEmail(baseState())).toBeNull()
  })

  it("is the new value once the customer edits it", () => {
    const state = checkoutReducer(baseState(), {
      type: "FIELD_BLUR",
      field: "email",
      value: "otra@example.com",
    })

    expect(selectUnsavedEmail(state)).toBe("otra@example.com")
  })

  it("reports a customer email that the cart has not adopted yet", () => {
    const state = initFromServer({
      cart: cartWith({ email: null }),
      customer: { email: "socia@example.com" } as HttpTypes.StoreCustomer,
      shippingOptions: [],
    })

    expect(selectUnsavedEmail(state)).toBe("socia@example.com")
  })
})

describe("selectQuoteIsBlockedByFailure", () => {
  /**
   * Asserted on constructed states, not only on states the reducer can reach
   * today. The reducer currently clears `failedSignature` on every signature
   * change, so "a failure recorded against a DIFFERENT address" is unreachable
   * through the actions — and a guard whose second half is only defended by an
   * invariant somewhere else is exactly the guard someone deletes as redundant.
   */
  const stateWith = (
    failedSignature: string | null,
    quoteSignature: string | null
  ): CheckoutState => ({ ...baseState(), failedSignature, quoteSignature })

  it("blocks only the address that actually failed", () => {
    expect(selectQuoteIsBlockedByFailure(stateWith("sig-a", "sig-a"))).toBe(
      true
    )
    expect(selectQuoteIsBlockedByFailure(stateWith("sig-a", "sig-b"))).toBe(
      false
    )
  })

  it("does not treat two absent signatures as a failure", () => {
    expect(selectQuoteIsBlockedByFailure(stateWith(null, null))).toBe(false)
  })

  it("does not block an address that has never failed", () => {
    expect(selectQuoteIsBlockedByFailure(stateWith(null, "sig-a"))).toBe(false)
  })
})

describe("a selection made before any signature existed", () => {
  /**
   * `isShippingSelectionStale` is asymmetric on purpose: a `null` SELECTION
   * signature is never stale, because "nothing to compare" is not evidence that
   * anything moved.
   *
   * That asymmetry is right for the rule and wrong as a seed. A returning cart
   * whose persisted address is not quotable — no province, no city, a postal code
   * that is not five digits — still carries a shipping method, chosen under a
   * destination we cannot reconstruct. Seeding `null` there made
   * `isShippingSelectionStale` answer `false` forever: no later postal-code
   * change could clear the radio, `shipping_method_stale` could never fire, and
   * finding F2's silent re-pricing arrived in the summary as a final total.
   *
   * An earlier version of this suite asserted the opposite — that the selection
   * SURVIVES the address becoming quotable — on the grounds that losing it is
   * unfriendly. It is unfriendly, and it is still correct: the moment the address
   * becomes quotable the backend re-prices that method to a destination it was
   * never priced for. Settled decision 1 already weighed this exact trade and
   * chose the extra click over a total that changes underneath the customer.
   */
  const returningWithUnquotableAddress = () =>
    initFromServer({
      cart: cartWith({
        shipping_address: { id: "caaddr_01", ...CDMX, postal_code: "" },
        shipping_methods: [{ shipping_option_id: "so_std" }],
      }),
      customer: null,
      shippingOptions: [option("so_std")],
    })

  it("is seeded as unvouchable rather than as fresh", () => {
    const state = returningWithUnquotableAddress()

    expect(state.selectedShippingOptionId).toBe("so_std")
    expect(state.quoteSignature).toBeNull()

    // Asserted as a property, not against an imported constant: what matters is
    // that the seed is SOMETHING (so the staleness rule engages at all) and that
    // it cannot equal a real signature. Importing the sentinel and comparing to
    // it would pass for every possible value of the sentinel, including `null` —
    // the bug.
    expect(state.selectionSignature).not.toBeNull()

    const quotable = checkoutReducer(state, {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "06700",
    })
    expect(state.selectionSignature).not.toBe(quotable.quoteSignature)
  })

  it("is cleared once the address becomes quotable, so the customer re-picks", () => {
    const completed = checkoutReducer(returningWithUnquotableAddress(), {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "06700",
    })

    expect(completed.quoteSignature).not.toBeNull()
    expect(completed.selectedShippingOptionId).toBeNull()
  })

  it("reports the stale selection to the CTA while the cart still carries the method", () => {
    // Per finding F1 the method row cannot be removed from the cart, so the CTA
    // is the only thing that can stop an order going out against a price the
    // customer never saw.
    const completed = checkoutReducer(returningWithUnquotableAddress(), {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "06700",
    })

    expect(
      getMissingOrderRequirements(selectReadinessInput(completed)).map(
        (r) => r.code
      )
    ).toContain("shipping_method_stale")
  })

  it("is not seeded with a signature when the cart has no method at all", () => {
    const state = baseState()
    expect(state.selectedShippingOptionId).toBeNull()
    expect(state.selectionSignature).toBeNull()
  })
})

/**
 * ---------------------------------------------------------------------------
 * `selectReadinessInput` sources billing from the CLIENT — Amendment A5
 * ---------------------------------------------------------------------------
 *
 * The adapter's own argument lives in `checkout-readiness.spec.ts`. This block
 * covers the WIRING, which is the half that deadlocked: `hasBillingAddress`
 * used to be read off `state.cart.billing_address`, whose only writer runs at
 * CTA time behind the gate it feeds.
 *
 * Both directions are asserted, because a wiring that hard-codes either answer
 * would satisfy one of them and nothing else.
 */
describe("selectReadinessInput — billing is a client fact (A5)", () => {
  const noBillingRow = () =>
    baseState({
      shipping_methods: [{ shipping_option_id: "so_std" }],
      billing_address: null,
    })

  const selectedProvider = {
    type: "SELECT_PAYMENT_PROVIDER" as const,
    providerId: "pp_mercadopago_mercadopago",
  }

  it("lets a cart with no billing row through while the box is checked", () => {
    const state = run(noBillingRow(), selectShipping("so_std"), selectedProvider)

    // `initFromServer` defaults `sameAsBilling` to true for a cart with no
    // billing row, which is precisely the cohort that used to deadlock.
    expect(state.sameAsBilling).toBe(true)
    expect(state.cart?.billing_address).toBeNull()
    expect(selectReadinessInput(state).hasBillingAddress).toBe(true)
    expect(getMissingOrderRequirements(selectReadinessInput(state))).toEqual([])
  })

  it("blocks once the customer unchecks the box and has typed nothing", () => {
    const state = run(
      noBillingRow(),
      selectShipping("so_std"),
      selectedProvider,
      { type: "TOGGLE_SAME_AS_BILLING" },
      // W7 mirrors the shipping draft into the billing draft, so clear it the
      // way a customer emptying the prefilled form would.
      ...(
        [
          "first_name",
          "last_name",
          "address_1",
          "postal_code",
          "city",
          "province",
          "country_code",
        ] as const
      ).map((field) => ({
        type: "BILLING_FIELD_CHANGE" as const,
        field,
        value: "",
      }))
    )

    expect(state.sameAsBilling).toBe(false)
    expect(selectReadinessInput(state).hasBillingAddress).toBe(false)
    expect(
      getMissingOrderRequirements(selectReadinessInput(state)).map((r) => r.code)
    ).toEqual(["billing_address"])
  })

  /**
   * And the customer can get out of it WITHOUT a round trip — which is the
   * entire difference between a gate and a deadlock.
   */
  it("unblocks as soon as the separate billing form is complete", () => {
    const state = run(
      noBillingRow(),
      selectShipping("so_std"),
      selectedProvider,
      { type: "TOGGLE_SAME_AS_BILLING" },
      {
        type: "BILLING_FIELD_CHANGE",
        field: "postal_code",
        value: "06500",
      }
    )

    expect(state.cart?.billing_address).toBeNull()
    expect(selectReadinessInput(state).hasBillingAddress).toBe(true)
    expect(getMissingOrderRequirements(selectReadinessInput(state))).toEqual([])
  })
})

describe("selectReadinessInput — the seam PR1b left open, now closed", () => {
  it("makes the CTA report a stale selection after a postal-code change", () => {
    const selected = run(
      baseState({
        shipping_methods: [{ shipping_option_id: "so_std" }],
        billing_address: { id: "baddr_01", ...CDMX },
      }),
      selectShipping("so_std"),
      {
        type: "SELECT_PAYMENT_PROVIDER",
        providerId: "pp_mercadopago_mercadopago",
      }
    )

    expect(
      getMissingOrderRequirements(selectReadinessInput(selected)).map(
        (r) => r.code
      )
    ).toEqual([])

    const moved = checkoutReducer(selected, {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })

    const missing = getMissingOrderRequirements(selectReadinessInput(moved))
    expect(missing.map((r) => r.code)).toEqual(["shipping_method_stale"])
    expect(missing[0].message).toBe(
      "Vuelve a elegir el método de envío: cambiaste el código postal."
    )
  })

  /**
   * The A -> B -> A round trip, for the SELECTION.
   *
   * This file already round-trips the FAILURE record ("forgets a failure once the
   * customer leaves and returns to that address") because a failure that survived
   * the trip would lock a customer out of the only address they want. The
   * selection had no equivalent, and the two records do NOT behave the same way on
   * the way back:
   *
   * - `failedSignature` is cleared on every signature change, so returning to A
   *   genuinely forgets it;
   * - `selectedShippingOptionId` is cleared on the way OUT and never restored,
   *   while `selectionSignature` is deliberately kept at A.
   *
   * So on the way back `isShippingSelectionStale(A, A)` is `false` again, and that
   * is the whole bug: the radio group is empty, the cart still carries the method
   * row (F1 — there is no store API to remove it), and a rule that reads staleness
   * ALONE concludes there is nothing left to fix. The CTA unblocks, the summary
   * presents the total as FINAL, and the customer places an order for a shipping
   * method the page shows as unselected.
   *
   * The module's core invariant is that the CTA and the summary cannot disagree
   * with the radio group. This is the test that says so.
   */
  it("keeps blocking when the customer leaves an address and returns to it", () => {
    const selected = run(
      baseState({
        shipping_methods: [{ shipping_option_id: "so_std" }],
        billing_address: { id: "baddr_01", ...CDMX },
      }),
      selectShipping("so_std"),
      {
        type: "SELECT_PAYMENT_PROVIDER",
        providerId: "pp_mercadopago_mercadopago",
      }
    )
    const signatureA = selected.quoteSignature
    expect(getMissingOrderRequirements(selectReadinessInput(selected))).toEqual(
      []
    )

    const roundTrip = run(
      selected,
      { type: "FIELD_BLUR", field: "postal_code", value: "44160" },
      { type: "FIELD_BLUR", field: "postal_code", value: "06700" }
    )

    // Back at the address the selection was originally made under…
    expect(roundTrip.quoteSignature).toBe(signatureA)
    expect(roundTrip.selectionSignature).toBe(signatureA)
    // …but the radio the customer sees is empty, and the cart still carries the
    // row the backend has re-priced twice on the way there and back.
    expect(roundTrip.selectedShippingOptionId).toBeNull()
    expect(roundTrip.cart?.shipping_methods).toHaveLength(1)

    expect(
      getMissingOrderRequirements(selectReadinessInput(roundTrip)).map(
        (r) => r.code
      )
    ).toEqual(["shipping_method_stale"])
  })

  it("clears again once the customer re-picks after the round trip", () => {
    const repicked = run(
      baseState({
        shipping_methods: [{ shipping_option_id: "so_std" }],
        billing_address: { id: "baddr_01", ...CDMX },
      }),
      selectShipping("so_std"),
      {
        type: "SELECT_PAYMENT_PROVIDER",
        providerId: "pp_mercadopago_mercadopago",
      },
      { type: "FIELD_BLUR", field: "postal_code", value: "44160" },
      { type: "FIELD_BLUR", field: "postal_code", value: "06700" },
      selectShipping("so_std")
    )

    expect(repicked.selectedShippingOptionId).toBe("so_std")
    expect(getMissingOrderRequirements(selectReadinessInput(repicked))).toEqual(
      []
    )
  })

  it("does not report staleness after a street edit", () => {
    const selected = run(
      baseState({
        shipping_methods: [{ shipping_option_id: "so_std" }],
        billing_address: { id: "baddr_01", ...CDMX },
      }),
      selectShipping("so_std"),
      {
        type: "SELECT_PAYMENT_PROVIDER",
        providerId: "pp_mercadopago_mercadopago",
      },
      { type: "FIELD_BLUR", field: "address_1", value: "Otra calle 55" }
    )

    expect(getMissingOrderRequirements(selectReadinessInput(selected))).toEqual(
      []
    )
  })

  it("reports an empty cart and nothing else", () => {
    const state = initFromServer({
      cart: null,
      customer: null,
      shippingOptions: null,
    })

    expect(
      getMissingOrderRequirements(selectReadinessInput(state)).map(
        (r) => r.code
      )
    ).toEqual(["cart_empty"])
  })

  it("reports staleness when the destination stops being quotable entirely", () => {
    // The asymmetric half of the rule, and the one a swapped argument pair
    // gets wrong while still passing the ordinary A -> B case: the customer
    // picked a method, then broke the postal code. `currentQuoteSignature` is
    // now null and the priced selection on screen belongs to a destination
    // that is no longer the destination.
    const broken = run(
      baseState({
        shipping_methods: [{ shipping_option_id: "so_std" }],
        billing_address: { id: "baddr_01", ...CDMX },
      }),
      selectShipping("so_std"),
      {
        type: "SELECT_PAYMENT_PROVIDER",
        providerId: "pp_mercadopago_mercadopago",
      },
      { type: "FIELD_BLUR", field: "postal_code", value: "0670" }
    )

    expect(broken.quoteSignature).toBeNull()
    expect(
      getMissingOrderRequirements(selectReadinessInput(broken)).map(
        (r) => r.code
      )
    ).toContain("shipping_method_stale")
  })

  it("carries the selected payment provider through", () => {
    const ready = run(
      baseState({
        shipping_methods: [{ shipping_option_id: "so_std" }],
        billing_address: { id: "baddr_01", ...CDMX },
      }),
      selectShipping("so_std")
    )

    expect(
      getMissingOrderRequirements(selectReadinessInput(ready)).map(
        (r) => r.code
      )
    ).toEqual(["payment_method"])
  })

  it("carries real card completeness through, never an assumed one", () => {
    const openpaySelected = run(
      baseState({
        shipping_methods: [{ shipping_option_id: "so_std" }],
        billing_address: { id: "baddr_01", ...CDMX },
      }),
      selectShipping("so_std"),
      { type: "SELECT_PAYMENT_PROVIDER", providerId: "pp_openpay_openpay" }
    )

    expect(
      getMissingOrderRequirements(selectReadinessInput(openpaySelected)).map(
        (r) => r.code
      )
    ).toEqual(["card_details"])

    const completed = checkoutReducer(openpaySelected, {
      type: "SET_PAYMENT_DETAILS_COMPLETE",
      complete: true,
    })

    expect(
      getMissingOrderRequirements(selectReadinessInput(completed))
    ).toEqual([])
  })
})

/**
 * W7 — the billing draft must track the shipping draft while the checkbox is on.
 *
 * The old behaviour flipped the flag and nothing else, so a customer who filled
 * the shipping address and then unchecked "same as billing" was handed an EMPTY
 * billing form and had to retype an address they had already entered. The rule is
 * a mirror, not a copy-on-toggle: `sameAsBilling` being true is a claim that the
 * two addresses ARE the same, and state that contradicts the flag it is stored
 * next to is the class of bug this reducer exists to remove.
 */
describe("billing draft mirroring (W7)", () => {
  const filled = (state: CheckoutState) =>
    run(
      state,
      { type: "FIELD_BLUR", field: "address_1", value: "Calle Falsa 123" },
      { type: "FIELD_BLUR", field: "postal_code", value: "44100" },
      { type: "FIELD_BLUR", field: "city", value: "Guadalajara" },
      { type: "FIELD_BLUR", field: "province", value: "Jalisco" }
    )

  it("mirrors every shipping field into the billing draft while the box is checked", () => {
    const state = filled(baseState({ billing_address: null }))

    expect(state.sameAsBilling).toBe(true)
    expect(state.billingDraft).toEqual(state.draft)
  })

  it("hands the customer a PREFILLED billing form when they uncheck the box", () => {
    const unchecked = checkoutReducer(filled(baseState({ billing_address: null })), {
      type: "TOGGLE_SAME_AS_BILLING",
    })

    expect(unchecked.sameAsBilling).toBe(false)
    expect(unchecked.billingDraft.address_1).toBe("Calle Falsa 123")
    expect(unchecked.billingDraft.city).toBe("Guadalajara")
    expect(unchecked.billingDraft.province).toBe("Jalisco")
    expect(unchecked.billingDraft.postal_code).toBe("44100")
  })

  it("stops mirroring once the box is unchecked, so the two drafts can diverge", () => {
    const diverged = run(
      filled(baseState({ billing_address: null })),
      { type: "TOGGLE_SAME_AS_BILLING" },
      { type: "BILLING_FIELD_CHANGE", field: "city", value: "Monterrey" },
      { type: "FIELD_BLUR", field: "city", value: "Puebla" }
    )

    expect(diverged.draft.city).toBe("Puebla")
    expect(diverged.billingDraft.city).toBe("Monterrey")
  })

  it("re-adopts the shipping draft when the box is checked again", () => {
    const rechecked = run(
      filled(baseState({ billing_address: null })),
      { type: "TOGGLE_SAME_AS_BILLING" },
      { type: "BILLING_FIELD_CHANGE", field: "city", value: "Monterrey" },
      { type: "TOGGLE_SAME_AS_BILLING" }
    )

    expect(rechecked.sameAsBilling).toBe(true)
    expect(rechecked.billingDraft).toEqual(rechecked.draft)
  })

  it("seeds the billing draft from the shipping address on a same-as-billing cart", () => {
    const state = baseState({ billing_address: null })

    expect(state.sameAsBilling).toBe(true)
    expect(state.billingDraft).toEqual(state.draft)
  })

  it("leaves a genuinely different billing address alone", () => {
    const state = baseState({
      billing_address: { id: "baddr_01", ...CDMX, city: "Monterrey" },
    })

    expect(state.sameAsBilling).toBe(false)
    expect(state.billingDraft.city).toBe("Monterrey")
    expect(state.draft.city).toBe("Ciudad de México")
  })
})

/**
 * B1 — the rule that lets a serialised writer compute its patch correctly.
 *
 * A write that is queued behind another one cannot trust `state.cart`. React has
 * not necessarily re-rendered between the moment the first write's `CART_UPDATED`
 * is dispatched and the moment the second write starts, so the second would
 * re-derive its patch against a cart that predates the first write and re-send
 * fields that are already persisted. Under PR1a's id-resolving read that is the
 * `absent` TOCTOU: two writes, both resolving no address, both taking the id-less
 * `em.create` path.
 *
 * The scheduler therefore carries the cart its own last write returned, and this
 * rule decides which of the two is actually newer — by SEQUENCE, not by identity
 * or by hope.
 */
describe("selectWriteBaseCart (B1)", () => {
  it("uses the cart in state when no write of ours is outstanding", () => {
    const state = baseState()

    expect(selectWriteBaseCart(state, null)).toBe(state.cart)
  })

  it("prefers the cart our own write returned when the reducer has not caught up", () => {
    const state = baseState()
    const fresher = cartWith({ id: "cart_01", email: "nuevo@example.com" })

    expect(selectWriteBaseCart(state, { cart: fresher, sequence: 1 })).toBe(
      fresher
    )
  })

  it("falls back to state once the reducer HAS applied that write", () => {
    const applied = run(baseState(), { type: "CART_WRITE_STARTED", sequence: 1 }, {
      type: "CART_UPDATED",
      cart: cartWith({ email: "aplicado@example.com" }),
      sequence: 1,
    })
    const ourWrite = cartWith({ email: "nuestro@example.com" })

    expect(selectWriteBaseCart(applied, { cart: ourWrite, sequence: 1 })).toBe(
      applied.cart
    )
  })

  it("prefers our write when the applied sequence is older than ours", () => {
    const applied = run(baseState(), { type: "CART_WRITE_STARTED", sequence: 1 }, {
      type: "CART_UPDATED",
      cart: cartWith({ email: "viejo@example.com" }),
      sequence: 1,
    })
    const ourWrite = cartWith({ email: "nuestro@example.com" })

    expect(selectWriteBaseCart(applied, { cart: ourWrite, sequence: 2 })).toBe(
      ourWrite
    )
  })
})

describe("selectUnsavedDraftPatchAgainst (B1)", () => {
  it("reports nothing to write when the draft matches the given cart", () => {
    const state = baseState()

    expect(
      selectUnsavedDraftPatchAgainst(state.draft, state.cart?.shipping_address)
    ).toBeNull()
  })

  it("reports ONLY the fields that differ from the given cart", () => {
    const edited = checkoutReducer(baseState(), {
      type: "FIELD_BLUR",
      field: "address_1",
      value: "Otra calle 9",
    })

    expect(
      selectUnsavedDraftPatchAgainst(
        edited.draft,
        edited.cart?.shipping_address
      )
    ).toEqual({ address_1: "Otra calle 9" })
  })

  it("is what makes a queued second write a no-op once the first one landed", () => {
    const edited = checkoutReducer(baseState(), {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44100",
    })

    // The first write persisted it. The second write, queued behind it, must see
    // nothing left to do even though `state.cart` has not been updated yet.
    const persisted = cartWith({
      shipping_address: { id: "caaddr_01", ...CDMX, postal_code: "44100" },
    })

    expect(
      selectUnsavedDraftPatchAgainst(edited.draft, persisted.shipping_address)
    ).toBeNull()
  })

  it("agrees exactly with the state-level selector, so there is one definition", () => {
    const edited = run(
      baseState(),
      { type: "FIELD_BLUR", field: "city", value: "Guadalajara" },
      { type: "FIELD_BLUR", field: "company", value: "Mandi" }
    )

    expect(
      selectUnsavedDraftPatchAgainst(edited.draft, edited.cart?.shipping_address)
    ).toEqual(selectUnsavedDraftPatch(edited))
  })
})

describe("selectUnsavedEmailAgainst (B1)", () => {
  it("reports nothing when the given cart already carries this email", () => {
    const state = baseState()

    expect(selectUnsavedEmailAgainst(state.email, state.cart)).toBeNull()
  })

  it("reports the email when it differs from the given cart", () => {
    const edited = checkoutReducer(baseState(), {
      type: "FIELD_BLUR",
      field: "email",
      value: "nuevo@example.com",
    })

    expect(selectUnsavedEmailAgainst(edited.email, edited.cart)).toBe(
      "nuevo@example.com"
    )
  })

  it("agrees exactly with the state-level selector", () => {
    const edited = checkoutReducer(baseState(), {
      type: "FIELD_BLUR",
      field: "email",
      value: "nuevo@example.com",
    })

    expect(selectUnsavedEmailAgainst(edited.email, edited.cart)).toBe(
      selectUnsavedEmail(edited)
    )
  })
})

/**
 * C3 — the rule that stops three duplicate live carrier quote rounds per load.
 *
 * `QUOTE_READY` rebuilds `shippingOptions` on every success, so the array gets a
 * new IDENTITY even when the carrier returned exactly the same options. The
 * `Shipping` component keys its price fan-out on `[availableShippingMethods]` —
 * identity, not content — so every new identity re-fanned out
 * `calculatePriceForShippingOption` across every calculated option and flashed
 * Envío back to loading. Per finding F2 each of those is a live Skydropx quote.
 *
 * The key is what lets the provider hand out a reference that changes only when
 * the SET of options changes. It is here, and not in the `.tsx`, because it is a
 * rule about what counts as "the same list".
 */
describe("selectShippingOptionsKey (C3)", () => {
  it("is equal for two distinct arrays holding the same options", () => {
    expect(selectShippingOptionsKey([option("so_a"), option("so_b")])).toBe(
      selectShippingOptionsKey([option("so_a"), option("so_b")])
    )
  })

  it("changes when an option is added", () => {
    expect(selectShippingOptionsKey([option("so_a")])).not.toBe(
      selectShippingOptionsKey([option("so_a"), option("so_b")])
    )
  })

  it("changes when an option is removed", () => {
    expect(selectShippingOptionsKey([option("so_a"), option("so_b")])).not.toBe(
      selectShippingOptionsKey([option("so_b")])
    )
  })

  it("changes when an option is replaced by a different one", () => {
    expect(selectShippingOptionsKey([option("so_a")])).not.toBe(
      selectShippingOptionsKey([option("so_z")])
    )
  })

  it("distinguishes order, because the rendered radio order is customer-visible", () => {
    expect(selectShippingOptionsKey([option("so_a"), option("so_b")])).not.toBe(
      selectShippingOptionsKey([option("so_b"), option("so_a")])
    )
  })

  it("cannot be spoofed by an id that contains the delimiter", () => {
    // Two genuinely different lists must not collapse to one key just because a
    // backend id happens to carry the separator character.
    expect(selectShippingOptionsKey([option("so_a|so_b")])).not.toBe(
      selectShippingOptionsKey([option("so_a"), option("so_b")])
    )
  })

  it("is stable for an empty list, which is the not_serviceable case", () => {
    expect(selectShippingOptionsKey([])).toBe(selectShippingOptionsKey([]))
  })

  it("distinguishes an empty list from a populated one", () => {
    expect(selectShippingOptionsKey([])).not.toBe(
      selectShippingOptionsKey([option("so_a")])
    )
  })

  it("does not change when only the PRICE moved, since the fan-out recomputes it", () => {
    const cheap = { ...option("so_a"), amount: 100 }
    const dear = { ...option("so_a"), amount: 900 }

    expect(selectShippingOptionsKey([cheap])).toBe(
      selectShippingOptionsKey([dear])
    )
  })

  it("survives a QUOTE_READY that returns the same options as before", () => {
    const edited = checkoutReducer(baseState(), {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44100",
    })
    const quoted = checkoutReducer(edited, {
      type: "QUOTE_READY",
      signature: edited.quoteSignature ?? "",
      options: [option("so_a")],
      prices: {},
    })

    expect(quoted.shippingOptions.map((o) => o.id)).toEqual(["so_a"])
    const before = selectShippingOptionsKey(quoted.shippingOptions)

    const requoted = checkoutReducer(quoted, {
      type: "QUOTE_READY",
      signature: quoted.quoteSignature ?? "",
      options: [option("so_a")],
      prices: { so_a: 100 },
    })

    // A brand-new array object, but the same set — so the identity handed to
    // `Shipping` must not move and no second fan-out is triggered.
    expect(requoted.shippingOptions).not.toBe(quoted.shippingOptions)
    expect(selectShippingOptionsKey(requoted.shippingOptions)).toBe(before)
  })
})

/**
 * B2 — the sixteen mutants that survived a green suite.
 *
 * Every assertion below was added because a real mutation harness proved the
 * suite could not tell the difference. A test that only exercises a code path
 * without pinning its OUTCOME is a test that passes for the wrong reason, and the
 * previous "47/47 killed" claim was measured against a mutant set too narrow to
 * expose that.
 *
 * Grouped by what the mutant would have cost a customer, not by reducer case.
 */
describe("mutation survivors — behaviour that was never asserted (B2)", () => {
  describe("the billing checkbox actually toggles", () => {
    it("flips the flag, so the checkbox is not dead", () => {
      const state = baseState({ billing_address: null })
      const toggled = checkoutReducer(state, {
        type: "TOGGLE_SAME_AS_BILLING",
      })

      expect(state.sameAsBilling).toBe(true)
      expect(toggled.sameAsBilling).toBe(false)
      expect(
        checkoutReducer(toggled, { type: "TOGGLE_SAME_AS_BILLING" })
          .sameAsBilling
      ).toBe(true)
    })
  })

  describe("a SEPOMEX hit arms the autosave", () => {
    /**
     * The same class as the `FIELD_BLUR` bug caught earlier: `blurSequence` is the
     * ONLY thing the autosave effect debounces off, so a transition that fills in
     * province and city without bumping it persists nothing. The customer's
     * postal-code-derived address would sit in the draft and never reach the cart.
     */
    it("bumps blurSequence, or nothing SEPOMEX filled in is ever persisted", () => {
      const state = baseState()
      const found = checkoutReducer(state, {
        type: "CP_LOOKUP_FOUND",
        postalCode: "06700",
        province: "Jalisco",
        city: "Guadalajara",
        colonias: [],
      })

      expect(found.blurSequence).toBe(state.blurSequence + 1)
    })
  })

  describe("a blank SEPOMEX field falls back to what the customer already has", () => {
    /**
     * `getPostalCode` CAN answer `found: true` with an empty `state`, and the
     * provider coerces it with `|| ""` before dispatching. Taking that blank
     * literally wipes the province, which nulls the quote signature, which means
     * no quote is ever requested for an address the customer filled in correctly.
     */
    it("keeps the existing province when SEPOMEX returns a blank one", () => {
      const filled = checkoutReducer(baseState(), {
        type: "FIELD_BLUR",
        field: "province",
        value: "Jalisco",
      })

      const found = checkoutReducer(filled, {
        type: "CP_LOOKUP_FOUND",
        postalCode: "06700",
        province: "",
        city: "Guadalajara",
        colonias: [],
      })

      expect(found.draft.province).toBe("Jalisco")
      expect(found.quoteSignature).not.toBeNull()
    })

    it("keeps the existing city when SEPOMEX returns a blank one", () => {
      const filled = checkoutReducer(baseState(), {
        type: "FIELD_BLUR",
        field: "city",
        value: "Zapopan",
      })

      const found = checkoutReducer(filled, {
        type: "CP_LOOKUP_FOUND",
        postalCode: "06700",
        province: "Jalisco",
        city: "",
        colonias: [],
      })

      expect(found.draft.city).toBe("Zapopan")
      expect(found.quoteSignature).not.toBeNull()
    })

    it("still overwrites when SEPOMEX has a real answer, since the CP is authoritative", () => {
      const found = checkoutReducer(baseState(), {
        type: "CP_LOOKUP_FOUND",
        postalCode: "06700",
        province: "Jalisco",
        city: "Guadalajara",
        colonias: [],
      })

      expect(found.draft.province).toBe("Jalisco")
      expect(found.draft.city).toBe("Guadalajara")
    })
  })

  describe("the issued-write counter never regresses", () => {
    /**
     * This defends the headline supersession guarantee. Every existing test issued
     * sequence 1 then 2, so out-of-order ARMING was untested — and B1's concurrent
     * writers made it reachable. If the counter can be dragged backwards, an OLDER
     * `CART_UPDATED` passes the `<` guard and overwrites a newer cart.
     */
    it("holds the high-water mark when an older write is announced late", () => {
      const state = run(
        baseState(),
        { type: "CART_WRITE_STARTED", sequence: 2 },
        { type: "CART_WRITE_STARTED", sequence: 1 }
      )

      expect(state.issuedWriteSequence).toBe(2)
    })

    it("still rejects the older response after that out-of-order arming", () => {
      const state = run(
        baseState(),
        { type: "CART_WRITE_STARTED", sequence: 2 },
        { type: "CART_WRITE_STARTED", sequence: 1 },
        {
          type: "CART_UPDATED",
          cart: cartWith({ email: "viejo@example.com" }),
          sequence: 1,
        }
      )

      expect(state.cart?.email).toBe("ana@example.com")
      expect(state.appliedWriteSequence).toBe(0)
    })
  })

  describe("the status line says Guardando while a write is open", () => {
    it("enters saving, or the customer never sees that anything is happening", () => {
      const state = checkoutReducer(baseState(), {
        type: "CART_WRITE_STARTED",
        sequence: 1,
      })

      expect(state.autosaveStatus).toBe("saving")
    })
  })

  describe("a stale failure cannot free a newer quote's slot", () => {
    /**
     * Releasing the in-flight slot unconditionally lets a late failure for an
     * abandoned address clear the slot held by the quote that superseded it. The
     * requote effect then sees no quote in flight and fires again — a duplicate
     * live carrier call, per F2.
     */
    it("leaves the in-flight signature alone when the failure is not for it", () => {
      const running = checkoutReducer(baseState(), {
        type: "QUOTE_STARTED",
        signature: "sig_actual",
      })

      const stale = checkoutReducer(running, {
        type: "QUOTE_FAILED",
        signature: "sig_abandonada",
      })

      expect(stale.inFlightSignature).toBe("sig_actual")
    })

    it("does release the slot when the failure IS for the running quote", () => {
      const running = checkoutReducer(baseState(), {
        type: "QUOTE_STARTED",
        signature: "sig_actual",
      })

      expect(
        checkoutReducer(running, {
          type: "QUOTE_FAILED",
          signature: "sig_actual",
        }).inFlightSignature
      ).toBeNull()
    })
  })

  describe("looking_up outranks idle", () => {
    /**
     * The distinguishing case is R4 itself: five digits typed and nothing else, so
     * `cpStatus` is `loading` while `quoteSignature` is still null. If the `idle`
     * check runs first the customer sees a dead section instead of a spinner
     * during exactly the interaction R4 exists to enable.
     */
    it("reports looking_up when the CP is in flight and no signature exists yet", () => {
      const typing = run(
        baseState({ shipping_address: null }),
        { type: "FIELD_CHANGE", field: "postal_code", value: "44100" },
        { type: "CP_LOOKUP_STARTED" }
      )

      expect(typing.quoteSignature).toBeNull()
      expect(typing.cpStatus).toBe("loading")
      expect(selectQuoteStatus(typing)).toBe("looking_up")
    })
  })

  describe("the colonia dropdown renders when it should", () => {
    it("does NOT go manual for an empty colonia with a returned list", () => {
      const found = checkoutReducer(
        baseState({
          shipping_address: { id: "caaddr_01", ...CDMX, address_2: "" },
        }),
        {
          type: "CP_LOOKUP_FOUND",
          postalCode: "06700",
          province: "Jalisco",
          city: "Guadalajara",
          colonias: ["Americana", "Lafayette"],
        }
      )

      expect(found.draft.address_2).toBe("")
      expect(found.coloniaManual).toBe(false)
    })

    it("goes manual for a colonia the returned list does not contain", () => {
      const found = checkoutReducer(baseState(), {
        type: "CP_LOOKUP_FOUND",
        postalCode: "06700",
        province: "Jalisco",
        city: "Guadalajara",
        colonias: ["Americana"],
      })

      expect(found.draft.address_2).toBe("Roma Norte")
      expect(found.coloniaManual).toBe(true)
    })
  })

  describe("a failed lookup clears the previous list", () => {
    it("drops stale colonias, so a dead dropdown cannot outlive its address", () => {
      const withList = checkoutReducer(baseState(), {
        type: "CP_LOOKUP_FOUND",
        postalCode: "06700",
        province: "Jalisco",
        city: "Guadalajara",
        colonias: ["Americana", "Lafayette"],
      })

      expect(withList.colonias).toHaveLength(2)
      expect(
        checkoutReducer(withList, { type: "CP_LOOKUP_NOT_FOUND", postalCode: "06700" }).colonias
      ).toEqual([])
    })
  })

  describe("a successful quote clears the recorded failure", () => {
    it("resets failedSignature, or the section stays parked after it recovered", () => {
      const edited = checkoutReducer(baseState(), {
        type: "FIELD_BLUR",
        field: "postal_code",
        value: "44100",
      })
      const signature = edited.quoteSignature as string

      const failed = run(
        edited,
        { type: "QUOTE_STARTED", signature },
        { type: "QUOTE_FAILED", signature }
      )

      expect(failed.failedSignature).toBe(signature)

      const recovered = checkoutReducer(failed, {
        type: "QUOTE_READY",
        signature,
        options: [option("so_std")],
        prices: { so_std: 100 },
      })

      expect(recovered.failedSignature).toBeNull()
      expect(selectQuoteStatus(recovered)).toBe("quoted")
    })
  })

  describe("the cart's email wins over the customer's", () => {
    /**
     * The cart's email is what the customer typed for THIS order; the account
     * email is a default. Swapping the precedence silently replaces a
     * deliberately-entered checkout email with the one on file.
     */
    it("prefers the cart email when both exist and differ", () => {
      const state = initFromServer({
        cart: cartWith({ email: "pedido@example.com" }),
        customer: { email: "cuenta@example.com" } as HttpTypes.StoreCustomer,
        shippingOptions: [],
      })

      expect(state.email).toBe("pedido@example.com")
    })

    it("falls back to the customer email when the cart has none", () => {
      const state = initFromServer({
        cart: cartWith({ email: null }),
        customer: { email: "cuenta@example.com" } as HttpTypes.StoreCustomer,
        shippingOptions: [],
      })

      expect(state.email).toBe("cuenta@example.com")
    })
  })

  describe("the restored selection is the LAST shipping method", () => {
    /**
     * `POST /shipping-methods` is replace-all per F1, but the collection can still
     * carry more than one row. The last is the one in force; taking the first
     * restores a superseded choice and re-ticks a radio the customer moved away
     * from.
     */
    it("restores the most recent method, not the earliest", () => {
      const state = baseState({
        shipping_methods: [
          { shipping_option_id: "so_vieja" },
          { shipping_option_id: "so_actual" },
        ],
      })

      expect(state.selectedShippingOptionId).toBe("so_actual")
    })
  })

  describe("postal codes are compared trimmed on both sides", () => {
    it("looks up a padded draft postal code instead of rejecting it", () => {
      const state = baseState()
      const padded = {
        ...state,
        draft: { ...state.draft, postal_code: "44100 " },
      }

      expect(selectShouldLookUpPostalCode(padded)).toBe(true)
    })

    it("does not re-look-up when only the CART's copy carries whitespace", () => {
      const state = baseState({
        shipping_address: { id: "caaddr_01", ...CDMX, postal_code: " 06700 " },
      })

      expect(state.draft.postal_code.trim()).toBe("06700")
      expect(state.draft.province).not.toBe("")
      expect(state.draft.city).not.toBe("")
      expect(selectShouldLookUpPostalCode(state)).toBe(false)
    })
  })
})

/**
 * C4 — the customer can get out of a failed quote.
 *
 * `QUOTE_RETRY` had no dispatcher anywhere outside `state/`, so this escape path
 * existed only on paper. PR2a added `quote-retry-notice` as a stopgap consumer;
 * PR2b absorbed it into `shipping-section`, which now renders the `failed` state
 * and its retry as one of the six. These assert the reducer half actually
 * unblocks the effect.
 */
describe("recovering from a failed quote (C4)", () => {
  const failedNow = () => {
    const edited = checkoutReducer(baseState(), {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44100",
    })
    const signature = edited.quoteSignature as string

    return run(
      edited,
      { type: "QUOTE_STARTED", signature },
      { type: "QUOTE_FAILED", signature }
    )
  }

  it("parks the requote effect while the failure stands", () => {
    const failed = failedNow()

    expect(selectQuoteStatus(failed)).toBe("failed")
    expect(selectQuoteIsBlockedByFailure(failed)).toBe(true)
  })

  it("unblocks it on QUOTE_RETRY, without the customer editing their address", () => {
    const retried = checkoutReducer(failedNow(), { type: "QUOTE_RETRY" })

    expect(selectQuoteIsBlockedByFailure(retried)).toBe(false)
    expect(retried.draft.postal_code).toBe("44100")
  })

  it("re-quotes for the SAME address after a retry, since failure never advanced quotedSignature", () => {
    const retried = checkoutReducer(failedNow(), { type: "QUOTE_RETRY" })

    expect(
      evaluateQuoteReadiness({
        draftAddress: selectQuoteRelevantAddress(retried.draft),
        lastRequestedSignature: retried.quotedSignature,
        inFlightSignature: retried.inFlightSignature,
        cartId: retried.cart?.id ?? null,
      }).action
    ).toBe("quote")
  })

  it("reports quoting again once the retry is in flight", () => {
    const retried = checkoutReducer(failedNow(), { type: "QUOTE_RETRY" })
    const running = checkoutReducer(retried, {
      type: "QUOTE_STARTED",
      signature: retried.quoteSignature as string,
    })

    expect(selectQuoteStatus(running)).toBe("quoting")
  })
})

/**
 * PR2b — what the Envío section is allowed to put on screen.
 *
 * The old `shipping/index.tsx` decided all of this inline in JSX, which is why
 * two of the defects below shipped and stayed: a free-shipping option rendered as
 * `-` because the price check was truthiness, and a superseded price stayed on
 * screen looking current because the list was rendered whenever it was non-empty.
 * Neither could be contradicted by a suite that cannot render a component.
 */
describe("selectShippingChoices", () => {
  const priced = (
    state: CheckoutState,
    prices: Record<string, number>,
    options = state.shippingOptions
  ) =>
    checkoutReducer(state, {
      type: "QUOTE_READY",
      signature: state.quoteSignature!,
      options,
      prices,
    })

  const flatOption = (id: string, amount: number | null) =>
    ({
      id,
      name: id,
      price_type: "flat",
      amount,
    } as unknown as HttpTypes.StoreCartShippingOption)

  it("returns nothing while no quote has landed for this destination", () => {
    // Server-seeded options exist from the RSC render, but no price does. A row
    // rendered here would be a carrier name with an empty price beside it.
    expect(selectShippingChoices(baseState())).toEqual([])
  })

  it("returns the priced options once the quote lands", () => {
    const state = priced(baseState({}, [option("so_std"), option("so_exp")]), {
      so_std: 12900,
      so_exp: 24900,
    })

    expect(selectShippingChoices(state)).toEqual([
      { id: "so_std", name: "so_std", amount: 12900, selectable: true },
      { id: "so_exp", name: "so_exp", amount: 24900, selectable: true },
    ])
  })

  it("preserves the order the backend returned, because that is the render order", () => {
    const state = priced(baseState({}, [option("so_b"), option("so_a")]), {
      so_a: 100,
      so_b: 200,
    })

    expect(selectShippingChoices(state).map((c) => c.id)).toEqual([
      "so_b",
      "so_a",
    ])
  })

  /**
   * The stale-price rule, enforced where it can be asserted rather than by a
   * conditional in the section's JSX. The customer changed destination; the
   * prices in hand were quoted for the previous one.
   */
  it("drops every choice the moment the destination moves", () => {
    const quoted = priced(baseState(), { so_std: 12900 })
    expect(selectShippingChoices(quoted)).toHaveLength(1)

    const moved = checkoutReducer(quoted, {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })

    expect(selectShippingChoices(moved)).toEqual([])
  })

  it("drops every choice while the address is being re-quoted", () => {
    const quoted = priced(baseState(), { so_std: 12900 })
    const inFlight = checkoutReducer(quoted, {
      type: "QUOTE_STARTED",
      signature: quoted.quoteSignature!,
    })

    expect(selectShippingChoices(inFlight)).toEqual([])
  })

  it("drops every choice when the quote failed", () => {
    const quoted = priced(baseState(), { so_std: 12900 })
    const failed = checkoutReducer(quoted, {
      type: "QUOTE_FAILED",
      signature: quoted.quoteSignature!,
    })

    expect(selectShippingChoices(failed)).toEqual([])
  })

  /**
   * Free shipping is a price, and `0` is falsy. The component this replaces used
   * `calculatedPricesMap[option.id] ? … : "-"`, so a carrier quoting zero was
   * rendered as having no price and could not be chosen.
   */
  it("treats a zero amount as a real, selectable price", () => {
    const state = priced(baseState(), { so_std: 0 })

    expect(selectShippingChoices(state)).toEqual([
      { id: "so_std", name: "so_std", amount: 0, selectable: true },
    ])
  })

  /**
   * A partial result. The row stays visible so the customer can see the carrier
   * exists — a row that silently disappears reads as a store with fewer options
   * — but it carries no amount and cannot be picked. No `-`, no placeholder.
   */
  it("keeps an unpriced calculated option visible and unselectable, with no amount", () => {
    const state = priced(baseState({}, [option("so_std"), option("so_exp")]), {
      so_std: 12900,
    })

    expect(selectShippingChoices(state)).toEqual([
      { id: "so_std", name: "so_std", amount: 12900, selectable: true },
      { id: "so_exp", name: "so_exp", amount: null, selectable: false },
    ])
  })

  it("reads a flat option's amount off the option, not off the price map", () => {
    const state = priced(
      baseState({}, [flatOption("so_flat", 9900)]),
      {},
      [flatOption("so_flat", 9900)]
    )

    expect(selectShippingChoices(state)).toEqual([
      { id: "so_flat", name: "so_flat", amount: 9900, selectable: true },
    ])
  })

  it("does not let a stray price map entry give a flat option an amount", () => {
    const state = priced(
      baseState({}, [flatOption("so_flat", null)]),
      { so_flat: 50000 },
      [flatOption("so_flat", null)]
    )

    expect(selectShippingChoices(state)).toEqual([
      { id: "so_flat", name: "so_flat", amount: null, selectable: false },
    ])
  })

  it("refuses an option the warehouse cannot fulfil, even when it is priced", () => {
    const unavailable = {
      id: "so_std",
      name: "so_std",
      price_type: "calculated",
      insufficient_inventory: true,
    } as unknown as HttpTypes.StoreCartShippingOption

    const state = priced(baseState({}, [unavailable]), { so_std: 12900 }, [
      unavailable,
    ])

    expect(selectShippingChoices(state)).toEqual([
      { id: "so_std", name: "so_std", amount: 12900, selectable: false },
    ])
  })

  /**
   * `typeof x === "number"` is not enough: `NaN` and `Infinity` are numbers, and
   * `convertToLocale` would render one of them into the price column as literal
   * text. Amounts arrive from two places this module does not control — a
   * `Promise.allSettled` fan-out and the backend's own `amount` field — so the
   * guard has to be about the VALUE, not about its type.
   */
  it("treats a non-finite amount as no price at all", () => {
    const state = priced(baseState(), { so_std: Number.NaN })

    expect(selectShippingChoices(state)).toEqual([
      { id: "so_std", name: "so_std", amount: null, selectable: false },
    ])
  })

  it("treats an infinite flat amount as no price at all", () => {
    const wild = flatOption("so_flat", Number.POSITIVE_INFINITY)
    const state = priced(baseState({}, [wild]), {}, [wild])

    expect(selectShippingChoices(state)).toEqual([
      { id: "so_flat", name: "so_flat", amount: null, selectable: false },
    ])
  })

  it("falls back to an empty label rather than rendering undefined", () => {
    const nameless = {
      id: "so_std",
      price_type: "calculated",
    } as unknown as HttpTypes.StoreCartShippingOption

    const state = priced(baseState({}, [nameless]), { so_std: 100 }, [nameless])

    expect(selectShippingChoices(state)[0].name).toBe("")
  })
})

/**
 * `selectCarrierRatesUnavailable` (S0) — the annotation, orthogonal to the six
 * quotation states. It answers "did this round leave a calculated option without
 * a price?" and is `true` ONLY in `quoted` with at least one unpresentable
 * calculated row. Never a seventh state; `false` everywhere else by
 * construction.
 */
describe("selectCarrierRatesUnavailable", () => {
  const flatOption = (id: string, amount: number | null) =>
    ({
      id,
      name: id,
      price_type: "flat",
      amount,
    } as unknown as HttpTypes.StoreCartShippingOption)

  const priced = (
    state: CheckoutState,
    prices: Record<string, number>,
    options = state.shippingOptions
  ) =>
    checkoutReducer(state, {
      type: "QUOTE_READY",
      signature: state.quoteSignature!,
      options,
      prices,
    })

  /**
   * The revenue-rescue case (S0): a calculated `Expres` that never priced beside
   * a presentable flat `Gratis`. The round is `quoted`, the flat option sells,
   * and the annotation flags that a carrier rate is missing.
   */
  it("is true in a quoted round where a calculated option has no price", () => {
    const state = priced(
      baseState({}, [option("so_expres"), flatOption("so_gratis", 0)]),
      {},
      [option("so_expres"), flatOption("so_gratis", 0)]
    )

    expect(selectQuoteStatus(state)).toBe("quoted")
    expect(selectCarrierRatesUnavailable(state)).toBe(true)
  })

  it("is false in a quoted round where every calculated option is priced", () => {
    const state = priced(baseState({}, [option("so_std"), option("so_exp")]), {
      so_std: 12900,
      so_exp: 24900,
    })

    expect(selectQuoteStatus(state)).toBe("quoted")
    expect(selectCarrierRatesUnavailable(state)).toBe(false)
  })

  /**
   * A calculated option priced at `0` is presentable — free shipping is a price.
   * The annotation must NOT fire on it (`Number.isFinite`, not truthiness).
   */
  it("is false when a calculated option is priced at zero", () => {
    const state = priced(baseState({}, [option("so_std")]), { so_std: 0 })

    expect(selectCarrierRatesUnavailable(state)).toBe(false)
  })

  it("is false in an all-flat quoted round with no calculated option at all", () => {
    const state = priced(
      baseState({}, [flatOption("so_gratis", 0)]),
      {},
      [flatOption("so_gratis", 0)]
    )

    expect(selectQuoteStatus(state)).toBe("quoted")
    expect(selectCarrierRatesUnavailable(state)).toBe(false)
  })

  it("is false in the idle state", () => {
    const idle = baseState({
      shipping_address: { id: "caaddr_01", ...CDMX, postal_code: "" },
    })

    expect(selectQuoteStatus(idle)).toBe("idle")
    expect(selectCarrierRatesUnavailable(idle)).toBe(false)
  })

  it("is false while a quote is in flight", () => {
    const state = baseState()
    const inFlight = checkoutReducer(state, {
      type: "QUOTE_STARTED",
      signature: state.quoteSignature!,
    })

    expect(selectQuoteStatus(inFlight)).toBe("quoting")
    expect(selectCarrierRatesUnavailable(inFlight)).toBe(false)
  })

  /**
   * The dangerous false positive to prevent: a `failed` round also has an
   * unpriced calculated row, but the annotation belongs to `quoted` only —
   * `failed` renders its own copy.
   */
  it("is false in the failed state even though a calculated row is unpriced", () => {
    const state = baseState()
    const failed = checkoutReducer(state, {
      type: "QUOTE_FAILED",
      signature: state.quoteSignature!,
    })

    expect(selectQuoteStatus(failed)).toBe("failed")
    expect(selectCarrierRatesUnavailable(failed)).toBe(false)
  })

  it("is false in the not_serviceable state", () => {
    const state = baseState()
    const empty = checkoutReducer(state, {
      type: "QUOTE_READY",
      signature: state.quoteSignature!,
      options: [],
      prices: {},
    })

    expect(selectQuoteStatus(empty)).toBe("not_serviceable")
    expect(selectCarrierRatesUnavailable(empty)).toBe(false)
  })
})

/**
 * PR2b / D4 step 3 — whether the summary is allowed to present its shipping line
 * and grand total as final.
 *
 * This exists because of finding F2, not because of a UI preference. Per F1 the
 * storefront cannot remove a shipping method, and per F2 `updateCartWorkflow`
 * unconditionally re-runs `refreshCartShippingMethodsWorkflow`, which RE-PRICES
 * the surviving method for the new destination. So the moment the customer
 * changes their postal code, `cart.total` silently becomes a number they never
 * agreed to — and the summary reads it straight off the cart.
 *
 * Marking it provisional is the whole mitigation. A boolean, and it decides how
 * money is presented, so it is asserted rather than written into JSX.
 */
describe("selectShippingIsProvisional", () => {
  const ordered = (overrides: Record<string, unknown> = {}) =>
    baseState({
      shipping_methods: [{ shipping_option_id: "so_std" }],
      billing_address: { id: "baddr_01", ...CDMX },
      ...overrides,
    })

  it("is false on a cart whose selection still belongs to the address on screen", () => {
    const selected = run(ordered(), selectShipping("so_std"))

    expect(selectShippingIsProvisional(selected)).toBe(false)
  })

  it("is true once the destination moves under a chosen method", () => {
    const moved = run(
      ordered(),
      selectShipping("so_std"),
      { type: "FIELD_BLUR", field: "postal_code", value: "44160" }
    )

    expect(selectShippingIsProvisional(moved)).toBe(true)
  })

  /**
   * The street does not move a price (the signature is postal code, province,
   * city and country only), so de-emphasising the total here would train the
   * customer to ignore the one signal that means something.
   */
  it("is false after a street edit", () => {
    const edited = run(
      ordered(),
      selectShipping("so_std"),
      { type: "FIELD_BLUR", field: "address_1", value: "Otra calle 55" }
    )

    expect(selectShippingIsProvisional(edited)).toBe(false)
  })

  /**
   * Nothing was ever chosen, so there is no price to re-price and nothing to
   * warn about. The CTA already says `Elige un método de envío.` \u2014 saying
   * "the shipping cost will be recalculated" on top of that describes a
   * recalculation of a number that does not exist.
   */
  it("is false when no shipping method has been chosen at all", () => {
    const untouched = run(baseState({ billing_address: null }), {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })

    expect(selectShippingIsProvisional(untouched)).toBe(false)
  })

  /**
   * The provisional note has to survive the write it describes. `setShippingMethod`
   * and the autosave both return a cart, and per F1 that cart still carries the
   * shipping-method row \u2014 re-priced. If applying it cleared the warning, the
   * re-priced total would be presented as final at exactly the moment it changed.
   */
  it("survives a cart update carrying the re-priced method row", () => {
    const moved = run(
      ordered(),
      selectShipping("so_std"),
      { type: "FIELD_BLUR", field: "postal_code", value: "44160" }
    )

    const repriced = checkoutReducer(moved, {
      type: "CART_UPDATED",
      cart: cartWith({
        shipping_methods: [{ shipping_option_id: "so_std", amount: 39900 }],
        shipping_address: { id: "caaddr_01", ...CDMX, postal_code: "44160" },
        total: 99900,
      }),
      sequence: 1,
    })

    expect(repriced.cart?.shipping_methods).toHaveLength(1)
    expect(selectShippingIsProvisional(repriced)).toBe(true)
  })

  /**
   * Re-picking is what clears it, and it is the only thing that does. This is the
   * customer agreeing to the new number.
   */
  it("clears once the customer re-picks under the new destination", () => {
    const repicked = run(
      ordered(),
      selectShipping("so_std"),
      { type: "FIELD_BLUR", field: "postal_code", value: "44160" },
      selectShipping("so_std")
    )

    expect(selectShippingIsProvisional(repicked)).toBe(false)
  })

  /**
   * The two cases that tell "provisional is `shipping_method_stale`" apart from
   * "provisional is `isShippingSelectionStale`". Both implementations agree on
   * the ordinary A → B path, which is why a second derivation of the rule looks
   * harmless right up until it disagrees with the button beside it.
   */
  it("is false when the selection is stale but the cart carries no method to re-price", () => {
    // Reachable when the `setShippingMethod` response was superseded by a newer
    // write: the client believes it chose, the cart has no row. There is no
    // re-priced number to warn about, and the CTA already says `Elige un método
    // de envío.` — adding "the shipping cost will be recalculated" on top
    // describes the recalculation of a price that does not exist.
    const orphan = run(
      baseState({ billing_address: { id: "baddr_01", ...CDMX } }),
      selectShipping("so_std"),
      { type: "FIELD_BLUR", field: "postal_code", value: "44160" }
    )

    expect(orphan.cart?.shipping_methods).toEqual([])
    expect(selectShippingIsProvisional(orphan)).toBe(false)
  })

  /**
   * The summary half of the A -> B -> A round trip. `selectShippingIsProvisional`
   * is DEFINED as the presence of `shipping_method_stale`, so if the CTA unblocks
   * on the way back the summary re-presents the twice-re-priced total as final in
   * the very same render. One rule, so the two cannot disagree — which is exactly
   * why the rule has to be right.
   */
  it("stays true after the customer leaves an address and returns to it", () => {
    const roundTrip = run(
      ordered(),
      selectShipping("so_std"),
      { type: "FIELD_BLUR", field: "postal_code", value: "44160" },
      { type: "FIELD_BLUR", field: "postal_code", value: "06700" }
    )

    expect(roundTrip.selectedShippingOptionId).toBeNull()
    expect(selectShippingIsProvisional(roundTrip)).toBe(true)
  })

  it("is false when the cart emptied under a stale selection", () => {
    // `cart_empty` short-circuits the whole catalogue. A customer whose last line
    // item was removed is told one thing to fix, not two.
    const emptied = run(
      ordered({ items: [] }),
      selectShipping("so_std"),
      { type: "FIELD_BLUR", field: "postal_code", value: "44160" }
    )

    expect(selectShippingIsProvisional(emptied)).toBe(false)
  })

  it("is false on an empty cart rather than warning about a total of zero", () => {
    const empty = initFromServer({
      cart: null,
      customer: null,
      shippingOptions: null,
    })

    expect(selectShippingIsProvisional(empty)).toBe(false)
  })
})

/**
 * 2b.6 — the seam PR1b opened deliberately, closed end to end.
 *
 * NOT a TDD cycle: no production code was written for these. The transitions
 * already existed; what did not exist until PR2b is the PATH that reaches them —
 * `setShippingMethod` returning a cart and the section dispatching `CART_UPDATED`
 * with it. These pin the whole sequence a customer actually performs, because the
 * dangerous half of this mechanism is invisible from any single transition:
 *
 * per finding F1 the POST is replace-all and there is no delete, so the cart that
 * comes back from EVERY subsequent write still carries a shipping-method row. Any
 * consumer that reads the checked radio off `cart.shipping_methods` instead of off
 * `selectedShippingOptionId` re-ticks the option the reducer just invalidated, and
 * the customer is silently re-committed to a price quoted for their old postal
 * code. The old `shipping/index.tsx` seeded its selection exactly that way.
 */
describe("the stale-selection seam, from selection to re-pick (2b.6)", () => {
  const quoted = (state: CheckoutState, prices: Record<string, number>) =>
    checkoutReducer(state, {
      type: "QUOTE_READY",
      signature: state.quoteSignature!,
      options: state.shippingOptions,
      prices,
    })

  it("leaves no option checked after a postal-code change, while the cart still carries the row", () => {
    const chosen = run(
      quoted(baseState(), { so_std: 12900 }),
      selectShipping("so_std"),
      {
        // What `setShippingMethod` returns: the method is now on the cart.
        type: "CART_UPDATED",
        cart: cartWith({
          shipping_methods: [{ shipping_option_id: "so_std", amount: 12900 }],
        }),
        sequence: 1,
      }
    )

    expect(chosen.selectedShippingOptionId).toBe("so_std")

    const moved = checkoutReducer(chosen, {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })

    // The row survives — F1 says it must — and the selection does not.
    expect(moved.cart?.shipping_methods).toHaveLength(1)
    expect(moved.selectedShippingOptionId).toBeNull()
    expect(selectShippingChoices(moved)).toEqual([])
    expect(selectShippingIsProvisional(moved)).toBe(true)
  })

  it("does not re-tick the radio when the next autosave returns the re-priced cart", () => {
    const moved = run(
      quoted(baseState(), { so_std: 12900 }),
      selectShipping("so_std"),
      {
        type: "CART_UPDATED",
        cart: cartWith({
          shipping_methods: [{ shipping_option_id: "so_std", amount: 12900 }],
        }),
        sequence: 1,
      },
      { type: "FIELD_BLUR", field: "postal_code", value: "44160" },
      {
        // The autosave lands. Per F2 the backend has re-priced the surviving
        // method to the new destination without being asked.
        type: "CART_UPDATED",
        cart: cartWith({
          shipping_methods: [{ shipping_option_id: "so_std", amount: 38900 }],
          shipping_address: { id: "caaddr_01", ...CDMX, postal_code: "44160" },
        }),
        sequence: 2,
      }
    )

    expect(moved.selectedShippingOptionId).toBeNull()
    expect(selectShippingIsProvisional(moved)).toBe(true)
  })

  it("survives a street edit, because a street cannot move a price", () => {
    const chosen = run(
      quoted(baseState(), { so_std: 12900 }),
      selectShipping("so_std"),
      {
        type: "CART_UPDATED",
        cart: cartWith({
          shipping_methods: [{ shipping_option_id: "so_std", amount: 12900 }],
        }),
        sequence: 1,
      },
      { type: "FIELD_BLUR", field: "address_1", value: "Otra calle 55" }
    )

    expect(chosen.selectedShippingOptionId).toBe("so_std")
    expect(selectShippingIsProvisional(chosen)).toBe(false)

    /**
     * The customer-visible half, and the half that was missing: the PRICES have
     * to survive too, not just the selection and the flag.
     *
     * Dropping `calculatedPrices` on a non-quote-relevant edit leaves
     * `selectQuoteStatus` reading `quoted` while every row renders "No
     * disponible" and turns unselectable — so a customer who corrects a typo in
     * their street loses the prices they were just shown, and cannot even
     * re-pick the option they had. A reviewer's mutant did exactly that and
     * survived the entire suite, because the two assertions above look like they
     * cover this and do not.
     */
    expect(chosen.calculatedPrices).toEqual({ so_std: 12900 })

    const choices = selectShippingChoices(chosen)
    expect(choices).toHaveLength(1)
    expect(choices[0]).toMatchObject({
      id: "so_std",
      amount: 12900,
      selectable: true,
    })
  })

  it("re-picking under the new destination restores a checked radio and a final total", () => {
    const moved = run(
      quoted(baseState(), { so_std: 12900 }),
      selectShipping("so_std"),
      { type: "FIELD_BLUR", field: "postal_code", value: "44160" }
    )

    const requoted = quoted(moved, { so_std: 38900 })
    expect(selectShippingChoices(requoted)).toEqual([
      { id: "so_std", name: "so_std", amount: 38900, selectable: true },
    ])
    expect(requoted.selectedShippingOptionId).toBeNull()

    const repicked = checkoutReducer(requoted, selectShipping("so_std")(requoted))

    expect(repicked.selectedShippingOptionId).toBe("so_std")
    expect(selectShippingIsProvisional(repicked)).toBe(false)
  })
})

/**
 * ---------------------------------------------------------------------------
 * PLACE_ORDER_STARTED / PLACE_ORDER_SETTLED (PR2c, tasks 2c.7 / 2c.11)
 * ---------------------------------------------------------------------------
 *
 * The CTA's own busy state. `placeOrderFlow` runs a browser tokenisation, a
 * cart write and a payment-session creation before anything navigates, which is
 * seconds of wall time on a slow connection with no visible change on the page.
 *
 * Task 2c.11 requires every tail to RE-ENABLE the button on any failure. That
 * is one transition, so it is expressed as one action rather than as a flag the
 * three tails each remember to reset — which is how a checkout ends up with a
 * button that spins forever after a declined card.
 */
describe("placing the order", () => {
  it("marks the checkout busy and clears any previous error", () => {
    const state = checkoutReducer(
      { ...baseState(), error: "El costo de envío cambió." },
      { type: "PLACE_ORDER_STARTED" }
    )

    expect(state.placingOrder).toBe(true)
    // A stale error beside a spinner reads as if the new attempt already
    // failed.
    expect(state.error).toBeNull()
  })

  it("re-enables the CTA and surfaces the reason when the attempt fails", () => {
    const busy = checkoutReducer(baseState(), { type: "PLACE_ORDER_STARTED" })

    const settled = checkoutReducer(busy, {
      type: "PLACE_ORDER_SETTLED",
      error: "No pudimos completar tu pedido. Inténtalo de nuevo.",
    })

    expect(settled.placingOrder).toBe(false)
    expect(settled.error).toBe(
      "No pudimos completar tu pedido. Inténtalo de nuevo."
    )
  })

  /**
   * The success path settles WITHOUT an error, because the browser is about to
   * navigate and a flash of an error banner on the way out is worse than
   * nothing. The busy flag still drops so a back-button return finds a usable
   * button rather than a dead one.
   */
  it("settles cleanly when there is nothing to report", () => {
    const busy = checkoutReducer(baseState(), { type: "PLACE_ORDER_STARTED" })

    const settled = checkoutReducer(busy, {
      type: "PLACE_ORDER_SETTLED",
      error: null,
    })

    expect(settled.placingOrder).toBe(false)
    expect(settled.error).toBeNull()
  })

  it("starts idle", () => {
    expect(baseState().placingOrder).toBe(false)
  })
})

/**
 * ---------------------------------------------------------------------------
 * selectPlaceOrderView (PR2c slice 2, tasks 2c.15–2c.17)
 * ---------------------------------------------------------------------------
 *
 * Everything the final CTA renders, decided in one place.
 *
 * `place-order-bar` renders TWICE — `inline` on desktop, `sticky` on mobile —
 * and `missing-items-list` renders the same catalogue a third time. Three
 * components deriving "is the button disabled" and "what is the total"
 * independently is three chances for the bar to disagree with the summary, or
 * for the sticky button to be enabled while the inline one is not. They are
 * `.tsx` files, so nothing could contradict any of the three.
 *
 * These assertions are about the OUTPUT, never about how it is computed. They
 * do not re-call `getMissingOrderRequirements` and compare — `X === X` passes
 * for every `X`, which is the vacuous-coverage mistake this change has already
 * shipped once (slice 1, remediation R3).
 */
describe("selectPlaceOrderView", () => {
  /** A cart that is ready in every respect the catalogue checks. */
  const ready = () =>
    run(
      baseState({ shipping_methods: [{ shipping_option_id: "so_std" }] }),
      selectShipping("so_std"),
      {
        type: "SELECT_PAYMENT_PROVIDER",
        providerId: "pp_mercadopago_mercadopago",
      }
    )

  it("reports nothing missing and an enabled CTA on a ready cart", () => {
    const view = selectPlaceOrderView(ready())

    expect(view.missing).toEqual([])
    expect(view.firstMissingMessage).toBeNull()
    expect(view.disabled).toBe(false)
  })

  it("blocks the CTA and names every unmet requirement", () => {
    const view = selectPlaceOrderView(baseState({ email: null }))

    expect(view.disabled).toBe(true)
    expect(view.missing.map((item) => item.code)).toEqual([
      "email",
      "shipping_method",
      "payment_method",
    ])
  })

  /**
   * The sticky bar shows ONE line (D9): the full list renders in page flow
   * above it, and repeating all of it inside a fixed bar is not viable on a
   * small viewport. It must be the FIRST entry — the catalogue is ordered by
   * page position, so the first entry is the next thing the customer can act
   * on. Showing the last one sends them past everything they still have to do.
   */
  it("surfaces the first missing requirement, not an arbitrary one", () => {
    const view = selectPlaceOrderView(baseState({ email: null }))

    expect(view.firstMissingMessage).toBe("Falta tu correo electrónico.")
    expect(view.missing[0].code).toBe("email")
  })

  /**
   * The re-entrancy lock lives in `place-order-flow.ts` and is synchronous;
   * this is the AFFORDANCE. Without it a customer on a slow connection sees a
   * fully enabled button for the two to three seconds a tokenisation takes, and
   * a second click is stopped only by a closure flag they cannot see.
   */
  it("disables the CTA while an attempt is already running", () => {
    const busy = checkoutReducer(ready(), { type: "PLACE_ORDER_STARTED" })
    const view = selectPlaceOrderView(busy)

    expect(view.missing).toEqual([])
    expect(view.placing).toBe(true)
    expect(view.disabled).toBe(true)
  })

  it("gives the CTA back once the attempt settles", () => {
    const settled = run(
      ready(),
      { type: "PLACE_ORDER_STARTED" },
      { type: "PLACE_ORDER_SETTLED", error: "Tu tarjeta fue rechazada." }
    )
    const view = selectPlaceOrderView(settled)

    expect(view.placing).toBe(false)
    expect(view.disabled).toBe(false)
    expect(view.error).toBe("Tu tarjeta fue rechazada.")
  })

  /**
   * The bar's total is `cart.total` — the SAME field `CartTotals` renders for
   * the summary (`cart-totals/index.tsx`, `data-testid="cart-total"`). Any
   * other field, `subtotal` and `item_subtotal` most plausibly, produces a bar
   * that disagrees with the summary the moment shipping or a promotion moves,
   * which is the one thing the spec forbids outright.
   */
  it("takes the total from the same field the summary renders", () => {
    const view = selectPlaceOrderView(
      baseState({ total: 129900, item_subtotal: 99900, currency_code: "usd" })
    )

    expect(view.total).toBe(129900)
    // Read off the cart, never assumed: the store is MXN today and a hard-coded
    // "mxn" would render a peso sign over a figure in another currency.
    expect(view.currencyCode).toBe("usd")
  })

  it("survives a cart that has not resolved yet", () => {
    const view = selectPlaceOrderView({ ...baseState(), cart: null })

    expect(view.total).toBeNull()
    expect(view.disabled).toBe(true)
    expect(view.missing.map((item) => item.code)).toEqual(["cart_empty"])
    /**
     * A CURRENCY, not `""`. `convertToLocale` falls back to a bare number on an
     * empty code, so the fallback is the difference between "$1,299.00" and an
     * unlabelled "1299" beside a purchase button.
     */
    expect(view.currencyCode).toBe("mxn")
  })

  /**
   * D4: the bar de-emphasises its total while the shipping selection is stale,
   * for the same reason the summary does. Defined as the presence of
   * `shipping_method_stale` in the very list the bar is already rendering, so a
   * bar that shows a final-looking total beside "vuelve a elegir el método de
   * envío" is not expressible.
   */
  it("marks the total provisional exactly while the selection is stale", () => {
    const settled = selectPlaceOrderView(ready())
    expect(settled.provisional).toBe(false)

    const moved = checkoutReducer(ready(), {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })
    const view = selectPlaceOrderView(moved)

    expect(view.provisional).toBe(true)
    expect(view.missing.map((item) => item.code)).toContain(
      "shipping_method_stale"
    )
  })

  /**
   * The empty cart short-circuits the catalogue, so it also short-circuits the
   * bar: one line, and it is the only one (spec *Cart Mutations During Checkout
   * Re-Derive Price and Readiness*).
   */
  it("reports only the empty-cart line when the last item is removed", () => {
    const emptied = checkoutReducer(ready(), {
      type: "CART_UPDATED",
      cart: cartWith({ items: [] }),
      sequence: 1,
    })
    const view = selectPlaceOrderView(emptied)

    expect(view.missing.map((item) => item.code)).toEqual(["cart_empty"])
    expect(view.firstMissingMessage).toBe("Tu carrito está vacío.")
  })
})

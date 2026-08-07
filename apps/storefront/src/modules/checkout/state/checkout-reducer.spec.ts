import { getMissingOrderRequirements } from "@lib/util/checkout-readiness"
import { evaluateQuoteReadiness } from "@lib/util/shipping-quote"
import type { HttpTypes } from "@medusajs/types"
import { describe, expect, it } from "vitest"

import {
  checkoutReducer,
  initFromServer,
  selectQuoteIsBlockedByFailure,
  selectQuoteRelevantAddress,
  selectQuoteStatus,
  selectReadinessInput,
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
const run = (
  state: CheckoutState,
  ...actions: Parameters<typeof checkoutReducer>[1][]
): CheckoutState => actions.reduce(checkoutReducer, state)

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
      { type: "SELECT_SHIPPING_OPTION", optionId: "so_std" }
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
      { type: "SELECT_SHIPPING_OPTION", optionId: "so_std" }
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
      { type: "SELECT_SHIPPING_OPTION", optionId: "so_std" }
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
    "address_2",
  ] as const)("leaves the signature untouched for %s", (field) => {
    const before = baseState()
    const after = checkoutReducer(before, {
      type: "FIELD_BLUR",
      field,
      value: "cambiado",
    })
    expect(after.quoteSignature).toBe(before.quoteSignature)
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
  it("leaves quotedSignature unchanged so the same address is retryable", () => {
    const state = baseState()
    const quoted = run(state, {
      type: "QUOTE_READY",
      signature: state.quoteSignature!,
      options: [option("so_std")],
      prices: { so_std: 100 },
    })

    const moved = checkoutReducer(quoted, {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44160",
    })
    const failed = checkoutReducer(moved, {
      type: "QUOTE_FAILED",
      signature: moved.quoteSignature!,
    })

    // `quotedSignature` still points at the LAST SUCCESS. That is what makes
    // `evaluateQuoteReadiness` return `quote` again for the failed address
    // instead of `already_quoted`.
    expect(failed.quotedSignature).toBe(quoted.quotedSignature)
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
      { type: "SELECT_SHIPPING_OPTION", optionId: "so_std" },
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
    const after = checkoutReducer(state, {
      type: "SELECT_SHIPPING_OPTION",
      optionId: "so_std",
    })

    expect(after.selectedShippingOptionId).toBe("so_std")
    expect(after.selectionSignature).toBe(state.quoteSignature)
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
    const state = checkoutReducer(baseState(), { type: "CP_LOOKUP_NOT_FOUND" })

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
      province: "CDMX",
      city: "Ciudad de México",
      colonias: ["Roma Norte", "Roma Sur"],
    })

    expect(resolved.quoteSignature).not.toBeNull()
    expect(resolved.draft.address_1).toBe("")
  })

  it("keeps a colonia that is not in the returned list as free text", () => {
    const state = checkoutReducer(baseState(), {
      type: "CP_LOOKUP_FOUND",
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
    const missed = checkoutReducer(baseState(), { type: "CP_LOOKUP_NOT_FOUND" })
    expect(missed.cpStatus).toBe("not_found")

    expect(checkoutReducer(missed, { type: "CP_LOOKUP_RESET" }).cpStatus).toBe(
      "idle"
    )

    const listed = checkoutReducer(baseState(), {
      type: "CP_LOOKUP_FOUND",
      province: "CDMX",
      city: "Ciudad de México",
      colonias: ["Roma Norte", "Roma Sur"],
    })
    expect(listed.colonias).toHaveLength(2)

    expect(
      checkoutReducer(listed, { type: "CP_LOOKUP_RESET" }).colonias
    ).toEqual([])
  })

  it("returns the identical state object when there is nothing to reset", () => {
    // Cheap, but not cosmetic: this action fires from an effect that runs on
    // every postal-code change, and a fresh object each time is a re-render of
    // the whole checkout tree for no reason.
    const state = baseState()
    expect(checkoutReducer(state, { type: "CP_LOOKUP_RESET" })).toBe(state)
  })

  it("clears the colonia when the customer asks to type one", () => {
    const state = checkoutReducer(baseState(), {
      type: "COLONIA_MANUAL_REQUESTED",
    })

    expect(state.coloniaManual).toBe(true)
    expect(state.draft.address_2).toBe("")
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
   * `isShippingSelectionStale` is documented as asymmetric: a `null` SELECTION
   * signature is never stale, because a method chosen before the client had
   * derived a signature is not evidence that anything moved. The reducer has to
   * honour that, or a returning customer whose address was not quotable loses
   * the shipping method they already picked the moment they finish typing it.
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

  it("survives the address becoming quotable", () => {
    const state = returningWithUnquotableAddress()
    expect(state.selectedShippingOptionId).toBe("so_std")
    expect(state.selectionSignature).toBeNull()

    const completed = checkoutReducer(state, {
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "06700",
    })

    expect(completed.quoteSignature).not.toBeNull()
    expect(completed.selectedShippingOptionId).toBe("so_std")
  })

  it("is not seeded with a signature when the cart has no method at all", () => {
    const state = baseState()
    expect(state.selectedShippingOptionId).toBeNull()
    expect(state.selectionSignature).toBeNull()
  })
})

describe("selectReadinessInput — the seam PR1b left open, now closed", () => {
  it("makes the CTA report a stale selection after a postal-code change", () => {
    const selected = run(
      baseState({
        shipping_methods: [{ shipping_option_id: "so_std" }],
        billing_address: { id: "baddr_01", ...CDMX },
      }),
      { type: "SELECT_SHIPPING_OPTION", optionId: "so_std" },
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

  it("does not report staleness after a street edit", () => {
    const selected = run(
      baseState({
        shipping_methods: [{ shipping_option_id: "so_std" }],
        billing_address: { id: "baddr_01", ...CDMX },
      }),
      { type: "SELECT_SHIPPING_OPTION", optionId: "so_std" },
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
      { type: "SELECT_SHIPPING_OPTION", optionId: "so_std" },
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
      { type: "SELECT_SHIPPING_OPTION", optionId: "so_std" }
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
      { type: "SELECT_SHIPPING_OPTION", optionId: "so_std" },
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
      const found = checkoutReducer(baseState({ shipping_address: null }), {
        type: "CP_LOOKUP_FOUND",
        province: "Jalisco",
        city: "Guadalajara",
        colonias: ["Americana", "Lafayette"],
      })

      expect(found.draft.address_2).toBe("")
      expect(found.coloniaManual).toBe(false)
    })

    it("goes manual for a colonia the returned list does not contain", () => {
      const found = checkoutReducer(baseState(), {
        type: "CP_LOOKUP_FOUND",
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
        province: "Jalisco",
        city: "Guadalajara",
        colonias: ["Americana", "Lafayette"],
      })

      expect(withList.colonias).toHaveLength(2)
      expect(
        checkoutReducer(withList, { type: "CP_LOOKUP_NOT_FOUND" }).colonias
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
 * existed only on paper. `quote-retry-notice` is now its consumer; these assert
 * the reducer half actually unblocks the effect.
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

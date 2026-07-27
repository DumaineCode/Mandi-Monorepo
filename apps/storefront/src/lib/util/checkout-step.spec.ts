import { HttpTypes } from "@medusajs/types"
import { describe, expect, it } from "vitest"

import { getCheckoutStep, hasCompleteShippingContact } from "./checkout-step"

type CartOverrides = {
  address_1?: string | null
  email?: string | null
  phone?: string | null
  shipping_methods?: unknown[]
  shipping_address?: null
}

/** A cart that satisfies every branch, so each test only states its one deviation. */
const COMPLETE_CART = {
  address_1: "Av. Insurgentes Sur 1602",
  email: "cliente@example.mx",
  phone: "5512345678",
  shipping_methods: [] as unknown[],
  shipping_address: undefined as null | undefined,
}

/**
 * Minimal cart stub. `StoreCart` is far too wide to build honestly here and none
 * of the extra fields participate in either decision, so the cast is deliberate:
 * it keeps each test showing only the values the predicate actually reads.
 *
 * Overrides are applied by SPREAD, not by destructuring defaults. That is the
 * whole point: `{ phone: undefined }` has to mean "this cart has no phone", and a
 * destructuring default would silently substitute the happy value back in — the
 * "missing phone" tests would then quietly assert nothing.
 */
const buildCart = (overrides: CartOverrides = {}): HttpTypes.StoreCart => {
  const { address_1, email, phone, shipping_methods, shipping_address } = {
    ...COMPLETE_CART,
    ...overrides,
  }

  return {
    email,
    shipping_address: shipping_address === null ? null : { address_1, phone },
    shipping_methods,
  } as unknown as HttpTypes.StoreCart
}

describe("hasCompleteShippingContact", () => {
  it("is true when address, email and phone are all present", () => {
    expect(hasCompleteShippingContact(buildCart())).toBe(true)
  })

  it.each([undefined, null])("is false for a %j cart", (cart) => {
    expect(hasCompleteShippingContact(cart)).toBe(false)
  })

  it("is false when the cart has no shipping address at all", () => {
    expect(hasCompleteShippingContact(buildCart({ shipping_address: null }))).toBe(
      false
    )
  })

  describe.each([
    ["address_1", { address_1: undefined }, { address_1: "" }, { address_1: "   " }],
    ["email", { email: undefined }, { email: "" }, { email: "   " }],
    ["phone", { phone: undefined }, { phone: "" }, { phone: "   " }],
  ] as const)("%s", (_field, missing, blank, whitespace) => {
    it("is false when missing", () => {
      expect(hasCompleteShippingContact(buildCart(missing))).toBe(false)
    })

    it("is false when blank", () => {
      expect(hasCompleteShippingContact(buildCart(blank))).toBe(false)
    })

    it("is false when whitespace only", () => {
      expect(hasCompleteShippingContact(buildCart(whitespace))).toBe(false)
    })
  })

  /**
   * The predicate is blank-vs-present ON PURPOSE. Format is the input `pattern`'s
   * job and the backend normalizes before the wire; re-checking format here would
   * risk trapping a customer in a step they cannot leave. If someone later
   * "tightens" this to a format check, this test is the one that should object.
   */
  it("does not police phone format, only presence", () => {
    expect(hasCompleteShippingContact(buildCart({ phone: "12" }))).toBe(true)
  })
})

describe("getCheckoutStep", () => {
  /**
   * The regression this module exists for: a cart that already carried
   * `address_1` + `email` used to jump straight to `delivery`, so the required
   * phone input — which only renders while `step === "address"` — was never
   * shown, never validated and never submitted. Those orders reached checkout
   * with `phone: ""` and could not be labelled afterwards.
   */
  it.each([
    ["missing", undefined],
    ["blank", ""],
    ["whitespace only", "   "],
  ])("returns address when the phone is %s", (_label, phone) => {
    expect(getCheckoutStep(buildCart({ phone }))).toBe("address")
  })

  it("returns address when the contact is otherwise incomplete", () => {
    expect(getCheckoutStep(buildCart({ address_1: "" }))).toBe("address")
    expect(getCheckoutStep(buildCart({ email: "" }))).toBe("address")
    expect(getCheckoutStep(undefined)).toBe("address")
  })

  it("returns delivery once the contact is complete but no method is chosen", () => {
    expect(getCheckoutStep(buildCart({ shipping_methods: [] }))).toBe("delivery")
  })

  it("returns payment once a shipping method is chosen", () => {
    expect(getCheckoutStep(buildCart({ shipping_methods: [{ id: "sm_1" }] }))).toBe(
      "payment"
    )
  })

  /**
   * Locks the ORDER, not just the individual answers. A future edit that
   * reshuffles the branches would still satisfy the cases above one at a time;
   * this fails if the progression itself changes.
   */
  it("progresses address -> delivery -> payment as the cart is completed", () => {
    const steps = [
      buildCart({ phone: "" }),
      buildCart({ shipping_methods: [] }),
      buildCart({ shipping_methods: [{ id: "sm_1" }] }),
    ].map(getCheckoutStep)

    expect(steps).toEqual(["address", "delivery", "payment"])
  })

  /**
   * Characterization test, not an endorsement. `shipping_methods?.length === 0`
   * is false when the field is absent, so an unexpanded cart skips `delivery`.
   * The real fetch path always asks for `+shipping_methods.name`
   * (`lib/data/cart.ts`), so this is currently unreachable in the app — but if
   * that field is ever dropped from the query, this is the behaviour you get.
   */
  it("skips delivery when shipping_methods is absent (see comment)", () => {
    expect(getCheckoutStep(buildCart({ shipping_methods: undefined }))).toBe(
      "payment"
    )
  })

  /**
   * `review` is a checkout URL step owned by the payment component
   * (`checkout/components/payment/index.tsx` pushes `?step=review`); it is
   * deliberately NOT a value this resolver can return. This guards that boundary.
   */
  it("only ever returns one of the three steps it owns", () => {
    const carts = [
      undefined,
      buildCart({ phone: "" }),
      buildCart({ shipping_methods: [] }),
      buildCart({ shipping_methods: [{ id: "sm_1" }] }),
    ]

    for (const cart of carts) {
      expect(["address", "delivery", "payment"]).toContain(getCheckoutStep(cart))
    }
  })
})

import { describe, expect, it } from "vitest"

import { OPENPAY_CONTEXT_DEFAULT } from "./openpay-wrapper"

/**
 * The DEFAULT `OpenpayContext` value — what a consumer reads when it is not
 * inside `OpenpayWrapper`.
 *
 * ## Why a `.tsx` module has a spec at all
 *
 * Almost nothing in this component is reachable from `environment: "node"`.
 * This constant is, because it is a plain object literal, and it is the one
 * part that decides what the customer sees when the Openpay provider is
 * ABSENT — which is a state the checkout can genuinely reach in production.
 *
 * ## The state it describes, which is not hypothetical
 *
 * `getProviderConfig()` returns `{ openpay: null }` on ANY failure
 * (`provider-config.ts`), and `PaymentWrapper` then renders `<div>{children}</div>`
 * with **no provider at all**. `PaymentSection` still renders the Openpay row,
 * because it reads `availablePaymentMethods` — a different source, answered by
 * `listCartPaymentMethods`, which succeeded. So `OpenpayCardContainer` mounts
 * and reads THIS object.
 *
 * With `unavailable: false` it rendered `<SkeletonCardDetails />` forever: no
 * timeout, no provider that could ever flip `ready`, `paymentDetailsComplete`
 * permanently `false`, and the CTA sitting disabled beside "Completa los datos
 * de tu tarjeta." pointing at a card form that does not exist. The
 * `openpay-unavailable-message` written for exactly this case could not render,
 * because the default failed OPEN on the only field that selects it.
 *
 * Outside the provider Openpay can never become ready. `unavailable` must
 * therefore be `true`, on the same fail-closed principle as `isOpenpayOffered`
 * and `hasShippingMethod`.
 */
describe("OPENPAY_CONTEXT_DEFAULT", () => {
  it("reports Openpay as unavailable, not merely not-yet-ready", () => {
    expect(OPENPAY_CONTEXT_DEFAULT.unavailable).toBe(true)
  })

  /**
   * `ready` and `unavailable` are not opposites and both are read. The card
   * container's branch order is `unavailable ? message : ready ? form :
   * skeleton`, so a default that claimed readiness would render the card fields
   * against a `tokenize` that always rejects.
   */
  it("is not ready", () => {
    expect(OPENPAY_CONTEXT_DEFAULT.ready).toBe(false)
  })

  /**
   * The place-order flow asserts this BEFORE tokenising and fails with
   * `deviceSessionMissing`. A non-null default would let a charge be initiated
   * with a fabricated fraud signal.
   */
  it("carries no device session", () => {
    expect(OPENPAY_CONTEXT_DEFAULT.deviceSessionId).toBeNull()
  })

  it("holds no card data", () => {
    expect(OPENPAY_CONTEXT_DEFAULT.cardData).toBeNull()
  })

  /** Rejects rather than resolving with a falsy token that step 1 would have to catch. */
  it("refuses to tokenize", async () => {
    await expect(
      OPENPAY_CONTEXT_DEFAULT.tokenize({
        card_number: "4111111111111111",
        holder_name: "Ana Ruiz",
        expiration_month: "12",
        expiration_year: "30",
        cvv2: "123",
      })
    ).rejects.toThrow()
  })
})

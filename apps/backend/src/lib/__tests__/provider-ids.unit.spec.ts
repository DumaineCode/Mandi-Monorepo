import {
  MERCADOPAGO_IDENTIFIER,
  MERCADOPAGO_PROVIDER_ID,
  OPENPAY_IDENTIFIER,
  OPENPAY_PROVIDER_ID,
  SKYDROPX_IDENTIFIER,
  SKYDROPX_PROVIDER_ID,
} from "../constants"

/**
 * Provider id contract (spec OP-1, MP-1; design section 2).
 *
 * Medusa 2.x composes runtime provider ids as:
 * - payment: `pp_${class static identifier}_${config id}`
 * - fulfillment: `${class static identifier}_${config id}`
 *
 * The storefront `paymentInfoMap` in apps/storefront/src/lib/constants.tsx
 * must key on these exact literals. This test pins the documented literals
 * so id drift between backend and storefront is caught by construction,
 * not by convention.
 */
describe("provider id contract", () => {
  it("composes the Openpay runtime payment provider id", () => {
    expect(OPENPAY_PROVIDER_ID).toBe("pp_openpay_openpay")
    expect(OPENPAY_PROVIDER_ID).toBe(
      `pp_${OPENPAY_IDENTIFIER}_${OPENPAY_IDENTIFIER}`
    )
  })

  it("composes the Mercado Pago runtime payment provider id", () => {
    expect(MERCADOPAGO_PROVIDER_ID).toBe("pp_mercadopago_mercadopago")
    expect(MERCADOPAGO_PROVIDER_ID).toBe(
      `pp_${MERCADOPAGO_IDENTIFIER}_${MERCADOPAGO_IDENTIFIER}`
    )
  })

  it("composes the Skydropx runtime fulfillment provider id (no pp_ prefix)", () => {
    expect(SKYDROPX_PROVIDER_ID).toBe("skydropx_skydropx")
    expect(SKYDROPX_PROVIDER_ID).toBe(
      `${SKYDROPX_IDENTIFIER}_${SKYDROPX_IDENTIFIER}`
    )
  })
})

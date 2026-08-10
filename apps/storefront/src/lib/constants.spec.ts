import { describe, expect, it } from "vitest"

import {
  isManualProviderId,
  isMercadopagoProviderId,
  isOpenpayProviderId,
} from "./util/checkout-readiness"
import { paymentInfoMap } from "./constants"

/**
 * The payment-method rows the customer chooses between (PR2c slice 2).
 *
 * ## Why a `.tsx` module has a spec
 *
 * `lib/constants.tsx` carries JSX icons, which is why `checkout-readiness.ts`
 * owns the provider-id predicates rather than importing from here. But the
 * TITLES and CAPTIONS are plain strings, they are the only description the
 * customer gets of what pressing *Realizar pedido* will do, and until this file
 * existed nothing asserted anything about them at all.
 *
 * Scoped to the two providers `apps/backend/medusa-config.ts` actually
 * registers. The inherited starter entries (`pp_stripe_*`, `pp_paypal_paypal`,
 * `pp_system_default`) are deliberately NOT asserted over: per RC-4 they are
 * kept for `modules/order/components/payment-details`, they can never reach
 * this checkout because `listCartPaymentMethods` is backend-driven, and holding
 * dead entries to a customer-facing copy standard would be asserting over text
 * no customer can see.
 */
describe("paymentInfoMap — the offered providers", () => {
  const OPENPAY = "pp_openpay_openpay"
  const MERCADOPAGO = "pp_mercadopago_mercadopago"

  /**
   * The ids are the ones the predicates recognise. A row whose id the tail
   * resolver does not match reaches `resolvePaymentTail` as `"unsupported"`,
   * i.e. a selectable payment method that refuses on click.
   */
  it("keys the offered providers by ids the tail resolver recognises", () => {
    expect(isOpenpayProviderId(OPENPAY)).toBe(true)
    expect(isMercadopagoProviderId(MERCADOPAGO)).toBe(true)
    expect(isManualProviderId(MERCADOPAGO)).toBe(false)
  })

  /**
   * ## Mercado Pago takes the customer OFF-SITE, and nothing said so
   *
   * Its tail does not call `placeOrder` — it navigates the browser to
   * `init_point`, a hosted Checkout Pro page on `mercadopago.com.mx`. Openpay's
   * row carries `caption: "Procesado por Openpay · BBVA"` and its card fields
   * appear inline, so the customer can see what they are getting. Mercado
   * Pago's row had a title, a logo, and no caption at all — so a customer
   * pressing a button labelled *Realizar pedido* was silently sent to another
   * origin with no warning, which is the single most alarming thing a checkout
   * can do to someone who is about to pay.
   *
   * Asserted on CONTENT, not mere presence: `caption: ""` or a caption that
   * repeated the brand name would satisfy a truthiness check and warn nobody.
   */
  it("warns that Mercado Pago continues on another site", () => {
    const caption = paymentInfoMap[MERCADOPAGO]?.caption

    expect(caption).toBeTruthy()
    expect(caption).toMatch(/Mercado Pago/)
    expect(caption).toMatch(/sitio|página/i)
  })

  it("says who processes an Openpay card payment", () => {
    expect(paymentInfoMap[OPENPAY]?.caption).toBe(
      "Procesado por Openpay · BBVA"
    )
  })

  /**
   * The voseo guard, extended to reach here (judgment-day finding 8).
   *
   * `place-order.spec.ts` and `checkout-readiness.spec.ts` each hold one over
   * their own catalogue, and between them they cover every string the CTA can
   * produce. They could not see these: the payment rows are the copy the
   * customer reads while CHOOSING how to pay, and they live in a `.tsx` that
   * nothing imported.
   *
   * Same expression as the other two, deliberately duplicated rather than
   * shared — a guard that lives in one of the modules it guards is a guard that
   * can be edited into agreement with the string it was meant to catch.
   */
  const VOSEO_IMPERATIVES =
    /(Podés|Tenés|Querés|Hacé|Andá|Elegí|Completá|Volvé|Ingresá|Seleccioná|Revisá|Confirmá|Verificá|Probá|Intentá|Recargá|Continuá|Pagá)/i

  it("uses Mexican tú in the offered providers' copy, never voseo", () => {
    const copy = [OPENPAY, MERCADOPAGO].flatMap((id) => [
      paymentInfoMap[id]?.title,
      paymentInfoMap[id]?.caption,
    ])

    // Both titles and both captions — a guard over three strings would pass
    // while the fourth drifted.
    expect(copy.filter(Boolean)).toHaveLength(4)

    for (const text of copy) {
      expect(text ?? "").not.toMatch(VOSEO_IMPERATIVES)
    }
  })

  /** The guard has to be able to fail, or it is decoration. */
  it("has a voseo guard that recognises actual voseo", () => {
    expect("Continuá en el sitio de Mercado Pago").toMatch(VOSEO_IMPERATIVES)
    expect("Pagá con tarjeta").toMatch(VOSEO_IMPERATIVES)
    expect("Continúas en el sitio de Mercado Pago").not.toMatch(
      VOSEO_IMPERATIVES
    )
  })
})

import type { HttpTypes } from "@medusajs/types"
import { describe, expect, it } from "vitest"

import {
  buildOpenpaySessionData,
  hasTotalChanged,
  PLACE_ORDER_MESSAGES,
  resolvePaymentTail,
  selectMercadoPagoInitPoint,
  selectOpenpayRedirectUrl,
} from "./place-order"

/**
 * The rules the place-order flow is made of, extracted so they can be tested at
 * all.
 *
 * `checkout-context.tsx` is a `.tsx`; the runner is `environment: "node"` with
 * `include: src/**\/*.spec.ts`, no jsdom, no `@testing-library`, and Playwright
 * is an explicit non-goal. A rule that stays in that file is a rule nothing can
 * contradict — which is precisely how PR2a's two concurrent writers and PR2b's
 * `classifyQuoteResult` both got in, each of them a two-term boolean that
 * looked far too small to be worth extracting.
 *
 * Three of the rules below decide whether the browser NAVIGATES somewhere. Two
 * of the three are the ones the task list calls out by name as forbidden
 * failure modes: navigating to `undefined`, and initiating a charge with
 * `device_session_id: null`. Neither is a thing a component test would have
 * caught in this repo, because there are no component tests.
 */

const OPENPAY = "pp_openpay_openpay"
const MERCADOPAGO = "pp_mercadopago_mercadopago"
const MANUAL = "pp_system_default"

const cartWith = (overrides: Record<string, unknown>): HttpTypes.StoreCart =>
  ({ id: "cart_01", total: 1000, ...overrides } as unknown as HttpTypes.StoreCart)

describe("resolvePaymentTail", () => {
  it("routes each supported provider to its own tail", () => {
    expect(resolvePaymentTail(OPENPAY)).toBe("openpay")
    expect(resolvePaymentTail(MERCADOPAGO)).toBe("mercadopago")
    expect(resolvePaymentTail(MANUAL)).toBe("manual")
  })

  /**
   * The default branch has to be a REFUSAL, not a guess. Falling through to
   * `placeOrder()` for an unknown provider would complete a cart whose payment
   * session was never initiated for anything the backend recognises.
   */
  it("refuses an unknown provider rather than guessing a tail", () => {
    expect(resolvePaymentTail("pp_stripe_stripe")).toBe("unsupported")
    expect(resolvePaymentTail("pp_paypal_paypal")).toBe("unsupported")
    expect(resolvePaymentTail("")).toBe("unsupported")
  })

  it("refuses when no provider has been selected at all", () => {
    expect(resolvePaymentTail(null)).toBe("unsupported")
    expect(resolvePaymentTail(undefined)).toBe("unsupported")
  })
})

/**
 * S8 and the "do not navigate to undefined" rule live here.
 *
 * Today's `MercadoPagoPaymentButton` reads `paymentSession?.data?.init_point`
 * off `payment_sessions[0]` and casts it `as string | undefined`. Under R5 the
 * session is created by the CTA click itself, so the value has to be read out
 * of the response — and a cast is not a check.
 */
describe("selectMercadoPagoInitPoint", () => {
  const collectionWith = (data: unknown) => ({
    payment_sessions: [{ provider_id: MERCADOPAGO, data }],
  })

  it("reads init_point off the Mercado Pago session in the response", () => {
    const initPoint = selectMercadoPagoInitPoint(
      collectionWith({ init_point: "https://mp.example/checkout/abc" }),
      null
    )

    expect(initPoint).toBe("https://mp.example/checkout/abc")
  })

  /**
   * A cart can hold sessions for more than one provider across retries. Picking
   * `payment_sessions[0]` — which is what the component being replaced does —
   * would hand the customer whichever session happens to sort first, and send
   * them to a stale preference or to Openpay's own session data.
   */
  it("picks the Mercado Pago session, not merely the first one", () => {
    const initPoint = selectMercadoPagoInitPoint(
      {
        payment_sessions: [
          { provider_id: OPENPAY, data: { redirect_url: "https://3ds.bank" } },
          {
            provider_id: MERCADOPAGO,
            data: { init_point: "https://mp.example/checkout/right" },
          },
        ],
      },
      null
    )

    expect(initPoint).toBe("https://mp.example/checkout/right")
  })

  it("falls back to the cart when the collection did not carry the session", () => {
    const initPoint = selectMercadoPagoInitPoint(null, {
      payment_collection: collectionWith({
        init_point: "https://mp.example/checkout/from-cart",
      }),
    })

    expect(initPoint).toBe("https://mp.example/checkout/from-cart")
  })

  /**
   * EVERY shape that is not a usable URL must be `null`, because the caller's
   * only alternative is `window.location.href = <this>`. `String(undefined)` is
   * `"undefined"`, which is a valid relative URL — the browser would navigate
   * to `/undefined` and the customer would land on a 404 having been told
   * nothing, with their cart intact and no idea whether they had paid.
   */
  it.each([
    ["a missing data object", collectionWith(undefined)],
    ["a data object with no init_point", collectionWith({})],
    ["an explicitly null init_point", collectionWith({ init_point: null })],
    ["an empty-string init_point", collectionWith({ init_point: "" })],
    ["a whitespace-only init_point", collectionWith({ init_point: "   " })],
    ["a non-string init_point", collectionWith({ init_point: 42 })],
    ["a collection with no sessions", { payment_sessions: [] }],
    ["a collection with no session key", {}],
  ])("returns null for %s", (_label, collection) => {
    expect(selectMercadoPagoInitPoint(collection, null)).toBeNull()
  })

  it("returns null when neither source carries anything at all", () => {
    expect(selectMercadoPagoInitPoint(null, null)).toBeNull()
    expect(selectMercadoPagoInitPoint(undefined, undefined)).toBeNull()
  })
})

/**
 * The 3DS branch, moved off `payment-button` unchanged in intent.
 *
 * Its existing comment states the rule this preserves: NEVER key the decision
 * off the error message wording. A challenge is `status === "requires_more"`
 * with a `redirect_url`, and nothing else.
 */
describe("selectOpenpayRedirectUrl", () => {
  it("returns the redirect url when Openpay asks for a challenge", () => {
    const url = selectOpenpayRedirectUrl(
      cartWith({
        payment_collection: {
          payment_sessions: [
            {
              provider_id: OPENPAY,
              status: "requires_more",
              data: { redirect_url: "https://3ds.bank/challenge" },
            },
          ],
        },
      })
    )

    expect(url).toBe("https://3ds.bank/challenge")
  })

  /**
   * A declined card also leaves a session behind, sometimes carrying a stale
   * `redirect_url` from an earlier attempt. Following it would send the
   * customer to a challenge for a charge that no longer exists instead of
   * showing them the decline.
   */
  it("returns null when the session is not asking for a challenge", () => {
    const url = selectOpenpayRedirectUrl(
      cartWith({
        payment_collection: {
          payment_sessions: [
            {
              provider_id: OPENPAY,
              status: "error",
              data: { redirect_url: "https://3ds.bank/stale" },
            },
          ],
        },
      })
    )

    expect(url).toBeNull()
  })

  it("ignores a requires_more session belonging to another provider", () => {
    const url = selectOpenpayRedirectUrl(
      cartWith({
        payment_collection: {
          payment_sessions: [
            {
              provider_id: MERCADOPAGO,
              status: "requires_more",
              data: { redirect_url: "https://mp.example/not-3ds" },
            },
          ],
        },
      })
    )

    expect(url).toBeNull()
  })

  it.each([
    ["no redirect_url", { status: "requires_more", data: {} }],
    ["an empty redirect_url", { status: "requires_more", data: { redirect_url: "" } }],
    ["a non-string redirect_url", { status: "requires_more", data: { redirect_url: 7 } }],
  ])("returns null for a challenge with %s", (_label, session) => {
    const url = selectOpenpayRedirectUrl(
      cartWith({
        payment_collection: {
          payment_sessions: [{ provider_id: OPENPAY, ...session }],
        },
      })
    )

    expect(url).toBeNull()
  })

  it("tolerates a cart with no payment collection", () => {
    expect(selectOpenpayRedirectUrl(cartWith({}))).toBeNull()
    expect(selectOpenpayRedirectUrl(null)).toBeNull()
  })
})

/**
 * The total-change guard (task 2c.8).
 *
 * Step 2 runs `updateCartWorkflow`, which per finding F2 unconditionally
 * re-runs `refreshCartShippingMethodsWorkflow` and re-prices the surviving
 * shipping method against a live carrier quote. So the number can move between
 * the click and the response, and charging a total the customer never saw is
 * not acceptable.
 */
describe("hasTotalChanged", () => {
  it("fires when the write came back with a different total", () => {
    expect(hasTotalChanged(1000, cartWith({ total: 1250 }))).toBe(true)
  })

  it("does not fire when the total held", () => {
    expect(hasTotalChanged(1000, cartWith({ total: 1000 }))).toBe(false)
  })

  /**
   * A total that went DOWN is still a change the customer did not agree to,
   * and it still means Medusa re-priced the cart — which per `explore §2b`
   * destroys the payment session we are about to create. A one-sided `>`
   * comparison would produce a mystery failure instead of an explanation.
   */
  it("fires when the total went down, not only up", () => {
    expect(hasTotalChanged(1250, cartWith({ total: 1000 }))).toBe(true)
  })

  /**
   * Nothing was ever rendered, so there is no figure the customer agreed to and
   * nothing to contradict. Blocking here would strand a checkout on a state the
   * guard cannot reason about.
   */
  it("cannot fire when no total was rendered", () => {
    expect(hasTotalChanged(null, cartWith({ total: 1000 }))).toBe(false)
    expect(hasTotalChanged(undefined, cartWith({ total: 1000 }))).toBe(false)
  })

  /**
   * `0` is a real total — a fully gift-carded or fully discounted cart. Treating
   * it as "no total" would let a re-price away from zero through unannounced,
   * which is the one direction that actually costs the customer money.
   */
  it("treats a zero total as a real figure on both sides", () => {
    expect(hasTotalChanged(0, cartWith({ total: 0 }))).toBe(false)
    expect(hasTotalChanged(0, cartWith({ total: 500 }))).toBe(true)
    expect(hasTotalChanged(500, cartWith({ total: 0 }))).toBe(true)
  })

  it("cannot fire when the returned cart carries no total", () => {
    expect(hasTotalChanged(1000, cartWith({ total: undefined }))).toBe(false)
    expect(hasTotalChanged(1000, null)).toBe(false)
  })
})

/**
 * The Openpay session payload.
 *
 * Openpay rejects the charge with API error 1001 when the `customer` object is
 * absent, and `payment/index.tsx:128-136` sources it from the cart so it is
 * present for guest AND logged-in checkout. That cart must be the one step 2
 * returned — `design.md` D5 is explicit that step 2 before step 4 is mandatory
 * because this payload reads `cart.billing_address`.
 */
describe("buildOpenpaySessionData", () => {
  const cart = cartWith({
    email: "ana@example.com",
    billing_address: {
      first_name: "Ana",
      last_name: "Ruiz",
      phone: "5512345678",
    },
  })

  it("carries the token, the device session and the return url", () => {
    const data = buildOpenpaySessionData({
      tokenId: "tok_123",
      deviceSessionId: "dev_456",
      returnUrl: "https://shop.example/mx/payment/openpay/return",
      cart,
    })

    expect(data.token_id).toBe("tok_123")
    expect(data.device_session_id).toBe("dev_456")
    expect(data.return_url).toBe(
      "https://shop.example/mx/payment/openpay/return"
    )
  })

  it("builds the customer object from the BILLING address and the cart email", () => {
    const data = buildOpenpaySessionData({
      tokenId: "tok_123",
      deviceSessionId: "dev_456",
      returnUrl: "https://shop.example/return",
      cart,
    })

    expect(data.customer).toEqual({
      name: "Ana",
      last_name: "Ruiz",
      email: "ana@example.com",
      phone_number: "5512345678",
    })
  })

  /**
   * PCI boundary: card data is tokenised in the browser by openpay.js and the
   * raw PAN must never appear in anything this function returns. Asserting the
   * exact key set is the only way to notice a field being added later.
   */
  it("never carries card data", () => {
    const data = buildOpenpaySessionData({
      tokenId: "tok_123",
      deviceSessionId: "dev_456",
      returnUrl: "https://shop.example/return",
      cart,
    })

    expect(Object.keys(data).sort()).toEqual([
      "customer",
      "device_session_id",
      "return_url",
      "token_id",
    ])
  })

  it("degrades missing customer fields to undefined rather than null", () => {
    const data = buildOpenpaySessionData({
      tokenId: "tok_123",
      deviceSessionId: "dev_456",
      returnUrl: "https://shop.example/return",
      cart: cartWith({ email: null, billing_address: null }),
    })

    expect(data.customer).toEqual({
      name: undefined,
      last_name: undefined,
      email: undefined,
      phone_number: undefined,
    })
  })
})

/**
 * Copy register: Mexican `tú`, never voseo.
 *
 * `checkout-readiness.spec.ts` already guards its own catalogue this way after
 * `design.md` §2 and `proposal.md` R8 both shipped Rioplatense imperatives. The
 * same guard has to cover these strings, because they are on the same page, in
 * the same flow, read by the same customer.
 */
describe("place-order copy", () => {
  const VOSEO_IMPERATIVES =
    /(Elegí|Completá|Volvé|Ingresá|Seleccioná|Revisá|Confirmá|Verificá|Probá|Intentá|Recargá)/i

  it("uses the exact total-change wording the spec mandates", () => {
    expect(PLACE_ORDER_MESSAGES.totalChanged).toBe(
      "El costo de envío cambió. Revisa el total y confirma de nuevo."
    )
  })

  it("uses Mexican tú in every message, never voseo", () => {
    const messages = Object.values(PLACE_ORDER_MESSAGES)

    expect(messages.length).toBeGreaterThanOrEqual(5)

    for (const message of messages) {
      expect(message).not.toMatch(VOSEO_IMPERATIVES)
    }
  })

  it("has a voseo guard that recognises actual voseo", () => {
    expect("Revisá el total y confirmá de nuevo.").toMatch(VOSEO_IMPERATIVES)
    expect("Recargá la página").toMatch(VOSEO_IMPERATIVES)
    expect("Revisa el total y confirma de nuevo.").not.toMatch(
      VOSEO_IMPERATIVES
    )
  })

  /**
   * Every message is shown INSTEAD of an order being placed, so each one has to
   * tell the customer what to do next. A bare apology leaves them clicking the
   * same button.
   */
  it("ends every message as a complete sentence", () => {
    for (const message of Object.values(PLACE_ORDER_MESSAGES)) {
      expect(message.trim()).toBe(message)
      expect(message.endsWith(".")).toBe(true)
    }
  })
})

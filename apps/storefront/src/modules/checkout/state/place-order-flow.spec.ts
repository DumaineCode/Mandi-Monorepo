import type { HttpTypes } from "@medusajs/types"
import { describe, expect, it, vi } from "vitest"

import { PLACE_ORDER_MESSAGES } from "@lib/util/place-order"

import {
  checkoutReducer,
  initFromServer,
  type CheckoutAction,
  type CheckoutState,
} from "./checkout-reducer"
import { createPlaceOrderFlow, type PlaceOrderDeps } from "./place-order-flow"

/**
 * `placeOrderFlow` (tasks 2c.7–2c.11, `design.md` D5).
 *
 * ## Why this is a dependency-injected module and not a function in the context
 *
 * `design.md` D5 puts this flow "in `checkout-context.tsx`". Taken literally
 * that would put the single most consequential ordering rule in the change —
 * the one that decides whether a customer is charged, charged twice, or told
 * why they were not charged — into the one file this repo's runner
 * (`environment: "node"`, `include: src/**\/*.spec.ts`, no jsdom) cannot load.
 *
 * This change has already been bitten by that three times: PR2a's two
 * concurrent cart writers, PR2b's `classifyQuoteResult`, and PR1b's
 * fingerprinting gate. Each was a rule sitting in a `.tsx`, each was defended
 * by a confident docstring, and each turned out to be asserted nowhere. So the
 * flow follows `checkout-write-scheduler.ts`: the DECISIONS live here where a
 * spec can contradict them, and `checkout-context.tsx` supplies the effects.
 *
 * ## The claim this file exists to prove
 *
 * > "Step 1 before step 2 is deliberate: a card that fails tokenization must
 * > not have caused a single backend write."
 *
 * That is a statement about ORDERING, and ordering is exactly what a
 * hand-verified flow gets wrong six months later when someone moves the address
 * write above the tokenize call to "save a round trip". Every backend edge is
 * counted below, not merely mocked.
 */

const OPENPAY = "pp_openpay_openpay"
const MERCADOPAGO = "pp_mercadopago_mercadopago"
const MANUAL = "pp_system_default"

const CARD = {
  card_number: "4111111111111111",
  holder_name: "Ana Ruiz",
  expiration_year: "30",
  expiration_month: "12",
  cvv2: "123",
}

const ADDRESS = {
  first_name: "Ana",
  last_name: "Ruiz",
  company: "",
  address_1: "Av. Insurgentes Sur 1602",
  address_2: "Crédito Constructor",
  postal_code: "03940",
  city: "Ciudad de México",
  province: "CDMX",
  country_code: "mx",
  phone: "5512345678",
}

/**
 * A billing address that shares NOT ONE customer-visible field with
 * {@link ADDRESS}.
 *
 * ## Why the difference has to be in the CONTENT
 *
 * The test that used to cover the separate-billing branch asserted
 * `expect(input.billing).not.toBe(input.shipping)` — reference identity. The
 * flow spreads BOTH operands, so those are always distinct objects no matter
 * which draft was read, and `initFromServer` mirrors the shipping draft into
 * `billingDraft` (`checkout-reducer.ts:427-435`) so the CONTENTS matched too.
 *
 * A reviewer deleted the `sameAsBilling` branch outright — `const billingSource
 * = state.draft` — and the full suite stayed green. It was the only surviving
 * mutant of twelve. The test's own comment claimed it "asserts the flow READ the
 * billing draft"; it asserted that a spread had happened.
 *
 * The customer this costs is routine in Mexico: billing address drives the CFDI,
 * so unchecking "misma dirección de facturación" is normal. Their SHIPPING
 * address would be written to `cart.billing_address`, and
 * `buildOpenpaySessionData` sends that wrong name and phone to Openpay as the
 * cardholder `customer` object — which Openpay matches on for anti-fraud. Wrong
 * invoice, raised decline rate.
 */
/** What an untouched billing form holds the moment the box is unchecked. */
const EMPTY_DRAFT = {
  first_name: "",
  last_name: "",
  company: "",
  address_1: "",
  address_2: "",
  postal_code: "",
  city: "",
  province: "",
  country_code: "",
  phone: "",
}

const BILLING_ADDRESS = {
  first_name: "Beatriz",
  last_name: "Salazar",
  company: "Salazar Contadores SA de CV",
  address_1: "Río Lerma 232",
  address_2: "Cuauhtémoc",
  postal_code: "06500",
  city: "Miguel Hidalgo",
  province: "CDMX",
  country_code: "mx",
  phone: "5598765432",
}

/**
 * A cart that satisfies every `getMissingOrderRequirements` code, so step 0
 * passes and the tests below are about the flow rather than about readiness.
 */
const readyCart = (overrides: Record<string, unknown> = {}): HttpTypes.StoreCart =>
  ({
    id: "cart_01",
    email: "ana@example.com",
    items: [{ id: "li_01" }],
    // `shipping_option_id` is load-bearing, not decoration: `initFromServer`
    // derives `selectedShippingOptionId` from it, and without it the readiness
    // catalogue correctly reports `shipping_method_stale` — a method on the
    // cart that the client cannot attribute to any quote. Every test here would
    // then be asserting against step 0's refusal rather than against the flow.
    shipping_methods: [{ id: "sm_01", shipping_option_id: "so_std" }],
    shipping_address: { id: "caaddr_ship", ...ADDRESS },
    billing_address: { id: "caaddr_bill", ...ADDRESS },
    region: { id: "reg_01", countries: [{ iso_2: "mx" }] },
    total: 1000,
    ...overrides,
  } as unknown as HttpTypes.StoreCart)

const harness = (
  options: {
    cart?: HttpTypes.StoreCart
    providerId?: string | null
    deviceSessionId?: string | null
    cardData?: typeof CARD | null
    tokenize?: () => Promise<string>
    syncAddresses?: PlaceOrderDeps["syncAddresses"]
    initiatePaymentSession?: PlaceOrderDeps["initiatePaymentSession"]
    placeOrder?: PlaceOrderDeps["placeOrder"]
    retrieveCart?: PlaceOrderDeps["retrieveCart"]
    paymentDetailsComplete?: boolean
    sameAsBilling?: boolean
    /**
     * The separate billing form's contents. Overriding it is how a test states
     * that the two addresses genuinely DIFFER — `initFromServer` mirrors the
     * shipping draft here, so leaving it alone makes any assertion about
     * "the flow read the billing draft" vacuous. See {@link BILLING_ADDRESS}.
     */
    billingDraft?: Record<string, string>
  } = {}
) => {
  const cart = options.cart ?? readyCart()

  let state: CheckoutState = initFromServer({
    cart,
    customer: null,
    shippingOptions: [],
  })

  const sameAsBilling = options.sameAsBilling ?? true

  state = {
    ...state,
    selectedPaymentProviderId:
      options.providerId === undefined ? OPENPAY : options.providerId,
    paymentDetailsComplete: options.paymentDetailsComplete ?? true,
    sameAsBilling,
    /**
     * Mirrors the reducer's own W7 invariant: while the box is checked the
     * billing draft IS the shipping draft, and once it is unchecked the two are
     * independent. A test that unchecks the box without supplying different
     * contents is testing nothing, which is exactly how the surviving mutant
     * survived.
     */
    billingDraft: (options.billingDraft ??
      (sameAsBilling ? state.draft : BILLING_ADDRESS)) as typeof state.draft,
  }

  const actions: CheckoutAction[] = []

  /**
   * Every backend edge, recorded in the order it was reached. The ORDER is the
   * assertion in half these tests, so a bare call count would not do.
   */
  const calls: string[] = []

  /** The shared cart-write sequence the scheduler would allocate from. */
  let sequence = 0

  const dispatch = (action: CheckoutAction) => {
    actions.push(action)
    state = checkoutReducer(state, action)
  }

  /**
   * Models what the REAL wiring does, which matters for the total-change guard.
   *
   * `syncAddresses` is contractually routed through
   * `checkout-write-scheduler.runExclusive`, and that method dispatches
   * `CART_UPDATED` with whatever the write returned before the flow ever sees
   * it. So the new total is already in state by the time step 3 runs — which is
   * exactly why the flow does NOT dispatch `CART_UPDATED` itself, and why a
   * stub that skipped it would make the guard look broken when it is not.
   *
   * `design.md` D5 step 3 lists `dispatch(CART_UPDATED)` inline. That was
   * written before the write scheduler existed; the dispatch still happens, one
   * layer down, and duplicating it here would fire a second action carrying an
   * already-superseded sequence.
   */
  const dispatchUpdated = (updated: HttpTypes.StoreCart) => {
    sequence += 1
    dispatch({ type: "CART_UPDATED", cart: updated, sequence })
  }

  const rawSync: PlaceOrderDeps["syncAddresses"] =
    options.syncAddresses ?? (async () => ({ ok: true as const, cart }))

  /**
   * The wrapper IS the model of `runExclusive`, applied to every override so no
   * individual test can accidentally opt out of the dispatch and then assert
   * against a state ordering that never happens in production.
   */
  const syncAddresses: PlaceOrderDeps["syncAddresses"] = async (input) => {
    calls.push("syncAddresses")

    const result = await rawSync(input)

    if (result.ok) {
      dispatchUpdated(result.cart)
    }

    return result
  }

  const rawInitiate: PlaceOrderDeps["initiatePaymentSession"] =
    options.initiatePaymentSession ??
    (async () => ({ payment_collection: { payment_sessions: [] } }))

  const initiatePaymentSession: PlaceOrderDeps["initiatePaymentSession"] = (
    cartArg,
    session
  ) => {
    calls.push("initiatePaymentSession")
    return rawInitiate(cartArg, session)
  }

  const rawPlaceOrder: PlaceOrderDeps["placeOrder"] =
    options.placeOrder ?? (async () => undefined)

  const placeOrder: PlaceOrderDeps["placeOrder"] = () => {
    calls.push("placeOrder")
    return rawPlaceOrder()
  }

  const rawTokenize = options.tokenize ?? (async () => "tok_123")

  const tokenize = vi.fn(async () => {
    calls.push("tokenize")
    return rawTokenize()
  })

  const navigate = vi.fn((url: string) => {
    calls.push(`navigate:${url}`)
  })

  const cancelAutosave = vi.fn(() => {
    calls.push("cancelAutosave")
  })

  const syncSpy = vi.fn(syncAddresses)
  const initiateSpy = vi.fn(initiatePaymentSession)
  const placeOrderSpy = vi.fn(placeOrder)

  const flow = createPlaceOrderFlow({
    readState: () => state,
    dispatch,
    syncAddresses: syncSpy,
    initiatePaymentSession: initiateSpy,
    placeOrder: placeOrderSpy,
    retrieveCart: options.retrieveCart ?? (async () => null),
    cancelAutosave,
    navigate,
    countryCode: "mx",
    baseUrl: "https://shop.example",
  })

  /**
   * The gateway is a per-CALL input, because `CheckoutProvider` is mounted
   * outside `PaymentWrapper` and cannot read `OpenpayContext` at all. The CTA
   * supplies it, freshly, at click time.
   */
  const openpay = {
    deviceSessionId:
      options.deviceSessionId === undefined
        ? "dev_456"
        : options.deviceSessionId,
    cardData: options.cardData === undefined ? CARD : options.cardData,
    tokenize,
  }

  return {
    flow: { place: () => flow.place(openpay) },
    calls,
    actions,
    tokenize,
    cancelAutosave,
    navigate,
    sync: syncSpy,
    initiate: initiateSpy,
    placeOrder: placeOrderSpy,
    readState: () => state,
    /** Every call that reaches the backend, in order. */
    backendCalls: () =>
      calls.filter(
        (call) =>
          call !== "tokenize" &&
          call !== "cancelAutosave" &&
          !call.startsWith("navigate")
      ),
  }
}

/**
 * ---------------------------------------------------------------------------
 * Step 0 — the defensive readiness re-check
 * ---------------------------------------------------------------------------
 *
 * "A disabled button is an affordance, not a lock." The button can be enabled
 * by a stale render, by a devtools attribute edit, or by an Enter key arriving
 * between a cart mutation and the re-render that reflects it.
 */
describe("step 0 — canPlaceOrder re-check", () => {
  it("refuses an order the readiness predicate would block", async () => {
    const h = harness({ cart: readyCart({ items: [] }) })

    const outcome = await h.flow.place()

    expect(outcome.status).toBe("blocked")
    expect(h.backendCalls()).toEqual([])
  })

  it("reports the FIRST missing requirement, not a generic refusal", async () => {
    const h = harness({ cart: readyCart({ items: [] }) })

    const outcome = await h.flow.place()

    // The customer gets the same sentence the itemized list shows them, rather
    // than a second vocabulary for the same condition.
    expect(outcome.status === "blocked" && outcome.error).toBe(
      "Tu carrito está vacío."
    )
  })

  it("does not even tokenize when the order is not placeable", async () => {
    const h = harness({ cart: readyCart({ shipping_methods: [] }) })

    await h.flow.place()

    expect(h.tokenize).not.toHaveBeenCalled()
  })
})

/**
 * ---------------------------------------------------------------------------
 * Step 1 — provider pre-flight BEFORE any backend mutation
 * ---------------------------------------------------------------------------
 *
 * This is the ordering claim, and it is the reason this file exists.
 */
/**
 * ---------------------------------------------------------------------------
 * The armed autosave is disarmed FIRST, before anything else runs
 * ---------------------------------------------------------------------------
 *
 * `runExclusive` cancels the armed autosave — but it is not reached until step
 * 2, i.e. AFTER `await openpay.tokenize(...)`, which is a live network round
 * trip of one to three seconds.
 *
 * The scenario is ordinary, not an edge case. The customer tabs out of the last
 * address field (`FIELD_BLUR` arms the 400 ms autosave), clicks the CTA ~200 ms
 * later (total 1000 is snapshotted), tokenize runs 1.5 s, and at the 400 ms mark
 * the autosave fires. Per F2 `updateCartWorkflow` re-prices shipping through a
 * live Skydropx quote, so the total moves to 1250. Step 2 returns 1250 and the
 * guard aborts with *"El costo de envío cambió…"* — when nothing the customer
 * did changed the total. The flow's OWN autosave did, in the window the flow's
 * own cancel was supposed to close.
 *
 * The fix is to close the window, not to widen the guard: re-snapshotting the
 * total just before step 2 would ALSO stop the spurious abort, and would do it
 * by charging the customer a number that changed after they clicked. That is
 * the exact harm the guard exists to prevent. See the block below the tails.
 */
describe("the autosave window", () => {
  it("disarms the autosave before the provider pre-flight", async () => {
    const h = harness()

    await h.flow.place()

    // FIRST, not merely eventually. Anything between the click and this call is
    // a window in which the debounce can fire.
    expect(h.calls[0]).toBe("cancelAutosave")
    expect(h.calls.indexOf("cancelAutosave")).toBeLessThan(
      h.calls.indexOf("tokenize")
    )
  })

  /**
   * Tokenize is the long pole — one to three seconds against Openpay — so it is
   * specifically the call the cancel has to precede, not just the address
   * write that `runExclusive` already covers.
   */
  it("disarms it even for providers with no pre-flight at all", async () => {
    for (const providerId of [MERCADOPAGO, MANUAL]) {
      const h = harness({ providerId })

      await h.flow.place()

      expect(h.cancelAutosave).toHaveBeenCalledTimes(1)
      expect(h.calls[0]).toBe("cancelAutosave")
    }
  })

  /**
   * Step 0 refusing is not a reason to leave a write armed: the customer is
   * about to be told what to fix, and a debounce firing underneath that is the
   * same concurrent writer at a slightly different moment.
   */
  it("disarms it even when step 0 refuses the order", async () => {
    const h = harness({ cart: readyCart({ items: [] }) })

    const outcome = await h.flow.place()

    expect(outcome.status).toBe("blocked")
    expect(h.cancelAutosave).toHaveBeenCalledTimes(1)
    expect(h.backendCalls()).toEqual([])
  })

  /**
   * The guard is NOT relaxed to compensate. A total that genuinely moves
   * between the render and step 2 still aborts, because the alternative is
   * charging a figure the customer never agreed to — which is the whole reason
   * step 3 exists. Pinned here so a later "fix" for the spurious abort cannot
   * quietly take the other route.
   */
  it("still aborts on a total that moved for a reason other than the autosave", async () => {
    const h = harness({
      syncAddresses: async () => ({
        ok: true as const,
        cart: readyCart({ total: 1250 }),
      }),
    })

    const outcome = await h.flow.place()

    expect(outcome.status).toBe("aborted")
  })
})

describe("step 1 — provider pre-flight precedes every backend write", () => {
  it("tokenizes BEFORE the address write", async () => {
    const h = harness()

    await h.flow.place()

    // The first thing that leaves the browser. `cancelAutosave` runs ahead of
    // it but is purely local — it disarms a timer, it does not call anything.
    expect(h.calls.filter((call) => call !== "cancelAutosave")[0]).toBe(
      "tokenize"
    )
    expect(h.calls.indexOf("tokenize")).toBeLessThan(
      h.calls.indexOf("syncAddresses")
    )
  })

  it("writes NOTHING to the backend when tokenization fails", async () => {
    const h = harness({
      tokenize: async () => {
        throw new Error("Openpay rejected the card number")
      },
    })

    const outcome = await h.flow.place()

    // THE CLAIM. Not "the order was not placed" — not one backend call was made
    // at all, so the cart is exactly as the customer left it.
    expect(h.backendCalls()).toEqual([])
    expect(h.sync).not.toHaveBeenCalled()
    expect(h.initiate).not.toHaveBeenCalled()
    expect(h.placeOrder).not.toHaveBeenCalled()
    expect(outcome.status).toBe("failed")
  })

  /**
   * `deviceSessionId` is Openpay's anti-fraud signal, produced by
   * `openpay-data.v1.min.js` at script load. `strategy="lazyOnload"` defers
   * that past hydration, so on a cold load over a slow connection it can still
   * be null when the customer clicks.
   *
   * The task list forbids the alternative outright: initiating with
   * `device_session_id: null` takes the charge without the fraud signal.
   */
  it("refuses to initiate when the device session is not ready", async () => {
    const h = harness({ deviceSessionId: null })

    const outcome = await h.flow.place()

    expect(h.backendCalls()).toEqual([])
    expect(outcome.status === "failed" && outcome.error).toBe(
      PLACE_ORDER_MESSAGES.deviceSessionMissing
    )
  })

  it("refuses to tokenize when the card fields are empty", async () => {
    const h = harness({ cardData: null })

    const outcome = await h.flow.place()

    expect(h.tokenize).not.toHaveBeenCalled()
    expect(h.backendCalls()).toEqual([])
    expect(outcome.status === "failed" && outcome.error).toBe(
      PLACE_ORDER_MESSAGES.cardIncomplete
    )
  })

  /**
   * Mercado Pago and manual have no browser-side pre-flight, so the flow must
   * reach the address write for them. A guard that fired for every provider
   * would block the two that never had card fields to begin with.
   */
  it("has no pre-flight for Mercado Pago or manual", async () => {
    for (const providerId of [MERCADOPAGO, MANUAL]) {
      const h = harness({ providerId, deviceSessionId: null, cardData: null })

      await h.flow.place()

      expect(h.tokenize).not.toHaveBeenCalled()
      expect(h.sync).toHaveBeenCalledTimes(1)
    }
  })

  /**
   * "An Openpay token is single-use and reusing one from a failed attempt is
   * forbidden." The flow holds no token between attempts, so a retry has to
   * mint a new one.
   */
  it("re-tokenizes on every attempt", async () => {
    const h = harness()

    await h.flow.place()
    await h.flow.place()

    expect(h.tokenize).toHaveBeenCalledTimes(2)
  })
})

/**
 * ---------------------------------------------------------------------------
 * Step 2 — the address write
 * ---------------------------------------------------------------------------
 */
describe("step 2 — syncCheckoutAddresses", () => {
  it("sends the shipping draft as the billing address when they are the same", async () => {
    const h = harness({ sameAsBilling: true })

    await h.flow.place()

    const input = h.sync.mock.calls[0][0]
    expect(input.billing).toEqual(input.shipping)
    expect(input.shipping.postal_code).toBe("03940")
  })

  /**
   * ## The assertion is on VALUES, and it has to be
   *
   * This test used to read `expect(input.billing).not.toBe(input.shipping)` —
   * reference identity. The flow spreads both operands, so they are always
   * distinct objects regardless of which draft was read, and `initFromServer`
   * mirrors the shipping draft into `billingDraft` so the contents matched too.
   * Deleting the `sameAsBilling` branch entirely (`const billingSource =
   * state.draft`) left the whole suite green: the only mutant of twelve to
   * survive.
   *
   * A customer who unchecks *misma dirección de facturación* — routine in
   * Mexico, where the billing address drives the CFDI — would have had their
   * SHIPPING address written to `cart.billing_address`, and
   * `buildOpenpaySessionData` would have sent that wrong name and phone to
   * Openpay as the cardholder `customer` object, which Openpay matches on for
   * anti-fraud. Wrong invoice, raised decline rate.
   */
  it("sends the separate billing draft when the customer unchecked the box", async () => {
    const h = harness({ sameAsBilling: false })

    await h.flow.place()

    const input = h.sync.mock.calls[0][0]

    // Every customer-visible field, so no single-field mutation slips through.
    expect(input.billing).toEqual(BILLING_ADDRESS)
    expect(input.billing.postal_code).toBe("06500")
    expect(input.billing.first_name).toBe("Beatriz")
    expect(input.billing.phone).toBe("5598765432")

    // …and the shipping half is untouched by the same call.
    expect(input.shipping.postal_code).toBe("03940")
    expect(input.shipping.first_name).toBe("Ana")
  })

  /**
   * The other direction, stated separately. With the box CHECKED the billing
   * draft must be the shipping one — a mutant that always read
   * `state.billingDraft` would pass the test above and fail here.
   */
  it("ignores a stale billing draft while the box is checked", async () => {
    const h = harness({ sameAsBilling: true, billingDraft: BILLING_ADDRESS })

    await h.flow.place()

    const input = h.sync.mock.calls[0][0]
    expect(input.billing.postal_code).toBe("03940")
    expect(input.billing.first_name).toBe("Ana")
  })

  it("carries the email so a guest checkout persists it with the addresses", async () => {
    const h = harness()

    await h.flow.place()

    expect(h.sync.mock.calls[0][0].email).toBe("ana@example.com")
  })

  it("stops and reports when the address write aborts", async () => {
    const h = harness({
      syncAddresses: async () => ({
        ok: false as const,
        error: PLACE_ORDER_MESSAGES.addressSyncFailed,
      }),
    })

    const outcome = await h.flow.place()

    expect(outcome.status).toBe("failed")
    expect(h.initiate).not.toHaveBeenCalled()
    expect(h.placeOrder).not.toHaveBeenCalled()
  })
})

/**
 * ---------------------------------------------------------------------------
 * Step 3 — the total-change guard (task 2c.8)
 * ---------------------------------------------------------------------------
 */
describe("step 3 — total-change guard", () => {
  /**
   * The F2 case: the address write came back having re-priced shipping. The
   * harness dispatches `CART_UPDATED` for it exactly as `runExclusive` does, so
   * the guard is exercised against the state ordering it sees in production.
   */
  const repricedTo = (total: number) => ({
    syncAddresses: async () => ({
      ok: true as const,
      cart: readyCart({ total }),
    }),
  })

  it("aborts before creating a payment session when the total moved", async () => {
    const h = harness(repricedTo(1250))

    const outcome = await h.flow.place()

    expect(outcome.status).toBe("aborted")
    // The session is never created, so `explore §2b`'s "Medusa destroys the
    // session on a total change" cannot turn this into a mystery failure.
    expect(h.initiate).not.toHaveBeenCalled()
    expect(h.placeOrder).not.toHaveBeenCalled()
  })

  it("uses the mandated wording", async () => {
    const h = harness(repricedTo(1250))

    const outcome = await h.flow.place()

    expect(outcome.status === "aborted" && outcome.error).toBe(
      "El costo de envío cambió. Revisa el total y confirma de nuevo."
    )
  })

  /**
   * The summary has to show the NEW number before the customer is asked to
   * confirm again, or they are being told the total changed while looking at
   * the old one.
   */
  it("dispatches the new cart so the summary shows what changed", async () => {
    const h = harness(repricedTo(1250))

    await h.flow.place()

    expect(h.readState().cart?.total).toBe(1250)
    expect(h.readState().error).toBe(
      "El costo de envío cambió. Revisa el total y confirma de nuevo."
    )
  })

  /**
   * The second click must go through. The customer has now seen the new total,
   * so the guard compares against THAT and the order proceeds.
   */
  it("lets the confirmed retry through", async () => {
    const h = harness(repricedTo(1250))

    await h.flow.place()
    const second = await h.flow.place()

    expect(second.status).not.toBe("aborted")
    expect(h.initiate).toHaveBeenCalledTimes(1)
  })

  it("proceeds when the total held", async () => {
    const h = harness()

    await h.flow.place()

    expect(h.initiate).toHaveBeenCalledTimes(1)
  })
})

/**
 * ---------------------------------------------------------------------------
 * Step 5 — the provider tails (tasks 2c.9, 2c.10, 2c.11)
 * ---------------------------------------------------------------------------
 */
describe("the Openpay tail", () => {
  it("initiates with the token, the device session and the return url", async () => {
    const h = harness()

    await h.flow.place()

    const [, session] = h.initiate.mock.calls[0]
    expect(session.provider_id).toBe(OPENPAY)
    expect(session.data).toMatchObject({
      token_id: "tok_123",
      device_session_id: "dev_456",
      return_url: "https://shop.example/mx/payment/openpay/return",
    })
  })

  it("completes the order after the session exists", async () => {
    const h = harness()

    const outcome = await h.flow.place()

    expect(h.backendCalls()).toEqual([
      "syncAddresses",
      "initiatePaymentSession",
      "placeOrder",
    ])
    expect(outcome.status).toBe("placed")
  })

  /**
   * 3DS. `placeOrder` throws, and the decision is made by RE-READING the cart —
   * never by matching on the error text, which is the rule
   * `payment-button/index.tsx` carries in capitals today.
   */
  it("follows the 3DS redirect when Openpay asks for a challenge", async () => {
    const h = harness({
      placeOrder: async () => {
        throw new Error("payment requires more")
      },
      retrieveCart: async () =>
        readyCart({
          payment_collection: {
            payment_sessions: [
              {
                provider_id: OPENPAY,
                status: "requires_more",
                data: { redirect_url: "https://3ds.bank/challenge" },
              },
            ],
          },
        }),
    })

    const outcome = await h.flow.place()

    expect(h.navigate).toHaveBeenCalledWith("https://3ds.bank/challenge")
    expect(outcome.status).toBe("redirected")
  })

  it("surfaces a decline instead of navigating when there is no challenge", async () => {
    const h = harness({
      placeOrder: async () => {
        throw new Error("Tu tarjeta fue rechazada.")
      },
      retrieveCart: async () => readyCart({}),
    })

    const outcome = await h.flow.place()

    expect(h.navigate).not.toHaveBeenCalled()
    expect(outcome.status).toBe("failed")
    // The button has to come back, or a declined card ends the checkout.
    expect(h.readState().placingOrder).toBe(false)
  })

  it("still reports a decline when the cart re-read itself fails", async () => {
    const h = harness({
      placeOrder: async () => {
        throw new Error("Tu tarjeta fue rechazada.")
      },
      retrieveCart: async () => {
        throw new Error("ECONNREFUSED")
      },
    })

    const outcome = await h.flow.place()

    expect(outcome.status).toBe("failed")
    expect(h.readState().placingOrder).toBe(false)
  })
})

describe("the Mercado Pago tail", () => {
  const withInitPoint = (initPoint: unknown) => ({
    providerId: MERCADOPAGO,
    initiatePaymentSession: async () => ({
      payment_collection: {
        payment_sessions: [
          { provider_id: MERCADOPAGO, data: { init_point: initPoint } },
        ],
      },
    }),
  })

  it("initiates with back_urls_base and redirects to init_point", async () => {
    const h = harness(withInitPoint("https://mp.example/checkout/abc"))

    const outcome = await h.flow.place()

    const [, session] = h.initiate.mock.calls[0]
    expect(session.data).toEqual({
      back_urls_base: "https://shop.example/mx/payment/mercadopago",
    })
    expect(h.navigate).toHaveBeenCalledWith("https://mp.example/checkout/abc")
    expect(outcome.status).toBe("redirected")
  })

  /**
   * S8, and the reason `placeOrder` is absent from this tail: Checkout Pro is a
   * hosted redirect and the WEBHOOK is the source of truth. Completing the cart
   * here would confirm an order nobody has paid for.
   */
  it("NEVER calls placeOrder", async () => {
    const h = harness(withInitPoint("https://mp.example/checkout/abc"))

    await h.flow.place()

    expect(h.placeOrder).not.toHaveBeenCalled()
    expect(h.backendCalls()).toEqual(["syncAddresses", "initiatePaymentSession"])
  })

  /**
   * "Silently navigating to `undefined` is forbidden." `window.location.href =
   * undefined` coerces to the string `"undefined"` and the browser navigates to
   * `/undefined` — a 404, with the customer unable to tell whether they paid.
   */
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a non-string", 42],
  ])("shows an inline error and does NOT navigate for %s", async (_l, value) => {
    const h = harness(withInitPoint(value))

    const outcome = await h.flow.place()

    expect(h.navigate).not.toHaveBeenCalled()
    expect(outcome.status).toBe("failed")
    expect(outcome.status === "failed" && outcome.error).toBe(
      PLACE_ORDER_MESSAGES.mercadoPagoUnavailable
    )
    expect(h.readState().placingOrder).toBe(false)
  })
})

describe("the manual tail", () => {
  it("initiates then completes, with no provider data", async () => {
    const h = harness({ providerId: MANUAL })

    const outcome = await h.flow.place()

    const [, session] = h.initiate.mock.calls[0]
    expect(session.provider_id).toBe(MANUAL)
    expect(session.data).toBeUndefined()
    expect(h.backendCalls()).toEqual([
      "syncAddresses",
      "initiatePaymentSession",
      "placeOrder",
    ])
    expect(outcome.status).toBe("placed")
  })

  it("re-enables the button when completion fails", async () => {
    const h = harness({
      providerId: MANUAL,
      placeOrder: async () => {
        throw new Error("insufficient inventory")
      },
    })

    const outcome = await h.flow.place()

    expect(outcome.status).toBe("failed")
    expect(h.readState().placingOrder).toBe(false)
  })
})

describe("an unsupported provider", () => {
  /**
   * The default branch has to REFUSE. Falling through to `placeOrder()` would
   * complete a cart against a payment session the backend never authorised.
   */
  it("never reaches the backend", async () => {
    const h = harness({ providerId: "pp_paypal_paypal" })

    const outcome = await h.flow.place()

    expect(h.backendCalls()).toEqual([])
    // `blocked` rather than `failed`: nothing was attempted, which is the same
    // category as step 0 refusing an incomplete cart. The distinction matters
    // to a caller deciding whether the cart was touched.
    expect(outcome.status).toBe("blocked")
    expect("error" in outcome && outcome.error).toBe(
      PLACE_ORDER_MESSAGES.providerUnsupported
    )
  })

  it("never even marks the checkout busy", async () => {
    const h = harness({ providerId: "pp_paypal_paypal" })

    await h.flow.place()

    expect(h.readState().placingOrder).toBe(false)
  })
})

/**
 * ---------------------------------------------------------------------------
 * Re-entrancy — a double click must not place two orders
 * ---------------------------------------------------------------------------
 */
describe("re-entrancy", () => {
  it("refuses a second attempt while the first is still running", async () => {
    let release: (() => void) | undefined
    let announceReached: (() => void) | undefined

    // Deterministic rather than tick-counted: the second click is only made
    // once the first attempt is provably parked inside the address write.
    // Guessing at microtask depth here would make this test pass or fail on
    // how many awaits the pre-flight happens to contain.
    const reachedSync = new Promise<void>((resolve) => {
      announceReached = resolve
    })

    const h = harness({
      syncAddresses: () => {
        announceReached?.()
        return new Promise((resolve) => {
          release = () => resolve({ ok: true as const, cart: readyCart() })
        })
      },
    })

    const first = h.flow.place()
    await reachedSync

    const second = await h.flow.place()
    expect(second.status).toBe("busy")

    release?.()
    await first

    // Exactly one order, not two.
    expect(h.placeOrder).toHaveBeenCalledTimes(1)
  })

  /**
   * The guard is a SYNCHRONOUS closure flag, not `state.placingOrder`. The
   * provider reads state through a ref assigned in an effect, so it lags by a
   * commit — two clicks inside one commit would both observe `false` and both
   * charge the card.
   */
  it("guards synchronously, without waiting for a re-render", async () => {
    const h = harness()

    const outcomes = await Promise.all([h.flow.place(), h.flow.place()])

    expect(outcomes.filter((o) => o.status === "busy")).toHaveLength(1)
    expect(h.tokenize).toHaveBeenCalledTimes(1)
  })

  it("releases the guard so a failed attempt can be retried", async () => {
    const h = harness({
      tokenize: async () => {
        throw new Error("declined")
      },
    })

    await h.flow.place()
    const second = await h.flow.place()

    expect(second.status).not.toBe("busy")
    expect(h.tokenize).toHaveBeenCalledTimes(2)
  })
})

describe("the busy affordance", () => {
  it("marks the checkout busy while running and settles it at the end", async () => {
    const h = harness()

    await h.flow.place()

    const types = h.actions.map((action) => action.type)
    expect(types).toContain("PLACE_ORDER_STARTED")
    expect(types[types.length - 1]).toBe("PLACE_ORDER_SETTLED")
    expect(h.readState().placingOrder).toBe(false)
  })

  /**
   * A redirect leaves the browser on its way somewhere else. Dropping the busy
   * flag would flash an enabled button during the navigation, which reads as if
   * the click had not registered.
   */
  it("stays busy through a redirect", async () => {
    const h = harness({
      providerId: MERCADOPAGO,
      initiatePaymentSession: async () => ({
        payment_collection: {
          payment_sessions: [
            {
              provider_id: MERCADOPAGO,
              data: { init_point: "https://mp.example/go" },
            },
          ],
        },
      }),
    })

    await h.flow.place()

    expect(h.readState().placingOrder).toBe(true)
  })
})

/**
 * ---------------------------------------------------------------------------
 * Mutation follow-ups
 * ---------------------------------------------------------------------------
 */
describe("the payment session is built from the POST-write cart", () => {
  /**
   * Mutation M11 — building the session payload from `state.cart` instead of
   * from the cart step 2 returned — survived a green suite, because every cart
   * in this file already carried the billing address it was supposed to gain.
   *
   * `design.md` D5 is explicit that step 2 before step 4 is MANDATORY precisely
   * because "the Openpay session payload reads `cart.billing_address` for its
   * `customer` object". Billing is written for the first time by
   * `syncCheckoutAddresses`, so before step 2 the value is whatever the page
   * loaded with — and Openpay rejects a charge with API error 1001 when the
   * customer object is empty.
   */
  it("takes the Openpay customer from the cart the address write returned", async () => {
    const h = harness({
      cart: readyCart({
        billing_address: { id: "caaddr_bill", first_name: "Antigua" },
      }),
      syncAddresses: async () => ({
        ok: true as const,
        cart: readyCart({
          billing_address: {
            id: "caaddr_bill",
            first_name: "Ana",
            last_name: "Ruiz",
            phone: "5512345678",
          },
        }),
      }),
    })

    await h.flow.place()

    const [cartArg, session] = h.initiate.mock.calls[0]
    expect(cartArg.billing_address?.first_name).toBe("Ana")
    expect(
      (session.data as { customer: { name?: string } }).customer.name
    ).toBe("Ana")
  })
})

/**
 * ---------------------------------------------------------------------------
 * The billing-address deadlock — CLOSED (Amendment A5)
 * ---------------------------------------------------------------------------
 *
 * This block used to be a TRIPWIRE pinning a bug. `getMissingOrderRequirements`
 * emitted `billing_address` whenever `cart.billing_address` was falsy, and
 * after the single-page migration the ONLY production writer of that column
 * left in the storefront is `syncCheckoutAddresses` — which runs at D5 step 2,
 * i.e. BEHIND the very check that was blocking it. `persistCheckoutDraft` never
 * writes billing by design (D3), and `setAddresses`, the historical writer, was
 * deleted by this slice.
 *
 * A cart that had never had a billing address could therefore never place an
 * order: `Falta tu dirección de facturación.`, forever. Same shape as the
 * `?step=payment` deadlock PR2c exists to remove.
 *
 * The gate is now a CLIENT fact — `sameAsBilling || billingDraftIsComplete(...)`
 * — so the tests below assert the FIXED behaviour end to end, through the flow
 * the customer actually clicks. The unit-level argument lives in
 * `checkout-readiness.spec.ts`; this is the integration proof that the deadlock
 * is gone from the path that deadlocked.
 */
describe("the billing-address deadlock is closed (A5)", () => {
  it("places an order on a cart that has never had a billing address", async () => {
    const h = harness({
      cart: readyCart({ billing_address: null }),
      sameAsBilling: true,
    })

    const outcome = await h.flow.place()

    // THE REGRESSION. Before A5 this was `blocked` with "Falta tu dirección de
    // facturación." and NOTHING ran — including the one call that would have
    // written the billing address and unblocked the check.
    expect(outcome.status).toBe("placed")
    expect(h.backendCalls()).toEqual([
      "syncAddresses",
      "initiatePaymentSession",
      "placeOrder",
    ])
  })

  /**
   * The write is what closes the loop. The customer never had a billing row, so
   * the CTA's own address write is the thing that creates it — and it can only
   * do that if it is allowed to run.
   */
  it("writes the billing address the cart was missing", async () => {
    const h = harness({
      cart: readyCart({ billing_address: null }),
      sameAsBilling: true,
    })

    await h.flow.place()

    expect(h.sync.mock.calls[0][0].billing.postal_code).toBe("03940")
  })

  /**
   * The gate did not simply disappear. A customer who unchecked the box and
   * typed nothing is still blocked — but by a condition they can now satisfy
   * without a round trip, which is the entire difference.
   */
  it("still blocks when the customer unchecked the box and typed nothing", async () => {
    const h = harness({
      cart: readyCart({ billing_address: null }),
      sameAsBilling: false,
      billingDraft: EMPTY_DRAFT,
    })

    const outcome = await h.flow.place()

    expect(outcome.status).toBe("blocked")
    expect("error" in outcome && outcome.error).toBe(
      "Falta tu dirección de facturación."
    )
    expect(h.backendCalls()).toEqual([])
  })
})

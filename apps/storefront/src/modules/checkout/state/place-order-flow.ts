import type { FreshCartRead } from "@lib/util/cart-address-payload"
import { getMissingOrderRequirements } from "@lib/util/checkout-readiness"
import {
  buildOpenpaySessionData,
  hasTotalChanged,
  PLACE_ORDER_MESSAGES,
  resolvePaymentTail,
  selectMercadoPagoInitPoint,
  selectOpenpayRedirectUrl,
} from "@lib/util/place-order"
import type { OpenpayCardFields } from "@modules/checkout/components/payment-wrapper/openpay-wrapper"
import type { HttpTypes } from "@medusajs/types"

import {
  selectReadinessInput,
  type AddressDraft,
  type CheckoutAction,
  type CheckoutState,
} from "./checkout-reducer"

/**
 * The place-order flow (tasks 2c.7–2c.11, `design.md` D5).
 *
 * ## Why this is not in `checkout-context.tsx`, which is where D5 puts it
 *
 * D5 says "one entry point, `placeOrderFlow()` in `checkout-context.tsx`".
 * Taken literally that puts the most consequential ordering rule in the change
 * — the one deciding whether a customer is charged, charged twice, or told why
 * they were not charged — inside the one file this repo's runner cannot load
 * (`environment: "node"`, `include: src/**\/*.spec.ts`, no jsdom, no
 * `@testing-library`, Playwright an explicit non-goal).
 *
 * That is not a hypothetical objection. This change has been bitten by it three
 * times: PR2a's two concurrent cart writers, PR2b's `classifyQuoteResult`, and
 * PR1b's fingerprinting gate. Each was a rule living in a `.tsx`, each was
 * defended by a confident docstring, and each turned out to be asserted
 * nowhere. `checkout-write-scheduler.ts` set the precedent for the fix, and
 * this module follows it: the DECISIONS live here where a spec can contradict
 * them, and the provider supplies the effects.
 *
 * The deviation is one of file placement, not of behaviour. Every step, and
 * their order, is D5's.
 *
 * ## The order, and why step 1 comes before step 2
 *
 * ```
 * -  cancelAutosave             — close the window before the total is snapshotted
 * 0  canPlaceOrder re-check     — a disabled button is an affordance, not a lock
 * 1  provider pre-flight        — tokenize in the browser; assert deviceSessionId
 * 2  syncCheckoutAddresses      — both addresses, both row ids, via the scheduler
 * 3  total-change guard         — F2 re-prices shipping on any cart write
 * 4  initiatePaymentSession     — the FIRST session this checkout has created
 * 5  provider tail              — complete, or redirect, per provider
 * ```
 *
 * Step 1 before step 2 is deliberate: a card that fails tokenisation must not
 * have caused a single backend write. Step 2 before step 4 is mandatory: the
 * Openpay session payload reads `cart.billing_address` for its `customer`
 * object, and the session snapshots the cart total at creation.
 */

/**
 * The Openpay browser gateway, narrowed to the three things this flow reads.
 *
 * Structural rather than the context's own type so the flow depends only on
 * what it uses.
 *
 * ## Why it is a per-CALL input and not a construction dependency
 *
 * `CheckoutProvider` is mounted OUTSIDE `PaymentWrapper`
 * (`checkout/page.tsx`), which is what supplies `OpenpayContext`. A provider
 * that tried to read the context to build this flow would get the DEFAULT
 * context value — `deviceSessionId: null` and a `tokenize` that rejects — and
 * Openpay would fail on every attempt, in a way no unit test would notice
 * because the wiring is the part that is untestable here.
 *
 * Passing the gateway at click time removes the question: the CTA lives inside
 * `PaymentWrapper`, so it holds the real value, and it necessarily reads it
 * fresh — which matters because `deviceSessionId` is populated asynchronously
 * as `openpay-data.v1.min.js` loads. A value captured at construction time
 * would be pinned to `null` forever, i.e. exactly the failure the pre-flight
 * exists to catch, made permanent.
 */
export type OpenpayGateway = {
  deviceSessionId: string | null
  cardData: OpenpayCardFields | null
  tokenize: (card: OpenpayCardFields) => Promise<string>
}

export type SyncAddressesResult =
  | { ok: true; cart: HttpTypes.StoreCart }
  | { ok: false; error: string }

export type PlaceOrderDeps = {
  readState: () => CheckoutState
  dispatch: (action: CheckoutAction) => void
  /**
   * MUST be routed through `checkout-write-scheduler.runExclusive` by the
   * caller. This function writes `shipping_address`, and an autosave debounce
   * armed by the customer's last blur is very likely still pending when the CTA
   * is clicked — 400 ms is about the gap between tabbing out of the final field
   * and pressing the button. Two concurrent partial writers against one nested
   * entity is finding B1, at the one moment the customer cannot casually retry.
   */
  syncAddresses: (input: {
    shipping: AddressDraft
    billing: AddressDraft
    email: string | null
  }) => Promise<SyncAddressesResult>
  initiatePaymentSession: (
    cart: HttpTypes.StoreCart,
    session: { provider_id: string; data?: Record<string, unknown> }
  ) => Promise<unknown>
  placeOrder: () => Promise<unknown>
  /**
   * `retrieveCartFresh` — `cache: "no-store"`, 5 s bound — and NOT
   * `retrieveCart`.
   *
   * The 3DS decision below is made by re-reading the cart, which is only worth
   * anything if the read observes the write that just happened. `retrieveCart`
   * is `cache: "force-cache"` with a `carts` tag, and
   * `initiatePaymentSession` calls `revalidateTag("carts")` — which in App
   * Router also refreshes the current route, re-running `checkout/page.tsx`'s
   * own `retrieveCart()` and REPOPULATING the entry with a pre-authorization
   * cart. `placeOrder` then fails with `requires_more` and this read could hit
   * exactly that entry: the flow shows a decline for a charge sitting live at
   * the customer's bank, and their retry takes a SECOND authorization hold.
   *
   * The DISCRIMINATED result is taken directly rather than flattened to
   * cart-or-null by the caller, because `null` would mean two opposite things —
   * "no challenge" and "we could not find out" — and the `.tsx` that would do
   * the flattening is the one file no spec can load.
   */
  retrieveCartFresh: () => Promise<FreshCartRead>
  /**
   * `checkout-write-scheduler.cancelAutosave`, called FIRST — before the
   * readiness re-check, before the pre-flight, before anything.
   *
   * `runExclusive` cancels the armed autosave too, but it is not reached until
   * step 2, i.e. after `openpay.tokenize(...)` — a live network round trip of
   * one to three seconds. That gap is longer than the 400 ms debounce, so the
   * ordinary sequence "tab out of the last field, click the button" lets the
   * autosave fire in the middle of tokenization. Per F2 that write re-prices
   * shipping through a live carrier quote, so the total moves, and step 3 then
   * aborts the order with "El costo de envío cambió" over a change the flow
   * itself caused.
   *
   * Closing the window is the fix. Re-snapshotting the total just before step 2
   * would also stop the spurious abort — by charging the customer a figure that
   * moved after they clicked, which is precisely what step 3 exists to prevent.
   */
  cancelAutosave: () => void
  /** `window.location.href = url`, injected so the redirect is assertable. */
  navigate: (url: string) => void
  countryCode: string
  baseUrl: string
}

export type PlaceOrderOutcome =
  /** The order was completed. `placeOrder` owns the confirmation redirect. */
  | { status: "placed" }
  /** The browser is on its way to Mercado Pago or a 3DS challenge. */
  | { status: "redirected"; url: string }
  /** Step 0 said no. Nothing was attempted. */
  | { status: "blocked"; error: string }
  /** The total moved under the customer. One more confirmation is needed. */
  | { status: "aborted"; error: string }
  | { status: "failed"; error: string }
  /** A second click arrived while the first attempt was still running. */
  | { status: "busy" }

export type PlaceOrderFlow = {
  /**
   * @param openpay the LIVE gateway, read from `OpenpayContext` by the CTA at
   * click time. Always available — the context has a default value whose
   * `deviceSessionId` is `null`, so a CTA rendered outside `PaymentWrapper`
   * fails closed with a clear message instead of charging without a fraud
   * signal.
   */
  place: (openpay: OpenpayGateway) => Promise<PlaceOrderOutcome>
}

export function createPlaceOrderFlow(deps: PlaceOrderDeps): PlaceOrderFlow {
  /**
   * The re-entrancy guard, and it is deliberately NOT `state.placingOrder`.
   *
   * The provider exposes state through a ref that is assigned in an effect, so
   * it lags by one commit. Two clicks landing inside the same commit would both
   * read `placingOrder: false`, both tokenise, and both charge the card. A
   * closure flag is synchronous by construction, which is the only property
   * that actually matters here.
   *
   * `state.placingOrder` still exists, because the BUTTON needs something to
   * render. It is the affordance; this is the lock.
   */
  let running = false

  const place = async (
    openpay: OpenpayGateway
  ): Promise<PlaceOrderOutcome> => {
    if (running) {
      return { status: "busy" }
    }

    running = true

    try {
      return await run(openpay)
    } finally {
      running = false
    }
  }

  const run = async (openpay: OpenpayGateway): Promise<PlaceOrderOutcome> => {
    /**
     * Before the snapshot, and before anything else.
     *
     * The snapshot below is what step 3 compares against, and it is only
     * trustworthy while nothing else can move the cart underneath it. The one
     * writer that can is the flow's own armed autosave — 400 ms out, against a
     * tokenize call that takes one to three seconds. `runExclusive` disarms it
     * too, but not until step 2, which is on the far side of that window.
     */
    deps.cancelAutosave()

    const state = deps.readState()

    // ---------------------------------------------------------------------
    // Step 0 — the defensive readiness re-check.
    // ---------------------------------------------------------------------
    //
    // The button is already disabled when this would fail. It is re-checked
    // anyway because a disabled button is a UI affordance, not a lock: a stale
    // render, an Enter key arriving between a cart mutation and the re-render
    // that reflects it, or a devtools attribute edit all reach this function.
    //
    // The message is the FIRST entry from the same catalogue the itemized list
    // renders, so the customer is not given a second vocabulary for a condition
    // they can already read on the page.
    const missing = getMissingOrderRequirements(selectReadinessInput(state))

    if (missing.length > 0) {
      const error = missing[0].message
      deps.dispatch({ type: "SET_ERROR", error })
      return { status: "blocked", error }
    }

    const providerId = state.selectedPaymentProviderId
    const tail = resolvePaymentTail(providerId)

    if (tail === "unsupported" || !providerId) {
      const error = PLACE_ORDER_MESSAGES.providerUnsupported
      deps.dispatch({ type: "SET_ERROR", error })
      return { status: "blocked", error }
    }

    deps.dispatch({ type: "PLACE_ORDER_STARTED" })

    // ---------------------------------------------------------------------
    // Step 1 — provider pre-flight, BEFORE any backend mutation.
    // ---------------------------------------------------------------------
    //
    // Openpay tokenises in the browser, so a bad card fails here with nothing
    // written. Moving this below step 2 to "save a round trip" would mean every
    // mistyped card number costs a cart write and, per F2, a live carrier
    // quote — and would leave the customer's cart mutated by an attempt that
    // never had a chance of succeeding.
    let tokenId: string | null = null
    let deviceSessionId: string | null = null

    if (tail === "openpay") {
      if (!openpay.cardData) {
        return settleFailed(PLACE_ORDER_MESSAGES.cardIncomplete)
      }

      // Asserted BEFORE tokenising, not after: there is no point spending a
      // single-use token on an attempt that cannot legally be initiated.
      if (!openpay.deviceSessionId) {
        return settleFailed(PLACE_ORDER_MESSAGES.deviceSessionMissing)
      }

      deviceSessionId = openpay.deviceSessionId

      try {
        // A NEW token on every attempt. Openpay tokens are single-use, and
        // reusing one left over from a declined attempt is forbidden — the flow
        // holds no token between calls precisely so that cannot happen by
        // accident.
        tokenId = await openpay.tokenize(openpay.cardData)
      } catch (error) {
        return settleFailed(messageFrom(error))
      }
    }

    // ---------------------------------------------------------------------
    // Step 2 — write both addresses, each carrying its own row id.
    // ---------------------------------------------------------------------
    const billingSource = state.sameAsBilling ? state.draft : state.billingDraft

    const synced = await deps.syncAddresses({
      shipping: { ...state.draft },
      billing: { ...billingSource },
      email: state.email || null,
    })

    if (!synced.ok) {
      return settleFailed(synced.error || PLACE_ORDER_MESSAGES.addressSyncFailed)
    }

    // ---------------------------------------------------------------------
    // Step 3 — the total-change guard.
    // ---------------------------------------------------------------------
    //
    // Step 2 runs `updateCartWorkflow`, which per F2 re-runs
    // `refreshCartShippingMethodsWorkflow` and re-prices the surviving shipping
    // method through a live carrier quote. Charging a total the customer never
    // saw is not acceptable — and Medusa would destroy the session step 4 is
    // about to create anyway (`explore §2b`), turning this into a mystery
    // failure instead of an explanation. One honest extra click.
    //
    // `CART_UPDATED` has already been dispatched by the scheduler, so the
    // summary is showing the new figure by the time the customer reads this.
    if (hasTotalChanged(state.cart?.total, synced.cart)) {
      const error = PLACE_ORDER_MESSAGES.totalChanged
      deps.dispatch({ type: "PLACE_ORDER_SETTLED", error })
      return { status: "aborted", error }
    }

    // ---------------------------------------------------------------------
    // Step 4 — the first payment session this checkout has created (R5).
    // ---------------------------------------------------------------------
    //
    // `synced.cart` and not `state.cart`: the Openpay payload reads
    // `billing_address` off it, and billing only lands in step 2.
    let initiated: unknown

    try {
      initiated = await deps.initiatePaymentSession(synced.cart, {
        provider_id: providerId,
        data: buildSessionData(tail, {
          tokenId,
          deviceSessionId,
          cart: synced.cart,
        }),
      })
    } catch (error) {
      return settleFailed(messageFrom(error))
    }

    // ---------------------------------------------------------------------
    // Step 5 — the provider tail.
    // ---------------------------------------------------------------------
    if (tail === "mercadopago") {
      /**
       * From THIS attempt's response only. `synced.cart` used to be passed as a
       * fallback, and on a retry it carries the previous attempt's session and
       * its `init_point` — minted for the previous total, on a provider where
       * the webhook is the source of truth. See `selectMercadoPagoInitPoint`.
       */
      const initPoint = selectMercadoPagoInitPoint(
        (initiated as { payment_collection?: unknown } | null)
          ?.payment_collection
      )

      // Navigating to `undefined` is forbidden: it coerces to the string
      // "undefined", which is a valid relative URL, so the browser would go to
      // /undefined and the customer would land on a 404 unable to tell whether
      // they had paid.
      if (!initPoint) {
        return settleFailed(PLACE_ORDER_MESSAGES.mercadoPagoUnavailable)
      }

      // `placeOrder` is NOT called. Checkout Pro is a hosted redirect and the
      // WEBHOOK is the source of truth (`explore §6`); completing the cart here
      // would confirm an order nobody has paid for.
      //
      // The busy flag deliberately survives: the browser is navigating away,
      // and re-enabling the button mid-navigation reads as if the click never
      // registered.
      deps.navigate(initPoint)
      return { status: "redirected", url: initPoint }
    }

    try {
      // Openpay and manual both complete here. On success `placeOrder` performs
      // its own `redirect()` to /{cc}/order/{id}/confirmed from the server
      // action — the flow does not navigate, and must not, or the two would
      // race.
      await deps.placeOrder()
    } catch (error) {
      if (tail === "openpay") {
        const redirectUrl = await readOpenpayChallenge()

        if (redirectUrl) {
          deps.navigate(redirectUrl)
          return { status: "redirected", url: redirectUrl }
        }
      }

      return settleFailed(messageFrom(error))
    }

    deps.dispatch({ type: "PLACE_ORDER_SETTLED", error: null })
    return { status: "placed" }
  }

  /**
   * Whether Openpay is asking for a 3DS challenge.
   *
   * Decided by RE-READING the cart, never by matching on the error message
   * wording — the rule `payment-button/index.tsx` states in capitals today. A
   * message-matching version breaks the first time the backend rephrases a
   * decline, and it breaks silently, in the direction of sending the customer
   * to a challenge for a charge that does not exist.
   *
   * The read is UNCACHED. See `PlaceOrderDeps.retrieveCartFresh` for why a
   * `force-cache` read here can hand back a pre-authorization cart and turn a
   * live 3DS challenge into a decline the customer answers with a retry.
   *
   * A read that failed — returned `{ ok: false }` or threw — yields `null`,
   * which surfaces the decline. That is the right default and it is a DIFFERENT
   * branch from "the cart says there is no challenge": not knowing whether a
   * challenge is pending is not a reason to navigate away from the checkout.
   */
  const readOpenpayChallenge = async (): Promise<string | null> => {
    try {
      const read = await deps.retrieveCartFresh()

      return read.ok ? selectOpenpayRedirectUrl(read.cart) : null
    } catch {
      return null
    }
  }

  const settleFailed = (error: string): PlaceOrderOutcome => {
    // One action for both halves of "show the reason and give the button back"
    // (task 2c.11), rather than a flag each of the three tails has to remember
    // to reset. A tail that forgets is a button that spins forever.
    deps.dispatch({ type: "PLACE_ORDER_SETTLED", error })
    return { status: "failed", error }
  }

  const buildSessionData = (
    tail: ReturnType<typeof resolvePaymentTail>,
    context: {
      tokenId: string | null
      deviceSessionId: string | null
      cart: HttpTypes.StoreCart
    }
  ): Record<string, unknown> | undefined => {
    if (tail === "openpay" && context.tokenId && context.deviceSessionId) {
      return buildOpenpaySessionData({
        tokenId: context.tokenId,
        deviceSessionId: context.deviceSessionId,
        returnUrl: `${deps.baseUrl}/${deps.countryCode}/payment/openpay/return`,
        cart: context.cart,
      }) as unknown as Record<string, unknown>
    }

    if (tail === "mercadopago") {
      return {
        back_urls_base: `${deps.baseUrl}/${deps.countryCode}/payment/mercadopago`,
      }
    }

    // Manual carries no provider data. `undefined` rather than `{}` so the
    // request body matches what the four-step checkout sent.
    return undefined
  }

  return { place }
}

/**
 * The customer-facing text for a thrown error.
 *
 * Backend messages reach here already curated — `placeOrder` throws
 * `cartRes.error.message` or its own Spanish decline copy — so passing them
 * through is deliberate: "tu tarjeta fue rechazada" is more useful than a
 * generic apology. Anything that is not an `Error` falls back to the generic
 * string rather than stringifying an object at the customer.
 */
const messageFrom = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : PLACE_ORDER_MESSAGES.generic

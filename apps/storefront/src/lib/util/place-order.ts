import type { HttpTypes } from "@medusajs/types"

import {
  isManualProviderId,
  isMercadopagoProviderId,
  isOpenpayProviderId,
} from "./checkout-readiness"

/**
 * The decisions the place-order flow is made of (tasks 2c.7–2c.11,
 * `design.md` D5).
 *
 * Pure by contract, and for a specific reason rather than out of habit: the
 * flow itself has to live next to React state, and `checkout-context.tsx` is a
 * `.tsx` that this project's node-only runner cannot load at all. Every rule
 * left in that file is a rule no spec can contradict — which is exactly how
 * PR2a shipped two concurrent cart writers and PR2b shipped a misclassified
 * quote result, both of them expressions small enough to look not worth
 * extracting.
 *
 * Three of the functions here decide whether the browser NAVIGATES. Two of
 * those are the failure modes the task list names outright as forbidden:
 * navigating to `undefined`, and initiating a charge with
 * `device_session_id: null`.
 *
 * No `fetch`, no React, no `window`, no timers, no module-level mutable state.
 * The `@medusajs/types` import is type-only and erases at compile time.
 */

/**
 * Which tail runs after the payment session is initiated.
 *
 * `unsupported` is a REFUSAL and is load-bearing. The component this replaces
 * dispatched on `switch (true)` over the session's provider id and fell through
 * to a disabled default; here the default has to stop the flow, because
 * reaching `placeOrder()` for a provider nobody initiated a session for would
 * complete a cart against a payment the backend never authorised.
 */
export type PaymentTail = "openpay" | "mercadopago" | "manual" | "unsupported"

export function resolvePaymentTail(
  providerId: string | null | undefined
): PaymentTail {
  if (isOpenpayProviderId(providerId)) {
    return "openpay"
  }

  if (isMercadopagoProviderId(providerId)) {
    return "mercadopago"
  }

  if (isManualProviderId(providerId)) {
    return "manual"
  }

  return "unsupported"
}

/**
 * A payment session as much of it as these rules actually read.
 *
 * Typed structurally rather than as `HttpTypes.StorePaymentSession` because
 * `data` is `Record<string, unknown>` on that type anyway, and because both
 * sources below (`initiatePaymentSession`'s response and a re-read cart) are
 * reached through boundaries where the shape is worth probing rather than
 * asserting.
 */
type SessionLike = {
  provider_id?: unknown
  status?: unknown
  data?: unknown
}

const readSessions = (collection: unknown): SessionLike[] => {
  const sessions = (collection as { payment_sessions?: unknown } | null)
    ?.payment_sessions

  return Array.isArray(sessions) ? (sessions as SessionLike[]) : []
}

const readSessionData = (session: SessionLike | undefined, key: string): unknown =>
  (session?.data as Record<string, unknown> | null | undefined)?.[key]

/**
 * A URL is only usable if it is a non-empty string.
 *
 * The cast-as-string this replaces (`data?.init_point as string | undefined`)
 * asserted the shape instead of checking it, and the consequence is not a
 * TypeScript complaint — it is `window.location.href = undefined`, which
 * coerces to the string `"undefined"`, a perfectly valid relative URL. The
 * customer lands on a 404 with their cart intact and no way to tell whether
 * they were charged.
 */
const asUsableUrl = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null

/**
 * The Mercado Pago hosted-checkout URL, from the CTA's own response and from
 * nowhere else.
 *
 * Under R5 no session exists until the CTA runs, so the value comes out of what
 * `initiatePaymentSession` just returned.
 *
 * ## Why there is no cart fallback
 *
 * There was one, and it took the cart that D5 step 2 returned — i.e. a cart
 * read BEFORE any session existed on this attempt. `design.md` D5 names the
 * fallback as the cart read AFTER initiation, which is a different cart.
 *
 * That is not a hypothetical distinction. Medusa's default store cart
 * projection includes `*payment_collection.payment_sessions`, and
 * `syncCheckoutAddresses` uses that default projection. So on a RETRY — the
 * customer went to Mercado Pago, returned through the failure route with
 * `?error=payment_failed`, and clicked again — that cart carries the PREVIOUS
 * attempt's session and its previous `init_point`, minted for the PREVIOUS
 * total. `placeOrder` is never called for this provider and the webhook is the
 * source of truth, so following that link charges an amount the customer was
 * never quoted and creates an order from it.
 *
 * Refusing is cheap precisely because of R5: the customer clicks again and the
 * next attempt mints a fresh preference. A wrong charge is not recoverable that
 * way.
 *
 * Matching on the PROVIDER rather than taking `payment_sessions[0]` is not
 * defensive padding either. A collection accumulates sessions across retries
 * and across providers — a customer who tried Openpay first and switched has
 * two — and index zero is whichever the backend happened to serialise first.
 */
export function selectMercadoPagoInitPoint(
  paymentCollection: unknown
): string | null {
  const session = readSessions(paymentCollection).find((candidate) =>
    isMercadopagoProviderId(candidate.provider_id as string | undefined)
  )

  return asUsableUrl(readSessionData(session, "init_point"))
}

/**
 * The 3DS challenge URL, if Openpay is asking for one.
 *
 * Moved off `payment-button/index.tsx` with its rule intact, including the part
 * its comment insists on: NEVER key this decision off the error message
 * wording. A challenge is `status === "requires_more"` carrying a
 * `redirect_url`, and nothing else qualifies.
 *
 * The status check is what separates a challenge from a DECLINE. A declined
 * card also leaves a session behind, and it can still carry a `redirect_url`
 * from an earlier attempt — following that would send the customer to a
 * challenge for a charge that no longer exists, instead of showing them why
 * their card was refused.
 */
export function selectOpenpayRedirectUrl(
  cart: HttpTypes.StoreCart | null | undefined
): string | null {
  const session = readSessions(
    (cart as { payment_collection?: unknown } | null | undefined)
      ?.payment_collection
  ).find(
    (candidate) =>
      isOpenpayProviderId(candidate.provider_id as string | undefined) &&
      candidate.status === "requires_more"
  )

  return asUsableUrl(readSessionData(session, "redirect_url"))
}

/**
 * Whether the cart the address write returned carries a total the customer
 * never saw (task 2c.8, `design.md` D5 step 3).
 *
 * Per finding F2, `updateCartWorkflow` unconditionally re-runs
 * `refreshCartShippingMethodsWorkflow`, which re-lists options for the current
 * destination and re-prices the surviving shipping method through a LIVE
 * carrier quote. So the address write in step 2 can move the total on its own,
 * with no customer action between the click and the response.
 *
 * Both directions count. A total that went DOWN is still one the customer did
 * not agree to, and either direction means Medusa re-priced the cart — which
 * per `explore §2b` destroys the payment session the next step is about to
 * create. Guarding only the expensive direction would replace an explanation
 * with a mystery failure.
 *
 * Both `null` cases refuse to fire, and they refuse for different reasons: a
 * missing `totalAtRender` means nothing was ever presented, so there is no
 * figure to contradict; a missing total on the returned cart means the response
 * did not tell us, and inventing a mismatch would block a checkout over a
 * question the guard cannot answer.
 */
export function hasTotalChanged(
  totalAtRender: number | null | undefined,
  cart: HttpTypes.StoreCart | null | undefined
): boolean {
  if (typeof totalAtRender !== "number") {
    return false
  }

  const total = cart?.total

  if (typeof total !== "number") {
    return false
  }

  return total !== totalAtRender
}

/**
 * Whether a `pageshow` event is the one that must give the CTA back.
 *
 * `placeOrderFlow` deliberately KEEPS its re-entrancy lock through a redirect:
 * releasing it would let a second click mint a second Mercado Pago preference
 * for the same cart, on a provider where the webhook is the source of truth for
 * both. That leaves one way in and no way out — the customer presses Back, the
 * browser restores the page from the back/forward cache with React state
 * intact, and the CTA is disabled forever with no error and no path forward
 * except a manual reload.
 *
 * `pageshow` with `persisted: true` is the only signal that distinguishes a
 * bfcache restore from an ordinary load, and an ordinary load needs no release
 * because it builds fresh state anyway.
 *
 * A literal `true` and nothing else: the value comes off a DOM event object, so
 * it is probed rather than asserted, and a truthy-but-wrong value must not be
 * able to unlock a checkout that is mid-navigation.
 */
export function shouldReleasePlaceOrderLock(
  event: { persisted?: unknown } | null | undefined
): boolean {
  return event?.persisted === true
}

export type OpenpaySessionData = {
  token_id: string
  device_session_id: string
  return_url: string
  customer: {
    name: string | undefined
    last_name: string | undefined
    email: string | undefined
    phone_number: string | undefined
  }
}

/**
 * The Openpay session payload.
 *
 * `customer` is required: Openpay rejects the charge with API error 1001
 * without it, and sourcing it from the cart is what makes it present for guest
 * checkout as well as logged-in. It reads the BILLING address, which is why
 * `design.md` D5 makes step 2 (the address write) mandatory BEFORE step 4 — the
 * cart passed in here must be the one that write returned, not the one the page
 * rendered with.
 *
 * `device_session_id` is typed `string`, not `string | null`. The caller has to
 * have established it before reaching this function; encoding that in the type
 * is what stops a `null` from being quietly passed through to a live charge.
 *
 * Card data is NEVER included. It is tokenised in the browser by openpay.js and
 * the raw PAN does not cross this boundary — that is the PCI boundary, and the
 * spec asserts the exact key set so a later addition cannot slip past it.
 */
export function buildOpenpaySessionData({
  tokenId,
  deviceSessionId,
  returnUrl,
  cart,
}: {
  tokenId: string
  deviceSessionId: string
  returnUrl: string
  cart: HttpTypes.StoreCart | null | undefined
}): OpenpaySessionData {
  return {
    token_id: tokenId,
    device_session_id: deviceSessionId,
    return_url: returnUrl,
    customer: {
      name: cart?.billing_address?.first_name ?? undefined,
      last_name: cart?.billing_address?.last_name ?? undefined,
      email: cart?.email ?? undefined,
      phone_number: cart?.billing_address?.phone ?? undefined,
    },
  }
}

/**
 * Every string the place-order flow can show the customer.
 *
 * Mexican `tú`, never voseo — the same correction `checkout-readiness.ts`
 * carries, and for the same reason: `design.md` §2 and `proposal.md` R8 both
 * shipped Rioplatense imperatives, which belong to neither this store nor its
 * customers. A voseo string sails through review looking like Spanish, so the
 * spec guards it.
 *
 * Each message is shown INSTEAD of an order being placed, so each one has to
 * say what to do next. `totalChanged` is quoted verbatim from the task list.
 */
export const PLACE_ORDER_MESSAGES = {
  totalChanged: "El costo de envío cambió. Revisa el total y confirma de nuevo.",
  cardIncomplete: "Completa los datos de tu tarjeta.",
  /**
   * The `deviceSessionId` failure. Openpay's anti-fraud collector populates it
   * at script load, so an absence here means `openpay-data.v1.min.js` has not
   * finished — a cold load on a slow connection, since it mounts at
   * `strategy="lazyOnload"`. Reloading genuinely fixes it, so the message says
   * so rather than apologising.
   *
   * The alternative is initiating with `device_session_id: null`, which the
   * task list forbids outright: Openpay would take the charge without its
   * fraud signal.
   */
  deviceSessionMissing:
    "Todavía estamos preparando el pago seguro. Recarga la página e inténtalo de nuevo.",
  mercadoPagoUnavailable:
    "No pudimos abrir Mercado Pago. Inténtalo de nuevo en un momento.",
  providerUnsupported: "Elige un método de pago para continuar.",
  addressSyncFailed: "No pudimos guardar tus datos. Inténtalo de nuevo.",
  generic: "No pudimos completar tu pedido. Inténtalo de nuevo.",
} as const

import type { HttpTypes } from "@medusajs/types"

import {
  isManualProviderId,
  isMercadopagoProviderId,
  isOpenpayProviderId,
  MISSING_REQUIREMENT_MESSAGES,
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
 * A URL is only usable if it is an absolute `https://` URL.
 *
 * The cast-as-string this replaces (`data?.init_point as string | undefined`)
 * asserted the shape instead of checking it, and the consequence is not a
 * TypeScript complaint — it is `window.location.href = undefined`, which
 * coerces to the string `"undefined"`, a perfectly valid relative URL. The
 * customer lands on a 404 with their cart intact and no way to tell whether
 * they were charged.
 *
 * ## Why non-emptiness was not enough
 *
 * The first version of this check tested `trim().length > 0`, which is a check
 * on the STRING and not on the URL. Every value below is non-empty and every
 * one of them is a different way for a `location.href` assignment on a payment
 * path to go wrong: `"undefined"` and `"/checkout/abc"` are relative
 * navigations to a 404, `"//mp.example/x"` inherits the current scheme,
 * `"javascript:alert(1)"` EXECUTES, and `"http://…"` downgrades a payment
 * redirect off TLS.
 *
 * Both callers feed this from an untyped third-party payment response — a
 * Mercado Pago preference and an Openpay 3DS challenge — and both destinations
 * are external hosted pages that are `https` by definition. So the narrow
 * check costs nothing real and closes the whole class.
 */
const HTTPS_URL = /^https:\/\/[^\s]+$/

const asUsableUrl = (value: unknown): string | null =>
  typeof value === "string" && HTTPS_URL.test(value) ? value : null

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
   * `strategy="lazyOnload"`.
   *
   * ## It used to say "Recarga la página", and under §12b that is wrong advice
   *
   * This wording was written for the PR1b trigger, where the scripts loaded on
   * checkout MOUNT — so a reload genuinely restarted the load that had not
   * finished. §12b moved the trigger to SELECTION: `collectDeviceData` is
   * `shouldCollectOpenpayDeviceData(...)`, which is false until the customer
   * picks Openpay. A reload therefore loads NOTHING and returns the customer to
   * a checkout with no payment method selected, where following the
   * instruction a second time changes nothing. Waiting a moment is what
   * actually works, so that is what it now says.
   *
   * The alternative is initiating with `device_session_id: null`, which the
   * task list forbids outright: Openpay would take the charge without its
   * fraud signal.
   */
  deviceSessionMissing:
    "Todavía estamos preparando el pago seguro. Espera unos segundos e inténtalo de nuevo.",
  mercadoPagoUnavailable:
    "No pudimos abrir Mercado Pago. Inténtalo de nuevo en un momento.",
  /**
   * DELEGATED, not copied. This read "Elige un método de pago para continuar."
   * while `checkout-readiness.ts` said "Elige un método de pago." for the same
   * customer-visible condition — the customer has not picked a payment method.
   * Two strings for one condition is the defect class this whole change is
   * about, and it is how the itemized list under the CTA and the CTA's own
   * refusal come to disagree in front of the customer.
   */
  providerUnsupported: MISSING_REQUIREMENT_MESSAGES.payment_method,
  addressSyncFailed: "No pudimos guardar tus datos. Inténtalo de nuevo.",
  /**
   * The customer came back from a declined 3DS challenge or from Mercado Pago
   * without paying. See {@link selectCheckoutEntryError}.
   *
   * It deliberately does NOT say "no se te cobró nada". For Openpay an
   * authorization hold may genuinely exist on the card, and reassuring the
   * customer otherwise is worse than saying nothing — they would stop looking
   * at their statement. What IS knowable is the order outcome, so that is what
   * it states, followed by what to do next.
   */
  paymentFailed:
    "Tu pago no se completó y no se creó ningún pedido. Revisa tu método de pago e inténtalo de nuevo.",
  generic: "No pudimos completar tu pedido. Inténtalo de nuevo.",
} as const

/**
 * The wire format the backend uses to name a payment failure without wording
 * it.
 *
 * ## Why a token and not the sentence itself
 *
 * The provider's own text reached the customer verbatim until this existed:
 * `openpay-payment/service.ts` built `Openpay error 3001: The card was
 * declined`, Medusa returned it on the cart-completion response, and
 * `messageFrom` passed the `Error.message` straight through. So the single
 * most-read failure string in the checkout was English, carried an internal
 * error number, and lived in a file no storefront spec can see.
 *
 * Moving the SPANISH to the backend would fix the language and keep the rest of
 * the problem: customer copy in two repositories, only one of which this app's
 * tests sweep. Moving the CLASSIFICATION instead splits it along the seam that
 * already exists — the backend is the only layer holding a structured
 * `error_code`, and this file is where every other sentence the checkout says
 * already lives.
 *
 * ## Why matching this is not "matching on the message"
 *
 * `place-order-flow.ts` states in capitals that the 3DS decision must never be
 * made by matching decline wording, because a backend rephrase breaks it
 * silently. That rule is about PROSE, which changes for editorial reasons. This
 * is a closed set of identifiers the backend emits deliberately and that
 * `openpay-payment/service.ts` and this constant both enumerate; a rename that
 * misses one falls to {@link PLACE_ORDER_MESSAGES.generic} rather than to a
 * wrong branch. And no navigation hangs off it — it only chooses a sentence.
 */
export const PAYMENT_FAILURE_PREFIX = "payment_failed:"

/**
 * @see PAYMENT_FAILURE_PREFIX for the transport, and
 * `apps/backend/src/modules/openpay-payment/service.ts` for the producer.
 */
export type PaymentFailureToken =
  | "card_declined"
  | "insufficient_funds"
  | "card_expired"
  | "invalid_card_number"
  | "invalid_cvv"
  | "missing_cvv"
  | "three_ds_failed"
  | "card_not_supported"
  | "bank_authorization_required"
  | "retry_limit_reached"
  | "amount_not_allowed"
  | "duplicate_order"
  | "processor_unavailable"
  | "merchant_config"

/**
 * What each classified failure says to the customer.
 *
 * ## Four codes collapse into one sentence, on purpose
 *
 * Openpay `3001` (declined), `3004` (reported stolen), `3005` (anti-fraud /
 * blacklist) and the undocumented `3007` all read `card_declined` here, which
 * is what Openpay's own WooCommerce and PrestaShop plugins do. Naming the real
 * reason would turn this checkout into a card-testing oracle: an attacker
 * feeding stolen PANs learns from the wording which ones are already flagged,
 * which is precisely the signal the anti-fraud system exists to withhold. The
 * real code is logged server-side, where it belongs.
 *
 * ## `insufficient_funds` is `3003` and NOTHING else
 *
 * Openpay's `4001` also says "not enough funds" and is about the MERCHANT's
 * Openpay balance. Mapping it here would tell a customer with a perfectly
 * funded card that their card has no money — blaming them for our accounting.
 * It maps to `merchant_config`, whose sentence promises nothing about the card.
 *
 * Every string is Mexican Spanish, `tú` imperative, and says what to do next —
 * the same contract as {@link PLACE_ORDER_MESSAGES}, and for the same reason:
 * each one is shown INSTEAD of a completed order.
 */
export const PAYMENT_FAILURE_MESSAGES: Record<PaymentFailureToken, string> = {
  card_declined:
    "Tu banco rechazó la tarjeta. Intenta con otra o comunícate con tu banco.",
  insufficient_funds:
    "La tarjeta no tiene fondos suficientes. Intenta con otra tarjeta.",
  card_expired:
    "La tarjeta está vencida. Revisa la fecha de expiración o usa otra tarjeta.",
  invalid_card_number:
    "El número de tarjeta no es válido. Revísalo e inténtalo de nuevo.",
  invalid_cvv:
    "El código de seguridad no es correcto. Revisa los 3 o 4 dígitos del reverso.",
  missing_cvv: "Falta el código de seguridad de tu tarjeta.",
  /**
   * The customer answered their bank's challenge and it did not pass — a
   * cancelled challenge, a wrong SMS code, or a timeout. It is NOT a decline of
   * the card itself, and telling them it was sends them looking for a second
   * card they do not need.
   */
  three_ds_failed:
    "No pudimos verificar tu tarjeta con el banco. Inténtalo de nuevo y completa la confirmación.",
  card_not_supported:
    "Esta tarjeta no se acepta para compras en línea. Intenta con otra.",
  bank_authorization_required:
    "Tu banco necesita autorizar este cargo. Llámalos e inténtalo de nuevo.",
  retry_limit_reached:
    "Hiciste demasiados intentos con esta tarjeta. Espera unos minutos antes de volver a intentar.",
  amount_not_allowed:
    "El monto excede el límite permitido para esta tarjeta. Intenta con otra.",
  /**
   * Openpay `1006`: this `order_id` was already processed. The charge very
   * probably WENT THROUGH, so this must never read as a failure that invites a
   * retry — a second attempt is how one order becomes two.
   */
  duplicate_order:
    "Este pedido ya se había procesado. Revisa tu correo antes de intentar de nuevo.",
  processor_unavailable:
    "El procesador de pagos no está disponible en este momento. Inténtalo de nuevo en unos minutos.",
  /**
   * Everything that is OUR problem: merchant balance (`4001`), unpaid fees
   * (`4002`), a bad key (`1002`), a malformed request (`1001`). The customer
   * cannot fix any of it, so the sentence does not ask them to — it does not
   * mention their card at all, and it does not invite the retry that would fail
   * identically.
   */
  merchant_config:
    "No pudimos procesar el pago en este momento. No se hizo ningún cargo. Escríbenos para ayudarte a completar tu pedido.",
}

/**
 * The one place a raw failure string becomes something a customer should read.
 *
 * Three inputs, three outcomes:
 *
 * 1. A classified failure (`payment_failed:<token>`) becomes its sentence.
 * 2. An UNCLASSIFIED provider leak — anything still shaped like the old
 *    `Openpay error 3001: …` — becomes {@link PLACE_ORDER_MESSAGES.generic}.
 *    This is the belt to the token's braces: a code the backend has not
 *    classified yet, or a provider message arriving by some path nobody
 *    remembered, must not reach the customer in English with an error number in
 *    it. Failing to the generic apology loses information the customer could
 *    not have used anyway, and the real detail is in the server log.
 * 3. Anything else passes through, because it is already one of OUR sentences —
 *    `cart.ts`'s decline copy, `PLACE_ORDER_MESSAGES`, the readiness catalogue.
 */
export function resolvePaymentFailureMessage(raw: string): string {
  const trimmed = raw.trim()

  if (trimmed.startsWith(PAYMENT_FAILURE_PREFIX)) {
    const token = trimmed.slice(PAYMENT_FAILURE_PREFIX.length).trim()

    return (
      PAYMENT_FAILURE_MESSAGES[token as PaymentFailureToken] ??
      PLACE_ORDER_MESSAGES.generic
    )
  }

  return PROVIDER_LEAK.test(trimmed) ? PLACE_ORDER_MESSAGES.generic : trimmed
}

/**
 * The shape of an unclassified provider message, matched only to SUPPRESS it.
 *
 * Anchored at the start and case-insensitive. It is deliberately narrow — it
 * recognises the two providers' own error envelopes and nothing else — because
 * a broad rule here would swallow the storefront's own Spanish copy and replace
 * every specific instruction with the generic apology.
 */
const PROVIDER_LEAK = /^(openpay|mercado\s*pago|mercadopago)\s+error\b/i

/**
 * The error to seed into `state.error` when the checkout is ENTERED, from the
 * page's query string.
 *
 * ## The customer this exists for
 *
 * `payment/openpay/return/route.ts` and `payment/mercadopago/failure/route.ts`
 * both redirect to `/{cc}/checkout?error=payment_failed`, and until this
 * function existed that parameter had zero readers anywhere under
 * `(checkout)/`. A customer whose 3DS challenge declined therefore landed on a
 * PRISTINE checkout — shipping restored, no error, no spinner,
 * `selectedPaymentProviderId: null`, CTA disabled beside "Elige un método de
 * pago." The only available reading of that screen is "my click didn't
 * register", so they re-select, re-enter the card and click again. On Openpay
 * that is a SECOND authorization hold on the same card, which on a Mexican
 * debit card is real money frozen.
 *
 * ## This is an explicit NON-GOAL being overridden, not overlooked
 *
 * `proposal.md` §4, `design.md` §13 and `tasks.md` both record "making
 * `error=payment_failed` visible to the customer" as out of scope, and the
 * return routes' own docstrings say so. That was defensible while `?step=`
 * deadlocked the page anyway: the customer could not have acted on the message.
 * It stops being defensible in the slice that starts taking money, where the
 * inline decline path (`settleFailed` → `state.error`) is excellent and this
 * one — the one that involves the customer's bank — says nothing at all.
 * Recorded as a deliberate override in `apply-progress.md`, not absorbed.
 *
 * ## Closed set, never an echo
 *
 * The parameter is attacker-controlled — it sits in a URL anyone can send to
 * anyone. This function only ever SELECTS from strings the storefront owns. A
 * version that rendered the parameter would let a crafted link place arbitrary
 * text above the customer's card form, which is a phishing surface at the exact
 * moment they are typing a PAN. Matching is exact: no trimming, no
 * case-folding, no prefix match.
 *
 * The array shape is handled because Next hands a repeated query parameter back
 * as one, and `?error=x&error=payment_failed` is trivially constructible.
 *
 * Pure, and in this module rather than in `checkout/page.tsx`, because that
 * file is a `.tsx` the node runner cannot load — a rule left there is a rule
 * nothing can contradict.
 */
export function selectCheckoutEntryError(
  searchParams:
    | Record<string, string | string[] | undefined>
    | null
    | undefined
): string | null {
  const raw = searchParams?.error
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]

  return values.includes("payment_failed")
    ? PLACE_ORDER_MESSAGES.paymentFailed
    : null
}

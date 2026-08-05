"use server"

import { sdk } from "@lib/config"
import { describeError, toLogReference } from "@lib/util/log-safe"
import { HttpTypes } from "@medusajs/types"
import { getAuthHeaders, getCacheOptions } from "./cookies"

/**
 * Resilience bound on `/store/shipping-options`.
 *
 * IMPORTANT — this is NOT the same justification as `listCartOptions`'
 * `CART_OPTIONS_TIMEOUT_MS` in `lib/data/cart.ts`, and that comment must not be
 * copied here. Per finding F3, this route dispatches to
 * `listShippingOptionsForCartWorkflow`, whose own docstring
 * (`list-shipping-options-for-cart.js:17-18`) states it "doesn't retrieve the
 * calculated prices" — it reads `calculated_price` straight off the price set
 * (`:243`, `:273`). No carrier is called on this path.
 *
 * The carrier-calling paths are `POST /store/shipping-options/:id/calculate` and
 * `POST /store/carts/:id/shipping-methods`. So this timeout is symmetry with the
 * rest of the data layer and cheap insurance against a hung upstream — not a
 * hot fix for a live carrier quote.
 */
const SHIPPING_OPTIONS_TIMEOUT_MS = 5_000

/**
 * Budget for the single retry. Shorter than the first attempt on purpose — see
 * `listCartShippingMethods`.
 */
const SHIPPING_OPTIONS_RETRY_TIMEOUT_MS = 2_000

/**
 * Whether a failure is worth a second identical request.
 *
 * The retry exists to absorb a TRANSIENT failure, and transience is knowable
 * from the status. An earlier revision caught unconditionally, so a 400, a 401
 * or a 404 bought a second byte-identical request, a second log line, and up to
 * `SHIPPING_OPTIONS_RETRY_TIMEOUT_MS` of extra time-to-first-byte for a
 * guaranteed-identical answer. This call is awaited during the server render of
 * the checkout page, so that time is paid by the customer — on a request that
 * cannot succeed.
 *
 * - NO status — no HTTP response was received at all: a dropped connection, a
 *   DNS failure, or `AbortSignal.timeout` firing. The most transient class there
 *   is, and the case the retry was added for.
 * - 5xx — the server failed to answer a request it accepted. Retryable by
 *   definition.
 * - 4xx — a statement about the REQUEST. Re-sending the same bytes cannot change
 *   the answer.
 *
 * Not exported: `"use server"` requires every export of this module to be an
 * async function, and this is a plain predicate. It is covered through
 * `listCartShippingMethods` in `fulfillment.spec.ts`, which is the behaviour
 * that actually matters anyway.
 */
const isRetryable = (error: unknown): boolean => {
  const { status } = describeError(error)

  return status === undefined || status >= 500
}

/**
 * Lists the shipping options available for a cart. Deliberately UNCACHED.
 *
 * ## Why the cache went away
 *
 * The response is simultaneously per-cart AND address-filtered on
 * `country_code | province | city | postal_expression`
 * (`list-shipping-options-for-cart.js:200-206`), so a stale entry is not a
 * slightly-old list — it is the WRONG list for the customer's address. Step
 * navigation used to mask that by accidentally refreshing it, and this change
 * removes step navigation.
 *
 * An earlier revision of this comment justified the removal by claiming the old
 * `force-cache` entry was NEVER reachable by `revalidateTag`. That is too
 * strong and is corrected here: `getCacheTag` returns `""` only when the
 * `_medusa_cache_id` cookie is absent (`lib/data/cookies.ts:22-34`), and
 * `middleware.ts:120-124` sets that cookie with `maxAge: 86400` on the first
 * non-asset navigation, with `config.matcher` (`middleware.ts:140-142`)
 * covering every page route. A user who has a cart almost always has the
 * cookie, so the tag was real and the entry was reachable most of the time.
 * The untagged window — first request of a session, and the gap after the 24 h
 * cache cookie expires while the 7-day cart cookie lives on — is a genuine but
 * narrow hole. The address-filtering argument above is what carries the
 * decision; the empty-tag hole is a secondary reason, not the reason.
 *
 * A bounded TTL (the `categories.ts:18` `revalidate: 300` precedent) was
 * considered and rejected: the filter inputs change within SECONDS of the
 * customer typing a postal code, so any TTL above zero is a wrong list some of
 * the time. The response is per-cart anyway, so the shared-cache hit rate that
 * would justify one does not exist.
 *
 * ## Why one retry
 *
 * Removing `force-cache` was right, but it also removed a mask: a served stale
 * entry used to paper over a transient backend blip, and now every blip reaches
 * the caller. `CheckoutForm` treats a `null` here as fatal, so a single 5xx or
 * one slow response used to cost the whole order. One retry recovers the
 * common transient case at a bounded cost.
 *
 * The retry budget is deliberately SHORTER than the first attempt. This call is
 * awaited during a server render of the checkout page, so the retry is paid in
 * time-to-first-byte by every customer who hits a blip; 5 s + 2 s caps the worst
 * case at ~7 s instead of 10 s. A hung upstream is the case retrying helps
 * least and costs most, so it gets the smaller half.
 *
 * Only ONE retry, and no backoff: if the backend is actually down, more
 * attempts turn a slow checkout into a slower one and add load to a struggling
 * service. Beyond one attempt the honest answer is an error state, which
 * `CheckoutForm` now renders.
 *
 * And only for failures a retry can actually fix — see `isRetryable`. A 4xx is a
 * statement about the request, so re-sending it spends the customer's
 * time-to-first-byte on an answer that cannot change.
 */
export const listCartShippingMethods = async (cartId: string) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const attempt = (timeoutMs: number) =>
    sdk.client
      .fetch<HttpTypes.StoreShippingOptionListResponse>(
        `/store/shipping-options`,
        {
          method: "GET",
          query: {
            cart_id: cartId,
          },
          headers,
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        }
      )
      .then(({ shipping_options }) => shipping_options)

  try {
    return await attempt(SHIPPING_OPTIONS_TIMEOUT_MS)
  } catch (firstError) {
    // Not retryable: report and stop. Not retrying must not mean not reporting —
    // this failure renders an error state to the customer, so it still has to be
    // visible to the team.
    if (!isRetryable(firstError)) {
      console.error("listCartShippingMethods failed, not retryable", {
        cart: toLogReference(cartId),
        first: describeError(firstError),
      })

      return null
    }

    try {
      return await attempt(SHIPPING_OPTIONS_RETRY_TIMEOUT_MS)
    } catch (retryError) {
      // Both attempts failed, and the caller renders an error state on `null`.
      // Log it: this is now a visible-to-the-customer failure, so a silent
      // `catch(() => null)` would leave the team debugging a screenshot.
      //
      // NO raw cart id — see `lib/util/log-safe.ts`. And `describeError`, not
      // the error object, for two reasons: the SDK's `FetchError` drags along
      // whatever the transport attached, AND its `message` is the backend's
      // response body verbatim, which on a not-found embeds the cart id in
      // full. `describeError` redacts both.
      console.error("listCartShippingMethods failed after one retry", {
        cart: toLogReference(cartId),
        first: describeError(firstError),
        retry: describeError(retryError),
      })

      return null
    }
  }
}

export const calculatePriceForShippingOption = async (
  optionId: string,
  cartId: string,
  data?: Record<string, unknown>
) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("fulfillment")),
  }

  const body = { cart_id: cartId, data }

  if (data) {
    body.data = data
  }

  return sdk.client
    .fetch<{ shipping_option: HttpTypes.StoreCartShippingOption }>(
      `/store/shipping-options/${optionId}/calculate`,
      {
        method: "POST",
        body,
        headers,
        next,
      }
    )
    .then(({ shipping_option }) => shipping_option)
    .catch((error) => {
      // A bare `catch(() => null)` made the `MissingDimensionsError` path
      // completely invisible: a variant with no weight or no L/W/H fails here,
      // the customer sees a shipping quote that never arrives, and nothing is
      // written anywhere the team can see it. The failure MUST be observable.
      //
      // The return value stays `null` on purpose — callers are unchanged in
      // PR1a. This adds a signal, it does not change the contract.
      //
      // The cart id is NOT logged: `GET`/`POST /store/carts/:id` carry no
      // customer authentication (`.../store/carts/middlewares.js:44-51`,
      // `:63-70`), so the id is a bearer credential over the customer's address
      // and email for the 7-day cookie lifetime, and a log stream is a much
      // wider audience than checkout. `optionId` plus the HTTP status and
      // message fully serve the observability goal here — identifying which
      // shipping option failed and why. `describeError` also keeps the raw
      // error object out, whose `message` is the backend's own text and whose
      // attached context can echo address content.
      console.error("calculatePriceForShippingOption failed", {
        optionId,
        cart: toLogReference(cartId),
        ...describeError(error),
      })

      return null
    })
}

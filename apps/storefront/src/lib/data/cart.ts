"use server"

import { sdk } from "@lib/config"
import { isOpenpay } from "@lib/constants"
import {
  buildPartialShippingAddressPayload,
  resolveShippingAddressId,
  type CheckoutDraftAddress,
  type FreshCartRead,
} from "@lib/util/cart-address-payload"
import { describeError, redactIds, toLogReference } from "@lib/util/log-safe"
import medusaError from "@lib/util/medusa-error"
import { HttpTypes } from "@medusajs/types"
import { revalidateTag } from "next/cache"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import {
  getAuthHeaders,
  getCacheOptions,
  getCacheTag,
  getCartId,
  removeCartId,
  setCartId,
} from "./cookies"
import { getRegion } from "./regions"
import { getLocale } from "./locale-actions"

/**
 * Retrieves a cart by its ID. If no ID is provided, it will use the cart ID from the cookies.
 * @param cartId - optional - The ID of the cart to retrieve.
 * @returns The cart object if found, or null if not found.
 */
export async function retrieveCart(cartId?: string, fields?: string) {
  const id = cartId || (await getCartId())
  fields ??=
    "*items, *region, *items.product, *items.variant, *items.thumbnail, *items.metadata, +items.total, *promotions, +shipping_methods.name"

  if (!id) {
    return null
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("carts")),
  }

  return await sdk.client
    .fetch<HttpTypes.StoreCartResponse>(`/store/carts/${id}`, {
      method: "GET",
      query: {
        fields,
      },
      headers,
      next,
      cache: "force-cache",
    })
    .then(({ cart }: { cart: HttpTypes.StoreCart }) => cart)
    .catch(() => null)
}

/**
 * Resilience bound on the uncached cart READ. Same magnitude as
 * `SHIPPING_OPTIONS_TIMEOUT_MS` in `lib/data/fulfillment.ts`.
 *
 * ## What this does NOT buy — corrected claim
 *
 * An earlier version of this comment said the timeout stops "a hung upstream
 * turning into a hung autosave". That overstates it. This bounds ONE of the two
 * sequential calls the autosave makes. `sdk.store.cart.update` in
 * `persistCheckoutDraft` still has no timeout of its own, so a backend that hangs
 * on the WRITE keeps that request open for as long as the platform's own socket
 * timeout allows.
 *
 * What no longer follows from that is a hung CHECKOUT. `checkout-write-scheduler`
 * races its `await` on this action against `CHECKOUT_WRITE_TIMEOUT_MS` and reports
 * a timeout exactly like a failure, so the FIFO chain and the requote path recover
 * even though the request itself cannot be cancelled. That bounds the wait, not
 * the call — the call is still out there, and this comment is still the reason the
 * READ half is the half worth bounding here.
 *
 * The write is deliberately left unbounded for now. `sdk.store.cart.update` is
 * typed `(id, body, query?, headers?)`
 * (`@medusajs/js-sdk/dist/esm/store/index.d.ts:424`) and takes no request init,
 * so adding a signal means abandoning the typed SDK method and hand-rolling
 * `sdk.client.fetch` on the single most consequential line in this change — the
 * destructive write itself. That is a bad trade inside a pass whose whole
 * purpose is de-risking that line, and it is recorded as a follow-up instead.
 *
 * What the read timeout DOES buy is real and worth keeping: this read runs
 * SEQUENTIALLY IN FRONT OF every write, so without a bound a hung read blocks
 * the write from ever being attempted, and it is the call whose failure mode
 * (`unresolved` -> abort) is already handled. Bounding the half that has a
 * defined failure path is the cheap half of the job, not the whole job.
 */
const CART_READ_TIMEOUT_MS = 5_000

/**
 * Uncached sibling of `retrieveCart`, for the reads whose whole point is that
 * they observe a write that just happened.
 *
 * ## Why `no-store` and not the tagged `force-cache` of `retrieveCart`
 *
 * The honest version of this argument, narrower than an earlier revision of
 * this comment claimed. `getCacheTag` returns `""` only when the
 * `_medusa_cache_id` cookie is absent (`lib/data/cookies.ts:22-34`), and
 * `middleware.ts:120-124` sets that cookie with `maxAge: 86400` on the first
 * non-asset navigation, with `config.matcher` (`middleware.ts:140-142`)
 * covering every page route. So a user who has a cart almost always has the
 * cookie and the cache entry IS tagged and IS reachable by `revalidateTag`.
 * The untagged window is real but narrow: the very first request of a session,
 * before the cookie round-trips, and the gap after the 24 h cache cookie
 * expires while the 7-day cart cookie is still alive.
 *
 * The load-bearing reason is the other one: `revalidateTag` followed by a read
 * IN THE SAME REQUEST is not a documented ordering guarantee in Next 15. This
 * function exists precisely to observe a write that just happened, so betting
 * its correctness on undocumented ordering — with a narrow untagged window
 * underneath it — buys a cache hit and pays for it with a silent stale read.
 * `no-store` is deterministic, and the callers that need this are on debounced
 * or one-shot paths where one uncached GET is the cheap half of the trade.
 *
 * Deliberately takes NO `next` options: passing tags alongside `no-store` would
 * only suggest a revalidation relationship that does not exist.
 *
 * ## Why it returns a result and not a cart-or-null
 *
 * This used to end in `.catch(() => null)`. `null` then meant two opposite
 * things — "the cart has no shipping address" (safe to write id-less) and "the
 * read failed" (writing id-less DESTROYS the address row). See
 * `FreshCartRead` and `resolveShippingAddressId` for the full argument. The
 * discriminated result is what lets the caller abort instead of guessing.
 */
export async function retrieveCartFresh(
  cartId?: string,
  fields?: string
): Promise<FreshCartRead> {
  const id = cartId || (await getCartId())
  fields ??=
    "*items, *region, *items.product, *items.variant, *items.thumbnail, *items.metadata, +items.total, *promotions, +shipping_methods.name"

  if (!id) {
    return { ok: false, error: "No existing cart found" }
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  return await sdk.client
    .fetch<HttpTypes.StoreCartResponse>(`/store/carts/${id}`, {
      method: "GET",
      query: {
        fields,
      },
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(CART_READ_TIMEOUT_MS),
    })
    .then(({ cart }: { cart: HttpTypes.StoreCart }) => ({
      ok: true as const,
      cart,
    }))
    .catch((error: unknown) => ({
      ok: false as const,
      error: describeError(error).message,
    }))
}

export async function getOrSetCart(countryCode: string) {
  const region = await getRegion(countryCode)

  if (!region) {
    throw new Error(`Region not found for country code: ${countryCode}`)
  }

  let cart = await retrieveCart(undefined, "id,region_id")

  const headers = {
    ...(await getAuthHeaders()),
  }

  if (!cart) {
    const locale = await getLocale()
    const cartResp = await sdk.store.cart.create(
      { region_id: region.id, locale: locale || undefined },
      {},
      headers
    )
    cart = cartResp.cart

    await setCartId(cart.id)

    const cartCacheTag = await getCacheTag("carts")
    revalidateTag(cartCacheTag)
  }

  if (cart && cart?.region_id !== region.id) {
    await sdk.store.cart.update(cart.id, { region_id: region.id }, {}, headers)
    const cartCacheTag = await getCacheTag("carts")
    revalidateTag(cartCacheTag)
  }

  return cart
}

export type PersistDraftResult =
  | { ok: true; cart: HttpTypes.StoreCart }
  | { ok: false; error: string }

/**
 * The only failure text `persistCheckoutDraft` lets cross back to the browser.
 *
 * `cart.ts` is `"use server"`, so every value this module returns is shipped to
 * the client. An earlier revision returned `resolution.error` and the caught
 * `error.message` verbatim — the backend's own response body
 * (`@medusajs/js-sdk/dist/esm/client.js:90`) — while the same change argued at
 * length that this exact text echoes cart ids and address content and must be
 * kept out of the LOG stream. Withholding it from the log and shipping it to the
 * browser is not a threat model, it is a contradiction.
 *
 * The detail is not lost, it is RELOCATED: the sanitised description goes to the
 * server-side log, where the team can read it and the customer cannot. And the
 * caller does not display this string anyway — `!persisted.ok` is a bare return
 * from the debounced autosave (`shipping-address/index.tsx`), so there is no
 * user-facing message to degrade.
 */
const PERSIST_DRAFT_GENERIC_ERROR = "Could not persist the checkout draft"

/**
 * Autosave writer for the checkout address draft (R6) and the sole trigger for
 * shipping re-quotation (R4). Replaces `persistShippingForCalc`.
 *
 * ## The bug this function exists to close
 *
 * `persistShippingForCalc` sent a partial `shipping_address` with NO `id`. Per
 * `explore §3`, MikroORM's `EntityAssigner` then takes `assignReference` ->
 * `em.create(...)` and writes a BRAND-NEW `cart_address` row with the cart FK
 * repointed at it, destroying `first_name`, `last_name`, `company`, `phone`,
 * `address_1` and `address_2`. Its old docstring claimed "a partial
 * shipping_address update is safe" — that was true only of `billing_address`,
 * and flatly wrong about the shipping address itself.
 *
 * Today the damage is masked by the `address_1 && address_2` prefetch gate and
 * by `setAddresses` re-sending the full payload on submit. R4 + R6 remove both
 * masks, so without this fix autosave becomes a PII shredder that fires on
 * every blur. See `buildPartialShippingAddressPayload` for the full mechanism.
 *
 * ## One write path, not two
 *
 * The R6 autosave (full customer data) and the R4 quote persist (four fields)
 * are deliberately collapsed into this single writer. Two partial writers
 * against the same nested entity is exactly the shape that produced the bug;
 * one writer with one id-resolution rule is auditable. The four quote fields
 * are a strict subset of the autosave payload, so the second write buys nothing.
 *
 * NEVER writes `billing_address`, promo codes or region. Billing is written at
 * CTA time (D5) by a function that DOES NOT EXIST YET — it is planned for PR2c.
 * The reference is kept because the exclusion needs a reason, not because the
 * callee is there to be found.
 *
 * ## No id may come from the caller
 *
 * This module is `"use server"`, so this function is a publicly reachable POST
 * endpoint whose arguments are entirely client-controlled. An earlier revision
 * took an `addressIdHint` and injected it verbatim as a `cart_address` primary
 * key with no check that the row belonged to `cartId`. That defeated this
 * module's own invariant ("the cart is the only id authority") by entering
 * through a different door, and it was self-staling as well: `setAddresses`
 * sends `shipping_address` WITHOUT an id, so every form submit churns the
 * address row id and any hint the client had captured went stale — and a stale
 * id is as destructive as no id, taking the same `assignReference` path, while
 * a colliding one risks a primary-key 500. The id is always resolved
 * server-side from a fresh read. A hint that has to be verified server-side is
 * not an optimisation.
 *
 * Cache: revalidates the `fulfillment` tag ONLY (options are address-filtered)
 * and deliberately NOT the `carts` tag — client state is authoritative after
 * mount (D1), and revalidating carts mid-typing would remount the checkout tree
 * and flicker the form.
 */
export async function persistCheckoutDraft(
  addr: Partial<CheckoutDraftAddress>,
  email: string | null
): Promise<PersistDraftResult> {
  // Step 1 — no cart, nothing to persist.
  const cartId = await getCartId()

  if (!cartId) {
    return { ok: false, error: "No existing cart found" }
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  try {
    // Step 2 — resolve the id from a fresh read. This is the ONLY id source;
    // see the docstring for why no caller-supplied hint is accepted.
    //
    // THE PROJECTION IS THE SINGLE POINT OF FAILURE IN THIS FIX, so it is
    // Medusa's own default field list and nothing more clever.
    //
    // An earlier revision used `"id,*shipping_address"` for consistency with the
    // rest of this data layer (`categories.ts:66`, `orders.ts:52`). That was the
    // wrong thing to optimise for. A star field must match an `allowed` entry in
    // FULL, while a dotted field passes by PREFIX — so the star form is the one
    // that breaks if `GET /store/carts/:id` ever gains an `allowed` list
    // (`query-config.js:137-140` sets only `defaults` today). Style consistency
    // is not worth failing on the one read the whole PII fix depends on.
    //
    // Both fields below are lifted verbatim from `defaultStoreCartFields`
    // (`@medusajs/medusa/dist/api/store/carts/query-config.js:102-103`), which
    // makes this the most-exercised projection in the product:
    //
    // - `shipping_address_id` is the FK SCALAR. A selected scalar always
    //   materialises its key, so its value is positive evidence in BOTH
    //   directions — `null` means there is genuinely no address row, a value
    //   means one exists. That is what lets the resolver tell "the cart has no
    //   address" apart from "our projection did not deliver the relation"
    //   without betting on how the serialiser treats an empty to-one.
    // - `shipping_address.id` is the id actually written into the payload.
    //
    // Two independent signals on purpose. `resolveShippingAddressId` aborts
    // unless one of them positively answers the question, so this can no longer
    // fail silently in the destructive direction. See its guards for the full
    // argument.
    const read = await retrieveCartFresh(
      cartId,
      "id,shipping_address_id,shipping_address.id"
    )
    const resolution = resolveShippingAddressId(read)

    // Step 3 — ABORT rather than write blind. `unresolved` means absence was
    // NOT positively established: the read failed, timed out, or returned
    // something that was not a cart. Writing a partial address with no id in
    // that state is exactly the bug this function exists to close — it takes
    // `assignReference` -> `em.create` and shreds the customer's `first_name`,
    // `last_name`, `company`, `phone`, `address_1` and `address_2`.
    //
    // The step-6 tripwire below CANNOT cover this: it only fires when an id was
    // sent, so the id-less path is silent by construction. Aborting is the only
    // safe default. A skipped shipping quote is recoverable by typing one more
    // character; destroyed PII is not, so the two do not get equal treatment.
    if (resolution.status === "unresolved") {
      // The reason goes to the LOG, not across the wire. See
      // `PERSIST_DRAFT_GENERIC_ERROR`. Without this line the abort would be
      // completely silent server-side, which is how a broken projection would go
      // unnoticed for a week.
      console.error("persistCheckoutDraft aborted: no id could be resolved", {
        cart: toLogReference(cartId),
        reason: redactIds(resolution.error),
      })

      return { ok: false, error: PERSIST_DRAFT_GENERIC_ERROR }
    }

    // `absent` is the one legitimate id-less write: the read SUCCEEDED and the
    // cart has no address row, so `em.create` is correct and there is nothing
    // to destroy. It is self-limiting — the next write picks the id up.
    const addressId = resolution.status === "resolved" ? resolution.id : null

    // Step 4 — the id-carrying payload. `buildPartialShippingAddressPayload`
    // owns the merge-vs-replace decision and is the AUTO-verified half of this
    // function (`cart-address-payload.spec.ts`).
    //
    // The `: null` branch is unreachable — a read that was not `ok` resolves to
    // `unresolved` and has already returned above. It is written out because
    // TypeScript narrows `resolution`, not `read`, and because the builder
    // reaches the same conclusion from `null` anyway (no id, key omitted).
    const payload = buildPartialShippingAddressPayload(
      read.ok ? read.cart : null,
      addr
    )

    // Step 5 — the write. `email` is sent only when the caller supplied one, so
    // an address-only autosave never clears a previously persisted email.
    const { cart } = await sdk.store.cart.update(
      cartId,
      {
        ...(email !== null ? { email } : {}),
        ...payload,
      } as HttpTypes.StoreUpdateCart,
      {},
      headers
    )

    // Step 6 — the S7 tripwire. If an id went out and a different one came back,
    // the row was REPLACED, not merged, and customer PII has just been
    // destroyed. There is no automated safety net for this invariant (it needs a
    // live backend), so a log line that fires the moment it breaks is worth more
    // than the same claim in a spec that cannot run.
    //
    // Deliberately does NOT throw: the write already happened, and turning a
    // silent data-loss event into a broken autosave helps nobody. This is an
    // observation point, not a guard.
    //
    // Logged through `toLogReference`: a cart id is a bearer credential on these
    // routes, and a log stream is not an authorised audience. See
    // `lib/util/log-safe.ts` for the full argument. The masked reference is
    // enough to correlate two lines about one cart, which is all this needs.
    if (addressId && cart?.shipping_address?.id !== addressId) {
      console.error("cart_address row was REPLACED, not merged", {
        cart: toLogReference(cartId),
        sent: toLogReference(addressId),
        got: toLogReference(cart?.shipping_address?.id),
      })
    }

    // Step 7 — shipping options are filtered on the address, so they must go.
    //
    // HONEST STATUS: this call is currently INERT. After this change the only
    // remaining `getCacheOptions("fulfillment")` producer is
    // `calculatePriceForShippingOption` (`fulfillment.ts:80`), which is a POST
    // and therefore never cached by Next, and `listCartShippingMethods` is now
    // `no-store`. So no cache entry carries the `fulfillment` tag for this to
    // reach. It stays because it is the invalidation CONTRACT for that tag —
    // "this cart's shipping options are now stale" is still true, and deleting
    // the only expression of it means the day a cached fulfillment read comes
    // back, it comes back silently wrong.
    const fulfillmentCacheTag = await getCacheTag("fulfillment")
    revalidateTag(fulfillmentCacheTag)

    // Step 8 — hand the cart back. Callers use it to reflect the persisted
    // state; it is NOT an id channel for the next write, which always resolves
    // its own id server-side.
    return { ok: true, cart }
  } catch (error) {
    // Same split as the abort above: the backend's text is sanitised and logged
    // server-side, and the browser gets a generic string. `describeError` also
    // keeps the raw error object — `cause`, request context, response body — out
    // of the log entirely.
    console.error("persistCheckoutDraft failed", {
      cart: toLogReference(cartId),
      ...describeError(error),
    })

    return { ok: false, error: PERSIST_DRAFT_GENERIC_ERROR }
  }
}

export async function updateCart(data: HttpTypes.StoreUpdateCart) {
  const cartId = await getCartId()

  if (!cartId) {
    throw new Error("No existing cart found, please create one before updating")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.cart
    .update(cartId, data, {}, headers)
    .then(async ({ cart }: { cart: HttpTypes.StoreCart }) => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)

      return cart
    })
    .catch(medusaError)
}

export async function addToCart({
  variantId,
  quantity,
  countryCode,
}: {
  variantId: string
  quantity: number
  countryCode: string
}) {
  if (!variantId) {
    throw new Error("Missing variant ID when adding to cart")
  }

  const cart = await getOrSetCart(countryCode)

  if (!cart) {
    throw new Error("Error retrieving or creating cart")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.store.cart
    .createLineItem(
      cart.id,
      {
        variant_id: variantId,
        quantity,
      },
      {},
      headers
    )
    .then(async () => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)
    })
    .catch(medusaError)
}

export async function updateLineItem({
  lineId,
  quantity,
}: {
  lineId: string
  quantity: number
}) {
  if (!lineId) {
    throw new Error("Missing lineItem ID when updating line item")
  }

  const cartId = await getCartId()

  if (!cartId) {
    throw new Error("Missing cart ID when updating line item")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.store.cart
    .updateLineItem(cartId, lineId, { quantity }, {}, headers)
    .then(async () => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)
    })
    .catch(medusaError)
}

export async function deleteLineItem(lineId: string) {
  if (!lineId) {
    throw new Error("Missing lineItem ID when deleting line item")
  }

  const cartId = await getCartId()

  if (!cartId) {
    throw new Error("Missing cart ID when deleting line item")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.store.cart
    .deleteLineItem(cartId, lineId, {}, headers)
    .then(async () => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)
    })
    .catch(medusaError)
}

/**
 * Selects a shipping method and RETURNS the updated cart.
 *
 * The SDK already resolves `{ cart }` here; the previous implementation awaited
 * it and threw it away, forcing the client to go back to the server (or to an
 * RSC re-render) for data it had just been handed. Under D1 client state is
 * authoritative after mount, so every mutating action returns the cart.
 *
 * Note (F1): `POST /store/carts/:id/shipping-methods` is REPLACE-ALL —
 * `addShippingMethodToCartWorkflow` parallelizes `removeShippingMethodFromCart`
 * over the current methods with the add. There is no orphan to clean up and no
 * separate delete call to make (nor is one exposed).
 */
export async function setShippingMethod({
  cartId,
  shippingMethodId,
}: {
  cartId: string
  shippingMethodId: string
}): Promise<HttpTypes.StoreCart> {
  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.cart
    .addShippingMethod(cartId, { option_id: shippingMethodId }, {}, headers)
    .then(async ({ cart }: { cart: HttpTypes.StoreCart }) => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      return cart
    })
    .catch(medusaError)
}

/**
 * Resolves the real client IP from the incoming request headers (server-side).
 * `x-forwarded-for` may be a comma-separated chain (client, proxy1, proxy2…);
 * the FIRST entry is the original client. Falls back to `x-real-ip`. Returns
 * undefined when neither is present so callers omit the value entirely.
 */
async function getClientIp(): Promise<string | undefined> {
  const headerStore = await headers()
  const forwardedFor = headerStore.get("x-forwarded-for")
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim()
    if (first) {
      return first
    }
  }
  return headerStore.get("x-real-ip")?.trim() || undefined
}

export async function initiatePaymentSession(
  cart: HttpTypes.StoreCart,
  data: HttpTypes.StoreInitializePaymentSession
) {
  const headers = {
    ...(await getAuthHeaders()),
  }

  // Openpay mandates the real client IP for E-commerce anti-fraud. Resolve it
  // SERVER-SIDE here (the client cannot be trusted to report its own IP) and
  // attach it to the session data; the backend forwards it as X-Forwarded-For.
  // Only added for Openpay sessions so other providers are untouched.
  let sessionData = data
  if (isOpenpay(data.provider_id)) {
    const clientIp = await getClientIp()
    if (clientIp) {
      sessionData = {
        ...data,
        data: { ...(data.data ?? {}), customer_ip: clientIp },
      }
    }
  }

  return sdk.store.payment
    .initiatePaymentSession(cart, sessionData, {}, headers)
    .then(async (resp) => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)
      return resp
    })
    .catch(medusaError)
}

/**
 * Applies promotion codes and RETURNS the updated cart, for the same D1 reason
 * as `setShippingMethod`: the tag revalidation below only helps a consumer that
 * re-renders on the server, and after this change the checkout client does not.
 */
export async function applyPromotions(
  codes: string[]
): Promise<HttpTypes.StoreCart> {
  const cartId = await getCartId()

  if (!cartId) {
    throw new Error("No existing cart found")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.cart
    .update(cartId, { promo_codes: codes }, {}, headers)
    .then(async ({ cart }: { cart: HttpTypes.StoreCart }) => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)

      return cart
    })
    .catch(medusaError)
}

export async function applyGiftCard(code: string) {
  //   const cartId = getCartId()
  //   if (!cartId) return "No cartId cookie found"
  //   try {
  //     await updateCart(cartId, { gift_cards: [{ code }] }).then(() => {
  //       revalidateTag("cart")
  //     })
  //   } catch (error: any) {
  //     throw error
  //   }
}

export async function removeDiscount(code: string) {
  // const cartId = getCartId()
  // if (!cartId) return "No cartId cookie found"
  // try {
  //   await deleteDiscount(cartId, code)
  //   revalidateTag("cart")
  // } catch (error: any) {
  //   throw error
  // }
}

export async function removeGiftCard(
  codeToRemove: string,
  giftCards: any[]
  // giftCards: GiftCard[]
) {
  //   const cartId = getCartId()
  //   if (!cartId) return "No cartId cookie found"
  //   try {
  //     await updateCart(cartId, {
  //       gift_cards: [...giftCards]
  //         .filter((gc) => gc.code !== codeToRemove)
  //         .map((gc) => ({ code: gc.code })),
  //     }).then(() => {
  //       revalidateTag("cart")
  //     })
  //   } catch (error: any) {
  //     throw error
  //   }
}

export async function submitPromotionForm(
  currentState: unknown,
  formData: FormData
) {
  const code = formData.get("code") as string
  try {
    await applyPromotions([code])
  } catch (e: any) {
    return e.message
  }
}

// TODO: Pass a POJO instead of a form entity here
export type SetAddressesResult = string | { ok: true }

export async function setAddresses(
  currentState: unknown,
  formData: FormData
): Promise<SetAddressesResult> {
  try {
    if (!formData) {
      throw new Error("No form data found when setting addresses")
    }
    const cartId = getCartId()
    if (!cartId) {
      throw new Error("No existing cart found when setting addresses")
    }

    const data = {
      shipping_address: {
        first_name: formData.get("shipping_address.first_name"),
        last_name: formData.get("shipping_address.last_name"),
        address_1: formData.get("shipping_address.address_1"),
        address_2: formData.get("shipping_address.address_2"),
        company: formData.get("shipping_address.company"),
        postal_code: formData.get("shipping_address.postal_code"),
        city: formData.get("shipping_address.city"),
        country_code: formData.get("shipping_address.country_code"),
        province: formData.get("shipping_address.province"),
        phone: formData.get("shipping_address.phone"),
      },
      email: formData.get("email"),
    } as any

    const sameAsBilling = formData.get("same_as_billing")
    if (sameAsBilling === "on") data.billing_address = data.shipping_address

    if (sameAsBilling !== "on")
      data.billing_address = {
        first_name: formData.get("billing_address.first_name"),
        last_name: formData.get("billing_address.last_name"),
        address_1: formData.get("billing_address.address_1"),
        address_2: formData.get("billing_address.address_2"),
        company: formData.get("billing_address.company"),
        postal_code: formData.get("billing_address.postal_code"),
        city: formData.get("billing_address.city"),
        country_code: formData.get("billing_address.country_code"),
        province: formData.get("billing_address.province"),
        phone: formData.get("billing_address.phone"),
      }
    await updateCart(data)
  } catch (e: any) {
    return e.message
  }

  // Navigation moved to the client: `Addresses` performs a soft
  // `router.push('?step=delivery', { scroll: false })` on success so prefetched
  // shipping prices and client state survive. A server redirect here would
  // full-remount the checkout tree, wiping the prefetch and causing a layout
  // jump.
  //
  // Return a fresh `{ ok: true }` object (NOT bare `null`) so every successful
  // submit yields a new reference. `useActionState` starts at `null`, so the
  // first success transitions `null` -> `{ ok: true }`, and each later success
  // returns a distinct object. This guarantees the navigation effect's
  // dependency changes on every success (Object.is), firing deterministically —
  // a bare `null` would not change across the initial-state/happy-path submit
  // and the effect would never re-run.
  return { ok: true }
}

/**
 * Places an order for a cart. If no cart ID is provided, it will use the cart ID from the cookies.
 * @param cartId - optional - The ID of the cart to place an order for.
 * @returns The cart object if the order was successful, or null if not.
 */
export async function placeOrder(cartId?: string) {
  const id = cartId || (await getCartId())

  if (!id) {
    throw new Error("No existing cart found when placing an order")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  const cartRes = await sdk.store.cart
    .complete(id, {}, headers)
    .then(async (cartRes) => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)
      return cartRes
    })
    .catch(medusaError)

  if (cartRes?.type === "order") {
    const countryCode =
      cartRes.order.shipping_address?.country_code?.toLowerCase()

    const orderCacheTag = await getCacheTag("orders")
    revalidateTag(orderCacheTag)

    removeCartId()
    redirect(`/${countryCode}/order/${cartRes?.order.id}/confirmed`)
  }

  // Medusa returns `type: "cart"` (HTTP 200, not an error) when completion
  // FAILED — e.g. the card was declined. The `error` field carries the reason
  // and the payment is already rolled back by Medusa. We MUST throw here so the
  // payment button's catch surfaces the message and stops its loading state;
  // returning the cart silently leaves the button spinning forever.
  throw new Error(
    cartRes?.error?.message ||
      "No pudimos completar tu pago. Tu tarjeta fue rechazada o el pago no se autorizó. Podés intentar de nuevo o con otra tarjeta."
  )
}

/**
 * Updates the countrycode param and revalidates the regions cache
 * @param regionId
 * @param countryCode
 */
export async function updateRegion(countryCode: string, currentPath: string) {
  const cartId = await getCartId()
  const region = await getRegion(countryCode)

  if (!region) {
    throw new Error(`Region not found for country code: ${countryCode}`)
  }

  if (cartId) {
    await updateCart({ region_id: region.id })
    const cartCacheTag = await getCacheTag("carts")
    revalidateTag(cartCacheTag)
  }

  const regionCacheTag = await getCacheTag("regions")
  revalidateTag(regionCacheTag)

  const productsCacheTag = await getCacheTag("products")
  revalidateTag(productsCacheTag)

  redirect(`/${countryCode}${currentPath}`)
}

/**
 * Resilience: `/store/shipping-options` resolves calculated prices through the
 * fulfillment providers, which means it waits on a live carrier quote (Skydropx).
 * Without an explicit bound, a hung carrier keeps the caller's render open
 * indefinitely. Mirrors the timeout contract already used by `provider-config`.
 */
const CART_OPTIONS_TIMEOUT_MS = 5_000

export async function listCartOptions() {
  const cartId = await getCartId()
  const headers = {
    ...(await getAuthHeaders()),
  }
  const next = {
    ...(await getCacheOptions("shippingOptions")),
  }

  return await sdk.client.fetch<{
    shipping_options: HttpTypes.StoreCartShippingOption[]
  }>("/store/shipping-options", {
    query: { cart_id: cartId },
    next,
    headers,
    cache: "force-cache",
    signal: AbortSignal.timeout(CART_OPTIONS_TIMEOUT_MS),
  })
}

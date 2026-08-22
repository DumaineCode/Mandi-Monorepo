"use server"

import { sdk } from "@lib/config"
import { HttpTypes } from "@medusajs/types"

import { getAuthHeaders, getCacheOptions } from "./cookies"

/**
 * How long a cached variant response may be served before Next revalidates it.
 *
 * This read used to be `cache: "force-cache"`, and here that means UNTIL THE
 * NEXT DEPLOY. Nothing in this repo revalidates the `variants` tag at all — no
 * `revalidateTag("variants")` call site exists, no webhook, no revalidation
 * route. So a perfectly tagged entry is just as stale as an untagged one, and
 * the storefront keeps quoting a stale price and, worse, keeps advertising stock
 * that no longer exists — letting shoppers order variants that are already sold
 * out.
 *
 * The uncookied window aggravates that, it does not cause it. `getCacheOptions`
 * returns `{}` while `_medusa_cache_id` is absent, so those entries would not be
 * reachable even by a tag revalidation someone adds later — but as
 * `fulfillment.ts` establishes, that hole is genuine and narrow, since the
 * middleware sets the cookie on the first page navigation. It is a secondary
 * reason.
 *
 * Five minutes follows the `categories.ts:18` `revalidate: 300` precedent and
 * bounds how long a stale price or inventory count can drive a purchase
 * decision.
 */
const VARIANT_REVALIDATE_SECONDS = 300

export const retrieveVariant = async (
  variant_id: string
): Promise<HttpTypes.StoreProductVariant | null> => {
  const authHeaders = await getAuthHeaders()

  if (!authHeaders) return null

  const headers = {
    ...authHeaders,
  }

  const next = {
    ...(await getCacheOptions("variants")),
    revalidate: VARIANT_REVALIDATE_SECONDS,
  }

  return await sdk.client
    .fetch<{ variant: HttpTypes.StoreProductVariant }>(
      `/store/product-variants/${variant_id}`,
      {
        method: "GET",
        query: {
          fields: "*images",
        },
        headers,
        next,
      }
    )
    .then(({ variant }) => variant)
    .catch(() => null)
}

"use server"

import { sdk } from "@lib/config"
import { HttpTypes } from "@medusajs/types"
import { getCacheOptions } from "./cookies"

/**
 * How long a cached collection response may be served before Next revalidates
 * it.
 *
 * These reads used to be `cache: "force-cache"`, and here that means UNTIL THE
 * NEXT DEPLOY. Nothing in this repo revalidates the `collections` tag in
 * response to an Admin edit — the only call site is the locale switch
 * (`lib/data/locale-actions.ts`), and there is no webhook and no revalidation
 * route. So a perfectly tagged entry is just as stale as an untagged one, and a
 * product added to or pulled from a collection keeps showing the old membership.
 *
 * The uncookied window aggravates that, it does not cause it. `getCacheOptions`
 * returns `{}` while `_medusa_cache_id` is absent, so those entries would not be
 * reachable even by a tag revalidation someone adds later — but as
 * `fulfillment.ts` establishes, that hole is genuine and narrow, since the
 * middleware sets the cookie on the first page navigation. It is a secondary
 * reason.
 *
 * Five minutes follows the `categories.ts:18` `revalidate: 300` precedent. It is
 * not free: these route segments export `generateStaticParams`, and a
 * fetch-level `revalidate` lowers the segment's own revalidate, so pages that
 * were static after build become ISR and regenerate every 5 minutes per path.
 */
const COLLECTION_REVALIDATE_SECONDS = 300

export const retrieveCollection = async (id: string) => {
  const next = {
    ...(await getCacheOptions("collections")),
    revalidate: COLLECTION_REVALIDATE_SECONDS,
  }

  return await sdk.client
    .fetch<{ collection: HttpTypes.StoreCollection }>(
      `/store/collections/${id}`,
      {
        next,
      }
    )
    .then(({ collection }) => collection)
}

export const listCollections = async (
  queryParams: Record<string, string> = {}
): Promise<{ collections: HttpTypes.StoreCollection[]; count: number }> => {
  const next = {
    ...(await getCacheOptions("collections")),
    revalidate: COLLECTION_REVALIDATE_SECONDS,
  }

  queryParams.limit = queryParams.limit || "100"
  queryParams.offset = queryParams.offset || "0"

  return await sdk.client
    .fetch<{ collections: HttpTypes.StoreCollection[]; count: number }>(
      "/store/collections",
      {
        query: queryParams,
        next,
      }
    )
    .then(({ collections }) => ({ collections, count: collections.length }))
}

export const getCollectionByHandle = async (
  handle: string
): Promise<HttpTypes.StoreCollection | null> => {
  const next = {
    ...(await getCacheOptions("collections")),
    revalidate: COLLECTION_REVALIDATE_SECONDS,
  }

  return await sdk.client
    .fetch<HttpTypes.StoreCollectionListResponse>(`/store/collections`, {
      query: { handle, fields: "*products" },
      next,
    })
    .then(({ collections }) => collections[0] || null)
}

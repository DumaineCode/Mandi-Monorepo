import { sdk } from "@lib/config"
import { HttpTypes } from "@medusajs/types"
import { getCacheOptions } from "./cookies"

/**
 * How long a cached category response may be served before Next revalidates it.
 *
 * These reads used to be `cache: "force-cache"`. That is unsafe here: category
 * covers live in `metadata.image_url` and are edited from Admin, but
 * `getCacheOptions` returns `{}` whenever the `_medusa_cache_id` cookie is absent
 * (crawlers, first visit, any uncookied request). A `force-cache` fetch with no
 * tag cannot be reached by `revalidateTag` at all, so an Admin edit would never
 * surface until the next deploy.
 *
 * Five minutes keeps categories effectively static for traffic while bounding
 * how long an Admin edit stays invisible.
 */
const CATEGORY_REVALIDATE_SECONDS = 300

/**
 * `+metadata` is explicit on purpose. It is already part of the store route's
 * default field set, but defaults are only preserved while every entry in
 * `fields` carries a `+`/`-`/`*` modifier — one bare field name replaces them
 * wholesale and would silently drop `metadata`, blanking every category cover
 * with no error. Naming it here makes that dependency visible at the call site.
 */
const CATEGORY_FIELDS =
  "+metadata, *category_children, *products, *parent_category, *parent_category.parent_category"

/**
 * Merchant-controlled display order.
 *
 * Without an explicit `order`, the store route hands back whatever Postgres
 * happens to return, which is not a defined order at all — the header, the
 * footer and the home carousel could each render the same categories in a
 * different sequence, and that sequence could change after an unrelated write.
 *
 * `rank` is Medusa's own sibling-ordering column, already part of the store
 * route's default field set, and the Admin dashboard edits it by drag and drop
 * (Categories -> Edit ranking). Sorting by it here means merchants reorder the
 * storefront from Admin instead of asking for a deploy, and every consumer of
 * this function inherits the same order for free.
 *
 * It is a DEFAULT, not a lock: `...query` is spread afterwards, so a caller
 * that needs a different sort still wins.
 *
 * Note that `rank` is nullable, and Postgres sorts NULLs last on an ascending
 * sort. An unranked category therefore drifts to the end rather than to the
 * front — harmless, but it is why an unranked category is not a bug report.
 */
const CATEGORY_ORDER = "rank"

export const listCategories = async (query?: Record<string, unknown>) => {
  const next = {
    ...(await getCacheOptions("categories")),
    revalidate: CATEGORY_REVALIDATE_SECONDS,
  }

  const limit = query?.limit || 100

  return sdk.client
    .fetch<{ product_categories: HttpTypes.StoreProductCategory[] }>(
      "/store/product-categories",
      {
        query: {
          fields: CATEGORY_FIELDS,
          limit,
          order: CATEGORY_ORDER,
          ...query,
        },
        next,
      }
    )
    .then(({ product_categories }) => product_categories)
}

export const getCategoryByHandle = async (categoryHandle: string[]) => {
  const handle = `${categoryHandle.join("/")}`

  const next = {
    ...(await getCacheOptions("categories")),
    revalidate: CATEGORY_REVALIDATE_SECONDS,
  }

  return sdk.client
    .fetch<HttpTypes.StoreProductCategoryListResponse>(
      `/store/product-categories`,
      {
        query: {
          fields: "+metadata, *category_children, *products",
          handle,
        },
        next,
      }
    )
    .then(({ product_categories }) => product_categories[0])
}

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

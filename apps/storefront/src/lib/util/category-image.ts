import { HttpTypes } from "@medusajs/types"

/**
 * The single metadata key that carries a category cover.
 *
 * Medusa product categories have no native image field, so the storefront reads
 * one out of the free-form `metadata` jsonb column. Keeping this to ONE key is
 * deliberate: an earlier revision also honoured `thumbnail` and `image`, which
 * gave three ways to express one thing and no defined winner when two were set.
 */
const COVER_KEY = "image_url"

/**
 * Resolve a category's cover image, or `undefined` when none is usable.
 *
 * The value is whatever a human typed into Admin's metadata editor, so it is
 * validated rather than trusted. In particular Admin persists an empty string
 * when a field is cleared instead of removing the key, and an empty `src` makes
 * `next/image` throw at render time — so blank values must degrade to the
 * caller's placeholder, not to a broken image.
 *
 * Both relative paths (`/categories/x.webp`, served from the storefront's
 * `public/`) and absolute URLs are returned as-is, which is what lets covers
 * migrate to a CDN by editing metadata alone, with no code change.
 */
export const getCategoryImage = (
  category: Pick<HttpTypes.StoreProductCategory, "metadata">
): string | undefined => {
  const value = category.metadata?.[COVER_KEY]

  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()

  return trimmed.length > 0 ? trimmed : undefined
}

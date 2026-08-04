import { listCategories } from "@lib/data/categories"
import { HttpTypes } from "@medusajs/types"

import CategoriesCarousel from "./categories-carousel"

/**
 * Categorías (ref wireframe lines 132-159). Server component: fetches top-level
 * product categories and hands them to the carousel, which owns presentation and
 * scroll state. Same split as `nav/index.tsx` → `NavShell` — keeping the fetch on
 * the server means the category list is in the initial HTML, not behind a
 * client-side round trip.
 */
const Categories = async () => {
  // No `fields` override here on purpose: bare field names replace the store
  // route's defaults instead of extending them, which is how `metadata` — and
  // with it every cover — goes missing. `listCategories` already asks for it.
  const categories = await listCategories().catch(
    () => [] as HttpTypes.StoreProductCategory[]
  )

  // Root categories only; children are reachable from the category page itself.
  // All of them are rendered — the carousel is what makes an unbounded list fit,
  // so there is no truncation here.
  const topLevel = (categories || []).filter((c) => !c.parent_category)

  if (topLevel.length === 0) {
    return null
  }

  return <CategoriesCarousel categories={topLevel} />
}

export default Categories

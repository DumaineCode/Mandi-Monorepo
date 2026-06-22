import { listCategories } from "@lib/data/categories"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import Image from "next/image"

// Categorías (ref wireframe lines 132-159). Fetches top-level product
// categories and renders up to 4 as cards in a responsive grid. Server
// component — fetches on the server, all internal links via LocalizedClientLink.

// Rotating diagonal-stripe placeholders matching the wireframe palette, used
// when a category has no image. Index-based so each card looks distinct.
const PLACEHOLDERS = [
  "repeating-linear-gradient(135deg,#F1D9CF 0,#F1D9CF 11px,#FBEBE3 11px,#FBEBE3 22px)",
  "repeating-linear-gradient(135deg,#D7E9D2 0,#D7E9D2 11px,#ECF6E8 11px,#ECF6E8 22px)",
  "repeating-linear-gradient(135deg,#D6E4F0 0,#D6E4F0 11px,#EAF1F9 11px,#EAF1F9 22px)",
  "repeating-linear-gradient(135deg,#F4E6C5 0,#F4E6C5 11px,#FBF3DE 11px,#FBF3DE 22px)",
]

// Pull an image off the category metadata if the store admin set one. Medusa
// categories have no native thumbnail, so we look for common metadata keys.
const getCategoryImage = (
  category: HttpTypes.StoreProductCategory
): string | undefined => {
  const meta = category.metadata as Record<string, unknown> | undefined
  const candidate =
    (meta?.thumbnail as string | undefined) ||
    (meta?.image as string | undefined) ||
    (meta?.image_url as string | undefined)
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : undefined
}

const Categories = async () => {
  const categories = await listCategories({
    fields: "id, name, handle, *products, metadata, parent_category",
  }).catch(() => [] as HttpTypes.StoreProductCategory[])

  // Top-level categories only (no parent). Render up to 4.
  const topLevel = (categories || [])
    .filter((c) => !c.parent_category)
    .slice(0, 4)

  if (topLevel.length === 0) {
    return null
  }

  return (
    <section className="mx-auto max-w-[1180px] px-6 pb-2.5 pt-16">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-coral">
            01 — Categorías
          </p>
          <h2 className="mt-2 font-bricolage text-[32px] font-extrabold leading-none tracking-[-0.03em] small:text-[42px]">
            Explora por categoría
          </h2>
        </div>
        <LocalizedClientLink
          href="/store"
          className="shrink-0 whitespace-nowrap border-b-2 border-coral pb-0.5 text-[15px] text-ink transition-colors hover:text-coral"
        >
          Ver todo el catálogo →
        </LocalizedClientLink>
      </div>

      <div className="grid grid-cols-1 gap-4 small:grid-cols-2 large:grid-cols-4">
        {topLevel.map((category, index) => {
          const image = getCategoryImage(category)
          const productCount = category.products?.length
          return (
            <LocalizedClientLink
              key={category.id}
              href={`/categories/${category.handle}`}
              className="group block overflow-hidden rounded-[18px] border border-line bg-paper transition-all duration-200 hover:-translate-y-[3px] hover:border-ink"
            >
              <div className="relative h-[140px] overflow-hidden">
                {image ? (
                  <Image
                    src={image}
                    alt={category.name}
                    fill
                    className="object-cover object-center"
                    sizes="(max-width: 1024px) 100vw, 25vw"
                  />
                ) : (
                  <div
                    aria-hidden
                    className="h-full w-full"
                    style={{
                      background: PLACEHOLDERS[index % PLACEHOLDERS.length],
                    }}
                  />
                )}
              </div>
              <div className="px-4 py-[15px]">
                <div className="font-bricolage text-[19px] font-bold leading-tight">
                  {category.name}
                </div>
                {typeof productCount === "number" && productCount > 0 ? (
                  <div className="mt-[3px] font-mono text-[11px] text-ink-muted">
                    {productCount}{" "}
                    {productCount === 1 ? "producto" : "productos"}
                  </div>
                ) : null}
              </div>
            </LocalizedClientLink>
          )
        })}
      </div>
    </section>
  )
}

export default Categories

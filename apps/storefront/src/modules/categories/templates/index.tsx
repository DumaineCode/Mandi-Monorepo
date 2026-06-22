import { notFound } from "next/navigation"
import { Suspense } from "react"

import SkeletonProductGrid from "@modules/skeletons/templates/skeleton-product-grid"
import RefinementList from "@modules/store/components/refinement-list"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"
import PaginatedProducts from "@modules/store/templates/paginated-products"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { HttpTypes } from "@medusajs/types"

export default function CategoryTemplate({
  category,
  sortBy,
  page,
  countryCode,
}: {
  category: HttpTypes.StoreProductCategory
  sortBy?: SortOptions
  page?: string
  countryCode: string
}) {
  const pageNumber = page ? parseInt(page) : 1
  const sort = sortBy || "created_at"

  if (!category || !countryCode) notFound()

  const parents = [] as HttpTypes.StoreProductCategory[]

  const getParents = (category: HttpTypes.StoreProductCategory) => {
    if (category.parent_category) {
      parents.push(category.parent_category)
      getParents(category.parent_category)
    }
  }

  getParents(category)

  // Breadcrumb ordered from root → current (parents are collected child-first).
  const breadcrumbParents = [...parents].reverse()

  return (
    <div data-testid="category-container">
      {/* Dark editorial hero driven by the real category (ref wireframe Tienda C). */}
      <div className="bg-ink px-6 py-10 text-cream">
        <div className="mx-auto max-w-[1180px]">
          <div className="flex flex-wrap items-center gap-x-1.5 font-mono text-xs text-cream-muted">
            <LocalizedClientLink
              href="/store"
              className="transition-colors hover:text-cream"
            >
              Inicio
            </LocalizedClientLink>
            {breadcrumbParents.map((parent) => (
              <span key={parent.id} className="flex items-center gap-x-1.5">
                <span aria-hidden>/</span>
                <LocalizedClientLink
                  href={`/categories/${parent.handle}`}
                  className="transition-colors hover:text-cream"
                  data-testid="sort-by-link"
                >
                  {parent.name}
                </LocalizedClientLink>
              </span>
            ))}
            <span aria-hidden>/</span>
            <span className="text-cream">{category.name}</span>
          </div>
          <h1
            data-testid="category-page-title"
            className="mt-2.5 font-bricolage text-[40px] font-extrabold leading-none tracking-[-0.03em] small:text-[52px]"
          >
            {category.name}
          </h1>
          {category.description ? (
            <p className="mt-2.5 max-w-2xl text-base text-cream-muted">
              {category.description}
            </p>
          ) : null}
        </div>
      </div>

      {/* Subcategory chips + sort row (ref wireframe lines 281-289). */}
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-2.5 px-6 pt-5">
        {category.category_children?.map((c) => (
          <LocalizedClientLink
            key={c.id}
            href={`/categories/${c.handle}`}
            className="rounded-full border border-line bg-paper px-4 py-2 text-sm text-ink transition-colors hover:border-ink"
          >
            {c.name}
          </LocalizedClientLink>
        ))}
        <div className="ml-auto">
          <RefinementList sortBy={sort} data-testid="sort-by-container" />
        </div>
      </div>

      <div className="mx-auto max-w-[1180px] px-6 pb-16 pt-5">
        <Suspense
          fallback={
            <SkeletonProductGrid
              numberOfProducts={category.products?.length ?? 8}
            />
          }
        >
          <PaginatedProducts
            sortBy={sort}
            page={pageNumber}
            categoryId={category.id}
            countryCode={countryCode}
          />
        </Suspense>
      </div>
    </div>
  )
}

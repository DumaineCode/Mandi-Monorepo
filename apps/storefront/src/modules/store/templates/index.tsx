import { Suspense } from "react"

import SkeletonProductGrid from "@modules/skeletons/templates/skeleton-product-grid"
import RefinementList from "@modules/store/components/refinement-list"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"

import PaginatedProducts from "./paginated-products"

const StoreTemplate = ({
  sortBy,
  page,
  countryCode,
}: {
  sortBy?: SortOptions
  page?: string
  countryCode: string
}) => {
  const pageNumber = page ? parseInt(page) : 1
  const sort = sortBy || "created_at"

  return (
    <div data-testid="category-container">
      {/* Dark editorial hero (ref wireframe Tienda C, CATÁLOGO lines 273-279) */}
      <div className="bg-ink px-6 py-10 text-cream">
        <div className="mx-auto max-w-[1180px]">
          <div className="font-mono text-xs text-cream-muted">
            Inicio / Todos los productos
          </div>
          <h1
            data-testid="store-page-title"
            className="mt-2.5 font-bricolage text-[40px] font-extrabold leading-none tracking-[-0.03em] small:text-[52px]"
          >
            Todos los productos
          </h1>
          <p className="mt-2.5 text-base text-cream-muted">
            Polvos, jarabes y botes — rendidores, color de menú premium.
          </p>
        </div>
      </div>

      {/* Sort row (ref wireframe lines 281-289). RefinementList keeps sorting logic. */}
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-2.5 px-6 pt-5">
        <div className="ml-auto">
          <RefinementList sortBy={sort} />
        </div>
      </div>

      <div className="mx-auto max-w-[1180px] px-6 pb-16 pt-5">
        <Suspense fallback={<SkeletonProductGrid />}>
          <PaginatedProducts
            sortBy={sort}
            page={pageNumber}
            countryCode={countryCode}
          />
        </Suspense>
      </div>
    </div>
  )
}

export default StoreTemplate

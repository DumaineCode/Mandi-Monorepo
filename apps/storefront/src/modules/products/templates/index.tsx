import React, { Suspense } from "react"

import ImageGallery from "@modules/products/components/image-gallery"
import ProductActions from "@modules/products/components/product-actions"
import RelatedProducts from "@modules/products/components/related-products"
import ProductInfo from "@modules/products/templates/product-info"
import SkeletonRelatedProducts from "@modules/skeletons/templates/skeleton-related-products"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { notFound } from "next/navigation"
import { HttpTypes } from "@medusajs/types"

import ProductActionsWrapper from "./product-actions-wrapper"

type ProductTemplateProps = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  countryCode: string
  images: HttpTypes.StoreProductImage[]
}

const TRUST_BADGES = [
  "Envío 24 h",
  "Precio de mayoreo",
  "Devolución 30 días",
]

const ProductTemplate: React.FC<ProductTemplateProps> = ({
  product,
  region,
  countryCode,
  images,
}) => {
  if (!product || !product.id) {
    return notFound()
  }

  // Breadcrumb category segment from real data (collection), fallback to "Tienda".
  const breadcrumbLabel = product.collection?.title ?? "Tienda"

  return (
    <>
      <div className="content-container py-6" data-testid="product-container">
        {/* Breadcrumb */}
        <nav
          aria-label="Migas de pan"
          className="mb-4 font-mono text-[12px] text-ink-muted"
        >
          <LocalizedClientLink
            href="/store"
            className="transition-colors hover:text-coral"
          >
            Inicio
          </LocalizedClientLink>
          <span className="px-1.5">/</span>
          <LocalizedClientLink
            href="/store"
            className="transition-colors hover:text-coral"
          >
            {breadcrumbLabel}
          </LocalizedClientLink>
          <span className="px-1.5">/</span>
          <span className="text-ink-soft">{product.title}</span>
        </nav>

        {/* 2-column: gallery left / info right */}
        <div className="grid grid-cols-1 gap-10 small:grid-cols-2">
          {/* LEFT — gallery */}
          <div className="w-full">
            <ImageGallery images={images} />
          </div>

          {/* RIGHT — info */}
          <div className="flex w-full flex-col">
            <ProductInfo product={product} />

            <div className="mt-5">
              <Suspense
                fallback={
                  <ProductActions
                    disabled={true}
                    product={product}
                    region={region}
                  />
                }
              >
                <ProductActionsWrapper id={product.id} region={region} />
              </Suspense>
            </div>

            {/* Description */}
            {product.description ? (
              <p
                className="mt-6 border-t border-line pt-[18px] text-[16px] leading-[1.6] text-ink-soft"
                data-testid="product-description"
              >
                {product.description}
              </p>
            ) : null}

            {/* Trust badges (static value props) */}
            <div className="mt-6 flex flex-wrap gap-x-3 gap-y-2.5">
              {TRUST_BADGES.map((badge) => (
                <span
                  key={badge}
                  className="inline-flex items-center rounded-[10px] border border-line bg-paper px-4 py-2.5 font-mono text-[13px] text-ink-soft"
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Related products */}
      <div
        className="content-container py-12 small:py-16"
        data-testid="related-products-container"
      >
        <Suspense fallback={<SkeletonRelatedProducts />}>
          <RelatedProducts product={product} countryCode={countryCode} />
        </Suspense>
      </div>
    </>
  )
}

export default ProductTemplate

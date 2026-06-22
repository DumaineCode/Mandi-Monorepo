import { getProductPrice } from "@lib/util/get-product-price"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import QuickAddButton from "@modules/products/components/quick-add"
import Thumbnail from "../thumbnail"

// Catalog product card (ref wireframe Tienda C, CATÁLOGO lines 294-306).
// Matches the home best-sellers card pattern: rounded-2xl, border-line, bg-paper,
// hover -translate-y / hover:border-ink. The whole card links to the product page
// EXCEPT the quick-add control, which is a sibling interactive island that must NOT
// navigate (kept outside the link, like the home card).
export default async function ProductPreview({
  product,
  isFeatured,
  region: _region,
  countryCode,
  cartLine,
}: {
  product: HttpTypes.StoreProduct
  isFeatured?: boolean
  region: HttpTypes.StoreRegion
  countryCode: string
  cartLine?: { lineId: string; quantity: number }
}) {
  const { cheapestPrice } = getProductPrice({
    product,
  })

  const tag =
    product.subtitle ||
    (product.tags && product.tags.length > 0
      ? product.tags[0].value
      : undefined)

  // All products are single-variant (placeholder "Default option").
  const variantId = product.variants?.[0]?.id

  return (
    <div
      data-testid="product-wrapper"
      className="group relative overflow-hidden rounded-2xl border border-line bg-paper transition-all duration-200 hover:-translate-y-[3px] hover:border-ink motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <LocalizedClientLink
        href={`/products/${product.handle}`}
        className="block"
      >
        <div className="relative h-[150px] overflow-hidden">
          {product.thumbnail || product.images?.length ? (
            <Thumbnail
              thumbnail={product.thumbnail}
              images={product.images}
              size="full"
              isFeatured={isFeatured}
              className="h-full rounded-none bg-transparent p-0 shadow-none"
            />
          ) : (
            <div
              aria-hidden
              className="h-full w-full"
              style={{
                background:
                  "repeating-linear-gradient(135deg,#ECE4D5 0,#ECE4D5 11px,#F5F0E5 11px,#F5F0E5 22px)",
              }}
            />
          )}
        </div>
        <div className="px-[15px] pb-1.5 pt-3.5">
          <div
            className="font-bricolage text-base font-bold leading-[1.15]"
            data-testid="product-title"
          >
            {product.title}
          </div>
          {tag ? (
            <div className="mt-1 font-mono text-[11px] text-ink-muted">
              {tag}
            </div>
          ) : null}
        </div>
      </LocalizedClientLink>

      {/* Bottom block: price on its own row, full-width quick-add below.
          Kept OUTSIDE the link so quick-add never navigates. */}
      <div className="px-[15px] pb-4 pt-2">
        <LocalizedClientLink
          href={`/products/${product.handle}`}
          className="block font-bricolage text-lg font-bold text-ink"
          tabIndex={-1}
          aria-hidden
        >
          {cheapestPrice ? cheapestPrice.calculated_price : ""}
        </LocalizedClientLink>
        {variantId ? (
          <div className="mt-3">
            <QuickAddButton
              variantId={variantId}
              countryCode={countryCode}
              lineId={cartLine?.lineId}
              quantity={cartLine?.quantity ?? 0}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

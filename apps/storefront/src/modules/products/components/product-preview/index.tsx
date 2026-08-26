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
      className="group relative flex h-full flex-row overflow-hidden rounded-2xl border border-line bg-paper transition-all duration-200 hover:-translate-y-[3px] hover:border-ink motion-reduce:transition-none motion-reduce:hover:translate-y-0 xsmall:flex-col"
    >
      {/* The card only changes ORIENTATION across breakpoints: below 512px it is
          a horizontal list row (image left, everything else right); from 512px
          up the same children stack into the vertical grid card. The inner
          content order never changes, so there is a single layout to reason
          about.

          Image and copy are two separate links rather than one wrapper, because
          a single wrapper cannot put the image on one side of a flex row and
          the copy on the other. The image link is aria-hidden/tabIndex -1 so
          assistive tech and keyboard users get exactly ONE link per card. */}
      <LocalizedClientLink
        href={`/products/${product.handle}`}
        className="w-[38%] shrink-0 self-stretch xsmall:w-full"
        tabIndex={-1}
        aria-hidden
      >
        <div className="relative h-full min-h-[132px] overflow-hidden xsmall:aspect-square xsmall:h-auto xsmall:min-h-0">
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
      </LocalizedClientLink>

      <div className="flex min-w-0 flex-1 flex-col p-3 xsmall:p-0">
        {/* The link GROWS (flex-1) and the price inside it takes the slack with
            mt-auto, so price and CTA stay glued as one bottom-anchored pair.
            Leftover height lands under the title instead of between them —
            these products have no description, so without this the gap opened
            exactly where it read as broken. It also aligns prices AND CTAs
            across a grid row when titles wrap to different heights. */}
        <LocalizedClientLink
          href={`/products/${product.handle}`}
          className="flex flex-1 flex-col xsmall:px-[15px] xsmall:pb-1.5 xsmall:pt-3.5"
        >
          <div
            className="font-bricolage text-base font-bold leading-[1.15] line-clamp-2"
            data-testid="product-title"
          >
            {product.title}
          </div>
          {tag ? (
            <div className="mt-1 font-mono text-[11px] text-ink-muted">
              {tag}
            </div>
          ) : null}
          {cheapestPrice ? (
            <div
              className="mt-auto pt-2 font-bricolage text-xl font-bold leading-none text-ink xsmall:pt-2.5 xsmall:text-2xl"
              data-testid="product-price"
            >
              {cheapestPrice.calculated_price}
            </div>
          ) : null}
        </LocalizedClientLink>

        {/* Quick-add lives OUTSIDE the link so it never navigates. */}
        {variantId ? (
          <div className="pt-3 xsmall:px-[15px] xsmall:pb-4 xsmall:pt-2.5">
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

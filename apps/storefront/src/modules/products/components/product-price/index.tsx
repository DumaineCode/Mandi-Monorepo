import { clx } from "@modules/common/components/ui"

import { getProductPrice } from "@lib/util/get-product-price"
import { HttpTypes } from "@medusajs/types"

export default function ProductPrice({
  product,
  variant,
}: {
  product: HttpTypes.StoreProduct
  variant?: HttpTypes.StoreProductVariant
}) {
  const { cheapestPrice, variantPrice } = getProductPrice({
    product,
    variantId: variant?.id,
  })

  const selectedPrice = variant ? variantPrice : cheapestPrice

  if (!selectedPrice) {
    return <div className="block h-9 w-32 animate-pulse rounded bg-cream-muted" />
  }

  return (
    <div className="flex flex-col text-ink">
      <span
        className={clx(
          "font-bricolage text-[34px] font-bold leading-none tracking-[-0.02em]",
          {
            "text-coral": selectedPrice.price_type === "sale",
          }
        )}
      >
        {!variant && "Desde "}
        <span
          data-testid="product-price"
          data-value={selectedPrice.calculated_price_number}
        >
          {selectedPrice.calculated_price}
        </span>
      </span>
      {selectedPrice.price_type === "sale" && (
        <p className="mt-1.5 font-mono text-[13px] text-ink-muted">
          <span>Antes: </span>
          <span
            className="line-through"
            data-testid="original-product-price"
            data-value={selectedPrice.original_price_number}
          >
            {selectedPrice.original_price}
          </span>
          <span className="ml-2 text-coral">
            −{selectedPrice.percentage_diff}%
          </span>
        </p>
      )}
    </div>
  )
}

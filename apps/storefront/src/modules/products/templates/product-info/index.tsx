import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

type ProductInfoProps = {
  product: HttpTypes.StoreProduct
}

const ProductInfo = ({ product }: ProductInfoProps) => {
  // Real descriptive tag from product data only (no fake ratings/reviews).
  const tag =
    product.subtitle ||
    (product.tags && product.tags.length > 0
      ? product.tags.map((t) => t.value).filter(Boolean).join(" · ")
      : undefined)

  return (
    <div id="product-info">
      <div className="flex flex-col gap-y-1.5">
        {product.collection && (
          <LocalizedClientLink
            href={`/collections/${product.collection.handle}`}
            className="font-mono text-[12px] uppercase tracking-[0.08em] text-ink-muted transition-colors hover:text-coral"
          >
            {product.collection.title}
          </LocalizedClientLink>
        )}
        <h1
          className="font-bricolage text-[34px] font-extrabold leading-[1.05] tracking-[-0.03em] text-ink small:text-[46px]"
          data-testid="product-title"
        >
          {product.title}
        </h1>
        {tag ? (
          <p className="font-mono text-[13px] text-ink-muted">{tag}</p>
        ) : null}
      </div>
    </div>
  )
}

export default ProductInfo

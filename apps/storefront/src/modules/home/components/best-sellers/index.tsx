import { listCollections } from "@lib/data/collections"
import { listProducts } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import { HttpTypes } from "@medusajs/types"
import { getProductPrice } from "@lib/util/get-product-price"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import Thumbnail from "@modules/products/components/thumbnail"

// Más vendidos (ref wireframe lines 177-201). Fetches up to 4 best-selling
// products robustly and renders them as cards. Server component.
// NOTE: no quick-add in this part — both the card and the "+" button navigate
// to the product page. True quick-add is a follow-up.

const pickBestSellers = async (
  countryCode: string
): Promise<HttpTypes.StoreProduct[]> => {
  const region = await getRegion(countryCode)
  if (!region) {
    return []
  }

  const { collections } = await listCollections({
    fields: "id, handle, title",
  }).catch(() => ({ collections: [], count: 0 }))

  const bestSellerCollection = collections.find((c) => {
    const hay = `${c.handle ?? ""} ${c.title ?? ""}`.toLowerCase()
    return ["vendido", "best", "top"].some((n) => hay.includes(n))
  })

  if (bestSellerCollection) {
    const {
      response: { products },
    } = await listProducts({
      countryCode,
      queryParams: { collection_id: bestSellerCollection.id, limit: 4 },
    }).catch(() => ({ response: { products: [], count: 0 }, nextPage: null }))
    if (products.length > 0) {
      return products.slice(0, 4)
    }
  }

  // Fallback: first 4 products overall.
  const {
    response: { products },
  } = await listProducts({
    countryCode,
    queryParams: { limit: 4 },
  }).catch(() => ({ response: { products: [], count: 0 }, nextPage: null }))

  return products.slice(0, 4)
}

const BestSellers = async ({ countryCode }: { countryCode: string }) => {
  const products = await pickBestSellers(countryCode)

  if (products.length === 0) {
    return null
  }

  return (
    <section className="mx-auto max-w-[1180px] px-6 pb-2.5 pt-14">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-coral">
            02 — Top ventas
          </p>
          <h2 className="mt-2 font-bricolage text-[32px] font-extrabold leading-none tracking-[-0.03em] small:text-[42px]">
            Los más pedidos
          </h2>
        </div>
        <LocalizedClientLink
          href="/store"
          className="shrink-0 whitespace-nowrap border-b-2 border-coral pb-0.5 text-[15px] text-ink transition-colors hover:text-coral"
        >
          Ver todos →
        </LocalizedClientLink>
      </div>

      <div className="grid grid-cols-1 gap-4 small:grid-cols-2 large:grid-cols-4">
        {products.map((product) => {
          const { cheapestPrice } = getProductPrice({ product })
          const tag =
            product.subtitle ||
            (product.tags && product.tags.length > 0
              ? product.tags[0].value
              : undefined)
          return (
            <LocalizedClientLink
              key={product.id}
              href={`/products/${product.handle}`}
              className="group block overflow-hidden rounded-2xl border border-line bg-paper transition-all duration-200 hover:-translate-y-[3px] hover:border-ink"
            >
              <div className="relative h-[150px] overflow-hidden">
                {product.thumbnail || product.images?.length ? (
                  <Thumbnail
                    thumbnail={product.thumbnail}
                    images={product.images}
                    size="full"
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
              <div className="px-[15px] py-3.5">
                <div className="font-bricolage text-base font-bold leading-[1.15]">
                  {product.title}
                </div>
                {tag ? (
                  <div className="mt-1 font-mono text-[11px] text-ink-muted">
                    {tag}
                  </div>
                ) : null}
                <div className="mt-3 flex items-center justify-between">
                  <span className="font-bricolage text-lg font-bold">
                    {cheapestPrice ? cheapestPrice.calculated_price : ""}
                  </span>
                  <span
                    aria-hidden
                    className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-coral text-xl text-coral-foreground transition-colors group-hover:bg-coral-hover"
                  >
                    +
                  </span>
                </div>
              </div>
            </LocalizedClientLink>
          )
        })}
      </div>
    </section>
  )
}

export default BestSellers

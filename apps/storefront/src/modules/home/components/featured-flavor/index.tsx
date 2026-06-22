import { listCollections } from "@lib/data/collections"
import { listProducts } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import { HttpTypes } from "@medusajs/types"
import { getProductPrice } from "@lib/util/get-product-price"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import Thumbnail from "@modules/products/components/thumbnail"

// Sabor del mes (ref wireframe lines 161-175). Picks ONE featured product
// robustly and renders it in a split spotlight card. Server component.

// Resolve the featured product without hardcoding a handle that may not exist:
// 1. a collection whose handle/title hints "sabor del mes"
// 2. else the first product of a "best sellers" collection
// 3. else the first product from listProducts
const pickFeaturedProduct = async (
  countryCode: string
): Promise<HttpTypes.StoreProduct | null> => {
  const region = await getRegion(countryCode)
  if (!region) {
    return null
  }

  const { collections } = await listCollections({
    fields: "id, handle, title",
  }).catch(() => ({ collections: [], count: 0 }))

  const matchBy = (needles: string[]) =>
    collections.find((c) => {
      const hay = `${c.handle ?? ""} ${c.title ?? ""}`.toLowerCase()
      return needles.some((n) => hay.includes(n))
    })

  const flavorCollection = matchBy(["sabor"])
  const bestSellerCollection = matchBy(["vendido", "best", "top"])

  const firstFromCollection = async (
    collection?: HttpTypes.StoreCollection
  ): Promise<HttpTypes.StoreProduct | null> => {
    if (!collection) {
      return null
    }
    const {
      response: { products },
    } = await listProducts({
      countryCode,
      queryParams: { collection_id: collection.id, limit: 1 },
    }).catch(() => ({ response: { products: [], count: 0 }, nextPage: null }))
    return products[0] ?? null
  }

  return (
    (await firstFromCollection(flavorCollection)) ||
    (await firstFromCollection(bestSellerCollection)) ||
    (await listProducts({ countryCode, queryParams: { limit: 1 } })
      .then(({ response }) => response.products[0] ?? null)
      .catch(() => null))
  )
}

const FeaturedFlavor = async ({ countryCode }: { countryCode: string }) => {
  const product = await pickFeaturedProduct(countryCode)

  if (!product) {
    return null
  }

  const { cheapestPrice } = getProductPrice({ product })
  const description = product.subtitle || product.description || ""

  return (
    <section className="mx-auto max-w-[1180px] px-6 pb-2.5 pt-14">
      <div className="grid grid-cols-1 overflow-hidden rounded-[22px] border border-line bg-paper small:grid-cols-2">
        <div className="relative flex min-h-[280px] items-end small:min-h-[340px]">
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
                  "repeating-linear-gradient(135deg,#F1D9CF 0,#F1D9CF 13px,#FBEBE3 13px,#FBEBE3 26px)",
              }}
            />
          )}
        </div>

        <div className="flex flex-col justify-center p-9 small:p-11">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-coral">
            Sabor del mes
          </p>
          <h3 className="mb-3 mt-3.5 font-bricolage text-[34px] font-extrabold leading-none tracking-[-0.03em] small:text-[46px]">
            {product.title}
          </h3>
          {description ? (
            <p className="m-0 mb-[22px] max-w-[360px] text-[17px] leading-[1.55] text-ink-soft line-clamp-3">
              {description}
            </p>
          ) : null}
          <div className="flex items-center gap-4">
            {cheapestPrice ? (
              <span className="font-bricolage text-[28px] font-bold">
                {cheapestPrice.calculated_price}
              </span>
            ) : null}
            <LocalizedClientLink
              href={`/products/${product.handle}`}
              className="inline-flex items-center justify-center rounded-xl bg-ink px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-ink/90"
            >
              Ver producto →
            </LocalizedClientLink>
          </div>
        </div>
      </div>
    </section>
  )
}

export default FeaturedFlavor

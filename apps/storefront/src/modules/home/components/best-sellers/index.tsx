import { retrieveCart } from "@lib/data/cart"
import { listCollections } from "@lib/data/collections"
import { listProducts } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import { HttpTypes } from "@medusajs/types"
import { buildCartLineByVariant } from "@lib/util/cart-line-map"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import ProductPreview from "@modules/products/components/product-preview"

// Más vendidos (ref wireframe lines 177-201). Fetches up to 4 best-selling
// products robustly and renders them as cards. Server component.
// Reuses `ProductPreview` — the same card the catalog and category pages
// render — instead of a hand-rolled card, so styling and quick-add behave
// identically everywhere a product grid shows up.

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
  const region = await getRegion(countryCode)
  const products = await pickBestSellers(countryCode)

  if (!region || products.length === 0) {
    return null
  }

  // Same cart-aware quick-add state as the catalog grid — see
  // `buildCartLineByVariant`.
  const cart = await retrieveCart().catch(() => null)
  const cartLineByVariant = buildCartLineByVariant(cart)

  return (
    <section className="mx-auto max-w-[1180px] px-6 pb-2.5 pt-14">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-blusans text-[32px] font-semibold leading-none tracking-[-0.03em] small:text-[42px]">
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
          const variantId = product.variants?.[0]?.id
          const cartLine = variantId
            ? cartLineByVariant.get(variantId)
            : undefined
          return (
            <ProductPreview
              key={product.id}
              product={product}
              region={region}
              countryCode={countryCode}
              cartLine={cartLine}
            />
          )
        })}
      </div>
    </section>
  )
}

export default BestSellers

import { listCartOptions } from "@lib/data/cart"
import { HttpTypes } from "@medusajs/types"
import ShippingPriceNudge from "@modules/shipping/components/free-shipping-price-nudge"

/**
 * Loads the shipping options the free-shipping nudge needs, isolated from the
 * layout's blocking render path.
 *
 * `GET /store/shipping-options` resolves calculated prices through the
 * fulfillment providers, so it waits on a live Skydropx quote (~1.25s measured
 * locally). Its Data Cache entry is keyed per cart, so every newly created cart
 * pays that quote cold — which lands exactly on the render that follows a
 * shopper's first add-to-cart. Awaiting it in the layout body delayed the whole
 * document for a promotional banner.
 *
 * The nudge is display-only and non-critical, so it belongs behind a Suspense
 * boundary where it streams in late instead of delaying the shell.
 *
 * NOTE: `listCartOptions` caches under the `shippingOptions` tag, which nothing
 * in the storefront ever revalidates. Quotes therefore persist for the life of
 * the cart even as its weight or address change. That staleness predates this
 * component and is tracked separately — do not assume the data here is fresh.
 */
export default async function FreeShippingNudgeLoader({
  cart,
}: {
  cart: HttpTypes.StoreCart
}) {
  let shippingOptions: HttpTypes.StoreCartShippingOption[]

  try {
    const { shipping_options } = await listCartOptions()
    shippingOptions = shipping_options
  } catch (error) {
    // Degrade to nothing rather than break the layout — but log it. Silent
    // degradation behind `fallback={null}` is indistinguishable from "no free
    // shipping rule configured", so a carrier outage could stay invisible for
    // weeks. Same operator-facing contract as `provider-config`.
    console.error(
      "Failed to load /store/shipping-options — the free-shipping nudge will not render for this cart.",
      error
    )
    return null
  }

  return (
    <ShippingPriceNudge
      variant="popup"
      cart={cart}
      shippingOptions={shippingOptions}
    />
  )
}

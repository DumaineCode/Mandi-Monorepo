import { Metadata } from "next"
import { Suspense } from "react"

import { retrieveCart } from "@lib/data/cart"
import { retrieveCustomer } from "@lib/data/customer"
import { getBaseURL } from "@lib/util/env"
import AnnouncementTicker from "@modules/home/components/announcement-ticker"
import CartMismatchBanner from "@modules/layout/components/cart-mismatch-banner"
import Footer from "@modules/layout/templates/footer"
import Nav from "@modules/layout/templates/nav"
import FreeShippingNudgeLoader from "@modules/shipping/components/free-shipping-price-nudge/nudge-loader"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default async function PageLayout(props: { children: React.ReactNode }) {
  // Independent reads: awaiting them in sequence added the customer round trip
  // to the cart round trip for no reason.
  const [customer, cart] = await Promise.all([
    retrieveCustomer(),
    retrieveCart(),
  ])

  return (
    <>
      {/* <AnnouncementTicker /> */}
      <Nav />
      {customer && cart && (
        <CartMismatchBanner customer={customer} cart={cart} />
      )}

      {/*
        Streamed, never awaited here: the nudge's data source resolves calculated
        shipping prices through the fulfillment providers (live carrier quote),
        and its cache entry is keyed per cart — so every new cart pays it cold on
        the render right after the shopper's first add-to-cart. Awaiting it in
        the layout body delayed the whole document for a promotional banner.
      */}
      {cart && (
        <Suspense fallback={null}>
          <FreeShippingNudgeLoader cart={cart} />
        </Suspense>
      )}
      {props.children}
      <Footer />
    </>
  )
}

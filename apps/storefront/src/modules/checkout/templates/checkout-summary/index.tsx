import { Heading } from "@modules/common/components/ui"

import DiscountCode from "@modules/checkout/components/discount-code"
import CartTotals from "@modules/common/components/cart-totals"
import Divider from "@modules/common/components/divider"
import { HttpTypes } from "@medusajs/types"
import React from "react"

/**
 * Stays a server component in this PR, and takes the line-item preview as a
 * SLOT so that subtree keeps rendering on the server.
 *
 * PR2b turns this into a client component that reads totals from
 * `useCheckout()` and renders the provisional-total state (D4). The slot lands
 * now so that change is only about totals, not about moving a tree across the
 * client boundary at the same time.
 */
const CheckoutSummary = ({
  cart,
  itemsSlot,
}: {
  cart: HttpTypes.StoreCart
  itemsSlot: React.ReactNode
}) => {
  return (
    <div className="sticky top-6 flex flex-col-reverse small:flex-col gap-y-8 py-8 small:py-0 ">
      <div className="flex w-full flex-col rounded-large border border-line bg-paper p-6 small:p-8">
        <Heading
          level="h2"
          className="flex flex-row items-baseline font-bricolage text-2xl text-ink"
        >
          En tu carrito
        </Heading>
        <Divider className="my-6 border-line" />
        <CartTotals totals={cart} />
        {itemsSlot}
        <div className="my-6">
          <DiscountCode cart={cart} />
        </div>
      </div>
    </div>
  )
}

export default CheckoutSummary

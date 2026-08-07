"use client"

import DiscountCode from "@modules/checkout/components/discount-code"
import {
  useCheckoutCart,
  useCheckoutState,
} from "@modules/checkout/state/checkout-context"
import { selectShippingIsProvisional } from "@modules/checkout/state/checkout-reducer"
import CartTotals from "@modules/common/components/cart-totals"
import Divider from "@modules/common/components/divider"
import { Heading, Text } from "@modules/common/components/ui"
import React from "react"

/**
 * The order summary, now reading LIVE cart state.
 *
 * ## Why this had to leave the server
 *
 * It rendered the cart from the RSC pass, and after PR2a nothing re-runs that
 * pass during checkout — `router.refresh()` is deliberately not used for in-flight
 * mutations (D1). So the totals froze at page load: a promotion applied, a
 * shipping method chosen, an address written, and the number in the right-hand
 * column stayed at whatever it was when the customer arrived. It reads
 * `state.cart` now, which every mutating server action replaces.
 *
 * ## The provisional total (D4 step 3)
 *
 * Finding F2: `updateCartWorkflow` unconditionally re-runs
 * `refreshCartShippingMethodsWorkflow`, which re-prices a surviving shipping
 * method for the new destination. Finding F1: the storefront cannot remove that
 * method. Together they mean the first autosave after a postal-code change
 * silently rewrites `cart.total`, and this component would otherwise present the
 * new number as the price of the order.
 *
 * That is the exact failure settled decision 1 exists to prevent, so while the
 * selection is stale the shipping line and the grand total are visibly marked as
 * provisional. Not hidden — a summary that removes its total mid-checkout reads
 * as broken — but de-emphasised and labelled, so nothing on screen claims to be
 * a price the customer agreed to.
 *
 * The condition is `selectShippingIsProvisional`, which is defined as the CTA's
 * own `shipping_method_stale` and not as a second reading of the same facts. A
 * copy is how the button and the total end up disagreeing about whether the order
 * is ready.
 */
const CheckoutSummary = ({ itemsSlot }: { itemsSlot: React.ReactNode }) => {
  const { cart } = useCheckoutCart()
  const state = useCheckoutState()

  if (!cart) {
    return null
  }

  const provisional = selectShippingIsProvisional(state)

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

        <div
          className={
            provisional ? "opacity-60 transition-opacity motion-reduce:transition-none" : undefined
          }
          data-testid="checkout-totals"
          data-provisional={provisional}
        >
          <CartTotals totals={cart} />
        </div>

        {provisional && (
          <Text
            className="mt-3 txt-small text-ink-muted"
            role="status"
            aria-live="polite"
            data-testid="provisional-total-note"
          >
            El costo de envío se recalcula cuando elijas el método.
          </Text>
        )}

        {itemsSlot}
        <div className="my-6">
          <DiscountCode cart={cart} />
        </div>
      </div>
    </div>
  )
}

export default CheckoutSummary

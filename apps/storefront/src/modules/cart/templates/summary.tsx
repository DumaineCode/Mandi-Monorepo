"use client"

import CartTotals from "@modules/common/components/cart-totals"
import DiscountCode from "@modules/checkout/components/discount-code"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { HttpTypes } from "@medusajs/types"

type SummaryProps = {
  cart: HttpTypes.StoreCart
}

function getCheckoutStep(cart: HttpTypes.StoreCart) {
  if (!cart?.shipping_address?.address_1 || !cart.email) {
    return "address"
  } else if (cart?.shipping_methods?.length === 0) {
    return "delivery"
  } else {
    return "payment"
  }
}

const Summary = ({ cart }: SummaryProps) => {
  const step = getCheckoutStep(cart)

  return (
    <div className="flex flex-col rounded-[18px] border-2 border-ink bg-paper p-6">
      <h2 className="mb-4 font-bricolage text-2xl font-extrabold tracking-[-0.02em] text-ink">
        Resumen
      </h2>

      <CartTotals totals={cart} />

      <div className="mb-5 mt-3">
        <DiscountCode cart={cart} />
      </div>

      <LocalizedClientLink
        href={"/checkout?step=" + step}
        data-testid="checkout-button"
        className="flex h-12 w-full items-center justify-center rounded-xl bg-coral font-semibold text-coral-foreground transition-colors hover:bg-coral-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper motion-reduce:transition-none"
      >
        Ir a pagar →
      </LocalizedClientLink>

      <p className="mt-3 text-center font-mono text-[11px] text-ink-muted">
        Pago seguro · factura disponible
      </p>
    </div>
  )
}

export default Summary

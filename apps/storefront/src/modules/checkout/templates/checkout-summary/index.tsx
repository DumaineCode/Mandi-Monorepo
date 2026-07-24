import { Heading } from "@modules/common/components/ui"

import ItemsPreviewTemplate from "@modules/cart/templates/preview"
import DiscountCode from "@modules/checkout/components/discount-code"
import CartTotals from "@modules/common/components/cart-totals"
import Divider from "@modules/common/components/divider"
import { HttpTypes } from "@medusajs/types"

const CheckoutSummary = ({ cart }: { cart: HttpTypes.StoreCart }) => {
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
        <ItemsPreviewTemplate cart={cart} />
        <div className="my-6">
          <DiscountCode cart={cart} />
        </div>
      </div>
    </div>
  )
}

export default CheckoutSummary

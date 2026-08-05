import { listCartShippingMethods } from "@lib/data/fulfillment"
import { listCartPaymentMethods } from "@lib/data/payment"
import { HttpTypes } from "@medusajs/types"
import AddressShippingGroup from "@modules/checkout/components/address-shipping-group"
import CheckoutUnavailable from "@modules/checkout/components/checkout-unavailable"
import Payment from "@modules/checkout/components/payment"
import Review from "@modules/checkout/components/review"

export default async function CheckoutForm({
  cart,
  customer,
}: {
  cart: HttpTypes.StoreCart | null
  customer: HttpTypes.StoreCustomer | null
}) {
  // The caller currently guarantees a cart, so this branch is unreachable
  // today. It renders the failure state anyway rather than `return null`: a
  // bare null is precisely the blank-page failure the rest of this component
  // was just changed to remove, and leaving one behind means the day this
  // template is rendered from somewhere with a weaker guarantee, the bug comes
  // back silently and in the worst possible place.
  if (!cart) {
    return <CheckoutUnavailable reason="No pudimos cargar tu carrito." />
  }

  const shippingMethods = await listCartShippingMethods(cart.id)
  const paymentMethods = await listCartPaymentMethods(cart.region?.id ?? "")

  // Neither list is optional: without shipping options there is nothing to
  // choose and without payment providers there is nothing to pay with, so the
  // form genuinely cannot be rendered. What changed is what "cannot render"
  // looks like.
  //
  // This used to `return null`, which turned one timeout or one 5xx into a
  // silently BLANK checkout page — no message, no retry, no signal. That was
  // masked while `listCartShippingMethods` was `force-cache` and a stale entry
  // could absorb a transient blip; removing the cache (correctly — the response
  // is address-filtered, so stale means WRONG) removed the mask and raised the
  // failure rate at the same time. An unrenderable checkout must at least say
  // so and offer a way back.
  //
  // Scope note: this is the smallest honest fix, not the start of a UI
  // restructure.
  //
  // Note what this does NOT cover, because an earlier version of this comment
  // implied otherwise: a SUCCESSFUL empty list. `listCartShippingMethods`
  // returns `null` only when the call failed, and `[]` is truthy, so a cart with
  // genuinely zero shipping options still falls through and renders the address
  // form with an empty list — unchanged behaviour. That is deliberate: an empty
  // list from a backend that answered is evidence, while a failed call is not,
  // and only the second one justifies refusing to render.
  if (!shippingMethods || !paymentMethods) {
    return (
      <CheckoutUnavailable
        reason={
          !shippingMethods
            ? "No pudimos obtener las opciones de envío."
            : "No pudimos obtener los métodos de pago."
        }
      />
    )
  }

  return (
    <div className="w-full grid grid-cols-1 gap-y-8">
      <AddressShippingGroup
        cart={cart}
        customer={customer}
        availableShippingMethods={shippingMethods}
      />

      <Payment cart={cart} availablePaymentMethods={paymentMethods} />

      <Review cart={cart} />
    </div>
  )
}

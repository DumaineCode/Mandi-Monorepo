import { retrieveCart } from "@lib/data/cart"
import { retrieveCustomer } from "@lib/data/customer"
import { listCartShippingMethods } from "@lib/data/fulfillment"
import { listCartPaymentMethods } from "@lib/data/payment"
import { getProviderConfig } from "@lib/data/provider-config"
import ItemsPreviewTemplate from "@modules/cart/templates/preview"
import PaymentWrapper from "@modules/checkout/components/payment-wrapper"
import { CheckoutProvider } from "@modules/checkout/state/checkout-context"
import CheckoutForm from "@modules/checkout/templates/checkout-form"
import CheckoutSummary from "@modules/checkout/templates/checkout-summary"
import { Metadata } from "next"
import { notFound } from "next/navigation"

export const metadata: Metadata = {
  title: "Checkout",
}

export default async function Checkout() {
  const cart = await retrieveCart()

  if (!cart) {
    return notFound()
  }

  const customer = await retrieveCustomer()
  const providerConfig = await getProviderConfig()

  /**
   * Both lists are hoisted here out of `CheckoutForm` (D7).
   *
   * `CheckoutForm` is a client component under `CheckoutProvider` now, so it
   * cannot await anything — and each list already had more than one consumer:
   * the payment providers gate whether Openpay's browser SDK loads at all, and
   * the shipping options seed `state.shippingOptions` for the requote effect.
   * Two call sites for one fact is how they end up disagreeing.
   *
   * Fetched in PARALLEL, which the sequential awaits in `CheckoutForm` were
   * not: `listCartShippingMethods` is bounded at 5 s + a 2 s retry and
   * `listCartPaymentMethods` has no bound at all, so back-to-back they made the
   * worst-case checkout render "7 s plus an unbounded tail" (`design.md` §14
   * item 5c, owned by this PR). `Promise.all` makes it the slower of the two.
   *
   * `null` from either means the REQUEST failed. `[]` is a real answer from a
   * backend that replied and is not a failure — a cart with genuinely zero
   * shipping options must still render the form.
   */
  const [shippingOptions, paymentMethods] = await Promise.all([
    listCartShippingMethods(cart.id),
    listCartPaymentMethods(cart.region?.id ?? ""),
  ])

  return (
    <div className="grid grid-cols-1 small:grid-cols-[1fr_416px] content-container gap-x-40 py-12">
      {/*
       * The provider owns every piece of client state the three sections share.
       * The RSC render supplies the INITIAL cart only; after mount `state.cart`
       * is authoritative and is replaced by the cart each mutating server action
       * returns. `router.refresh()` is deliberately never used for an in-flight
       * mutation — it re-runs this whole chain, which is the cost the
       * single-page checkout exists to remove, and `retrieveCart` is
       * `force-cache` with a possibly-empty tag so it is not reliably fresh
       * either (D1).
       */}
      <CheckoutProvider
        initial={{
          cart,
          customer,
          shippingOptions: shippingOptions ?? [],
        }}
      >
        {/* No `cart` prop: under C1 the wrapper mounts from provider config and
            deliberately reads no payment-session state. It still needs the
            available-methods list, because provider config alone does not say
            whether Openpay is on offer for this cart's region. */}
        <PaymentWrapper
          openpayConfig={providerConfig.openpay}
          availablePaymentMethods={paymentMethods}
        >
          <CheckoutForm
            customer={customer}
            shippingOptionsFailed={shippingOptions === null}
            availablePaymentMethods={paymentMethods}
          />
        </PaymentWrapper>

        {/*
         * The line-item preview is passed as a SLOT rather than imported into
         * the client subtree. Line items do not change during checkout, so
         * keeping that tree server-rendered costs nothing and sidesteps the
         * question of whether it is an RSC. PR2b turns `CheckoutSummary` itself
         * into a client component reading totals from this context; the slot is
         * already in place so that change stays about totals.
         */}
        <CheckoutSummary
          cart={cart}
          itemsSlot={<ItemsPreviewTemplate cart={cart} />}
        />
      </CheckoutProvider>
    </div>
  )
}

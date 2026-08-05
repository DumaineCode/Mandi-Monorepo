import { retrieveCart } from "@lib/data/cart"
import { retrieveCustomer } from "@lib/data/customer"
import { listCartPaymentMethods } from "@lib/data/payment"
import { getProviderConfig } from "@lib/data/provider-config"
import PaymentWrapper from "@modules/checkout/components/payment-wrapper"
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
   * Hoisted out of `CheckoutForm` rather than fetched twice.
   *
   * Two consumers now need this list: `CheckoutForm`, which renders the payment
   * options, and `PaymentWrapper`, which decides whether to load Openpay's
   * browser SDK at all. Fetching it in both places would be two call sites for
   * one fact, and the day they disagree is the day the SDK loads for a provider
   * the customer was never offered. One fetch, one source, passed down.
   *
   * The `null` case (the request failed) stays `CheckoutForm`'s to render, next
   * to the shipping-methods failure it already handles.
   */
  const paymentMethods = await listCartPaymentMethods(cart.region?.id ?? "")

  return (
    <div className="grid grid-cols-1 small:grid-cols-[1fr_416px] content-container gap-x-40 py-12">
      {/* No `cart` prop: under C1 the wrapper mounts from provider config and
          deliberately reads no payment-session state. It still needs the
          available-methods list, because provider config alone does not say
          whether Openpay is on offer for this cart's region. */}
      <PaymentWrapper
        openpayConfig={providerConfig.openpay}
        availablePaymentMethods={paymentMethods}
      >
        <CheckoutForm
          cart={cart}
          customer={customer}
          availablePaymentMethods={paymentMethods}
        />
      </PaymentWrapper>
      <CheckoutSummary cart={cart} />
    </div>
  )
}

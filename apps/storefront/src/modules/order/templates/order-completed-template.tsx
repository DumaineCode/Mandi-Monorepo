import { Heading } from "@modules/common/components/ui"
import { cookies as nextCookies } from "next/headers"

import CartTotals from "@modules/common/components/cart-totals"
import Help from "@modules/order/components/help"
import Items from "@modules/order/components/items"
import OnboardingCta from "@modules/order/components/onboarding-cta"
import OrderDetails from "@modules/order/components/order-details"
import ShippingDetails from "@modules/order/components/shipping-details"
import PaymentDetails from "@modules/order/components/payment-details"
import { HttpTypes } from "@medusajs/types"

type OrderCompletedTemplateProps = {
  order: HttpTypes.StoreOrder
}

export default async function OrderCompletedTemplate({
  order,
}: OrderCompletedTemplateProps) {
  const cookies = await nextCookies()

  const isOnboarding = cookies.get("_medusa_onboarding")?.value === "true"

  return (
    <div className="min-h-[calc(100vh-64px)] py-8 small:py-14">
      <div className="content-container flex h-full w-full max-w-4xl flex-col items-center justify-center gap-y-10">
        {isOnboarding && <OnboardingCta orderId={order.id} />}
        <div
          className="flex h-full w-full max-w-4xl flex-col gap-5 rounded-[22px] border border-line bg-paper p-5 shadow-sm xsmall:p-8 small:p-10"
          data-testid="order-complete-container"
        >
          <Heading
            level="h1"
            className="mb-2 flex flex-col gap-y-2 font-bricolage !text-3xl font-extrabold tracking-[-0.03em] text-ink"
          >
            <span>¡Gracias por tu compra!</span>
            <span className="text-xl font-semibold text-ink-muted">
              Tu pedido se realizó correctamente.
            </span>
          </Heading>
          <OrderDetails order={order} />
          <Items order={order} />
          <section className="rounded-2xl border border-line bg-cream/40 p-5">
            <Heading
              level="h2"
              className="mb-4 font-bricolage !text-xl font-bold text-ink"
            >
              Resumen
            </Heading>
            <CartTotals totals={order} />
          </section>
          <ShippingDetails order={order} />
          <PaymentDetails order={order} />
          <Help />
        </div>
      </div>
    </div>
  )
}

"use client"

import { HttpTypes } from "@medusajs/types"
import CheckoutUnavailable from "@modules/checkout/components/checkout-unavailable"
import ContactAddressSection from "@modules/checkout/components/contact-address-section"
import Payment from "@modules/checkout/components/payment"
import Review from "@modules/checkout/components/review"
import ShippingSection from "@modules/checkout/components/shipping-section"
import { useCheckoutCart } from "@modules/checkout/state/checkout-context"
import { Text } from "@modules/common/components/ui"

/**
 * A degraded section, for a dependency the checkout could not load.
 *
 * Replaces what used to be a `return null` for the WHOLE form. A checkout that
 * renders nothing because one endpoint hiccuped is worse than one that renders
 * with an error in the section that actually failed: the customer can still
 * enter their details, the autosave still keeps them, and a reload recovers the
 * rest. Blanking the page loses all of it.
 */
const SectionUnavailable = ({
  title,
  reason,
}: {
  title: string
  reason: string
}) => (
  <section className="rounded-large border border-line bg-paper p-6 small:p-8">
    <h2 className="mb-2 font-bricolage text-2xl text-ink">{title}</h2>
    <Text className="txt-medium text-ink-muted">{reason}</Text>
  </section>
)

/**
 * The checkout form column. LAYOUT ONLY — no data fetching, no state.
 *
 * `listCartShippingMethods` and `listCartPaymentMethods` moved up to
 * `checkout/page.tsx` (D7): this template is now a client component under
 * `CheckoutProvider`, so it cannot `await` anything, and the page is the one
 * place both lists have more than one consumer anyway.
 *
 * ## Chain state, stated plainly
 *
 * *Datos* and *Envío* are now the single-page sections. *Pago* and *Revisión*
 * are still the four-step components and are still driven by `?step=` — PR2c
 * replaces them with `PaymentSection` and one final CTA reading this same
 * context. Until then they open through their own "Editar" buttons rather than
 * through a step the address form pushes, because nothing pushes one any more.
 * That is an intermediate state on a chained branch; it never reaches `main`,
 * which is the reason the chain targets a tracker branch.
 */
export default function CheckoutForm({
  customer,
  availablePaymentMethods,
}: {
  customer: HttpTypes.StoreCustomer | null
  availablePaymentMethods: HttpTypes.StorePaymentProvider[] | null
}) {
  /**
   * The CART slice, not the whole state (W6 / C3).
   *
   * Subscribing to the full state re-rendered this template on every keystroke,
   * and through it `Payment` and `Review`. This context changes only when the
   * cart or the option SET actually changes.
   */
  const { cart } = useCheckoutCart()

  if (!cart) {
    return <CheckoutUnavailable reason="No pudimos cargar tu carrito." />
  }

  return (
    <div
      className={[
        "grid w-full grid-cols-1 gap-y-8",
        /**
         * Scroll clearance for PR2c's sticky mobile CTA bar. Landed here, ahead
         * of the bar itself, so the chain never has a commit where the bar
         * covers the last field — the single most common bug in sticky checkout
         * bars, and one that only shows up on a real phone.
         */
        "pb-[calc(6rem+env(safe-area-inset-bottom))] small:pb-12",
      ].join(" ")}
    >
      <ContactAddressSection customer={customer} />

      {/**
       * No `shippingOptionsFailed` branch any more, and its removal is a
       * correction rather than a simplification.
       *
       * That branch replaced the whole section with "recarga la página" when the
       * RSC-time `listCartShippingMethods` returned `null`. It made sense while
       * `Shipping` had no way to ask again. `ShippingSection` does: the requote
       * effect re-lists the options client-side as soon as the destination is
       * quotable, so a failed server fetch resolves itself without a reload — and
       * if the retry also fails, the section reports `failed` with a retry button
       * that works. Telling a customer to reload a page that is already fixing
       * itself is worse than saying nothing.
       *
       * The section reads its own options, prices and state out of the context,
       * so it takes no props at all.
       */}
      <ShippingSection />

      {availablePaymentMethods ? (
        <>
          <Payment cart={cart} availablePaymentMethods={availablePaymentMethods} />
          <Review cart={cart} />
        </>
      ) : (
        <SectionUnavailable
          title="Pago"
          reason="No pudimos obtener los métodos de pago. Recarga la página para intentarlo de nuevo."
        />
      )}
    </div>
  )
}

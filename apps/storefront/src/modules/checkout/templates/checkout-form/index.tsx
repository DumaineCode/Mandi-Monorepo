"use client"

import { HttpTypes } from "@medusajs/types"
import CheckoutUnavailable from "@modules/checkout/components/checkout-unavailable"
import ContactAddressSection from "@modules/checkout/components/contact-address-section"
import LegalNotice from "@modules/checkout/components/legal-notice"
import PaymentSection from "@modules/checkout/components/payment-section"
import PlaceOrderBar from "@modules/checkout/components/place-order-bar"
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
 * ## The migration is finished here
 *
 * Three sections, always open, plus one CTA. *Revisión* is gone entirely — it
 * was a step whose only content was the legal text and the place-order button,
 * and both of those now render in flow at the bottom of this column. There is no
 * `?step=` reader and no `?step=` writer left anywhere in the checkout, which is
 * what closes S5 and the deadlock it caused: `Payment` gated its body on
 * `?step=payment`, and the only thing that ever pushed that parameter was a
 * button inside the closed body.
 *
 * ## Both CTA variants render HERE, inside `PaymentWrapper`
 *
 * `design.md` D7 places the sticky variant next to `CheckoutSummary`, outside
 * the wrapper. That would give it the default `OpenpayContext` —
 * `deviceSessionId: null` — and every Openpay charge from a phone would fail
 * while the desktop one worked. The sticky bar is `position: fixed`, so its
 * position in the document costs nothing. See `place-order-bar/index.tsx`.
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
   * and through it every section below. This context changes only when the cart
   * or the option SET actually changes — and this template no longer passes the
   * cart down at all: each section reads exactly the slice it renders.
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
         * NOT the sticky bar's scroll clearance any more — that moved to the
         * page grid (`checkout/page.tsx`).
         *
         * It was here, and reserving on the form column alone was the bug:
         * on mobile the page is `grid-cols-1` with no `gap-y`, so
         * `CheckoutSummary` and the layout footer render BELOW this padding and
         * got no clearance at all. The customer could not reach the discount
         * field and never saw the payment badges — the very bug D9 names as
         * "the single most common bug in sticky checkout bars".
         *
         * What is left is ordinary separation from the summary below, matching
         * this grid's own `gap-y-8`.
         */
        "pb-8 small:pb-12",
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
        <PaymentSection availablePaymentMethods={availablePaymentMethods} />
      ) : (
        <SectionUnavailable
          title="Pago"
          reason="No pudimos obtener los métodos de pago. Recarga la página para intentarlo de nuevo."
        />
      )}

      {/*
       * Informational, never a gate (settled decision 2). It renders even when
       * the payment list failed to load, because it describes what clicking the
       * button means and that does not depend on which methods are on offer.
       */}
      <LegalNotice />

      {/*
       * The CTA renders unconditionally, INCLUDING when the payment list could
       * not be fetched. A checkout that hides its purchase button leaves the
       * customer with nothing to read; one that shows it disabled beside `Elige
       * un método de pago.` has told them exactly where they are.
       */}
      <PlaceOrderBar variant="inline" />
      <PlaceOrderBar variant="sticky" />
    </div>
  )
}

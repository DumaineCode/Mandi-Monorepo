"use client"

import { convertToLocale } from "@lib/util/money"
import ErrorMessage from "@modules/checkout/components/error-message"
import MissingItemsList from "@modules/checkout/components/missing-items-list"
import PlaceOrderButton from "@modules/checkout/components/payment-button"
import { useCheckoutState } from "@modules/checkout/state/checkout-context"
import { selectPlaceOrderView } from "@modules/checkout/state/checkout-reducer"
import { clx } from "@modules/common/components/ui"

/**
 * The final CTA, in its two placements (D9, tasks 2c.16 / 2c.17).
 *
 * One component, two variants, and a SINGLE derivation of their shared state:
 * `selectPlaceOrderView` decides disabled, busy, error, total and provisional
 * once, in a module the node runner can load. Two components working it out
 * separately is how the mobile bar ends up enabled while the desktop one is
 * not — and neither of them could be tested here.
 *
 * ## Both variants render inside `PaymentWrapper`, which `design.md` D7 does not
 *
 * D7's target tree puts `<PlaceOrderBar variant="sticky"/>` as a sibling of
 * `CheckoutSummary`, OUTSIDE `PaymentWrapper`. Taken literally that is a
 * silent-failure trap: the wrapper is what supplies `OpenpayContext`, so the
 * sticky button would read the DEFAULT context — `deviceSessionId: null` — and
 * every Openpay charge started from a phone would fail while the desktop one
 * worked. Both variants therefore live in `CheckoutForm`, inside the wrapper.
 * The sticky variant is `position: fixed`, so where it sits in the document has
 * no bearing on where it appears. Recorded as a correction to D7, not absorbed.
 */
const PlaceOrderBar = ({ variant }: { variant: "inline" | "sticky" }) => {
  const view = selectPlaceOrderView(useCheckoutState())

  const button = (
    <PlaceOrderButton
      disabled={view.disabled}
      isPlacing={view.placing}
      className="w-full"
      data-testid={`place-order-button-${variant}`}
    />
  )

  if (variant === "inline") {
    return (
      <div className="hidden small:block" data-testid="place-order-inline">
        {button}
        <ErrorMessage
          error={view.error}
          data-testid="place-order-error-message"
        />
        {/*
         * EVERY unmet requirement, in catalogue order (2c.15). The desktop
         * column has the room, and this is the list the sticky bar's single
         * line points back at.
         */}
        <MissingItemsList
          items={view.missing}
          className="mt-2"
          data-testid="place-order-missing-items"
        />
      </div>
    )
  }

  return (
    <div
      className={clx(
        "small:hidden fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper px-4 pt-3",
        /*
         * The iOS home indicator sits over the bottom of the viewport and would
         * otherwise cover the purchase button. `calc()` with a 0.75rem base so
         * the bar is not flush against the edge on devices that have no
         * indicator and report `0px`. Tailwind v3 arbitrary values support this
         * directly.
         *
         * The matching scroll clearance is on the form column
         * (`checkout-form/index.tsx`), which reserves the bar's height so it
         * never covers the last field or the legal text.
         */
        "pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
      )}
      data-testid="place-order-sticky"
      data-provisional={view.provisional}
    >
      {view.total !== null && (
        <div className="mb-2 flex items-baseline justify-between">
          <span className="txt-small text-ink-muted">Total</span>
          <span
            /*
             * `view.total` is `cart.total` — the same field `CartTotals`
             * renders in the summary — so the two numbers cannot disagree.
             *
             * De-emphasised while the shipping selection is stale (D4), for the
             * same reason the summary is: per F2 the backend silently re-priced
             * the surviving method for a destination the customer has not
             * agreed to, and nothing on screen may present that as final.
             */
            className={clx(
              "font-bricolage text-xl text-ink",
              view.provisional &&
                "opacity-60 transition-opacity motion-reduce:transition-none"
            )}
            data-testid="place-order-total"
            data-value={view.total}
          >
            {convertToLocale({
              amount: view.total,
              currency_code: view.currencyCode,
            })}
          </span>
        </div>
      )}

      {/*
       * No explanatory note beside the de-emphasised total, deliberately. The
       * summary carries one because it has nothing else; this bar already
       * renders `shipping_method_stale`'s own message — "Vuelve a elegir el
       * método de envío: cambiaste el código postal." — in the live region
       * below. A second sentence saying the same thing in different words is
       * how one condition acquires two vocabularies.
       */}
      {button}

      <ErrorMessage
        error={view.error}
        data-testid="place-order-sticky-error-message"
      />

      {/*
       * ONE line, not the whole list (D9): a fixed bar on a small viewport
       * cannot grow to four items without covering the form behind it. It is
       * the FIRST entry because the catalogue is ordered by page position, so
       * the first entry is the next thing the customer can act on. The complete
       * list renders in page flow above — `MissingItemsList` in the form
       * column on mobile, and the inline variant on desktop.
       *
       * `view.firstMissing` and NOT a `.slice(0, 1)` here. The selector already
       * makes this decision, in a module a spec can load; re-deriving it in
       * this file put the live rule where nothing could contradict it while
       * three tests guarded an identical field that no component read.
       */}
      <MissingItemsList
        items={view.firstMissing ? [view.firstMissing] : []}
        className="mt-2"
        data-testid="place-order-sticky-missing-item"
      />
    </div>
  )
}

export default PlaceOrderBar

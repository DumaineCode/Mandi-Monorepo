"use client"

import { useCheckoutActions } from "@modules/checkout/state/checkout-context"
import { Button, clx } from "@modules/common/components/ui"
import { useContext } from "react"

import { OpenpayContext } from "../payment-wrapper/openpay-wrapper"
import { CORAL_CTA } from "../submit-button"

/**
 * The only order-placement label in the storefront (S2, task 2c.24).
 *
 * It used to be `export`ed, with a docstring claiming that was what kept the
 * two `PlaceOrderBar` variants from drifting into two words for one action.
 * Nothing imported it, and nothing needs to: both variants render THIS
 * component, and this component renders this constant, so there is exactly one
 * label by construction rather than by convention. The export was dead public
 * surface defended by a claim about a drift that cannot happen.
 *
 * Kept as a named constant rather than inlined so task 2c.24's static gate —
 * "exactly one order-placement button, labelled `Realizar pedido`" — has one
 * literal to grep for.
 */
const PLACE_ORDER_LABEL = "Realizar pedido"

/**
 * The single order-placement button (tasks 2c.5, 2c.34).
 *
 * ## What this replaces, and why the old shape could never have worked
 *
 * It used to `switch (true)` on
 * `cart.payment_collection?.payment_sessions?.[0]?.provider_id` and render one
 * of four provider-specific buttons. Under R5 that array is EMPTY at render —
 * no session exists until this button is clicked — so every checkout would have
 * fallen to the disabled default branch and no order could ever have been
 * placed. The customer's SELECTION is the input; the session is an outcome, and
 * an outcome cannot also be the thing that decides what to render.
 *
 * So there is no dispatch here at all any more. `state.selectedPaymentProviderId`
 * feeds two places and both are pure and spec'd: `getMissingOrderRequirements`
 * decides whether the button is enabled, and `resolvePaymentTail` inside
 * `place-order-flow.ts` decides which provider tail runs. **This retires explore
 * risk #8 rather than deferring it** — the `payment_sessions[0]` vs
 * `status === "pending"` asymmetry disappears because nothing reads sessions.
 *
 * ## One label, not four
 *
 * `design.md` D5 has the provider predicates selecting the LABEL as well as the
 * tail, with a disabled `Selecciona un método de pago` default branch. That
 * conflicts with S2/2c.24, which requires exactly one order-placement button
 * labelled `Realizar pedido`; the old Mercado Pago branch said `Pagar con
 * Mercado Pago`. It is also redundant now: "no method chosen" is already
 * reported, in the customer's own list, as `Elige un método de pago.` — the
 * same string `PLACE_ORDER_MESSAGES.providerUnsupported` delegates to. Two
 * vocabularies for one condition is what slice 1's remediation removed.
 *
 * ## The gateway is read HERE, at click time, and that is not incidental
 *
 * `CheckoutProvider` is mounted OUTSIDE `PaymentWrapper`, which is what supplies
 * `OpenpayContext`. Anything above the wrapper reading that context gets the
 * DEFAULT value — `deviceSessionId: null`, a `tokenize` that rejects — and every
 * Openpay charge fails in a way no unit test can see, because the wiring is the
 * untestable part. This component renders inside the wrapper and passes the live
 * value as an argument, which also means it is read fresh: `deviceSessionId` is
 * populated asynchronously as `openpay-data.v1.min.js` loads, so a value
 * captured any earlier would be pinned to `null`.
 *
 * `release()` is NOT called from here. It is wired to the `pageshow` listener in
 * `checkout-context.tsx`, which is the only event that fires on a back/forward
 * cache restore — the one case the lock has to survive and then be given back.
 */
const PlaceOrderButton = ({
  disabled,
  isPlacing,
  className,
  "data-testid": dataTestId,
}: {
  disabled: boolean
  isPlacing: boolean
  className?: string
  "data-testid"?: string
}) => {
  const { placeOrderFlow } = useCheckoutActions()
  const openpay = useContext(OpenpayContext)

  return (
    <Button
      size="large"
      className={clx(CORAL_CTA, className)}
      /**
       * `disabled` now means ONE thing: an attempt is already in flight.
       *
       * It used to also mean "something is missing", and that is the behaviour
       * this removes. A greyed-out purchase button asserts that the order
       * cannot be placed and then declines to explain itself; the itemized list
       * beside it only helps a customer who has it on screen, which on mobile —
       * sticky bar pinned over a form scrolled well past — is often not the
       * case. Pressing now produces an answer: step 0 refuses, the offending
       * control is scrolled to and ringed, and the sentence appears below.
       *
       * Nothing that guards the money moved. Step 0 was ALREADY re-checking
       * every one of those conditions, precisely because a `disabled` attribute
       * is a UI affordance and not a lock — a stale render, an Enter key or a
       * devtools edit all reach the flow regardless.
       *
       * No `aria-disabled` beside it: the pair is redundant, and while an
       * attempt is running the modal is over the button anyway.
       */
      disabled={disabled}
      isLoading={isPlacing}
      /**
       * Fire-and-forget on purpose. Every outcome the flow can reach is already
       * dispatched into `state.placingOrder` and `state.error`, which is what
       * this button and the list beside it render. Awaiting the promise here
       * would add a second, component-local copy of that state.
       *
       * Re-entrancy is NOT guarded here either: the authoritative lock is a
       * synchronous closure flag inside the flow, because this button's
       * `disabled` prop reaches it through a ref that lags by one commit and two
       * clicks inside one commit would both read it as enabled.
       */
      onClick={() => {
        void placeOrderFlow(openpay)
      }}
      data-testid={dataTestId}
    >
      {PLACE_ORDER_LABEL}
    </Button>
  )
}

export default PlaceOrderButton

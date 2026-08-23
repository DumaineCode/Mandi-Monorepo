"use client"

import {
  useCheckoutActions,
  useCheckoutState,
} from "@modules/checkout/state/checkout-context"
import {
  selectPaymentModalPhase,
  type PaymentModalPhase,
} from "@modules/checkout/state/checkout-reducer"
import Modal from "@modules/common/components/modal"
import { Button, clx } from "@modules/common/components/ui"
import {
  PiCheckBold,
  PiLockKeyFill,
  PiPackageFill,
  PiXBold,
} from "react-icons/pi"

/**
 * What is happening to the customer's money, said out loud.
 *
 * ## The screen this replaces
 *
 * Pressing *Realizar pedido* used to do nothing visible except put a spinner
 * inside the button — for one to three seconds of tokenisation, then a cart
 * write, then a live authorization at a Mexican bank. On a phone the button is
 * in a fixed bar at the bottom, so a customer who had scrolled up saw no
 * feedback at all. The two readings available to them are "it didn't register"
 * and "the site is stuck", and both end in a second press.
 *
 * A modal is the right shape for this specifically because it is MODAL: it
 * takes the page away while a charge is in flight, which is exactly the period
 * during which nothing else on the page should be touched.
 *
 * ## It is not dismissible while processing, and the refusal is in the reducer
 *
 * Escape and a backdrop click both reach `PLACE_ORDER_DISMISSED`, which the
 * reducer IGNORES while `placingOrder` is true. The guard lives there rather
 * than as a condition on this `close` prop for the usual reason: this file is a
 * `.tsx` the node runner cannot load, and a guard nothing can contradict is a
 * guard that will eventually be removed by someone simplifying a callback.
 *
 * What it protects against: a customer who closes this mid-authorization is
 * looking at an idle checkout over a live charge, and their next move is to try
 * again — a second authorization hold on the same card, which on a Mexican
 * debit card is real money frozen for days.
 *
 * ## Every animation degrades under `motion-reduce`
 *
 * The verdict marks are still shown, they simply arrive already in place. The
 * information is in the icon and the colour, never in the movement — motion is
 * decoration on top of a state that is already legible, which is the only way
 * an animated status is accessible.
 */
const PaymentStatusModal = () => {
  const state = useCheckoutState()
  const { dispatch } = useCheckoutActions()
  const phase = selectPaymentModalPhase(state)

  return (
    <Modal
      isOpen={phase !== "hidden"}
      /**
       * Refuses to close during `processing`. See the docstring above — this
       * is the one guard standing between a customer and a duplicate
       * authorization hold on their card.
       */
      close={() => dispatch({ type: "PLACE_ORDER_DISMISSED" })}
      size="small"
      data-testid="payment-status-modal"
    >
      <div
        className="flex flex-col items-center py-4 text-center"
        /**
         * `alert` and not `status`: this is the outcome of an action the
         * customer just took with their money, and it must interrupt whatever
         * a screen reader is currently reading rather than queue behind it.
         */
        role="alert"
        aria-live="assertive"
        data-testid="payment-status"
        data-phase={phase}
      >
        <PaymentStatusArt phase={phase} />

        <h2 className="mt-6 font-bricolage text-2xl text-ink">
          {TITLES[phase]}
        </h2>

        <p
          className="mt-2 max-w-sm txt-medium text-ink-muted"
          data-testid="payment-status-message"
        >
          {/*
           * The failure BODY is `state.error`, which by the time it reaches
           * here has been through `resolvePaymentFailureMessage` — so it is one
           * of this storefront's own Spanish sentences, never the provider's
           * English and never an error code. The fallback covers the
           * theoretical case of a failure with no message attached.
           */}
          {phase === "failed" ? state.error ?? FAILED_FALLBACK : BODIES[phase]}
        </p>

        {/*
         * A dismiss control ONLY on failure.
         *
         * `processing` has nothing to offer — the charge is in flight and the
         * customer cannot help. `succeeded` has nothing either: `placeOrder`
         * has already issued its own redirect to the confirmation page, so a
         * button here would be a race between the customer's click and a
         * navigation that is already underway.
         */}
        {phase === "failed" && (
          <Button
            size="large"
            className="mt-6 w-full"
            onClick={() => dispatch({ type: "PLACE_ORDER_DISMISSED" })}
            data-testid="payment-status-dismiss"
          >
            Volver e intentar de nuevo
          </Button>
        )}
      </div>
    </Modal>
  )
}

const TITLES: Record<PaymentModalPhase, string> = {
  hidden: "",
  processing: "Procesando tu pago",
  /**
   * Names the OUTCOME, not the cause. The cause is the body text, which is the
   * specific, actionable sentence; a heading that guessed at it would contradict
   * the body every time the classification is anything but a plain decline.
   */
  failed: "No pudimos completar tu pago",
  succeeded: "¡Pago aprobado!",
}

/**
 * Only reachable if a failure arrives with no message attached, which the flow
 * does not do — every `settleFailed` path carries one. Present because the
 * alternative is an empty paragraph under a red cross, which tells the customer
 * their payment failed and refuses to say anything else.
 */
const FAILED_FALLBACK = "Inténtalo de nuevo o usa otro método de pago."

const BODIES: Record<PaymentModalPhase, string> = {
  hidden: "",
  /** Unused — the `failed` phase reads `state.error`. @see FAILED_FALLBACK */
  failed: FAILED_FALLBACK,
  /**
   * States that no charge has been made YET, and asks for the one thing the
   * customer can usefully do. It does not promise how long it will take: an
   * authorization at a Mexican bank can take three seconds, and a promise of
   * "un momento" that is broken is worse than no promise.
   */
  processing:
    "Estamos confirmando el pago con tu banco. No cierres ni recargues esta ventana.",
  succeeded: "Estamos preparando tu pedido. Te llevamos a tu confirmación…",
}

/**
 * The moving part, split out so the copy above reads as copy.
 *
 * Sized identically in all three phases (a 96 px square) so the dialog does not
 * resize when the verdict lands. A panel that grows or shrinks under a
 * `position: fixed` centre moves the text the customer is mid-way through
 * reading.
 */
const PaymentStatusArt = ({ phase }: { phase: PaymentModalPhase }) => {
  if (phase === "processing") {
    return (
      <div className="relative flex h-24 w-24 items-center justify-center">
        {/*
         * An expanding halo rather than a spinner. This state routinely lasts
         * two to three seconds against a bank, and a spinner held that long
         * reads as hung; a slow pulse reads as work in progress. It is purely
         * decorative, so it is hidden from the accessibility tree — the
         * `role="alert"` text above already says what is happening.
         */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-coral/25 motion-safe:animate-pulse-halo motion-reduce:opacity-30"
        />
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-coral/15 text-coral">
          <PiLockKeyFill size={30} aria-hidden />
        </span>
      </div>
    )
  }

  if (phase === "failed") {
    return (
      <div
        className={clx(
          "flex h-24 w-24 items-center justify-center",
          "motion-safe:animate-verdict-shake"
        )}
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 text-rose-600 motion-safe:animate-verdict-pop">
          <PiXBold size={32} aria-hidden />
        </span>
      </div>
    )
  }

  if (phase === "succeeded") {
    return (
      <div className="relative flex h-24 w-full max-w-[220px] items-center justify-center">
        {/*
         * The parcel travelling its track, then the check.
         *
         * The track is a background gradient whose WIDTH animates, which is how
         * a line gets drawn left-to-right without an SVG and without a
         * `stroke-dashoffset` this element cannot have. Under `motion-reduce`
         * both simply appear, which is the whole message anyway: a box and a
         * tick.
         */}
        <span
          aria-hidden
          className="absolute left-0 right-12 top-1/2 h-[2px] -translate-y-1/2 bg-gradient-to-r from-coral/0 to-coral/50 bg-no-repeat motion-safe:animate-track-draw"
        />
        <span
          aria-hidden
          className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted motion-safe:animate-parcel-travel"
        >
          <PiPackageFill size={30} />
        </span>
        <span className="absolute right-0 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 motion-safe:animate-verdict-pop">
          <PiCheckBold size={30} aria-hidden />
        </span>
      </div>
    )
  }

  return null
}

export default PaymentStatusModal

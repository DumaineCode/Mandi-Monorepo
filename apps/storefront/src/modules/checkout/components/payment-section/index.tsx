"use client"

import { RadioGroup } from "@headlessui/react"
import { isOpenpay, paymentInfoMap } from "@lib/constants"
import type { HttpTypes } from "@medusajs/types"
import ErrorMessage from "@modules/checkout/components/error-message"
import PaymentContainer, {
  OpenpayCardContainer,
} from "@modules/checkout/components/payment-container"
import {
  useCheckoutActions,
  useCheckoutState,
} from "@modules/checkout/state/checkout-context"
import { useCheckoutHighlight } from "@modules/checkout/state/use-checkout-highlight"
import { clx, Heading, Text } from "@modules/common/components/ui"
import { useCallback, useState } from "react"

import { HIGHLIGHT_CLASS } from "../field-anchor"

/**
 * "Pago" — the payment method, chosen without touching the network (task 2c.1).
 *
 * ## R5, which is the whole reason this component exists
 *
 * Selecting a method dispatches `SELECT_PAYMENT_PROVIDER` and **nothing else**.
 * No `initiatePaymentSession`, no preference, no request of any kind. Medusa
 * DELETES every payment session whenever `cart.raw_total` changes — choosing a
 * shipping method, applying a promotion, editing a line item — so a session
 * created here is guaranteed to be destroyed before it is used, and for Mercado
 * Pago each one is a real outbound Checkout Pro preference that is then thrown
 * away. The first and only session is created by the CTA.
 *
 * The `initiatedDefaultRef` one-shot guard that used to sit in `payment/` is
 * gone with it (task 2c.2), not ported. It could not re-initiate after a session
 * wipe, so it was a flag that made "payment ready" true exactly once and then
 * lied forever. Readiness is now derived on every render from live cart state
 * and the customer's selection, by `getMissingOrderRequirements`.
 *
 * ## No Stripe branch (task 2c.3)
 *
 * `apps/backend/medusa-config.ts` registers exactly two providers, `openpay` and
 * `mercadopago`, and `listCartPaymentMethods` is backend-driven — so a Stripe id
 * can never reach this list. R5 applies universally, with no provider carve-out.
 * `StripeCardContainer` and `StripePaymentButton` were deleted in PR1b.
 *
 * ## Nothing is pre-selected, and that is a change
 *
 * `payment/` pre-selected Openpay when it was offered. Two reasons not to carry
 * that over. It would satisfy the CTA's `payment_method` requirement on the
 * customer's behalf, which is the shape of choice-by-default this change is
 * removing everywhere else; and under `design.md` §12b it would start Openpay's
 * device fingerprinting for a customer who never chose Openpay, which is the
 * exact scope expansion §12b exists to undo.
 *
 * ## The section is never disabled (S4)
 *
 * No `pointer-events-none`, no gating `opacity-50`, no `disabled` container. A
 * customer may pick their payment method before they have typed an address; the
 * CTA is the only gate, and it says what is missing.
 */
const PaymentSection = ({
  availablePaymentMethods,
}: {
  availablePaymentMethods: HttpTypes.StorePaymentProvider[]
}) => {
  const state = useCheckoutState()
  const isHighlighted = useCheckoutHighlight()
  const { dispatch } = useCheckoutActions()

  /**
   * Card-validation feedback from `OpenpayCardContainer`, held locally.
   *
   * Deliberately NOT `state.error`: that field carries the place-order flow's
   * message and is rendered under the CTA. A malformed CVV overwriting "tu
   * tarjeta fue rechazada" would erase the more important of the two.
   */
  const [cardError, setCardError] = useState<string | null>(null)

  /**
   * `useCallback` is required here, not stylistic.
   *
   * `OpenpayCardContainer` lists this function in its effect's dependency array.
   * A fresh identity on every render re-runs the effect, which dispatches, which
   * produces a new state, which re-renders — an infinite loop. `dispatch` is
   * stable for the provider's lifetime, so this is too.
   *
   * The reducer additionally declines an unchanged value, which is what keeps a
   * sixteen-digit card number from re-rendering the whole checkout sixteen
   * times.
   */
  const setCardComplete = useCallback(
    (complete: boolean) => {
      dispatch({ type: "SET_PAYMENT_DETAILS_COMPLETE", complete })
    },
    [dispatch]
  )

  const selectedPaymentProviderId = state.selectedPaymentProviderId

  return (
    <section
      /*
       * Two anchors on one element, and they are genuinely different
       * complaints: `payment_method` is "you have not chosen how to pay" and
       * `card_details` is "the card form is incomplete". They share a target
       * because the card fields render INSIDE the selected method's row, so
       * both land the customer in the same place — but the codes stay separate
       * upstream so the sentence they read is the right one.
       *
       * `data-checkout-anchor` can only hold one value, and it holds whichever
       * of the two is currently being complained about. `payment_method` first:
       * it is the earlier code in the catalogue and the two are mutually
       * exclusive anyway — there are no card details to complete until a method
       * is chosen.
       */
      className={clx(
        "rounded-large border border-line bg-paper p-6 small:p-8",
        (isHighlighted("payment_method") || isHighlighted("card_details")) &&
          HIGHLIGHT_CLASS
      )}
      data-checkout-anchor={
        isHighlighted("card_details") ? "card_details" : "payment_method"
      }
      data-testid="payment-section"
    >
      <Heading
        level="h2"
        className="mb-6 font-bricolage text-2xl text-ink"
        data-testid="payment-heading"
      >
        Pago
      </Heading>

      {availablePaymentMethods.length === 0 ? (
        <Text className="txt-medium text-ink-muted" data-testid="payment-empty">
          No hay métodos de pago disponibles para tu región en este momento.
        </Text>
      ) : (
        <RadioGroup
          /*
           * `""` and never `undefined`. Headless UI falls back to its own
           * internal selection the moment `value` is undefined, and an
           * uncontrolled group remembers the last row clicked — which would
           * re-tick a provider the reducer does not know about. An empty string
           * is controlled and matches no provider id.
           */
          value={selectedPaymentProviderId ?? ""}
          onChange={(providerId: string) =>
            dispatch({ type: "SELECT_PAYMENT_PROVIDER", providerId })
          }
          aria-label="Método de pago"
          data-testid="payment-options"
        >
          {availablePaymentMethods.map((paymentMethod) => (
            <div key={paymentMethod.id}>
              {isOpenpay(paymentMethod.id) ? (
                /*
                 * The card fields render on SELECTION, with no session in
                 * existence (C1). The Openpay wrapper mounts from provider
                 * configuration rather than from a pending session, so
                 * `openpay.js` is available to tokenize and `deviceData.setup()`
                 * has run — neither of which needs the backend to have been told
                 * anything yet. While the scripts are still loading the
                 * container shows its skeleton rather than blocking the section.
                 */
                <OpenpayCardContainer
                  paymentProviderId={paymentMethod.id}
                  selectedPaymentOptionId={selectedPaymentProviderId}
                  paymentInfoMap={paymentInfoMap}
                  setError={setCardError}
                  setCardComplete={setCardComplete}
                />
              ) : (
                <PaymentContainer
                  paymentInfoMap={paymentInfoMap}
                  paymentProviderId={paymentMethod.id}
                  selectedPaymentOptionId={selectedPaymentProviderId}
                />
              )}
            </div>
          ))}
        </RadioGroup>
      )}

      <ErrorMessage
        error={cardError}
        data-testid="payment-method-error-message"
      />
    </section>
  )
}

export default PaymentSection

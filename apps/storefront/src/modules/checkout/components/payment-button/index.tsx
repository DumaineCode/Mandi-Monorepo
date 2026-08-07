"use client"

import { isManual, isMercadopago, isOpenpay } from "@lib/constants"
import { placeOrder, retrieveCart } from "@lib/data/cart"
import { HttpTypes } from "@medusajs/types"
import { Button } from "@modules/common/components/ui"
import React, { useState } from "react"
import ErrorMessage from "../error-message"
import { CORAL_CTA } from "../submit-button"

type PaymentButtonProps = {
  cart: HttpTypes.StoreCart
  "data-testid": string
}

const PaymentButton: React.FC<PaymentButtonProps> = ({
  cart,
  "data-testid": dataTestId,
}) => {
  const notReady =
    !cart ||
    !cart.shipping_address ||
    !cart.billing_address ||
    !cart.email ||
    (cart.shipping_methods?.length ?? 0) < 1

  const paymentSession = cart.payment_collection?.payment_sessions?.[0]

  switch (true) {
    case isOpenpay(paymentSession?.provider_id):
      return (
        <OpenpayPaymentButton notReady={notReady} data-testid={dataTestId} />
      )
    case isMercadopago(paymentSession?.provider_id):
      return (
        <MercadoPagoPaymentButton
          notReady={notReady}
          initPoint={paymentSession?.data?.init_point as string | undefined}
          data-testid={dataTestId}
        />
      )
    case isManual(paymentSession?.provider_id):
      return (
        <ManualTestPaymentButton notReady={notReady} data-testid={dataTestId} />
      )
    default:
      return <Button disabled>Selecciona un método de pago</Button>
  }
}

// Coral brand override for the final place-order CTA (visual only). Reuses the
// shared CORAL_CTA constant so the coral surface stays identical to every other
// checkout CTA.
const PLACE_ORDER_CTA = CORAL_CTA

/**
 * `StripePaymentButton` and its `case isStripeLike(...)` dispatch arm were
 * deleted here (task 2c.6, pulled forward into PR1b).
 *
 * It could not stay: `payment-wrapper/stripe-wrapper.tsx` was deleted in the
 * same PR (1b.18), so no `<Elements>` provider is mounted anywhere in the app.
 * `useStripe()` and `useElements()` THROW outside that provider, so the
 * component would have crashed on mount rather than merely misbehaving. A
 * half-removed integration is strictly worse than either finishing or not
 * starting.
 *
 * It was already unreachable per `design.md` §0 CONFLICT-1 RESOLUTION:
 * `apps/backend/medusa-config.ts` registers exactly two payment providers,
 * `openpay` and `mercadopago`, and `listCartPaymentMethods` is backend-driven
 * (`lib/data/payment.ts:16`), so `isStripeLike` can never match a real provider
 * id. Deleting it also let `@stripe/react-stripe-js` and `@stripe/stripe-js`
 * leave `package.json` (task 2c.13, likewise pulled forward) — this file held
 * the last source import of either package.
 *
 * `isStripeLike` itself STAYS exported from `lib/constants.tsx`: it still has a
 * live caller outside checkout at `modules/order/components/payment-details/
 * index.tsx:43`, which is out of scope for this change (task 2c.14).
 */
const OpenpayPaymentButton = ({
  notReady,
  "data-testid": dataTestId,
}: {
  notReady: boolean
  "data-testid"?: string
}) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handlePayment = async () => {
    setSubmitting(true)
    setErrorMessage(null)

    try {
      // On success placeOrder redirects to the order confirmation page.
      await placeOrder()
    } catch (err) {
      // NEVER key this decision off the error message wording (design R1
      // mitigation): re-fetch the cart and inspect the payment session state.
      // A 3DS challenge surfaces as status "requires_more" with a
      // redirect_url provided by the payment provider (OP-4).
      const updatedCart = await retrieveCart().catch(() => null)
      const session = updatedCart?.payment_collection?.payment_sessions?.find(
        (s) => isOpenpay(s.provider_id)
      )
      const redirectUrl =
        session?.status === "requires_more"
          ? (session.data?.redirect_url as string | undefined)
          : undefined

      if (redirectUrl) {
        // Keep the button in its loading state while the browser navigates
        // to the bank's 3DS challenge page.
        window.location.href = redirectUrl
        return
      }

      // Declined or other provider error — the cart stays intact and the
      // order remains retryable from the review step (OP-3).
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button
        disabled={notReady}
        onClick={handlePayment}
        size="large"
        className={PLACE_ORDER_CTA}
        isLoading={submitting}
        data-testid={dataTestId}
      >
        Realizar pedido
      </Button>
      <ErrorMessage
        error={errorMessage}
        data-testid="openpay-payment-error-message"
      />
    </>
  )
}

const MercadoPagoPaymentButton = ({
  notReady,
  initPoint,
  "data-testid": dataTestId,
}: {
  notReady: boolean
  initPoint?: string
  "data-testid"?: string
}) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handlePayment = () => {
    setSubmitting(true)
    setErrorMessage(null)

    // Checkout Pro is a hosted redirect: the order is NOT completed here. The
    // customer pays on MP's page and returns via a back_url; the webhook is the
    // source of truth for confirmation (MP-3/MP-4). Keep the button loading
    // while the browser navigates to MP.
    if (!initPoint) {
      setErrorMessage(
        "Mercado Pago is not ready yet. Please go back and re-select it."
      )
      setSubmitting(false)
      return
    }

    window.location.href = initPoint
  }

  return (
    <>
      <Button
        disabled={notReady}
        onClick={handlePayment}
        size="large"
        className={PLACE_ORDER_CTA}
        isLoading={submitting}
        data-testid={dataTestId}
      >
        Pagar con Mercado Pago
      </Button>
      <ErrorMessage
        error={errorMessage}
        data-testid="mercadopago-payment-error-message"
      />
    </>
  )
}

const ManualTestPaymentButton = ({ notReady }: { notReady: boolean }) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const onPaymentCompleted = async () => {
    await placeOrder()
      .catch((err) => {
        setErrorMessage(err.message)
      })
      .finally(() => {
        setSubmitting(false)
      })
  }

  const handlePayment = () => {
    setSubmitting(true)

    onPaymentCompleted()
  }

  return (
    <>
      <Button
        disabled={notReady}
        isLoading={submitting}
        onClick={handlePayment}
        size="large"
        className={PLACE_ORDER_CTA}
        data-testid="submit-order-button"
      >
        Realizar pedido
      </Button>
      <ErrorMessage
        error={errorMessage}
        data-testid="manual-payment-error-message"
      />
    </>
  )
}

export default PaymentButton

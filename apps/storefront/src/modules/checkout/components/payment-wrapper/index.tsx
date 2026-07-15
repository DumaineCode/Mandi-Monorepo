"use client"

import { loadStripe } from "@stripe/stripe-js"
import React from "react"
import StripeWrapper from "./stripe-wrapper"
import OpenpayWrapper, { type OpenpayPublicConfig } from "./openpay-wrapper"
import { HttpTypes } from "@medusajs/types"
import { isOpenpay, isStripeLike } from "@lib/constants"

type PaymentWrapperProps = {
  cart: HttpTypes.StoreCart
  /**
   * Non-secret Openpay config fetched at runtime from the checkout server
   * component (GET /store/provider-config). `null` → Openpay card payments
   * degrade gracefully (disabled) while the rest of checkout keeps working.
   */
  openpayConfig?: OpenpayPublicConfig | null
  children: React.ReactNode
}

const stripeKey =
  process.env.NEXT_PUBLIC_STRIPE_KEY ||
  process.env.NEXT_PUBLIC_MEDUSA_PAYMENTS_PUBLISHABLE_KEY

const medusaAccountId = process.env.NEXT_PUBLIC_MEDUSA_PAYMENTS_ACCOUNT_ID
const stripePromise = stripeKey
  ? loadStripe(
      stripeKey,
      medusaAccountId ? { stripeAccount: medusaAccountId } : undefined
    )
  : null

const PaymentWrapper: React.FC<PaymentWrapperProps> = ({
  cart,
  openpayConfig,
  children,
}) => {
  const paymentSession = cart.payment_collection?.payment_sessions?.find(
    (s) => s.status === "pending"
  )

  if (isOpenpay(paymentSession?.provider_id) && paymentSession) {
    return <OpenpayWrapper config={openpayConfig}>{children}</OpenpayWrapper>
  }

  if (
    isStripeLike(paymentSession?.provider_id) &&
    paymentSession &&
    stripePromise
  ) {
    return (
      <StripeWrapper
        paymentSession={paymentSession}
        stripeKey={stripeKey}
        stripePromise={stripePromise}
      >
        {children}
      </StripeWrapper>
    )
  }

  return <div>{children}</div>
}

export default PaymentWrapper

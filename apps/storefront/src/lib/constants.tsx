import { CreditCard } from "@medusajs/icons"
import {
  CardBrandLogos,
  MercadoPagoLogo,
} from "@modules/checkout/components/payment-logos"
import Bancontact from "@modules/common/icons/bancontact"
import Ideal from "@modules/common/icons/ideal"
import PayPal from "@modules/common/icons/paypal"
import React from "react"

export type PaymentInfo = {
  title: string
  icon: React.JSX.Element
  /**
   * Optional trust line rendered under the row title. Use it to name the
   * processor behind a method (e.g. who actually handles the card data), never
   * to claim certifications that aren't ours.
   */
  caption?: string
}

/* Map of payment provider_id to their title and icon. Add in any payment providers you want to use. */
export const paymentInfoMap: Record<string, PaymentInfo> = {
  pp_stripe_stripe: {
    title: "Credit card",
    icon: <CreditCard />,
  },
  "pp_medusa-payments_default": {
    title: "Credit card",
    icon: <CreditCard />,
  },
  "pp_stripe-ideal_stripe": {
    title: "iDeal",
    icon: <Ideal />,
  },
  "pp_stripe-bancontact_stripe": {
    title: "Bancontact",
    icon: <Bancontact />,
  },
  pp_paypal_paypal: {
    title: "PayPal",
    icon: <PayPal />,
  },
  pp_system_default: {
    title: "Manual Payment",
    icon: <CreditCard />,
  },
  // NOTE: provider id literals below are duplicated in
  // apps/backend/src/lib/constants.ts (OPENPAY_PROVIDER_ID / MERCADOPAGO_PROVIDER_ID).
  // Keep both files in sync — the backend contract test asserts the composed ids.
  pp_openpay_openpay: {
    title: "Tarjeta de crédito/débito",
    icon: <CardBrandLogos />,
    caption: "Procesado por Openpay · BBVA",
  },
  pp_mercadopago_mercadopago: {
    title: "Mercado Pago",
    icon: <MercadoPagoLogo />,
  },
  // Add more payment providers here
}

// This only checks if it is native stripe or medusa payments for card payments, it ignores the other stripe-based providers
export const isStripeLike = (providerId?: string) => {
  return (
    providerId?.startsWith("pp_stripe_") || providerId?.startsWith("pp_medusa-")
  )
}

export const isPaypal = (providerId?: string) => {
  return providerId?.startsWith("pp_paypal")
}
export const isManual = (providerId?: string) => {
  return providerId?.startsWith("pp_system_default")
}

export const isOpenpay = (providerId?: string) => {
  return providerId?.startsWith("pp_openpay_")
}

export const isMercadopago = (providerId?: string) => {
  return providerId?.startsWith("pp_mercadopago_")
}

// Add currencies that don't need to be divided by 100
export const noDivisionCurrencies = [
  "krw",
  "jpy",
  "vnd",
  "clp",
  "pyg",
  "xaf",
  "xof",
  "bif",
  "djf",
  "gnf",
  "kmf",
  "mga",
  "rwf",
  "xpf",
  "htg",
  "vuv",
  "xag",
  "xdr",
  "xau",
]

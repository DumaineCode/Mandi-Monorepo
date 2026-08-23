import {
  isManualProviderId,
  isMercadopagoProviderId,
  isOpenpayProviderId,
} from "@lib/util/checkout-readiness"
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
/**
 * The `pp_stripe_*` and `pp_medusa-*` entries below are KEPT deliberately
 * (task 2c.14 / RC-4). `design.md` §0 authorises removing them "once it has no
 * callers", and that condition is unmet: `modules/order/components/
 * payment-details/index.tsx:31,40,43` still reads this map and `isStripeLike`
 * for a placed order's payment row, which is outside this change's scope. The
 * checkout no longer references either. Follow-up: drop both once the order
 * module stops reading them.
 */
export const paymentInfoMap: Record<string, PaymentInfo> = {
  pp_stripe_stripe: {
    title: "Tarjeta de crédito",
    icon: <CreditCard />,
  },
  "pp_medusa-payments_default": {
    title: "Tarjeta de crédito",
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
    title: "Pago manual",
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
    /**
     * The off-site warning, and it is not decoration.
     *
     * This tail does not call `placeOrder`: it navigates the browser to
     * `init_point`, a hosted Checkout Pro page on another origin. Openpay's row
     * shows its card fields inline, so that customer can see what they are
     * getting; this row had a title, a logo and nothing else, so pressing a
     * button labelled *Realizar pedido* silently sent the customer to a
     * different site — the single most alarming thing a checkout can do to
     * someone about to pay.
     */
    caption: "Continúas en el sitio de Mercado Pago para completar tu pago",
  },
  // Add more payment providers here
}

// This only checks if it is native stripe or medusa payments for card payments, it ignores the other stripe-based providers
/**
 * KEPT (task 2c.14 / RC-4). One live caller remains, outside checkout:
 * `modules/order/components/payment-details/index.tsx:43`. Zero callers in
 * `modules/checkout` after PR2c. Follow-up: delete with the map entries above.
 */
export const isStripeLike = (providerId?: string) => {
  return (
    providerId?.startsWith("pp_stripe_") || providerId?.startsWith("pp_medusa-")
  )
}

export const isPaypal = (providerId?: string) => {
  return providerId?.startsWith("pp_paypal")
}
export const isManual = (providerId?: string) => {
  return isManualProviderId(providerId)
}

/**
 * Delegates to the pure module rather than repeating the prefix.
 *
 * `checkout-readiness.ts` needs this predicate for the `card_details` rule and
 * cannot import this file: this is a `.tsx` carrying JSX icon elements, and
 * pulling it in would drag React into a module whose purity is the only reason
 * it can be tested under `environment: "node"`. So the dependency points the
 * other way and there is still exactly one definition of what "is Openpay"
 * means. A second copy here is how the CTA's card-details rule and the card
 * form's own provider check would drift apart.
 */
export const isOpenpay = (providerId?: string) => {
  return isOpenpayProviderId(providerId)
}

export const isMercadopago = (providerId?: string) => {
  return isMercadopagoProviderId(providerId)
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

"use client"

import { isOpenpayOffered } from "@lib/util/checkout-readiness"
import type { HttpTypes } from "@medusajs/types"
import React from "react"
import OpenpayWrapper, { type OpenpayPublicConfig } from "./openpay-wrapper"

type PaymentWrapperProps = {
  /**
   * Non-secret Openpay config fetched at runtime from the checkout server
   * component (GET /store/provider-config). `null` → Openpay card payments
   * degrade gracefully (disabled) while the rest of checkout keeps working.
   */
  openpayConfig?: OpenpayPublicConfig | null
  /**
   * The payment providers the backend actually offers for this cart's region,
   * from `listCartPaymentMethods`. `null` means the lookup failed.
   */
  availablePaymentMethods?: HttpTypes.StorePaymentProvider[] | null
  children: React.ReactNode
}

/**
 * Mounts the Openpay browser SDK from PROVIDER CONFIGURATION plus REGIONAL
 * AVAILABILITY, not from an existing payment session (C1, `design.md` D5).
 *
 * ## Two conditions, deliberately
 *
 * Provider config answers "does this merchant have Openpay keys"; the available
 * payment methods answer "is Openpay purchasable on this cart". The SDK mounts
 * only when both are true, because mounting it starts device fingerprinting
 * (see the gate in the body). An earlier version of this component gated on the
 * config alone and would fingerprint visitors in regions where Openpay had been
 * turned off in the backend.
 *
 * ## Why the inversion is required, not preferred
 *
 * Under R5 no payment session exists until the customer clicks the final CTA.
 * The previous implementation chose its wrapper by looking for a `pending`
 * session on `cart.payment_collection.payment_sessions`, so under R5 it would
 * find nothing, mount nothing, and the card fields would never be able to
 * tokenize. The session is an OUTCOME of the customer's choice; it cannot also
 * be the input that decides what to render.
 *
 * Mounting without a session is verified safe (`explore §6`): `OpenpayWrapper`
 * reads no session data at all. It loads two scripts at
 * `strategy="lazyOnload"`, then runs `setId` / `setApiKey` / `setSandboxMode`
 * and `deviceData.setup()`.
 *
 * ## `deviceSessionId` timing — better than before, and still the QA risk
 *
 * `deviceSessionId` is produced by `handleDataScriptLoaded` at script load.
 * Under the old design that could not happen until an Openpay session existed,
 * i.e. at the payment step. Now it happens at page load, minutes before the CTA,
 * so the CTA-time read is *more* likely to find it populated. `lazyOnload` still
 * defers past hydration, so a cold load on a throttled connection is the case
 * QA must confirm (task 1b.26), and the place-order flow must fail with a clear
 * message rather than initiating with `device_session_id: null`.
 *
 * ## No Stripe branch
 *
 * Deleted, not disabled. Per `design.md` §0 CONFLICT-1 RESOLUTION,
 * `apps/backend/medusa-config.ts` registers exactly two payment providers —
 * `openpay` and `mercadopago` — and there is no `stripe` dependency in
 * `apps/backend/package.json`. `listCartPaymentMethods` is backend-driven
 * (`lib/data/payment.ts:16`), so it can never return a Stripe-like provider id
 * and the branch was unreachable code inherited from the Medusa starter, while
 * still shipping `@stripe/*` into the bundle. The one behaviour it had that the
 * others did not — requiring a `client_secret` and THROWING without one
 * (`stripe-wrapper.tsx:39-43`) — is exactly what made R5 look impossible to
 * apply universally. With it gone, R5 needs no provider carve-out.
 *
 * If Stripe is ever enabled server-side, reintroducing it is a fresh,
 * self-contained change against a checkout that no longer has to keep a dead
 * branch alive.
 */
const PaymentWrapper: React.FC<PaymentWrapperProps> = ({
  openpayConfig,
  availablePaymentMethods,
  children,
}) => {
  /**
   * BOTH conditions are required, and the second one is not a formality.
   *
   * `openpayConfig` only says the merchant HAS Openpay keys — it is served by
   * `GET /store/provider-config`, which knows nothing about this cart. Whether
   * Openpay is actually purchasable here is a different question, answered by
   * `listCartPaymentMethods` against the cart's region.
   *
   * Gating on the config alone conflated the two, and the consequence was not
   * cosmetic: mounting `OpenpayWrapper` loads `openpay-data.v1.min.js` and runs
   * `deviceData.setup()`, which is a device-fingerprinting collector. Disable
   * Openpay for a region in the backend and every visitor to that region's
   * checkout would still be fingerprinted by a payment processor they are not
   * being offered and cannot choose. Collecting device data for a provider that
   * is not on offer has no purchase to justify it.
   *
   * `undefined`/`null` methods (the lookup failed) do NOT mount. That is
   * deliberate: absence of evidence that Openpay is offered is not evidence
   * that it is, and the failure is already surfaced by `CheckoutForm`, which
   * refuses to render the form at all when this list is `null`. There is no
   * state in which the wrapper is the right place to guess.
   */
  const openpayOffered = isOpenpayOffered(availablePaymentMethods)

  /**
   * `configMissing` short-circuit preserved: `getProviderConfig` returns
   * `{ openpay: null }` rather than throwing on any failure
   * (`provider-config.ts:83-89`), and `OpenpayWrapper` degrades to `unavailable`
   * when merchantId/publicKey are absent.
   */
  if (openpayConfig && openpayOffered) {
    return <OpenpayWrapper config={openpayConfig}>{children}</OpenpayWrapper>
  }

  return <div>{children}</div>
}

export default PaymentWrapper

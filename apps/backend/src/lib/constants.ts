/**
 * Provider identifiers and composed runtime provider ids (design section 2).
 *
 * Medusa 2.x runtime id composition:
 * - Payment providers register as `pp_${class static identifier}_${config id}`
 *   (see @medusajs/payment loaders/providers registrationFn).
 * - Fulfillment providers register as `${class static identifier}_${config id}`
 *   (e.g. the starter's `manual_manual`).
 *
 * CROSS-REFERENCE: apps/storefront/src/lib/constants.tsx keys its
 * `paymentInfoMap` on these exact literals (`pp_openpay_openpay`,
 * `pp_mercadopago_mercadopago`). If an identifier or config id changes here,
 * the storefront map and predicates MUST change with it. The contract test in
 * src/lib/__tests__/provider-ids.unit.spec.ts pins the documented literals.
 */

/** `static identifier` of the Openpay payment provider class (slice S2). */
export const OPENPAY_IDENTIFIER = "openpay"

/** `static identifier` of the Mercado Pago payment provider class (slice S4). */
export const MERCADOPAGO_IDENTIFIER = "mercadopago"

/** `static identifier` of the Skydropx fulfillment provider class (slice S5). */
export const SKYDROPX_IDENTIFIER = "skydropx"

/** Runtime payment provider id exposed to carts/regions and the storefront. */
export const OPENPAY_PROVIDER_ID =
  `pp_${OPENPAY_IDENTIFIER}_${OPENPAY_IDENTIFIER}` as const

/** Runtime payment provider id exposed to carts/regions and the storefront. */
export const MERCADOPAGO_PROVIDER_ID =
  `pp_${MERCADOPAGO_IDENTIFIER}_${MERCADOPAGO_IDENTIFIER}` as const

/** Runtime fulfillment provider id (no `pp_` prefix for fulfillment). */
export const SKYDROPX_PROVIDER_ID =
  `${SKYDROPX_IDENTIFIER}_${SKYDROPX_IDENTIFIER}` as const

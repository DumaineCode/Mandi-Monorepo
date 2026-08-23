/**
 * Turning an Openpay failure into something a customer may read.
 *
 * ## The leak this closes
 *
 * `translateApiError` built `Openpay error 3001: The card was declined` and
 * `mapChargeToAuthorizeOutput` built `Openpay charge trq… is failed: …`. Medusa
 * puts a `PAYMENT_AUTHORIZATION_ERROR` message on the cart-completion response
 * body, and the storefront's `messageFrom` passes an `Error.message` through
 * verbatim — so both of those strings were being READ BY SHOPPERS, in English,
 * with an internal error number in them, at the most abandonment-sensitive
 * moment in the funnel.
 *
 * ## Why this emits a token and not the Spanish
 *
 * Every other sentence the checkout says lives in the storefront's own
 * catalogues, where that app's specs sweep them for register, language and
 * voseo. Putting customer copy here would create a second home for it in a
 * second repository with a different test suite — the drift this codebase spends
 * most of its docstrings preventing.
 *
 * So the split follows the seam that already exists. THIS layer is the only one
 * holding a structured `error_code`, so it classifies. The STOREFRONT owns the
 * wording. The wire between them is a closed set of identifiers, and an
 * identifier the storefront does not recognise falls to its generic apology —
 * so a token added here without a sentence there degrades, it does not break.
 *
 * ## What must never appear in the returned message
 *
 * The numeric code, the provider's English description, the charge id, and the
 * card's fate. All four are logged; none is transmitted. See
 * {@link classifyOpenpayFailure} for the card-testing-oracle argument behind the
 * last of those.
 */

/** Shared with the storefront's `lib/util/place-order.ts`. Do not rename. */
export const PAYMENT_FAILURE_PREFIX = "payment_failed:"

export type PaymentFailureToken =
  | "card_declined"
  | "insufficient_funds"
  | "card_expired"
  | "invalid_card_number"
  | "invalid_cvv"
  | "missing_cvv"
  | "three_ds_failed"
  | "card_not_supported"
  | "bank_authorization_required"
  | "retry_limit_reached"
  | "amount_not_allowed"
  | "duplicate_order"
  | "processor_unavailable"
  | "merchant_config"

/**
 * Openpay `error_code` to token.
 *
 * Sourced from Openpay's published catalogue (`documents.openpay.mx/docs/errors`)
 * and cross-checked against `open-pay/openpay-woocommerce` and
 * `open-pay/openpay-prestashop`, which are Openpay's own integrations and
 * therefore the best available evidence of intended shopper-facing behaviour.
 *
 * ## Four decline codes deliberately share one token
 *
 * `3001` (declined by bank), `3004` (reported stolen), `3005` (anti-fraud /
 * blacklist) and `3007` (undocumented, present only in the plugins) all map to
 * `card_declined`, exactly as both Openpay plugins do. Distinguishing them for
 * the shopper would publish the anti-fraud verdict: someone testing stolen PANs
 * would learn from the wording which numbers are already flagged, which is the
 * one signal the system exists to withhold. The real code goes to the log.
 *
 * ## `4001` is not the shopper's problem
 *
 * It reads "not enough funds in the openpay account" and refers to the
 * MERCHANT's balance. It maps to `merchant_config`, never to
 * `insufficient_funds` — a shopper with a funded card must not be told their
 * card is empty because our account is. `3003` is the only card-funds code.
 *
 * ## Absent on purpose
 *
 * `2001`/`2002`/`2003` (already-registered resources) and the `32xx` promotion
 * codes are unreachable on this integration: charges are one-shot with a
 * single-use token and no stored cards or MSI plans. They would fall through to
 * `null` and be reported as a generic decline, which is the correct answer for
 * a condition we do not understand.
 */
const TOKENS_BY_ERROR_CODE: Readonly<Record<number, PaymentFailureToken>> = {
  // --- Generales -----------------------------------------------------------
  1000: "processor_unavailable",
  1001: "merchant_config",
  1002: "merchant_config",
  1003: "merchant_config",
  1004: "processor_unavailable",
  1006: "duplicate_order",
  1007: "card_declined",
  1008: "merchant_config",
  1010: "merchant_config",
  1012: "amount_not_allowed",
  1014: "merchant_config",
  1015: "processor_unavailable",
  1017: "processor_unavailable",
  1018: "retry_limit_reached",
  1020: "merchant_config",
  1023: "merchant_config",
  1024: "amount_not_allowed",

  // --- Tarjeta: validación -------------------------------------------------
  2004: "invalid_card_number",
  2005: "card_expired",
  2006: "missing_cvv",
  2007: "card_not_supported",
  2009: "invalid_cvv",
  2010: "three_ds_failed",
  2011: "card_not_supported",

  // --- Tarjeta: declinaciones ----------------------------------------------
  3001: "card_declined",
  3002: "card_expired",
  3003: "insufficient_funds",
  3004: "card_declined",
  3005: "card_declined",
  3006: "card_declined",
  3007: "card_declined",
  3008: "card_not_supported",
  3009: "card_declined",
  3010: "card_declined",
  3011: "card_declined",
  3012: "bank_authorization_required",

  // --- Cuenta del comercio -------------------------------------------------
  4001: "merchant_config",
  4002: "merchant_config",
}

/**
 * The token for an Openpay `error_code`, or `null` when we have no opinion.
 *
 * `null` and `"card_declined"` are different answers and the caller must keep
 * them apart: the first means "unrecognised", which the storefront renders as a
 * generic apology, and the second is a positive statement about the card. A
 * code we have never seen is not evidence that a card is bad.
 *
 * Accepts the union Openpay actually sends — the field is documented as a
 * number but arrives as a string from some endpoints — and refuses anything
 * that is not a clean integer rather than letting `Number("")`'s `0` or `NaN`
 * index the table.
 */
export function classifyOpenpayFailure(
  errorCode: number | string | undefined | null
): PaymentFailureToken | null {
  if (typeof errorCode !== "number" && typeof errorCode !== "string") {
    return null
  }

  const parsed =
    typeof errorCode === "number" ? errorCode : Number(errorCode.trim())

  if (!Number.isInteger(parsed)) {
    return null
  }

  return TOKENS_BY_ERROR_CODE[parsed] ?? null
}

/**
 * The customer-safe message for a failure, ready to hand to `MedusaError`.
 *
 * An unclassified failure becomes `payment_failed:card_declined` rather than
 * being passed through. That is the whole point of the function: the default
 * has to be a SENTENCE THE STOREFRONT OWNS, because the alternative default —
 * the provider's own text — is the leak this module exists to close, and it is
 * the one that comes back the moment somebody adds a new throw site and forgets.
 *
 * `card_declined` rather than `processor_unavailable` for that default because
 * an unknown failure at authorization time most often IS a decline, and its
 * copy ("intenta con otra o comunícate con tu banco") is actionable and true
 * regardless — whereas promising the shopper it is temporary and asking them to
 * wait would be a guess that wastes their time.
 */
export function toPaymentFailureMessage(
  token: PaymentFailureToken | null
): string {
  return `${PAYMENT_FAILURE_PREFIX}${token ?? "card_declined"}`
}

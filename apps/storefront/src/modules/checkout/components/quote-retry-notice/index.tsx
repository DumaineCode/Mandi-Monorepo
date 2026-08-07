"use client"

import {
  useCheckoutActions,
  useCheckoutState,
} from "@modules/checkout/state/checkout-context"
import { selectQuoteStatus } from "@modules/checkout/state/checkout-reducer"
import { Button, Text } from "@modules/common/components/ui"

/**
 * The way out of a failed shipping quote (C4).
 *
 * ## Why this is a blocker and not a PR2b concern
 *
 * `QUOTE_RETRY` existed in the reducer with ZERO dispatchers anywhere outside
 * `state/`. `selectQuoteIsBlockedByFailure` parks the requote effect for as long
 * as a failure is recorded against the CURRENT signature, and clearing
 * `failedSignature` is only possible two ways: dispatch `QUOTE_RETRY`, or change
 * a quote-relevant field. So a single transient carrier error left the customer
 * with no prices, no options and no way to ask again — short of editing their own
 * correct address into something else and back.
 *
 * That state is reachable in THIS PR, which is what separates it from
 * `SELECT_SHIPPING_OPTION`, `SELECT_PAYMENT_PROVIDER`,
 * `SET_PAYMENT_DETAILS_COMPLETE` and `SET_ERROR` — those are also unconsumed, but
 * nothing here can enter them yet. It was reachable by two routes: a genuine
 * Skydropx failure, and a `CART_WRITE_FAILED` from the concurrent-write conflict
 * B1 introduced, which the requote effect converts straight into `QUOTE_FAILED`.
 *
 * ## Deliberately minimal
 *
 * PR2b replaces the whole Envío section with `shipping-section`, which renders all
 * six quote states properly and will absorb this. Until then this is the smallest
 * thing that removes the dead end: it renders only in `failed`, and it is the only
 * component in PR2a that reads `selectQuoteStatus`.
 *
 * `not_serviceable` deliberately does NOT render this. An address the carrier
 * genuinely does not serve is a real answer, and offering "try again" for it would
 * be a lie that costs a live carrier quote per press.
 */
const QuoteRetryNotice = () => {
  const state = useCheckoutState()
  const { dispatch } = useCheckoutActions()

  if (selectQuoteStatus(state) !== "failed") {
    return null
  }

  return (
    <div
      className="flex flex-col gap-y-3 rounded-large border border-line bg-cream p-6"
      // `polite` and not `assertive`: this appears while the customer may still
      // be typing in Datos, and must not interrupt them mid-field.
      role="status"
      aria-live="polite"
      data-testid="quote-retry-notice"
    >
      <Text className="txt-medium text-ink">
        No pudimos calcular el costo de envío para tu dirección.
      </Text>
      <Text className="txt-small text-ink-muted">
        Puede ser algo temporal de la paquetería. Tu dirección y tu carrito están
        guardados.
      </Text>
      <Button
        variant="secondary"
        size="small"
        className="w-fit rounded-large border-line"
        onClick={() => dispatch({ type: "QUOTE_RETRY" })}
        data-testid="quote-retry-button"
      >
        Intentar de nuevo
      </Button>
    </div>
  )
}

export default QuoteRetryNotice

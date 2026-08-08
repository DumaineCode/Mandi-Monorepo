"use client"

import { Radio, RadioGroup } from "@headlessui/react"
import { setShippingMethod } from "@lib/data/cart"
import { convertToLocale } from "@lib/util/money"
import ErrorMessage from "@modules/checkout/components/error-message"
import {
  useCheckoutActions,
  useCheckoutCart,
  useCheckoutState,
} from "@modules/checkout/state/checkout-context"
import {
  selectCarrierRatesUnavailable,
  selectQuoteStatus,
  selectShippingChoices,
  type ShippingChoice,
} from "@modules/checkout/state/checkout-reducer"
import { Button, clx, Heading, Text } from "@modules/common/components/ui"
import { useState } from "react"

/**
 * "Envío" — the quotation lifecycle, rendered.
 *
 * ## One section, six states — not six screens
 *
 * The spec requires exactly one of `idle | looking_up | quoting | quoted |
 * not_serviceable | failed` to be on screen, and always one. The frame around
 * them — the card, the heading, the vertical mass — is deliberately CONSTANT, and
 * only the body swaps. A customer typing a postal code moves through three of
 * these states in under two seconds; if each one re-laid-out the page, the
 * section would read as a component that keeps breaking rather than one that is
 * working.
 *
 * There is no subtitle under the heading for the same reason. A standing line
 * like "elige cómo quieres recibir tu pedido" is false in four of the six states,
 * so the question is asked where it is true — directly above the radios.
 *
 * ## Every rule this section obeys lives somewhere it can be tested
 *
 * This file is a `.tsx`, and this repo's harness is node-only: no jsdom, no
 * `@testing-library`, Playwright an explicit non-goal. So a decision left in here
 * is a decision nothing can contradict — which is how the component this replaces
 * shipped a free-shipping option rendered as `-`, and prices from a superseded
 * postal code left on screen looking current.
 *
 * The three that matter are therefore elsewhere and asserted:
 *
 * - which of the six states we are in → `selectQuoteStatus`;
 * - which rows exist, what each costs and whether it can be picked →
 *   `selectShippingChoices`, which returns NOTHING unless the prices in hand were
 *   quoted for the address currently on screen;
 * - `failed` vs `not_serviceable` → `classifyQuoteResult`, consumed by the
 *   requote effect.
 *
 * What is left here is markup and one server call.
 *
 * ## Replaces `components/shipping` and absorbs `components/quote-retry-notice`
 *
 * The former was the four-step delivery step: it read `?step=delivery` to decide
 * whether to render at all, pushed `?step=payment` on submit, and seeded its
 * checked radio from `cart.shipping_methods` — which is the specific mistake that
 * defeats settled decision 1, because per finding F1 that row SURVIVES the
 * invalidation. The latter was PR2a's minimal escape hatch from a `failed` quote
 * and said in its own docstring that this component would absorb it; keeping both
 * would mean two components rendering the same state with different words.
 */

/** Pickup is not modelled: no fulfilment set in this deployment is of type
 * `pickup` (`apps/backend/src/migration-scripts/initial-data-seed.ts` creates one
 * shipping set). The component this replaces carried a whole second radio group,
 * a store-address formatter and a mode toggle for it, all of which rendered for
 * nobody. Re-introducing pickup is a product decision with its own copy and its
 * own "choose a store" step; it is not a line this file should be carrying
 * speculatively. Any option the backend does return is rendered here as an
 * ordinary row. */

const ROW =
  "flex w-full items-center justify-between gap-x-4 rounded-large border px-5 py-4 text-left transition-colors motion-reduce:transition-none"

/**
 * A body that is not the option list. Every one of them sits in the same inset
 * panel at the same height, so the section keeps its shape while the customer
 * types and the page below it does not jump.
 */
const StateMessage = ({
  title,
  detail,
  action,
  testId,
}: {
  title: string
  detail?: string
  action?: React.ReactNode
  testId: string
}) => (
  <div
    className="flex min-h-[7.5rem] flex-col justify-center gap-y-2 rounded-large border border-line bg-cream px-5 py-6"
    data-testid={testId}
  >
    <Text className="txt-medium text-ink">{title}</Text>
    {detail && <Text className="txt-small text-ink-muted">{detail}</Text>}
    {action}
  </div>
)

/**
 * The `quoting` body. Deliberately shows the SHAPE of the answer and none of its
 * content: the spec forbids leaving previously quoted prices visible as if they
 * were current, and `selectShippingChoices` has already made that impossible by
 * returning nothing. This is what fills the space it left.
 */
const QuotingRows = () => (
  <div
    className="flex min-h-[7.5rem] flex-col gap-y-2"
    data-testid="shipping-quoting"
  >
    {[0, 1].map((row) => (
      <div
        key={row}
        className={clx(ROW, "border-line bg-cream/60")}
        aria-hidden="true"
      >
        <span className="h-4 w-40 animate-pulse rounded bg-cream-muted motion-reduce:animate-none" />
        <span className="h-4 w-20 animate-pulse rounded bg-cream-muted motion-reduce:animate-none" />
      </div>
    ))}
  </div>
)

const ShippingSection = () => {
  const state = useCheckoutState()
  const { cart } = useCheckoutCart()
  const { dispatch, nextWriteSequence } = useCheckoutActions()

  /**
   * The clicked option, held only while its write is open.
   *
   * The radio ticks off `pendingId ?? selectedShippingOptionId`, so the customer
   * gets immediate feedback, while the REDUCER only ever learns about a selection
   * that the server accepted. That asymmetry is the point: per finding F1 the POST
   * is what makes the choice real, and `selectedShippingOptionId` is what the CTA
   * predicate and the provisional-total rule read. An optimistic value written
   * into state would unblock the order button against a method the cart does not
   * have — and a failed write would then need a rollback path that has to get the
   * previous value right. Here the rollback is `setPendingId(null)`.
   */
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const status = selectQuoteStatus(state)
  const choices = selectShippingChoices(state)
  const carrierRatesUnavailable = selectCarrierRatesUnavailable(state)
  const currencyCode = cart?.currency_code ?? "mxn"
  const checkedId = pendingId ?? state.selectedShippingOptionId

  const handleSelect = async (optionId: string) => {
    if (!cart || optionId === state.selectedShippingOptionId) {
      return
    }

    setError(null)
    setPendingId(optionId)

    /**
     * Captured HERE, before the await, because this is the only moment that knows
     * which destination the price the customer just clicked belonged to. Reading
     * it after the round trip — or letting the reducer read its own
     * `quoteSignature` — records a selection made for the old postal code as
     * fresh for a new one the customer typed while the request was in the air.
     */
    const clickedSignature = state.quoteSignature

    /**
     * From the SAME counter every other cart write draws from, allocated before
     * the request goes out. The reducer applies a response only when nothing
     * newer has been issued, so an autosave that overtakes this one wins — which
     * is correct: per finding F2 that autosave's cart already carries this
     * shipping method, re-priced by the backend for the address it just wrote.
     *
     * Unlike PR2c's `syncCheckoutAddresses`, this does NOT need to go through
     * `checkout-write-scheduler`. What the scheduler serialises is concurrent
     * writers of the shipping ADDRESS, which is the `em.create` PII-destruction
     * path PR1a closed; `addShippingMethod` does not touch the address at all.
     */
    const sequence = nextWriteSequence()

    try {
      const updated = await setShippingMethod({
        cartId: cart.id,
        shippingMethodId: optionId,
      })

      dispatch({
        type: "SELECT_SHIPPING_OPTION",
        optionId,
        signature: clickedSignature,
      })
      dispatch({ type: "CART_UPDATED", cart: updated, sequence })
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : "No pudimos guardar el método de envío. Inténtalo de nuevo."
      )
    } finally {
      setPendingId(null)
    }
  }

  return (
    <section
      className="rounded-large border border-line bg-paper p-6 small:p-8"
      data-testid="shipping-section"
    >
      <Heading
        level="h2"
        className="mb-6 font-bricolage text-2xl text-ink"
        data-testid="shipping-heading"
      >
        Envío
      </Heading>

      {/*
       * One live region for the whole body. The customer moves through
       * `looking_up` → `quoting` → `quoted` without touching this section, so a
       * screen-reader user has to be told the prices arrived. `polite`, never
       * `assertive`: they are almost certainly still typing in Datos.
       */}
      <div
        role="status"
        aria-live="polite"
        aria-busy={status === "looking_up" || status === "quoting"}
        data-testid="shipping-status"
        data-status={status}
      >
        {status === "idle" && (
          <StateMessage
            testId="shipping-idle"
            title="Ingresa tu código postal y elige tu colonia para ver las opciones y el costo de envío."
          />
        )}

        {status === "looking_up" && (
          <StateMessage testId="shipping-looking-up" title="Buscando código postal…" />
        )}

        {status === "quoting" && <QuotingRows />}

        {status === "not_serviceable" && (
          /*
           * Settled decision 4: no fallback path. No manual-quote form, no
           * "contact us" link — there is no such channel in checkout today, and
           * offering one that does not exist is worse than the honest dead end.
           * No retry button either: an address the carrier does not serve is a
           * real answer, and re-asking costs a live carrier quote per press.
           */
          <StateMessage
            testId="shipping-not-serviceable"
            title="Todavía no llegamos a esa zona."
            detail="Prueba con otro código postal."
          />
        )}

        {status === "failed" && (
          /*
           * The copy does NOT send the customer back to their address, and the
           * second line says so outright.
           *
           * `failed` is reached two ways and the storefront cannot tell them
           * apart: a genuine carrier error, and the `MissingDimensionsError`
           * signature — a non-empty option list in which every calculated price
           * came back null because an item in the cart has no weight or no L/W/H
           * (`classifyQuoteResult`). The second is a CATALOGUE problem. Telling
           * that customer to check a postal code that was right all along sends
           * them to correct something they cannot correct, and re-typing it will
           * never help.
           *
           * The retry is still offered because the first cause is transient and
           * `QUOTE_RETRY` is the only way out of `failed` short of editing a
           * correct address into something else and back.
           */
          <StateMessage
            testId="shipping-failed"
            title="No pudimos calcular el envío de este pedido."
            detail="No es por tu dirección. Puede ser algo temporal de la paquetería, o un dato que le falta a un producto de tu carrito."
            action={
              <Button
                variant="secondary"
                size="small"
                className="mt-2 w-fit rounded-large border-line"
                onClick={() => dispatch({ type: "QUOTE_RETRY" })}
                data-testid="shipping-retry-button"
              >
                Intentar de nuevo
              </Button>
            }
          />
        )}

        {status === "quoted" && (
          <div className="flex flex-col gap-y-4">
            <Text className="txt-medium text-ink-muted">
              ¿Cómo quieres recibir tu pedido?
            </Text>

            {/*
             * S0 · MANUAL — the carrier-rates annotation. Orthogonal to the six
             * states (`selectCarrierRatesUnavailable`), it renders ABOVE an
             * otherwise-normal list when a calculated option came back without a
             * price. Fixed copy: the storefront cannot tell a timeout from a
             * no-coverage answer, so it never derives wording from an upstream
             * message. It MUST NOT blame the customer's address — the note points
             * at the carrier, and the list still sells whatever priced.
             *
             * No node harness covers this branch (a `.tsx`); verify visually.
             */}
            {carrierRatesUnavailable && (
              <Text
                className="txt-small rounded-large border border-line bg-cream px-4 py-3 text-ink-muted"
                data-testid="shipping-carrier-rates-unavailable"
              >
                Algunas tarifas de paquetería no están disponibles en este
                momento. Puedes elegir una de las opciones que sí aparecen.
              </Text>
            )}

            <RadioGroup
              /*
               * `""` and never `undefined` when nothing is chosen. Headless UI
               * falls back to its OWN internal selection the moment `value` is
               * undefined, and an uncontrolled radio group remembers the last row
               * the customer clicked — which would re-tick the option the reducer
               * just invalidated and quietly undo settled decision 1. An empty
               * string is controlled and matches no option id.
               */
              value={checkedId ?? ""}
              onChange={handleSelect}
              aria-label="Método de envío"
              className="flex min-h-[7.5rem] flex-col gap-y-2"
              data-testid="shipping-options"
            >
              {choices.map((choice) => (
                <ShippingOptionRow
                  key={choice.id}
                  choice={choice}
                  currencyCode={currencyCode}
                  pending={pendingId === choice.id}
                />
              ))}
            </RadioGroup>
          </div>
        )}
      </div>

      <ErrorMessage error={error} data-testid="shipping-error-message" />
    </section>
  )
}

const ShippingOptionRow = ({
  choice,
  currencyCode,
  pending,
}: {
  choice: ShippingChoice
  currencyCode: string
  pending: boolean
}) => (
  <Radio
    value={choice.id}
    disabled={!choice.selectable || pending}
    className={clx(
      ROW,
      // `group` so the indicator below can react to this row's `data-checked`.
      "group cursor-pointer border-line bg-paper hover:border-coral",
      "data-[checked]:border-coral data-[checked]:bg-coral/5",
      "data-[focus]:outline-none data-[focus]:ring-2 data-[focus]:ring-coral data-[focus]:ring-offset-2 data-[focus]:ring-offset-paper",
      "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60 data-[disabled]:hover:border-line"
    )}
    data-testid="shipping-option"
  >
    <span className="flex items-center gap-x-3">
      {/*
       * Decorative. `Radio` already carries `role="radio"` and the real
       * `aria-checked`, so the shared `common/components/radio` — a `<button
       * role="radio" aria-checked="true">` — must not go inside one: it nests an
       * interactive control in an option and hard-codes every row as checked.
       */}
      <span
        aria-hidden="true"
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-line bg-white group-data-[checked]:border-coral"
      >
        <span className="h-2 w-2 rounded-full bg-transparent group-data-[checked]:bg-coral" />
      </span>
      <span className="txt-medium text-ink">{choice.name}</span>
    </span>

    <span className="shrink-0 font-mono text-ink">
      {pending ? (
        <span className="txt-small text-ink-muted">Guardando…</span>
      ) : choice.amount !== null ? (
        convertToLocale({ amount: choice.amount, currency_code: currencyCode })
      ) : (
        /*
         * Not `-`, and not a zero. R3: an honest absence beats a placeholder
         * that reads as a price, and `0` is a real amount this store can quote.
         */
        <span className="txt-small text-ink-muted">No disponible</span>
      )}
    </span>
  </Radio>
)

export default ShippingSection

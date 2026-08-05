"use client"

import { HttpTypes } from "@medusajs/types"
import { Heading, Text } from "@modules/common/components/ui"
import { useCheckoutState } from "@modules/checkout/state/checkout-context"

import BillingAddress from "../billing_address"
import ShippingAddress from "../shipping-address"

/**
 * A quiet, inline record of what the autosave is doing.
 *
 * Deliberately unremarkable. It must never block typing, clear a field, move
 * focus or gate interaction — a failed autosave is a status, not a wall, and
 * the customer's next blur retries it. `aria-live="polite"` so a screen-reader
 * user hears it change without being interrupted mid-field.
 */
const AutosaveStatus = () => {
  const state = useCheckoutState()

  const label =
    state.autosaveStatus === "saving"
      ? "Guardando…"
      : state.autosaveStatus === "saved"
      ? "Guardado"
      : state.autosaveStatus === "error"
      ? "No pudimos guardar los últimos cambios."
      : ""

  return (
    <span
      role="status"
      aria-live="polite"
      className="txt-small text-ink-muted"
      data-testid="autosave-status"
    >
      {label}
    </span>
  )
}

/**
 * "Datos" — contact details, shipping address, and billing when it differs.
 *
 * ## Always visible, always interactive (R1)
 *
 * No `?step=`, no accordion, no summary-with-an-Editar-button, no
 * `pointer-events-none`, no gating `opacity-50`. The section this replaces
 * rendered as a read-only summary unless the URL said `?step=address`, which is
 * why a customer who wanted to correct a typo had to navigate. There is nothing
 * left to navigate to.
 *
 * ## No step number in the heading
 *
 * The three sections are not a sequence any more — the customer may fill them
 * in any order, and the CTA is the only gate (R8). Numbering them `01 / 02 / 03`
 * would encode an order the page no longer has, which is a decoration that
 * lies. The headings are short and parallel instead, so *Datos*, *Envío* and
 * *Pago* read as three places rather than three steps.
 */
const ContactAddressSection = ({
  customer,
}: {
  customer: HttpTypes.StoreCustomer | null
}) => {
  const state = useCheckoutState()

  return (
    <section
      className="rounded-large border border-line bg-paper p-6 small:p-8"
      data-testid="contact-address-section"
    >
      <div className="mb-6 flex flex-row items-baseline justify-between gap-x-4">
        <Heading
          level="h2"
          className="font-bricolage text-2xl text-ink"
          data-testid="contact-address-heading"
        >
          Datos
        </Heading>
        <AutosaveStatus />
      </div>

      <Text className="mb-6 txt-medium text-ink-muted">
        Te escribimos a este correo y enviamos tu pedido a esta dirección.
      </Text>

      <ShippingAddress customer={customer} />

      {!state.sameAsBilling && (
        <div className="mt-8">
          <Heading
            level="h3"
            className="pb-6 font-bricolage text-xl text-ink"
            data-testid="billing-address-heading"
          >
            Dirección de facturación
          </Heading>
          <BillingAddress />
        </div>
      )}
    </section>
  )
}

export default ContactAddressSection

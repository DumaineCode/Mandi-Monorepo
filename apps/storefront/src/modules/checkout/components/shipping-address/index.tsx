"use client"

import { HttpTypes } from "@medusajs/types"
import Checkbox from "@modules/common/components/checkbox"
import Input from "@modules/common/components/input"
import NativeSelect from "@modules/common/components/native-select"
import { Container } from "@modules/common/components/ui"
import { MX_PHONE_PATTERN, MX_PHONE_TITLE } from "@lib/util/phone"
import { COLONIA_OTHER, POSTAL_CODE_HINTS } from "@lib/util/address-form"
import {
  useCheckoutActions,
  useCheckoutState,
} from "@modules/checkout/state/checkout-context"
import type { AddressField } from "@modules/checkout/state/checkout-reducer"
import { useCheckoutHighlight } from "@modules/checkout/state/use-checkout-highlight"
import type { BillingRequiredField } from "@lib/util/checkout-readiness"
import React, { useMemo } from "react"
import AddressSelect from "../address-select"
import CountrySelect from "../country-select"
import { anchorProps } from "../field-anchor"

/**
 * The contact + shipping-address form. PURELY PRESENTATIONAL.
 *
 * ## What left this file, and why that is the change
 *
 * Everything that decided anything moved to `checkout-reducer.ts`:
 *
 * | Gone from here | Now |
 * |---|---|
 * | `buildShippingSignature` (`:33-45`) | `buildQuoteSignature`, four fields not six |
 * | `hydratedRef` (`:83`) | the reducer never overwrites the draft from a cart |
 * | `lastPrefetchedSignature` (`:90`) | `evaluateQuoteReadiness` |
 * | `AbortController` + `cancelled` + timer triad (`:307-370`) | one signature comparison in `QUOTE_READY` |
 * | the `address_1 && address_2` prefetch gate (`:296-305`) | **deleted outright** |
 *
 * That last row is R4, and it is the single change a customer will actually
 * feel: the old gate refused to quote until the customer had typed a street and
 * a colonia, neither of which Skydropx reads on the quote path. A postal code
 * alone is now enough.
 *
 * The reason this file is a husk is not tidiness. This repo has no jsdom, no
 * `@testing-library` and no Playwright, and adding them is an explicit non-goal
 * — so a rule left in a `.tsx` is a rule nothing verifies. Everything above is
 * now covered by `checkout-reducer.spec.ts`.
 *
 * Fields are UNCHANGED (R7). No field was added, removed, reordered or
 * restructured; only their wiring moved.
 */
const ShippingAddress = ({
  customer,
}: {
  customer: HttpTypes.StoreCustomer | null
}) => {
  const state = useCheckoutState()
  const { dispatch } = useCheckoutActions()
  const { draft, email, cpStatus, colonias, coloniaManual, sameAsBilling } =
    state

  const countriesInRegion = useMemo(
    () => state.cart?.region?.countries?.map((c) => c.iso_2),
    [state.cart?.region]
  )

  const addressesInRegion = useMemo(
    () =>
      customer?.addresses.filter(
        (a) => a.country_code && countriesInRegion?.includes(a.country_code)
      ),
    [customer?.addresses, countriesInRegion]
  )

  /** `shipping_address.first_name` -> `first_name`. */
  const fieldOf = (name: string) =>
    name.replace("shipping_address.", "") as AddressField | "email"

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) =>
    dispatch({
      type: "FIELD_CHANGE",
      field: fieldOf(e.target.name),
      value: e.target.value,
    })

  /**
   * Blur is the autosave boundary (R6). It coalesces a tab-through sequence
   * into one write instead of one per keystroke, and it is the natural "I am
   * done with this field" signal.
   */
  const handleBlur = (
    e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>
  ) =>
    dispatch({
      type: "FIELD_BLUR",
      field: fieldOf(e.target.name),
      value: e.target.value,
    })

  const showColoniaSelect = colonias.length > 0 && !coloniaManual

  /**
   * Which of these controls the refused CTA is complaining about.
   *
   * Empty until the customer has actually pressed and been refused, so a
   * pristine form is never opened with six inputs already ringed in red. See
   * `selectHighlightedAnchors`.
   */
  const isHighlighted = useCheckoutHighlight()
  const anchor = (field: `shipping.${BillingRequiredField}` | "email" | "phone" | "colonia") =>
    anchorProps(field, isHighlighted(field))

  return (
    <>
      {customer && (addressesInRegion?.length || 0) > 0 && (
        <Container className="mb-6 flex flex-col gap-y-4 rounded-large border border-line bg-cream p-5">
          <p className="text-small-regular text-ink">
            {`Hola ${customer.first_name}, ¿quieres usar una de tus direcciones guardadas?`}
          </p>
          <AddressSelect
            addresses={customer.addresses}
            addressInput={draft as unknown as HttpTypes.StoreCartAddress}
            onSelect={(address, selectedEmail) =>
              dispatch({
                type: "ADDRESS_PREFILL",
                address: (address ?? {}) as Partial<
                  Record<AddressField, string | null>
                >,
                email: selectedEmail ?? email,
              })
            }
          />
        </Container>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Nombre"
          name="shipping_address.first_name"
          autoComplete="given-name"
          value={draft.first_name}
          onChange={handleChange}
          onBlur={handleBlur}
          required
          data-testid="shipping-first-name-input"
          {...anchor("shipping.first_name")}
        />
        <Input
          label="Apellido"
          name="shipping_address.last_name"
          autoComplete="family-name"
          value={draft.last_name}
          onChange={handleChange}
          onBlur={handleBlur}
          required
          data-testid="shipping-last-name-input"
          {...anchor("shipping.last_name")}
        />
        <Input
          label="Dirección"
          name="shipping_address.address_1"
          autoComplete="address-line1"
          value={draft.address_1}
          onChange={handleChange}
          onBlur={handleBlur}
          required
          data-testid="shipping-address-input"
          {...anchor("shipping.address_1")}
        />
        <Input
          label="Empresa"
          name="shipping_address.company"
          value={draft.company}
          onChange={handleChange}
          onBlur={handleBlur}
          autoComplete="organization"
          data-testid="shipping-company-input"
        />
        {/* Postal code drives the autocomplete, so it comes before Colonia. */}
        <Input
          label="Código postal"
          name="shipping_address.postal_code"
          autoComplete="postal-code"
          inputMode="numeric"
          maxLength={5}
          value={draft.postal_code}
          onChange={handleChange}
          onBlur={handleBlur}
          required
          data-testid="shipping-postal-code-input"
          {...anchor("shipping.postal_code")}
        />
        <div className="flex flex-col w-full">
          {showColoniaSelect ? (
            <NativeSelect
              name="shipping_address.address_2"
              placeholder="Selecciona tu colonia"
              value={draft.address_2}
              onChange={(e) => {
                if (e.target.value === COLONIA_OTHER) {
                  dispatch({ type: "COLONIA_MANUAL_REQUESTED" })
                  return
                }
                handleChange(e)
                handleBlur(e as unknown as React.FocusEvent<HTMLSelectElement>)
              }}
              required
              data-testid="shipping-address-2-select"
              {...anchor("colonia")}
            >
              {colonias.map((colonia) => (
                <option key={colonia} value={colonia}>
                  {colonia}
                </option>
              ))}
              <option value={COLONIA_OTHER}>Otra (especificar)</option>
            </NativeSelect>
          ) : (
            <Input
              label="Colonia"
              name="shipping_address.address_2"
              autoComplete="address-line2"
              value={draft.address_2}
              onChange={handleChange}
              onBlur={handleBlur}
              required
              data-testid="shipping-address-2-input"
              {...anchor("colonia")}
            />
          )}
          {/*
           * Copy imported, not inlined. The account address book shows the same
           * two states, and two hand-written copies of the same sentence is how
           * one of them ends up saying something different.
           */}
          {cpStatus === "loading" && (
            <p className="mt-1 txt-small text-ink-muted" role="status">
              {POSTAL_CODE_HINTS.loading}
            </p>
          )}
          {cpStatus === "not_found" && (
            <p className="mt-1 txt-small text-ink-muted" role="status">
              {POSTAL_CODE_HINTS.notFound}
            </p>
          )}
        </div>
        <Input
          label="Ciudad"
          name="shipping_address.city"
          autoComplete="address-level2"
          value={draft.city}
          onChange={handleChange}
          onBlur={handleBlur}
          required
          data-testid="shipping-city-input"
          {...anchor("shipping.city")}
        />
        <Input
          label="Estado / Provincia"
          name="shipping_address.province"
          autoComplete="address-level1"
          value={draft.province}
          onChange={handleChange}
          onBlur={handleBlur}
          required
          data-testid="shipping-province-input"
          {...anchor("shipping.province")}
        />
        <CountrySelect
          name="shipping_address.country_code"
          autoComplete="country"
          region={state.cart?.region}
          value={draft.country_code}
          onChange={(e) => {
            handleChange(e)
            handleBlur(e as unknown as React.FocusEvent<HTMLSelectElement>)
          }}
          required
          data-testid="shipping-country-select"
          {...anchor("shipping.country_code")}
        />
      </div>
      <div className="my-8">
        <Checkbox
          label="La dirección de facturación es la misma que la de envío"
          name="same_as_billing"
          checked={sameAsBilling}
          onChange={() => dispatch({ type: "TOGGLE_SAME_AS_BILLING" })}
          data-testid="billing-address-checkbox"
        />
      </div>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Input
          label="Email"
          name="email"
          type="email"
          title="Ingresa un email válido."
          autoComplete="email"
          value={email}
          onChange={handleChange}
          onBlur={handleBlur}
          required
          data-testid="shipping-email-input"
          {...anchor("email")}
        />
        {/*
         * Required: Skydropx PRO marks `phone` as Required on `address_to` for
         * POST /shipments, so an order placed without one can never be labelled
         * (a real order with phone "" failed with
         * {"address_to":{"phone":["no puede estar en blanco"]}}).
         * The pattern/title live in `@lib/util/phone` — see that file for why an
         * exactly-10-digit rule was a revenue stopper, not a safety net. The
         * backend normalizes the value before it reaches the wire, so this is the
         * friendly front door, not the guarantee.
         */}
        <Input
          label="Teléfono"
          name="shipping_address.phone"
          type="tel"
          title={MX_PHONE_TITLE}
          pattern={MX_PHONE_PATTERN}
          autoComplete="tel"
          value={draft.phone}
          onChange={handleChange}
          onBlur={handleBlur}
          required
          data-testid="shipping-phone-input"
          {...anchor("phone")}
        />
      </div>
    </>
  )
}

export default ShippingAddress

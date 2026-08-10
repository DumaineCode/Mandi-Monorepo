"use client"

import Input from "@modules/common/components/input"
import {
  useCheckoutActions,
  useCheckoutState,
} from "@modules/checkout/state/checkout-context"
import type { AddressField } from "@modules/checkout/state/checkout-reducer"
import React from "react"
import CountrySelect from "../country-select"

/**
 * The billing address, shown only when it differs from the shipping address.
 *
 * Controlled by the reducer rather than by local `useState`, because the
 * `<form>` this used to live inside is gone: the four-step flow submitted it as
 * `FormData` through `setAddresses`, and the single-page checkout writes both
 * addresses at CTA time instead (D5 step 2, PR2c).
 *
 * ## Not autosaved, deliberately
 *
 * `persistCheckoutDraft` NEVER writes `billing_address` (D3). It is a partial
 * writer against a nested entity, and the whole reason PR1a exists is that
 * running two of those against one cart is how the shipping address got
 * shredded. Billing is written once, whole, at the CTA, by
 * `syncCheckoutAddresses` (PR2c, task 2c.12) — which carries the billing row id
 * for exactly the same reason the autosave carries the shipping one.
 *
 * ## Labels
 *
 * These read `First name` / `Address` / `Postal code` in English up to this
 * change, on a Mexican storefront whose every other checkout field is Spanish.
 * Translated here rather than left alone: the file was being rewritten anyway,
 * and shipping a checkout that switches language halfway down the page is not a
 * thing to preserve for the sake of a smaller diff. `tú` form, matching the
 * rest of the store.
 */
const BillingAddress = () => {
  const state = useCheckoutState()
  const { dispatch } = useCheckoutActions()
  const { billingDraft } = state

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) =>
    dispatch({
      type: "BILLING_FIELD_CHANGE",
      field: e.target.name.replace("billing_address.", "") as AddressField,
      value: e.target.value,
    })

  return (
    <div className="grid grid-cols-2 gap-4">
      <Input
        label="Nombre"
        name="billing_address.first_name"
        autoComplete="given-name"
        value={billingDraft.first_name}
        onChange={handleChange}
        required
        data-testid="billing-first-name-input"
      />
      <Input
        label="Apellido"
        name="billing_address.last_name"
        autoComplete="family-name"
        value={billingDraft.last_name}
        onChange={handleChange}
        required
        data-testid="billing-last-name-input"
      />
      <Input
        label="Dirección"
        name="billing_address.address_1"
        autoComplete="address-line1"
        value={billingDraft.address_1}
        onChange={handleChange}
        required
        data-testid="billing-address-input"
      />
      <Input
        label="Empresa"
        name="billing_address.company"
        value={billingDraft.company}
        onChange={handleChange}
        autoComplete="organization"
        data-testid="billing-company-input"
      />
      <Input
        label="Código postal"
        name="billing_address.postal_code"
        autoComplete="postal-code"
        inputMode="numeric"
        maxLength={5}
        value={billingDraft.postal_code}
        onChange={handleChange}
        required
        data-testid="billing-postal-input"
      />
      <Input
        label="Ciudad"
        name="billing_address.city"
        autoComplete="address-level2"
        value={billingDraft.city}
        onChange={handleChange}
        required
        data-testid="billing-city-input"
      />
      <CountrySelect
        name="billing_address.country_code"
        autoComplete="country"
        region={state.cart?.region}
        value={billingDraft.country_code}
        onChange={handleChange}
        required
        data-testid="billing-country-select"
      />
      {/*
       * `required`, and it was missing. Amendment A6's own motivation is that
       * "`city` **and** `province` are required here and were not marked
       * `required` on the billing form" (`checkout-readiness.ts`), and only
       * `city` got it. `province` is in `REQUIRED_ADDRESS_FIELDS`, so
       * `missingBillingFields` blocks the CTA on it — a customer could satisfy
       * every field the UI asked for and still be refused.
       */}
      <Input
        label="Estado / Provincia"
        name="billing_address.province"
        autoComplete="address-level1"
        value={billingDraft.province}
        onChange={handleChange}
        required
        data-testid="billing-province-input"
      />
      <Input
        label="Teléfono"
        name="billing_address.phone"
        type="tel"
        autoComplete="tel"
        value={billingDraft.phone}
        onChange={handleChange}
        data-testid="billing-phone-input"
      />
    </div>
  )
}

export default BillingAddress

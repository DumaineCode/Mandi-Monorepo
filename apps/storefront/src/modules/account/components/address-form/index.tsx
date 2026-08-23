"use client"

import { HttpTypes } from "@medusajs/types"
import CountrySelect from "@modules/checkout/components/country-select"
import Input from "@modules/common/components/input"
import NativeSelect from "@modules/common/components/native-select"

import { useAddressForm } from "@lib/hooks/use-address-form"
import { MX_PHONE_PATTERN, MX_PHONE_TITLE } from "@lib/util/phone"
import { COLONIA_OTHER } from "@lib/util/address-form"

/**
 * The address fields for the account address book — the SAME address the
 * checkout asks for, in the same order, with the same labels and the same
 * requirements.
 *
 * ## Why this component exists
 *
 * "Add address" and "Edit address" were two hand-maintained copies of a form
 * that also had to agree with a third copy in the checkout, and all three had
 * drifted. Concretely, an address saved from the account before this component
 * could be REJECTED by the checkout that was supposed to consume it:
 *
 * - `address_2` was "Interior, departamento (opcional)" here and a required
 *   **Colonia** at checkout. Skydropx prices per colonia (`area_level3`), so a
 *   saved address without one cannot be quoted.
 * - `province` was optional here and required at checkout.
 * - `phone` was optional here and is Required on Skydropx's `address_to`. A
 *   saved address without one can never be labelled — see `@lib/util/phone`.
 * - The SEPOMEX postal-code autocomplete only existed at checkout, so the
 *   account form asked the customer to know their own state and colonia.
 *
 * PURELY PRESENTATIONAL. Every decision — when the colonia is a dropdown, what
 * a lookup answer is allowed to overwrite, when an answer is stale — lives in
 * `@lib/util/address-form` and is covered by `address-form.spec.ts`. This repo
 * has no jsdom, so a rule in a `.tsx` is a rule nothing verifies.
 *
 * Submission is unchanged: these are controlled inputs that still carry the
 * `name` attributes `addCustomerAddress` / `updateCustomerAddress` read off
 * `FormData`. The parent still owns the `<form>`, the server action and the
 * error banner.
 */
const AddressForm = ({
  region,
  address,
}: {
  region: HttpTypes.StoreRegion
  address?: HttpTypes.StoreCustomerAddress | null
}) => {
  const {
    values,
    colonias,
    setField,
    requestManualColonia,
    showColoniaSelect,
    postalCodeHint,
  } = useAddressForm(address, region.countries?.[0]?.iso_2)

  return (
    <div className="grid w-full grid-cols-1 gap-3 xsmall:grid-cols-2">
      <Input
        label="Nombre"
        name="first_name"
        required
        autoComplete="given-name"
        value={values.first_name}
        onChange={(e) => setField("first_name", e.target.value)}
        data-testid="first-name-input"
      />
      <Input
        label="Apellido"
        name="last_name"
        required
        autoComplete="family-name"
        value={values.last_name}
        onChange={(e) => setField("last_name", e.target.value)}
        data-testid="last-name-input"
      />
      <Input
        label="Dirección"
        name="address_1"
        required
        autoComplete="address-line1"
        value={values.address_1}
        onChange={(e) => setField("address_1", e.target.value)}
        data-testid="address-1-input"
      />
      <Input
        label="Empresa"
        name="company"
        autoComplete="organization"
        value={values.company}
        onChange={(e) => setField("company", e.target.value)}
        data-testid="company-input"
      />
      {/* Postal code drives the autocomplete, so it comes before Colonia. */}
      <Input
        label="Código postal"
        name="postal_code"
        required
        autoComplete="postal-code"
        inputMode="numeric"
        maxLength={5}
        value={values.postal_code}
        onChange={(e) => setField("postal_code", e.target.value)}
        data-testid="postal-code-input"
      />
      <div className="flex w-full flex-col">
        {showColoniaSelect ? (
          <NativeSelect
            name="address_2"
            placeholder="Selecciona tu colonia"
            value={values.address_2}
            onChange={(e) => {
              if (e.target.value === COLONIA_OTHER) {
                requestManualColonia()
                return
              }
              setField("address_2", e.target.value)
            }}
            required
            data-testid="address-2-select"
          >
            {colonias.map((colonia) => (
              <option key={colonia} value={colonia}>
                {colonia}
              </option>
            ))}
            {/*
             * The sentinel is the LAST option on purpose: it is an escape hatch
             * for a colonia SEPOMEX does not list, not a choice competing with
             * the real ones.
             */}
            <option value={COLONIA_OTHER}>Otra (especificar)</option>
          </NativeSelect>
        ) : (
          <Input
            label="Colonia"
            name="address_2"
            required
            autoComplete="address-line2"
            value={values.address_2}
            onChange={(e) => setField("address_2", e.target.value)}
            data-testid="address-2-input"
          />
        )}
        {postalCodeHint && (
          <p className="mt-1 txt-small text-ink-muted" role="status">
            {postalCodeHint}
          </p>
        )}
      </div>
      <Input
        label="Ciudad"
        name="city"
        required
        autoComplete="address-level2"
        value={values.city}
        onChange={(e) => setField("city", e.target.value)}
        data-testid="city-input"
      />
      <Input
        label="Estado / Provincia"
        name="province"
        required
        autoComplete="address-level1"
        value={values.province}
        onChange={(e) => setField("province", e.target.value)}
        data-testid="state-input"
      />
      <CountrySelect
        name="country_code"
        region={region}
        required
        autoComplete="country"
        value={values.country_code}
        onChange={(e) => setField("country_code", e.target.value)}
        data-testid="country-select"
      />
      {/*
       * Required, exactly as at checkout. Skydropx PRO marks `phone` as Required
       * on `address_to` for POST /shipments, so an address saved without one is
       * an order that can never be labelled. The pattern accepts what people
       * actually type — see `@lib/util/phone` for why an exactly-10-digit rule
       * was a revenue stopper rather than a safety net.
       */}
      <Input
        label="Teléfono"
        name="phone"
        type="tel"
        required
        title={MX_PHONE_TITLE}
        pattern={MX_PHONE_PATTERN}
        autoComplete="tel"
        value={values.phone}
        onChange={(e) => setField("phone", e.target.value)}
        data-testid="phone-input"
      />
    </div>
  )
}

export default AddressForm

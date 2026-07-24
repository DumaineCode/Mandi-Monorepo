import { HttpTypes } from "@medusajs/types"
import { Container } from "@modules/common/components/ui"
import Checkbox from "@modules/common/components/checkbox"
import Input from "@modules/common/components/input"
import NativeSelect from "@modules/common/components/native-select"
import { getPostalCode } from "@lib/data/postal-code"
import { mapKeys } from "lodash"
import React, { useEffect, useMemo, useRef, useState } from "react"
import AddressSelect from "../address-select"
import CountrySelect from "../country-select"

/** Sentinel option value that switches the colonia dropdown to free text. */
const COLONIA_OTHER = "__other__"

const ShippingAddress = ({
  customer,
  cart,
  checked,
  onChange,
}: {
  customer: HttpTypes.StoreCustomer | null
  cart: HttpTypes.StoreCart | null
  checked: boolean
  onChange: () => void
}) => {
  const [formData, setFormData] = useState<Record<string, string>>({
    "shipping_address.first_name": cart?.shipping_address?.first_name || "",
    "shipping_address.last_name": cart?.shipping_address?.last_name || "",
    "shipping_address.address_1": cart?.shipping_address?.address_1 || "",
    "shipping_address.address_2": cart?.shipping_address?.address_2 || "",
    "shipping_address.company": cart?.shipping_address?.company || "",
    "shipping_address.postal_code": cart?.shipping_address?.postal_code || "",
    "shipping_address.city": cart?.shipping_address?.city || "",
    "shipping_address.country_code": cart?.shipping_address?.country_code || "",
    "shipping_address.province": cart?.shipping_address?.province || "",
    "shipping_address.phone": cart?.shipping_address?.phone || "",
    email: cart?.email || "",
  })

  // --- Postal-code (SEPOMEX) autocomplete state ---
  const [colonias, setColonias] = useState<string[]>([])
  const [cpStatus, setCpStatus] = useState<
    "idle" | "loading" | "found" | "not_found"
  >("idle")
  // "Otra (especificar)" escape hatch: render the free-text colonia input even
  // when a colonia list is available (e.g. a saved colonia not in the list).
  const [coloniaManual, setColoniaManual] = useState(false)

  // Latest colonia value, read inside the async lookup without a stale closure.
  const currentColoniaRef = useRef(formData["shipping_address.address_2"] || "")
  useEffect(() => {
    currentColoniaRef.current = formData["shipping_address.address_2"] || ""
  }, [formData])

  // Guards against re-fetching the same CP on every keystroke/re-render.
  const lastLookedUpCp = useRef<string>("")

  const countriesInRegion = useMemo(
    () => cart?.region?.countries?.map((c) => c.iso_2),
    [cart?.region]
  )

  // check if customer has saved addresses that are in the current region
  const addressesInRegion = useMemo(
    () =>
      customer?.addresses.filter(
        (a) => a.country_code && countriesInRegion?.includes(a.country_code)
      ),
    [customer?.addresses, countriesInRegion]
  )

  const setFormAddress = (
    address?: HttpTypes.StoreCartAddress,
    email?: string
  ) => {
    if (address) {
      setFormData((prevState: Record<string, string>) => ({
        ...prevState,
        "shipping_address.first_name": address?.first_name || "",
        "shipping_address.last_name": address?.last_name || "",
        "shipping_address.address_1": address?.address_1 || "",
        "shipping_address.address_2": address?.address_2 || "",
        "shipping_address.company": address?.company || "",
        "shipping_address.postal_code": address?.postal_code || "",
        "shipping_address.city": address?.city || "",
        "shipping_address.country_code": address?.country_code || "",
        "shipping_address.province": address?.province || "",
        "shipping_address.phone": address?.phone || "",
      }))
    }

    if (email) {
      setFormData((prevState: Record<string, string>) => ({
        ...prevState,
        email: email,
      }))
    }
  }

  useEffect(() => {
    // Ensure cart is not null and has a shipping_address before setting form data
    if (cart && cart.shipping_address) {
      setFormAddress(cart?.shipping_address, cart?.email)
    }

    if (cart && !cart.email && customer?.email) {
      setFormAddress(undefined, customer.email)
    }
  }, [cart]) // Add cart as a dependency

  const postalCode = formData["shipping_address.postal_code"]

  // Look up the CP whenever it becomes a valid 5-digit code and autofill
  // State/Province + City, and populate the colonia dropdown. Degrades to
  // manual entry on any failure (see getPostalCode) — never blocks the form.
  useEffect(() => {
    const cp = (postalCode || "").trim()

    if (!/^\d{5}$/.test(cp)) {
      setCpStatus("idle")
      setColonias([])
      return
    }

    if (cp === lastLookedUpCp.current) {
      return
    }
    lastLookedUpCp.current = cp

    let cancelled = false
    setCpStatus("loading")

    getPostalCode(cp)
      .then((res) => {
        if (cancelled) {
          return
        }

        if (!res || !res.found) {
          setColonias([])
          setCpStatus("not_found")
          return
        }

        const previousColonia = currentColoniaRef.current
        const coloniaInList = res.colonias.includes(previousColonia)

        setColonias(res.colonias)
        // Keep a previously entered colonia that isn't in the list (e.g. from a
        // saved address) as free text instead of silently wiping it.
        setColoniaManual(previousColonia !== "" && !coloniaInList)
        setCpStatus("found")

        // The CP is authoritative for state + city, so overwrite them — this is
        // also what fixes the missing-state cause of a "-" shipping price.
        setFormData((prev) => ({
          ...prev,
          "shipping_address.province":
            res.state || prev["shipping_address.province"],
          "shipping_address.city": res.city || prev["shipping_address.city"],
        }))
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setColonias([])
        setCpStatus("not_found")
      })

    return () => {
      cancelled = true
    }
  }, [postalCode])

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLInputElement | HTMLSelectElement
    >
  ) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    })
  }

  const showColoniaSelect = colonias.length > 0 && !coloniaManual

  return (
    <>
      {customer && (addressesInRegion?.length || 0) > 0 && (
        <Container className="mb-6 flex flex-col gap-y-4 rounded-large border border-line bg-cream p-5">
          <p className="text-small-regular text-ink">
            {`Hola ${customer.first_name}, ¿quieres usar una de tus direcciones guardadas?`}
          </p>
          <AddressSelect
            addresses={customer.addresses}
            addressInput={
              mapKeys(formData, (_, key) =>
                key.replace("shipping_address.", "")
              ) as unknown as HttpTypes.StoreCartAddress
            }
            onSelect={setFormAddress}
          />
        </Container>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Nombre"
          name="shipping_address.first_name"
          autoComplete="given-name"
          value={formData["shipping_address.first_name"]}
          onChange={handleChange}
          required
          data-testid="shipping-first-name-input"
        />
        <Input
          label="Apellido"
          name="shipping_address.last_name"
          autoComplete="family-name"
          value={formData["shipping_address.last_name"]}
          onChange={handleChange}
          required
          data-testid="shipping-last-name-input"
        />
        <Input
          label="Dirección"
          name="shipping_address.address_1"
          autoComplete="address-line1"
          value={formData["shipping_address.address_1"]}
          onChange={handleChange}
          required
          data-testid="shipping-address-input"
        />
        <Input
          label="Empresa"
          name="shipping_address.company"
          value={formData["shipping_address.company"]}
          onChange={handleChange}
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
          value={formData["shipping_address.postal_code"]}
          onChange={handleChange}
          required
          data-testid="shipping-postal-code-input"
        />
        <div className="flex flex-col w-full">
          {showColoniaSelect ? (
            <NativeSelect
              name="shipping_address.address_2"
              placeholder="Selecciona tu colonia"
              value={formData["shipping_address.address_2"]}
              onChange={(e) => {
                if (e.target.value === COLONIA_OTHER) {
                  setColoniaManual(true)
                  setFormData((prev) => ({
                    ...prev,
                    "shipping_address.address_2": "",
                  }))
                  return
                }
                handleChange(e)
              }}
              required
              data-testid="shipping-address-2-select"
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
              value={formData["shipping_address.address_2"]}
              onChange={handleChange}
              required
              data-testid="shipping-address-2-input"
            />
          )}
          {cpStatus === "loading" && (
            <p className="mt-1 txt-small text-ink-muted">
              Buscando código postal…
            </p>
          )}
          {cpStatus === "not_found" && (
            <p className="mt-1 txt-small text-ink-muted">
              No encontramos ese código postal. Completa los datos a mano.
            </p>
          )}
        </div>
        <Input
          label="Ciudad"
          name="shipping_address.city"
          autoComplete="address-level2"
          value={formData["shipping_address.city"]}
          onChange={handleChange}
          required
          data-testid="shipping-city-input"
        />
        <Input
          label="Estado / Provincia"
          name="shipping_address.province"
          autoComplete="address-level1"
          value={formData["shipping_address.province"]}
          onChange={handleChange}
          required
          data-testid="shipping-province-input"
        />
        <CountrySelect
          name="shipping_address.country_code"
          autoComplete="country"
          region={cart?.region}
          value={formData["shipping_address.country_code"]}
          onChange={handleChange}
          required
          data-testid="shipping-country-select"
        />
      </div>
      <div className="my-8">
        <Checkbox
          label="La dirección de facturación es la misma que la de envío"
          name="same_as_billing"
          checked={checked}
          onChange={onChange}
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
          value={formData.email}
          onChange={handleChange}
          required
          data-testid="shipping-email-input"
        />
        <Input
          label="Teléfono"
          name="shipping_address.phone"
          autoComplete="tel"
          value={formData["shipping_address.phone"]}
          onChange={handleChange}
          data-testid="shipping-phone-input"
        />
      </div>
    </>
  )
}

export default ShippingAddress

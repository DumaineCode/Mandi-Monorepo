import { describe, expect, it } from "vitest"

import {
  AddressFormState,
  COLONIA_OTHER,
  POSTAL_CODE_HINTS,
  addressFormReducer,
  initAddressFormState,
  selectPostalCodeHint,
  selectShouldLookUpPostalCode,
  selectShowColoniaSelect,
  toAddressFormValues,
} from "@lib/util/address-form"

const SAVED = {
  first_name: "Ana",
  last_name: "Ruiz",
  company: null,
  address_1: "Av. Insurgentes Sur 1234",
  address_2: "Del Valle Centro",
  postal_code: "03100",
  city: "Ciudad de México",
  province: "CDMX",
  country_code: "mx",
  phone: "5512345678",
}

/** The form as it stands after the customer typed `postalCode` and nothing else. */
const withPostalCode = (postalCode: string): AddressFormState =>
  addressFormReducer(initAddressFormState(toAddressFormValues()), {
    type: "FIELD_CHANGE",
    field: "postal_code",
    value: postalCode,
  })

describe("toAddressFormValues", () => {
  /**
   * Every field controlled from the first render. A React input seeded with
   * `undefined` and later handed a string flips from uncontrolled to controlled
   * and drops what the customer typed in between.
   */
  it("coerces every absent field to an empty string", () => {
    expect(toAddressFormValues()).toEqual({
      first_name: "",
      last_name: "",
      company: "",
      address_1: "",
      address_2: "",
      postal_code: "",
      city: "",
      province: "",
      country_code: "",
      phone: "",
    })
  })

  it("coerces a null field to an empty string rather than passing null through", () => {
    expect(toAddressFormValues(SAVED).company).toBe("")
  })

  it("carries a saved address through unchanged", () => {
    const values = toAddressFormValues(SAVED)

    expect(values.address_2).toBe("Del Valle Centro")
    expect(values.postal_code).toBe("03100")
    expect(values.phone).toBe("5512345678")
  })

  it("falls back to the region country only when the address has none", () => {
    expect(toAddressFormValues(null, "mx").country_code).toBe("mx")
    expect(toAddressFormValues({ country_code: "us" }, "mx").country_code).toBe(
      "us"
    )
  })
})

describe("selectShouldLookUpPostalCode", () => {
  it.each([
    ["nothing typed yet", ""],
    ["four digits", "0310"],
    ["six digits", "031000"],
    ["digits with a letter", "0310a"],
  ])("declines to look up %s", (_label, postalCode) => {
    expect(selectShouldLookUpPostalCode(withPostalCode(postalCode))).toBe(false)
  })

  it("looks up a five-digit postal code", () => {
    expect(selectShouldLookUpPostalCode(withPostalCode("03100"))).toBe(true)
  })

  it("tolerates surrounding whitespace", () => {
    expect(selectShouldLookUpPostalCode(withPostalCode(" 03100 "))).toBe(true)
  })

  /**
   * The dedupe. The component re-runs its effect for reasons unrelated to the
   * postal code moving; without this every one of them spends a round trip.
   */
  it("does not re-ask for a postal code that already answered", () => {
    const found = addressFormReducer(withPostalCode("03100"), {
      type: "CP_LOOKUP_FOUND",
      postalCode: "03100",
      province: "CDMX",
      city: "Ciudad de México",
      colonias: ["Del Valle Centro"],
    })

    expect(selectShouldLookUpPostalCode(found)).toBe(false)
  })

  /**
   * A MISS is as final as a hit. Re-asking a postal code SEPOMEX does not know
   * is a round trip per keystroke for an answer that will not change.
   */
  it("does not re-ask for a postal code that missed", () => {
    const missed = addressFormReducer(withPostalCode("99999"), {
      type: "CP_LOOKUP_NOT_FOUND",
      postalCode: "99999",
    })

    expect(selectShouldLookUpPostalCode(missed)).toBe(false)
  })

  it("asks again once the customer moves to a different postal code", () => {
    const found = addressFormReducer(withPostalCode("03100"), {
      type: "CP_LOOKUP_FOUND",
      postalCode: "03100",
      province: "CDMX",
      city: "Ciudad de México",
      colonias: ["Del Valle Centro"],
    })

    const moved = addressFormReducer(found, {
      type: "FIELD_CHANGE",
      field: "postal_code",
      value: "64000",
    })

    expect(selectShouldLookUpPostalCode(moved)).toBe(true)
  })
})

describe("CP_LOOKUP_FOUND", () => {
  const found = (state: AddressFormState, overrides = {}) =>
    addressFormReducer(state, {
      type: "CP_LOOKUP_FOUND",
      postalCode: "03100",
      province: "CDMX",
      city: "Ciudad de México",
      colonias: ["Del Valle Centro", "Del Valle Norte"],
      ...overrides,
    })

  it("fills state and city from the postal code", () => {
    const state = found(withPostalCode("03100"))

    expect(state.values.province).toBe("CDMX")
    expect(state.values.city).toBe("Ciudad de México")
    expect(state.cpStatus).toBe("found")
    expect(state.colonias).toEqual(["Del Valle Centro", "Del Valle Norte"])
  })

  /**
   * SEPOMEX occasionally answers with a blank city. Blanking a field the
   * customer already filled is a regression dressed as an autocomplete.
   */
  it("does not blank a filled city when the answer carries none", () => {
    const typed = addressFormReducer(withPostalCode("03100"), {
      type: "FIELD_CHANGE",
      field: "city",
      value: "CDMX a mano",
    })

    expect(found(typed, { city: "" }).values.city).toBe("CDMX a mano")
  })

  /**
   * Dropped WHOLE, not merged. The postal code is authoritative for state and
   * city, so a late answer applied to a form that has moved on would stamp one
   * destination's city onto another's postal code.
   */
  it("ignores an answer for a postal code the form has moved off", () => {
    const moved = addressFormReducer(withPostalCode("03100"), {
      type: "FIELD_CHANGE",
      field: "postal_code",
      value: "64000",
    })

    expect(found(moved)).toBe(moved)
  })

  it("offers the dropdown for a colonia that is on the list", () => {
    const state = found(withPostalCode("03100"))

    expect(state.coloniaManual).toBe(false)
    expect(selectShowColoniaSelect(state)).toBe(true)
  })

  /**
   * A saved address whose colonia SEPOMEX does not list must survive. A
   * dropdown with no option matching it would wipe it on the next submit.
   */
  it("keeps an off-list colonia as free text instead of wiping it", () => {
    const seeded = initAddressFormState(
      toAddressFormValues({ ...SAVED, address_2: "Una colonia rara" })
    )

    const state = found(seeded)

    expect(state.coloniaManual).toBe(true)
    expect(state.values.address_2).toBe("Una colonia rara")
    expect(selectShowColoniaSelect(state)).toBe(false)
  })
})

describe("CP_LOOKUP_NOT_FOUND", () => {
  it("degrades to manual entry rather than blocking", () => {
    const state = addressFormReducer(withPostalCode("99999"), {
      type: "CP_LOOKUP_NOT_FOUND",
      postalCode: "99999",
    })

    expect(state.cpStatus).toBe("not_found")
    expect(state.coloniaManual).toBe(true)
    expect(selectShowColoniaSelect(state)).toBe(false)
    expect(selectPostalCodeHint(state)).toBe(POSTAL_CODE_HINTS.notFound)
  })

  it("keeps whatever colonia the customer already typed", () => {
    const typed = addressFormReducer(withPostalCode("99999"), {
      type: "FIELD_CHANGE",
      field: "address_2",
      value: "Mi colonia",
    })

    const state = addressFormReducer(typed, {
      type: "CP_LOOKUP_NOT_FOUND",
      postalCode: "99999",
    })

    expect(state.values.address_2).toBe("Mi colonia")
  })

  it("ignores a stale miss", () => {
    const moved = addressFormReducer(withPostalCode("99999"), {
      type: "FIELD_CHANGE",
      field: "postal_code",
      value: "03100",
    })

    expect(
      addressFormReducer(moved, {
        type: "CP_LOOKUP_NOT_FOUND",
        postalCode: "99999",
      })
    ).toBe(moved)
  })
})

describe("selectShowColoniaSelect", () => {
  const found = addressFormReducer(withPostalCode("03100"), {
    type: "CP_LOOKUP_FOUND",
    postalCode: "03100",
    province: "CDMX",
    city: "Ciudad de México",
    colonias: ["Del Valle Centro"],
  })

  /**
   * The guard the reducer alone cannot give. A valid five-digit code KEEPS the
   * previous list while its own answer is in flight so the control does not
   * blink — this is what stops that still-held list being offered for the wrong
   * postal code in the meantime.
   */
  it("hides a list that belongs to a different postal code", () => {
    const moved = addressFormReducer(found, {
      type: "FIELD_CHANGE",
      field: "postal_code",
      value: "64000",
    })

    expect(moved.colonias).toHaveLength(1)
    expect(selectShowColoniaSelect(moved)).toBe(false)
  })

  it("drops the list outright once the postal code can no longer be looked up", () => {
    const broken = addressFormReducer(found, {
      type: "FIELD_CHANGE",
      field: "postal_code",
      value: "031",
    })

    expect(broken.colonias).toEqual([])
    expect(broken.coloniasPostalCode).toBeNull()
    expect(broken.cpStatus).toBe("idle")
  })

  it("switches to free text when the customer asks for it, keeping the list", () => {
    const manual = addressFormReducer(found, {
      type: "COLONIA_MANUAL_REQUESTED",
    })

    expect(selectShowColoniaSelect(manual)).toBe(false)
    expect(manual.colonias).toEqual(["Del Valle Centro"])
  })

  it("keeps the selected colonia when the customer switches to free text", () => {
    const selected = addressFormReducer(found, {
      type: "FIELD_CHANGE",
      field: "address_2",
      value: "Del Valle Centro",
    })

    expect(
      addressFormReducer(selected, { type: "COLONIA_MANUAL_REQUESTED" }).values
        .address_2
    ).toBe("Del Valle Centro")
  })
})

describe("selectPostalCodeHint", () => {
  it("says nothing while idle", () => {
    expect(selectPostalCodeHint(withPostalCode(""))).toBeNull()
  })

  it("announces a lookup in flight", () => {
    const loading = addressFormReducer(withPostalCode("03100"), {
      type: "CP_LOOKUP_STARTED",
      postalCode: "03100",
    })

    expect(selectPostalCodeHint(loading)).toBe(POSTAL_CODE_HINTS.loading)
  })

  it("says nothing once the lookup succeeded", () => {
    const found = addressFormReducer(withPostalCode("03100"), {
      type: "CP_LOOKUP_FOUND",
      postalCode: "03100",
      province: "CDMX",
      city: "Ciudad de México",
      colonias: ["Del Valle Centro"],
    })

    expect(selectPostalCodeHint(found)).toBeNull()
  })
})

describe("COLONIA_OTHER", () => {
  /**
   * The sentinel must never collide with a real colonia name, because the
   * dropdown compares option values by equality to decide whether the customer
   * picked "Otra" or an actual colonia.
   */
  it("is not a plausible colonia name", () => {
    expect(COLONIA_OTHER).toBe("__other__")
  })
})

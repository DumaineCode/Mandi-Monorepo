/**
 * The address form's rules — shared by the checkout and by the account address
 * book, and PURE so they can be contradicted by a spec.
 *
 * ## Why this file exists
 *
 * The account address book (`/account/addresses`) and the checkout shipping
 * form were two independent implementations of the same Mexican address. They
 * disagreed on three things a customer can see:
 *
 * | | Checkout | Account (before) |
 * |---|---|---|
 * | `address_2` | **Colonia**, required, SEPOMEX dropdown | "Interior, departamento" free text |
 * | `postal_code` | drives the SEPOMEX lookup | plain input, no lookup |
 * | `province` / `phone` | required, phone with an MX pattern | both optional |
 *
 * A customer who saved an address from their account therefore produced one
 * that the checkout would reject as incomplete — and `phone` in particular is
 * Required on Skydropx's `address_to`, so a saved address without one can never
 * be labelled. See `@lib/util/phone`.
 *
 * ## What is shared, and what deliberately is not
 *
 * SHARED: the colonia sentinel, the customer-facing lookup copy, and the
 * autocomplete state machine below.
 *
 * NOT shared: the checkout's wiring. `checkout-reducer.ts` keeps its own
 * `cpStatus` / `colonias` fields because its lookup is entangled with the quote
 * signature, the autosave scheduler and the cart's persisted address — three
 * concerns the account form does not have. Folding the checkout into this
 * reducer would rewrite the most heavily specified module in the storefront to
 * buy nothing a customer can see. The two DO agree on the sentinel and the copy
 * because those are imported from here, which is the part that used to drift.
 */

import { MX_POSTAL_CODE_PATTERN } from "@lib/util/shipping-quote"

/**
 * Sentinel option value that switches the colonia dropdown to free text.
 *
 * Exported rather than redeclared per form: two copies of a sentinel is a bug
 * waiting for one of them to be renamed.
 */
export const COLONIA_OTHER = "__other__"

/**
 * Customer-facing copy for the lookup, in one place so the checkout and the
 * account form cannot describe the same situation differently.
 */
export const POSTAL_CODE_HINTS = {
  loading: "Buscando código postal…",
  notFound: "No encontramos ese código postal. Completa los datos a mano.",
} as const

/** SEPOMEX lookup status. `not_found` degrades to manual entry, never blocks. */
export type PostalCodeStatus = "idle" | "loading" | "found" | "not_found"

/**
 * The form's fields, named EXACTLY as the server actions read them off
 * `FormData` (`addCustomerAddress` / `updateCustomerAddress` in
 * `@lib/data/customer`). The names are the contract; renaming one here without
 * renaming it there fails silently as an empty column.
 */
export type AddressFormValues = {
  first_name: string
  last_name: string
  company: string
  address_1: string
  /** The colonia. `address_2` on the wire — Medusa has no colonia field. */
  address_2: string
  postal_code: string
  city: string
  province: string
  country_code: string
  phone: string
}

export type AddressFormField = keyof AddressFormValues

export type AddressFormState = {
  values: AddressFormValues
  cpStatus: PostalCodeStatus
  /** Colonias returned by the last lookup that landed. */
  colonias: string[]
  /**
   * The postal code {@link colonias} was FETCHED for, or `null` when no list is
   * held. A list is only meaningful for its own postal code, so every selector
   * that renders the list compares against this first.
   */
  coloniasPostalCode: string | null
  /**
   * The postal code the last lookup was ISSUED for — hit or miss. This is the
   * dedupe guard: without it a `not_found` postal code would be re-requested on
   * every keystroke that follows it.
   */
  lookedUpPostalCode: string | null
  /** The customer chose "Otra (especificar)", or arrived with an off-list colonia. */
  coloniaManual: boolean
}

export type AddressFormAction =
  | { type: "FIELD_CHANGE"; field: AddressFormField; value: string }
  | { type: "COLONIA_MANUAL_REQUESTED" }
  | { type: "CP_LOOKUP_STARTED"; postalCode: string }
  | {
      type: "CP_LOOKUP_FOUND"
      /**
       * The postal code this lookup was REQUESTED for. Required, not optional:
       * the reducer is the only place that can tell a current answer from a
       * stale one, and without this field it is structurally unable to.
       */
      postalCode: string
      province: string
      city: string
      colonias: string[]
    }
  | { type: "CP_LOOKUP_NOT_FOUND"; postalCode: string }
  | { type: "CP_LOOKUP_DISCARDED" }

const EMPTY_VALUES: AddressFormValues = {
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
}

/**
 * A saved address (or nothing, for the "new address" form) as form values.
 *
 * Every field is coerced to `""` rather than left `undefined` so the inputs are
 * controlled from the first render. A React input that starts `undefined` and
 * later receives a string flips from uncontrolled to controlled and warns —
 * and, worse, drops whatever the customer typed in between.
 */
export function toAddressFormValues(
  address?: Partial<Record<AddressFormField, string | null | undefined>> | null,
  defaultCountryCode?: string | null
): AddressFormValues {
  const read = (field: AddressFormField) => address?.[field] ?? ""

  return {
    ...EMPTY_VALUES,
    first_name: read("first_name"),
    last_name: read("last_name"),
    company: read("company"),
    address_1: read("address_1"),
    address_2: read("address_2"),
    postal_code: read("postal_code"),
    city: read("city"),
    province: read("province"),
    country_code: read("country_code") || defaultCountryCode || "",
    phone: read("phone"),
  }
}

export function initAddressFormState(
  values: AddressFormValues
): AddressFormState {
  return {
    values,
    cpStatus: "idle",
    colonias: [],
    coloniasPostalCode: null,
    lookedUpPostalCode: null,
    /**
     * `false`, even for a returning address that already carries a colonia.
     *
     * The lookup has not run yet, so we do not know whether that colonia is on
     * the list or off it. `CP_LOOKUP_FOUND` is the branch that decides, and it
     * decides against the list it actually received.
     */
    coloniaManual: false,
  }
}

/** Discards a held colonia list. The list belongs to a postal code that is gone. */
function withoutColonias(state: AddressFormState): AddressFormState {
  return {
    ...state,
    cpStatus: "idle",
    colonias: [],
    coloniasPostalCode: null,
    lookedUpPostalCode: null,
    coloniaManual: false,
  }
}

/**
 * A lookup answer is stale when the postal code it was requested for is no
 * longer the one in the form. Dropped WHOLE when stale — never merged: the
 * postal code is authoritative for state and city, so applying a late answer
 * would stamp one destination's city onto another's postal code.
 */
function isStale(state: AddressFormState, postalCode: string): boolean {
  return postalCode !== state.values.postal_code.trim()
}

export function addressFormReducer(
  state: AddressFormState,
  action: AddressFormAction
): AddressFormState {
  switch (action.type) {
    case "FIELD_CHANGE": {
      const next: AddressFormState = {
        ...state,
        values: { ...state.values, [action.field]: action.value },
      }

      if (action.field !== "postal_code") {
        return next
      }

      /**
       * The postal code moved. A list fetched for the old one is now wrong, and
       * leaving it up is how a customer ends up shipping to a colonia that does
       * not exist under the code they just typed.
       *
       * Only a postal code that can no longer produce a lookup drops the list
       * outright; a valid five-digit one keeps it until its own answer lands,
       * so the select does not blink empty mid-request. `selectShowColoniaSelect`
       * is what stops the stale list from RENDERING in the meantime.
       */
      return MX_POSTAL_CODE_PATTERN.test(action.value.trim())
        ? next
        : withoutColonias(next)
    }

    case "COLONIA_MANUAL_REQUESTED":
      /**
       * The list is kept, not dropped, and neither is whatever colonia was
       * already selected. The customer asked to type their own; they have not
       * told us the postal code is wrong, and wiping the field would throw away
       * the closest thing they have to a starting point.
       *
       * This mirrors the checkout, which reaches the same state by declining to
       * write the sentinel into the draft (`shipping-address/index.tsx`).
       */
      return { ...state, coloniaManual: true }

    case "CP_LOOKUP_STARTED":
      return {
        ...state,
        cpStatus: "loading",
        lookedUpPostalCode: action.postalCode,
      }

    case "CP_LOOKUP_FOUND": {
      if (isStale(state, action.postalCode)) {
        return state
      }

      /**
       * The postal code is authoritative for state and city, so it overwrites
       * them — but only with something. SEPOMEX occasionally answers with a
       * blank city, and blanking a field the customer already filled is a
       * regression dressed as an autocomplete.
       */
      const values: AddressFormValues = {
        ...state.values,
        province: action.province || state.values.province,
        city: action.city || state.values.city,
      }

      const keptColonia = values.address_2.trim()

      return {
        ...state,
        values,
        cpStatus: "found",
        colonias: action.colonias,
        coloniasPostalCode: action.postalCode,
        lookedUpPostalCode: action.postalCode,
        /**
         * A colonia the customer already has that is NOT in the returned list
         * (typically a saved address, or one SEPOMEX does not know) survives as
         * free text instead of being silently wiped by a dropdown that has no
         * option matching it.
         */
        coloniaManual:
          keptColonia !== "" && !action.colonias.includes(keptColonia),
      }
    }

    case "CP_LOOKUP_NOT_FOUND":
      if (isStale(state, action.postalCode)) {
        return state
      }

      return {
        ...state,
        cpStatus: "not_found",
        colonias: [],
        coloniasPostalCode: null,
        lookedUpPostalCode: action.postalCode,
        /**
         * Free text is the ONLY way forward once the lookup missed, so the
         * colonia input must be a text field — but whatever the customer
         * already typed is kept.
         */
        coloniaManual: true,
      }

    case "CP_LOOKUP_DISCARDED":
      return withoutColonias(state)

    default: {
      const exhaustive: never = action
      return exhaustive
    }
  }
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/**
 * Whether the SEPOMEX lookup should run for the postal code currently in the
 * form.
 *
 * Two clauses, and the second is the dedupe: a five-digit code we have ALREADY
 * asked about — whether it hit or missed — is not asked about again. The
 * component re-runs its effect for reasons that have nothing to do with the
 * postal code changing, and without this every one of them would spend a round
 * trip.
 */
export function selectShouldLookUpPostalCode(state: AddressFormState): boolean {
  const cp = state.values.postal_code.trim()

  return (
    MX_POSTAL_CODE_PATTERN.test(cp) && cp !== state.lookedUpPostalCode
  )
}

/**
 * Whether the colonia control is the dropdown rather than a text input.
 *
 * The `coloniasPostalCode` comparison is not redundant with the reducer. A
 * five-digit code deliberately KEEPS the previous list while its own answer is
 * in flight (so the control does not blink), and this is what stops that
 * still-held list from being offered for the wrong postal code.
 */
export function selectShowColoniaSelect(state: AddressFormState): boolean {
  return (
    state.colonias.length > 0 &&
    state.coloniasPostalCode === state.values.postal_code.trim() &&
    !state.coloniaManual
  )
}

/** The hint under the colonia control, or `null` when there is nothing to say. */
export function selectPostalCodeHint(state: AddressFormState): string | null {
  if (state.cpStatus === "loading") {
    return POSTAL_CODE_HINTS.loading
  }

  if (state.cpStatus === "not_found") {
    return POSTAL_CODE_HINTS.notFound
  }

  return null
}

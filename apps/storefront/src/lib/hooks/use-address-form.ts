"use client"

import { useEffect, useMemo, useReducer, useRef } from "react"

import { getPostalCode } from "@lib/data/postal-code"
import {
  AddressFormField,
  AddressFormState,
  AddressFormValues,
  addressFormReducer,
  initAddressFormState,
  selectPostalCodeHint,
  selectShouldLookUpPostalCode,
  selectShowColoniaSelect,
  toAddressFormValues,
} from "@lib/util/address-form"

/**
 * Wiring for the account address form. NO RULES.
 *
 * Every decision this file appears to make is a pure function exported by
 * `@lib/util/address-form` and contradicted by `address-form.spec.ts`. That
 * split is not tidiness: the vitest runner here is `environment: "node"` with
 * no jsdom and no `@testing-library` (see `vitest.config.ts`), so a rule left
 * inside a hook is a rule nothing in CI can check.
 *
 * What is left here is genuinely un-testable and genuinely small: a `useReducer`,
 * one effect that calls SEPOMEX, and a ref that stops the same postal code being
 * requested twice.
 */
export type UseAddressFormResult = {
  state: AddressFormState
  values: AddressFormValues
  /** The colonias the last lookup returned. Only render these when {@link showColoniaSelect}. */
  colonias: string[]
  setField: (field: AddressFormField, value: string) => void
  requestManualColonia: () => void
  showColoniaSelect: boolean
  postalCodeHint: string | null
}

export function useAddressForm(
  address?: Partial<
    Record<AddressFormField, string | null | undefined>
  > | null,
  defaultCountryCode?: string | null
): UseAddressFormResult {
  /**
   * Lazy init, and the initializer is called with the seed rather than closing
   * over it. `useReducer` runs it once; a fresh object built inline on every
   * render would be discarded on all but the first, which reads as a bug the
   * next time someone changes it.
   */
  const [state, dispatch] = useReducer(
    addressFormReducer,
    toAddressFormValues(address, defaultCountryCode),
    initAddressFormState
  )

  /**
   * The latest state, readable from inside the effect without re-running it on
   * every keystroke. The effect's dependency is the postal code alone, because
   * that is the only input that can make a lookup newly necessary — but
   * `selectShouldLookUpPostalCode` also reads `lookedUpPostalCode`, which moves
   * as a RESULT of the effect and must not be a dependency of it.
   */
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const postalCode = state.values.postal_code

  /**
   * Dedupe guard for the EXTERNAL call, separate from the reducer's
   * `lookedUpPostalCode`. React may re-run an effect for reasons that have
   * nothing to do with the value changing, and the reducer only learns about a
   * request once `CP_LOOKUP_STARTED` has been dispatched — which is one render
   * too late to stop a second fetch in the same tick.
   */
  const requested = useRef("")

  useEffect(() => {
    const cp = (postalCode || "").trim()

    if (!selectShouldLookUpPostalCode(stateRef.current)) {
      return
    }

    if (cp === requested.current) {
      return
    }
    requested.current = cp

    dispatch({ type: "CP_LOOKUP_STARTED", postalCode: cp })

    /**
     * Every path dispatches, unconditionally. There is no cleanup flag and no
     * early return: a lookup that STARTED must always reach a terminal action,
     * because `CP_LOOKUP_STARTED` is what puts the status into `"loading"` and
     * nothing else takes it out. Whether the answer is still WANTED is the
     * reducer's call, made against the postal code carried on the action.
     *
     * The checkout learned this the expensive way — a `cancelled` flag set from
     * a cleanup function pinned `cpStatus` at `"loading"` with no lookup in
     * flight and no order placeable until a reload. See the note above
     * `lastLookedUpCp` in `checkout-context.tsx`.
     */
    getPostalCode(cp)
      .then((result) => {
        if (!result || !result.found) {
          dispatch({ type: "CP_LOOKUP_NOT_FOUND", postalCode: cp })
          return
        }

        dispatch({
          type: "CP_LOOKUP_FOUND",
          postalCode: cp,
          province: result.state || "",
          city: result.city || "",
          colonias: result.colonias || [],
        })
      })
      .catch(() => {
        /**
         * A lookup failure degrades to manual entry. `getPostalCode` already
         * swallows its own errors and returns `null`, so this only catches a
         * transport failure of the server action itself — but a form that hangs
         * on `"loading"` because nobody caught it is the worse outcome.
         */
        dispatch({ type: "CP_LOOKUP_NOT_FOUND", postalCode: cp })
      })
  }, [postalCode])

  return useMemo(
    () => ({
      state,
      values: state.values,
      colonias: state.colonias,
      setField: (field: AddressFormField, value: string) =>
        dispatch({ type: "FIELD_CHANGE", field, value }),
      requestManualColonia: () =>
        dispatch({ type: "COLONIA_MANUAL_REQUESTED" }),
      showColoniaSelect: selectShowColoniaSelect(state),
      postalCodeHint: selectPostalCodeHint(state),
    }),
    [state]
  )
}

"use client"

import type { CheckoutFieldAnchor } from "@lib/util/checkout-readiness"
import { useCallback } from "react"

import { useCheckoutState } from "./checkout-context"
import { selectHighlightedAnchors } from "./checkout-reducer"

/**
 * Whether a given control is currently one of the ones stopping the order.
 *
 * A predicate rather than the list itself, because every consumer asks about
 * ONE anchor and `includes` at the call site is nine copies of the same
 * lookup — and the ninth is the one that gets written as `indexOf(...) > -1`
 * against the wrong array.
 *
 * ## Nothing is memoised here, deliberately
 *
 * `selectHighlightedAnchors` short-circuits to a shared empty array while
 * `blockedAt` is zero, which is the entire lifetime of a checkout nobody has
 * pressed the CTA on — i.e. every keystroke of every session that never gets
 * refused. Only after a refusal does it run the catalogue, and only for the
 * components subscribed to `CheckoutStateContext`, which are the field
 * components that re-render on those keystrokes anyway (W6).
 *
 * A `useMemo` here would add a dependency array that has to be right, over a
 * pure function that is already cheap in the case that matters.
 */
export function useCheckoutHighlight(): (
  anchor: CheckoutFieldAnchor
) => boolean {
  const highlighted = selectHighlightedAnchors(useCheckoutState())

  return useCallback(
    (anchor: CheckoutFieldAnchor) => highlighted.includes(anchor),
    [highlighted]
  )
}

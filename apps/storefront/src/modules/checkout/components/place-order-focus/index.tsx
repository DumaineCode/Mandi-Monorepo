"use client"

import { useCheckoutState } from "@modules/checkout/state/checkout-context"
import { selectFocusAnchor } from "@modules/checkout/state/checkout-reducer"
import { useEffect, useRef } from "react"

import { CHECKOUT_ANCHOR_ATTR } from "../field-anchor"

/**
 * Takes the customer to the first thing stopping their order, when the CTA is
 * refused.
 *
 * ## Why this exists at all
 *
 * The CTA is no longer disabled when something is missing (see
 * `selectPlaceOrderView.disabled`). A live button that refuses has to answer
 * the question it just raised, and the itemized sentence under it only answers
 * it for a customer who can see the sentence. On mobile the sticky bar is
 * pinned over a form the customer has scrolled well past, so the field being
 * complained about is routinely several screens away. Ringing it is useless if
 * nobody scrolls to the ring.
 *
 * ## Rendered ONCE, and not inside `PlaceOrderBar`
 *
 * `PlaceOrderBar` renders twice — `inline` and `sticky` — and both are mounted
 * at every viewport (only their CSS differs). An effect living there would run
 * twice per refusal and race itself: two `scrollIntoView` calls and two
 * `focus()` calls in the same tick, with the loser deciding where the page
 * ends up. This component renders `null` and is mounted once by `CheckoutForm`.
 *
 * ## Everything decided here is a fact, not a rule
 *
 * WHICH control to go to is `selectFocusAnchor`, in the reducer, where a spec
 * can contradict it. What is left is DOM mechanics, which is the part no node
 * runner can test and therefore the part that must not contain judgement.
 */
const PlaceOrderFocus = () => {
  const state = useCheckoutState()
  const anchor = selectFocusAnchor(state)
  const blockedAt = state.blockedAt

  /**
   * Read through a ref so the effect can depend on `blockedAt` ALONE.
   *
   * The anchor changes as the customer fixes fields — that is the whole point
   * of recomputing the highlight — and a `[blockedAt, anchor]` dependency would
   * therefore yank the page to the next offending field on the keystroke that
   * fixed the previous one. The customer would be scrolled away from the input
   * they are still typing in.
   *
   * Scrolling is a response to a PRESS, and `blockedAt` is the press.
   */
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor

  useEffect(() => {
    if (blockedAt === 0) {
      return
    }

    const target = anchorRef.current

    if (!target) {
      return
    }

    const element = document.querySelector<HTMLElement>(
      `[${CHECKOUT_ANCHOR_ATTR}="${CSS.escape(target)}"]`
    )

    if (!element) {
      return
    }

    /**
     * `preventScroll` and then an explicit `scrollIntoView`, in that order.
     *
     * `focus()` scrolls on its own, to the browser's choice of position —
     * usually the nearest edge, which on mobile puts the field directly under
     * the sticky CTA bar that is covering the bottom of the viewport. Doing
     * both without suppressing the first gives two competing scrolls and a
     * visible jump. `block: "center"` is the one position guaranteed to clear
     * both the sticky bar and the header.
     *
     * Focus is attempted on every anchor, including the `<section>` ones for
     * "choose a shipping method". `focus()` on an element with no tabindex is
     * a no-op rather than an error, so those scroll and leave focus where it
     * was — which is correct: there is no single control to put a caret in, and
     * moving focus to a non-interactive container would strand a keyboard user
     * outside the tab order.
     */
    element.focus({ preventScroll: true })

    element.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "center",
    })
  }, [blockedAt])

  return null
}

export default PlaceOrderFocus

import type { CheckoutFieldAnchor } from "@lib/util/checkout-readiness"

/**
 * The wiring between "what is missing" and the control the customer has to go
 * and fix — the DOM half of {@link CheckoutFieldAnchor}.
 *
 * Nothing here decides anything. WHICH controls are wrong is
 * `getMissingFieldAnchors`, in a module the node runner can load; this file
 * only turns that answer into attributes. Anything resembling a rule that ends
 * up here is a rule no spec can contradict, which is the failure mode every
 * docstring in this checkout is about.
 */

/**
 * Queried by `place-order-focus` to find the control to scroll to, so the value
 * must land on the FOCUSABLE element and not on a wrapper. That is what
 * {@link anchorProps} guarantees: it spreads onto the `<input>` / `<select>`
 * itself, never onto the label or the field's container.
 *
 * Section-level anchors (`shipping_method`, `payment_method`, `card_details`)
 * are the exception and sit on a `<section>`, because there is no single input
 * to ring for "choose a shipping method". Those are scrolled to but not
 * focused — see the focus helper for why moving focus to a non-interactive
 * element is worse than leaving it alone.
 */
export const CHECKOUT_ANCHOR_ATTR = "data-checkout-anchor"

/**
 * The ring, and why it is a RING and not a border.
 *
 * `clx` in this repo is plain `clsx` with no tailwind-merge, so a
 * `border-rose-400` passed as `className` does not replace the `border-line`
 * already baked into `Input` — both classes land on the element and which one
 * wins is decided by Tailwind's own output order, which is not something a
 * component should be betting a validation state on.
 *
 * `ring-*` has no such conflict: the base styles only set a ring under
 * `focus:`, so this is unopposed while the field is idle and simply replaced
 * while it is focused — which is the right precedence anyway, since a focused
 * field is one the customer is already fixing.
 */
export const HIGHLIGHT_CLASS =
  "ring-2 ring-rose-400 ring-offset-1 ring-offset-paper"

/**
 * Everything a highlightable control needs, in one spread.
 *
 * `aria-invalid` rather than a second visual cue: a screen-reader user gets the
 * same information the ring gives a sighted one, from the field itself, at the
 * moment they land on it. It is `undefined` — not `false` — when the field is
 * fine, so the attribute is absent rather than present-and-negative.
 *
 * The sentence explaining WHY is not repeated per field. It is already in the
 * `role="status"` list under the CTA, which announces on change; duplicating it
 * onto ten inputs would make a screen reader read the same complaint ten times
 * as the customer tabs through a form they are trying to correct.
 */
export const anchorProps = (
  anchor: CheckoutFieldAnchor,
  highlighted: boolean
) => ({
  [CHECKOUT_ANCHOR_ATTR]: anchor,
  "aria-invalid": highlighted || undefined,
  className: highlighted ? HIGHLIGHT_CLASS : undefined,
})

"use client"

import type { MissingRequirement } from "@lib/util/checkout-readiness"

/**
 * What is still stopping the order, itemized (R8 / S9, task 2c.15).
 *
 * ## Why it lives OUTSIDE the button and is always in the DOM
 *
 * A `disabled` button is removed from the tab order and skipped by screen
 * readers. A customer using one who tabs through the checkout would reach the
 * legal text, then the summary, and never learn that the CTA exists or why it
 * will not move. Putting the explanation inside the button would therefore
 * defeat R8 entirely — the one requirement this component exists to satisfy.
 *
 * The container is rendered unconditionally, empty when there is nothing to
 * say, because `aria-live` only announces changes to a region that was ALREADY
 * present. A region mounted at the same moment its first message arrives is a
 * region that announces nothing.
 *
 * `aria-disabled` is deliberately NOT added alongside `disabled` on the button:
 * the pair is redundant, and the explanation lives here.
 *
 * ## Order is the catalogue's, not this component's
 *
 * `getMissingOrderRequirements` returns its entries top-to-bottom by page
 * position so the list matches the order the customer will scan. Sorting,
 * filtering or deduplicating here would break that, silently, and the ordering
 * is asserted in `checkout-readiness.spec.ts` rather than here — this file is a
 * `.tsx` and the node-only runner cannot load it.
 */
const MissingItemsList = ({
  items,
  className,
  announce = true,
  "data-testid": dataTestId,
}: {
  items: readonly MissingRequirement[]
  className?: string
  /**
   * Whether this instance is the live region for its viewport.
   *
   * Exactly one must be, and on mobile there are now two instances: the
   * complete list in page flow (R8 / S9) and the sticky bar's single-line
   * echo of its first entry (D9). Announcing both would read the same sentence
   * twice, the second time as a strict prefix of the first. The IN-FLOW list
   * keeps the live region because it is the complete one; the bar's line is a
   * visual restatement for the sighted customer whose full list has scrolled
   * off screen.
   *
   * On desktop the sticky bar does not render at all, so the in-flow list is
   * the only instance either way.
   */
  announce?: boolean
  "data-testid"?: string
}) => (
  <div
    {...(announce
      ? { role: "status" as const, "aria-live": "polite" as const }
      : { "aria-hidden": true as const })}
    className={className}
    data-testid={dataTestId}
  >
    {items.length > 0 && (
      <ul className="flex flex-col gap-y-1">
        {items.map((item) => (
          <li key={item.code} className="txt-small text-ink-muted">
            {item.message}
          </li>
        ))}
      </ul>
    )}
  </div>
)

export default MissingItemsList

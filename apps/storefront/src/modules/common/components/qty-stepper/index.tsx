"use client"

import { clx } from "@modules/common/components/ui"

type QtyStepperProps = {
  /** Current quantity to display. */
  quantity: number
  /** Called when the user taps the increase (+) control. */
  onIncrease: () => void
  /** Called when the user taps the decrease (−) control. */
  onDecrease: () => void
  /** Disables both controls (e.g. while a mutation is pending). */
  disabled?: boolean
  /**
   * Visual variant:
   * - "sm": compact inline stepper for cart line items
   *   (1.5px ink border, rounded-10, segmented look — matches Tienda C wireframe).
   * - "md": fuller bar with coral "+" accent for the catalog quick-add control.
   */
  size?: "sm" | "md"
  /** Optional className for the outer container. */
  className?: string
  /** Accessible label describing what is being counted (e.g. product title). */
  "aria-label"?: string
}

/**
 * Shared, PRESENTATIONAL quantity stepper: [−] qty [+].
 *
 * The parent owns the actual quantity state and any optimistic/server mutation
 * logic — this component only renders the controls and forwards intent via the
 * onIncrease / onDecrease callbacks. This keeps it reusable across the cart
 * line item and the catalog quick-add control without coupling to either's
 * mutation flow.
 *
 * Accessibility:
 * - Spanish aria-labels on the +/− controls.
 * - The quantity value is announced via aria-live="polite".
 * - focus-visible rings and motion-reduce variants on every interactive part.
 */
export default function QtyStepper({
  quantity,
  onIncrease,
  onDecrease,
  disabled = false,
  size = "sm",
  className,
  "aria-label": ariaLabel,
}: QtyStepperProps) {
  if (size === "md") {
    // Catalog quick-add bar: full-width, coral "+" accent.
    return (
      <div
        className={clx(
          "flex h-11 w-full items-center justify-between rounded-xl border border-line bg-paper p-1",
          "transition-[opacity] duration-200 motion-reduce:transition-none",
          { "opacity-70": disabled },
          className
        )}
      >
        <button
          type="button"
          onClick={onDecrease}
          disabled={disabled}
          aria-label="Disminuir cantidad"
          className={clx(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg text-ink",
            "transition-colors hover:bg-cream hover:text-coral disabled:opacity-60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral",
            "motion-reduce:transition-none"
          )}
        >
          −
        </button>
        <span
          aria-live="polite"
          aria-label={ariaLabel}
          className="flex-1 text-center font-bricolage text-base font-bold tabular-nums text-ink"
        >
          {quantity}
        </span>
        <button
          type="button"
          onClick={onIncrease}
          disabled={disabled}
          aria-label="Aumentar cantidad"
          className={clx(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-coral text-lg text-coral-foreground",
            "transition-colors hover:bg-coral-hover disabled:opacity-60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-1 focus-visible:ring-offset-paper",
            "motion-reduce:transition-none"
          )}
        >
          +
        </button>
      </div>
    )
  }

  // Compact cart line-item stepper: segmented, 1.5px ink border, rounded-10.
  return (
    <div
      className={clx(
        "inline-flex items-center overflow-hidden rounded-[10px] border-[1.5px] border-ink",
        "transition-opacity duration-200 motion-reduce:transition-none",
        { "opacity-60": disabled },
        className
      )}
    >
      <button
        type="button"
        onClick={onDecrease}
        disabled={disabled}
        aria-label="Disminuir cantidad"
        className={clx(
          "flex h-9 min-w-9 items-center justify-center px-3 text-lg leading-none text-ink",
          "transition-colors hover:bg-cream hover:text-coral disabled:opacity-50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-coral",
          "motion-reduce:transition-none"
        )}
      >
        −
      </button>
      <span
        aria-live="polite"
        aria-label={ariaLabel}
        className="flex h-9 min-w-9 items-center justify-center border-x-[1.5px] border-ink px-3 text-sm font-semibold tabular-nums text-ink"
      >
        {quantity}
      </span>
      <button
        type="button"
        onClick={onIncrease}
        disabled={disabled}
        aria-label="Aumentar cantidad"
        className={clx(
          "flex h-9 min-w-9 items-center justify-center px-3 text-lg leading-none text-ink",
          "transition-colors hover:bg-cream hover:text-coral disabled:opacity-50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-coral",
          "motion-reduce:transition-none"
        )}
      >
        +
      </button>
    </div>
  )
}

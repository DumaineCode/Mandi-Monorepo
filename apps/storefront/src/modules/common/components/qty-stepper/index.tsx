"use client"

import type { ReactNode } from "react"

import { clx } from "@modules/common/components/ui"
import Trash from "@modules/common/icons/trash"

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
  /**
   * Center content for the "md" bar. Defaults to the raw quantity. Lets the
   * caller render richer copy ("2 en el carrito") without this component
   * knowing anything about carts.
   */
  label?: ReactNode
  /**
   * What the left control DOES on the "md" bar:
   * - "minus": decrements (default).
   * - "remove": removes the line entirely — renders a trash icon so a
   *   destructive action is never disguised as a decrement.
   */
  decreaseVariant?: "minus" | "remove"
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
  label,
  decreaseVariant = "minus",
  className,
  "aria-label": ariaLabel,
}: QtyStepperProps) {
  if (size === "md") {
    // Catalog quick-add bar: full-width outlined coral pill signalling
    // "this is already in your cart", with the +/− controls at the edges.
    const isRemove = decreaseVariant === "remove"

    return (
      <div
        className={clx(
          "flex h-11 w-full items-center justify-between rounded-xl border-[1.5px] border-coral bg-paper p-1",
          "transition-[opacity] duration-200 motion-reduce:transition-none",
          { "opacity-70": disabled },
          className
        )}
      >
        <button
          type="button"
          onClick={onDecrease}
          disabled={disabled}
          aria-label={isRemove ? "Quitar del carrito" : "Disminuir cantidad"}
          className={clx(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg text-ink",
            "transition-colors hover:bg-cream hover:text-coral disabled:opacity-60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral",
            "motion-reduce:transition-none"
          )}
        >
          {isRemove ? <Trash size={17} /> : "−"}
        </button>
        <span
          aria-live="polite"
          aria-label={ariaLabel}
          className="min-w-0 flex-1 truncate px-1 text-center font-bricolage text-sm font-bold tabular-nums text-ink"
        >
          {label ?? quantity}
        </span>
        <button
          type="button"
          onClick={onIncrease}
          disabled={disabled}
          aria-label="Aumentar cantidad"
          className={clx(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg text-ink",
            "transition-colors hover:bg-cream hover:text-coral disabled:opacity-60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral",
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

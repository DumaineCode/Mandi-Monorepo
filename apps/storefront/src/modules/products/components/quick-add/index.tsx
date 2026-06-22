"use client"

import { addToCart, deleteLineItem, updateLineItem } from "@lib/data/cart"
import { clx } from "@modules/common/components/ui"
import { useEffect, useState, useTransition } from "react"

type QuickAddButtonProps = {
  variantId: string
  countryCode: string
  lineId?: string
  quantity: number
}

/**
 * Quick-add control for catalog product cards (ref wireframe Tienda C, CATÁLOGO).
 *
 * Full-width control that occupies its own bar below the price:
 * - quantity === 0 (or no lineId) → full-width coral "+" trigger button.
 * - quantity > 0 → the trigger EXPANDS IN PLACE into a full-width stepper bar
 *   [−] (left) · qty (center) · [+] (right), reflecting the REAL cart quantity.
 *   The +/− controls are large, comfortable tap targets (≥40px) on mobile.
 *
 * All mutations hit real server actions (addToCart / updateLineItem / deleteLineItem)
 * wrapped in useTransition for pending state. Local optimistic state gives instant
 * feedback; it reconciles with the server value once revalidation re-renders the
 * parent server component with fresh `quantity`/`lineId` props.
 *
 * Client component: only imports the "use server" cart actions — no server-only modules.
 */
export default function QuickAddButton({
  variantId,
  countryCode,
  lineId,
  quantity,
}: QuickAddButtonProps) {
  const [isPending, startTransition] = useTransition()
  // Optimistic quantity for instant UI feedback. Reconciles with the server
  // `quantity` prop after revalidation re-renders the parent.
  const [optimisticQty, setOptimisticQty] = useState(quantity)

  // Keep optimistic state in sync when the server prop changes (after revalidate).
  useEffect(() => {
    setOptimisticQty(quantity)
  }, [quantity])

  const displayQty = isPending ? optimisticQty : quantity

  const handleAdd = () => {
    setOptimisticQty(1)
    startTransition(async () => {
      await addToCart({ variantId, quantity: 1, countryCode })
    })
  }

  const handleIncrease = () => {
    if (!lineId) {
      return
    }
    const next = displayQty + 1
    setOptimisticQty(next)
    startTransition(async () => {
      await updateLineItem({ lineId, quantity: next })
    })
  }

  const handleDecrease = () => {
    if (!lineId) {
      return
    }
    if (displayQty <= 1) {
      setOptimisticQty(0)
      startTransition(async () => {
        await deleteLineItem(lineId)
      })
      return
    }
    const next = displayQty - 1
    setOptimisticQty(next)
    startTransition(async () => {
      await updateLineItem({ lineId, quantity: next })
    })
  }

  // No quantity yet → full-width coral "+" trigger button.
  if (displayQty <= 0) {
    return (
      <button
        type="button"
        onClick={handleAdd}
        disabled={isPending}
        aria-label="Agregar al carrito"
        className={clx(
          "flex h-11 w-full items-center justify-center rounded-xl bg-coral text-xl font-semibold text-white",
          "transition-[background-color,transform] duration-200 hover:bg-coral-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
          "motion-safe:active:scale-[0.98] disabled:opacity-60",
          "motion-reduce:transition-none"
        )}
      >
        +
      </button>
    )
  }

  // Has quantity → full-width stepper bar [−] · qty · [+].
  return (
    <div
      className={clx(
        "flex h-11 w-full items-center justify-between rounded-xl border border-line bg-paper p-1",
        "transition-[opacity,background-color] duration-200 motion-reduce:transition-none",
        { "opacity-70": isPending }
      )}
    >
      <button
        type="button"
        onClick={handleDecrease}
        disabled={isPending}
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
        className="flex-1 text-center font-bricolage text-base font-bold tabular-nums text-ink"
      >
        {displayQty}
      </span>
      <button
        type="button"
        onClick={handleIncrease}
        disabled={isPending}
        aria-label="Aumentar cantidad"
        className={clx(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-coral text-lg text-white",
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

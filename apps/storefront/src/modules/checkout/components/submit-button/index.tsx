"use client"

import { Button, clx } from "@modules/common/components/ui"
import React from "react"
import { useFormStatus } from "react-dom"

// Accessible coral brand override for storefront form CTAs. The lighter coral
// keeps small ink text above WCAG AA, including its darker hover state.
// Uses `!` so it wins over the shared primary's `bg-black text-white`.
// Exported as the single source of truth for the coral CTA surface — imported
// by payment-button, payment, and shipping so the base coral classes stay
// identical everywhere (per-site layout classes like `mt-6` are composed on top).
export const CORAL_CTA =
  "!bg-coral-light !text-ink hover:!bg-coral-hover rounded-large"

export function SubmitButton({
  children,
  variant = "primary",
  size = "medium",
  className,
  "data-testid": dataTestId,
}: {
  children: React.ReactNode
  variant?: "primary" | "secondary" | "transparent" | null
  size?: "small" | "medium" | "large"
  className?: string
  "data-testid"?: string
}) {
  const { pending } = useFormStatus()

  const resolvedVariant = variant || "primary"

  return (
    <Button
      size={size}
      className={clx(resolvedVariant === "primary" && CORAL_CTA, className)}
      type="submit"
      isLoading={pending}
      variant={resolvedVariant}
      data-testid={dataTestId}
    >
      {children}
    </Button>
  )
}

import { HttpTypes } from "@medusajs/types"

export type CheckoutStep = "address" | "delivery" | "payment"

/**
 * Is the shipping contact complete enough to LEAVE the address step?
 *
 * `phone` is part of this predicate, not decoration. The address `<form>` (and
 * with it the required phone input) renders ONLY while `step === "address"`
 * (`checkout/components/addresses/index.tsx`). The previous predicate looked at
 * `address_1` + `email` only, so any cart that already had those jumped straight
 * to `delivery` and the required phone input was never rendered, never
 * validated, never submitted.
 *
 * That is exactly the cohort that caused the incident this fix exists for: every
 * pre-existing cart, every address applied through `AddressSelect` (which copies
 * `address?.phone || ""` from a saved address that may have none), and every
 * cart whose address came from the store API. They could still place an order
 * with `phone: ""`, and the Skydropx origin/destination pre-flight would then
 * block the label AFTER the sale.
 *
 * Blank-vs-present only, deliberately: FORMAT is the input's `pattern` job
 * (`lib/util/phone.ts`) and the backend normalizes before the wire. Re-checking
 * the format here would risk trapping a customer in a step they cannot leave —
 * the same over-strictness that made the phone `pattern` a revenue stopper.
 *
 * Whitespace counts as absent, consistently with the backend guards.
 */
export function hasCompleteShippingContact(
  cart?: HttpTypes.StoreCart | null
): boolean {
  const address = cart?.shipping_address
  return Boolean(
    address?.address_1?.trim() && cart?.email?.trim() && address?.phone?.trim()
  )
}

/**
 * The checkout step a cart should resume at.
 *
 * Single source of truth: keep every "where does this cart belong" decision
 * here, so a second copy cannot drift away from the completeness rule above.
 */
export function getCheckoutStep(cart?: HttpTypes.StoreCart | null): CheckoutStep {
  if (!hasCompleteShippingContact(cart)) {
    return "address"
  }
  if (cart?.shipping_methods?.length === 0) {
    return "delivery"
  }
  return "payment"
}

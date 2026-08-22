import { HttpTypes } from "@medusajs/types"

export type CartLineByVariant = Map<
  string,
  { lineId: string; quantity: number }
>

/**
 * Builds a variant_id -> { lineId, quantity } lookup so a product card can
 * reflect the REAL cart quantity for its single variant in O(1).
 *
 * Shared by every place that renders `ProductPreview` cards against a cart
 * (catalog, categories, home best-sellers) so quick-add state is computed
 * the same way everywhere instead of re-implemented per caller.
 */
export function buildCartLineByVariant(
  cart: HttpTypes.StoreCart | null
): CartLineByVariant {
  const cartLineByVariant: CartLineByVariant = new Map()

  for (const item of cart?.items ?? []) {
    const variantId = item.variant_id ?? item.variant?.id
    if (variantId) {
      cartLineByVariant.set(variantId, {
        lineId: item.id,
        quantity: item.quantity,
      })
    }
  }

  return cartLineByVariant
}

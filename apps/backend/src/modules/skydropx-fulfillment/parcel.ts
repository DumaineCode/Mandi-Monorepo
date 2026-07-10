/**
 * Deterministic single-parcel aggregation (design §5.2).
 *
 * Pure function — no I/O, no Medusa imports — so the quote and label paths
 * share exactly the same parcel math. Medusa stores dimensions in cm and
 * weight in grams (starter convention, documented in the runbook); Skydropx
 * expects kg + cm.
 */
import { SkydropxParcel } from "./types"

/**
 * One cart/fulfillment line in Medusa units (grams / cm).
 * Nullable fields mirror Medusa variants where dims are optional.
 */
export interface ParcelItem {
  quantity: number
  /** Variant weight in grams. */
  weight?: number | null
  /** Variant dimensions in cm. */
  length?: number | null
  width?: number | null
  height?: number | null
}

/**
 * Thrown when ANY item is missing weight or a dimension (or has a
 * non-positive value). The service translates this into a graceful
 * quote failure (SD-3) — checkout never blocks, manual options remain.
 */
export class MissingDimensionsError extends Error {
  constructor(message = "One or more items are missing weight or dimensions") {
    super(message)
    this.name = "MissingDimensionsError"
  }
}

const isMissing = (value: number | null | undefined): value is null | undefined =>
  typeof value !== "number" || !Number.isFinite(value) || value <= 0

/** Round up to 2 decimals without FP drift (operates on integer-ish grams). */
const ceilKgFromGrams = (grams: number): number => Math.ceil(grams / 10) / 100

/**
 * Aggregate all items into ONE parcel (design §5.2):
 * - weight_kg = Σ(weight_g × qty) / 1000, rounded UP 2dp, min 0.1
 * - length = max(L), width = max(W), height = Σ(H × qty) stacking heuristic;
 *   each rounded UP to integer, min 1 cm
 */
export function buildParcel(items: ParcelItem[]): SkydropxParcel {
  if (items.length === 0) {
    throw new MissingDimensionsError("No items to build a parcel from")
  }

  let totalGrams = 0
  let maxLength = 0
  let maxWidth = 0
  let stackedHeight = 0

  for (const item of items) {
    if (
      isMissing(item.weight) ||
      isMissing(item.length) ||
      isMissing(item.width) ||
      isMissing(item.height)
    ) {
      throw new MissingDimensionsError()
    }

    totalGrams += item.weight * item.quantity
    maxLength = Math.max(maxLength, item.length)
    maxWidth = Math.max(maxWidth, item.width)
    stackedHeight += item.height * item.quantity
  }

  return {
    weight: Math.max(ceilKgFromGrams(totalGrams), 0.1),
    length: Math.max(Math.ceil(maxLength), 1),
    width: Math.max(Math.ceil(maxWidth), 1),
    height: Math.max(Math.ceil(stackedHeight), 1),
  }
}

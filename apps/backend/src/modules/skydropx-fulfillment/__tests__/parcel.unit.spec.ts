/**
 * S5.1 — parcel aggregation unit tests (design §5.2, SD-3 missing-dims).
 *
 * Single aggregate parcel per cart:
 * - weight_kg = Σ(weight_g × qty) / 1000, rounded UP to 2 decimals, min 0.1
 * - length_cm = max(length), width_cm = max(width),
 *   height_cm = Σ(height × qty) (stacking heuristic); each rounded UP to
 *   integer, min 1
 * - ANY item missing weight or any dimension → MissingDimensionsError
 *
 * Fixtures are inline — jest's testMatch glob discovers every file inside
 * __tests__/, so no helper files live here (amendment INFO).
 */
import { buildParcel, MissingDimensionsError, ParcelItem } from "../parcel"

const item = (overrides: Partial<ParcelItem> = {}): ParcelItem => ({
  quantity: 1,
  weight: 500,
  length: 20,
  width: 15,
  height: 10,
  ...overrides,
})

describe("buildParcel", () => {
  it("aggregates a multi-item cart: summed weight, max L/W, stacked height", () => {
    const parcel = buildParcel([
      item({ quantity: 2 }), // 2 × 500g, 20×15×10
      item({ weight: 230, length: 24.3, width: 10, height: 4.5 }),
    ])

    expect(parcel).toEqual({
      weight: 1.23, // (500×2 + 230) / 1000
      length: 25, // max(20, 24.3) → ceil
      width: 15, // max(15, 10)
      height: 25, // 10×2 + 4.5×1 = 24.5 → ceil
    })
  })

  it("rounds the aggregate weight UP to 2 decimals", () => {
    // 617g × 2 = 1234g → 1.234 kg → 1.24 (never 1.23)
    const parcel = buildParcel([item({ weight: 617, quantity: 2 })])

    expect(parcel.weight).toBe(1.24)
  })

  it("applies the 0.1 kg weight minimum", () => {
    const parcel = buildParcel([item({ weight: 50 })])

    expect(parcel.weight).toBe(0.1)
  })

  it("keeps exact values unchanged (no over-rounding)", () => {
    // 1000g → exactly 1 kg; integer dims stay as-is
    const parcel = buildParcel([item({ weight: 1000 })])

    expect(parcel).toEqual({ weight: 1, length: 20, width: 15, height: 10 })
  })

  it("rounds each dimension UP to an integer", () => {
    const parcel = buildParcel([
      item({ length: 20.01, width: 15.9, height: 10.2 }),
    ])

    expect(parcel.length).toBe(21)
    expect(parcel.width).toBe(16)
    expect(parcel.height).toBe(11)
  })

  it("applies the 1 cm minimum per dimension", () => {
    const parcel = buildParcel([item({ length: 0.5, width: 0.4, height: 0.3 })])

    expect(parcel.length).toBe(1)
    expect(parcel.width).toBe(1)
    expect(parcel.height).toBe(1)
  })

  it("stacks height across quantity", () => {
    const parcel = buildParcel([item({ height: 10, quantity: 3 })])

    expect(parcel.height).toBe(30)
  })

  it("throws MissingDimensionsError when an item has no weight", () => {
    expect(() => buildParcel([item(), item({ weight: undefined })])).toThrow(
      MissingDimensionsError
    )
  })

  it("throws MissingDimensionsError when an item has a null dimension", () => {
    expect(() => buildParcel([item({ height: null })])).toThrow(
      MissingDimensionsError
    )
  })

  it("throws MissingDimensionsError for non-positive dimensions", () => {
    expect(() => buildParcel([item({ width: 0 })])).toThrow(
      MissingDimensionsError
    )
    expect(() => buildParcel([item({ weight: -5 })])).toThrow(
      MissingDimensionsError
    )
  })

  it("throws MissingDimensionsError for an empty item list", () => {
    expect(() => buildParcel([])).toThrow(MissingDimensionsError)
  })

  it("is deterministic for the same input", () => {
    const items = [
      item({ quantity: 2 }),
      item({ weight: 333, length: 11.1, width: 9.9, height: 3.3 }),
    ]

    expect(buildParcel(items)).toEqual(buildParcel(items))
  })
})

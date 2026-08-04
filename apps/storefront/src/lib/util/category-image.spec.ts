import { HttpTypes } from "@medusajs/types"
import { describe, expect, it } from "vitest"

import { getCategoryImage } from "./category-image"

/**
 * Medusa product categories have no native image field, so the cover lives in
 * `metadata.image_url` — a free-form jsonb column edited by hand in Admin.
 * "Edited by hand" is the whole reason this helper exists: every assertion below
 * is a shape a human can actually save from the metadata editor.
 */
const withMetadata = (metadata: unknown) =>
  ({ metadata }) as Pick<HttpTypes.StoreProductCategory, "metadata">

describe("getCategoryImage", () => {
  it("returns the URL when image_url is a non-empty string", () => {
    expect(
      getCategoryImage(withMetadata({ image_url: "/categories/cappuccinis.webp" }))
    ).toBe("/categories/cappuccinis.webp")
  })

  it("accepts absolute URLs so covers can move to a CDN without a code change", () => {
    expect(
      getCategoryImage(withMetadata({ image_url: "https://cdn.example.com/a.webp" }))
    ).toBe("https://cdn.example.com/a.webp")
  })

  /**
   * Admin writes an empty string when a metadata field is cleared rather than
   * deleted — the seeded `Frappuccinis` row carried exactly `{"image_url": ""}`.
   * Returning "" here would hand `next/image` an empty `src`, which throws at
   * render time instead of falling back to the placeholder.
   */
  it.each([
    ["missing key", {}],
    ["empty string", { image_url: "" }],
    ["whitespace only", { image_url: "   " }],
    ["null value", { image_url: null }],
    ["non-string value", { image_url: 42 }],
    ["array value", { image_url: ["/a.webp"] }],
    ["null metadata", null],
    ["undefined metadata", undefined],
  ])("returns undefined for %s", (_label, metadata) => {
    expect(getCategoryImage(withMetadata(metadata))).toBeUndefined()
  })

  it("trims incidental whitespace from a pasted URL", () => {
    expect(
      getCategoryImage(withMetadata({ image_url: "  /categories/envases.webp  " }))
    ).toBe("/categories/envases.webp")
  })

  /**
   * `image_url` is the only supported key. Earlier revisions also honoured
   * `thumbnail` and `image`, which meant three ways to express one thing and no
   * canonical answer when two disagreed. Pinning that here so the fallback chain
   * is not quietly reintroduced.
   */
  it("ignores legacy thumbnail/image keys", () => {
    expect(
      getCategoryImage(
        withMetadata({ thumbnail: "/old.webp", image: "/older.webp" })
      )
    ).toBeUndefined()
  })
})

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { HttpTypes } from "@medusajs/types"
import { describe, expect, it } from "vitest"

import ImageGallery from "."

const image = (id: string, url = `/products/${id}.jpg`) =>
  ({ id, url }) as HttpTypes.StoreProductImage

describe("ImageGallery", () => {
  it("places a horizontal thumbnail carousel below the image on mobile and a left rail on desktop", () => {
    const html = renderToStaticMarkup(
      <ImageGallery images={[image("first"), image("second")]} />
    )

    expect(html).toContain("grid-cols-1 small:grid-cols-[88px_minmax(0,1fr)]")
    expect(html).toContain("small:grid-cols-[88px_minmax(0,1fr)]")
    expect(html).toContain("small:col-start-2")
    expect(html).toContain("col-start-1 row-start-2 min-h-0 min-w-0")
    expect(html).toContain("small:row-start-1")
    expect(html).toContain("overflow-x-auto overscroll-x-contain snap-x snap-mandatory")
    expect(html).toContain("small:absolute small:inset-0 small:flex-col")
    expect(html).toContain("small:overflow-x-hidden small:overflow-y-auto")
    expect(html).toContain("small:snap-none")
    expect(html.match(/shrink-0 snap-start/g)).toHaveLength(2)
    expect(html).toContain("max-w-[480px]")
    expect(html).toContain('role="group" aria-label="Miniaturas"')
    expect(html).toContain('aria-label="Ver imagen 1" aria-current="true"')
    expect(html).toContain('aria-label="Ver imagen 2" aria-current="false"')
    expect(html).toContain("focus-visible:ring-2")
    expect(html.match(/object-fit:contain/g)).toHaveLength(3)
    expect(html).not.toContain("object-fit:cover")
  })

  it("does not reserve a thumbnail column for a single valid image", () => {
    const html = renderToStaticMarkup(
      <ImageGallery images={[image("invalid", ""), image("only")]} />
    )

    expect(html).toContain("grid-cols-1")
    expect(html).toContain("max-w-[480px]")
    expect(html).toContain(encodeURIComponent("/products/only.jpg"))
    expect(html).not.toContain("<button")
    expect(html).not.toContain("col-start-2")
  })

  it("keeps the empty placeholder compact", () => {
    const html = renderToStaticMarkup(<ImageGallery images={[]} />)

    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain("max-w-[480px]")
    expect(html).not.toContain("<img")
    expect(html).not.toContain("<button")
  })
})

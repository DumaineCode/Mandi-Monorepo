import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import Input from "."

describe("Input accessibility", () => {
  it("generates unique ids when multiple forms reuse the same field name", () => {
    const html = renderToStaticMarkup(
      <>
        <Input label="Teléfono" name="phone" />
        <Input label="Teléfono de facturación" name="phone" />
      </>
    )

    const ids = Array.from(
      html.matchAll(/<input[^>]*id="([^"]+)"/g),
      (match) => match[1]
    )

    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    ids.forEach((id) => expect(html).toContain(`for="${id}"`))
  })

  it("preserves an explicit id and associates the label with it", () => {
    const html = renderToStaticMarkup(
      <Input id="transfer-order-id" label="ID del pedido" name="order_id" />
    )

    expect(html).toContain('id="transfer-order-id"')
    expect(html).toContain('for="transfer-order-id"')
  })
})

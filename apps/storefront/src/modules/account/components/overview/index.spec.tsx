import { HttpTypes } from "@medusajs/types"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@modules/common/components/localized-client-link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode
    href: string
    [key: string]: unknown
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock("@modules/common/icons/chevron-down", () => ({
  default: ({ className }: { className?: string }) => (
    <span className={className} />
  ),
}))

import Overview from "."

const customer = {
  first_name: "Ana",
  last_name: "López",
  email: "ana@example.com",
  phone: "5512345678",
  addresses: [],
} as unknown as HttpTypes.StoreCustomer

describe("account overview order states", () => {
  it("distinguishes an order-loading failure from an empty account", () => {
    const html = renderToStaticMarkup(
      <Overview customer={customer} orders={null} />
    )

    expect(html).toContain("No pudimos cargar tus pedidos")
    expect(html).not.toContain("Aún no tienes pedidos")
  })

  it("shows the empty state only when the order request succeeds with no data", () => {
    const html = renderToStaticMarkup(
      <Overview customer={customer} orders={[]} />
    )

    expect(html).toContain("Aún no tienes pedidos")
    expect(html).not.toContain("No pudimos cargar tus pedidos")
  })
})

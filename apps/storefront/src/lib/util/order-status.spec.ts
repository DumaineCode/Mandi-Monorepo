import { describe, expect, it } from "vitest"

import { formatOrderStatus, getOrderStatusTone } from "./order-status"

describe("order status localization", () => {
  it.each([
    ["not_fulfilled", "Pendiente"],
    ["shipped", "En camino"],
    ["delivered", "Entregado"],
    ["canceled", "Cancelado"],
    ["not_paid", "Pendiente de pago"],
    ["captured", "Pagado"],
    ["refunded", "Reembolsado"],
  ])("translates %s", (status, expected) => {
    expect(formatOrderStatus(status)).toBe(expected)
  })

  it("uses a safe Spanish label when status is missing", () => {
    expect(formatOrderStatus(null)).toBe("Sin información")
  })

  it("does not leak unknown backend status tokens into the Spanish UI", () => {
    expect(formatOrderStatus("future_status")).toBe("Estado desconocido")
  })

  it.each([
    ["delivered", "success"],
    ["not_fulfilled", "warning"],
    ["canceled", "danger"],
    ["refunded", "neutral"],
    ["future_status", "neutral"],
  ] as const)("assigns %s a %s tone", (status, tone) => {
    expect(getOrderStatusTone(status)).toBe(tone)
  })
})

const ORDER_STATUS_LABELS: Record<string, string> = {
  not_fulfilled: "Pendiente",
  partially_fulfilled: "Preparado parcialmente",
  fulfilled: "Preparado",
  partially_shipped: "Enviado parcialmente",
  shipped: "En camino",
  partially_delivered: "Entregado parcialmente",
  delivered: "Entregado",
  canceled: "Cancelado",
  requires_action: "Requiere atención",
  not_paid: "Pendiente de pago",
  awaiting: "Pago en proceso",
  authorized: "Pago autorizado",
  partially_authorized: "Pago autorizado parcialmente",
  captured: "Pagado",
  partially_captured: "Pago parcial",
  partially_refunded: "Reembolso parcial",
  refunded: "Reembolsado",
}

export type OrderStatusTone = "success" | "warning" | "danger" | "neutral"

const SUCCESS_STATUSES = new Set([
  "fulfilled",
  "shipped",
  "delivered",
  "authorized",
  "captured",
])

const WARNING_STATUSES = new Set([
  "not_fulfilled",
  "partially_fulfilled",
  "partially_shipped",
  "partially_delivered",
  "not_paid",
  "awaiting",
  "partially_authorized",
  "partially_captured",
])

const DANGER_STATUSES = new Set(["canceled", "requires_action"])

export const formatOrderStatus = (status?: string | null) => {
  if (!status) {
    return "Sin información"
  }

  const translated = ORDER_STATUS_LABELS[status]

  if (translated) {
    return translated
  }

  return "Estado desconocido"
}

export const getOrderStatusTone = (status?: string | null): OrderStatusTone => {
  if (status && SUCCESS_STATUSES.has(status)) {
    return "success"
  }

  if (status && WARNING_STATUSES.has(status)) {
    return "warning"
  }

  if (status && DANGER_STATUSES.has(status)) {
    return "danger"
  }

  return "neutral"
}

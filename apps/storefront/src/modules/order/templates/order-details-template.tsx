"use client"

import { XMark } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import Help from "@modules/order/components/help"
import Items from "@modules/order/components/items"
import OrderDetails from "@modules/order/components/order-details"
import OrderSummary from "@modules/order/components/order-summary"
import ShippingDetails from "@modules/order/components/shipping-details"
import React from "react"

type OrderDetailsTemplateProps = {
  order: HttpTypes.StoreOrder
}

const OrderDetailsTemplate: React.FC<OrderDetailsTemplateProps> = ({
  order,
}) => {
  return (
    <div className="flex flex-col justify-center gap-y-5">
      <div className="flex flex-col justify-between gap-4 border-b border-line pb-6 xsmall:flex-row xsmall:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
            Mis pedidos
          </p>
          <h2 className="mt-2 font-bricolage text-3xl font-extrabold tracking-[-0.03em] text-ink">
            Detalle del pedido
          </h2>
        </div>
        <LocalizedClientLink
          href="/account/orders"
          className="flex min-h-11 items-center gap-2 self-start rounded-xl border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-coral hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral xsmall:self-auto"
          data-testid="back-to-overview-button"
        >
          <XMark /> Volver a pedidos
        </LocalizedClientLink>
      </div>
      <div
        className="flex h-full w-full flex-col gap-5"
        data-testid="order-details-container"
      >
        <OrderDetails order={order} showStatus />
        <Items order={order} headingLevel="h3" />
        <ShippingDetails order={order} headingLevel="h3" />
        <OrderSummary order={order} headingLevel="h3" />
        <Help headingLevel="h3" />
      </div>
    </div>
  )
}

export default OrderDetailsTemplate

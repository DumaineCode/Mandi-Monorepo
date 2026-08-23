"use client"

import OrderCard from "../order-card"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { HttpTypes } from "@medusajs/types"

const OrderOverview = ({ orders }: { orders: HttpTypes.StoreOrder[] }) => {
  if (orders?.length) {
    return (
      <div className="flex w-full flex-col gap-y-4">
        {orders.map((o) => (
          <div key={o.id}>
            <OrderCard order={o} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      className="flex w-full flex-col items-center rounded-2xl border border-dashed border-line bg-cream/40 p-8 text-center"
      data-testid="no-orders-container"
    >
      <h2 className="font-bricolage text-2xl font-extrabold text-ink">
        Aún no tienes pedidos
      </h2>
      <p className="max-w-md text-sm leading-6 text-ink-muted">
        Cuando hagas tu primera compra, aquí podrás consultar su avance y todos
        sus detalles.
      </p>
      <LocalizedClientLink
        href="/store"
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-coral-light px-5 py-2 font-semibold text-ink transition-colors hover:bg-coral-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
        data-testid="continue-shopping-button"
      >
        Ir a la tienda
      </LocalizedClientLink>
    </div>
  )
}

export default OrderOverview

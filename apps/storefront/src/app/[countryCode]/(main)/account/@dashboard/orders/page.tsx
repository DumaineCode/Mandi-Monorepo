import { Metadata } from "next"

import OrderOverview from "@modules/account/components/order-overview"
import { notFound } from "next/navigation"
import { listOrders } from "@lib/data/orders"
import Divider from "@modules/common/components/divider"
import TransferRequestForm from "@modules/account/components/transfer-request-form"

export const metadata: Metadata = {
  title: "Mis pedidos | MANDO",
  description: "Consulta tus pedidos y revisa el estado de cada compra.",
}

export default async function Orders() {
  const orders = await listOrders()

  if (!orders) {
    notFound()
  }

  return (
    <div className="w-full" data-testid="orders-page-wrapper">
      <header className="mb-8 border-b border-line pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
          Mi cuenta
        </p>
        <h2 className="mt-2 font-bricolage text-3xl font-extrabold tracking-[-0.03em] text-ink">
          Mis pedidos
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-muted">
          Consulta tus compras anteriores, su estado y los detalles de entrega.
        </p>
      </header>
      <div>
        <OrderOverview orders={orders} />
        <Divider className="mb-6 mt-6 !border-line" />
        <TransferRequestForm />
      </div>
    </div>
  )
}

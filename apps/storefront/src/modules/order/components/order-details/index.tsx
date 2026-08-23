import { HttpTypes } from "@medusajs/types"
import { Text } from "@modules/common/components/ui"
import { formatStoreDate } from "@lib/util/store-locale"
import OrderStatusBadge from "@modules/order/components/order-status-badge"

type OrderDetailsProps = {
  order: HttpTypes.StoreOrder
  showStatus?: boolean
}

const OrderDetails = ({ order, showStatus }: OrderDetailsProps) => {
  const orderDate = formatStoreDate(order.created_at)

  return (
    <section className="rounded-2xl border border-line bg-cream/40 p-5">
      <Text className="text-sm leading-6 text-ink-muted">
        Enviamos la confirmación y las novedades de este pedido a{" "}
        <span
          className="break-all font-semibold text-ink"
          data-testid="order-email"
        >
          {order.email}
        </span>
        .
      </Text>
      <Text className="mt-3 text-sm text-ink-muted">
        Fecha del pedido:{" "}
        <span className="font-semibold text-ink" data-testid="order-date">
          {orderDate}
        </span>
      </Text>
      <Text className="mt-2 text-sm text-ink-muted">
        Número de pedido:{" "}
        <span className="font-semibold text-ink" data-testid="order-id">
          #{order.display_id}
        </span>
      </Text>

      <div className="mt-5 flex flex-col gap-3 xsmall:flex-row xsmall:items-center">
        {showStatus && (
          <>
            <Text className="text-xs text-ink-muted">
              Estado del envío:{" "}
              <OrderStatusBadge
                status={order.fulfillment_status}
                data-testid="order-status"
              />
            </Text>
            <Text className="text-xs text-ink-muted">
              Estado del pago:{" "}
              <OrderStatusBadge
                status={order.payment_status}
                data-testid="order-payment-status"
              />
            </Text>
          </>
        )}
      </div>
    </section>
  )
}

export default OrderDetails

import { useMemo } from "react"

import Thumbnail from "@modules/products/components/thumbnail"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { convertToLocale } from "@lib/util/money"
import { HttpTypes } from "@medusajs/types"
import { formatStoreDate } from "@lib/util/store-locale"
import OrderStatusBadge from "@modules/order/components/order-status-badge"

type OrderCardProps = {
  order: HttpTypes.StoreOrder
}

const ORDER_PREVIEW_LIMIT = 3

const OrderCard = ({ order }: OrderCardProps) => {
  const numberOfLines = useMemo(() => {
    return (
      order.items?.reduce((acc, item) => {
        return acc + item.quantity
      }, 0) ?? 0
    )
  }, [order])

  const numberOfProducts = useMemo(() => {
    return order.items?.length ?? 0
  }, [order])
  const remainingProducts = numberOfProducts - ORDER_PREVIEW_LIMIT

  const createdAt = formatStoreDate(order.created_at)

  return (
    <article
      className="flex flex-col rounded-2xl border border-line bg-cream/40 p-5"
      data-testid="order-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-bricolage text-xl font-extrabold text-ink">
          Pedido #<span data-testid="order-display-id">{order.display_id}</span>
        </div>
        <OrderStatusBadge status={order.fulfillment_status} />
      </div>
      <div className="mt-2 flex flex-wrap items-center divide-x divide-line text-xs text-ink-muted">
        <span className="pr-2" data-testid="order-created-at">
          {createdAt}
        </span>
        <span className="px-2" data-testid="order-amount">
          {convertToLocale({
            amount: order.total,
            currency_code: order.currency_code,
          })}
        </span>
        <span className="pl-2">{`${numberOfLines} ${
          numberOfLines === 1 ? "artículo" : "artículos"
        }`}</span>
      </div>
      <div className="my-5 grid grid-cols-2 gap-4 xsmall:grid-cols-3">
        {order.items?.slice(0, ORDER_PREVIEW_LIMIT).map((i) => {
          return (
            <div
              key={i.id}
              className="flex min-w-0 flex-col gap-y-2"
              data-testid="order-item"
            >
              <Thumbnail
                thumbnail={i.thumbnail}
                images={i.variant?.product?.images}
                size="full"
              />
              <div className="flex min-w-0 items-center text-xs text-ink-muted">
                <span
                  className="truncate font-semibold text-ink"
                  data-testid="item-title"
                >
                  {i.title}
                </span>
                <span className="ml-2">x</span>
                <span data-testid="item-quantity">{i.quantity}</span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex flex-col items-start justify-between gap-3 border-t border-line pt-4 xsmall:flex-row xsmall:items-center">
        <span className="text-xs text-ink-muted">
          {remainingProducts > 0
            ? `${remainingProducts} ${
                remainingProducts === 1 ? "producto" : "productos"
              } más en este pedido`
            : "Consulta productos, envío y totales"}
        </span>
        <LocalizedClientLink
          href={`/account/orders/details/${order.id}`}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-coral-light px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-coral-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper xsmall:w-auto"
          data-testid="order-details-link"
        >
          Ver detalle
        </LocalizedClientLink>
      </div>
    </article>
  )
}

export default OrderCard

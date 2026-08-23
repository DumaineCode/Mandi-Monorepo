import { convertToLocale } from "@lib/util/money"
import { HttpTypes } from "@medusajs/types"
import { Heading } from "@modules/common/components/ui"

type OrderSummaryProps = {
  order: HttpTypes.StoreOrder
  headingLevel?: "h2" | "h3"
}

const OrderSummary = ({ order, headingLevel = "h2" }: OrderSummaryProps) => {
  const getAmount = (amount?: number | null) => {
    if (amount === undefined || amount === null) {
      return
    }

    return convertToLocale({
      amount,
      currency_code: order.currency_code,
    })
  }

  return (
    <section className="rounded-2xl border border-line bg-cream/40 p-5">
      <Heading
        level={headingLevel}
        className="font-bricolage !text-xl font-bold text-ink"
      >
        Resumen del pedido
      </Heading>
      <div className="mt-4 text-sm text-ink-muted">
        <div className="mb-2 flex items-center justify-between">
          <span>Subtotal</span>
          <span>{getAmount(order.subtotal)}</span>
        </div>
        <div className="flex flex-col gap-y-1">
          {order.discount_total > 0 && (
            <div className="flex items-center justify-between">
              <span>Descuento</span>
              <span>- {getAmount(order.discount_total)}</span>
            </div>
          )}
          {order.gift_card_total > 0 && (
            <div className="flex items-center justify-between">
              <span>Tarjeta de regalo</span>
              <span>- {getAmount(order.gift_card_total)}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span>Envío</span>
            <span>{getAmount(order.shipping_total)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Impuestos</span>
            <span>{getAmount(order.tax_total)}</span>
          </div>
        </div>
        <div className="my-4 h-px w-full border-b border-dashed border-line" />
        <div className="mb-2 flex items-center justify-between font-bricolage text-lg font-bold text-ink">
          <span>Total</span>
          <span>{getAmount(order.total)}</span>
        </div>
      </div>
    </section>
  )
}

export default OrderSummary

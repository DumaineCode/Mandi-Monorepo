import { Heading, Text } from "@modules/common/components/ui"

import { isStripeLike, paymentInfoMap } from "@lib/constants"
import { convertToLocale } from "@lib/util/money"
import { formatStoreDateTime } from "@lib/util/store-locale"
import { HttpTypes } from "@medusajs/types"

type PaymentDetailsProps = {
  order: HttpTypes.StoreOrder
}

const PaymentDetails = ({ order }: PaymentDetailsProps) => {
  const payment = order.payment_collections?.[0].payments?.[0]
  const paymentInfo = payment ? paymentInfoMap[payment.provider_id] : undefined
  const paidAt = payment?.created_at
    ? formatStoreDateTime(payment.created_at)
    : null

  return (
    <section className="rounded-2xl border border-line bg-paper p-5">
      <Heading
        level="h2"
        className="font-bricolage !text-xl font-bold text-ink"
      >
        Pago
      </Heading>
      <div className="mt-5">
        {payment && (
          <div className="grid w-full grid-cols-1 gap-5 xsmall:grid-cols-3">
            <div className="flex flex-col">
              <Text className="mb-1 font-semibold text-ink">
                Método de pago
              </Text>
              <Text
                className="text-sm text-ink-muted"
                data-testid="payment-method"
              >
                {paymentInfo?.title || "Método de pago"}
              </Text>
            </div>
            <div className="flex flex-col xsmall:col-span-2">
              <Text className="mb-1 font-semibold text-ink">
                Detalles del pago
              </Text>
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                {paymentInfo?.icon && (
                  <div className="flex h-fit w-fit items-center rounded-lg bg-cream px-2 py-1">
                    {paymentInfo.icon}
                  </div>
                )}
                <Text className="text-sm" data-testid="payment-amount">
                  {isStripeLike(payment.provider_id) && payment.data?.card_last4
                    ? `**** **** **** ${payment.data.card_last4}`
                    : `${convertToLocale({
                        amount: payment.amount,
                        currency_code: order.currency_code,
                      })}${paidAt ? ` · Pagado el ${paidAt}` : ""}`}
                </Text>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export default PaymentDetails

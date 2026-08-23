import { convertToLocale } from "@lib/util/money"
import { HttpTypes } from "@medusajs/types"
import { Heading, Text } from "@modules/common/components/ui"
import { formatCountryName } from "@lib/util/store-locale"

type ShippingDetailsProps = {
  order: HttpTypes.StoreOrder
  headingLevel?: "h2" | "h3"
}

const ShippingDetails = ({
  order,
  headingLevel = "h2",
}: ShippingDetailsProps) => {
  return (
    <section className="rounded-2xl border border-line bg-paper p-5">
      <Heading
        level={headingLevel}
        className="font-bricolage !text-xl font-bold text-ink"
      >
        Entrega
      </Heading>
      <div className="mt-5 grid grid-cols-1 gap-5 small:grid-cols-3">
        <div className="flex flex-col" data-testid="shipping-address-summary">
          <Text className="mb-1 font-semibold text-ink">
            Dirección de envío
          </Text>
          <Text className="text-sm text-ink-muted">
            {order.shipping_address?.first_name}{" "}
            {order.shipping_address?.last_name}
          </Text>
          <Text className="text-sm text-ink-muted">
            {order.shipping_address?.address_1}{" "}
            {order.shipping_address?.address_2}
          </Text>
          <Text className="text-sm text-ink-muted">
            {order.shipping_address?.postal_code},{" "}
            {order.shipping_address?.city}
          </Text>
          <Text className="text-sm text-ink-muted">
            {formatCountryName(
              order.shipping_address?.country_code,
              order.shipping_address?.country_code?.toUpperCase()
            )}
          </Text>
        </div>

        <div className="flex flex-col" data-testid="shipping-contact-summary">
          <Text className="mb-1 font-semibold text-ink">Contacto</Text>
          <Text className="text-sm text-ink-muted">
            {order.shipping_address?.phone}
          </Text>
          <Text className="break-all text-sm text-ink-muted">
            {order.email}
          </Text>
        </div>

        <div className="flex flex-col" data-testid="shipping-method-summary">
          <Text className="mb-1 font-semibold text-ink">Método de envío</Text>
          <Text className="text-sm text-ink-muted">
            {(order.shipping_methods?.[0] as { name?: string })?.name} (
            {convertToLocale({
              amount: order.shipping_methods?.[0].total ?? 0,
              currency_code: order.currency_code,
            })}
            )
          </Text>
        </div>
      </div>
    </section>
  )
}

export default ShippingDetails

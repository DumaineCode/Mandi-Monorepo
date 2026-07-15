import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { Heading, Text } from "@modules/common/components/ui"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Pago pendiente",
  description: "Tu pago con Mercado Pago está pendiente de confirmación.",
}

/**
 * Pending experience for Mercado Pago Checkout Pro (SF-4).
 *
 * A plain informational RSC page — it performs NO mutation. The back_url Route
 * Handlers already attempted to complete the order server-side; when the
 * payment is still pending (e.g. OXXO cash payment) the customer is sent here.
 * Confirmation is webhook-driven: when Mercado Pago notifies our backend that
 * the payment was approved, the order is completed automatically.
 */
export default async function MercadoPagoStatusPage({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params

  return (
    <div className="flex flex-col items-center justify-center gap-y-6 py-16 px-6 max-w-2xl mx-auto text-center">
      <Heading level="h1" className="text-2xl-semi">
        Tu pago está pendiente de confirmación
      </Heading>

      <Text className="text-ui-fg-subtle">
        Recibimos tu pedido, pero Mercado Pago todavía no confirmó el pago. Si
        elegiste un método en efectivo (por ejemplo OXXO), completá el pago con
        el comprobante que te dio Mercado Pago. En cuanto se confirme, tu pedido
        se procesa automáticamente y te avisamos por correo.
      </Text>

      <Text className="text-ui-fg-muted text-small-regular">
        No cierres ni recargues esta página esperando un cambio: la confirmación
        llega por una notificación de Mercado Pago a nuestro sistema, no desde
        este navegador.
      </Text>

      <div className="flex flex-col sm:flex-row gap-4 mt-2">
        <LocalizedClientLink
          href="/account/orders"
          className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
        >
          Ver el estado de mis pedidos
        </LocalizedClientLink>
        <LocalizedClientLink
          href="/"
          className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
          data-testid="continue-shopping-link"
        >
          Seguir comprando
        </LocalizedClientLink>
      </div>

      <Text className="sr-only">{countryCode}</Text>
    </div>
  )
}

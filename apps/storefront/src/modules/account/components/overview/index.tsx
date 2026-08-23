import ChevronDown from "@modules/common/icons/chevron-down"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { convertToLocale } from "@lib/util/money"
import { formatStoreDate } from "@lib/util/store-locale"
import { HttpTypes } from "@medusajs/types"
import React from "react"

type OverviewProps = {
  customer: HttpTypes.StoreCustomer | null
  orders: HttpTypes.StoreOrder[] | null
}

const Overview = ({ customer, orders }: OverviewProps) => {
  return (
    <div data-testid="overview-page-wrapper">
      <div>
        <div className="mb-6 flex flex-col justify-between gap-2 border-b border-line pb-6 xsmall:flex-row xsmall:items-end">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
              Vista general
            </p>
            <h2
              className="mt-2 font-bricolage text-3xl font-extrabold tracking-[-0.03em] text-ink"
              data-testid="welcome-message"
              data-value={customer?.first_name}
            >
              Resumen de tu cuenta
            </h2>
          </div>
          <span className="text-xs text-ink-muted">
            Sesión iniciada como{" "}
            <span
              className="font-semibold text-ink"
              data-testid="customer-email"
              data-value={customer?.email}
            >
              {customer?.email}
            </span>
          </span>
        </div>
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-y-4">
            <div className="grid grid-cols-1 gap-4 xsmall:grid-cols-2">
              <LocalizedClientLink
                href="/account/profile"
                className="rounded-2xl border border-line bg-cream/70 p-5 transition-colors hover:border-coral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">
                  Perfil completado
                </p>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <span
                    className="font-bricolage text-4xl font-extrabold leading-none text-ink"
                    data-testid="customer-profile-completion"
                    data-value={getProfileCompletion(customer)}
                  >
                    {getProfileCompletion(customer)}%
                  </span>
                  <ChevronDown className="-rotate-90 text-coral" />
                </div>
              </LocalizedClientLink>

              <LocalizedClientLink
                href="/account/addresses"
                className="rounded-2xl border border-line bg-cream/70 p-5 transition-colors hover:border-coral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">
                  Direcciones guardadas
                </p>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <span
                    className="font-bricolage text-4xl font-extrabold leading-none text-ink"
                    data-testid="addresses-count"
                    data-value={customer?.addresses?.length || 0}
                  >
                    {customer?.addresses?.length || 0}
                  </span>
                  <ChevronDown className="-rotate-90 text-coral" />
                </div>
              </LocalizedClientLink>
            </div>

            <div className="flex flex-col gap-y-4">
              <div className="flex items-center justify-between gap-x-2">
                <h3 className="font-bricolage text-xl font-bold text-ink">
                  Pedidos recientes
                </h3>
                {orders && orders.length > 0 && (
                  <LocalizedClientLink
                    href="/account/orders"
                    className="text-sm font-semibold text-ink underline decoration-coral decoration-2 underline-offset-4 hover:text-ink-soft hover:underline"
                  >
                    Ver todos
                  </LocalizedClientLink>
                )}
              </div>
              <ul
                className="flex flex-col gap-y-4"
                data-testid="orders-wrapper"
              >
                {orders === null ? (
                  <li className="rounded-2xl border border-line bg-cream/40 p-6 text-center">
                    <p className="font-semibold text-ink">
                      No pudimos cargar tus pedidos
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      Tu información sigue segura. Actualiza la página para
                      intentarlo de nuevo.
                    </p>
                    <LocalizedClientLink
                      href="/account"
                      className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-coral hover:bg-cream"
                    >
                      Intentar de nuevo
                    </LocalizedClientLink>
                  </li>
                ) : orders.length > 0 ? (
                  orders.slice(0, 5).map((order) => {
                    return (
                      <li
                        key={order.id}
                        data-testid="order-wrapper"
                        data-value={order.id}
                      >
                        <LocalizedClientLink
                          href={`/account/orders/details/${order.id}`}
                          className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
                        >
                          <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-paper p-4 transition-colors group-hover:border-coral">
                            <div className="min-w-0 flex-1">
                              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                                Pedido{" "}
                                <span
                                  data-testid="order-id"
                                  data-value={order.display_id}
                                >
                                  #{order.display_id}
                                </span>
                              </p>
                              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
                                <span data-testid="order-created-date">
                                  {formatStoreDate(order.created_at)}
                                </span>
                                <span
                                  className="font-semibold text-ink"
                                  data-testid="order-amount"
                                >
                                  {convertToLocale({
                                    amount: order.total,
                                    currency_code: order.currency_code,
                                  })}
                                </span>
                              </div>
                            </div>
                            <span data-testid="open-order-button">
                              <span className="sr-only">
                                Ver pedido #{order.display_id}
                              </span>
                              <ChevronDown className="-rotate-90 text-coral transition-transform group-hover:translate-x-1" />
                            </span>
                          </div>
                        </LocalizedClientLink>
                      </li>
                    )
                  })
                ) : (
                  <li
                    className="rounded-2xl border border-dashed border-line bg-cream/40 p-6 text-center"
                    data-testid="no-orders-message"
                  >
                    <p className="font-semibold text-ink">
                      Aún no tienes pedidos
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      Cuando hagas tu primera compra, podrás seguirla desde
                      aquí.
                    </p>
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const getProfileCompletion = (customer: HttpTypes.StoreCustomer | null) => {
  let count = 0

  if (!customer) {
    return 0
  }

  if (customer.email) {
    count++
  }

  if (customer.first_name && customer.last_name) {
    count++
  }

  if (customer.phone) {
    count++
  }

  const billingAddress = customer.addresses?.find(
    (addr) => addr.is_default_billing
  )

  if (billingAddress) {
    count++
  }

  return (count / 4) * 100
}

export default Overview

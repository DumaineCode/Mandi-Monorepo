import React from "react"

import UnderlineLink from "@modules/common/components/interactive-link"

import AccountNav from "../components/account-nav"
import { HttpTypes } from "@medusajs/types"

interface AccountLayoutProps {
  customer: HttpTypes.StoreCustomer | null
  children: React.ReactNode
}

const AccountLayout: React.FC<AccountLayoutProps> = ({
  customer,
  children,
}) => {
  return (
    <div className="flex-1 py-6 small:py-14" data-testid="account-page">
      <div className="content-container mx-auto flex h-full max-w-[1180px] flex-col">
        {customer ? (
          <>
            <header className="mb-5 overflow-hidden rounded-[22px] bg-ink px-6 py-8 text-cream small:px-10 small:py-10">
              <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-cream-muted">
                Tu cuenta MANDO
              </p>
              <h1 className="font-bricolage text-3xl font-extrabold tracking-[-0.03em] small:text-4xl">
                Hola, {customer.first_name || "qué gusto verte"}
              </h1>
              <p className="mt-3 max-w-2xl text-base text-cream-muted">
                Revisa tus pedidos, actualiza tus datos y guarda tus direcciones
                para comprar más rápido.
              </p>
            </header>

            <div className="grid grid-cols-1 gap-5 small:grid-cols-[240px_minmax(0,1fr)]">
              <aside className="min-w-0">
                <AccountNav />
              </aside>
              <section className="min-w-0 rounded-[22px] border border-line bg-paper p-5 shadow-sm small:p-8">
                {children}
              </section>
            </div>
          </>
        ) : (
          children
        )}

        <div className="mt-5 flex flex-col items-start justify-between gap-6 rounded-[22px] bg-teal p-6 small:flex-row small:items-center small:p-8">
          <div className="max-w-2xl">
            <h2 className="font-bricolage text-2xl font-extrabold tracking-[-0.02em] text-ink">
              ¿Necesitas ayuda?
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              Encuentra respuestas sobre pedidos, envíos y compras en nuestra
              sección de atención a clientes.
            </p>
          </div>
          <div className="shrink-0 font-semibold text-ink">
            <UnderlineLink href="/customer-service">
              Atención a clientes
            </UnderlineLink>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AccountLayout

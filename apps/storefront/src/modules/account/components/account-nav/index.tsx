"use client"

import { ArrowRightOnRectangle } from "@medusajs/icons"
import { clx } from "@modules/common/components/ui"
import { useParams, usePathname } from "next/navigation"

import { signout } from "@lib/data/customer"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import ChevronDown from "@modules/common/icons/chevron-down"
import MapPin from "@modules/common/icons/map-pin"
import Package from "@modules/common/icons/package"
import User from "@modules/common/icons/user"

const AccountNav = () => {
  const route = usePathname()
  const { countryCode } = useParams() as { countryCode: string }

  const handleLogout = async () => {
    await signout(countryCode)
  }

  return (
    <div>
      <nav
        className="mb-5 small:hidden"
        data-testid="mobile-account-nav"
        aria-label="Secciones de mi cuenta"
      >
        {route !== `/${countryCode}/account` ? (
          <LocalizedClientLink
            href="/account"
            className="flex min-h-11 items-center gap-x-2 rounded-xl border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-coral"
            data-testid="account-main-link"
          >
            <>
              <ChevronDown className="transform rotate-90" />
              <span>Volver a mi cuenta</span>
            </>
          </LocalizedClientLink>
        ) : (
          <div>
            <h2 className="mb-3 font-bricolage text-xl font-bold text-ink">
              Explora tu cuenta
            </h2>
            <ul className="grid grid-cols-1 gap-3 xsmall:grid-cols-2">
              <li>
                <LocalizedClientLink
                  href="/account/profile"
                  className="flex min-h-14 items-center justify-between rounded-xl border border-line bg-paper px-4 py-3 text-ink transition-colors hover:border-coral hover:bg-cream"
                  data-testid="profile-link"
                >
                  <>
                    <div className="flex items-center gap-x-2">
                      <User size={20} />
                      <span>Mis datos</span>
                    </div>
                    <ChevronDown className="transform -rotate-90" />
                  </>
                </LocalizedClientLink>
              </li>
              <li>
                <LocalizedClientLink
                  href="/account/addresses"
                  className="flex min-h-14 items-center justify-between rounded-xl border border-line bg-paper px-4 py-3 text-ink transition-colors hover:border-coral hover:bg-cream"
                  data-testid="addresses-link"
                >
                  <>
                    <div className="flex items-center gap-x-2">
                      <MapPin size={20} />
                      <span>Direcciones</span>
                    </div>
                    <ChevronDown className="transform -rotate-90" />
                  </>
                </LocalizedClientLink>
              </li>
              <li>
                <LocalizedClientLink
                  href="/account/orders"
                  className="flex min-h-14 items-center justify-between rounded-xl border border-line bg-paper px-4 py-3 text-ink transition-colors hover:border-coral hover:bg-cream"
                  data-testid="orders-link"
                >
                  <div className="flex items-center gap-x-2">
                    <Package size={20} />
                    <span>Pedidos</span>
                  </div>
                  <ChevronDown className="transform -rotate-90" />
                </LocalizedClientLink>
              </li>
              <li>
                <button
                  type="button"
                  className="flex min-h-14 w-full items-center justify-between rounded-xl border border-line bg-paper px-4 py-3 text-ink transition-colors hover:border-coral hover:bg-cream"
                  onClick={handleLogout}
                  data-testid="logout-button"
                >
                  <div className="flex items-center gap-x-2">
                    <ArrowRightOnRectangle />
                    <span>Cerrar sesión</span>
                  </div>
                  <ChevronDown className="transform -rotate-90" />
                </button>
              </li>
            </ul>
          </div>
        )}
      </nav>
      <nav
        className="sticky top-44 hidden rounded-[18px] bg-ink p-5 text-cream small:block"
        data-testid="account-nav"
        aria-label="Secciones de mi cuenta"
      >
        <div>
          <div className="border-b border-cream/10 pb-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-cream-soft">
              Navegación
            </p>
            <h2 className="mt-1 font-bricolage text-xl font-bold">Mi cuenta</h2>
          </div>
          <div className="mt-4 text-sm">
            <ul className="flex flex-col gap-y-1">
              <li>
                <AccountNavLink
                  href="/account"
                  route={route!}
                  data-testid="overview-link"
                >
                  Resumen
                </AccountNavLink>
              </li>
              <li>
                <AccountNavLink
                  href="/account/profile"
                  route={route!}
                  data-testid="profile-link"
                >
                  Mis datos
                </AccountNavLink>
              </li>
              <li>
                <AccountNavLink
                  href="/account/addresses"
                  route={route!}
                  data-testid="addresses-link"
                >
                  Direcciones
                </AccountNavLink>
              </li>
              <li>
                <AccountNavLink
                  href="/account/orders"
                  route={route!}
                  data-testid="orders-link"
                >
                  Pedidos
                </AccountNavLink>
              </li>
              <li className="pt-2">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex min-h-11 w-full items-center rounded-xl px-3 py-2.5 text-left text-cream-muted transition-colors hover:bg-cream/10 hover:text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
                  data-testid="logout-button"
                >
                  Cerrar sesión
                </button>
              </li>
            </ul>
          </div>
        </div>
      </nav>
    </div>
  )
}

type AccountNavLinkProps = {
  href: string
  route: string
  children: React.ReactNode
  "data-testid"?: string
}

const AccountNavLink = ({
  href,
  route,
  children,
  "data-testid": dataTestId,
}: AccountNavLinkProps) => {
  const { countryCode }: { countryCode: string } = useParams()

  const currentPath = route.split(`/${countryCode}`)[1]
  const active =
    href === "/account"
      ? currentPath === href
      : currentPath === href || currentPath?.startsWith(`${href}/`)

  return (
    <LocalizedClientLink
      href={href}
      className={clx(
        "flex min-h-11 w-full items-center rounded-xl px-3 py-2.5 text-cream-muted transition-colors hover:bg-cream/10 hover:text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral",
        {
          "bg-coral-light font-semibold text-ink hover:bg-coral-hover hover:text-ink":
            active,
        }
      )}
      data-testid={dataTestId}
    >
      {children}
    </LocalizedClientLink>
  )
}

export default AccountNav

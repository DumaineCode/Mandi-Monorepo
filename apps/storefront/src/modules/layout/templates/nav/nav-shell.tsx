"use client"

import { usePathname } from "next/navigation"
import React from "react"

import { User } from "@medusajs/icons"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { clx } from "@modules/common/components/ui"

type NavShellProps = {
  /** Real cart action (CartButton → CartDropdown). Data wiring untouched. */
  cart: React.ReactNode
  /** Mobile side-menu (hamburger). Data wiring untouched. */
  sideMenu: React.ReactNode
}

/**
 * Client wrapper for the global header. It only decides the VISUAL VARIANT
 * (transparent over the home hero vs. solid sticky elsewhere) from the route.
 * All data-bound pieces (cart count, side-menu) are injected as server-rendered
 * slots so their logic stays on the server and is never altered here.
 *
 * Home route = `/{countryCode}` exactly → matches `^/[^/]+/?$`.
 */
const HOME_ROUTE = /^\/[^/]+\/?$/

const NavShell = ({ cart, sideMenu }: NavShellProps) => {
  const pathname = usePathname()
  const isHome = HOME_ROUTE.test(pathname)

  // ---- variant style maps -------------------------------------------------
  const shell = isHome
    ? "absolute inset-x-0 top-0 z-50"
    : "sticky top-0 inset-x-0 z-50"

  const header = isHome
    ? "relative h-16 mx-auto bg-transparent"
    : "relative h-16 mx-auto border-b border-line bg-cream/90 backdrop-blur-md"

  const logoMain = isHome ? "text-cream" : "text-ink"
  const logoSub = isHome ? "text-coral-light" : "text-coral"

  const navLink = isHome
    ? "text-cream-muted hover:text-cream transition-colors"
    : "text-ink-soft hover:text-ink transition-colors"

  const accountLink = isHome
    ? "text-cream-muted hover:text-cream"
    : "text-ink-soft hover:text-ink"

  // On home the cart sits inside a coral pill; elsewhere it is the bare icon.
  const cartSlot = isHome
    ? "flex items-center rounded-full bg-coral px-3 py-2 text-white transition-colors hover:bg-coral-hover"
    : "flex items-center text-ink-soft hover:text-ink"

  return (
    <div className={shell}>
      <header className={header}>
        <nav className="content-container flex h-full w-full items-center justify-between text-small-regular">
          {/* logo lockup */}
          <div className="flex h-full flex-1 basis-0 items-center">
            <LocalizedClientLink
              href="/"
              className="flex flex-col leading-none"
              data-testid="nav-store-link"
            >
              <span
                className={clx(
                  "font-bricolage text-2xl font-extrabold tracking-[-0.02em]",
                  logoMain
                )}
              >
                MANDO
              </span>
              <span
                className={clx(
                  "mt-0.5 font-mono text-[9px] uppercase tracking-[0.42em]",
                  logoSub
                )}
              >
                OFICIAL
              </span>
            </LocalizedClientLink>
          </div>

          {/* center menu */}
          <div className="flex h-full items-center">
            <div className="hidden h-full items-center gap-x-6 small:flex">
              <LocalizedClientLink
                href="/"
                className={navLink}
                data-testid="nav-home-link"
              >
                Inicio
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/store"
                className={navLink}
                data-testid="nav-store-menu-link"
              >
                Tienda
              </LocalizedClientLink>
            </div>
          </div>

          {/* account + cart + mobile menu */}
          <div className="flex h-full flex-1 basis-0 items-center justify-end gap-x-6">
            <div className="hidden h-full items-center gap-x-6 small:flex">
              <LocalizedClientLink
                className={clx("flex items-center", accountLink)}
                href="/account"
                data-testid="nav-account-link"
                aria-label="Account"
                title="Account"
              >
                <User className="h-5 w-5" />
              </LocalizedClientLink>
            </div>
            <div className={cartSlot}>{cart}</div>
            <div className="flex h-full items-center small:hidden">
              {sideMenu}
            </div>
          </div>
        </nav>
      </header>
    </div>
  )
}

export default NavShell

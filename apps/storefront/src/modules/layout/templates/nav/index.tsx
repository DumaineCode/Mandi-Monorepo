import { Suspense } from "react"

import { listLocales } from "@lib/data/locales"
import { getLocale } from "@lib/data/locale-actions"
import { listRegions } from "@lib/data/regions"
import { StoreRegion } from "@medusajs/types"
import { ShoppingBag, User } from "@medusajs/icons"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import CartButton from "@modules/layout/components/cart-button"
import SideMenu from "@modules/layout/components/side-menu"

export default async function Nav() {
  const [regions, locales, currentLocale] = await Promise.all([
    listRegions().then((regions: StoreRegion[]) => regions),
    listLocales(),
    getLocale(),
  ])

  return (
    <div className="sticky top-0 inset-x-0 z-50 group">
      <header className="relative h-16 mx-auto border-b duration-200 bg-white border-ui-border-base">
        <nav className="content-container txt-xsmall-plus text-ui-fg-subtle flex items-center justify-between w-full h-full text-small-regular">
          <div className="flex-1 basis-0 h-full flex items-center">
            <LocalizedClientLink
              href="/"
              className="txt-compact-xlarge-plus hover:text-ui-fg-base uppercase"
              data-testid="nav-store-link"
            >
              Medusa Store
            </LocalizedClientLink>
          </div>

          <div className="flex items-center h-full">
            <div className="hidden small:flex items-center gap-x-6 h-full">
              <LocalizedClientLink
                href="/"
                className="hover:text-ui-fg-base"
                data-testid="nav-home-link"
              >
                Home
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/store"
                className="hover:text-ui-fg-base"
                data-testid="nav-store-menu-link"
              >
                Store
              </LocalizedClientLink>
            </div>
          </div>

          <div className="flex items-center gap-x-6 h-full flex-1 basis-0 justify-end">
            <div className="hidden small:flex items-center gap-x-6 h-full">
              <LocalizedClientLink
                className="hover:text-ui-fg-base flex items-center"
                href="/account"
                data-testid="nav-account-link"
                aria-label="Account"
                title="Account"
              >
                <User className="w-5 h-5" />
              </LocalizedClientLink>
            </div>
            <Suspense
              fallback={
                <LocalizedClientLink
                  className="hover:text-ui-fg-base flex items-center"
                  href="/cart"
                  data-testid="nav-cart-link"
                  aria-label="Cart"
                  title="Cart"
                >
                  <ShoppingBag className="w-5 h-5" />
                </LocalizedClientLink>
              }
            >
              <CartButton />
            </Suspense>
            <div className="flex small:hidden items-center h-full">
              <SideMenu regions={regions} locales={locales} currentLocale={currentLocale} />
            </div>
          </div>
        </nav>
      </header>
    </div>
  )
}

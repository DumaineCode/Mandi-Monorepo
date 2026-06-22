import { Suspense } from "react"

import { listLocales } from "@lib/data/locales"
import { getLocale } from "@lib/data/locale-actions"
import { listRegions } from "@lib/data/regions"
import { StoreRegion } from "@medusajs/types"
import { ShoppingBag } from "@medusajs/icons"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import CartButton from "@modules/layout/components/cart-button"
import SideMenu from "@modules/layout/components/side-menu"

import NavShell from "./nav-shell"

export default async function Nav() {
  const [regions, locales, currentLocale] = await Promise.all([
    listRegions().then((regions: StoreRegion[]) => regions),
    listLocales(),
    getLocale(),
  ])

  return (
    <NavShell
      cart={
        <Suspense
          fallback={
            <LocalizedClientLink
              className="flex items-center"
              href="/cart"
              data-testid="nav-cart-link"
              aria-label="Cart"
              title="Cart"
            >
              <ShoppingBag className="h-5 w-5" />
            </LocalizedClientLink>
          }
        >
          <CartButton />
        </Suspense>
      }
      sideMenu={
        <SideMenu
          regions={regions}
          locales={locales}
          currentLocale={currentLocale}
        />
      }
    />
  )
}

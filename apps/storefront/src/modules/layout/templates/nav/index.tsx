import { Suspense } from "react"

import { listCategories } from "@lib/data/categories"
import { retrieveCustomer } from "@lib/data/customer"
import { listLocales } from "@lib/data/locales"
import { getLocale } from "@lib/data/locale-actions"
import { listRegions } from "@lib/data/regions"
import { HttpTypes, StoreRegion } from "@medusajs/types"
import { ShoppingBag } from "@medusajs/icons"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import CartButton from "@modules/layout/components/cart-button"
import SideMenu from "@modules/layout/components/side-menu"

import NavShell from "./nav-shell"

export default async function Nav() {
  // `retrieveCustomer` is already read by the (main) layout in the same render
  // pass and is fetch-cached, so reading it here only decides the side-menu CTA
  // copy — it does not add a round trip.
  const [regions, locales, currentLocale, categories, customer] =
    await Promise.all([
      listRegions().then((regions: StoreRegion[]) => regions),
      listLocales(),
      getLocale(),
      listCategories(),
      retrieveCustomer().catch(() => null),
    ])

  // Only root categories are rendered at the top level. Children are surfaced
  // via dropdowns, so filtering here avoids duplicating them in the header.
  const rootCategories = (categories ?? []).filter(
    (category: HttpTypes.StoreProductCategory) => !category.parent_category
  )

  return (
    <NavShell
      categories={rootCategories}
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
          categories={rootCategories}
          regions={regions}
          locales={locales}
          currentLocale={currentLocale}
          isLoggedIn={!!customer}
        />
      }
    />
  )
}

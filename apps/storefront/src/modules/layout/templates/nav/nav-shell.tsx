"use client"

import React from "react"

import { ChevronDownMini, User } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import Image from "next/image"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { clx } from "@modules/common/components/ui"

type NavShellProps = {
  /** Root product categories. Categories with children render as dropdowns. */
  categories: HttpTypes.StoreProductCategory[]
  /** Real cart action (CartButton → CartDropdown). Data wiring untouched. */
  cart: React.ReactNode
  /** Mobile side-menu (hamburger). Data wiring untouched. */
  sideMenu: React.ReactNode
}

/**
 * Client wrapper for the global header. The header is a solid sticky bar on
 * every route — it occupies layout space and pins to the top on scroll, so it
 * never overlaps the page content (announcement ticker / hero) below it.
 * All data-bound pieces (cart count, side-menu) are injected as server-rendered
 * slots so their logic stays on the server and is never altered here.
 */
const NavShell = ({ categories, cart, sideMenu }: NavShellProps) => {
  // ---- style maps ---------------------------------------------------------
  const shell = "sticky top-0 inset-x-0 z-50"

  const header =
    "relative h-16 mx-auto border-b border-cream/10 bg-ink"

  const navLink = "text-cream-muted hover:text-cream transition-colors"

  const accountLink = "text-cream-muted hover:text-cream"

  const cartSlot =
    "flex items-center rounded-full bg-coral px-3 py-2 text-coral-foreground transition-colors hover:bg-coral-hover"

  return (
    <div className={shell}>
      <header className={header}>
        <nav className="content-container flex h-full w-full items-center justify-between text-small-regular">
          {/* logo lockup */}
          <div className="flex h-full flex-1 basis-0 items-center">
            <LocalizedClientLink
              href="/"
              className="flex items-center"
              data-testid="nav-store-link"
            >
              <Image
                src="/Logo_Crema_trim.png"
                alt="MANDO Oficial"
                width={802}
                height={220}
                priority
                className="h-9 w-auto"
              />
            </LocalizedClientLink>
          </div>

          {/* center menu — dynamic product categories */}
          <div className="flex h-full items-center">
            <div className="hidden h-full items-center gap-x-6 small:flex">
              {categories.map((category) => {
                const children = category.category_children ?? []
                const hasChildren = children.length > 0

                // Leaf category → direct link, no dropdown.
                if (!hasChildren) {
                  return (
                    <LocalizedClientLink
                      key={category.id}
                      href={`/categories/${category.handle}`}
                      className={navLink}
                      data-testid="nav-category-link"
                    >
                      {category.name}
                    </LocalizedClientLink>
                  )
                }

                // Category with children → hover/focus dropdown. The trigger
                // itself is a link to the parent category; children are
                // revealed on hover and keyboard focus (group-focus-within),
                // keeping every target reachable without nested buttons.
                return (
                  <div
                    key={category.id}
                    className="group relative flex h-full items-center"
                  >
                    <LocalizedClientLink
                      href={`/categories/${category.handle}`}
                      className={clx("flex items-center gap-x-1", navLink)}
                      data-testid="nav-category-link"
                    >
                      {category.name}
                      <ChevronDownMini className="h-4 w-4" />
                    </LocalizedClientLink>

                    <div
                      className={clx(
                        "invisible absolute left-0 top-full z-50 min-w-[12rem] rounded-md border border-cream/10 bg-ink py-2 opacity-0 shadow-lg transition-opacity duration-150",
                        "group-hover:visible group-hover:opacity-100",
                        "group-focus-within:visible group-focus-within:opacity-100"
                      )}
                      data-testid="nav-category-panel"
                    >
                      <ul className="flex flex-col">
                        {children.map((child) => (
                          <li key={child.id}>
                            <LocalizedClientLink
                              href={`/categories/${child.handle}`}
                              className={clx(
                                "block px-4 py-2 text-small-regular",
                                navLink
                              )}
                              data-testid="nav-category-child-link"
                            >
                              {child.name}
                            </LocalizedClientLink>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )
              })}
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

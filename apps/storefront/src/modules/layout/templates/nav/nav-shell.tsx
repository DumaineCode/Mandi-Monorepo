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
 *
 * Two-level layout: a top row for the brand lockup (logo, account, cart,
 * mobile menu) and a bottom row for category navigation, which uses the same
 * `font-blusans` family as the home hero headline so both live under one
 * typographic voice.
 */
const NavShell = ({ categories, cart, sideMenu }: NavShellProps) => {
  // ---- style maps ---------------------------------------------------------
  const shell = "sticky top-0 inset-x-0 z-50"

  const header = "relative mx-auto border-b border-cream/10 bg-ink"

  const navLink =
    "font-blusans text-base font-normal text-cream-muted transition-colors hover:text-cream"

  const navChildLink =
    "block px-4 py-2 font-blusans text-sm font-medium text-cream-muted transition-colors hover:text-cream"

  const accountLink = "text-cream-muted hover:text-cream"

  const cartSlot =
    "flex items-center rounded-full bg-coral px-4 py-2.5 text-coral-foreground transition-colors hover:bg-coral-hover"

  return (
    <div className={shell}>
      <header className={header}>
        {/*
          Top level — three anchors: hamburger left (mobile only), logo centred
          over the bar, account/cart right. The left slot collapses to nothing on
          desktop, so `justify-between` still pins the right group to the edge.
        */}
        <div className="content-container relative flex h-24 w-full items-center justify-between">
          <div className="flex items-center small:hidden">{sideMenu}</div>

          <LocalizedClientLink
            href="/"
            className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center"
            data-testid="nav-store-link"
          >
            <Image
              src="/Logo_Crema_trim.png"
              alt="MANDO Oficial"
              width={802}
              height={220}
              priority
              className="h-12 w-auto small:h-14"
            />
          </LocalizedClientLink>

          <div className="flex items-center justify-end gap-x-6">
            <div className="hidden items-center small:flex">
              <LocalizedClientLink
                className={clx("flex items-center", accountLink)}
                href="/account"
                data-testid="nav-account-link"
                aria-label="Mi cuenta"
                title="Mi cuenta"
              >
                <User className="h-6 w-6" />
              </LocalizedClientLink>
            </div>
            <div className={cartSlot}>{cart}</div>
          </div>
        </div>

        {/* bottom level — dynamic product categories, desktop only */}
        <div className="hidden small:block">
          <nav
            className="content-container flex h-16 w-full items-center justify-center gap-x-8"
            data-testid="nav-categories-row"
          >
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
                    <ChevronDownMini className="h-5 w-5" />
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
                            className={navChildLink}
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
          </nav>
        </div>
      </header>
    </div>
  )
}

export default NavShell

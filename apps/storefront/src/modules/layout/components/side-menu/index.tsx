"use client"

import { Fragment, useState } from "react"

import {
  Dialog,
  DialogPanel,
  Transition,
  TransitionChild,
} from "@headlessui/react"
import useToggleState from "@lib/hooks/use-toggle-state"
import { ArrowRightMini, BarsThree, User, XMark } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { clx } from "@modules/common/components/ui"
import { Locale } from "@lib/data/locales"

import CountrySelect from "../country-select"
import LanguageSelect from "../language-select"

type SideMenuProps = {
  categories: HttpTypes.StoreProductCategory[]
  regions: HttpTypes.StoreRegion[] | null
  locales: Locale[] | null
  currentLocale: string | null
  /** Drives the bottom CTA: sign in vs. go to the account area. */
  isLoggedIn?: boolean
}

/**
 * Mobile navigation drawer.
 *
 * The header collapses to logo + cart below `small`, so every category link
 * lives here. It is an off-canvas panel anchored to the LEFT edge that covers
 * ~82% of the viewport (capped at 20rem) rather than the whole screen: keeping
 * a strip of the page visible tells the shopper the drawer is a temporary
 * overlay they can dismiss, not a route they navigated into.
 *
 * The link list scrolls independently so the sign-in CTA stays pinned to the
 * bottom no matter how many categories the store has.
 *
 * It is a `Dialog`, not a `Popover`. A panel that covers most of the viewport
 * and blocks interaction with the page IS a modal, and `Dialog` is what gives
 * us the four behaviours that implies for free: it portals to the document root
 * (so it escapes the sticky header's stacking context, where the cart dropdown's
 * own `z-50` was competing with it), it locks body scroll, it traps and restores
 * focus, and it closes on Escape.
 */
const SideMenu = ({
  categories,
  regions,
  locales,
  currentLocale,
  isLoggedIn = false,
}: SideMenuProps) => {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  const countryToggleState = useToggleState()
  const languageToggleState = useToggleState()

  const primaryLink =
    "block font-blusans text-xl font-normal text-cream transition-colors hover:text-coral"

  const childLink =
    "block font-blusans text-base font-normal text-cream-muted transition-colors hover:text-cream"

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="nav-menu-button"
        aria-label="Abrir menú"
        className="flex items-center text-cream-muted transition-colors hover:text-cream focus:outline-none"
      >
        <BarsThree className="h-7 w-7" />
      </button>

      <Transition show={open} as={Fragment}>
        {/*
          Dialog portals to the document root, so this z-index is compared at
          the top level against the header shell's own z-50 — not nested inside
          it, which is what made the logo and cart paint over the panel.
        */}
        <Dialog onClose={close} className="relative z-[100]">
          <TransitionChild
            as={Fragment}
            enter="transition-opacity ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div
              className="fixed inset-0 bg-ink/70 backdrop-blur-sm"
              aria-hidden="true"
              data-testid="side-menu-backdrop"
            />
          </TransitionChild>

          <div className="fixed inset-0 overflow-hidden">
            <TransitionChild
              as={Fragment}
              enter="transform transition ease-out duration-300"
              enterFrom="-translate-x-full"
              enterTo="translate-x-0"
              leave="transform transition ease-in duration-200"
              leaveFrom="translate-x-0"
              leaveTo="-translate-x-full"
            >
              <DialogPanel
                data-testid="nav-menu-popup"
                className="absolute inset-y-0 left-0 flex w-[82%] max-w-[20rem] flex-col border-r border-cream/10 bg-ink text-cream shadow-2xl focus:outline-none"
              >
                {/* h-24 mirrors the header bar so the drawer's top edge lines
                    up with the bar it replaces. */}
                <div className="flex h-24 shrink-0 items-center justify-between border-b border-cream/10 px-6">
                  <span className="font-mono text-xs uppercase tracking-[0.2em] text-cream-muted">
                    Menú
                  </span>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="Cerrar menú"
                    data-testid="close-menu-button"
                    className="text-cream-muted transition-colors hover:text-cream"
                  >
                    <XMark className="h-6 w-6" />
                  </button>
                </div>

                {/* Only this region scrolls — the CTA below stays reachable. */}
                <nav className="flex-1 overflow-y-auto px-6 py-6">
                  <ul className="flex flex-col gap-y-5">
                    <li>
                      <LocalizedClientLink
                        href="/"
                        className={primaryLink}
                        onClick={close}
                        data-testid="home-link"
                      >
                        Inicio
                      </LocalizedClientLink>
                    </li>
                    <li>
                      <LocalizedClientLink
                        href="/store"
                        className={primaryLink}
                        onClick={close}
                        data-testid="store-link"
                      >
                        Tienda
                      </LocalizedClientLink>
                    </li>

                    {categories.map((category) => {
                      const children = category.category_children ?? []

                      return (
                        <li key={category.id}>
                          <LocalizedClientLink
                            href={`/categories/${category.handle}`}
                            className={primaryLink}
                            onClick={close}
                            data-testid="nav-category-link"
                          >
                            {category.name}
                          </LocalizedClientLink>

                          {children.length > 0 && (
                            <ul className="mt-3 flex flex-col gap-y-3 border-l border-cream/10 pl-4">
                              {children.map((child) => (
                                <li key={child.id}>
                                  <LocalizedClientLink
                                    href={`/categories/${child.handle}`}
                                    className={childLink}
                                    onClick={close}
                                    data-testid="nav-category-child-link"
                                  >
                                    {child.name}
                                  </LocalizedClientLink>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </nav>

                <div className="shrink-0 border-t border-cream/10 px-6 py-6">
                  <div className="mb-5 flex flex-col gap-y-4 text-sm text-cream-muted">
                    {!!locales?.length && (
                      <div
                        className="flex items-center justify-between"
                        onMouseEnter={languageToggleState.open}
                        onMouseLeave={languageToggleState.close}
                      >
                        <LanguageSelect
                          toggleState={languageToggleState}
                          locales={locales}
                          currentLocale={currentLocale}
                        />
                        <ArrowRightMini
                          className={clx(
                            "transition-transform duration-150",
                            languageToggleState.state ? "-rotate-90" : ""
                          )}
                        />
                      </div>
                    )}

                    {regions && (
                      <div
                        className="flex items-center justify-between"
                        onMouseEnter={countryToggleState.open}
                        onMouseLeave={countryToggleState.close}
                      >
                        <CountrySelect
                          toggleState={countryToggleState}
                          regions={regions}
                        />
                        <ArrowRightMini
                          className={clx(
                            "transition-transform duration-150",
                            countryToggleState.state ? "-rotate-90" : ""
                          )}
                        />
                      </div>
                    )}
                  </div>

                  <LocalizedClientLink
                    href="/account"
                    onClick={close}
                    data-testid="account-link"
                    className="flex w-full items-center justify-center gap-x-2 rounded-full bg-coral px-5 py-3 font-blusans text-base font-medium text-coral-foreground transition-colors hover:bg-coral-hover"
                  >
                    <User className="h-5 w-5" />
                    {isLoggedIn ? "Mi cuenta" : "Iniciar sesión"}
                  </LocalizedClientLink>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}

export default SideMenu

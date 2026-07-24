import Image from "next/image"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import ChevronDown from "@modules/common/icons/chevron-down"

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const year = new Date().getFullYear()

  return (
    <div className="relative min-h-screen w-full bg-paper">
      {/* Reduced branded checkout header — mirrors the store Nav (bg-ink). */}
      <div className="sticky top-0 inset-x-0 z-50">
        <header className="relative h-16 mx-auto border-b border-cream/10 bg-ink">
          <nav className="content-container flex h-full items-center justify-between text-small-regular">
            {/* LEFT: back to cart */}
            <div className="flex flex-1 basis-0 items-center">
              <LocalizedClientLink
                href="/cart"
                className="flex items-center gap-x-2 text-cream-muted transition-colors hover:text-cream"
                data-testid="back-to-cart-link"
              >
                <ChevronDown className="rotate-90" size={16} />
                <span className="mt-px hidden small:block font-hanken">
                  Volver al carrito
                </span>
                <span className="mt-px block small:hidden font-hanken">
                  Volver
                </span>
              </LocalizedClientLink>
            </div>

            {/* CENTER: logo */}
            <LocalizedClientLink
              href="/"
              className="flex items-center"
              data-testid="store-link"
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

            {/* RIGHT: secure-payment trust indicator */}
            <div className="flex flex-1 basis-0 items-center justify-end">
              <span className="hidden 2xsmall:flex items-center gap-x-2 text-cream-muted font-hanken">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                <span className="text-small-regular">Pago seguro</span>
              </span>
            </div>
          </nav>
        </header>
      </div>

      <div className="relative" data-testid="checkout-container">
        {children}
      </div>

      {/* Minimal branded footer (replaces MedusaCTA). */}
      <div className="w-full border-t border-line bg-cream py-6">
        <p className="text-center text-small-regular font-hanken text-ink-muted">
          © {year} MANDO · Pago 100% seguro
        </p>
      </div>
    </div>
  )
}

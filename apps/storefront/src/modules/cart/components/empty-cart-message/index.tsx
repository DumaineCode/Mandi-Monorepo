import LocalizedClientLink from "@modules/common/components/localized-client-link"

const EmptyCartMessage = () => {
  return (
    <div
      className="flex flex-col items-start justify-center py-32"
      data-testid="empty-cart-message"
    >
      <h1 className="font-bricolage text-[34px] font-extrabold tracking-[-0.03em] text-ink small:text-[44px]">
        Tu carrito está vacío
      </h1>
      <p className="mb-8 mt-4 max-w-[32rem] text-base text-ink-soft">
        Todavía no agregaste nada. Explora nuestros productos para empezar.
      </p>
      <LocalizedClientLink
        href="/store"
        className="rounded-xl bg-coral px-6 py-3 font-semibold text-coral-foreground transition-colors hover:bg-coral-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-cream motion-reduce:transition-none"
      >
        Explorar productos
      </LocalizedClientLink>
    </div>
  )
}

export default EmptyCartMessage

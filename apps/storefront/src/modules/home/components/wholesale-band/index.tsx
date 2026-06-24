import LocalizedClientLink from "@modules/common/components/localized-client-link"

// Wholesale CTA band (ref wireframe lines 204-214). Teal card with a decorative
// translucent circle bleeding off the top-right corner. Stacks on mobile,
// becomes a row on `small` (>=1024px).
const WholesaleBand = () => {
  return (
    <section className="mx-auto max-w-[1180px] px-6 pb-2.5 pt-10 small:pt-14">
      <div className="relative flex flex-col gap-6 overflow-hidden rounded-[22px] bg-teal p-8 text-ink small:flex-row small:items-center small:gap-8 small:p-11">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-10 h-[220px] w-[220px] rounded-full bg-ink/5"
        />
        <div className="relative flex-1">
          <p className="font-mono text-xs uppercase tracking-[0.14em] opacity-80">
            Para negocios
          </p>
          <h3 className="mt-2.5 font-bricolage text-[32px] font-extrabold leading-none tracking-[-0.03em] small:text-[40px]">
            ¿Tienes cafetería?
          </h3>
          <p className="mt-2 max-w-[440px] text-base leading-relaxed opacity-90 small:text-[17px]">
            Precios de mayoreo, factura y envío programado a todo México.
            Asesoría de carta incluida.
          </p>
        </div>
        <LocalizedClientLink
          href="/store"
          className="relative inline-flex shrink-0 items-center justify-center self-start whitespace-nowrap rounded-xl bg-ink px-7 py-4 font-semibold text-white transition-colors hover:bg-ink/90 small:self-auto"
        >
          Quiero mayoreo →
        </LocalizedClientLink>
      </div>
    </section>
  )
}

export default WholesaleBand

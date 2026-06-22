// Newsletter capture card (ref wireframe lines 230-241). VISUAL ONLY for now:
// the input is uncontrolled and the button is type="button" with no handler, so
// this stays a server component and nothing submits (no backend yet). Stacks on
// mobile, becomes a row on `small` (>=1024px).
const Newsletter = () => {
  return (
    <section className="mx-auto max-w-[1180px] px-6 pb-16 pt-10">
      <div className="flex flex-col gap-6 rounded-[22px] bg-ink p-8 text-cream small:flex-row small:items-center small:gap-8 small:p-10">
        <div className="small:flex-1">
          <h3 className="font-bricolage text-[26px] font-extrabold tracking-[-0.02em] small:text-[30px]">
            Recetas + promos a tu correo
          </h3>
          <p className="mt-1.5 text-[15px] text-cream-muted">
            Sin spam. Cancela cuando quieras.
          </p>
        </div>
        <div className="flex gap-2.5 small:flex-1">
          <label htmlFor="newsletter-email" className="sr-only">
            Correo electrónico
          </label>
          <input
            id="newsletter-email"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="tu@correo.com"
            className="min-w-0 flex-1 rounded-[11px] border border-[#4a463e] bg-[#2a2620] px-4 py-3.5 font-mono text-[13px] text-cream placeholder:text-cream-soft focus:border-coral focus:outline-none focus:ring-1 focus:ring-coral"
          />
          <button
            type="button"
            className="shrink-0 rounded-[11px] bg-coral px-6 py-3.5 font-semibold text-white transition-colors hover:bg-coral-hover"
          >
            Unirme
          </button>
        </div>
      </div>
    </section>
  )
}

export default Newsletter

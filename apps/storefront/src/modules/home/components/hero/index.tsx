import LocalizedClientLink from "@modules/common/components/localized-client-link"

// Home hero (ref wireframe lines 38-121). Server component — fully static.
// The transparent global header is overlaid on top of this section, so the
// content gets generous top padding (pt-28) to clear the ~64px nav.
const Hero = () => {
  return (
    <section className="relative overflow-hidden bg-ink text-cream">
      {/* decorative glows + dots (lines 40-43), non-interactive */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-[120px] -top-20 h-[420px] w-[420px] rounded-full blur-[20px]"
        style={{
          background:
            "radial-gradient(circle, rgba(255,90,60,.55), transparent 65%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-[120px] -right-[100px] h-[480px] w-[480px] rounded-full blur-[24px]"
        style={{
          background:
            "radial-gradient(circle, rgba(19,138,116,.5), transparent 65%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-[38%] top-[18%] h-3.5 w-3.5 rounded-full bg-gold"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[20%] left-[46%] h-[9px] w-[9px] rounded-full bg-coral"
      />

      {/* hero body */}
      <div className="relative z-[2] mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-10 px-6 pb-16 pt-28 small:grid-cols-[1.05fr_.95fr] small:pb-[70px] small:pt-32">
        {/* LEFT */}
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cream/20 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-cream-muted">
            <span className="h-[7px] w-[7px] rounded-full bg-coral" />
            Insumos para cafeterías · Mayoreo
          </div>

          <h1 className="mt-5 font-bricolage text-[44px] font-extrabold leading-[.94] tracking-[-0.035em] small:text-[64px] large:text-[78px]">
            El{" "}
            <span className="inline-block -rotate-[1.6deg] rounded-lg bg-coral px-3 text-ink">
              sabor
            </span>{" "}
            que tu menú estaba esperando.
          </h1>

          <p className="mt-6 max-w-[430px] text-[18px] leading-[1.55] text-cream-muted">
            Polvos, jarabes y todo para frappés y tapioca — calidad de mayoreo y
            pedido en minutos. Hecho para baristas que no se conforman.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <LocalizedClientLink
              href="/store"
              className="inline-flex items-center gap-2 rounded-xl bg-coral px-6 py-4 text-base font-semibold text-white transition-colors hover:bg-coral-hover"
            >
              Explorar la tienda →
            </LocalizedClientLink>
            <a
              href="#"
              className="inline-flex items-center rounded-xl border border-cream/35 px-6 py-4 text-base font-medium text-cream transition-colors hover:border-cream/70"
            >
              Ver sabor del mes
            </a>
          </div>

          {/* stats row */}
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
            <div>
              <div className="font-bricolage text-[26px] font-bold">+40</div>
              <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-cream-soft">
                sabores
              </div>
            </div>
            <div className="hidden h-[34px] w-px bg-cream/[.18] small:block" />
            <div>
              <div className="font-bricolage text-[26px] font-bold">24 h</div>
              <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-cream-soft">
                envío
              </div>
            </div>
            <div className="hidden h-[34px] w-px bg-cream/[.18] small:block" />
            <div>
              <div className="font-bricolage text-[26px] font-bold">+500</div>
              <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-cream-soft">
                cafeterías
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT collage — decorative, hidden on mobile to protect layout */}
        <div className="relative hidden h-[470px] small:block">
          {/* main product card */}
          <div className="absolute left-1/2 top-1/2 w-[340px] -translate-x-1/2 -translate-y-1/2 -rotate-3 rounded-[22px] bg-paper p-3.5 shadow-[0_30px_60px_rgba(0,0,0,.4)]">
            <div
              className="flex h-[300px] items-end justify-center rounded-[14px] pb-4"
              style={{
                background:
                  "repeating-linear-gradient(135deg,#ECE4D5 0,#ECE4D5 11px,#F5F0E5 11px,#F5F0E5 22px)",
              }}
            >
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#A99E86]">
                foto · producto
              </span>
            </div>
            <div className="flex items-center justify-between px-1.5 pb-1 pt-3.5">
              <div>
                <div className="font-bricolage text-[18px] font-bold text-ink">
                  Polvo Taro
                </div>
                <div className="font-mono text-[11px] text-ink-muted">
                  1 kg · cremoso
                </div>
              </div>
              <div className="font-bricolage text-[20px] font-bold text-ink">
                $189
              </div>
            </div>
          </div>

          {/* price sticker */}
          <div className="absolute right-0.5 top-3.5 flex h-[78px] w-[78px] rotate-[11deg] flex-col items-center justify-center rounded-full border-2 border-ink bg-gold text-ink shadow-[0_10px_24px_rgba(0,0,0,.3)]">
            <span className="font-bricolage text-[19px] font-extrabold leading-none">
              $189
            </span>
            <span className="font-mono text-[9px]">/kg</span>
          </div>

          {/* flavor pills */}
          <div className="absolute -left-1.5 top-[54px] flex -rotate-[5deg] items-center gap-2 rounded-full bg-paper py-1.5 pl-2.5 pr-3.5 text-ink shadow-[0_10px_22px_rgba(0,0,0,.28)]">
            <span className="h-[18px] w-[18px] rounded-full bg-[#B79CE0]" />
            <span className="text-sm font-semibold">Taro</span>
          </div>
          <div className="absolute bottom-[120px] right-1.5 flex rotate-[4deg] items-center gap-2 rounded-full bg-paper py-1.5 pl-2.5 pr-3.5 text-ink shadow-[0_10px_22px_rgba(0,0,0,.28)]">
            <span className="h-[18px] w-[18px] rounded-full bg-[#8FB96A]" />
            <span className="text-sm font-semibold">Matcha</span>
          </div>
          <div className="absolute bottom-[30px] left-[18px] flex -rotate-3 items-center gap-2 rounded-full bg-paper py-1.5 pl-2.5 pr-3.5 text-ink shadow-[0_10px_22px_rgba(0,0,0,.28)]">
            <span className="h-[18px] w-[18px] rounded-full bg-[#F2A03D]" />
            <span className="text-sm font-semibold">Mango</span>
          </div>

          {/* best seller tag */}
          <div className="absolute bottom-[18px] right-[34px] -rotate-[4deg] rounded-[7px] bg-coral px-[11px] py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-white">
            ★ best seller
          </div>
        </div>
      </div>
    </section>
  )
}

export default Hero

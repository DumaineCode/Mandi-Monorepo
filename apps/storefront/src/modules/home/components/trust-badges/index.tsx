import {
  PiArrowsClockwiseLight,
  PiShieldCheckLight,
  PiTruckLight,
} from "react-icons/pi"

// Trust badges band. A dark `ink` surface (same family as Hero/Newsletter) that
// answers the three checkout objections: is it safe, when does it arrive, what
// if I don't like it. Each badge sits in a coral-tinted icon disc, mirroring the
// decorative circle language used in `wholesale-band`. Stacks on mobile, becomes
// a 3-up row on `small` (>=1024px). Icons are react-icons/pi (Phosphor) Light
// weight to match the fine stroke of the project's local SVG icons.
const BADGES = [
  {
    Icon: PiShieldCheckLight,
    title: "Pago 100% seguro",
    body: "Tarjeta (débito/crédito), PayPal, Apple Pay, OXXO, banco o transferencia. Todo encriptado.",
  },
  {
    Icon: PiTruckLight,
    title: "Envío rápido",
    body: "A todo México. Tu pedido en camino en menos de 24 horas.",
  },
  {
    Icon: PiArrowsClockwiseLight,
    title: "Cambios y devoluciones",
    body: "30 días de garantía. Si no estás feliz, te regresamos tu dinero. Así de fácil.",
  },
] as const

const TrustBadges = () => {
  return (
    <section className="mx-auto max-w-[1180px] px-6 pb-2.5 pt-10 small:pt-14">
      <div className="relative overflow-hidden rounded-[22px] bg-ink px-8 py-10 text-cream small:px-11 small:py-12">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-[260px] w-[260px] rounded-full bg-coral/10"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -left-12 h-[220px] w-[220px] rounded-full bg-coral/5"
        />

        <div className="relative grid grid-cols-1 gap-10 small:grid-cols-3 small:gap-8">
          {BADGES.map(({ Icon, title, body }) => (
            <div key={title} className="flex flex-col items-center text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-coral/15 text-coral-light ring-1 ring-inset ring-coral/25">
                <Icon className="h-7 w-7" />
              </span>
              <h3 className="mt-5 font-bricolage text-xl font-extrabold uppercase tracking-[-0.02em] small:text-[22px]">
                {title}
              </h3>
              <p className="mt-2 max-w-[300px] text-sm leading-relaxed text-cream-muted small:text-[15px]">
                {body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default TrustBadges

"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// Reseñas de clientes. Client component because the carousel needs scroll
// state (active dot, arrow enable/disable) and per-card "Leer más" expansion.
// Data is hardcoded for now — real testimonials curated by the store owner.
// If we later wire Google Places API or a Medusa reviews module, only REVIEWS
// changes; the presentation layer stays put.

type Review = {
  name: string
  location: string
  date: string
  rating: number
  text: string
  // Optional avatar image URL. When absent we render an initial badge.
  avatar?: string
}

const REVIEWS: Review[] = [
  {
    name: "Rodrigo Orozco",
    location: "Guadalajara, JAL",
    date: "12 de mayo de 2026",
    rating: 5,
    text: "Excelente atención de parte de Karlita en pedidos, llevo ya 5 años comprándoles y a mis clientes les encanta el producto :)",
  },
  {
    name: "Adriana García",
    location: "CDMX",
    date: "3 de abril de 2026",
    rating: 5,
    text: "La base para cafés sabe riquísimo, y que lleguen súper rápido nos facilita mucho la vida. Volvemos a pedir cada mes sin falta.",
  },
  {
    name: "Santiago Martínez",
    location: "Monterrey, NL",
    date: "21 de febrero de 2026",
    rating: 5,
    text: "Las perlas explosivas les encantan a muchos de nuestros clientes. Se nota la calidad y el envío de 24 horas nunca nos ha fallado.",
  },
  {
    name: "Valeria Ramírez",
    location: "Puebla, PUE",
    date: "8 de enero de 2026",
    rating: 5,
    text: "Cambiamos toda nuestra barra de frappés a Mando. El color y el sabor venden solos, mis ventas de bebidas frías subieron muchísimo.",
  },
  {
    name: "Diego Herrera",
    location: "Querétaro, QRO",
    date: "17 de diciembre de 2025",
    rating: 5,
    text: "Pedí un montón de sabores para probar y todos rindieron perfecto. El equipo siempre responde rápido cualquier duda. Muy recomendados.",
  },
]

// Deterministic badge tint per author so avatars feel distinct without images.
const BADGE_TINTS = [
  "bg-coral text-coral-foreground",
  "bg-ink text-cream",
  "bg-gold text-ink",
  "bg-coral-light text-ink",
  "bg-teal text-ink",
] as const

const Stars = ({ rating }: { rating: number }) => (
  <div
    className="flex items-center gap-0.5"
    aria-label={`${rating} de 5 estrellas`}
  >
    {Array.from({ length: 5 }).map((_, i) => (
      <svg
        key={i}
        viewBox="0 0 20 20"
        aria-hidden
        className={`h-[18px] w-[18px] ${
          i < rating ? "text-gold" : "text-line"
        }`}
        fill="currentColor"
      >
        <path d="M10 1.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L10 14.77 4.8 17.5l.99-5.79-4.21-4.1 5.82-.85L10 1.5z" />
      </svg>
    ))}
  </div>
)

const ReviewCard = ({
  review,
  tint,
}: {
  review: Review
  tint: string
}) => {
  const [expanded, setExpanded] = useState(false)
  const isLong = review.text.length > 140
  const initial = review.name.charAt(0).toUpperCase()

  return (
    <article className="flex h-full min-w-[300px] max-w-[340px] shrink-0 snap-start flex-col rounded-2xl border border-line bg-paper p-6 small:min-w-[340px]">
      <header className="flex items-center gap-3">
        {review.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={review.avatar}
            alt={review.name}
            className="h-11 w-11 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className={`flex h-11 w-11 items-center justify-center rounded-full font-bricolage text-lg font-bold ${tint}`}
          >
            {initial}
          </span>
        )}
        <div className="min-w-0">
          <div className="truncate font-bricolage text-[15px] font-bold leading-tight text-ink">
            {review.name}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-ink-muted">
            {review.location}
          </div>
        </div>
      </header>

      <div className="mt-4 flex items-center justify-between gap-2">
        <Stars rating={review.rating} />
        <span className="font-mono text-[11px] text-ink-muted">
          {review.date}
        </span>
      </div>

      <p
        className={`mt-3 flex-1 text-[14px] leading-relaxed text-ink-soft ${
          expanded ? "" : "line-clamp-4"
        }`}
      >
        {review.text}
      </p>

      {isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 self-start border-b-2 border-coral pb-0.5 text-[13px] font-medium text-ink transition-colors hover:text-coral"
        >
          {expanded ? "Leer menos" : "Leer más"}
        </button>
      ) : null}
    </article>
  )
}

const ReviewsCarousel = () => {
  const trackRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(true)

  // Recompute active dot + arrow state from scroll position. Card width is
  // read from the first child so it stays correct across breakpoints.
  const sync = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const cardWidth = (track.firstElementChild as HTMLElement | null)
      ?.offsetWidth
    const gap = 16
    const step = (cardWidth ?? 320) + gap
    const index = Math.round(track.scrollLeft / step)
    setActive(Math.min(index, REVIEWS.length - 1))
    setCanPrev(track.scrollLeft > 4)
    setCanNext(
      track.scrollLeft < track.scrollWidth - track.clientWidth - 4
    )
  }, [])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    sync()
    track.addEventListener("scroll", sync, { passive: true })
    window.addEventListener("resize", sync)
    return () => {
      track.removeEventListener("scroll", sync)
      window.removeEventListener("resize", sync)
    }
  }, [sync])

  const scrollToIndex = (index: number) => {
    const track = trackRef.current
    if (!track) return
    const cardWidth = (track.firstElementChild as HTMLElement | null)
      ?.offsetWidth
    const gap = 16
    const step = (cardWidth ?? 320) + gap
    track.scrollTo({ left: index * step, behavior: "smooth" })
  }

  const nudge = (dir: 1 | -1) => {
    const next = Math.min(
      Math.max(active + dir, 0),
      REVIEWS.length - 1
    )
    scrollToIndex(next)
  }

  return (
    <section className="mx-auto max-w-[1180px] px-6 pb-2.5 pt-14">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-blusans text-[32px] font-semibold leading-none tracking-[-0.03em] small:text-[42px]">
            Lo que dicen nuestros clientes
          </h2>
        </div>

        <div className="hidden shrink-0 items-center gap-2 small:flex">
          <button
            type="button"
            onClick={() => nudge(-1)}
            disabled={!canPrev}
            aria-label="Reseña anterior"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-paper text-ink transition-all hover:border-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => nudge(1)}
            disabled={!canNext}
            aria-label="Reseña siguiente"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-paper text-ink transition-all hover:border-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            ›
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {REVIEWS.map((review, i) => (
          <ReviewCard
            key={review.name}
            review={review}
            tint={BADGE_TINTS[i % BADGE_TINTS.length]}
          />
        ))}
      </div>

      <div className="mt-5 flex items-center justify-center gap-2">
        {REVIEWS.map((review, i) => (
          <button
            key={review.name}
            type="button"
            onClick={() => scrollToIndex(i)}
            aria-label={`Ir a la reseña ${i + 1}`}
            aria-current={active === i}
            className={`h-2 rounded-full transition-all ${
              active === i
                ? "w-6 bg-coral"
                : "w-2 bg-line hover:bg-coral-light"
            }`}
          />
        ))}
      </div>
    </section>
  )
}

export default ReviewsCarousel

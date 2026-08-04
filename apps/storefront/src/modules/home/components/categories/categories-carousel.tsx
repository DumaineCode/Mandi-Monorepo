"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { getCategoryImage } from "@lib/util/category-image"
import {
  CarouselPage,
  activePageIndex,
  computeCarouselPages,
} from "@lib/util/carousel-pages"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import Image from "next/image"

/**
 * Horizontal category carousel. Client component because it needs live scroll
 * state (active dot, arrow enable/disable); the fetch stays in the server
 * component that renders this, mirroring `nav/index.tsx` → `NavShell`.
 *
 * Scrolling is native CSS scroll-snap rather than a carousel library: the track
 * works with touch, trackpad, keyboard and screen readers before any JS runs,
 * and the arrows/dots are a progressive enhancement on top of it.
 */

// Rotating diagonal-stripe placeholders matching the wireframe palette, used
// when a category has no image. Index-based so each card looks distinct.
const PLACEHOLDERS = [
  "repeating-linear-gradient(135deg,#F1D9CF 0,#F1D9CF 11px,#FBEBE3 11px,#FBEBE3 22px)",
  "repeating-linear-gradient(135deg,#D7E9D2 0,#D7E9D2 11px,#ECF6E8 11px,#ECF6E8 22px)",
  "repeating-linear-gradient(135deg,#D6E4F0 0,#D6E4F0 11px,#EAF1F9 11px,#EAF1F9 22px)",
  "repeating-linear-gradient(135deg,#F4E6C5 0,#F4E6C5 11px,#FBF3DE 11px,#FBF3DE 22px)",
]

type Props = {
  categories: HttpTypes.StoreProductCategory[]
}

const TRACK_ID = "home-categories-track"

/**
 * Slack for sub-pixel rounding: at fractional zoom levels `scrollLeft` never
 * quite reaches `scrollWidth - clientWidth`, which would leave the next arrow
 * permanently enabled at the end of the track.
 */
const SCROLL_EPSILON = 4

const CategoriesCarousel = ({ categories }: Props) => {
  const trackRef = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<CarouselPage[]>([])
  const [active, setActive] = useState(0)
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(false)

  /**
   * Recompute reachable pages and arrow availability from live layout.
   *
   * Card offsets are measured from the DOM instead of computed as
   * `index * (cardWidth + gap)`: the cards are responsive and the gap comes from
   * a Tailwind class, so any hardcoded step drifts out of sync at the exact
   * breakpoints it matters. `offsetLeft` is already correct at every size.
   *
   * Pages, not cards: with several cards visible at once the trailing cards all
   * clamp onto the same final scroll position, so one control per card would
   * render dots that can never activate. See `carousel-pages.ts`.
   */
  const readScrollState = useCallback(() => {
    const track = trackRef.current
    if (!track) {
      return
    }

    const cards = Array.from(track.children) as HTMLElement[]
    const origin = cards[0]?.offsetLeft ?? 0
    const maxScroll = track.scrollWidth - track.clientWidth
    const nextPages = computeCarouselPages(
      cards.map((card) => card.offsetLeft - origin),
      maxScroll
    )

    setPages(nextPages)
    setActive(activePageIndex(nextPages, track.scrollLeft))
    setCanPrev(track.scrollLeft > SCROLL_EPSILON)
    setCanNext(track.scrollLeft < maxScroll - SCROLL_EPSILON)
  }, [])

  useEffect(() => {
    const track = trackRef.current
    if (!track) {
      return
    }

    readScrollState()
    track.addEventListener("scroll", readScrollState, { passive: true })
    window.addEventListener("resize", readScrollState)
    return () => {
      track.removeEventListener("scroll", readScrollState)
      window.removeEventListener("resize", readScrollState)
    }
  }, [readScrollState])

  const scrollToPage = (index: number) => {
    const track = trackRef.current
    const page = pages[index]
    if (!track || !page) {
      return
    }

    // Animated scrolling is vestibular-hostile, so honour the OS-level opt-out
    // rather than animating unconditionally.
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    track.scrollTo({
      left: page.scrollLeft,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    })
  }

  const nudge = (direction: 1 | -1) => {
    scrollToPage(Math.min(Math.max(active + direction, 0), pages.length - 1))
  }

  return (
    <section className="mx-auto max-w-[1180px] px-6 pb-2.5 pt-16">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-coral">
            01 — Categorías
          </p>
          <h2 className="mt-2 font-bricolage text-[32px] font-extrabold leading-none tracking-[-0.03em] small:text-[42px]">
            Explora por categoría
          </h2>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <LocalizedClientLink
            href="/store"
            className="hidden whitespace-nowrap border-b-2 border-coral pb-0.5 text-[15px] text-ink transition-colors hover:text-coral small:inline-block"
          >
            Ver todo el catálogo →
          </LocalizedClientLink>

          <div className="hidden items-center gap-2 small:flex">
            <button
              type="button"
              onClick={() => nudge(-1)}
              disabled={!canPrev}
              aria-label="Categoría anterior"
              aria-controls={TRACK_ID}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-paper text-ink transition-all hover:border-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => nudge(1)}
              disabled={!canNext}
              aria-label="Categoría siguiente"
              aria-controls={TRACK_ID}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-paper text-ink transition-all hover:border-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      <div
        ref={trackRef}
        id={TRACK_ID}
        role="region"
        aria-label="Categorías"
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {categories.map((category, index) => {
          const image = getCategoryImage(category)
          const productCount = category.products?.length

          return (
            <LocalizedClientLink
              key={category.id}
              href={`/categories/${category.handle}`}
              className="group block w-[240px] shrink-0 snap-start overflow-hidden rounded-[18px] border border-line bg-paper transition-all duration-200 hover:-translate-y-[3px] hover:border-ink small:w-[268px]"
            >
              <div className="relative h-[140px] overflow-hidden">
                {image ? (
                  <Image
                    src={image}
                    alt={category.name}
                    fill
                    className="object-cover object-center"
                    // Matches the card widths below. Inert while
                    // `images.unoptimized` is set in next.config.js — Next drops
                    // `sizes` entirely in that mode — but kept truthful so it
                    // does not start lying if optimization is switched on.
                    sizes="(max-width: 1024px) 240px, 268px"
                  />
                ) : (
                  <div
                    aria-hidden
                    className="h-full w-full"
                    style={{
                      background: PLACEHOLDERS[index % PLACEHOLDERS.length],
                    }}
                  />
                )}
              </div>
              <div className="px-4 py-[15px]">
                <div className="font-bricolage text-[19px] font-bold leading-tight">
                  {category.name}
                </div>
                {typeof productCount === "number" && productCount > 0 ? (
                  <div className="mt-[3px] font-mono text-[11px] text-ink-muted">
                    {productCount}{" "}
                    {productCount === 1 ? "producto" : "productos"}
                  </div>
                ) : null}
              </div>
            </LocalizedClientLink>
          )
        })}
      </div>

      {/*
        One dot per reachable scroll position, not per card — see
        `computeCarouselPages`. Rendered only when there is somewhere to go, so a
        track that already fits shows no inert controls.
      */}
      {pages.length > 1 ? (
        <div className="mt-5 flex items-center justify-center gap-2">
          {pages.map((page, index) => (
            <button
              key={page.scrollLeft}
              type="button"
              onClick={() => scrollToPage(index)}
              aria-label={`Ir a ${categories[page.cardIndex]?.name ?? ""}`}
              aria-current={active === index}
              aria-controls={TRACK_ID}
              className={`h-2 rounded-full transition-all ${
                active === index
                  ? "w-6 bg-coral"
                  : "w-2 bg-line hover:bg-coral-light"
              }`}
            />
          ))}
        </div>
      ) : null}

      <LocalizedClientLink
        href="/store"
        className="mt-6 flex justify-center border-coral text-[15px] text-ink small:hidden"
      >
        <span className="border-b-2 border-coral pb-0.5">
          Ver todo el catálogo →
        </span>
      </LocalizedClientLink>
    </section>
  )
}

export default CategoriesCarousel

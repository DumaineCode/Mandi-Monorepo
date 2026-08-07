"use client"

import Image from "next/image"
import { useCallback, useEffect, useState } from "react"

import LocalizedClientLink from "@modules/common/components/localized-client-link"

import { HERO_SLIDES } from "./slides"

const AUTOPLAY_MS = 6500

/**
 * Home hero — image slider.
 *
 * Each slide is a PAIR of images sharing one canvas: the base artwork and a
 * fully transparent overlay that only contains the headline, already positioned
 * by the designer. Because both layers are painted into the exact same box, the
 * headline lands where it was designed for every slide, with zero per-slide CSS.
 * The overlay is what animates in; the base only gets a subtle settle.
 *
 * The frame's aspect ratio comes from the FIRST slide, so the section height
 * never jumps while sliding. Keep every pair on the same ratio.
 */
const Hero = () => {
  const slides = HERO_SLIDES
  const hasMultiple = slides.length > 1

  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)

  const goTo = useCallback(
    (index: number) => setActive((index + slides.length) % slides.length),
    [slides.length]
  )

  useEffect(() => {
    if (!hasMultiple || paused) {
      return
    }

    const timer = window.setInterval(
      () => setActive((current) => (current + 1) % slides.length),
      AUTOPLAY_MS
    )

    return () => window.clearInterval(timer)
  }, [hasMultiple, paused, slides.length])

  const ratio = `${slides[0].width} / ${slides[0].height}`

  return (
    <section
      aria-roledescription={hasMultiple ? "carousel" : undefined}
      aria-label={hasMultiple ? "Destacados" : undefined}
      className="relative w-full"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* The headline only exists as pixels inside `textImage`; this is the real
          text for screen readers and crawlers. */}
      <h1 className="sr-only">{slides[active].headline}</h1>

      <div className="mx-auto w-full max-w-[1320px] px-4 pt-4 small:px-6 small:pt-6">
        <div
          className="relative w-full overflow-hidden rounded-large"
          style={{ aspectRatio: ratio }}
        >
          {slides.map((slide, index) => {
            const isActive = index === active

            const media = (
              // `key` on the animated wrapper: remounting on slide change is what
              // replays the CSS entrance animation.
              <div
                key={`${slide.id}-${active}`}
                className="absolute inset-0 animate-hero-media-in motion-reduce:animate-none"
              >
                <Image
                  src={slide.image}
                  alt={slide.alt}
                  fill
                  priority={index === 0}
                  sizes="(max-width: 1320px) 100vw, 1320px"
                  className="object-cover"
                />
                <Image
                  src={slide.textImage}
                  alt=""
                  aria-hidden
                  fill
                  priority={index === 0}
                  sizes="(max-width: 1320px) 100vw, 1320px"
                  className="animate-hero-text-in object-cover motion-reduce:animate-none"
                />
              </div>
            )

            return (
              <div
                key={slide.id}
                aria-hidden={!isActive}
                inert={!isActive}
                className={`absolute inset-0 transition-opacity duration-700 ease-out ${
                  isActive ? "opacity-100" : "opacity-0"
                }`}
              >
                {slide.href ? (
                  <LocalizedClientLink
                    href={slide.href}
                    className="block h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                    tabIndex={isActive ? undefined : -1}
                  >
                    {media}
                  </LocalizedClientLink>
                ) : (
                  media
                )}
              </div>
            )
          })}
        </div>
      </div>

      {hasMultiple && (
        <div className="mx-auto flex w-full max-w-[1320px] items-center justify-center gap-2 px-4 pt-4 small:px-6">
          {slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              aria-label={`Ir a la diapositiva ${index + 1}`}
              aria-current={index === active}
              onClick={() => goTo(index)}
              className={`h-2 rounded-circle transition-all duration-300 ${
                index === active
                  ? "w-7 bg-ink"
                  : "w-2 bg-ink/25 hover:bg-ink/45"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export default Hero

"use client"

import type { CSSProperties } from "react"
import { useCallback, useEffect, useState } from "react"

import LocalizedClientLink from "@modules/common/components/localized-client-link"

import type { HeroHighlightColor, HeroText, HeroTextSegment } from "./slides"
import { HERO_ARTWORK, HERO_ARTWORK_MOBILE, HERO_SLIDES } from "./slides"

const AUTOPLAY_MS = 6500

/**
 * Viewport width at which the hero swaps artwork, frame ratio and headline
 * metrics — the `small` breakpoint, restated as a media query.
 *
 * It has to be ONE number. The artwork swap happens in a `<source media>`,
 * which CSS classes cannot express, while the headline placement happens in
 * `small:` utilities, which a media string cannot express. If the two ever
 * disagree, a range of viewport widths gets one artwork with the OTHER
 * artwork's headline percentages — the exact silent mis-registration
 * `slides.ts` warns about, with nothing failing at build time.
 *
 * Keep in sync with `screens.small` in `tailwind.config.js`.
 */
const WIDE_FRAME_MEDIA = "(min-width: 1024px)"

/**
 * Slide highlight colour -> background utility.
 *
 * Written out as complete, literal class names on purpose. Tailwind scans the
 * source as plain text, so a template literal like `bg-hero-highlight-${color}`
 * is invisible to it and all four swipes would be purged out of the production
 * stylesheet — every pill would render transparent with no build error to warn
 * anyone. A `Record` keyed by the union also makes adding a colour a type error
 * until the class is registered here.
 */
const HIGHLIGHT_BACKGROUND: Record<HeroHighlightColor, string> = {
  lilac: "bg-hero-highlight-lilac",
  yellow: "bg-hero-highlight-yellow",
  pink: "bg-hero-highlight-pink",
  blue: "bg-hero-highlight-blue",
}

/**
 * Headline letter-spacing — a BRAND CHOICE, not a measurement.
 *
 * The source artwork is set tight (measured ~-0.027em against BluSans Black's
 * natural advance widths), which crowded the glyphs and pinched the trailing
 * accent dot. We deliberately open it up instead of reproducing the artwork.
 * Tune here: this is the one knob for how airy the headline reads.
 */
const HEADLINE_TRACKING = "0.01em"

// The three tuned numbers behind the highlighter swipe.
//
// All three are applied through inline `style`, NEVER through arbitrary-value
// classes like `h-[1.07em]`. Tailwind only ever sees source text: once a value
// lives in a constant, `h-[${HIGHLIGHT_PILL_HEIGHT}]` is invisible to the
// scanner, the utility is never generated, and the pill ships with no height and
// no rotation — with nothing failing at build time to warn anyone. Inline styles
// are not scanned and cannot be purged, so the numbers can stay named in one
// place AND survive the build.

/**
 * Swipe angle — MEASURED, not a choice.
 *
 * Pixel-measured off the design files; it is the angle of the marker stroke in
 * the source artwork. Changing it stops matching the design, so this is a
 * transcription, not a knob.
 */
const HIGHLIGHT_ROTATION = "-1.64deg"

/**
 * Swipe height relative to the type — MEASURED, not a choice.
 *
 * Pixel-measured off the design files as the stroke's height against the
 * headline. Expressed in `em` because it has to track the font size, and every
 * slide sets its own.
 */
const HIGHLIGHT_PILL_HEIGHT = "1.07em"

/**
 * Horizontal room around a swiped word — a CHOICE, not a measurement.
 *
 * Ours, not the artwork's. This is what gives the swipe its width without a
 * negative inset (see the span below). Tune here if a pill reads too tight or
 * too loose around its word.
 */
const HIGHLIGHT_PILL_PADDING = "0.3em"

/**
 * One styled run of the headline.
 *
 * `highlight` is a highlighter-marker swipe: the pill is rotated, the words on
 * top are NOT. Rotating the type as well would read as a sticker rather than a
 * hand-drawn mark, so the rotation is isolated on a decorative background span
 * that assistive tech never sees. The swipe colour is per slide.
 */
const HeroSegment = ({
  segment,
  highlight,
}: {
  segment: HeroTextSegment
  highlight: HeroHighlightColor
}) => {
  if (segment.kind === "accent") {
    return <span className="text-teal">{segment.text}</span>
  }

  if (segment.kind === "highlight") {
    return (
      // The swipe's width comes from PADDING on this span, not from a negative
      // inset on the pill. A pill that bleeds outside its box paints over the
      // neighbouring words — it covered the "a" of "la". As padding, the swipe
      // occupies real layout space, so the line flows around it and the text
      // that FOLLOWS a swipe (the comma after "protegen", the " en" after
      // "sabor frutal") starts cleanly past the pill's edge instead of under it.
      <span
        className="relative inline-block"
        style={{ paddingInline: HIGHLIGHT_PILL_PADDING }}
      >
        <span
          aria-hidden
          className={`absolute inset-x-0 top-1/2 rounded-full ${HIGHLIGHT_BACKGROUND[highlight]}`}
          style={{
            height: HIGHLIGHT_PILL_HEIGHT,
            // Both the centring and the tilt go in ONE inline transform: an
            // inline `transform` replaces the whole property, so a Tailwind
            // `-translate-y-1/2` alongside it would simply be overwritten.
            transform: `translateY(-50%) rotate(${HIGHLIGHT_ROTATION})`,
          }}
        />
        <span className="relative text-white">{segment.text}</span>
      </span>
    )
  }

  return <span>{segment.text}</span>
}

/**
 * The headline block, placed by percentage inside the artwork frame.
 *
 * Percentages are what replace the old baked-in bitmap: the words keep the
 * designer's placement at every viewport width without a per-breakpoint export
 * and without per-slide CSS.
 *
 * TWO ELEMENTS, DELIBERATELY. The outer wrapper owns PLACEMENT (`left`, `top`
 * and, when centred, `translateX(-50%)`); the inner `h1` owns the ENTRANCE
 * ANIMATION. They cannot be merged: `hero-text-in` animates `transform`, and it
 * runs with `both`, so its final keyframe (`translate3d(0,0,0) scale(1)`) keeps
 * overriding the element's own `transform` even after the animation ends. A
 * `-translate-x-1/2` on the animated element would therefore be discarded for
 * the whole entrance and never come back — the centred headline would sit a
 * half-block too far right, permanently.
 *
 * The wrapper is `w-max` so the block is sized by its longest authored line.
 * Shrink-to-fit would measure against the space left of the frame edge, which
 * for a centred block anchored at `left: 50%` is only half the viewport, and
 * the longer lines would reflow — silently breaking the authored line breaks.
 */
const HeroHeadline = ({ text }: { text: HeroText }) => {
  const isCentered = text.align === "center"
  const isCenteredMobile = (text.alignMobile ?? text.align) === "center"

  // Anchoring is per breakpoint, so BOTH states of both utilities have to be
  // written out — `translate-x-0` and `text-left` are not no-ops here, they are
  // what cancels the narrow frame's centring on the wide one. Leaving them
  // implicit (the old `isCentered ? "..." : ""`) works only while a slide is
  // centred on both frames; slide 1 is centred on one and ragged on the other,
  // and an unset utility would carry the narrow anchoring into the wide layout.
  const anchorClass = isCenteredMobile ? "-translate-x-1/2" : "translate-x-0"
  const anchorClassWide = isCentered
    ? "small:-translate-x-1/2"
    : "small:translate-x-0"
  const alignClass = isCenteredMobile ? "text-center" : "text-left"
  const alignClassWide = isCentered ? "small:text-center" : "small:text-left"

  return (
    <div
      className={`absolute left-[var(--hero-text-left-mobile)] top-[var(--hero-text-top-mobile)] w-max small:left-[var(--hero-text-left)] small:top-[var(--hero-text-top)] ${anchorClass} ${anchorClassWide}`}
      style={
        {
          "--hero-text-left": text.position.left,
          "--hero-text-top": text.position.top,
          "--hero-text-left-mobile": text.positionMobile.left,
          "--hero-text-top-mobile": text.positionMobile.top,
          "--hero-text-size": text.fontSize,
          "--hero-text-size-mobile": text.fontSizeMobile,
        } as CSSProperties
      }
    >
      {/* `leading-[1.0]` is load-bearing, not a reset: line-height sets the
          block's total height, which is what decides whether a three-line
          headline still lands on its measured `top`. */}
      <h1
        className={`animate-hero-text-in font-blusans text-[length:var(--hero-text-size-mobile)] font-black leading-[1.0] text-hero-headline motion-reduce:animate-none small:text-[length:var(--hero-text-size)] ${alignClass} ${alignClassWide}`}
        style={{ letterSpacing: HEADLINE_TRACKING }}
      >
        {text.lines.map((line, lineIndex) => (
          <span key={lineIndex} className="block">
            {line.map((segment, segmentIndex) => (
              <HeroSegment
                key={segmentIndex}
                segment={segment}
                highlight={text.highlight}
              />
            ))}
          </span>
        ))}
      </h1>
    </div>
  )
}

/**
 * Home hero — image slider.
 *
 * Each slide is one piece of artwork plus a REAL text headline layered on top.
 * The headline used to be a second, fully transparent bitmap; it is now HTML in
 * the brand face, positioned by percentage (see `slides.ts`), which makes it
 * selectable, translatable and indexable and removes the per-breakpoint exports.
 *
 * The frame's aspect ratio comes from `HERO_ARTWORK` — the size every slide is
 * exported at — so the section height never jumps while sliding.
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

  const ratio = `${HERO_ARTWORK.width} / ${HERO_ARTWORK.height}`
  const ratioMobile = `${HERO_ARTWORK_MOBILE.width} / ${HERO_ARTWORK_MOBILE.height}`

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
      {/* Full-bleed: no max-width, no padding, no rounding.
          The frame is the artwork's own ratio, so the height falls out of the
          viewport width and NOTHING is ever cropped — which keeps the headline
          percentages honest (see `slides.ts`).

          TWO ratios, swapped at the same breakpoint as the artwork. A single
          ratio would crop whichever artwork it does not match, and cropping is
          precisely what invalidates the percentages: they were measured against
          the whole frame.

          The ratios go in through CSS VARIABLES rather than an arbitrary class
          built from the constants, for the reason spelled out above
          `HIGHLIGHT_ROTATION` — Tailwind only reads source text, so
          `aspect-[${ratio}]` generates nothing. The utilities below are literal
          and the numbers ride in on `style`, so both survive the build. */}
      <div className="w-full">
        <div
          className="relative aspect-[var(--hero-ratio-mobile)] w-full overflow-hidden small:aspect-[var(--hero-ratio)]"
          style={
            {
              "--hero-ratio": ratio,
              "--hero-ratio-mobile": ratioMobile,
            } as CSSProperties
          }
        >
          {slides.map((slide, index) => {
            const isActive = index === active

            const media = (
              // `key` on the animated wrapper: remounting is what replays the
              // CSS entrance animations of both layers. It keys off THIS
              // slide's own activity, not the global index, so a tick remounts
              // only the two slides whose state actually changed — the one
              // entering and the one leaving. The other four keep their DOM,
              // their decoded image and their finished animations.
              <div key={`${slide.id}-${isActive}`} className="absolute inset-0">
                {/* ART DIRECTION, so `<picture>` rather than `next/image`.
                    The two exports are different COMPOSITIONS at different
                    ratios, not one image at two sizes, and `next/image` has no
                    way to express that: `sizes` only ever picks a width of the
                    SAME source.

                    The alternative — two `<Image>`s toggled with `hidden` —
                    was rejected because `display: none` does not stop a
                    download. A phone would fetch the wide artwork too, on top
                    of its own, and it would do so while competing with the LCP
                    element for bandwidth. `<source media>` makes the browser
                    commit to exactly one file before it requests anything.

                    Losing the optimiser costs little here: these are static,
                    pre-compressed WebP exports sized for the frame, so the
                    optimiser would mostly be re-encoding WebP as WebP. */}
                <picture>
                  <source media={WIDE_FRAME_MEDIA} srcSet={slide.image} />
                  {/* Intrinsic `width`/`height` are deliberately omitted: the
                      two candidates have different intrinsic sizes, so either
                      pair would be a lie about the other. There is no layout
                      shift to guard against anyway — the frame's height comes
                      from its own aspect ratio, not from the image. */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- art direction requires <picture>; see above */}
                  <img
                    src={slide.imageMobile}
                    alt={slide.alt}
                    decoding="async"
                    loading={index === 0 ? "eager" : "lazy"}
                    fetchPriority={index === 0 ? "high" : undefined}
                    className="absolute inset-0 h-full w-full animate-hero-media-in object-cover motion-reduce:animate-none"
                  />
                </picture>
                <HeroHeadline text={slide.text} />
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
        // Overlaid, not stacked underneath. Dots in normal flow would add their
        // own height to the section, re-opening the empty strip below the hero
        // the moment a second slide exists.
        <div className="absolute inset-x-0 bottom-4 z-10 flex justify-center small:bottom-6">
          {/* Scrim behind the cluster, not restyled dots.
              The dots sit on artwork we do not control: slide 3 puts saturated
              pink dragon fruit under them, where the inactive state disappears
              entirely and you cannot tell how many slides exist. Tinting the
              dots would only move the problem to the next artwork. A neutral
              surface underneath makes the control readable on ALL six, and on
              whatever gets added later. */}
          <div className="flex items-center gap-2 rounded-circle bg-paper/70 px-3 py-2 backdrop-blur-sm">
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
                    : "w-2 bg-ink/40 hover:bg-ink/60"
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export default Hero

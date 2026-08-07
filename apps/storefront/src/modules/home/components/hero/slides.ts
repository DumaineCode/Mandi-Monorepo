export type HeroSlide = {
  id: string
  /**
   * Base artwork: background + product photography, WITHOUT the headline.
   */
  image: string
  /**
   * Headline artwork exported over the FULL original canvas: only the words are
   * painted, everything else is transparent. That is what lets each slide place
   * its headline wherever the design wants without hand-tuning CSS offsets.
   *
   * HARD REQUIREMENT: `textImage` must have the exact same pixel dimensions as
   * `image`. Both are painted into the same box, so a mismatch of even a few
   * pixels drifts the headline off its designed position.
   */
  textImage: string
  /**
   * Intrinsic size of the pair. Drives the aspect ratio of the hero frame.
   * Every slide should share the same ratio, otherwise the hero height jumps
   * between slides.
   */
  width: number
  height: number
  /**
   * The real, literal text baked into `textImage`. Rendered visually hidden so
   * screen readers and search engines still get a real <h1>. Never skip it:
   * text living only inside a bitmap is invisible to both.
   */
  headline: string
  /** Description of the base artwork for assistive tech. */
  alt: string
  /** Optional destination. When set, the whole slide becomes a link. */
  href?: string
}

// Assets live in `public/hero/`. Both files of a pair are exported from the same
// artboard at 1920x1085 (see the dimension requirement above).
export const HERO_SLIDES: HeroSlide[] = [
  {
    id: "opcion-1",
    image: "/hero/slide-1.webp",
    textImage: "/hero/slide-1-text.webp",
    width: 1920,
    height: 1085,
    headline: "Somos la opción #1 en insumos para tu cafetería.",
    alt: "Botes de polvo Mandi sabor Cookies & Cream y Taro",
    href: "/store",
  },
]

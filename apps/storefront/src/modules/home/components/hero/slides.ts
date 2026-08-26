/**
 * One styled run of the headline. Splitting the copy into segments is what lets
 * a slide mix plain type, a highlighter swipe and an accent mark without any
 * per-slide CSS.
 */
export type HeroTextSegment =
  | { kind: "plain"; text: string }
  | { kind: "highlight"; text: string } // white text on the rotated pill
  | { kind: "accent"; text: string } // `teal`

/**
 * Which highlighter swipe a slide uses. CLOSED union on purpose — see
 * `HIGHLIGHT_BACKGROUND` in `./index.tsx`, where the class names live, for why.
 */
export type HeroHighlightColor = "lilac" | "yellow" | "pink" | "blue"

/**
 * Horizontal anchoring of the headline block inside the artwork frame.
 *
 * `left`   — `position.left` is the block's left edge, copy is ragged-right.
 * `center` — `position.left` is the block's CENTER, copy is centred.
 *
 * Only the horizontal axis is affected: `position.top` is always the block's
 * top edge, regardless of `align`.
 */
export type HeroTextAlign = "left" | "center"

export type HeroText = {
  /** One array per visual line. Line breaks are authored, not reflowed. */
  lines: HeroTextSegment[][]
  /** How `position.left` is interpreted, and how the copy is set. */
  align: HeroTextAlign
  /**
   * Narrow-viewport anchoring override; falls back to `align`.
   *
   * Optional because it usually matches, but it CANNOT be derived: the two
   * artworks are different compositions, not one composition at two sizes. The
   * wide frame has room to set a headline ragged-right beside the product,
   * where the narrow frame stacks the copy above it and wants it centred.
   */
  alignMobile?: HeroTextAlign
  /** Block origin as % of the frame — mirrors where the designer placed it. */
  position: { left: string; top: string }
  /**
   * Block origin as % of the NARROW frame. Required, not optional.
   *
   * The two artworks have different aspect ratios and different compositions,
   * so a wide-frame percentage carries no meaning on the narrow one — reusing
   * it would drop the headline on top of the product photography. Every slide
   * has to state where its copy sits in ITS narrow artwork, and a new slide
   * that omits it is a type error rather than a silent mis-registration.
   */
  positionMobile: { left: string; top: string }
  /**
   * Headline size for THIS slide, measured off the artwork and expressed in
   * `vw`. The hero is full-bleed, so 1vw of the artwork is 1vw of the viewport:
   * the type has to scale linearly with the frame or it drifts out of
   * proportion with the photography. Deliberately NOT clamped at the top end.
   */
  fontSize: string
  /**
   * Narrow-viewport size, measured off the narrow artwork. Required, and for
   * the same reason as `positionMobile`.
   *
   * This used to be optional, with the component scaling `fontSize` up by a
   * blanket factor as a legibility stopgap while no narrow artwork existed.
   * The artwork exists now, so the guess is gone: `vw` sizes measured against a
   * 12:5 frame do not describe type on a 7:6 one.
   */
  fontSizeMobile: string
  /** Highlighter swipe colour for this slide's `highlight` segments. */
  highlight: HeroHighlightColor
}

export type HeroSlide = {
  id: string
  /**
   * Base artwork: background + product photography, WITHOUT the headline.
   */
  image: string
  /**
   * The same slide re-composed for the narrow frame — ART DIRECTION, not a
   * resize. The product photography is re-laid-out to clear a band of empty
   * background at the top, which is where the narrow headline goes.
   *
   * This is why it is a separate asset rather than a `sizes` hint: no amount of
   * scaling turns a 12:5 composition into a 7:6 one, and cropping the wide art
   * to a phone would cut the products in half.
   */
  imageMobile: string
  /**
   * The headline, as real text. This is the data that used to be frozen inside
   * a bitmap overlay: the words, their line breaks and their placement all used
   * to be pixels, which meant one export per breakpoint and copy that no
   * screen reader, translator or crawler could touch.
   *
   * `position` is expressed in PERCENTAGES of the frame, never in pixels, so
   * the block tracks the artwork at any viewport width — exactly like the
   * baked-in overlay did, but with selectable type.
   */
  text: HeroText
  /** Description of the base artwork for assistive tech. */
  alt: string
  /** Optional destination. When set, the whole slide becomes a link. */
  href?: string
}

/**
 * Intrinsic size of EVERY hero artwork, and the single source of the frame's
 * aspect ratio.
 *
 * Every artwork must be exported at exactly this size (2400x1000, 12:5). The
 * frame ratio is derived from here, not from any one slide, so the hero height
 * never jumps while sliding.
 *
 * A slide exported at a different ratio silently mis-registers every `position`
 * percentage on it: the percentages were measured against this frame, and the
 * frame no longer matches the art. Nothing throws, nothing warns and the build
 * still passes — the headline just sits off its mark. That failure is INVISIBLE,
 * which is why it has to be prevented at export time rather than caught later.
 */
export const HERO_ARTWORK = { width: 2400, height: 1000 } as const

/**
 * Intrinsic size of EVERY narrow-viewport hero artwork (1400x1200, 7:6), and
 * the source of the narrow frame's aspect ratio.
 *
 * Everything said about `HERO_ARTWORK` applies here, against its own frame.
 * The two ratios are far apart on purpose — that gap is the whole point of
 * shipping a second export instead of letting one image cover both — which
 * also means a `positionMobile` percentage and a `position` percentage are
 * measurements of DIFFERENT frames and are never interchangeable.
 */
export const HERO_ARTWORK_MOBILE = { width: 1400, height: 1200 } as const

const OPCION_1_LINES: HeroTextSegment[][] = [
  [
    { kind: "plain", text: "Somos la " },
    { kind: "highlight", text: "opción #1" },
  ],
  [{ kind: "plain", text: "en insumos para tu" }],
  [
    { kind: "plain", text: "cafetería" },
    { kind: "accent", text: "." },
  ],
]

// Assets live in `public/hero/`.
export const HERO_SLIDES: HeroSlide[] = [
  {
    id: "opcion-1",
    image: "/hero/slide-1.webp",
    imageMobile: "/hero/slide-1-mobile.webp",
    text: {
      lines: OPCION_1_LINES,
      align: "left",
      // The one slide whose anchoring actually flips: the wide art sets this
      // headline ragged-right in the empty left third, the narrow art stacks
      // it centred above the two tubs.
      alignMobile: "center",
      position: { left: "6.45%", top: "58.13%" },
      positionMobile: { left: "50%", top: "8%" },
      fontSize: "3.36vw",
      fontSizeMobile: "7.5vw",
      highlight: "lilac",
    },
    alt: "Botes de polvo Mandi sabor Cookies & Cream y Taro",
    href: "/store",
  },
  {
    id: "ice-frutal",
    image: "/hero/slide-2.webp",
    imageMobile: "/hero/slide-2-mobile.webp",
    text: {
      lines: [
        [
          { kind: "plain", text: "¡Prueba el " },
          { kind: "highlight", text: "toque frutal" },
        ],
        [{ kind: "plain", text: "que transformará" }],
        [
          { kind: "plain", text: "tus bebidas!" },
          { kind: "accent", text: "." },
        ],
      ],
      align: "center",
      position: { left: "50%", top: "40.28%" },
      positionMobile: { left: "50%", top: "8%" },
      fontSize: "3.63vw",
      fontSizeMobile: "7.5vw",
      highlight: "yellow",
    },
    alt: "Botes de polvo Mandi Ice Frutal sabor Dragon Fruit y Blueberry",
    href: "/store",
  },
  {
    id: "tisana-frutal",
    image: "/hero/slide-3.webp",
    imageMobile: "/hero/slide-3-mobile.webp",
    text: {
      lines: [
        [{ kind: "plain", text: "Llena tus bebidas de" }],
        [
          { kind: "plain", text: "un " },
          { kind: "highlight", text: "sabor frutal" },
          { kind: "plain", text: " en" },
        ],
        [
          { kind: "plain", text: "cada taza" },
          { kind: "accent", text: "." },
        ],
      ],
      align: "center",
      position: { left: "50%", top: "49.72%" },
      // Sits highest of the five: this is the only three-line headline whose
      // longest line is 20 characters, so it needs the extra band.
      positionMobile: { left: "50%", top: "6%" },
      fontSize: "4.06vw",
      fontSizeMobile: "7vw",
      highlight: "pink",
    },
    alt: "Bolsas de tisana frutal Mandi sabor Mango Maracuyá y Fresa Mango",
    href: "/store",
  },
  {
    id: "envases",
    image: "/hero/slide-4.webp",
    imageMobile: "/hero/slide-4-mobile.webp",
    text: {
      lines: [
        [
          { kind: "plain", text: "Envases que " },
          { kind: "highlight", text: "protegen" },
          { kind: "plain", text: "," },
        ],
        [{ kind: "plain", text: "conservan y destacan" }],
        [
          { kind: "plain", text: "tus productos" },
          { kind: "accent", text: "." },
        ],
      ],
      align: "center",
      position: { left: "50%", top: "10%" },
      positionMobile: { left: "50%", top: "6%" },
      fontSize: "4.32vw",
      fontSizeMobile: "7vw",
      highlight: "lilac",
    },
    alt: "Envases Mandi vacíos: frasco transparente, bote negro y frasco de boca ancha",
    href: "/store",
  },
  {
    id: "syrope-soda",
    image: "/hero/slide-5.webp",
    imageMobile: "/hero/slide-5-mobile.webp",
    text: {
      lines: [
        [
          { kind: "plain", text: "¡El toque " },
          { kind: "highlight", text: "refrescante" },
          { kind: "plain", text: " que" },
        ],
        [
          { kind: "plain", text: "tus bebidas necesitan!" },
          { kind: "accent", text: "." },
        ],
      ],
      align: "center",
      position: { left: "50%", top: "51.11%" },
      // Two lines instead of three, so the block is short — but the bottles
      // reach higher into the narrow frame than any other product, which is
      // what keeps this one from going higher than the tisana slide.
      positionMobile: { left: "50%", top: "8%" },
      fontSize: "4.02vw",
      fontSizeMobile: "6.5vw",
      highlight: "blue",
    },
    alt: "Botellas de jarabe Mandi Syrope Soda Italiana sabor Manzana Verde y Dragon Fruit",
    href: "/store",
  },
]

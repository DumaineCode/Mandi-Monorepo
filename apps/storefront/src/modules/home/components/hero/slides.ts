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
  /** Block origin as % of the frame — mirrors where the designer placed it. */
  position: { left: string; top: string }
  /** Optional narrow-viewport override; falls back to `position`. */
  positionMobile?: { left: string; top: string }
  /**
   * Headline size for THIS slide, measured off the artwork and expressed in
   * `vw`. The hero is full-bleed, so 1vw of the artwork is 1vw of the viewport:
   * the type has to scale linearly with the frame or it drifts out of
   * proportion with the photography. Deliberately NOT clamped at the top end.
   */
  fontSize: string
  /**
   * Optional narrow-viewport size override. Without one the component derives a
   * legibility floor from `fontSize` (see `MOBILE_FONT_SIZE_FACTOR`), because a
   * linear `vw` size that is right at 2560px is unreadable on a 390px phone.
   */
  fontSizeMobile?: string
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
    text: {
      lines: OPCION_1_LINES,
      align: "left",
      position: { left: "6.45%", top: "58.13%" },
      fontSize: "3.36vw",
      highlight: "lilac",
    },
    alt: "Botes de polvo Mandi sabor Cookies & Cream y Taro",
    href: "/store",
  },
  {
    id: "ice-frutal",
    image: "/hero/slide-2.webp",
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
      fontSize: "3.63vw",
      highlight: "yellow",
    },
    alt: "Botes de polvo Mandi Ice Frutal sabor Dragon Fruit y Blueberry",
    href: "/store",
  },
  {
    id: "tisana-frutal",
    image: "/hero/slide-3.webp",
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
      fontSize: "4.06vw",
      highlight: "pink",
    },
    alt: "Bolsas de tisana frutal Mandi sabor Mango Maracuyá y Fresa Mango",
    href: "/store",
  },
  {
    id: "envases",
    image: "/hero/slide-4.webp",
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
      fontSize: "4.32vw",
      highlight: "lilac",
    },
    alt: "Envases Mandi vacíos: frasco transparente, bote negro y frasco de boca ancha",
    href: "/store",
  },
  {
    id: "syrope-soda",
    image: "/hero/slide-5.webp",
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
      fontSize: "4.02vw",
      highlight: "blue",
    },
    alt: "Botellas de jarabe Mandi Syrope Soda Italiana sabor Manzana Verde y Dragon Fruit",
    href: "/store",
  },
]

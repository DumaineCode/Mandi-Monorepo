/**
 * Scroll-position model for a scroll-snap carousel.
 *
 * A track cannot scroll past `scrollWidth - clientWidth`. Any pagination that
 * assumes one dot per card therefore breaks as soon as more than one card is
 * visible at a time: the trailing dots target positions the browser clamps, so
 * they render and receive focus but can never become active. Modelling reachable
 * *positions* instead of cards removes the whole class of bug.
 *
 * Kept free of DOM access so it can be unit-tested — the caller measures
 * `offsetLeft` and `scrollWidth - clientWidth` and passes plain numbers in.
 */

export type CarouselPage = {
  /** Scroll offset that brings this page into view. Always reachable. */
  scrollLeft: number
  /** First card landing on this page. Used for labelling the control. */
  cardIndex: number
}

/**
 * Build the list of distinct, reachable scroll positions for a track.
 *
 * @param offsets  Each card's offset from the first card, in scroll units.
 * @param maxScroll  `scrollWidth - clientWidth`; may be 0 or negative mid-layout.
 */
export const computeCarouselPages = (
  offsets: number[],
  maxScroll: number
): CarouselPage[] => {
  const limit = Math.max(maxScroll, 0)
  const pages: CarouselPage[] = []
  const seen = new Set<number>()

  offsets.forEach((offset, cardIndex) => {
    const scrollLeft = Math.min(Math.max(offset, 0), limit)

    // Cards beyond the scroll limit all clamp onto the same final position;
    // only the first of them earns a page, so every page stays addressable.
    if (seen.has(scrollLeft)) {
      return
    }

    seen.add(scrollLeft)
    pages.push({ scrollLeft, cardIndex })
  })

  return pages
}

/**
 * Index of the page nearest the current scroll position.
 *
 * Nearest rather than exact because this runs on every scroll event, including
 * mid-fling and mid-smooth-scroll, where `scrollLeft` sits between pages.
 */
export const activePageIndex = (
  pages: CarouselPage[],
  scrollLeft: number
): number => {
  let nearest = 0
  let smallestDelta = Number.POSITIVE_INFINITY

  pages.forEach((page, index) => {
    const delta = Math.abs(page.scrollLeft - scrollLeft)
    if (delta < smallestDelta) {
      smallestDelta = delta
      nearest = index
    }
  })

  return nearest
}

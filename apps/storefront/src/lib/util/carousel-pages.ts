/**
 * Scroll-position model for a scroll-snap carousel.
 *
 * Cards are sized off the container so a whole number of them fills the track,
 * and paging advances a full screenful — four cards at desktop, not one.
 *
 * A track also cannot scroll past `scrollWidth - clientWidth`. Any pagination
 * that ignores that clamp renders controls targeting positions the browser
 * refuses, so they receive focus and are announced but can never become active.
 * Modelling reachable *positions* rather than cards removes both problems.
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
 * @param perPage  Cards visible at once; measured, so guard against 0.
 */
export const computeCarouselPages = (
  offsets: number[],
  maxScroll: number,
  perPage: number
): CarouselPage[] => {
  const limit = Math.max(maxScroll, 0)
  const stride = Math.max(Math.floor(perPage), 1)
  const pages: CarouselPage[] = []
  const seen = new Set<number>()

  for (let cardIndex = 0; cardIndex < offsets.length; cardIndex += stride) {
    const scrollLeft = Math.min(Math.max(offsets[cardIndex], 0), limit)

    // Page starts past the scroll limit all clamp onto the same final position;
    // only the first of them earns a page, so every page stays addressable.
    if (seen.has(scrollLeft)) {
      continue
    }

    seen.add(scrollLeft)
    pages.push({ scrollLeft, cardIndex })
  }

  // The last partial page would otherwise be unreachable: with 9 cards shown 4
  // at a time, page start 8 is the only way to see cards 5-8.
  const lastReachable = pages[pages.length - 1]
  if (offsets.length && lastReachable && lastReachable.scrollLeft < limit) {
    pages.push({ scrollLeft: limit, cardIndex: offsets.length - 1 })
  }

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

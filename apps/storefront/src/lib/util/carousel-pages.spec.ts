import { describe, expect, it } from "vitest"

import { activePageIndex, computeCarouselPages } from "./carousel-pages"

/**
 * A scroll-snap track cannot scroll past `scrollWidth - clientWidth`. Naively
 * rendering one dot per card therefore produces dots that are focusable and
 * announced but can never activate: their target is clamped onto the same final
 * scroll position as an earlier dot.
 *
 * Real numbers from the home carousel at desktop — 9 cards of 268px with a 16px
 * gap (284px step) inside a ~1132px track — give a max scroll of 1408px, while a
 * per-card dot 8 would target 2272px. Dots 6, 7 and 8 all collapse onto 1408.
 * These tests pin the collapse so the defect cannot return.
 */
const step = (index: number) => index * 284

/**
 * Nine cards, four visible — the desktop home layout. Cards are sized off the
 * container so exactly `perPage` fill the track, which is why paging advances a
 * screenful at a time instead of a single card.
 */
const NINE = Array.from({ length: 9 }, (_, i) => step(i))

describe("computeCarouselPages", () => {
  it("advances a full screenful at a time", () => {
    // Cards 0, 4 and 8 start a page; 8 clamps back onto the track's end.
    const pages = computeCarouselPages(NINE, 1408, 4)

    expect(pages).toEqual([
      { scrollLeft: 0, cardIndex: 0 },
      { scrollLeft: 1136, cardIndex: 4 },
      { scrollLeft: 1408, cardIndex: 8 },
    ])
  })

  it("collapses page starts that clamp onto the same final position", () => {
    // With 8 per page, cards 0 and 8 are page starts, but 8 clamps to 1408 and
    // would otherwise duplicate a reachable position.
    const pages = computeCarouselPages(NINE, 1136, 8)

    expect(pages.map((p) => p.scrollLeft)).toEqual([0, 1136])
  })

  it("keeps every page addressable — no two share a scroll position", () => {
    const positions = computeCarouselPages(NINE, 1408, 4).map(
      (p) => p.scrollLeft
    )

    expect(new Set(positions).size).toBe(positions.length)
  })

  it("reports the first card of each page, for labelling", () => {
    expect(computeCarouselPages(NINE, 1408, 4).map((p) => p.cardIndex)).toEqual([
      0, 4, 8,
    ])
  })

  it("pages per card when only one fits at a time", () => {
    expect(computeCarouselPages([0, 284, 568], 568, 1).map((p) => p.cardIndex)).toEqual(
      [0, 1, 2]
    )
  })

  it("returns one page when everything fits and nothing can scroll", () => {
    expect(computeCarouselPages([0, 284, 568], 0, 4)).toEqual([
      { scrollLeft: 0, cardIndex: 0 },
    ])
  })

  /**
   * Five cards shown four at a time: the only page start is card 0, but the
   * track still scrolls. Without a trailing page the fifth card would be
   * visible by dragging yet unreachable through the controls.
   */
  it("adds a trailing page when the last screenful is partial", () => {
    const pages = computeCarouselPages([0, 284, 568, 852, 1136], 300, 4)

    expect(pages).toEqual([
      { scrollLeft: 0, cardIndex: 0 },
      { scrollLeft: 300, cardIndex: 4 },
    ])
  })

  it("does not add a trailing page when a page start already reaches the end", () => {
    const pages = computeCarouselPages([0, 284, 568, 852, 1136], 1136, 4)

    expect(pages.filter((p) => p.scrollLeft === 1136)).toHaveLength(1)
  })

  it("handles an empty track without throwing", () => {
    expect(computeCarouselPages([], 0, 4)).toEqual([])
  })

  /**
   * `perPage` is derived from live measurements, so a mid-layout 0 or a negative
   * must not divide by zero or produce an empty control strip.
   */
  it.each([0, -3])("treats a nonsensical perPage of %s as 1", (perPage) => {
    expect(computeCarouselPages([0, 284], 284, perPage).map((p) => p.cardIndex)).toEqual(
      [0, 1]
    )
  })

  /**
   * Layout measurements arrive from the DOM, so a negative maxScroll is possible
   * mid-resize (clientWidth momentarily exceeding scrollWidth). It must not
   * produce a negative scroll target.
   */
  it("never emits a negative scroll position", () => {
    expect(computeCarouselPages([0, 284], -20, 4)).toEqual([
      { scrollLeft: 0, cardIndex: 0 },
    ])
  })
})

describe("activePageIndex", () => {
  const pages = [0, 284, 568, 852, 1136, 1408].map((scrollLeft, cardIndex) => ({
    scrollLeft,
    cardIndex,
  }))

  it("matches an exact scroll position", () => {
    expect(activePageIndex(pages, 568)).toBe(2)
  })

  it("picks the nearest page while a smooth scroll is still in flight", () => {
    expect(activePageIndex(pages, 600)).toBe(2)
    expect(activePageIndex(pages, 800)).toBe(3)
  })

  /**
   * The final page is the one users reach by flinging the track to its end, so
   * it must win at max scroll — this is the exact position the collapsed dots
   * used to fight over.
   */
  it("selects the last page at maximum scroll", () => {
    expect(activePageIndex(pages, 1408)).toBe(5)
  })

  it("clamps below zero and above the end", () => {
    expect(activePageIndex(pages, -50)).toBe(0)
    expect(activePageIndex(pages, 99999)).toBe(5)
  })

  it("returns 0 for an empty page list", () => {
    expect(activePageIndex([], 120)).toBe(0)
  })
})

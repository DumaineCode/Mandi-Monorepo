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

describe("computeCarouselPages", () => {
  it("collapses targets that clamp onto the same final scroll position", () => {
    const offsets = Array.from({ length: 9 }, (_, i) => step(i))
    const pages = computeCarouselPages(offsets, 1408)

    // 0,284,568,852,1136 are reachable; 1420/1704/1988/2272 all clamp to 1408.
    expect(pages.map((p) => p.scrollLeft)).toEqual([
      0, 284, 568, 852, 1136, 1408,
    ])
  })

  it("keeps every page addressable — no two pages share a scroll position", () => {
    const offsets = Array.from({ length: 9 }, (_, i) => step(i))
    const positions = computeCarouselPages(offsets, 1408).map((p) => p.scrollLeft)

    expect(new Set(positions).size).toBe(positions.length)
  })

  it("reports the first card that lands on each page, for labelling", () => {
    const offsets = Array.from({ length: 9 }, (_, i) => step(i))
    const pages = computeCarouselPages(offsets, 1408)

    expect(pages.map((p) => p.cardIndex)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it("returns one page when everything fits and nothing can scroll", () => {
    const pages = computeCarouselPages([0, 284, 568], 0)

    expect(pages).toEqual([{ scrollLeft: 0, cardIndex: 0 }])
  })

  it("returns one page per card when the track can reach the last card", () => {
    const pages = computeCarouselPages([0, 284, 568], 568)

    expect(pages.map((p) => p.scrollLeft)).toEqual([0, 284, 568])
  })

  it("handles an empty track without throwing", () => {
    expect(computeCarouselPages([], 0)).toEqual([])
  })

  /**
   * Layout measurements arrive from the DOM, so a negative maxScroll is possible
   * mid-resize (clientWidth momentarily exceeding scrollWidth). It must not
   * produce a negative scroll target.
   */
  it("never emits a negative scroll position", () => {
    const pages = computeCarouselPages([0, 284], -20)

    expect(pages).toEqual([{ scrollLeft: 0, cardIndex: 0 }])
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

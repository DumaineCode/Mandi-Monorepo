import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startCategoryAutoplay } from "./category-autoplay"

describe("category autoplay", () => {
  let section: EventTarget & {
    matches: () => boolean
    contains: (node: unknown) => boolean
  }
  let documentStub: EventTarget & { hidden: boolean; activeElement: unknown }
  let motion: EventTarget & { matches: boolean }
  let intersect: (entries: { isIntersecting: boolean }[]) => void
  let cleanup: (() => void) | undefined
  const advance = vi.fn()
  const disconnect = vi.fn()
  const child = {}

  beforeEach(() => {
    vi.useFakeTimers()
    advance.mockClear()
    disconnect.mockClear()
    section = Object.assign(new EventTarget(), {
      matches: () => false,
      contains: (node: unknown) => node === child,
    })
    documentStub = Object.assign(new EventTarget(), {
      hidden: false,
      activeElement: null,
    })
    motion = Object.assign(new EventTarget(), { matches: false })
    vi.stubGlobal("document", documentStub)
    vi.stubGlobal("window", {
      matchMedia: () => motion,
      setInterval,
      clearInterval,
    })
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof intersect) {
          intersect = callback
        }
        observe() {}
        disconnect = disconnect
      }
    )
  })

  afterEach(() => {
    cleanup?.()
    cleanup = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const start = () => {
    cleanup = startCategoryAutoplay(
      section as unknown as HTMLElement,
      {} as HTMLElement,
      advance
    )
    intersect([{ isIntersecting: true }])
  }
  const tick = () => vi.advanceTimersByTime(2000)
  const dispatch = (type: string, properties = {}) => {
    section.dispatchEvent(Object.assign(new Event(type), properties))
  }

  it("waits two seconds, repeats, and cleans up its timer and observer", () => {
    start()
    vi.advanceTimersByTime(1999)
    expect(advance).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(advance).toHaveBeenCalledTimes(1)
    tick()
    expect(advance).toHaveBeenCalledTimes(2)
    cleanup?.()
    expect(disconnect).toHaveBeenCalledOnce()
    dispatch("mouseleave")
    tick()
    expect(advance).toHaveBeenCalledTimes(2)
    cleanup = undefined
  })

  it("keeps hover and focus independent, including focus moving between descendants", () => {
    start()
    dispatch("mouseenter")
    dispatch("focusin")
    dispatch("mouseleave")
    tick()
    dispatch("focusout", { relatedTarget: child })
    tick()
    expect(advance).not.toHaveBeenCalled()
    dispatch("focusout", { relatedTarget: null })
    tick()
    expect(advance).toHaveBeenCalledOnce()
  })

  it.each(["touchend", "touchcancel"])(
    "pauses during touch and restarts after %s",
    (event) => {
      start()
      dispatch("touchstart")
      tick()
      expect(advance).not.toHaveBeenCalled()
      dispatch(event, { touches: [] })
      vi.advanceTimersByTime(1999)
      expect(advance).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(advance).toHaveBeenCalledOnce()
    }
  )

  it("does not run offscreen or in a hidden tab, and waits on return", () => {
    start()
    intersect([{ isIntersecting: false }])
    tick()
    documentStub.hidden = true
    documentStub.dispatchEvent(new Event("visibilitychange"))
    intersect([{ isIntersecting: true }])
    tick()
    expect(advance).not.toHaveBeenCalled()
    documentStub.hidden = false
    documentStub.dispatchEvent(new Event("visibilitychange"))
    tick()
    expect(advance).toHaveBeenCalledOnce()
  })

  it("honors reduced motion at startup and when the preference changes", () => {
    motion.matches = true
    start()
    tick()
    expect(advance).not.toHaveBeenCalled()
    motion.matches = false
    motion.dispatchEvent(new Event("change"))
    tick()
    expect(advance).toHaveBeenCalledOnce()
    motion.matches = true
    motion.dispatchEvent(new Event("change"))
    tick()
    expect(advance).toHaveBeenCalledOnce()
  })
})

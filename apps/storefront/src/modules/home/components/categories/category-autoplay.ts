/**
 * Cadence between pages. There is no visible pause control, so the autoplay is
 * only acceptable because it yields to every sign of attention below — hover,
 * focus, touch, a hidden tab, an offscreen track and reduced motion.
 */
const INTERVAL_MS = 2000

/** Autoplay stays separate from native scrolling and never moves focus. */
export function startCategoryAutoplay(
  section: HTMLElement,
  track: HTMLElement,
  advance: () => void
) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
  let visible = false
  let hovered = section.matches(":hover")
  let focused = section.contains(document.activeElement)
  let touching = false
  let timer: number | undefined

  const update = () => {
    window.clearInterval(timer)
    timer = undefined
    if (
      !visible ||
      hovered ||
      focused ||
      touching ||
      document.hidden ||
      motion.matches
    ) {
      return
    }
    timer = window.setInterval(advance, INTERVAL_MS)
  }

  const enter = () => {
    hovered = true
    update()
  }
  const leave = () => {
    hovered = false
    update()
  }
  const focus = () => {
    focused = true
    update()
  }
  const blur = (event: FocusEvent) => {
    focused = section.contains(event.relatedTarget as Node | null)
    update()
  }
  const touchStart = () => {
    touching = true
    update()
  }
  const touchEnd = (event: TouchEvent) => {
    touching = event.touches.length > 0
    update()
  }

  // Fail closed in environments without visibility observation.
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    update()
  })
  observer.observe(track)
  section.addEventListener("mouseenter", enter)
  section.addEventListener("mouseleave", leave)
  section.addEventListener("focusin", focus)
  section.addEventListener("focusout", blur)
  section.addEventListener("touchstart", touchStart, { passive: true })
  section.addEventListener("touchend", touchEnd, { passive: true })
  section.addEventListener("touchcancel", touchEnd, { passive: true })
  document.addEventListener("visibilitychange", update)
  motion.addEventListener("change", update)

  return () => {
    window.clearInterval(timer)
    observer.disconnect()
    section.removeEventListener("mouseenter", enter)
    section.removeEventListener("mouseleave", leave)
    section.removeEventListener("focusin", focus)
    section.removeEventListener("focusout", blur)
    section.removeEventListener("touchstart", touchStart)
    section.removeEventListener("touchend", touchEnd)
    section.removeEventListener("touchcancel", touchEnd)
    document.removeEventListener("visibilitychange", update)
    motion.removeEventListener("change", update)
  }
}

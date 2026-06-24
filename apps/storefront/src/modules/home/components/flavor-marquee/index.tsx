// Flavor marquee under the hero (ref wireframe lines 123-129). Full-bleed
// coral band, scrolling uppercase flavors separated by ✦. The set is rendered
// twice so the translateX(-50%) loop is seamless; per-item horizontal padding
// (px-[22px], not gap) keeps each half symmetric. Duplicate set is aria-hidden.
const FLAVORS = [
  "Taro",
  "Matcha",
  "Mango",
  "Chai",
  "Fresa",
  "Cookies",
  "Coco",
] as const

// Build one half: flavor + ✦ separator after each, matching the reference.
const ITEMS = FLAVORS.flatMap((flavor) => [flavor, "✦"])

const FlavorMarquee = () => {
  return (
    <div className="overflow-hidden border-t-2 border-ink bg-coral text-coral-foreground">
      <div className="flex w-max animate-[scrollx_22s_linear_infinite] py-3 font-bricolage text-[22px] font-extrabold uppercase motion-reduce:animate-none">
        {ITEMS.map((item, i) => (
          <span key={`a-${i}`} className="px-[22px]">
            {item}
          </span>
        ))}
        {ITEMS.map((item, i) => (
          <span key={`b-${i}`} aria-hidden className="px-[22px]">
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

export default FlavorMarquee

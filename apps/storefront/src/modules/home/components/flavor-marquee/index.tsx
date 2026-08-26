import { BiCoffeeTogo } from "react-icons/bi"

// Flavor marquee under the hero (ref wireframe lines 123-129). Full-bleed
// coral band, scrolling uppercase flavors separated by a coffee-cup icon.
// The set is rendered twice so the translateX(-50%) loop is seamless;
// per-item horizontal padding (px-[22px], not gap) keeps each half symmetric.
// Duplicate set is aria-hidden.
const FLAVORS = [
  "Taro",
  "Matcha",
  "Mango",
  "Chai",
  "Fresa",
  "Cookies",
  "Coco",
] as const

// Renders one item followed by its own separator span, matching the
// reference layout.
const renderFlavorHalf = (idPrefix: string) =>
  FLAVORS.map((flavor) => (
    <span key={`${idPrefix}-${flavor}`} className="flex items-center">
      <span className="px-[18px]">{flavor}</span>
      <span aria-hidden className="flex items-center px-[18px]">
        <BiCoffeeTogo />
      </span>
    </span>
  ))

const FlavorMarquee = () => {
  return (
    <div className="overflow-hidden bg-coral text-coral-foreground">
      <div className="flex w-max animate-[scrollx_22s_linear_infinite] py-2 font-bricolage text-lg font-extrabold uppercase motion-reduce:animate-none small:text-xl">
        {renderFlavorHalf("primary")}
        <span aria-hidden className="flex">
          {renderFlavorHalf("dup")}
        </span>
      </div>
    </div>
  )
}

export default FlavorMarquee

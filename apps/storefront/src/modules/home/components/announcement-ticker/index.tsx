import { BiCoffeeTogo } from "react-icons/bi"

// Full-bleed scrolling announcement band (ref wireframe lines 29-35).
// The item set is rendered twice; with per-item horizontal padding (not gap)
// each half is symmetric, so the `animate-marquee` translateX(-50%) loops
// seamlessly. The duplicate set is aria-hidden so it is not read twice.
const TICKER_ITEMS = [
  "Envío 24 h a todo México",
  "Precios de mayoreo",
  "+500 cafeterías",
  "+40 sabores",
  "Compra mínima baja",
  "Soporte por WhatsApp",
] as const

// Renders one item followed by its own separator span, so the bean sits
// centered in the gap between features rather than glued to the item text.
// Trailing separator after the last item keeps spacing uniform at the seam
// where the duplicated half loops back into the first.
const renderTickerHalf = (idPrefix: string) =>
  TICKER_ITEMS.map((item) => (
    <span key={`${idPrefix}-${item}`} className="flex">
      <span className="px-[21px]">{item}</span>
      <span aria-hidden className="flex items-center px-[21px]">
        <BiCoffeeTogo />
      </span>
    </span>
  ))

const AnnouncementTicker = () => {
  return (
    <div className="overflow-hidden whitespace-nowrap bg-teal text-ink">
      <div className="flex w-max animate-marquee py-[9px] font-mono text-[11px] uppercase tracking-[0.08em] motion-reduce:animate-none small:text-xs">
        {renderTickerHalf("primary")}
        <span aria-hidden className="flex">
          {renderTickerHalf("dup")}
        </span>
      </div>
    </div>
  )
}

export default AnnouncementTicker

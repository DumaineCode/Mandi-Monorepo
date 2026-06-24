// Full-bleed scrolling announcement band (ref wireframe lines 29-35).
// The item set is rendered twice; with per-item horizontal padding (not gap)
// each half is symmetric, so the `animate-marquee` translateX(-50%) loops
// seamlessly. The duplicate set is aria-hidden so it is not read twice.
const TICKER_ITEMS = [
  "✦ Envío 24 h a todo México",
  "✦ Precios de mayoreo",
  "✦ +500 cafeterías",
  "✦ +40 sabores",
  "✦ Compra mínima baja",
  "✦ Soporte por WhatsApp",
] as const

const AnnouncementTicker = () => {
  return (
    <div className="overflow-hidden whitespace-nowrap bg-teal text-ink">
      <div className="flex w-max animate-marquee py-[9px] font-mono text-[11px] uppercase tracking-[0.08em] motion-reduce:animate-none small:text-xs">
        {TICKER_ITEMS.map((item) => (
          <span key={item} className="px-[21px]">
            {item}
          </span>
        ))}
        {TICKER_ITEMS.map((item) => (
          <span key={`dup-${item}`} aria-hidden className="px-[21px]">
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

export default AnnouncementTicker

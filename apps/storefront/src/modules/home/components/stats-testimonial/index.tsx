// Stats row (ref wireframe lines 217-227). Three rule-bordered stat cells.
// Kept at 3 columns on every breakpoint since the values/labels are short;
// type scales down on mobile. The pull-quote that used to live here moved to
// the dedicated `reviews-carousel` section, which does social proof better.
const STATS = [
  { value: "+40", label: "sabores" },
  { value: "24 h", label: "envío nacional" },
  { value: "+500", label: "cafeterías" },
] as const

const StatsTestimonial = () => {
  return (
    <section className="mx-auto max-w-[1180px] px-6 pb-2.5 pt-10 small:pt-14">
      <div className="grid grid-cols-3 border-y-2 border-ink">
        {STATS.map((stat, index) => (
          <div
            key={stat.label}
            className={`px-2 py-6 text-center small:py-7 ${
              index < STATS.length - 1 ? "border-r border-line" : ""
            }`}
          >
            <div className="font-bricolage text-[28px] font-extrabold tracking-[-0.02em] small:text-[40px]">
              {stat.value}
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-muted small:text-xs">
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default StatsTestimonial

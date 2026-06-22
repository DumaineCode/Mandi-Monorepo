"use client"

import { clx } from "@modules/common/components/ui"

export type SortOptions = "price_asc" | "price_desc" | "created_at"

type SortProductsProps = {
  sortBy: SortOptions
  setQueryParams: (name: string, value: SortOptions) => void
  "data-testid"?: string
}

// Spanish labels mapped to the EXISTING sort values (no new sort logic).
const sortOptions: { value: SortOptions; label: string }[] = [
  {
    value: "created_at",
    label: "Más recientes",
  },
  {
    value: "price_asc",
    label: "Precio: menor a mayor",
  },
  {
    value: "price_desc",
    label: "Precio: mayor a menor",
  },
]

/**
 * Compact "Ordenar: {opción} ▾" control (ref wireframe Tienda C, line 288).
 *
 * Implemented as a native <select> overlaid on the styled pill: the select is
 * transparent and stretched over the visual control to preserve native keyboard
 * + screen-reader behavior, while the design face shows "Ordenar: {current} ▾".
 * Same SortOptions values and the same `setQueryParams("sortBy", value)` wiring.
 */
const SortProducts = ({
  "data-testid": dataTestId,
  sortBy,
  setQueryParams,
}: SortProductsProps) => {
  const handleChange = (value: string) => {
    setQueryParams("sortBy", value as SortOptions)
  }

  const currentLabel =
    sortOptions.find((o) => o.value === sortBy)?.label ?? sortOptions[0].label

  return (
    <div
      className={clx(
        "relative inline-flex items-center gap-2 rounded-[9px] border border-line bg-paper px-3.5 py-2",
        "font-mono text-[13px] text-ink-soft",
        "transition-colors focus-within:border-ink hover:border-ink"
      )}
      data-testid={dataTestId}
    >
      <span className="pointer-events-none whitespace-nowrap">
        Ordenar: <span className="text-ink">{currentLabel}</span>
      </span>
      <span aria-hidden className="pointer-events-none text-ink-soft">
        ▾
      </span>
      <select
        aria-label="Ordenar productos"
        value={sortBy}
        onChange={(e) => handleChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 focus-visible:outline-none"
      >
        {sortOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export default SortProducts

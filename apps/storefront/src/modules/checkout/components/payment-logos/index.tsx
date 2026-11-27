// Brand logos rendered inside the checkout payment-method rows.
//
// The assets live in /public/payment-logos and are the SAME files the footer
// PaymentBadges uses — one source of truth for brand artwork. We only render
// marks for methods/processors we actually accept, so nothing here claims a
// relationship or certification we don't have.
//
// Visa, Mastercard, American Express, Carnet, Mercado Pago and Openpay are the
// official marks from the Openpay brand kit, trimmed and exported as PNG at
// 96px height (crisp at the 16–32px we render). OXXO is not in that kit and
// stays an SVG.

type PaymentLogoProps = {
  /** Filename (without extension) under /public/payment-logos. */
  file: string
  label: string
  /** File extension of the asset. Defaults to the official PNG exports. */
  ext?: "png" | "svg"
  /** Rendered chip height in px. Checkout rows use 22–24. */
  size?: number
}

// Every mark sits on the same white chip so the official artwork (which ships
// on a white/transparent background) stays legible on the dark footer and
// visually consistent next to each other.
export const PaymentLogo = ({
  file,
  label,
  ext = "png",
  size = 24,
}: PaymentLogoProps) => {
  if (ext === "svg") {
    return (
      <img
        src={`/payment-logos/${file}.svg`}
        alt={label}
        title={label}
        loading="lazy"
        className="block w-auto rounded-[4px]"
        style={{ height: size }}
      />
    )
  }

  const padY = Math.max(2, Math.round(size * 0.16))
  const padX = Math.max(3, Math.round(size * 0.28))

  return (
    <span
      className="flex items-center rounded-[4px] bg-white ring-1 ring-black/10"
      style={{ height: size, padding: `${padY}px ${padX}px` }}
    >
      <img
        src={`/payment-logos/${file}.${ext}`}
        alt={label}
        title={label}
        loading="lazy"
        className="block h-full w-auto"
      />
    </span>
  )
}

// Card brands accepted through Openpay. Shoppers recognise these instantly —
// far more than the processor's own mark — which is why they carry the trust
// signal for the card row.
const CARD_BRANDS = [
  { file: "visa", label: "Visa" },
  { file: "mastercard", label: "Mastercard" },
  { file: "amex", label: "American Express" },
  { file: "carnet", label: "Carnet" },
] as const

// `flex-wrap` is the last line of defence, not the main one: the checkout row
// already moves this whole group onto its own line below `xsmall`. It matters
// at ~320px, where even a full-width line can't hold all four marks — there the
// group breaks instead of pushing past the card border.
export const CardBrandLogos = ({ size = 24 }: { size?: number }) => (
  <span className="flex flex-wrap items-center gap-x-1 gap-y-1">
    {CARD_BRANDS.map((brand) => (
      <PaymentLogo
        key={brand.file}
        file={brand.file}
        label={brand.label}
        size={size}
      />
    ))}
  </span>
)

export const MercadoPagoLogo = ({ size = 24 }: { size?: number }) => (
  <PaymentLogo file="mercadopago" label="Mercado Pago" size={size} />
)

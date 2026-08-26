// Brand logos rendered inside the checkout payment-method rows.
//
// The SVGs live in /public/payment-logos and are the SAME assets the footer
// PaymentBadges uses — one source of truth for brand artwork. We only render
// marks for methods/processors we actually accept, so nothing here claims a
// relationship or certification we don't have.

type PaymentLogoProps = {
  /** Filename (without extension) under /public/payment-logos. */
  file: string
  label: string
  /** Rendered height in px. Checkout rows use 22–24. */
  size?: number
}

export const PaymentLogo = ({ file, label, size = 24 }: PaymentLogoProps) => (
  <img
    src={`/payment-logos/${file}.svg`}
    alt={label}
    title={label}
    loading="lazy"
    className="block w-auto rounded-[4px]"
    style={{ height: size }}
  />
)

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

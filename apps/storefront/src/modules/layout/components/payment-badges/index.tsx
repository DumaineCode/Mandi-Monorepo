// Payment method + processor badges. Legally safe: we only show the methods we
// actually accept (via Openpay / Mercado Pago) and the processors that provide
// the real PCI-DSS security — we never claim certifications that aren't ours.
//
// Official card SVGs (visa/mastercard/amex) come from the `payment-icons`
// package, copied into /public/payment-logos. The Mexican brands
// (mercadopago/openpay/oxxo/carnet) are placeholders until the official brand-kit
// SVGs are dropped in with the same filenames.

type Badge = { file: string; label: string };

const METHODS: Badge[] = [
  { file: "visa", label: "Visa" },
  { file: "mastercard", label: "Mastercard" },
  { file: "amex", label: "American Express" },
  { file: "carnet", label: "Carnet" },
  { file: "oxxo", label: "OXXO" },
];

const PROCESSORS: Badge[] = [
  { file: "mercadopago", label: "Mercado Pago" },
  { file: "openpay", label: "Openpay" },
];

function BadgeRow({ badges, size }: { badges: Badge[]; size: number }) {
  return (
    <ul className="flex flex-wrap items-center gap-2">
      {badges.map((b) => (
        <li key={b.file}>
          <img
            src={`/payment-logos/${b.file}.svg`}
            alt={b.label}
            title={b.label}
            loading="lazy"
            className="block w-auto rounded-[4px]"
            style={{ height: size }}
          />
        </li>
      ))}
    </ul>
  );
}

type PaymentBadgesProps = {
  /** Optional heading style label above each row. */
  labeled?: boolean;
  /** Badge height in px. Footer uses ~22, checkout can go larger. */
  size?: number;
  /** Label color — defaults to the dark-footer token. Pass a light-bg token in checkout. */
  labelClassName?: string;
  className?: string;
};

export default function PaymentBadges({
  labeled = true,
  size = 22,
  labelClassName = "text-cream-soft",
  className,
}: PaymentBadgesProps) {
  const labelBase = `mb-2 font-mono text-[11px] uppercase tracking-[0.1em] ${labelClassName}`;

  return (
    <div className={className}>
      <div className="flex flex-col gap-3">
        <div>
          {labeled && <div className={labelBase}>Aceptamos</div>}
          <BadgeRow badges={METHODS} size={size} />
        </div>

        <div>
          {labeled && <div className={labelBase}>Pagos procesados por</div>}
          <BadgeRow badges={PROCESSORS} size={size} />
        </div>
      </div>
    </div>
  );
}

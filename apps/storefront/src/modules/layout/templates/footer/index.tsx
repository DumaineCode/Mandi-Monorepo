import Image from "next/image";
import { FaEnvelope, FaInstagram, FaPhoneAlt, FaWhatsapp } from "react-icons/fa";

import { listRegions } from "@lib/data/regions";
import { listLocales } from "@lib/data/locales";
import { getLocale } from "@lib/data/locale-actions";

import LocalizedClientLink from "@modules/common/components/localized-client-link";
import RegionLanguageSelect from "@modules/layout/components/region-language-select";
import PaymentBadges from "@modules/layout/components/payment-badges";

/**
 * Contact details shown in the footer.
 *
 * `TEL_HREF` deliberately drops the `1` that `WHATSAPP_NUMBER` carries in
 * whatsapp-float-button / wholesale-band. That `1` is the mobile marker wa.me
 * requires for Mexican cell numbers — it is NOT part of the dialable number, so
 * putting it in a `tel:` link would dial something that does not exist.
 */
const PHONE_DISPLAY = "55 2913 0187";
const TEL_HREF = "tel:+525529130187";
const EMAIL = "mandioficial.comercial@gmail.com";

/**
 * Social profiles. Only real, reachable profiles belong here — an icon that
 * links nowhere costs more trust than a missing icon. TikTok and Facebook are
 * intentionally absent: those accounts do not exist yet.
 *
 * Icons come from `react-icons/fa`, the same package whatsapp-float-button
 * already uses, so we never hand-roll brand artwork.
 */
const SOCIALS = [
  {
    label: "Instagram",
    href: "https://www.instagram.com/mandioficial.mx",
    Icon: FaInstagram,
  },
  {
    label: "WhatsApp",
    href: "https://wa.me/5215529130187",
    Icon: FaWhatsapp,
  },
];

export default async function Footer() {
  const [regions, locales, currentLocale] = await Promise.all([
    listRegions(),
    listLocales(),
    getLocale(),
  ]);

  const currentYear = new Date().getFullYear();

  const contactLinkClass =
    "inline-flex items-center gap-2 font-hanken text-sm text-cream-muted transition-colors hover:text-white";

  return (
    <footer className="w-full bg-ink text-cream-muted">
      <div className="mx-auto max-w-[1180px] px-6 py-6">
        {/* Single content row: wordmark on the left, contact + social on the
            right. Everything that used to be a column of dead `href="#"` links
            is gone — the nav already covers the real routes. */}
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5">
          <LocalizedClientLink href="/" className="inline-flex items-center">
            <Image
              src="/Logo_Crema_trim.png"
              alt="MANDO Oficial"
              width={802}
              height={220}
              className="h-8 w-auto"
            />
          </LocalizedClientLink>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <a href={TEL_HREF} className={contactLinkClass}>
              <FaPhoneAlt className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {PHONE_DISPLAY}
            </a>

            <a href={`mailto:${EMAIL}`} className={contactLinkClass}>
              <FaEnvelope className="h-4 w-4 shrink-0" aria-hidden="true" />
              {EMAIL}
            </a>

            <ul className="flex items-center gap-2">
              {SOCIALS.map(({ label, href, Icon }) => (
                <li key={label}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    title={label}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-[#36322b] text-cream-muted transition-colors hover:border-cream-soft hover:text-white"
                  >
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Hairline bottom bar: legal line + region selector on the left,
            payment artwork on the right. Unlabeled and small on purpose — the
            labeled, explicit "Aceptamos / Pagos procesados por" breakdown still
            lives on checkout, where the payment decision is actually made. */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-t border-[#36322b] pt-4 font-mono text-[11px] text-cream-soft">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <span>© {currentYear} Mandi</span>
            {/* Preserved region/language selector — logic & data untouched.
                Only the trigger buttons are recolored for the dark footer; the
                dropdown panel keeps its own bg-white/text-black so the country
                list stays legible (it renders inline, not in a portal). */}
            <div className="[&_button]:!text-cream-soft">
              <RegionLanguageSelect
                regions={regions}
                locales={locales}
                currentLocale={currentLocale}
              />
            </div>
            <span>Hecho en México 🇲🇽</span>
          </div>

          <PaymentBadges labeled={false} size={16} />
        </div>
      </div>
    </footer>
  );
}

import { listCategories } from "@lib/data/categories";
import { listRegions } from "@lib/data/regions";
import { listLocales } from "@lib/data/locales";
import { getLocale } from "@lib/data/locale-actions";

import LocalizedClientLink from "@modules/common/components/localized-client-link";
import RegionLanguageSelect from "@modules/layout/components/region-language-select";

// Editorial "Tienda" column. We prefer the REAL category handles when they
// exist in the catalog, mapping by handle (with a title fallback). If a handle
// is not found we still link to it — these are the seeded top-level handles.
const STORE_LINKS: { label: string; handle: string; match: string[] }[] = [
  { label: "Polvos frappé", handle: "polvos-frappe", match: ["polvo"] },
  { label: "Jarabes", handle: "jarabes", match: ["jarabe"] },
  { label: "Botes & tapas", handle: "botes-y-tapas", match: ["bote", "tapa"] },
  {
    label: "Popotes",
    handle: "popotes-y-tapioca",
    match: ["popote", "tapioca"],
  },
];

const BUSINESS_LINKS = ["Mayoreo", "Facturación", "Envíos", "Contacto"];
const SOCIAL_LINKS = ["Instagram", "TikTok", "WhatsApp"];

export default async function Footer() {
  const productCategories = await listCategories().catch(() => []);
  const [regions, locales, currentLocale] = await Promise.all([
    listRegions(),
    listLocales(),
    getLocale(),
  ]);

  // Resolve each editorial store link to a real category handle when available.
  const storeLinks = STORE_LINKS.map((link) => {
    const found = productCategories?.find((c) => {
      const handle = (c.handle ?? "").toLowerCase();
      const name = (c.name ?? "").toLowerCase();
      return (
        handle === link.handle ||
        link.match.some((m) => handle.includes(m) || name.includes(m))
      );
    });
    return {
      label: link.label,
      handle: found?.handle ?? link.handle,
    };
  });

  const currentYear = new Date().getFullYear();

  return (
    <footer className="w-full bg-ink text-cream-muted">
      <div className="mx-auto max-w-[1180px] px-6 pt-12 pb-9">
        {/* Top row */}
        <div className="flex flex-wrap justify-between gap-10">
          {/* Left block — wordmark + description */}
          <div className="max-w-[280px]">
            <LocalizedClientLink
              href="/"
              className="font-bricolage text-2xl font-extrabold tracking-[-0.02em] text-white"
            >
              MANDO <span className="text-coral">OFICIAL</span>
            </LocalizedClientLink>
            <p className="mt-3 font-hanken text-sm leading-relaxed text-cream-muted">
              Insumos para cafeterías en todo México. Polvos, jarabes, botes y
              tapioca.
            </p>
          </div>

          {/* Right block — link columns */}
          <div className="flex flex-wrap gap-x-[52px] gap-y-8">
            {/* Tienda — real category routes */}
            <div>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.1em] text-cream-soft">
                Tienda
              </div>
              <ul className="flex flex-col gap-[9px] font-hanken text-sm">
                {storeLinks.map((link) => (
                  <li key={link.handle}>
                    <LocalizedClientLink
                      href={`/categories/${link.handle}`}
                      className="text-cream-muted transition-colors hover:text-white"
                    >
                      {link.label}
                    </LocalizedClientLink>
                  </li>
                ))}
              </ul>
            </div>

            {/* Negocio — placeholder links */}
            <div>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.1em] text-cream-soft">
                Negocio
              </div>
              <ul className="flex flex-col gap-[9px] font-hanken text-sm">
                {BUSINESS_LINKS.map((label) => (
                  <li key={label}>
                    <a
                      href="#"
                      className="text-cream-muted transition-colors hover:text-white"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Síguenos — placeholder links */}
            <div>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.1em] text-cream-soft">
                Síguenos
              </div>
              <ul className="flex flex-col gap-[9px] font-hanken text-sm">
                {SOCIAL_LINKS.map((label) => (
                  <li key={label}>
                    <a
                      href="#"
                      className="text-cream-muted transition-colors hover:text-white"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-9 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-t border-[#36322b] pt-5 font-mono text-[11px] text-cream-soft">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <span>© {currentYear} Mando Oficial</span>
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
          </div>
          <span>Hecho en México 🇲🇽</span>
        </div>
      </div>
    </footer>
  );
}

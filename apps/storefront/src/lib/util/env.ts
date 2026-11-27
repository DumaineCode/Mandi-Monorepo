/**
 * The public origin of this storefront.
 *
 * ## The fallback is the production domain, and it is guarded at build time
 *
 * `NEXT_PUBLIC_*` values are INLINED by Next at build time, not read from the
 * environment at runtime. So a production image built without
 * `NEXT_PUBLIC_BASE_URL` ships a bundle in which every Openpay `return_url` and
 * every Mercado Pago `back_urls_base` would point at the fallback.
 *
 * The variable is therefore listed in `check-env-variables.js`, which
 * `next.config.js` runs before the build and which hard-exits when it is
 * missing. The fallback is the production domain, so a build that bypassed
 * that check still sends customers back to the real storefront. Local
 * development must set `NEXT_PUBLIC_BASE_URL` explicitly.
 */
export const getBaseURL = () => {
  return process.env.NEXT_PUBLIC_BASE_URL || "https://www.mandioficial.com"
}

/**
 * The public origin of this storefront.
 *
 * ## The fallback is a DEV convenience, and it is guarded at build time
 *
 * `NEXT_PUBLIC_*` values are INLINED by Next at build time, not read from the
 * environment at runtime. So a production image built without
 * `NEXT_PUBLIC_BASE_URL` ships a bundle in which every Openpay `return_url` and
 * every Mercado Pago `back_urls_base` points at `https://localhost:8000` — the
 * customer completes 3DS, or pays at Mercado Pago, and lands nowhere, with the
 * charge already taken.
 *
 * The variable is therefore listed in `check-env-variables.js`, which
 * `next.config.js` runs before the build and which hard-exits when it is
 * missing. That is the assertion; this fallback only ever applies to a
 * developer who has bypassed it.
 */
export const getBaseURL = () => {
  return process.env.NEXT_PUBLIC_BASE_URL || "https://localhost:8000"
}

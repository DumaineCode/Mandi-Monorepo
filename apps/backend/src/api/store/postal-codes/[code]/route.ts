/**
 * GET /store/postal-codes/:code — Mexican postal-code (SEPOMEX) lookup.
 *
 * Public, publishable-key-protected (framework default for /store/* routes).
 * Powers the storefront checkout address autocomplete: given a 5-digit CP it
 * returns the state, city and the list of colonias (asentamientos) so the form
 * can autofill State/Province + City and offer a colonia dropdown.
 *
 * Data source: `@webrek/mx-cp`, a bundled offline SEPOMEX dataset (no external
 * API, no key). It is ESM-only, so it is loaded with a dynamic `import()` from
 * this CJS runtime (verified against the Medusa runtime). The module namespace
 * is memoized so the shard loader is initialized once per process.
 *
 * Contract: NEVER 5xx. An invalid CP, an unknown CP, or a lookup failure all
 * resolve to `found: false` with null fields, so the storefront degrades to
 * plain manual entry instead of blocking checkout.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

type PostalCodeResponse = {
  postal_code: string
  found: boolean
  state: string | null
  city: string | null
  municipality: string | null
  colonias: string[]
}

/** One day: the SEPOMEX dataset is static, so this is safe to cache hard. */
const CACHE_TTL_SECONDS = 86_400

const emptyResult = (code: string): PostalCodeResponse => ({
  postal_code: code,
  found: false,
  state: null,
  city: null,
  municipality: null,
  colonias: [],
})

/** Minimal shape of the single `@webrek/mx-cp` export this route uses. */
type MxCp = {
  buscaCP: (cp: string) => Promise<{
    estado: string
    municipio: string
    ciudad: string | null
    asentamientos: { nombre: string; tipo: string }[]
  } | null>
}

// Memoized ESM import — Node caches the namespace, this just avoids re-entering
// the dynamic import on every request. Typed with a local shape because a
// `typeof import(...)` of this ESM-only package from the CJS runtime would
// require a Node16 `resolution-mode` attribute (TS1542).
let mxCpModule: Promise<MxCp> | null = null
const loadMxCp = (): Promise<MxCp> =>
  (mxCpModule ??= import("@webrek/mx-cp") as unknown as Promise<MxCp>)

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const code = String(req.params.code ?? "").trim()

  // Mexican postal codes are exactly 5 digits — reject anything else cheaply,
  // without touching the dataset.
  if (!/^\d{5}$/.test(code)) {
    res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`)
    res.json(emptyResult(code))
    return
  }

  try {
    const { buscaCP } = await loadMxCp()
    const result = await buscaCP(code)

    if (!result) {
      res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`)
      res.json(emptyResult(code))
      return
    }

    // De-duplicate colonia names (some CPs repeat a name across settlement
    // types) while preserving SEPOMEX order, and drop any empties.
    const colonias = Array.from(
      new Set(
        result.asentamientos
          .map((a) => a.nombre?.trim())
          .filter((n): n is string => Boolean(n))
      )
    )

    res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`)
    res.json({
      postal_code: code,
      found: true,
      // `estado` is the full state name (e.g. "Nuevo León"), which is exactly
      // what the Skydropx quote expects for `area_level1` — so autofilling this
      // also fixes the missing-state cause of a "-" shipping price.
      state: result.estado,
      // Human-facing city; falls back to the municipality when absent.
      city: result.ciudad || result.municipio,
      municipality: result.municipio,
      colonias,
    })
  } catch (error) {
    // Never surface a 5xx to checkout. Log server-side and degrade to manual.
    // The error path is uncacheable so recovery is visible on the next request.
    // eslint-disable-next-line no-console
    console.error(
      `[store/postal-codes] Lookup failed for "${code}"; degrading to manual entry.`,
      error
    )
    res.setHeader("Cache-Control", "no-store")
    res.json(emptyResult(code))
  }
}

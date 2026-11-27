import { getBaseURL } from "./env"

/**
 * Redirects from the payment return Route Handlers must target the PUBLIC
 * origin, never `request.url`.
 *
 * Behind the production proxy the standalone server binds `HOSTNAME=0.0.0.0`
 * on port 8000 (see `Dockerfile`), so `request.url` — and the absolute URL Next
 * builds for a relative `redirect()` thrown inside a Route Handler — is
 * `http://0.0.0.0:8000/...`. A customer returning from 3DS or Mercado Pago was
 * sent there instead of to the storefront domain.
 */
export const toPublicURL = (path: string): URL => new URL(path, getBaseURL())

export type RedirectTarget = { destination: string; status: number }

/**
 * Reads the target of a `next/navigation` `redirect()` from the error it
 * throws, so the Route Handler can re-issue it against the public origin.
 *
 * Digest shape (Next 15): `NEXT_REDIRECT;<type>;<destination>;<status>;`.
 * The destination may itself contain `;`, hence the slice rather than a fixed
 * index — the same parsing Next uses in `redirect-error.js`.
 */
export const redirectTargetFrom = (err: unknown): RedirectTarget | null => {
  const digest = (err as { digest?: unknown } | null | undefined)?.digest

  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT;")) {
    return null
  }

  const parts = digest.split(";")
  const destination = parts.slice(2, -2).join(";")
  const status = Number(parts.at(-2))

  if (!destination || !Number.isInteger(status)) {
    return null
  }

  return { destination, status }
}

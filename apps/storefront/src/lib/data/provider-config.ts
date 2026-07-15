"use server"

import { sdk } from "@lib/config"

/**
 * Runtime provider public config (spec "Storefront Runtime Config
 * Consumption", design §7). Server-side fetch with Next revalidation so
 * admin-side key rotation needs no storefront rebuild.
 *
 * Graceful degradation: when the endpoint is unavailable the storefront must
 * behave exactly as it does today for missing config — so this returns
 * `null`-filled config (never throws), and the Openpay wrapper disables card
 * payments with a warning while the rest of checkout keeps working.
 */

export type OpenpayPublicConfig = {
  merchantId: string
  publicKey: string
  sandbox: boolean
}

export type MercadopagoPublicConfig = {
  publicKey: string
  sandbox: boolean
}

export type ProviderPublicConfig = {
  openpay: OpenpayPublicConfig | null
  mercadopago: MercadopagoPublicConfig | null
}

const EMPTY_CONFIG: ProviderPublicConfig = {
  openpay: null,
  mercadopago: null,
}

/**
 * FIX 4a (resilience): explicit fetch timeout so a slow/hung endpoint degrades
 * fast to EMPTY_CONFIG instead of stalling the checkout render. On abort the
 * fetch rejects and the catch below returns the exact same degraded path
 * (warn + disable Openpay card, rest of checkout intact).
 */
const PROVIDER_CONFIG_TIMEOUT_MS = 3_000

/**
 * Follow-up (resilience, degraded-response caching): a transient backend/DB blip
 * must NOT pin the degraded (Openpay-disabled) config in the Next Data Cache for
 * up to 60s after recovery. The caching contract spans BOTH layers:
 *
 *  - Healthy 200 (configured OR healthy-but-unconfigured): the backend sends
 *    `Cache-Control: public, max-age=60`, so `revalidate: 60` here caches it for
 *    the intended 60s fast path.
 *  - Degraded 200 (backend read-failure fail-safe, all-null projection): the
 *    backend sends `Cache-Control: no-store`. Next 15 honors the origin's
 *    restrictive directive over the requested `revalidate`, so this body is NOT
 *    persisted in the Data Cache — the very next checkout render re-attempts and
 *    picks up recovery immediately (no 60s payments-method outage).
 *  - Fetch error / timeout (abort): the fetch rejects, so nothing is written to
 *    the Data Cache at all; the catch below returns EMPTY_CONFIG for this render
 *    only, and the next render re-fetches.
 *
 * The `tags` entry keeps on-demand revalidation available for admin-side key
 * rotation. Degradation UX is unchanged (warn + Openpay card disabled, rest of
 * checkout intact).
 */
export const getProviderConfig =
  async (): Promise<ProviderPublicConfig> => {
    try {
      const config = await sdk.client.fetch<ProviderPublicConfig>(
        "/store/provider-config",
        {
          method: "GET",
          next: { revalidate: 60, tags: ["provider-config"] },
          signal: AbortSignal.timeout(PROVIDER_CONFIG_TIMEOUT_MS),
        }
      )

      return {
        openpay: config?.openpay ?? null,
        mercadopago: config?.mercadopago ?? null,
      }
    } catch (error) {
      console.error(
        "Failed to load /store/provider-config — provider public config unavailable. Openpay card payments will be disabled for this render.",
        error
      )
      return EMPTY_CONFIG
    }
  }

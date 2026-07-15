/**
 * GET /store/provider-config (spec "Public Store Config Endpoint", design §7).
 *
 * Public, publishable-key-protected (framework default for /store/* routes).
 * Serves ONLY the non-secret public projection assembled by
 * `buildPublicProviderConfig` — it reads each provider's `public_config` and
 * never touches `encrypted_secrets`/decrypt. Unconfigured or disabled providers
 * resolve to `null` (never a 5xx). Response is cacheable for 60s (design §7).
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { PROVIDER_SETTINGS_MODULE } from "../../../modules/provider-settings"
import type ProviderSettingsModuleService from "../../../modules/provider-settings/service"
import {
  buildPublicProviderConfig,
  type PublicConfigRow,
} from "./public-config"

/** Providers with a public projection (Skydropx is intentionally omitted). */
const PUBLIC_PROVIDERS = ["openpay", "mercadopago"] as const

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const service = req.scope.resolve<ProviderSettingsModuleService>(
    PROVIDER_SETTINGS_MODULE
  )

  // FIX 4b (never-5xx contract): a read failure MUST degrade to the empty,
  // all-null projection instead of surfacing a 500. An empty row set yields
  // exactly that from `buildPublicProviderConfig`, so the storefront degrades
  // like an unconfigured provider (warn + disable card) rather than erroring.
  let rows: PublicConfigRow[] = []
  let degraded = false
  try {
    rows = (await service.listProviderSettings({
      provider: [...PUBLIC_PROVIDERS],
    })) as unknown as PublicConfigRow[]
  } catch (error) {
    degraded = true
    // Log server-side only; the public response never leaks internal detail.
    // eslint-disable-next-line no-console
    console.error(
      "[store/provider-config] Failed to read provider settings; serving " +
        "empty public config (fail-safe).",
      error
    )
  }

  // Follow-up (resilience, degraded-response caching): the success projection —
  // including the healthy-but-unconfigured case (rows simply absent, no error) —
  // is cacheable for 60s (design §7). BUT the catch/degraded path must NOT be
  // cached under that TTL: the storefront revalidates at 60s and a CDN may also
  // hold it, so caching a transient DB blip would keep Openpay card payments
  // disabled for up to 60s after recovery. `no-store` makes recovery visible on
  // the very next render. ONLY the error path is uncacheable — normal
  // "unconfigured" stays a fast, cacheable success.
  res.setHeader(
    "Cache-Control",
    degraded ? "no-store" : "public, max-age=60"
  )
  res.json(buildPublicProviderConfig(rows))
}

/**
 * Provider settings shapes (design §1.1 / §9).
 *
 * Secret vs non-secret split per provider (design §1.1 table):
 *
 * | Provider    | Secrets (encrypted)                        | public_config                          |
 * |-------------|--------------------------------------------|----------------------------------------|
 * | openpay     | privateKey, webhookUser, webhookPassword   | merchantId, publicKey, sandbox         |
 * | mercadopago | accessToken, webhookSecret                 | publicKey, sandbox                     |
 * | skydropx    | clientId, clientSecret                     | baseUrl (optional), originZip, taxInclusive, consignmentNote, packageType |
 *
 * `ResolvedProviderConfig` variants mirror the exact options shape each
 * provider consumes today (explore §1 options mapping) so provider internals
 * change minimally in slice 3.
 */

export type ProviderId = "openpay" | "mercadopago" | "skydropx"

export type ProviderMode = "sandbox" | "production"

/** Providers whose public_config carries a mode-derived `sandbox` flag. */
export const SANDBOX_FLAG_PROVIDERS: readonly string[] = [
  "openpay",
  "mercadopago",
]

/**
 * Default Skydropx base URL — flipped to the Skydropx PRO host (design D1).
 * `/api/v1` is baked into the base so client path-joining stays identical to the
 * legacy shape (`${baseUrl}/quotations`, `${baseUrl}/oauth/token`, …). The host
 * is under `*.skydropx.com`, so the SSRF allowlist is unchanged.
 */
export const SKYDROPX_DEFAULT_BASE_URL = "https://api-pro.skydropx.com/api/v1"

/**
 * Non-secret masking hints computed AT WRITE TIME (design §1.1) so masked
 * reads never decrypt. `last4` is only present when the plaintext was ≥ 8
 * characters (spec: Masked Secret Reads); shorter secrets are fully masked.
 */
export interface SecretHint {
  last4: string | null
  set: true
}

export type SecretHints = Record<string, SecretHint>

/** Options shape the Openpay payment provider consumes today. */
export interface OpenpayResolvedConfig {
  merchantId: string
  publicKey?: string
  sandbox: boolean
  privateKey: string
  webhookUser: string
  webhookPassword: string
}

/**
 * Options shape the Skydropx fulfillment provider consumes (PRO / OAuth2).
 * Mirrors `SkydropxCredentials` in the skydropx-fulfillment module: two
 * encrypted secrets (`clientId`/`clientSecret`) plus public config. No `apiKey`.
 */
export interface SkydropxResolvedConfig {
  clientId: string
  clientSecret: string
  baseUrl: string
  originZip: string
  taxInclusive?: boolean
  /** MX Carta Porte SAT consignment note default (design D2). */
  consignmentNote?: string
  /** MX package_type default (design D2). */
  packageType?: string
}

/**
 * Options shape the future MP payment provider module will consume (S4,
 * design §9). `backendUrl` is mapped from env `BACKEND_PUBLIC_URL` at
 * resolution time — NOT stored in the DB.
 */
export interface MercadopagoResolvedConfig {
  accessToken: string
  webhookSecret: string
  backendUrl?: string
  publicKey?: string
  sandbox: boolean
}

export type ResolvedProviderConfig =
  | OpenpayResolvedConfig
  | SkydropxResolvedConfig
  | MercadopagoResolvedConfig

/** Module options (design §1.3). Tests pass `ttlMs: 0` to disable caching. */
export interface ProviderSettingsModuleOptions {
  /** Credential cache TTL backstop in ms. Default 30s (design §3.3). */
  ttlMs?: number
  /** KEK override for tests; defaults to PROVIDER_SETTINGS_ENCRYPTION_KEY. */
  encryptionKey?: string
}

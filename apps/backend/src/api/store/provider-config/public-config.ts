/**
 * Public store config assembly (spec "Public Store Config Endpoint", design §7).
 *
 * CRITICAL public-data safety: this projection is a strict WHITELIST built from
 * each provider's `public_config` ONLY. It never reads, decrypts, or forwards
 * `encrypted_secrets`; the sole use of `encrypted_secrets` here is a boolean
 * "is this provider configured" check. No secret value can structurally appear
 * in the output — a dedicated unit test pins this. Skydropx is omitted entirely
 * (nothing public to serve). Unconfigured or disabled providers resolve to
 * `null` rather than erroring.
 */

/** Minimal, secret-free view of a provider_setting row (never the ciphertext). */
export interface PublicConfigRow {
  provider: string
  mode: string
  is_enabled: boolean
  public_config: Record<string, unknown> | null
  encrypted_secrets: string | null
}

export interface OpenpayPublicConfig {
  merchantId: string
  publicKey: string
  sandbox: boolean
}

export interface MercadopagoPublicConfig {
  publicKey: string
  sandbox: boolean
}

export interface PublicProviderConfig {
  openpay: OpenpayPublicConfig | null
  mercadopago: MercadopagoPublicConfig | null
}

/** A provider is servable only when it has an enabled, configured row. */
function isServable(row: PublicConfigRow | undefined): row is PublicConfigRow {
  return Boolean(row && row.is_enabled && row.encrypted_secrets)
}

function readString(
  publicConfig: Record<string, unknown> | null,
  field: string
): string | null {
  const value = publicConfig?.[field]
  return typeof value === "string" && value.length > 0 ? value : null
}

/** Explicit public_config.sandbox flag wins; otherwise derive from mode. */
function deriveSandbox(row: PublicConfigRow): boolean {
  const flag = row.public_config?.sandbox
  if (typeof flag === "boolean") {
    return flag
  }
  return row.mode !== "production"
}

export function buildPublicProviderConfig(
  rows: PublicConfigRow[]
): PublicProviderConfig {
  const byProvider = new Map(rows.map((row) => [row.provider, row]))

  return {
    openpay: buildOpenpay(byProvider.get("openpay")),
    mercadopago: buildMercadopago(byProvider.get("mercadopago")),
  }
}

function buildOpenpay(
  row: PublicConfigRow | undefined
): OpenpayPublicConfig | null {
  if (!isServable(row)) {
    return null
  }

  const merchantId = readString(row.public_config, "merchantId")
  const publicKey = readString(row.public_config, "publicKey")
  if (!merchantId || !publicKey) {
    return null
  }

  return { merchantId, publicKey, sandbox: deriveSandbox(row) }
}

function buildMercadopago(
  row: PublicConfigRow | undefined
): MercadopagoPublicConfig | null {
  if (!isServable(row)) {
    return null
  }

  const publicKey = readString(row.public_config, "publicKey")
  if (!publicKey) {
    return null
  }

  return { publicKey, sandbox: deriveSandbox(row) }
}

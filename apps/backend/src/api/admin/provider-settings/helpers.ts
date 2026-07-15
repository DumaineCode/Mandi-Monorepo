/**
 * Masked admin read shape (spec "Masked Secret Reads", design §5).
 *
 * Presentation-only: masking is computed from write-time `secret_hints` — the
 * admin read path NEVER decrypts and no plaintext secret can structurally
 * appear here (success criterion #2). Format: `••••` + last-4 when the
 * plaintext was >= 8 chars, fully masked fixed-width otherwise.
 */
import type { SecretHints } from "../../../modules/provider-settings/types"

export const KNOWN_PROVIDERS = ["openpay", "mercadopago", "skydropx"] as const

const FIXED_MASK = "••••"
const FULL_MASK = "••••••••"

export interface MaskableProviderSettingRow {
  mode: string
  is_enabled: boolean
  public_config: Record<string, unknown> | null
  encrypted_secrets: string | null
  secret_hints: SecretHints | null
  last_verified_at: Date | null
  updated_at?: Date | null
}

export interface MaskedProviderSetting {
  provider: string
  configured: boolean
  mode: string | null
  is_enabled: boolean
  public_config: Record<string, unknown> | null
  secrets: Record<string, string>
  last_verified_at: Date | null
  updated_at: Date | null
}

export function toMaskedProviderSetting(
  provider: string,
  row: MaskableProviderSettingRow | null
): MaskedProviderSetting {
  if (!row) {
    return {
      provider,
      configured: false,
      mode: null,
      is_enabled: false,
      public_config: null,
      secrets: {},
      last_verified_at: null,
      updated_at: null,
    }
  }

  const secrets: Record<string, string> = {}
  if (row.encrypted_secrets && row.secret_hints) {
    for (const [field, hint] of Object.entries(row.secret_hints)) {
      secrets[field] = hint.last4 ? `${FIXED_MASK}${hint.last4}` : FULL_MASK
    }
  }

  return {
    provider,
    configured: Boolean(row.encrypted_secrets),
    mode: row.mode,
    is_enabled: row.is_enabled,
    public_config: row.public_config ?? null,
    secrets,
    last_verified_at: row.last_verified_at ?? null,
    updated_at: row.updated_at ?? null,
  }
}

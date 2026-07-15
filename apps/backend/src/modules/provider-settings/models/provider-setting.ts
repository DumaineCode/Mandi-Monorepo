import { model } from "@medusajs/framework/utils"

/**
 * One row per provider — the single active credential set (design §1.1).
 *
 * - `provider`: "openpay" | "mercadopago" | "skydropx" (constants.ts
 *   identifiers), unique → upserts replace, never accumulate.
 * - `mode`: "sandbox" | "production" — exactly one active mode per provider.
 * - `is_enabled`: operator kill-switch without deleting credentials.
 * - `public_config`: NON-secret fields, servable to the storefront where
 *   applicable (slice 5 store endpoint reads ONLY this column).
 * - `encrypted_secrets`: AES-256-GCM envelope (`pset.v1.<iv>.<tag>.<ct>`) of
 *   a JSON object of ALL secret fields (crypto.ts).
 * - `secret_hints`: non-secret masking hints (`{ field: { last4, set } }`)
 *   computed at write time so masked reads never decrypt.
 * - `last_verified_at`: last successful test-connection.
 *
 * created_at/updated_at/deleted_at are automatic — not declared.
 */
const ProviderSetting = model.define("provider_setting", {
  id: model.id().primaryKey(),
  provider: model.text().unique(),
  mode: model.text().default("sandbox"),
  is_enabled: model.boolean().default(true),
  public_config: model.json().nullable(),
  encrypted_secrets: model.text().nullable(),
  secret_hints: model.json().nullable(),
  last_verified_at: model.dateTime().nullable(),
})

export default ProviderSetting

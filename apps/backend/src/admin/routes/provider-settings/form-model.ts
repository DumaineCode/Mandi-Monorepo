/**
 * Pure form model for the admin Provider Settings page (slice 4).
 *
 * All non-trivial UI logic lives here — per-provider field split, Mode-Toggle
 * re-entry rules (spec "Mode Toggle — Single Active Set with Re-Entry"), upsert
 * body construction (omit untouched secrets on same-mode saves; require full
 * re-entry on a mode switch), and test-connection candidate building. Kept free
 * of React / SDK / `import.meta` imports so it is unit-testable under jest
 * (strict TDD). The `.tsx` components are thin consumers of these functions.
 *
 * The field split mirrors the backend `validate-provider-payload` step exactly
 * (PROVIDER_SECRET_FIELDS / PROVIDER_PUBLIC_FIELDS) — the API is the source of
 * truth for validation; this model drives presentation and request shaping.
 */

export type ProviderMode = "sandbox" | "production"
export type FieldType = "text" | "password" | "boolean"

export interface FieldDef {
  name: string
  label: string
  type: FieldType
  secret: boolean
  optional?: boolean
  placeholder?: string
}

export interface ProviderFormDef {
  provider: "openpay" | "skydropx" | "mercadopago"
  label: string
  /** Best-effort probe description surfaced next to the test-connection result. */
  probeLabel: string
  fields: FieldDef[]
}

/** Masked read shape returned by GET /admin/provider-settings (backend helpers.ts). */
export interface MaskedProviderSetting {
  provider: string
  configured: boolean
  mode: string | null
  is_enabled: boolean
  public_config: Record<string, unknown> | null
  /** Masked secret display values keyed by field (e.g. `••••abcd`). Never plaintext. */
  secrets: Record<string, string>
  last_verified_at: string | null
  updated_at: string | null
}

export interface ProviderFormState {
  mode: ProviderMode
  isEnabled: boolean
  /** Current text/password input values. Empty string = not entered. */
  values: Record<string, string>
  /** Current boolean-field values (e.g. skydropx taxInclusive). */
  booleans: Record<string, boolean>
}

export const PROVIDER_ORDER = ["openpay", "skydropx", "mercadopago"] as const

export const PROVIDER_FORMS: Record<string, ProviderFormDef> = {
  openpay: {
    provider: "openpay",
    label: "Openpay",
    probeLabel:
      "Best-effort: authenticated read against the Openpay charges endpoint.",
    fields: [
      { name: "merchantId", label: "Merchant ID", type: "text", secret: false },
      { name: "publicKey", label: "Public key", type: "text", secret: false },
      { name: "privateKey", label: "Private key", type: "password", secret: true },
      { name: "webhookUser", label: "Webhook user", type: "password", secret: true },
      {
        name: "webhookPassword",
        label: "Webhook password",
        type: "password",
        secret: true,
      },
    ],
  },
  skydropx: {
    provider: "skydropx",
    label: "Skydropx",
    probeLabel:
      "Best-effort: a live quotation depends on carrier availability, not only the key.",
    fields: [
      { name: "originZip", label: "Origin ZIP", type: "text", secret: false },
      {
        name: "baseUrl",
        label: "Base URL (optional)",
        type: "text",
        secret: false,
        optional: true,
        placeholder: "Defaults to the Skydropx PRO API base URL",
      },
      {
        name: "taxInclusive",
        label: "Prices are tax-inclusive",
        type: "boolean",
        secret: false,
      },
      {
        name: "consignmentNote",
        label: "Carta Porte SAT code (consignment note)",
        type: "text",
        secret: false,
        optional: true,
        placeholder: "MX Carta Porte SAT product/service code",
      },
      {
        name: "packageType",
        label: "Package type",
        type: "text",
        secret: false,
        optional: true,
        placeholder: "Skydropx package_type for MX labels",
      },
      { name: "clientId", label: "Client ID", type: "password", secret: true },
      {
        name: "clientSecret",
        label: "Client secret",
        type: "password",
        secret: true,
      },
    ],
  },
  mercadopago: {
    provider: "mercadopago",
    label: "Mercado Pago",
    probeLabel:
      "Best-effort: validates token usability against the Mercado Pago users endpoint.",
    fields: [
      { name: "publicKey", label: "Public key", type: "text", secret: false },
      {
        name: "accessToken",
        label: "Access token",
        type: "password",
        secret: true,
      },
      {
        name: "webhookSecret",
        label: "Webhook secret",
        type: "password",
        secret: true,
      },
    ],
  },
}

const isProviderMode = (value: unknown): value is ProviderMode =>
  value === "sandbox" || value === "production"

const asString = (value: unknown): string =>
  typeof value === "string" ? value : ""

/** Build the initial form state from a masked read (or a fresh, unconfigured form). */
export function initialFormState(
  def: ProviderFormDef,
  masked: MaskedProviderSetting | null
): ProviderFormState {
  const configured = masked?.configured ?? false
  const publicConfig = masked?.public_config ?? {}

  const values: Record<string, string> = {}
  const booleans: Record<string, boolean> = {}

  for (const field of def.fields) {
    if (field.type === "boolean") {
      booleans[field.name] = Boolean(publicConfig[field.name])
      continue
    }
    // Secrets are NEVER hydrated into editable inputs — only saved masks are
    // shown separately (deriveSecretState). Public fields hydrate from config.
    values[field.name] = field.secret ? "" : asString(publicConfig[field.name])
  }

  return {
    mode: configured && isProviderMode(masked?.mode) ? masked!.mode as ProviderMode : "sandbox",
    isEnabled: configured ? Boolean(masked?.is_enabled) : true,
    values,
    booleans,
  }
}

export interface SecretFieldState {
  name: string
  required: boolean
  /** Masked display of the stored secret when it may be kept; null when it must be re-entered. */
  savedMask: string | null
}

export interface SecretState {
  modeChanged: boolean
  showReplaceWarning: boolean
  fields: SecretFieldState[]
}

/**
 * Mode-Toggle re-entry rules (spec):
 * - same mode + configured → secrets optional, saved masks shown (keep-existing);
 * - mode switched away from the saved mode → all secrets required, masks cleared, warn;
 * - unconfigured → all secrets required, no warning.
 */
export function deriveSecretState(
  def: ProviderFormDef,
  masked: MaskedProviderSetting | null,
  formMode: ProviderMode
): SecretState {
  const configured = masked?.configured ?? false
  const savedMode = masked?.mode ?? null
  const modeChanged = configured && savedMode !== null && formMode !== savedMode

  const fields: SecretFieldState[] = def.fields
    .filter((f) => f.secret)
    .map((f) => {
      const savedMask = masked?.secrets?.[f.name] ?? null
      const keepable = configured && !modeChanged && Boolean(savedMask)
      return {
        name: f.name,
        required: !keepable,
        savedMask: keepable ? savedMask : null,
      }
    })

  return { modeChanged, showReplaceWarning: modeChanged, fields }
}

export interface UpsertBuild {
  body: Record<string, unknown>
  /** Required secret fields left empty — surfaced inline before/after the API round-trip. */
  missingSecrets: string[]
}

/** Build the POST body, omitting untouched secrets so same-mode saves keep them. */
export function buildUpsertBody(
  def: ProviderFormDef,
  masked: MaskedProviderSetting | null,
  form: ProviderFormState
): UpsertBuild {
  const body: Record<string, unknown> = {
    mode: form.mode,
    is_enabled: form.isEnabled,
  }

  for (const field of def.fields) {
    if (field.type === "boolean") {
      body[field.name] = Boolean(form.booleans[field.name])
      continue
    }
    const value = asString(form.values[field.name]).trim()
    if (value.length > 0) {
      body[field.name] = value
    }
  }

  const secretState = deriveSecretState(def, masked, form.mode)
  const missingSecrets = secretState.fields
    .filter((f) => f.required && asString(form.values[f.name]).trim().length === 0)
    .map((f) => f.name)

  return { body, missingSecrets }
}

/**
 * Build the test-connection candidate: mode plus any values the admin entered.
 * An otherwise-empty form yields just `{ mode }`, so the backend tests the
 * stored credentials (spec "Test Connection").
 */
export function buildTestCandidate(
  def: ProviderFormDef,
  form: ProviderFormState
): Record<string, unknown> {
  const candidate: Record<string, unknown> = { mode: form.mode }

  for (const field of def.fields) {
    if (field.type === "boolean") {
      if (form.booleans[field.name]) {
        candidate[field.name] = true
      }
      continue
    }
    const value = asString(form.values[field.name]).trim()
    if (value.length > 0) {
      candidate[field.name] = value
    }
  }

  return candidate
}

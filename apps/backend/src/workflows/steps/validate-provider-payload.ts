/**
 * validate-provider-payload step (design §5) — business validation lives here,
 * not in the API route (`logic-workflow-validation`).
 *
 * Pure core: `validateProviderPayload` — per-provider Zod shape, secret
 * re-entry rules (spec "Mode Toggle": switching mode away from the saved mode
 * requires re-entered secrets; same-mode saves may omit secrets to keep the
 * stored ones). Runs first in the upsert workflow, so a rejection persists
 * nothing.
 */
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { PROVIDER_SETTINGS_MODULE } from "../../modules/provider-settings"
import type ProviderSettingsModuleService from "../../modules/provider-settings/service"
import type {
  ProviderMode,
  SecretHints,
} from "../../modules/provider-settings/types"

const modeSchema = z.enum(["sandbox", "production"])

const baseSchema = z.object({
  mode: modeSchema,
  is_enabled: z.boolean().optional(),
})

/**
 * Per-provider upsert schemas (spec "Persisted Provider Credential Sets").
 * Secret fields are optional at the schema level because omission is a valid
 * keep-existing signal — required-ness is enforced by
 * `validateProviderPayload` against the stored row.
 */
export const openpayUpsertSchema = baseSchema.extend({
  merchantId: z.string().min(1),
  publicKey: z.string().min(1),
  privateKey: z.string().min(1).optional(),
  webhookUser: z.string().min(1).optional(),
  webhookPassword: z.string().min(1).optional(),
})

export const skydropxUpsertSchema = baseSchema.extend({
  originZip: z.string().min(1),
  baseUrl: z.string().url().optional(),
  taxInclusive: z.boolean().optional(),
  apiKey: z.string().min(1).optional(),
})

export const mercadopagoUpsertSchema = baseSchema.extend({
  publicKey: z.string().min(1),
  accessToken: z.string().min(1).optional(),
  webhookSecret: z.string().min(1).optional(),
})

export const PROVIDER_UPSERT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  openpay: openpayUpsertSchema,
  skydropx: skydropxUpsertSchema,
  mercadopago: mercadopagoUpsertSchema,
}

/** Secret fields per provider — stored ONLY inside `encrypted_secrets`. */
export const PROVIDER_SECRET_FIELDS: Record<string, readonly string[]> = {
  openpay: ["privateKey", "webhookUser", "webhookPassword"],
  skydropx: ["apiKey"],
  mercadopago: ["accessToken", "webhookSecret"],
}

/** Non-secret fields per provider — stored in `public_config`. */
export const PROVIDER_PUBLIC_FIELDS: Record<string, readonly string[]> = {
  openpay: ["merchantId", "publicKey"],
  skydropx: ["baseUrl", "originZip", "taxInclusive"],
  mercadopago: ["publicKey"],
}

export interface ExistingSettingSnapshot {
  mode: string
  secret_hints: SecretHints | null
}

export interface ValidatedProviderPayload {
  provider: string
  mode: ProviderMode
  isEnabled: boolean
  publicConfig: Record<string, unknown>
  /** Newly provided plaintext secrets (encrypted downstream, never persisted). */
  secrets: Record<string, string>
  /** Required secrets omitted from the body but kept from the stored envelope. */
  retainedSecretFields: string[]
}

const invalid = (message: string): MedusaError =>
  new MedusaError(MedusaError.Types.INVALID_DATA, message)

export function validateProviderPayload(
  provider: string,
  body: Record<string, unknown>,
  existing: ExistingSettingSnapshot | null
): ValidatedProviderPayload {
  const schema = PROVIDER_UPSERT_SCHEMAS[provider]
  if (!schema) {
    throw invalid(
      `Unknown provider "${provider}". Expected one of: ${Object.keys(
        PROVIDER_UPSERT_SCHEMAS
      ).join(", ")}.`
    )
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ")
    throw invalid(`Invalid ${provider} settings payload — ${details}`)
  }

  const data = parsed.data as Record<string, unknown>
  const mode = data.mode as ProviderMode

  const secrets: Record<string, string> = {}
  const retainedSecretFields: string[] = []
  const missing: string[] = []

  const sameModeExisting = existing !== null && existing.mode === mode

  for (const field of PROVIDER_SECRET_FIELDS[provider]) {
    const value = data[field]
    if (typeof value === "string" && value.length > 0) {
      secrets[field] = value
    } else if (sameModeExisting && existing?.secret_hints?.[field]?.set) {
      retainedSecretFields.push(field)
    } else {
      missing.push(field)
    }
  }

  if (missing.length > 0) {
    const fieldList = missing.join(", ")
    throw invalid(
      existing && existing.mode !== mode
        ? `Switching ${provider} from ${existing.mode} to ${mode} requires ` +
          `re-entering all secret values. Missing: ${fieldList}.`
        : `Missing required secret field(s) for ${provider}: ${fieldList}.`
    )
  }

  const publicConfig: Record<string, unknown> = {}
  for (const field of PROVIDER_PUBLIC_FIELDS[provider]) {
    if (data[field] !== undefined) {
      publicConfig[field] = data[field]
    }
  }

  return {
    provider,
    mode,
    isEnabled: (data.is_enabled as boolean | undefined) ?? true,
    publicConfig,
    secrets,
    retainedSecretFields,
  }
}

export interface ValidateProviderPayloadStepInput {
  provider: string
  body: Record<string, unknown>
}

export const validateProviderPayloadStep = createStep(
  "validate-provider-payload",
  async (input: ValidateProviderPayloadStepInput, { container }) => {
    const service = container.resolve<ProviderSettingsModuleService>(
      PROVIDER_SETTINGS_MODULE
    )

    const [row] = await service.listProviderSettings(
      { provider: input.provider },
      { take: 1 }
    )

    const existing = row
      ? {
          mode: row.mode as string,
          secret_hints: (row.secret_hints as SecretHints | null) ?? null,
        }
      : null

    return new StepResponse(
      validateProviderPayload(input.provider, input.body, existing)
    )
  }
)

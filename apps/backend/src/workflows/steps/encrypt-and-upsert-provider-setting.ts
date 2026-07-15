/**
 * encrypt-and-upsert-provider-setting step (design §5).
 *
 * Pure core: `buildProviderSettingRow` — merges retained secrets (omitted
 * secret = keep existing, decrypted from the stored envelope), then delegates
 * to the slice-1 `prepareProviderSettingRow` (encrypt + write-time
 * secret_hints + mode-derived sandbox flag). One row per provider, single
 * mutation per step; compensation restores the previous row snapshot.
 */
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"

import { PROVIDER_SETTINGS_MODULE } from "../../modules/provider-settings"
import {
  createProviderSettingsCrypto,
  type ProviderSettingsCrypto,
} from "../../modules/provider-settings/crypto"
import type ProviderSettingsModuleService from "../../modules/provider-settings/service"
import {
  prepareProviderSettingRow,
  type PreparedProviderSettingRow,
} from "../../modules/provider-settings/service"
import type { ValidatedProviderPayload } from "./validate-provider-payload"

export function buildProviderSettingRow(
  crypto: ProviderSettingsCrypto,
  validated: ValidatedProviderPayload,
  existingSecrets: Record<string, string> | null
): PreparedProviderSettingRow {
  const secrets: Record<string, string> = {}

  for (const field of validated.retainedSecretFields) {
    const value = existingSecrets?.[field]
    if (typeof value !== "string" || value.length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Cannot keep the stored ${validated.provider} secret "${field}" — ` +
          `the stored value is unavailable. Re-enter it and save again.`
      )
    }
    secrets[field] = value
  }

  Object.assign(secrets, validated.secrets)

  return prepareProviderSettingRow(crypto, {
    provider: validated.provider,
    mode: validated.mode,
    isEnabled: validated.isEnabled,
    publicConfig: validated.publicConfig,
    secrets,
  })
}

interface PreviousRowSnapshot {
  id: string
  mode: string
  is_enabled: boolean
  public_config: Record<string, unknown> | null
  encrypted_secrets: string | null
  secret_hints: Record<string, unknown> | null
}

type CompensationInput =
  | { createdId: string; previous: null }
  | { createdId: null; previous: PreviousRowSnapshot }

export const encryptAndUpsertProviderSettingStep = createStep(
  "encrypt-and-upsert-provider-setting",
  async (validated: ValidatedProviderPayload, { container }) => {
    const service = container.resolve<ProviderSettingsModuleService>(
      PROVIDER_SETTINGS_MODULE
    )

    // Same KEK contract as the module service (design §2); saves fail loudly
    // when the KEK is invalid — never silently store plaintext.
    const crypto = createProviderSettingsCrypto(
      process.env.PROVIDER_SETTINGS_ENCRYPTION_KEY
    )

    const [existing] = await service.listProviderSettings(
      { provider: validated.provider },
      { take: 1 }
    )

    const existingSecrets =
      validated.retainedSecretFields.length > 0 && existing?.encrypted_secrets
        ? crypto.decryptSecrets(validated.provider, existing.encrypted_secrets)
        : null

    const rowData = buildProviderSettingRow(crypto, validated, existingSecrets)

    if (existing) {
      const previous: PreviousRowSnapshot = {
        id: existing.id,
        mode: existing.mode,
        is_enabled: existing.is_enabled,
        public_config:
          (existing.public_config as Record<string, unknown> | null) ?? null,
        encrypted_secrets: existing.encrypted_secrets ?? null,
        secret_hints:
          (existing.secret_hints as Record<string, unknown> | null) ?? null,
      }

      const updated = await service.updateProviderSettings({
        id: existing.id,
        ...rowData,
      })

      return new StepResponse(updated, {
        createdId: null,
        previous,
      } satisfies CompensationInput)
    }

    const created = await service.createProviderSettings(rowData)

    return new StepResponse(created, {
      createdId: created.id,
      previous: null,
    } satisfies CompensationInput)
  },
  async (compensation: CompensationInput | undefined, { container }) => {
    if (!compensation) {
      return
    }

    const service = container.resolve<ProviderSettingsModuleService>(
      PROVIDER_SETTINGS_MODULE
    )

    if (compensation.createdId) {
      await service.deleteProviderSettings(compensation.createdId)
    } else if (compensation.previous) {
      const { id, ...fields } = compensation.previous
      await service.updateProviderSettings({ id, ...fields })
    }
  }
)

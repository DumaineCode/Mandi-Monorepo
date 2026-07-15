/**
 * delete-provider-setting step (design §5) — clears the provider's stored
 * credentials (hard delete; the provider reverts to unconfigured/inert per
 * the fail-safe requirement). Compensation recreates the row snapshot.
 */
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { PROVIDER_SETTINGS_MODULE } from "../../modules/provider-settings"
import type ProviderSettingsModuleService from "../../modules/provider-settings/service"

export interface DeleteProviderSettingInput {
  provider: string
}

interface DeletedRowSnapshot {
  provider: string
  mode: string
  is_enabled: boolean
  public_config: Record<string, unknown> | null
  encrypted_secrets: string | null
  secret_hints: Record<string, unknown> | null
  last_verified_at: Date | null
}

export const deleteProviderSettingStep = createStep(
  "delete-provider-setting",
  async (input: DeleteProviderSettingInput, { container }) => {
    const service = container.resolve<ProviderSettingsModuleService>(
      PROVIDER_SETTINGS_MODULE
    )

    const [existing] = await service.listProviderSettings(
      { provider: input.provider },
      { take: 1 }
    )

    if (!existing) {
      return new StepResponse(
        { provider: input.provider, deleted: false },
        null
      )
    }

    const snapshot: DeletedRowSnapshot = {
      provider: existing.provider,
      mode: existing.mode,
      is_enabled: existing.is_enabled,
      public_config:
        (existing.public_config as Record<string, unknown> | null) ?? null,
      encrypted_secrets: existing.encrypted_secrets ?? null,
      secret_hints:
        (existing.secret_hints as Record<string, unknown> | null) ?? null,
      last_verified_at: existing.last_verified_at ?? null,
    }

    await service.deleteProviderSettings(existing.id)

    return new StepResponse({ provider: input.provider, deleted: true }, snapshot)
  },
  async (snapshot: DeletedRowSnapshot | null | undefined, { container }) => {
    if (!snapshot) {
      return
    }

    const service = container.resolve<ProviderSettingsModuleService>(
      PROVIDER_SETTINGS_MODULE
    )

    await service.createProviderSettings(snapshot)
  }
)

/**
 * mark-provider-verified step (design §5) — the only mutation in the
 * test-connection workflow: stamps `last_verified_at` on the provider's row
 * after a passing probe. No row (candidate-only test) = no-op.
 */
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { PROVIDER_SETTINGS_MODULE } from "../../modules/provider-settings"
import type ProviderSettingsModuleService from "../../modules/provider-settings/service"

export interface MarkProviderVerifiedInput {
  provider: string
}

interface VerifiedCompensation {
  id: string
  previous: Date | null
}

export const markProviderVerifiedStep = createStep(
  "mark-provider-verified",
  async (input: MarkProviderVerifiedInput, { container }) => {
    const service = container.resolve<ProviderSettingsModuleService>(
      PROVIDER_SETTINGS_MODULE
    )

    const [row] = await service.listProviderSettings(
      { provider: input.provider },
      { take: 1 }
    )

    if (!row) {
      return new StepResponse(null, null)
    }

    const previous = (row.last_verified_at as Date | null) ?? null

    await service.updateProviderSettings({
      id: row.id,
      last_verified_at: new Date(),
    })

    return new StepResponse(
      { id: row.id },
      { id: row.id, previous } satisfies VerifiedCompensation
    )
  },
  async (compensation: VerifiedCompensation | null | undefined, { container }) => {
    if (!compensation) {
      return
    }

    const service = container.resolve<ProviderSettingsModuleService>(
      PROVIDER_SETTINGS_MODULE
    )

    await service.updateProviderSettings({
      id: compensation.id,
      last_verified_at: compensation.previous,
    })
  }
)

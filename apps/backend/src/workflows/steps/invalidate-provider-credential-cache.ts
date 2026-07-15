/**
 * invalidate-provider-credential-cache step (design §3.3) — save-triggered
 * invalidation so mutations are effective well inside the 30s propagation
 * window. Idempotent and side-effect-safe: no compensation required.
 */
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { PROVIDER_SETTINGS_MODULE } from "../../modules/provider-settings"
import type ProviderSettingsModuleService from "../../modules/provider-settings/service"

export interface InvalidateProviderCredentialCacheInput {
  provider?: string
}

export const invalidateProviderCredentialCacheStep = createStep(
  "invalidate-provider-credential-cache",
  async (
    input: InvalidateProviderCredentialCacheInput,
    { container }
  ) => {
    const service = container.resolve<ProviderSettingsModuleService>(
      PROVIDER_SETTINGS_MODULE
    )

    service.invalidateCredentialCache(input.provider)

    return new StepResponse(null)
  }
)

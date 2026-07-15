/**
 * upsert-provider-settings workflow (design §5): validate → encrypt+upsert
 * (with row-snapshot compensation) → invalidate the credential cache so the
 * save is effective inside the propagation window.
 */
import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { encryptAndUpsertProviderSettingStep } from "./steps/encrypt-and-upsert-provider-setting"
import { invalidateProviderCredentialCacheStep } from "./steps/invalidate-provider-credential-cache"
import { validateProviderPayloadStep } from "./steps/validate-provider-payload"

export interface UpsertProviderSettingsWorkflowInput {
  provider: string
  body: Record<string, unknown>
}

export const upsertProviderSettingsWorkflow = createWorkflow(
  "upsert-provider-settings",
  function (input: UpsertProviderSettingsWorkflowInput) {
    const validated = validateProviderPayloadStep(input)

    const row = encryptAndUpsertProviderSettingStep(validated)

    invalidateProviderCredentialCacheStep({ provider: input.provider })

    return new WorkflowResponse(row)
  }
)

export default upsertProviderSettingsWorkflow

/**
 * delete-provider-settings workflow (design §5): clear the stored credential
 * set (compensated by snapshot recreation) and invalidate the cache so the
 * provider reverts to unconfigured/inert inside the propagation window.
 */
import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { deleteProviderSettingStep } from "./steps/delete-provider-setting"
import { invalidateProviderCredentialCacheStep } from "./steps/invalidate-provider-credential-cache"

export interface DeleteProviderSettingsWorkflowInput {
  provider: string
}

export const deleteProviderSettingsWorkflow = createWorkflow(
  "delete-provider-settings",
  function (input: DeleteProviderSettingsWorkflowInput) {
    const result = deleteProviderSettingStep(input)

    invalidateProviderCredentialCacheStep({ provider: input.provider })

    return new WorkflowResponse(result)
  }
)

export default deleteProviderSettingsWorkflow

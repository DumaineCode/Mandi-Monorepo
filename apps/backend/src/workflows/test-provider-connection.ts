/**
 * test-provider-connection workflow (design §5): resolve candidate/stored
 * credentials → run the best-effort probe → when it passes, stamp
 * `last_verified_at` (the only mutation). Candidate credentials are never
 * persisted; composition uses `when()` — no conditionals in the composer.
 */
import {
  createWorkflow,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { markProviderVerifiedStep } from "./steps/mark-provider-verified"
import { resolveProbeCredentialsStep } from "./steps/resolve-probe-credentials"
import { runProviderProbeStep } from "./steps/run-provider-probe"

export interface TestProviderConnectionWorkflowInput {
  provider: string
  candidate?: Record<string, unknown>
}

export const testProviderConnectionWorkflow = createWorkflow(
  "test-provider-connection",
  function (input: TestProviderConnectionWorkflowInput) {
    const resolved = resolveProbeCredentialsStep(input)

    const result = runProviderProbeStep({
      provider: input.provider,
      resolved,
    })

    when(result, (outcome) => outcome.ok).then(() =>
      markProviderVerifiedStep({ provider: input.provider })
    )

    return new WorkflowResponse(result)
  }
)

export default testProviderConnectionWorkflow

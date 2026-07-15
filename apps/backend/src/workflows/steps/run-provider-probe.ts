/**
 * run-provider-probe step (design §5/§6) — executes the per-provider
 * best-effort probe with the resolved credentials. Read-only: persists
 * nothing; timeouts and errors resolve to a failed result, never a throw.
 */
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { runProviderProbe } from "./probes"
import type { ProbeCredentialsResult } from "./resolve-probe-credentials"

export interface RunProviderProbeInput {
  provider: string
  resolved: ProbeCredentialsResult
}

export interface ProviderProbeOutcome {
  ok: boolean
  detail: string
  checked_at: string
}

export const runProviderProbeStep = createStep(
  "run-provider-probe",
  async (input: RunProviderProbeInput) => {
    if (!input.resolved.ok) {
      return new StepResponse<ProviderProbeOutcome>({
        ok: false,
        detail: input.resolved.detail,
        checked_at: new Date().toISOString(),
      })
    }

    const result = await runProviderProbe(input.provider, input.resolved.creds)

    return new StepResponse<ProviderProbeOutcome>({
      ok: result.ok,
      detail: result.detail,
      checked_at: new Date().toISOString(),
    })
  }
)

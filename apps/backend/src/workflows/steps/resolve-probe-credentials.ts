/**
 * resolve-probe-credentials step (design §5) — builds the credential set the
 * probe will use: candidate fields from the request overlay the stored
 * resolved credentials; with no candidates the stored set is tested.
 * Candidate credentials are NEVER persisted here (spec Test Connection).
 */
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { PROVIDER_SETTINGS_MODULE } from "../../modules/provider-settings"
import type ProviderSettingsModuleService from "../../modules/provider-settings/service"
import {
  PROVIDER_PUBLIC_FIELDS,
  PROVIDER_SECRET_FIELDS,
} from "./validate-provider-payload"
import { isAllowedSkydropxBaseUrl } from "./probes/skydropx"

/** Minimum material each probe needs (design §6). */
export const PROBE_REQUIRED_FIELDS: Record<string, readonly string[]> = {
  openpay: ["merchantId", "privateKey"],
  skydropx: ["apiKey", "originZip"],
  mercadopago: ["accessToken"],
}

export type ProbeCredentialsResult =
  | { ok: true; creds: Record<string, unknown> }
  | { ok: false; detail: string }

export function mergeProbeCredentials(
  provider: string,
  stored: Record<string, unknown> | null,
  candidate: Record<string, unknown>
): ProbeCredentialsResult {
  const required = PROBE_REQUIRED_FIELDS[provider]
  if (!required) {
    return { ok: false, detail: `Unknown provider "${provider}".` }
  }

  const candidateFields = [
    ...PROVIDER_PUBLIC_FIELDS[provider],
    ...PROVIDER_SECRET_FIELDS[provider],
  ]

  const overlay: Record<string, unknown> = {}
  for (const field of candidateFields) {
    const value = candidate[field]
    if (value !== undefined && value !== null && value !== "") {
      overlay[field] = value
    }
  }

  if (typeof candidate.mode === "string") {
    overlay.sandbox = candidate.mode !== "production"
  }

  const hasCandidate = Object.keys(overlay).length > 0

  if (!stored && !hasCandidate) {
    return {
      ok: false,
      detail: `${provider} is not configured and no candidate credentials were supplied.`,
    }
  }

  const creds: Record<string, unknown> = { ...(stored ?? {}), ...overlay }

  // FIX 1 (SSRF + stored-secret exfiltration): never let a candidate/stored
  // baseUrl redirect the skydropx apiKey to an untrusted host. Fail BEFORE
  // returning creds so the secret is never handed to the probe.
  if (
    provider === "skydropx" &&
    creds.baseUrl !== undefined &&
    !isAllowedSkydropxBaseUrl(creds.baseUrl)
  ) {
    return {
      ok: false,
      detail:
        "Skydropx base URL must be an https skydropx.com host — refusing to " +
        "test credentials against an untrusted destination.",
    }
  }

  const missing = required.filter(
    (field) =>
      creds[field] === undefined || creds[field] === null || creds[field] === ""
  )

  if (missing.length > 0) {
    return {
      ok: false,
      detail: `Cannot test ${provider}: missing ${missing.join(", ")}.`,
    }
  }

  return { ok: true, creds }
}

export interface ResolveProbeCredentialsInput {
  provider: string
  candidate?: Record<string, unknown>
}

export const resolveProbeCredentialsStep = createStep(
  "resolve-probe-credentials",
  async (input: ResolveProbeCredentialsInput, { container }) => {
    const service = container.resolve<ProviderSettingsModuleService>(
      PROVIDER_SETTINGS_MODULE
    )

    const stored = (await service.getResolvedCredentials(
      input.provider
    )) as Record<string, unknown> | null

    return new StepResponse(
      mergeProbeCredentials(input.provider, stored, input.candidate ?? {})
    )
  }
)

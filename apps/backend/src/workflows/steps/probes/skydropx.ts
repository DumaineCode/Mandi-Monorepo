/**
 * Skydropx test-connection probe (design §6).
 *
 * `POST /quotations` from the configured origin zip to a fixed well-known
 * destination (CDMX 06600) with the smallest parcel. Labeled best-effort:
 * quotation success also depends on carrier availability, not only on the
 * API key.
 *
 * TODO(sandbox-verify): wire shape gated on S5.0b — legacy token auth and
 * quotation body carried from the existing SkydropxClient TODO markers.
 */
import {
  probeFailure,
  probeFetch,
  type ProbeOptions,
  type ProbeResult,
} from "./types"

const DEFAULT_BASE_URL = "https://api.skydropx.com/v1"

/** Fixed, well-known destination zip for the probe quotation (CDMX centro). */
export const PROBE_DESTINATION_ZIP = "06600"

/**
 * FIX 1 (SSRF + stored-secret exfiltration guard). The Skydropx probe sends the
 * stored/candidate `apiKey` in the Authorization header to `${base}/quotations`,
 * so a caller-supplied `baseUrl` must NEVER be able to redirect that secret to
 * an arbitrary host. Only https URLs on `skydropx.com` (or a `*.skydropx.com`
 * subdomain) are allowed; http, cloud-metadata IPs, localhost, and non-skydropx
 * https hosts are all refused before any request is issued.
 */
export function isAllowedSkydropxBaseUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) {
    return false
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== "https:") {
    return false
  }
  const host = url.hostname.toLowerCase()
  return host === "skydropx.com" || host.endsWith(".skydropx.com")
}

export interface SkydropxProbeCredentials {
  apiKey: string
  originZip: string
  baseUrl?: string
}

export async function probeSkydropx(
  creds: SkydropxProbeCredentials,
  options: ProbeOptions = {}
): Promise<ProbeResult> {
  if (creds.baseUrl !== undefined && !isAllowedSkydropxBaseUrl(creds.baseUrl)) {
    return {
      ok: false,
      detail:
        "Skydropx base URL must be an https skydropx.com host — refusing to " +
        "send credentials to an untrusted destination.",
    }
  }

  const base = (creds.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")

  try {
    const response = await probeFetch(
      `${base}/quotations`,
      {
        method: "POST",
        headers: {
          Authorization: `Token token=${creds.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          zip_from: creds.originZip,
          zip_to: PROBE_DESTINATION_ZIP,
          parcel: { weight: 1, height: 10, width: 10, length: 10 },
        }),
      },
      options
    )

    if (response.ok) {
      return {
        ok: true,
        detail:
          "Skydropx credentials accepted (quotation probe, best-effort — " +
          "carrier availability may still vary).",
      }
    }

    if (response.status === 401) {
      return {
        ok: false,
        detail: "Skydropx rejected the API key (HTTP 401).",
      }
    }

    return {
      ok: false,
      detail: `Skydropx probe failed (HTTP ${response.status}, best-effort).`,
    }
  } catch (error) {
    return probeFailure("Skydropx", error)
  }
}

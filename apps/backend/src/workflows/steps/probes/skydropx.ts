/**
 * Skydropx PRO test-connection probe (design §6).
 *
 * Performs the OAuth2 client-credentials token exchange against
 * `POST /oauth/token`. A 200 response proves the stored clientId/clientSecret are
 * valid PRO credentials (the connection is live); a 401 means the credentials
 * were rejected. This is the minimal, secret-safe connectivity check — it issues
 * no quotation, so it does not depend on carrier availability or address data.
 */
import {
  probeFailure,
  probeFetch,
  type ProbeOptions,
  type ProbeResult,
} from "./types"

const DEFAULT_BASE_URL = "https://api-pro.skydropx.com/api/v1"

/**
 * FIX 1 (SSRF + stored-secret exfiltration guard). The Skydropx probe sends the
 * stored/candidate secret in the Authorization header to `${base}/quotations`,
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
  clientId: string
  clientSecret: string
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
      `${base}/oauth/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
        }),
      },
      options
    )

    if (response.ok) {
      return {
        ok: true,
        detail: "Skydropx PRO credentials accepted (OAuth token issued).",
      }
    }

    if (response.status === 401) {
      return {
        ok: false,
        detail: "Skydropx rejected the credentials (HTTP 401).",
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

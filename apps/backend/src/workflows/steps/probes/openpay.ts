/**
 * Openpay test-connection probe (design §6, resolves proposal OQ #4).
 *
 * Cheapest read-only authenticated call in the wrapped surface:
 * `GET {base}/v1/{merchantId}/charges?limit=1` with HTTP Basic auth (private
 * key as user, empty password — same contract as OpenpayClient).
 *
 * TODO(sandbox-verify): wire shape gated on S2.0c — endpoint/params carried
 * from the existing Openpay client TODO markers; results are labeled
 * best-effort in `detail` and MUST NOT block saves.
 */
import {
  probeFailure,
  probeFetch,
  type ProbeOptions,
  type ProbeResult,
} from "./types"

const PRODUCTION_BASE_URL = "https://api.openpay.mx/v1"
const SANDBOX_BASE_URL = "https://sandbox-api.openpay.mx/v1"

export interface OpenpayProbeCredentials {
  merchantId: string
  privateKey: string
  sandbox: boolean
}

export async function probeOpenpay(
  creds: OpenpayProbeCredentials,
  options: ProbeOptions = {}
): Promise<ProbeResult> {
  const base = creds.sandbox ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL
  const url = `${base}/${creds.merchantId}/charges?limit=1`
  const authHeader = `Basic ${Buffer.from(`${creds.privateKey}:`).toString(
    "base64"
  )}`

  try {
    const response = await probeFetch(
      url,
      { method: "GET", headers: { Authorization: authHeader } },
      options
    )

    if (response.ok) {
      return {
        ok: true,
        detail:
          "Openpay credentials accepted (charges list probe, best-effort).",
      }
    }

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        detail: `Openpay rejected the private key (HTTP ${response.status}).`,
      }
    }

    if (response.status === 404) {
      return {
        ok: false,
        detail:
          "Openpay returned 404 — check the merchant id and that the " +
          "sandbox/production mode matches the credentials.",
      }
    }

    return {
      ok: false,
      detail: `Openpay probe failed (HTTP ${response.status}, best-effort).`,
    }
  } catch (error) {
    return probeFailure("Openpay", error)
  }
}

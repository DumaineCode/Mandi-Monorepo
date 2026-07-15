/**
 * Mercado Pago test-connection probe (design §6, settings-only in this
 * change): `GET https://api.mercadopago.com/users/me` with a Bearer token.
 * 200 = token valid; the response `live_mode` is compared against the
 * selected mode and a mismatch is surfaced as a warning (still a pass).
 */
import {
  probeFailure,
  probeFetch,
  type ProbeOptions,
  type ProbeResult,
} from "./types"

const USERS_ME_URL = "https://api.mercadopago.com/users/me"

export interface MercadopagoProbeCredentials {
  accessToken: string
  /** Selected sandbox flag (mode-derived) for the live_mode mismatch check. */
  sandbox?: boolean
}

export async function probeMercadopago(
  creds: MercadopagoProbeCredentials,
  options: ProbeOptions = {}
): Promise<ProbeResult> {
  try {
    const response = await probeFetch(
      USERS_ME_URL,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${creds.accessToken}` },
      },
      options
    )

    if (response.status === 401) {
      return {
        ok: false,
        detail: "Mercado Pago rejected the access token (HTTP 401).",
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        detail: `Mercado Pago probe failed (HTTP ${response.status}).`,
      }
    }

    const body = (await response.json()) as { live_mode?: boolean }

    if (creds.sandbox !== undefined && body.live_mode === creds.sandbox) {
      // live_mode=true with sandbox mode selected (or vice versa).
      const tokenKind = body.live_mode ? "LIVE" : "TEST"
      const selected = creds.sandbox ? "sandbox" : "production"
      return {
        ok: true,
        detail:
          `Mercado Pago token is valid, but there is a mode mismatch: the ` +
          `token is ${tokenKind} while ${selected} mode is selected.`,
      }
    }

    return { ok: true, detail: "Mercado Pago access token is valid." }
  } catch (error) {
    return probeFailure("Mercado Pago", error)
  }
}

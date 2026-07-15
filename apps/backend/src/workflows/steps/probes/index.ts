/**
 * Provider probe dispatcher (design §6). Credentials arrive as the merged
 * candidate/stored shape from resolve-probe-credentials; each probe validates
 * nothing beyond what it needs and never throws.
 */
import { probeMercadopago } from "./mercadopago"
import { probeOpenpay } from "./openpay"
import { probeSkydropx } from "./skydropx"
import type { ProbeOptions, ProbeResult } from "./types"

export { probeMercadopago, probeOpenpay, probeSkydropx }
export * from "./types"

export async function runProviderProbe(
  provider: string,
  creds: Record<string, unknown>,
  options: ProbeOptions = {}
): Promise<ProbeResult> {
  switch (provider) {
    case "openpay":
      return probeOpenpay(
        {
          merchantId: String(creds.merchantId),
          privateKey: String(creds.privateKey),
          sandbox: creds.sandbox !== false,
        },
        options
      )
    case "skydropx":
      return probeSkydropx(
        {
          apiKey: String(creds.apiKey),
          originZip: String(creds.originZip),
          baseUrl:
            typeof creds.baseUrl === "string" ? creds.baseUrl : undefined,
        },
        options
      )
    case "mercadopago":
      return probeMercadopago(
        {
          accessToken: String(creds.accessToken),
          sandbox:
            typeof creds.sandbox === "boolean" ? creds.sandbox : undefined,
        },
        options
      )
    default:
      return { ok: false, detail: `Unknown provider "${provider}".` }
  }
}

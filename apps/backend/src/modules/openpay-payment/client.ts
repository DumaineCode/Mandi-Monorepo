/**
 * Thin fetch-based Openpay MX HTTP client (design §3.1/§6).
 *
 * Native fetch only — no new runtime dependencies. Base URL switches on the
 * sandbox flag; auth is HTTP Basic with the private key as user and an empty
 * password; every request is bounded by a 15s AbortController timeout and
 * non-2xx responses surface as typed OpenpayApiError.
 */
import {
  OpenpayApiError,
  OpenpayCharge,
  OpenpayCreateChargeRequest,
  OpenpayErrorBody,
  OpenpayOptions,
  OpenpayRefundRequest,
} from "./types"

const PRODUCTION_BASE_URL = "https://api.openpay.mx/v1"
const SANDBOX_BASE_URL = "https://sandbox-api.openpay.mx/v1"

/** Payment API calls are bounded to 15s (design §6). */
export const OPENPAY_REQUEST_TIMEOUT_MS = 15_000

type ClientOptions = Pick<
  OpenpayOptions,
  "merchantId" | "privateKey" | "sandbox"
>

export class OpenpayClient {
  private readonly baseUrl: string
  private readonly authHeader: string

  constructor(options: ClientOptions) {
    const base = options.sandbox ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL
    this.baseUrl = `${base}/${options.merchantId}`
    // Basic auth: private key as username, empty password (design §3.1).
    this.authHeader = `Basic ${Buffer.from(`${options.privateKey}:`).toString(
      "base64"
    )}`
  }

  async createCharge(body: OpenpayCreateChargeRequest): Promise<OpenpayCharge> {
    return await this.request<OpenpayCharge>("POST", "/charges", body)
  }

  async getCharge(chargeId: string): Promise<OpenpayCharge> {
    return await this.request<OpenpayCharge>(
      "GET",
      `/charges/${encodeURIComponent(chargeId)}`
    )
  }

  async refundCharge(
    chargeId: string,
    body: OpenpayRefundRequest
  ): Promise<OpenpayCharge> {
    return await this.request<OpenpayCharge>(
      "POST",
      `/charges/${encodeURIComponent(chargeId)}/refund`,
      body
    )
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      OPENPAY_REQUEST_TIMEOUT_MS
    )

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        let parsed: OpenpayErrorBody | undefined
        try {
          parsed = (await response.json()) as OpenpayErrorBody
        } catch {
          // Non-JSON error body — fall through to statusText.
        }
        throw new OpenpayApiError(
          response.status,
          parsed?.error_code,
          parsed?.description ?? response.statusText
        )
      }

      return (await response.json()) as T
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new OpenpayApiError(
          0,
          "timeout",
          `Openpay request timed out after ${OPENPAY_REQUEST_TIMEOUT_MS}ms`
        )
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

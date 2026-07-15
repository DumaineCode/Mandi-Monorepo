/**
 * Thin fetch-based Mercado Pago HTTP client (design §4/§6).
 *
 * Native fetch only — no `mercadopago` SDK, no new runtime dependencies. Auth
 * is a Bearer access token; every request is bounded by a 15s AbortController
 * timeout and non-2xx responses surface as typed MercadoPagoApiError. Idempotent
 * GETs get ONE bounded retry on transient failures; POSTs never retry.
 */
import {
  MercadoPagoApiError,
  MercadoPagoCreatePreferenceRequest,
  MercadoPagoErrorBody,
  MercadoPagoPayment,
  MercadoPagoPaymentSearchResult,
  MercadoPagoPreference,
  MercadoPagoRefundRequest,
} from "./types"

const BASE_URL = "https://api.mercadopago.com"

/** MP API calls are bounded to 15s (design §6). */
export const MERCADOPAGO_REQUEST_TIMEOUT_MS = 15_000

/** Short backoff before the single bounded retry of idempotent GETs. */
export const MERCADOPAGO_GET_RETRY_BACKOFF_MS = 250

/**
 * Transient failures worth ONE retry on idempotent GETs: network-level fetch
 * errors, our own timeout (httpStatus 0), and upstream 5xx. Never 4xx.
 */
const isTransientError = (error: unknown): boolean => {
  if (error instanceof MercadoPagoApiError) {
    return error.httpStatus === 0 || error.httpStatus >= 500
  }
  return true
}

export class MercadoPagoClient {
  private readonly authHeader: string

  constructor(options: { accessToken: string }) {
    this.authHeader = `Bearer ${options.accessToken}`
  }

  async createPreference(
    body: MercadoPagoCreatePreferenceRequest
  ): Promise<MercadoPagoPreference> {
    return await this.request<MercadoPagoPreference>(
      "POST",
      "/checkout/preferences",
      body
    )
  }

  /** Searches payments by external_reference, newest first. */
  async searchPaymentsByReference(
    externalReference: string
  ): Promise<MercadoPagoPaymentSearchResult> {
    const path = `/v1/payments/search?external_reference=${encodeURIComponent(
      externalReference
    )}&sort=date_created&criteria=desc`
    return await this.getWithRetry<MercadoPagoPaymentSearchResult>(path)
  }

  async getPayment(paymentId: string): Promise<MercadoPagoPayment> {
    return await this.getWithRetry<MercadoPagoPayment>(
      `/v1/payments/${encodeURIComponent(paymentId)}`
    )
  }

  async refundPayment(
    paymentId: string,
    body: MercadoPagoRefundRequest
  ): Promise<unknown> {
    return await this.request<unknown>(
      "POST",
      `/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
      body
    )
  }

  /** GET is idempotent → ONE bounded retry after a short backoff. */
  private async getWithRetry<T>(path: string): Promise<T> {
    try {
      return await this.request<T>("GET", path)
    } catch (error) {
      if (!isTransientError(error)) {
        throw error
      }
      await new Promise((resolve) =>
        setTimeout(resolve, MERCADOPAGO_GET_RETRY_BACKOFF_MS)
      )
      return await this.request<T>("GET", path)
    }
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      MERCADOPAGO_REQUEST_TIMEOUT_MS
    )

    try {
      const response = await fetch(`${BASE_URL}${path}`, {
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
        let parsed: MercadoPagoErrorBody | undefined
        try {
          parsed = (await response.json()) as MercadoPagoErrorBody
        } catch {
          // Non-JSON error body — fall through to statusText.
        }
        throw new MercadoPagoApiError(
          response.status,
          parsed?.error,
          parsed?.message ?? response.statusText
        )
      }

      return (await response.json()) as T
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new MercadoPagoApiError(
          0,
          "timeout",
          `Mercado Pago request timed out after ${MERCADOPAGO_REQUEST_TIMEOUT_MS}ms`
        )
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

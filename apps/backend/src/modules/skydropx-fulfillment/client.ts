/**
 * Thin fetch-based Skydropx legacy REST client (design §5.3/§5.4/§6).
 *
 * Native fetch only — no new runtime dependencies. Auth is the legacy token
 * header (`Authorization: Token token={key}`); the base URL defaults to the
 * legacy v1 API and can be overridden via SKYDROPX_BASE_URL so a migration
 * to the Pro/OAuth generation only touches this file (design R3). Quotation
 * requests are bounded by an 8s AbortController timeout (checkout-facing,
 * SD-3); shipment/label calls are admin-side and get a wider 15s bound.
 * Non-2xx responses surface as typed SkydropxApiError.
 */
import {
  SkydropxApiError,
  SkydropxCreateLabelRequest,
  SkydropxCreateShipmentRequest,
  SkydropxErrorBody,
  SkydropxLabel,
  SkydropxOptions,
  SkydropxQuotationRequest,
  SkydropxQuotationResponse,
  SkydropxShipment,
} from "./types"

const DEFAULT_BASE_URL = "https://api.skydropx.com/v1"

/** Checkout-facing quotations are bounded to 8s (design §5.3). */
export const SKYDROPX_QUOTATION_TIMEOUT_MS = 8_000
/** Admin-side shipment/label calls get a wider bound (design §5.4). */
export const SKYDROPX_REQUEST_TIMEOUT_MS = 15_000

type ClientOptions = Pick<SkydropxOptions, "apiKey" | "baseUrl">

export class SkydropxClient {
  private readonly baseUrl: string
  private readonly authHeader: string

  constructor(options: ClientOptions) {
    // Strip a trailing slash so path joining stays predictable.
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    // Legacy token auth (design §5, risk R3): single-key contract.
    this.authHeader = `Token token=${options.apiKey}`
  }

  async createQuotation(
    body: SkydropxQuotationRequest
  ): Promise<SkydropxQuotationResponse> {
    return await this.request<SkydropxQuotationResponse>(
      "POST",
      "/quotations",
      body,
      SKYDROPX_QUOTATION_TIMEOUT_MS
    )
  }

  async createShipment(
    body: SkydropxCreateShipmentRequest
  ): Promise<SkydropxShipment> {
    return await this.request<SkydropxShipment>("POST", "/shipments", body)
  }

  async createLabel(body: SkydropxCreateLabelRequest): Promise<SkydropxLabel> {
    return await this.request<SkydropxLabel>("POST", "/labels", body)
  }

  async getLabel(labelId: string): Promise<SkydropxLabel> {
    return await this.request<SkydropxLabel>(
      "GET",
      `/labels/${encodeURIComponent(labelId)}`
    )
  }

  async cancelLabel(labelId: string): Promise<SkydropxLabel> {
    // TODO(sandbox-verify): cancel endpoint pinned from design §5.4 — confirm
    // label vs shipment cancellation path against sandbox (gate S5.0b).
    return await this.request<SkydropxLabel>(
      "POST",
      `/labels/${encodeURIComponent(labelId)}/cancel`
    )
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    timeoutMs: number = SKYDROPX_REQUEST_TIMEOUT_MS
  ): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

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
        let parsed: SkydropxErrorBody | undefined
        try {
          parsed = (await response.json()) as SkydropxErrorBody
        } catch {
          // Non-JSON error body — fall through to statusText.
        }
        throw new SkydropxApiError(
          response.status,
          parsed?.code,
          parsed?.message ?? parsed?.error ?? response.statusText
        )
      }

      return (await response.json()) as T
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new SkydropxApiError(
          0,
          "timeout",
          `Skydropx request timed out after ${timeoutMs}ms`
        )
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

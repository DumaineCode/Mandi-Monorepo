/**
 * Skydropx PRO OAuth2 client (design §3).
 *
 * Native `fetch` only — no new runtime dependencies. Auth is OAuth2
 * client-credentials: a Bearer token is fetched once from `POST /oauth/token`,
 * cached with its `expiresAt`, reused across calls, refreshed on expiry (60s
 * skew) and on a single 401 (clear + refresh + retry once, then surface).
 *
 * The base URL defaults to the PRO host and is SSRF-guarded in the constructor
 * (reusing `isAllowedSkydropxBaseUrl`) so stored/candidate credentials can never
 * be POSTed to an untrusted host. The token and `clientSecret` are NEVER logged.
 *
 * Quotations are async (POST + poll GET) and bounded by a shared 8s checkout
 * deadline; shipment/label calls are admin-side with a wider per-request bound.
 * Non-2xx responses surface as typed `SkydropxApiError`.
 */
import { MedusaError } from "@medusajs/framework/utils"
import { isAllowedSkydropxBaseUrl } from "../../workflows/steps/probes/skydropx"
import {
  SkydropxApiError,
  SkydropxCancellation,
  SkydropxCreateShipmentRequest,
  SkydropxErrorBody,
  SkydropxQuotation,
  SkydropxQuotationRequest,
  SkydropxRate,
  SkydropxShipment,
  SkydropxTokenResponse,
} from "./types"

export const DEFAULT_BASE_URL = "https://api-pro.skydropx.com/api/v1"

/** Checkout-facing quotation flow (token + create + poll) shares this budget. */
export const SKYDROPX_QUOTATION_TIMEOUT_MS = 8_000
/** Admin-side shipment/label per-request bound. */
export const SKYDROPX_REQUEST_TIMEOUT_MS = 15_000
/** Token sub-bound (capped by the remaining shared budget). */
export const SKYDROPX_TOKEN_TIMEOUT_MS = 3_000
/** Refresh the token this long before its real expiry. */
export const TOKEN_EXPIRY_SKEW_MS = 60_000
/** Poll interval for async quotation completion (≤ 1 req/s < 2 req/s cap). */
export const QUOTE_POLL_INTERVAL_MS = 1_000

type ClientOptions = {
  clientId: string
  clientSecret: string
  baseUrl?: string
}

export class SkydropxClient {
  private readonly baseUrl: string
  private readonly clientId: string
  private readonly clientSecret: string
  private token_?: { accessToken: string; expiresAt: number }
  private tokenInFlight_?: Promise<string>

  constructor(options: ClientOptions) {
    // Strip a trailing slash so path joining stays predictable.
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    // Defensive SSRF (design D1 / W3): the OAuth POST carries both secrets, so a
    // non-skydropx.com host must be refused BEFORE any request leaves the process.
    if (!isAllowedSkydropxBaseUrl(this.baseUrl)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Skydropx base URL must be an https skydropx.com host — refusing to send credentials to an untrusted destination."
      )
    }
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
  }

  // ── auth ────────────────────────────────────────────────────────────────

  /**
   * Return the cached token when still fresh (now < expiresAt - skew), else
   * fetch a new one. Single-flight (W4): concurrent cold callers share ONE
   * in-flight `/oauth/token` POST so a burst of checkouts never stampedes it.
   */
  private async getToken_(deadline?: number): Promise<string> {
    if (this.token_ && Date.now() < this.token_.expiresAt - TOKEN_EXPIRY_SKEW_MS) {
      return this.token_.accessToken
    }
    if (this.tokenInFlight_) {
      return this.tokenInFlight_
    }
    const inFlight = this.fetchToken_(deadline).finally(() => {
      this.tokenInFlight_ = undefined
    })
    this.tokenInFlight_ = inFlight
    return inFlight
  }

  private async fetchToken_(deadline?: number): Promise<string> {
    const timeoutMs = this.remaining_(SKYDROPX_TOKEN_TIMEOUT_MS, deadline)
    // NEVER log token/clientSecret — the request body carries both secrets.
    const body = await this.fetch_<SkydropxTokenResponse>(
      "POST",
      "/oauth/token",
      {
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      },
      timeoutMs
    )
    this.token_ = {
      accessToken: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1_000,
    }
    return body.access_token
  }

  /**
   * Authenticated call: attach `Bearer` header; on a single 401 clear the token,
   * refresh, and retry ONCE — a second 401 surfaces the typed error (no loop).
   */
  private async authed_<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    timeoutMs: number = SKYDROPX_REQUEST_TIMEOUT_MS,
    deadline?: number
  ): Promise<T> {
    let token = await this.getToken_(deadline)
    try {
      return await this.fetch_<T>(
        method,
        path,
        body,
        this.remaining_(timeoutMs, deadline),
        token
      )
    } catch (error) {
      if (error instanceof SkydropxApiError && error.httpStatus === 401) {
        this.token_ = undefined
        token = await this.getToken_(deadline)
        return await this.fetch_<T>(
          method,
          path,
          body,
          this.remaining_(timeoutMs, deadline),
          token
        )
      }
      throw error
    }
  }

  // ── PRO endpoints ─────────────────────────────────────────────────────────

  async createQuotation(
    body: SkydropxQuotationRequest,
    deadline?: number
  ): Promise<SkydropxQuotation> {
    return await this.authed_<SkydropxQuotation>(
      "POST",
      "/quotations",
      body,
      SKYDROPX_QUOTATION_TIMEOUT_MS,
      deadline
    )
  }

  async getQuotation(
    id: string,
    deadline?: number
  ): Promise<SkydropxQuotation> {
    return await this.authed_<SkydropxQuotation>(
      "GET",
      `/quotations/${encodeURIComponent(id)}`,
      undefined,
      SKYDROPX_QUOTATION_TIMEOUT_MS,
      deadline
    )
  }

  /**
   * Async quotation model (spec Capability 3): create, then poll until
   * `is_completed`, bounded by the shared checkout `deadline`. Never overruns
   * the deadline by more than one poll interval; a never-completing quote
   * surfaces `SkydropxApiError(0,"timeout")`.
   */
  async quoteAndPoll_(
    body: SkydropxQuotationRequest,
    deadline: number
  ): Promise<SkydropxRate[]> {
    let quotation = await this.createQuotation(body, deadline)
    while (!quotation.is_completed) {
      if (Date.now() >= deadline) {
        throw new SkydropxApiError(
          0,
          "timeout",
          "Skydropx quotation did not complete within the budget."
        )
      }
      const remaining = deadline - Date.now()
      await this.sleep_(Math.min(QUOTE_POLL_INTERVAL_MS, Math.max(0, remaining)))
      quotation = await this.getQuotation(quotation.id, deadline)
    }
    return quotation.rates ?? []
  }

  async createShipment(
    body: SkydropxCreateShipmentRequest
  ): Promise<SkydropxShipment> {
    return await this.authed_<SkydropxShipment>("POST", "/shipments", body)
  }

  /** Fast-fail on `error_detail` so a failing label never burns the poll bound. */
  async getShipment(id: string): Promise<SkydropxShipment> {
    const shipment = await this.authed_<SkydropxShipment>(
      "GET",
      `/shipments/${encodeURIComponent(id)}`
    )
    const detail = shipment.error_detail
    if (detail && (detail.error_message || detail.error_code)) {
      throw new SkydropxApiError(
        0,
        detail.error_code,
        detail.error_message ?? "Skydropx shipment failed."
      )
    }
    return shipment
  }

  async cancelShipment(
    shipmentId: string,
    reason: string
  ): Promise<SkydropxCancellation> {
    return await this.authed_<SkydropxCancellation>(
      "POST",
      `/shipments/${encodeURIComponent(shipmentId)}/cancellations`,
      { reason }
    )
  }

  // ── transport ─────────────────────────────────────────────────────────────

  /** Remaining budget against the shared deadline, capped by the local bound. */
  private remaining_(timeoutMs: number, deadline?: number): number {
    if (deadline === undefined) {
      return timeoutMs
    }
    return Math.max(0, Math.min(timeoutMs, deadline - Date.now()))
  }

  /**
   * Single fetch+abort+error-map path shared by token and API calls. When
   * `token` is provided the `Authorization: Bearer` header is attached.
   */
  private async fetch_<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    timeoutMs: number,
    token?: string
  ): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(0, timeoutMs))

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      }
      if (token) {
        headers["Authorization"] = `Bearer ${token}`
      }

      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
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
          parsed?.error,
          parsed?.error_description ??
            (parsed?.errors
              ? JSON.stringify(parsed.errors)
              : response.statusText)
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

  /** Seam for tests to skip real polling delays. */
  private async sleep_(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
}

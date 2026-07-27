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
 * Quotations are async (POST + poll GET) and bounded by a shared deadline: 8s on
 * the checkout path, where a shopper is waiting, and a wider label budget on the
 * admin path, where nobody is. Shipment/label calls are admin-side with their own
 * per-request bound. Non-2xx responses surface as typed `SkydropxApiError`.
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
  SkydropxShipmentResponse,
  SkydropxTokenResponse,
} from "./types"

export const DEFAULT_BASE_URL = "https://api-pro.skydropx.com/api/v1"

/** Checkout-facing quotation flow (token + create + poll) shares this budget. */
export const SKYDROPX_QUOTATION_TIMEOUT_MS = 8_000
/** Admin-side shipment/label per-request bound. */
export const SKYDROPX_REQUEST_TIMEOUT_MS = 15_000
/** Token sub-bound (capped by the remaining shared budget). */
export const SKYDROPX_TOKEN_TIMEOUT_MS = 3_000
/**
 * Bound for the orphan-containment cancel. Shorter than the general request bound
 * because it runs AFTER a failure, on top of a budget that is already spent.
 */
export const SKYDROPX_CANCEL_TIMEOUT_MS = 10_000
/** Refresh the token this long before its real expiry. */
export const TOKEN_EXPIRY_SKEW_MS = 60_000
/** Poll interval for async quotation completion (≤ 1 req/s < 2 req/s cap). */
export const QUOTE_POLL_INTERVAL_MS = 1_000

/**
 * Flatten PRO's JSON:API shipment envelope into the shape the module uses.
 *
 * PRO returns `{ data: { id, attributes: { workflow_status, ... } }, included: [...] }`.
 * Reading `id` / `workflow_status` from the ROOT yielded `undefined`, which then
 * produced `GET /shipments/undefined → HTTP 404` and, had the id survived, a poll
 * loop that could never see `workflow_status === "success"`.
 *
 * Root-level values are accepted as a fallback so a genuinely flat response still
 * works. A MISSING id is fatal and loud: the shipment was created and charged,
 * so a silent `undefined` here is the difference between a diagnosable failure
 * and an orphaned label nobody can reconcile.
 */
export const normalizeShipment = (
  response: SkydropxShipmentResponse,
  where: string
): SkydropxShipment => {
  const attributes = response?.data?.attributes
  const id = response?.data?.id ?? response?.id

  if (!id) {
    throw new SkydropxApiError(
      0,
      "invalid_response",
      `${where}: Skydropx returned a shipment with no id, so it cannot be polled ` +
        `or cancelled. The shipment MAY have been created and charged — reconcile ` +
        `manually in the Skydropx dashboard. Raw response: ` +
        `${JSON.stringify(response).slice(0, MAX_RAW_ERROR_CHARS)}`
    )
  }

  // The package resource carries the per-label tracking number and PDF url.
  const packageAttributes = response?.included?.find(
    (entry) => entry?.attributes?.tracking_number || entry?.attributes?.label_url
  )?.attributes

  return {
    id,
    workflowStatus: attributes?.workflow_status ?? response?.workflow_status,
    masterTrackingNumber:
      attributes?.master_tracking_number ?? response?.master_tracking_number,
    labelUrl: packageAttributes?.label_url ?? attributes?.label_url ?? response?.label_url,
    trackingNumber: packageAttributes?.tracking_number,
    errorDetail: attributes?.error_detail ?? response?.error_detail,
    raw: response,
  }
}

/** Cap on raw error bodies echoed into a message, so a 200KB HTML error page
 * from a proxy cannot flood the logs. */
const MAX_RAW_ERROR_CHARS = 500

/**
 * Build an error description that is NEVER empty.
 *
 * The previous cascade ended at `response.statusText`, which Node's `fetch`
 * routinely leaves blank — so a Skydropx body carrying neither
 * `error_description` nor `errors` produced the message
 * "Skydropx label purchase failed: " with no status, no body, and no indication
 * of WHICH request failed. That is an unactionable error, and an unactionable
 * error is worse than a crash.
 *
 * Method and path lead the message because the label flow issues several calls
 * (quote, purchase, poll, cancel) and knowing which one broke is most of the
 * diagnosis.
 */
const describeErrorBody = (
  method: string,
  path: string,
  response: { status: number; statusText?: string },
  parsed: SkydropxErrorBody | undefined,
  raw: string
): string => {
  const where = `${method} ${path} → HTTP ${response.status}`
  const detail =
    parsed?.error_description ||
    (parsed?.errors ? JSON.stringify(parsed.errors) : "") ||
    // Anything else the body happens to carry, rather than discarding it.
    (parsed as { message?: string } | undefined)?.message ||
    parsed?.error ||
    raw.trim().slice(0, MAX_RAW_ERROR_CHARS) ||
    response.statusText ||
    "no error body returned by Skydropx"

  return `${where}: ${detail}`
}

/**
 * Effective per-request bound plus its provenance. `budgetBound` is true when the
 * shared deadline — not the local bound — is what constrains this request, which
 * is the only way an abort message can honestly name who ran out of time.
 */
type RequestBound = {
  timeoutMs: number
  budgetBound: boolean
}

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
    const joined = this.tokenInFlight_
    if (joined) {
      try {
        return await joined
      } catch {
        // The shared fetch carries the FIRST caller's deadline, so its failure is
        // not necessarily ours — above all for the containment cancel, whose whole
        // job is to run when some other budget just died. Fall through and retry
        // on our own terms.
      }
      // ...but retry as a NEW leader, never as N independent fetches: a bare
      // per-joiner retry turns one auth blip into the exact stampede single-flight
      // exists to prevent, against a 2 req/s carrier cap.
      if (this.tokenInFlight_ && this.tokenInFlight_ !== joined) {
        return await this.tokenInFlight_
      }
    }
    return await this.leadTokenFetch_(deadline)
  }

  /** Register this fetch as THE in-flight one, clearing only our own entry. */
  private leadTokenFetch_(deadline?: number): Promise<string> {
    const inFlight = this.fetchToken_(deadline).finally(() => {
      if (this.tokenInFlight_ === inFlight) {
        this.tokenInFlight_ = undefined
      }
    })
    this.tokenInFlight_ = inFlight
    return inFlight
  }

  private async fetchToken_(deadline?: number): Promise<string> {
    const bound = this.remaining_(SKYDROPX_TOKEN_TIMEOUT_MS, deadline)
    // NEVER log token/clientSecret — the request body carries both secrets.
    const body = await this.fetch_<SkydropxTokenResponse>(
      "POST",
      "/oauth/token",
      {
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      },
      bound
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
        try {
          token = await this.getToken_(deadline)
          return await this.fetch_<T>(
            method,
            path,
            body,
            this.remaining_(timeoutMs, deadline),
            token
          )
        } catch (retryError) {
          // A retry the budget could not afford must not rewrite the diagnosis:
          // the operator needs to see the 401. But it must not ERASE the budget
          // fact either — this whole change exists so those two are never
          // confused, and "401" alone would send someone to rotate credentials
          // when the real fault is an exhausted deadline. Keep both.
          if (
            retryError instanceof SkydropxApiError &&
            retryError.errorCode === "timeout"
          ) {
            throw new SkydropxApiError(
              error.httpStatus,
              error.errorCode,
              `${error.description} (the retry was never attempted: ${retryError.description})`
            )
          }
          throw retryError
        }
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
   * `is_completed`, bounded by the shared `deadline` (8s checkout, label budget on
   * the admin path). Never overruns the deadline; a never-completing quote
   * surfaces `SkydropxApiError(0,"timeout")`.
   *
   * The deadline is re-checked AFTER the sleep, not only before it: the sleep
   * itself spends budget, so a pre-sleep check alone can wave through a poll whose
   * remaining budget has since reached zero. A poll that still has budget is
   * always worth issuing — the GET is fast, it is the QUOTATION that is slow — and
   * if the budget dies mid-flight `remaining_` marks it `budgetBound`, so the
   * error names the exhausted budget instead of blaming Skydropx.
   */
  async quoteAndPoll_(
    body: SkydropxQuotationRequest,
    deadline: number
  ): Promise<SkydropxRate[]> {
    let quotation = await this.createQuotation(body, deadline)
    if (!quotation.id) {
      // Without an id there is nothing to poll; polling anyway would issue
      // `GET /quotations/undefined` once per round until the budget died.
      throw new SkydropxApiError(
        0,
        "invalid_response",
        "Skydropx returned a quotation with no id — cannot poll for completion."
      )
    }
    while (!quotation.is_completed) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw this.budgetExhausted_(quotation.id, deadline)
      }
      await this.sleep_(Math.min(QUOTE_POLL_INTERVAL_MS, remaining))
      if (Date.now() >= deadline) {
        throw this.budgetExhausted_(quotation.id, deadline)
      }
      quotation = await this.getQuotation(quotation.id, deadline)
    }
    return quotation.rates ?? []
  }

  /**
   * The quotation never reached `is_completed` inside the budget. Phrased as a
   * caller-side budget fact and deliberately free of any "retry the fulfillment"
   * advice: `quoteAndPoll_` is shared with the storefront checkout path, where a
   * shopper would be told to retry an operation they cannot perform.
   */
  private budgetExhausted_(
    quotationId: string | undefined,
    deadline: number
  ): SkydropxApiError {
    const over = Date.now() - deadline
    return new SkydropxApiError(
      0,
      "timeout",
      `Skydropx quotation ${quotationId ?? "(no id returned)"} did not reach ` +
        `is_completed within the budget (deadline passed ${over}ms ago). ` +
        "The quotation is still pending on Skydropx's side."
    )
  }

  async createShipment(
    body: SkydropxCreateShipmentRequest,
    deadline?: number
  ): Promise<SkydropxShipment> {
    const response = await this.authed_<SkydropxShipmentResponse>(
      "POST",
      "/shipments",
      body,
      SKYDROPX_REQUEST_TIMEOUT_MS,
      deadline
    )
    return normalizeShipment(response, "POST /shipments")
  }

  /** Fast-fail on `error_detail` so a failing label never burns the poll bound. */
  async getShipment(id: string, deadline?: number): Promise<SkydropxShipment> {
    const response = await this.authed_<SkydropxShipmentResponse>(
      "GET",
      `/shipments/${encodeURIComponent(id)}`,
      undefined,
      SKYDROPX_REQUEST_TIMEOUT_MS,
      deadline
    )
    const shipment = normalizeShipment(response, `GET /shipments/${id}`)
    const detail = shipment.errorDetail
    if (detail && (detail.error_message || detail.error_code)) {
      throw new SkydropxApiError(
        0,
        detail.error_code,
        detail.error_message ?? "Skydropx shipment failed."
      )
    }
    return shipment
  }

  /**
   * Deliberately ignores the caller's deadline: cancellation is the containment
   * path for an orphaned label, so it must still run when the fulfillment budget
   * is exactly what ran out.
   *
   * It anchors its OWN deadline rather than passing a bare per-request bound,
   * because `authed_` refreshes the token and retries once on a 401 — with a bare
   * bound that is 2 token fetches + 2 attempts (3+10+3+10 = 26s) appended to an
   * already-failing request. Anchored, the whole containment path fits inside
   * `SKYDROPX_CANCEL_TIMEOUT_MS`.
   */
  async cancelShipment(
    shipmentId: string,
    reason: string
  ): Promise<SkydropxCancellation> {
    return await this.authed_<SkydropxCancellation>(
      "POST",
      `/shipments/${encodeURIComponent(shipmentId)}/cancellations`,
      { reason },
      SKYDROPX_CANCEL_TIMEOUT_MS,
      Date.now() + SKYDROPX_CANCEL_TIMEOUT_MS
    )
  }

  // ── transport ─────────────────────────────────────────────────────────────

  /**
   * Remaining budget against the shared deadline, capped by the local bound.
   *
   * Returns WHY the effective timeout is what it is, not just the number. Without
   * `budgetBound` an abort is indistinguishable from a slow carrier: a poll issued
   * with 912ms left of a spent shared deadline aborted and reported "Skydropx
   * request timed out after 912ms", blaming Skydropx for a deadline the CALLER
   * exhausted. That was the production incident this pair of return values kills.
   */
  private remaining_(
    timeoutMs: number,
    deadline?: number
  ): RequestBound {
    if (deadline === undefined) {
      return { timeoutMs, budgetBound: false }
    }
    const left = Math.max(0, deadline - Date.now())
    return left < timeoutMs
      ? { timeoutMs: left, budgetBound: true }
      : { timeoutMs, budgetBound: false }
  }

  /**
   * Single fetch+abort+error-map path shared by token and API calls. When
   * `token` is provided the `Authorization: Bearer` header is attached.
   */
  private async fetch_<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    bound: RequestBound,
    token?: string
  ): Promise<T> {
    const { timeoutMs, budgetBound } = bound
    // A zero-budget request is guaranteed to abort on the next tick, so sending it
    // only costs a wasted round-trip — and on a POST it can cost a real side effect
    // the caller will never learn about. Fail before it leaves the process.
    if (timeoutMs <= 0) {
      throw this.timeoutError_(method, path, 0, budgetBound)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

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
        // Read as TEXT first: `response.json()` consumes the body, so a shape we
        // did not anticipate used to be lost entirely. The raw text is the last
        // fallback and it is always available.
        const raw = await response.text().catch(() => "")
        let parsed: SkydropxErrorBody | undefined
        try {
          parsed = raw ? (JSON.parse(raw) as SkydropxErrorBody) : undefined
        } catch {
          // Non-JSON error body — the raw text below carries the diagnosis.
        }
        throw new SkydropxApiError(
          response.status,
          parsed?.error,
          describeErrorBody(method, path, response, parsed, raw)
        )
      }

      return (await response.json()) as T
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw this.timeoutError_(method, path, timeoutMs, budgetBound)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * The two timeout failures that must never be reported as one another: Skydropx
   * being slow, vs. the caller's own shared deadline being spent. They have
   * opposite remedies, so they get opposite messages.
   */
  private timeoutError_(
    method: string,
    path: string,
    timeoutMs: number,
    budgetBound: boolean
  ): SkydropxApiError {
    return new SkydropxApiError(
      0,
      "timeout",
      budgetBound
        ? `Skydropx ${method} ${path} was cut short by the caller's budget: only ` +
          `${timeoutMs}ms of the shared deadline remained. Skydropx did not time out.`
        : `Skydropx request timed out after ${timeoutMs}ms`
    )
  }

  /** Seam for tests to skip real polling delays. */
  private async sleep_(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
}

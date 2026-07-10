/**
 * Openpay card payment provider (design §3.2, amendment obs #110 fixes 3/4/5).
 *
 * Charges are created in `authorizePayment` (capture-at-creation), never in
 * `initiatePayment` — money never moves before cart completion runs. The
 * charge amount is derived at authorize-time from the session data kept fresh
 * by `updatePayment` (fix 3), and `order_id` carries a `{session_id}-{n}`
 * attempt nonce so retry-after-decline never reuses an order_id (fix 4).
 *
 * Never log token ids, secrets, or full payloads (design §6).
 */
import {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  BigNumberInput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { AbstractPaymentProvider, MedusaError } from "@medusajs/framework/utils"
import { timingSafeEqual } from "node:crypto"
import { OPENPAY_IDENTIFIER } from "../../lib/constants"
import { OpenpayClient } from "./client"
import {
  OpenpayApiError,
  OpenpayCharge,
  OpenpayOptions,
  OpenpayWebhookEvent,
} from "./types"

type WebhookLogger = {
  info: (message: string) => void
  warn: (message: string) => void
}

/**
 * Event → candidate action table (design §3.4). Events absent from this map
 * (verification, chargeback.rejected, charge.refunded, unknown) never touch
 * payment state and are acknowledged as not_supported.
 */
const WEBHOOK_EVENT_ACTIONS: Record<string, "captured" | "failed"> = {
  "charge.succeeded": "captured",
  "charge.failed": "failed",
  "charge.cancelled": "failed",
  "charge.expired": "failed",
  "chargeback.created": "failed",
  "chargeback.accepted": "failed",
}

const NOT_SUPPORTED = { action: "not_supported" as const }

/**
 * Correlation by PREFIX (fix 4): charges carry `{session_id}-{n}` in order_id,
 * so the trailing attempt-nonce is stripped to recover the session id.
 *
 * INVARIANT: session ids must never end in `-digits` or the prefix strip would
 * mangle them (documented by the format-invariant unit test).
 */
export const sessionIdFromOrderId = (
  orderId: string | undefined
): string | null => {
  if (!orderId) {
    return null
  }
  const sessionId = orderId.replace(/-\d+$/, "")
  return sessionId || null
}

/** Raw card data must NEVER reach our backend (OP-2, PCI scope). */
const RAW_CARD_FIELDS = [
  "card_number",
  "cvv2",
  "cvc",
  "expiration_month",
  "expiration_year",
  "holder_name",
  "card",
] as const

type SessionData = {
  session_id?: string
  amount?: number
  currency_code?: string
  token_id?: string
  device_session_id?: string
  return_url?: string
  charge_id?: string
  charge_status?: string
  redirect_url?: string
  /** Charge-creation attempt counter persisted in session data (multi-instance safe). */
  attempt?: number
  [key: string]: unknown
}

/**
 * Keys only the provider itself may set. Client-supplied values for these are
 * stripped in initiate/update so a foreign charge_id can never be replayed
 * into a session (charge replay guard).
 */
const stripProviderOwnedFields = (data: SessionData): SessionData => {
  const {
    charge_id: _chargeId,
    charge_status: _chargeStatus,
    redirect_url: _redirectUrl,
    ...rest
  } = data
  return rest
}

const toAmountNumber = (amount: BigNumberInput | undefined): number => {
  if (amount === undefined || amount === null) {
    return NaN
  }
  if (typeof amount === "object") {
    const raw =
      (amount as { numeric?: number }).numeric ??
      (amount as { value?: string | number }).value
    return Number(raw)
  }
  return Number(amount)
}

const assertNoRawCardData = (data: Record<string, unknown> | undefined) => {
  if (!data) {
    return
  }
  const offending = RAW_CARD_FIELDS.filter((field) => field in data)
  if (offending.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Raw card data must never be sent to this backend. Tokenize with openpay.js and send token_id instead."
    )
  }
}

class OpenpayPaymentProviderService extends AbstractPaymentProvider<OpenpayOptions> {
  static identifier = OPENPAY_IDENTIFIER

  /**
   * Shape-only validation (amendment fix 5): validates the options object it
   * is given, never crashes boot for providers that were skipped upstream by
   * the medusa-config env gate.
   */
  static validateOptions(options: Record<string, unknown>): void {
    for (const key of ["merchantId", "privateKey"] as const) {
      if (typeof options[key] !== "string" || !options[key]) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Openpay provider requires a non-empty string option \`${key}\`.`
        )
      }
    }
  }

  protected readonly options_: OpenpayOptions
  protected readonly client_: OpenpayClient
  private readonly logger_?: WebhookLogger

  constructor(
    cradle: Record<string, unknown>,
    options: OpenpayOptions
  ) {
    super(cradle, options)
    this.options_ = options
    this.client_ = new OpenpayClient(options)
    this.logger_ = (cradle as { logger?: WebhookLogger }).logger
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    assertNoRawCardData(data)

    const sessionId = data.session_id
    if (!sessionId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Openpay payment session is missing its session_id."
      )
    }

    return {
      id: sessionId,
      data: {
        ...stripProviderOwnedFields(data),
        session_id: sessionId,
        amount: toAmountNumber(input.amount),
        currency_code: input.currency_code,
      },
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    assertNoRawCardData(data)

    return {
      data: {
        ...stripProviderOwnedFields(data),
        amount: toAmountNumber(input.amount),
        currency_code: input.currency_code,
      },
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    const sessionId = data.session_id
    // Amount derived at authorize-time from the session data kept fresh by
    // initiate/update (fix 3) — never from anything client-controlled later.
    const amount = toAmountNumber(data.amount)

    if (!sessionId || Number.isNaN(amount)) {
      throw new MedusaError(
        MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
        "Openpay session data is missing session_id or amount."
      )
    }

    // Idempotent re-entry: an existing charge is re-fetched, never recreated
    // (OP-4 resume after 3DS redirect).
    if (data.charge_id) {
      const charge = await this.client_.getCharge(data.charge_id)
      // Charge replay guard: the fetched charge MUST correlate back to this
      // session via its order_id prefix — a foreign charge id is rejected.
      if (sessionIdFromOrderId(charge.order_id) !== sessionId) {
        throw new MedusaError(
          MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
          `Openpay charge ${charge.id} does not belong to session ${sessionId} — refusing to authorize a replayed charge.`
        )
      }
      this.assertAmountMatches(charge, amount)
      return this.mapChargeToAuthorizeOutput(charge, data)
    }

    if (!data.token_id || !data.device_session_id) {
      throw new MedusaError(
        MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
        "Openpay card token missing — cannot authorize payment."
      )
    }

    // Attempt counter persisted in session data (multi-instance safe): Openpay
    // rejects duplicate order_id values, so each new charge gets an
    // incremented `{session_id}-{n}` nonce that survives across instances.
    const attempt = (typeof data.attempt === "number" ? data.attempt : 0) + 1

    const customer = input.context?.customer
    let charge: OpenpayCharge
    try {
      charge = await this.client_.createCharge({
        method: "card",
        source_id: data.token_id,
        amount,
        currency: (data.currency_code ?? "mxn").toUpperCase(),
        device_session_id: data.device_session_id,
        order_id: `${sessionId}-${attempt}`,
        use_3d_secure: true,
        capture: true,
        redirect_url: data.return_url,
        ...(customer
          ? {
              customer: {
                name: customer.first_name ?? undefined,
                last_name: customer.last_name ?? undefined,
                email: customer.email,
                phone_number: customer.phone ?? undefined,
              },
            }
          : {}),
      })
    } catch (error) {
      throw this.translateApiError(error)
    }

    return this.mapChargeToAuthorizeOutput(charge, { ...data, attempt })
  }

  /** Charges are capture-at-creation; keep Medusa's capture workflow happy. */
  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    return { data: input.data }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const data = (input.data ?? {}) as SessionData
    if (!data.charge_id) {
      return { status: "pending", data: input.data }
    }

    const charge = await this.client_.getCharge(data.charge_id)
    switch (charge.status) {
      case "completed":
      case "refunded":
        return { status: "captured", data: input.data }
      case "charge_pending":
        return { status: "requires_more", data: input.data }
      case "in_progress":
        return { status: "pending", data: input.data }
      case "cancelled":
        return { status: "canceled", data: input.data }
      default:
        return { status: "error", data: input.data }
    }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    if (!data.charge_id) {
      return { data: input.data }
    }
    const charge = await this.client_.getCharge(data.charge_id)
    return { data: charge as unknown as Record<string, unknown> }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    if (!data.charge_id) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Cannot refund an Openpay session without a charge."
      )
    }

    try {
      // Amount forwarded as-is in MXN — Medusa stores prices as-is, never in
      // cents (building-with-medusa data-price-format rule).
      await this.client_.refundCharge(data.charge_id, {
        amount: toAmountNumber(input.amount),
        description: "Refund requested from Medusa Admin",
      })
    } catch (error) {
      throw this.translateApiError(error, MedusaError.Types.UNEXPECTED_STATE)
    }

    return { data: input.data }
  }

  /**
   * OP-5: cancel never calls the API. Uncompleted charges have nothing to
   * void (capture-at-creation declines/expires on their own); a completed
   * charge cancel is admin-driven via refund, so it is logged and left as-is.
   */
  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    if (data.charge_id && data.charge_status === "completed") {
      this.logger_?.info(
        `Openpay cancelPayment is a no-op for completed charge ${data.charge_id} — issue a refund from Medusa Admin instead.`
      )
    }
    return { data: input.data }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data }
  }

  /**
   * Webhook verification + mapping (design §3.4, amendment fixes 3/4/6).
   *
   * Two layers: (1) Basic-auth header check with timingSafeEqual + length
   * guard; (2) server-side re-fetch of the charge — the fetched status is the
   * ONLY status source and the fetched amount is the ONLY amount returned
   * (Medusa's processPayment compares it to the session amount before
   * capturing, closing fix 3). Never log secrets, auth headers, or payload
   * blobs — event types and ids only.
   */
  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    if (!this.verifyWebhookAuth(payload.headers)) {
      this.logger_?.warn(
        "Openpay webhook rejected: Basic-auth verification failed."
      )
      return NOT_SUPPORTED
    }

    const event = (payload.data ?? {}) as OpenpayWebhookEvent

    if (event.type === "verification") {
      // Dashboard handshake: surface the code so the operator can confirm it.
      this.logger_?.info(
        `Openpay webhook verification received (verification_code: ${event.verification_code}).`
      )
      return NOT_SUPPORTED
    }

    const candidate = event.type
      ? WEBHOOK_EVENT_ACTIONS[event.type]
      : undefined
    if (!candidate) {
      return NOT_SUPPORTED
    }

    const transactionId = event.transaction?.id
    if (!transactionId) {
      this.logger_?.warn(
        `Openpay webhook event ${event.type} has no transaction id — acknowledged without action.`
      )
      return NOT_SUPPORTED
    }

    // Server-side re-fetch — payload status/amounts are never trusted. A
    // failed re-fetch THROWS so Medusa responds 5xx and Openpay redelivers
    // (auth failures above still ack quietly — never throw on bad auth).
    let charge: OpenpayCharge
    try {
      charge = await this.client_.getCharge(transactionId)
    } catch (error) {
      this.logger_?.warn(
        `Openpay webhook event ${event.type}: charge ${transactionId} could not be re-fetched — failing the delivery so Openpay retries.`
      )
      throw this.translateApiError(error, MedusaError.Types.UNEXPECTED_STATE)
    }

    const sessionId = sessionIdFromOrderId(charge.order_id)
    if (!sessionId) {
      this.logger_?.warn(
        `Openpay webhook event ${event.type}: charge ${transactionId} has no order_id correlation — acknowledged without action.`
      )
      return NOT_SUPPORTED
    }

    const data = { session_id: sessionId, amount: charge.amount }

    if (candidate === "captured") {
      if (charge.status === "completed") {
        return { action: "captured", data }
      }
      if (["failed", "cancelled"].includes(charge.status)) {
        // Fetched status wins over the event type (only status source).
        return { action: "failed", data }
      }
      return NOT_SUPPORTED
    }

    // Out-of-order redelivery guard: a late charge.* failure event for a
    // charge that actually completed maps to captured (idempotent). Chargeback
    // events keep mapping to failed regardless — the money is disputed.
    const isChargeback = (event.type ?? "").startsWith("chargeback.")
    if (!isChargeback && charge.status === "completed") {
      this.logger_?.info(
        `Openpay webhook event ${event.type}: charge ${transactionId} is completed — mapping late failure event to captured.`
      )
      return { action: "captured", data }
    }

    return { action: "failed", data }
  }

  /**
   * Basic-auth check with timingSafeEqual and an explicit length guard
   * (fix 6 — timingSafeEqual throws on length mismatch). Missing credentials
   * configuration rejects everything: fail-safe, never fail-open.
   */
  private verifyWebhookAuth(headers: Record<string, unknown>): boolean {
    const user = this.options_.webhookUser
    const password = this.options_.webhookPassword
    if (!user || !password) {
      return false
    }

    const provided = headers?.["authorization"] ?? headers?.["Authorization"]
    if (typeof provided !== "string") {
      return false
    }

    const expected = `Basic ${Buffer.from(`${user}:${password}`).toString(
      "base64"
    )}`
    const providedBuffer = Buffer.from(provided)
    const expectedBuffer = Buffer.from(expected)
    if (providedBuffer.length !== expectedBuffer.length) {
      return false
    }
    return timingSafeEqual(providedBuffer, expectedBuffer)
  }

  private assertAmountMatches(charge: OpenpayCharge, sessionAmount: number) {
    // Centavo-integer comparison — float noise in either side must not reject
    // a legitimate charge, and a real centavo-level mismatch must still fail.
    const chargeCentavos = Math.round(Number(charge.amount) * 100)
    const sessionCentavos = Math.round(sessionAmount * 100)
    if (chargeCentavos !== sessionCentavos) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Openpay charge amount mismatch: session expects ${sessionAmount}, charge ${charge.id} reports ${charge.amount}.`
      )
    }
  }

  private mapChargeToAuthorizeOutput(
    charge: OpenpayCharge,
    data: SessionData
  ): AuthorizePaymentOutput {
    const nextData = {
      ...data,
      charge_id: charge.id,
      charge_status: charge.status,
    }

    switch (charge.status) {
      case "completed":
        return { status: "captured", data: nextData }
      case "charge_pending":
      case "in_progress":
        return {
          status: "requires_more",
          data: {
            ...nextData,
            redirect_url: charge.payment_method?.url ?? data.redirect_url,
          },
        }
      default:
        throw new MedusaError(
          MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
          `Openpay charge ${charge.id} is ${charge.status}: ${
            charge.error_message ?? charge.description ?? "authorization failed"
          }`
        )
    }
  }

  private translateApiError(
    error: unknown,
    type: string = MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR
  ): Error {
    if (error instanceof OpenpayApiError) {
      return new MedusaError(
        type,
        `Openpay error ${error.errorCode ?? error.httpStatus}: ${error.description}`
      )
    }
    return error instanceof Error ? error : new Error(String(error))
  }
}

export default OpenpayPaymentProviderService

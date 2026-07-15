/**
 * Mercado Pago Checkout Pro payment provider (design §4, amendment obs #110
 * fixes 3/6).
 *
 * Redirect flow: `initiatePayment` creates a Checkout Pro preference and stores
 * its `init_point` so the storefront can redirect the customer to MP's hosted
 * checkout. The order is NEVER completed on the customer's redirect-back alone —
 * `authorizePayment` and the webhook both resolve the real outcome server-side
 * by querying MP's payments API (MP-3/MP-4). The webhook is the source of truth
 * for async methods (OXXO): a customer may pay days after the redirect.
 *
 * Credentials are DB-resolved per operation (never injected at boot) exactly
 * like Openpay. Never log the access token, webhook secret, or full payloads —
 * ids and statuses only (design §6).
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
import { createHmac, timingSafeEqual } from "node:crypto"
import { MERCADOPAGO_IDENTIFIER, MERCADOPAGO_PROVIDER_ID } from "../../lib/constants"
import {
  credentialFingerprint,
  makeDbCredentialSource,
  type CredentialSource,
} from "../../lib/provider-credentials"
import { MercadoPagoClient } from "./client"
import {
  MercadoPagoApiError,
  MercadoPagoCredentials,
  MercadoPagoOptions,
  MercadoPagoPayment,
} from "./types"

type ProviderLogger = {
  info: (message: string) => void
  warn: (message: string) => void
}

const NOT_SUPPORTED = { action: "not_supported" as const }

/**
 * Fetched-status → Medusa action. Statuses absent from this map (in_mediation,
 * refunded, charged_back, unknown) never transition payment state here and are
 * acknowledged as not_supported.
 */
const STATUS_ACTIONS: Record<string, "captured" | "failed" | "pending"> = {
  approved: "captured",
  authorized: "captured",
  rejected: "failed",
  cancelled: "failed",
  pending: "pending",
  in_process: "pending",
}

type SessionData = {
  session_id?: string
  amount?: number
  currency_code?: string
  back_urls_base?: string
  preference_id?: string
  init_point?: string
  external_reference?: string
  payment_id?: string | number
  [key: string]: unknown
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

/** Centavo-integer compare so float noise never rejects a legitimate payment. */
const amountsMatch = (a: number, b: number): boolean =>
  Math.round(Number(a) * 100) === Math.round(Number(b) * 100)

/** Parses the `ts=...,v1=...` x-signature header into its parts. */
const parseSignatureHeader = (
  header: string
): { ts: string; v1: string } | null => {
  const parts = header.split(",")
  let ts: string | undefined
  let v1: string | undefined
  for (const part of parts) {
    const [key, value] = part.split("=", 2)
    if (key?.trim() === "ts") {
      ts = value?.trim()
    } else if (key?.trim() === "v1") {
      v1 = value?.trim()
    }
  }
  if (!ts || !v1) {
    return null
  }
  return { ts, v1 }
}

class MercadoPagoPaymentProviderService extends AbstractPaymentProvider<MercadoPagoOptions> {
  static identifier = MERCADOPAGO_IDENTIFIER

  /**
   * Shape-only validation (always-registered): EMPTY options are valid because
   * credentials are DB-resolved per operation. Present fields must still be
   * well-shaped so misconfiguration fails loudly.
   */
  static validateOptions(options: Record<string, unknown>): void {
    for (const key of ["accessToken", "webhookSecret"] as const) {
      if (
        key in options &&
        (typeof options[key] !== "string" || !options[key])
      ) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Mercado Pago provider option \`${key}\`, when set, must be a non-empty string.`
        )
      }
    }
  }

  private readonly credentialSource_: CredentialSource<MercadoPagoCredentials>
  private clientCache_?: { fingerprint: string; client: MercadoPagoClient }
  private readonly logger_?: ProviderLogger

  constructor(cradle: Record<string, unknown>, options: MercadoPagoOptions = {}) {
    super(cradle, options)
    // Lazy per-operation resolution: the container is NEVER touched here —
    // module load order at boot is not guaranteed.
    this.credentialSource_ =
      options.credentialSource ??
      makeDbCredentialSource<MercadoPagoCredentials>(MERCADOPAGO_IDENTIFIER)
    this.logger_ = (cradle as { logger?: ProviderLogger }).logger
  }

  /** Resolves credentials, returning both the cached client and the raw creds. */
  private async resolve(): Promise<{
    client: MercadoPagoClient
    credentials: MercadoPagoCredentials
  }> {
    const credentials = await this.credentialSource_()
    if (!credentials?.accessToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Mercado Pago is not configured."
      )
    }
    const fingerprint = credentialFingerprint(credentials)
    if (this.clientCache_?.fingerprint !== fingerprint) {
      this.clientCache_ = {
        fingerprint,
        client: new MercadoPagoClient({ accessToken: credentials.accessToken }),
      }
    }
    return { client: this.clientCache_.client, credentials }
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    const sessionId = data.session_id
    if (!sessionId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Mercado Pago payment session is missing its session_id."
      )
    }
    if (!data.back_urls_base) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Mercado Pago payment session is missing back_urls_base."
      )
    }

    const amount = toAmountNumber(input.amount)
    const currency = (input.currency_code ?? data.currency_code ?? "mxn")

    const preference = await this.createPreference(sessionId, amount, currency, data)

    return {
      id: sessionId,
      data: {
        ...data,
        session_id: sessionId,
        amount,
        currency_code: currency,
        preference_id: preference.id,
        init_point: preference.init_point ?? preference.sandbox_init_point,
        external_reference: sessionId,
      },
    }
  }

  /**
   * Recreates the preference only when the amount changed (fix 3): a stale
   * preference would let MP charge the old amount.
   */
  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    const nextAmount = toAmountNumber(input.amount)
    const currency = input.currency_code ?? data.currency_code ?? "mxn"

    const previousAmount =
      typeof data.amount === "number" ? data.amount : toAmountNumber(data.amount)

    if (
      data.session_id &&
      data.back_urls_base &&
      !Number.isNaN(nextAmount) &&
      !amountsMatch(nextAmount, previousAmount)
    ) {
      const preference = await this.createPreference(
        data.session_id,
        nextAmount,
        currency,
        data
      )
      return {
        data: {
          ...data,
          amount: nextAmount,
          currency_code: currency,
          preference_id: preference.id,
          init_point: preference.init_point ?? preference.sandbox_init_point,
          external_reference: data.session_id,
        },
      }
    }

    return {
      data: { ...data, amount: nextAmount, currency_code: currency },
    }
  }

  private async createPreference(
    sessionId: string,
    amount: number,
    currency: string,
    data: SessionData
  ) {
    const { client, credentials } = await this.resolve()
    const base = (data.back_urls_base as string).replace(/\/$/, "")
    const notificationUrl = credentials.backendUrl
      ? `${credentials.backendUrl.replace(/\/$/, "")}/hooks/payment/${MERCADOPAGO_PROVIDER_ID}`
      : undefined

    try {
      return await client.createPreference({
        items: [
          {
            title: `Pedido ${sessionId}`,
            quantity: 1,
            // As-is amount — Medusa stores prices as-is, never in cents.
            unit_price: amount,
            currency_id: currency.toUpperCase(),
          },
        ],
        external_reference: sessionId,
        back_urls: {
          success: `${base}/success`,
          failure: `${base}/failure`,
          pending: `${base}/pending`,
        },
        auto_return: "approved",
        ...(notificationUrl ? { notification_url: notificationUrl } : {}),
      })
    } catch (error) {
      throw this.translateApiError(error)
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    const sessionId = data.session_id ?? data.external_reference
    const amount = toAmountNumber(data.amount)

    if (!sessionId) {
      throw new MedusaError(
        MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
        "Mercado Pago session data is missing its session_id/external_reference."
      )
    }

    const { client } = await this.resolve()

    let results: MercadoPagoPayment[]
    try {
      const search = await client.searchPaymentsByReference(sessionId)
      results = search.results ?? []
    } catch (error) {
      throw this.translateApiError(error)
    }

    // Results come newest-first (criteria=desc). Redirect params are NEVER
    // consulted — the payment state alone decides the outcome (MP-3).
    const approved = results.find((p) =>
      ["approved", "authorized"].includes(String(p.status))
    )
    if (approved) {
      if (!Number.isNaN(amount) && !amountsMatch(approved.transaction_amount, amount)) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Mercado Pago payment amount mismatch: session expects ${amount}, payment ${approved.id} reports ${approved.transaction_amount}.`
        )
      }
      return {
        status: "captured",
        data: { ...data, payment_id: approved.id },
      }
    }

    const pending = results.find((p) =>
      ["pending", "in_process"].includes(String(p.status))
    )
    if (pending) {
      return {
        status: "requires_more",
        data: { ...data, payment_id: pending.id },
      }
    }

    const rejected = results.find((p) =>
      ["rejected", "cancelled"].includes(String(p.status))
    )
    if (rejected) {
      throw new MedusaError(
        MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
        `Mercado Pago payment ${rejected.id} was ${rejected.status}.`
      )
    }

    // No payment yet — the customer has not completed MP checkout. Stay
    // pending so the storefront can show the webhook-driven pending experience.
    return { status: "requires_more", data }
  }

  /** Checkout Pro payments arrive captured; keep Medusa's workflow happy. */
  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    return { data: input.data }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const data = (input.data ?? {}) as SessionData
    const reference = data.external_reference ?? data.session_id
    if (!reference && !data.payment_id) {
      return { status: "pending", data: input.data }
    }

    const { client } = await this.resolve()
    let payment: MercadoPagoPayment | undefined
    if (data.payment_id) {
      payment = await client.getPayment(String(data.payment_id))
    } else {
      const search = await client.searchPaymentsByReference(String(reference))
      payment = (search.results ?? [])[0]
    }

    switch (payment?.status) {
      case "approved":
      case "authorized":
        return { status: "captured", data: input.data }
      case "pending":
      case "in_process":
        return { status: "requires_more", data: input.data }
      case "rejected":
      case "cancelled":
        return { status: "canceled", data: input.data }
      default:
        return { status: "pending", data: input.data }
    }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    if (!data.payment_id) {
      return { data: input.data }
    }
    const { client } = await this.resolve()
    const payment = await client.getPayment(String(data.payment_id))
    return { data: payment as unknown as Record<string, unknown> }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    if (!data.payment_id) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Cannot refund a Mercado Pago session without a captured payment."
      )
    }

    const { client } = await this.resolve()
    try {
      // Amount forwarded as-is in MXN (partial refunds supported).
      await client.refundPayment(String(data.payment_id), {
        amount: toAmountNumber(input.amount),
      })
    } catch (error) {
      throw this.translateApiError(error, MedusaError.Types.UNEXPECTED_STATE)
    }

    return { data: input.data }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: input.data }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data }
  }

  /**
   * Webhook verification + mapping (design §4.2, amendment fixes 3/6).
   *
   * (1) x-signature HMAC-SHA256 over `id:{data.id};request-id:{x-request-id};
   * ts:{ts};` keyed by the DB-resolved webhookSecret, compared with
   * timingSafeEqual + a length guard; (2) only `type=payment` events; (3)
   * server-side fetch-by-id is the ONLY source of truth and the returned amount
   * is ALWAYS the fetched transaction_amount (Medusa compares it to the session
   * amount before capturing, closing fix 3). Never log secrets or payloads.
   */
  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const body = (payload.data ?? {}) as Record<string, unknown>
    const headers = (payload.headers ?? {}) as Record<string, unknown>

    // TODO(sandbox-verify, gate S4.0b): confirm where MP puts the payment id
    // (query `data.id`, body `data: { id }`, or `id`) in the Medusa payload.
    const paymentId = this.extractPaymentId(body)
    const requestId = this.headerValue(headers, "x-request-id")

    const credentials = await this.credentialSource_()
    if (
      !credentials?.webhookSecret ||
      !paymentId ||
      !this.verifySignature(headers, paymentId, requestId, credentials.webhookSecret)
    ) {
      this.logger_?.warn(
        "Mercado Pago webhook rejected: x-signature verification failed."
      )
      return NOT_SUPPORTED
    }

    const type = (body.type ?? body.topic) as string | undefined
    if (type !== "payment") {
      return NOT_SUPPORTED
    }

    // Server-side re-fetch — a failed re-fetch THROWS so Medusa responds 5xx and
    // MP redelivers (auth failures above ack quietly, never throw).
    let payment: MercadoPagoPayment
    try {
      const { client } = await this.resolve()
      payment = await client.getPayment(paymentId)
    } catch (error) {
      this.logger_?.warn(
        `Mercado Pago webhook: payment ${paymentId} could not be re-fetched — failing the delivery so MP retries.`
      )
      throw this.translateApiError(error, MedusaError.Types.UNEXPECTED_STATE)
    }

    const sessionId = payment.external_reference
    if (!sessionId) {
      this.logger_?.warn(
        `Mercado Pago webhook: payment ${paymentId} has no external_reference correlation — acknowledged without action.`
      )
      return NOT_SUPPORTED
    }

    const action = STATUS_ACTIONS[String(payment.status)]
    if (!action) {
      return NOT_SUPPORTED
    }

    return {
      action,
      data: { session_id: sessionId, amount: payment.transaction_amount },
    }
  }

  private extractPaymentId(body: Record<string, unknown>): string | undefined {
    const nested = (body.data as { id?: unknown } | undefined)?.id
    const raw = nested ?? body["data.id"] ?? body.id
    return raw === undefined || raw === null ? undefined : String(raw)
  }

  private headerValue(
    headers: Record<string, unknown>,
    name: string
  ): string {
    const value = headers[name] ?? headers[name.toLowerCase()]
    return typeof value === "string" ? value : ""
  }

  /**
   * HMAC verification with timingSafeEqual and an explicit length guard
   * (fix 6 — timingSafeEqual throws on length mismatch). Fail-safe: any missing
   * part rejects the delivery.
   */
  private verifySignature(
    headers: Record<string, unknown>,
    paymentId: string,
    requestId: string,
    secret: string
  ): boolean {
    const raw = this.headerValue(headers, "x-signature")
    if (!raw) {
      return false
    }
    const parsed = parseSignatureHeader(raw)
    if (!parsed) {
      return false
    }

    const manifest = `id:${paymentId};request-id:${requestId};ts:${parsed.ts};`
    const expected = createHmac("sha256", secret).update(manifest).digest("hex")

    const providedBuffer = Buffer.from(parsed.v1, "hex")
    const expectedBuffer = Buffer.from(expected, "hex")
    if (
      providedBuffer.length === 0 ||
      providedBuffer.length !== expectedBuffer.length
    ) {
      return false
    }
    return timingSafeEqual(providedBuffer, expectedBuffer)
  }

  private translateApiError(
    error: unknown,
    type: string = MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR
  ): Error {
    if (error instanceof MercadoPagoApiError) {
      return new MedusaError(
        type,
        `Mercado Pago error ${error.errorCode ?? error.httpStatus}: ${error.description}`
      )
    }
    return error instanceof Error ? error : new Error(String(error))
  }
}

export default MercadoPagoPaymentProviderService

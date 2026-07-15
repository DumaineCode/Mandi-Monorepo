/**
 * Mercado Pago Checkout Pro API types (design §4).
 *
 * TODO(sandbox-verify): gates S4.0a/S4.0b/S4.0c were DEFERRED pending sandbox
 * credentials. Every request/response shape below is taken from the documented
 * design (obs #107 §4) and MUST be re-verified against real sandbox responses
 * before production use — especially:
 * - the exact webhook payload delivered to getWebhookActionAndData (is the
 *   payment id in a `data.id` query param, a `data: { id }` body field, or
 *   both?) which feeds the x-signature manifest (gate S4.0b);
 * - that a `captured` webhook action completes an uncompleted cart on 2.15.5
 *   (OXXO-inside-MP pays days after redirect — gate S4.0a);
 * - the `auto_return` HTTPS requirement for local back_urls (gate S4.0c).
 */

import type { CredentialSource } from "../../lib/provider-credentials"

/**
 * Resolved Mercado Pago credentials (admin-provider-settings). Matches the
 * providerSettings `getResolvedCredentials("mercadopago")` shape
 * (MercadopagoResolvedConfig) — resolved from the DB per operation, never
 * injected at boot. `backendUrl` is env-mapped from BACKEND_PUBLIC_URL at
 * resolution time and is required to build the notification_url.
 */
export interface MercadoPagoCredentials {
  accessToken: string
  webhookSecret: string
  backendUrl?: string
  publicKey?: string
  sandbox?: boolean
}

/**
 * Provider options from medusa-config.ts. Empty in production (always
 * registered, credentials DB-resolved); `credentialSource` is a test seam.
 */
export interface MercadoPagoOptions {
  credentialSource?: CredentialSource<MercadoPagoCredentials>
}

/** Payment statuses returned by the MP payments API. */
export type MercadoPagoPaymentStatus =
  | "approved"
  | "authorized"
  | "pending"
  | "in_process"
  | "in_mediation"
  | "rejected"
  | "cancelled"
  | "refunded"
  | "charged_back"

export interface MercadoPagoPreferenceItem {
  title: string
  quantity: number
  unit_price: number
  currency_id: string
}

export interface MercadoPagoBackUrls {
  success: string
  failure: string
  pending: string
}

export interface MercadoPagoCreatePreferenceRequest {
  items: MercadoPagoPreferenceItem[]
  external_reference: string
  back_urls: MercadoPagoBackUrls
  auto_return?: string
  notification_url?: string
}

/** Preference creation response — `init_point` is the hosted checkout URL. */
export interface MercadoPagoPreference {
  id: string
  init_point?: string
  sandbox_init_point?: string
}

/** A single payment record (search result or fetch-by-id). */
export interface MercadoPagoPayment {
  id: number | string
  status: MercadoPagoPaymentStatus | string
  transaction_amount: number
  currency_id?: string
  external_reference?: string
}

export interface MercadoPagoPaymentSearchResult {
  results: MercadoPagoPayment[]
}

export interface MercadoPagoRefundRequest {
  amount?: number
}

/** MP error body shape (docs): `{ message, error, status, cause[] }`. */
export interface MercadoPagoErrorBody {
  message?: string
  error?: string
  status?: number
}

/**
 * Typed error thrown by the client on non-2xx responses and timeouts.
 * Services translate it to MedusaError (design §6).
 */
export class MercadoPagoApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly errorCode: string | undefined,
    readonly description: string
  ) {
    super(`Mercado Pago API error (${httpStatus}): [${errorCode}] ${description}`)
    this.name = "MercadoPagoApiError"
  }
}

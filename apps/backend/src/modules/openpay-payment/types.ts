/**
 * Openpay MX API types (design §3.1).
 *
 * TODO(sandbox-verify): gate S2.0c (sandbox shape verification) was DEFERRED
 * pending sandbox credentials. Every request/response shape below is taken
 * from the documented design (obs #107 §3.1) and MUST be re-verified against
 * real sandbox responses before production use — especially the 3DS
 * `charge_pending` + `payment_method.url` shape, the webhook payload
 * `transaction.order_id` echo, and the refund endpoint response.
 */

/** Provider options wired from medusa-config.ts (env-derived, never hardcoded). */
export interface OpenpayOptions {
  merchantId: string
  privateKey: string
  sandbox?: boolean
  /** Webhook Basic-auth credentials — consumed by the S2b webhook slice. */
  webhookUser?: string
  webhookPassword?: string
}

/** TODO(sandbox-verify): status list from docs; confirm against sandbox. */
export type OpenpayChargeStatus =
  | "completed"
  | "in_progress"
  | "charge_pending"
  | "failed"
  | "cancelled"
  | "refunded"
  | "chargeback_pending"
  | "chargeback_accepted"
  | "chargeback_adjustment"

export interface OpenpayPaymentMethodRedirect {
  type: string
  /** 3DS redirect URL present when status is `charge_pending`. */
  url?: string
}

/** TODO(sandbox-verify): field-level shape to lock from real responses. */
export interface OpenpayCharge {
  id: string
  status: OpenpayChargeStatus
  amount: number
  currency: string
  /** Echoes our `{session_id}-{n}` attempt nonce (webhook correlation key). */
  order_id?: string
  description?: string
  error_message?: string
  payment_method?: OpenpayPaymentMethodRedirect
}

export interface OpenpayCustomer {
  name?: string
  last_name?: string
  email?: string
  phone_number?: string
}

export interface OpenpayCreateChargeRequest {
  method: "card"
  source_id: string
  amount: number
  currency: string
  device_session_id: string
  /** Medusa payment session id + attempt nonce: `{session_id}-{n}` (fix 4). */
  order_id: string
  use_3d_secure: boolean
  capture: boolean
  description?: string
  redirect_url?: string
  customer?: OpenpayCustomer
}

export interface OpenpayRefundRequest {
  amount?: number
  description?: string
}

/** Openpay error body shape (docs): `{ category, error_code, description, http_code }`. */
export interface OpenpayErrorBody {
  category?: string
  error_code?: number | string
  description?: string
  http_code?: number
}

/**
 * Typed error thrown by the client on non-2xx responses and timeouts.
 * Services translate it to MedusaError (design §6).
 */
export class OpenpayApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly errorCode: number | string | undefined,
    readonly description: string
  ) {
    super(`Openpay API error (${httpStatus}): [${errorCode}] ${description}`)
    this.name = "OpenpayApiError"
  }
}

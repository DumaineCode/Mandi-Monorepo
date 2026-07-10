/**
 * Skydropx legacy REST API types (design §5).
 *
 * API generation pinned to legacy `https://api.skydropx.com/v1` with
 * `Authorization: Token token={SKYDROPX_API_KEY}` (design §5, risk R3).
 * Shapes below are documented from design/docs memory — gate S5.0b (API
 * generation + IVA inclusion) is DEFERRED pending sandbox credentials, so
 * every wire shape carries a TODO(sandbox-verify) marker. If the account
 * turns out to be Pro/OAuth, only client.ts changes (design R3).
 */

/** Module provider options (medusa-config `options`, env-sourced). */
export interface SkydropxOptions {
  apiKey: string
  /** Optional override for the legacy base URL (SKYDROPX_BASE_URL). */
  baseUrl?: string
  /** Fallback origin zip when the stock location has none (SKYDROPX_ORIGIN_ZIP). */
  originZip?: string
  /**
   * Whether Skydropx `total_pricing` already includes IVA
   * (SKYDROPX_TAX_INCLUSIVE, default true).
   * TODO(sandbox-verify): default pinned pending gate S5.0b IVA verification.
   */
  isTaxInclusive?: boolean
}

/** Aggregate parcel in Skydropx units: kg + cm (design §5.2). */
export interface SkydropxParcel {
  weight: number
  length: number
  width: number
  height: number
}

// TODO(sandbox-verify): quotation request/response shapes pinned from docs
// memory — verify field names against a real sandbox response (gate S5.0b).
export interface SkydropxQuotationRequest {
  zip_from: string
  zip_to: string
  parcel: SkydropxParcel
}

/** A single carrier rate returned by quotations/shipments. */
export interface SkydropxRate {
  // TODO(sandbox-verify): rate shape (id, provider, total_pricing as string
  // vs number, days) must be confirmed against sandbox (gate S5.0b), incl.
  // whether total_pricing is IVA-inclusive for is_calculated_price_tax_inclusive.
  id: string
  provider: string
  total_pricing: string | number
  days?: number
  currency?: string
}

export interface SkydropxQuotationResponse {
  // TODO(sandbox-verify): legacy API may return a bare array or an envelope.
  rates?: SkydropxRate[]
}

// TODO(sandbox-verify): address field names for shipments (gate S5.0b).
export interface SkydropxAddress {
  zip: string
  name?: string
  street1?: string
  city?: string
  province?: string
  country?: string
  phone?: string
  email?: string
}

export interface SkydropxCreateShipmentRequest {
  address_from: SkydropxAddress
  address_to: SkydropxAddress
  parcels: SkydropxParcel[]
}

export interface SkydropxShipment {
  // TODO(sandbox-verify): shipment envelope + embedded rates shape (design §5.4).
  id: string
  rates?: SkydropxRate[]
}

export interface SkydropxCreateLabelRequest {
  rate_id: string
}

export interface SkydropxLabel {
  // TODO(sandbox-verify): label status values and tracking field names
  // (design §5.4 pins IN_PROGRESS polling + tracking_number/label_url).
  id: string
  status?: string
  tracking_number?: string
  tracking_url_provider?: string
  label_url?: string
}

// TODO(sandbox-verify): error body shape (gate S5.0b).
export interface SkydropxErrorBody {
  code?: string
  message?: string
  error?: string
}

/**
 * Typed client error (design §6): services translate this into MedusaError;
 * callers never see raw fetch failures.
 */
export class SkydropxApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly errorCode: string | undefined,
    public readonly description: string
  ) {
    super(`Skydropx API error (${httpStatus}): ${description}`)
    this.name = "SkydropxApiError"
  }
}

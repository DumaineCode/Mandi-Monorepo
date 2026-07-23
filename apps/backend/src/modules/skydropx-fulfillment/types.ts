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

import type { CredentialSource } from "../../lib/provider-credentials"

/**
 * Resolved Skydropx settings (admin-provider-settings slice 3). Matches the
 * providerSettings `getResolvedCredentials("skydropx")` shape — resolved from
 * the DB per operation, never injected at boot.
 */
export interface SkydropxCredentials {
  /** PRO OAuth2 client-credentials id (S1 credential reshape, design §5). */
  clientId?: string
  /** PRO OAuth2 client-credentials secret. */
  clientSecret?: string
  /**
   * @deprecated Legacy single-secret API key. Retained TRANSITIONALLY in S1 so
   * the S2-owned client transport (`client.ts`) and its spec keep compiling and
   * passing while S1 does the no-behavior-swap credential reshape across the
   * credential layers. TODO(S2): remove `apiKey` when `client.ts` adopts the
   * OAuth client-credentials Bearer flow (S2-G1).
   */
  apiKey?: string
  /** Optional override for the base URL (defaulted to the PRO host by the resolver). */
  baseUrl?: string
  /** Fallback origin zip when the stock location has none. */
  originZip?: string
  /**
   * Whether the Skydropx rate total already includes IVA (default true).
   * DB-resolved ONLY — the legacy SKYDROPX_TAX_INCLUSIVE env read is gone.
   * TODO(sandbox-verify): default pinned pending gate S5.0b IVA verification.
   */
  taxInclusive?: boolean
  /** MX Carta Porte SAT consignment note default for label creation (design D2). */
  consignmentNote?: string
  /** MX package_type default for label creation (design D2). */
  packageType?: string
}

/**
 * Provider options from medusa-config.ts. Empty in production (always
 * registered, credentials DB-resolved); `credentialSource` is a test seam.
 */
export interface SkydropxOptions {
  credentialSource?: CredentialSource<SkydropxCredentials>
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

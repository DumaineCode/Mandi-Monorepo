/**
 * Skydropx PRO API types (design §5).
 *
 * API generation pinned to Skydropx PRO (`https://api-pro.skydropx.com/api/v1`)
 * with OAuth2 client-credentials Bearer auth. Wire shapes are copied from the
 * authoritative reference (`pro-api-reference.md`) — the async two-step
 * quotation, Carta Porte-aware label creation, and the cancellations endpoint.
 */

import type { CredentialSource } from "../../lib/provider-credentials"

/**
 * Resolved Skydropx settings (admin-provider-settings). Matches the
 * providerSettings `getResolvedCredentials("skydropx")` shape — resolved from
 * the DB per operation, never injected at boot. Two encrypted secrets
 * (`clientId` + `clientSecret`) drive the OAuth client-credentials flow.
 */
export interface SkydropxCredentials {
  /** PRO OAuth2 client-credentials id. */
  clientId: string
  /** PRO OAuth2 client-credentials secret. */
  clientSecret: string
  /** Base URL override (defaults to the PRO host). */
  baseUrl?: string
  /** Fallback origin zip when the stock location has none. */
  originZip?: string
  /**
   * Whether the Skydropx rate total already includes IVA (default true).
   * `rate.total` is IVA-inclusive per the PRO reference. DB-resolved ONLY.
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

/** OAuth2 client-credentials token response (`POST /oauth/token`). */
export interface SkydropxTokenResponse {
  access_token: string
  token_type: "Bearer"
  expires_in: number
  scope?: string
  created_at?: number
}

/** Full address hierarchy required by PRO quotations. */
export interface SkydropxQuoteAddress {
  country_code: string
  postal_code: string
  /** State (full name PRO expects, e.g. "Nuevo León"). */
  area_level1?: string
  /** City. */
  area_level2?: string
  /** Neighborhood / colonia (best-effort; omitted when absent). */
  area_level3?: string
  tax_id_number?: string
}

/** Parcel in Skydropx units: kg + cm (design §5.2). */
export interface SkydropxParcel {
  length: number
  width: number
  height: number
  weight: number
  package_protected?: boolean
  declared_value?: number
}

export interface SkydropxQuotationRequest {
  quotation: {
    address_from: SkydropxQuoteAddress
    address_to: SkydropxQuoteAddress
    parcels: SkydropxParcel[]
    requested_carriers?: string[]
  }
}

/** A single carrier rate (fills progressively; poll until is_completed). */
export interface SkydropxRate {
  id: string
  success?: boolean
  status?: string
  provider_name: string
  provider_service_name?: string
  provider_service_code?: string
  currency_code?: string
  /** Base rate, NO IVA. */
  amount: string
  /** Rate total = shipping + IVA + service fee — IVA-inclusive, used for pricing. */
  total: string
  /** IVA amount (separate line). */
  vat_fee?: string | null
  days?: number
  service_fee?: number | null
  requires_origin_verification?: boolean
  shipment_creation_type?: "single" | "multipackage" | "multishipment"
}

/** Async quotation envelope — rates fill progressively (poll GET until completed). */
export interface SkydropxQuotation {
  id: string
  is_completed: boolean
  rates?: SkydropxRate[]
}

/** PRO ship address (street1-based, contact fields) for shipment creation. */
export interface SkydropxShipAddress {
  street1: string
  name?: string
  company?: string
  phone?: string
  email?: string
  reference?: string
  tax_id_number?: string
}

/** MX label package: requires Carta Porte `consignment_note` + `package_type`. */
export interface SkydropxShipPackage {
  package_number: string
  package_protected?: boolean
  declared_value?: number
  consignment_note: string
  package_type: string
}

export interface SkydropxCreateShipmentRequest {
  shipment: {
    rate_id: string
    address_from: SkydropxShipAddress
    address_to: SkydropxShipAddress
    packages: SkydropxShipPackage[]
  }
}

export interface SkydropxShipment {
  id: string
  workflow_status?: "pending" | "success"
  master_tracking_number?: string
  label_url?: string
  included?: {
    attributes?: {
      tracking_number?: string
      label_url?: string
      tracking_status?: string
    }
  }[]
  error_detail?: {
    error_code?: string
    error_message?: string
    error_message_detail?: string
  }
}

export interface SkydropxCancellation {
  id: string
  reason?: string
  status?: string
  success?: boolean
}

/** Uniform PRO error body (§7): either `{error,error_description}` or `{errors}`. */
export interface SkydropxErrorBody {
  error?: string
  error_description?: string
  errors?: Record<string, string[]>
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

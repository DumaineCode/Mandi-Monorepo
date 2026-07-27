/**
 * Skydropx PRO fulfillment provider (design §4, spec SD-1..SD-4 / Capabilities 3–6).
 *
 * Calculated shipping via the PRO async quotation API (checkout, Capability 3)
 * and label purchase via the PRO shipment model (admin, Capability 5). Quote
 * failures always surface as graceful MedusaErrors so checkout degrades to
 * manual (SD-3); label failures throw UNEXPECTED_STATE so no half-shipped
 * fulfillment is recorded (SD-4). Rate selection is deterministic and shared by
 * both paths: cheapest `total`, then fewest `days`, then `provider_name`.
 */
import {
  CalculatedShippingOptionPrice,
  CalculateShippingOptionPriceDTO,
  CreateFulfillmentResult,
  FulfillmentOption,
} from "@medusajs/framework/types"
import {
  AbstractFulfillmentProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import { SKYDROPX_IDENTIFIER } from "../../lib/constants"
import {
  credentialFingerprint,
  makeDbCredentialSource,
  type CredentialSource,
} from "../../lib/provider-credentials"
import {
  makeStockLocationSource,
  STOCK_LOCATION_NOT_FOUND,
  STOCK_LOCATION_RESOLUTION_TIMEOUT_MS,
  type StockLocationNotFound,
  type StockLocationOrigin,
  type StockLocationSource,
} from "../../lib/stock-location-address"
import {
  SkydropxClient,
  SKYDROPX_QUOTATION_TIMEOUT_MS,
  SKYDROPX_REQUEST_TIMEOUT_MS,
} from "./client"
import { buildParcel, MissingDimensionsError, ParcelItem } from "./parcel"
import {
  SkydropxApiError,
  SkydropxCredentials,
  SkydropxOptions,
  SkydropxQuoteAddress,
  SkydropxRate,
  SkydropxShipAddress,
} from "./types"

type Logger = {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
  debug?: (message: string) => void
}

type InjectedDependencies = {
  logger: Logger
}

/** Origin (`address_from`) resolved for a fulfillment (design §4.1). */
type ResolvedOrigin = {
  address: ShipAddressLike | null
  /** Stock location name → origin contact name. */
  name?: string
  locationId?: string
  /**
   * `true` when the stock location could not be READ at all (module
   * unregistered, container failure, rejected read, timeout). This is NOT the
   * same as a location that was read fine but has no address row
   * (`address === null`): the first is an infrastructure failure, the second a
   * data-entry gap. Collapsing them sends an operator to "fix" a perfectly
   * healthy address row during a DB incident.
   */
  readFailed: boolean
  /**
   * `true` when the read SUCCEEDED and the location does not exist (deleted or
   * stale `location_id`). Distinct from {@link ResolvedOrigin.readFailed}: this
   * is a DATA condition, so it must NOT be reported as a retryable incident.
   */
  notFound: boolean
}

/** The single fulfillment option this provider exposes (SD-1). */
const OPTION_ID = "skydropx-standard"

/** Normalizes unknown errors into a log/message-safe description string. */
const describeError = (error: unknown): string =>
  error instanceof SkydropxApiError
    ? error.description
    : error instanceof Error
      ? error.message
      : String(error)

/** Shipment (label) polling is bounded to 30s total (design §4, SD-4). */
export const LABEL_POLL_BOUND_MS = 30_000
/** Delay between shipment status polls. */
export const LABEL_POLL_INTERVAL_MS = 2_000

/** PRO rate statuses that carry no usable price. */
const UNPRICED_STATUSES = new Set([
  "no_coverage",
  "tariff_price_not_found",
  "not_applicable",
  "pending",
])

/**
 * MX ISO-3166-2 / common abbreviation → full state name PRO expects (design D3).
 * Keys are upper-cased; the `MX-` prefix is stripped before lookup.
 */
const MX_STATE_NAMES: Record<string, string> = {
  AGU: "Aguascalientes",
  AGS: "Aguascalientes",
  BCN: "Baja California",
  BC: "Baja California",
  BCS: "Baja California Sur",
  CAM: "Campeche",
  CAMP: "Campeche",
  CHP: "Chiapas",
  CHIS: "Chiapas",
  CHH: "Chihuahua",
  CHIH: "Chihuahua",
  COA: "Coahuila",
  COAH: "Coahuila",
  COL: "Colima",
  CMX: "Ciudad de México",
  CDMX: "Ciudad de México",
  DF: "Ciudad de México",
  DUR: "Durango",
  DGO: "Durango",
  GUA: "Guanajuato",
  GTO: "Guanajuato",
  GRO: "Guerrero",
  HID: "Hidalgo",
  HGO: "Hidalgo",
  JAL: "Jalisco",
  MEX: "México",
  EDOMEX: "México",
  MIC: "Michoacán",
  MICH: "Michoacán",
  MOR: "Morelos",
  NAY: "Nayarit",
  NLE: "Nuevo León",
  NL: "Nuevo León",
  OAX: "Oaxaca",
  PUE: "Puebla",
  QUE: "Querétaro",
  QRO: "Querétaro",
  ROO: "Quintana Roo",
  QROO: "Quintana Roo",
  SLP: "San Luis Potosí",
  SIN: "Sinaloa",
  SON: "Sonora",
  TAB: "Tabasco",
  TAM: "Tamaulipas",
  TAMPS: "Tamaulipas",
  TLA: "Tlaxcala",
  TLAX: "Tlaxcala",
  VER: "Veracruz",
  YUC: "Yucatán",
  ZAC: "Zacatecas",
}

/**
 * Map an ISO/abbreviated MX subdivision code to the full state name PRO expects;
 * pass through unchanged when the value is already a full name (design D3).
 */
export const normalizeState = (province?: string | null): string | undefined => {
  if (!province) {
    return undefined
  }
  const key = province.trim().toUpperCase().replace(/^MX-/, "")
  return MX_STATE_NAMES[key] ?? province.trim()
}

/**
 * Trim seam (WARNING 3): a whitespace-only value is the SAME gap as a blank one.
 * Every pre-flight guard and every wire builder below reads its fields through
 * this so a `"   "` company/phone/city can never pass a guard and then go out as
 * `{"company":"   "}` — precisely the `"no puede estar en blanco"` class the
 * pre-flight exists to prevent.
 */
const text = (value?: string | null): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Legacy MX national dialing prefixes people still type: "01" (long distance)
 * and "044"/"045" (mobile). They are NOT part of the subscriber number, so they
 * are dropped once the remainder is a full 10-digit national number. Ordered
 * longest-first; each entry pins the TOTAL digit length it applies to, so a
 * country-prefixed number can never be mistaken for a trunk-prefixed one.
 */
const MX_LEGACY_TRUNK_PREFIXES: ReadonlyArray<readonly [string, number]> = [
  ["044", 13],
  ["045", 13],
  ["01", 12],
]

/**
 * Phone seam (CRITICAL 1): reduce a human-typed phone to the digits PRO expects,
 * right before it goes on the wire, for BOTH `address_from` and `address_to`.
 *
 * The storefront `pattern` accepts spaces, dashes and parentheses (blocking the
 * formats real customers type was a lost sale, not a saved label), and non-
 * storefront paths — saved addresses, the store API, admin edits — are not
 * validated at all. So `(55) 1234-5678` used to reach `address_to.phone`
 * verbatim: the pre-flight's promise ("no more opaque 422") only held for BLANK
 * phones, not malformed ones.
 *
 * Rules:
 * - separators (spaces, dashes, parentheses, dots, a leading `+`) are dropped;
 * - a `52` / `521` country prefix is PRESERVED — `5215555555555` is the form
 *   Skydropx's own docs use, so it must survive untouched;
 * - a legacy `01` / `044` / `045` trunk prefix is stripped;
 * - a non-blank value with NO digits is returned unchanged. Emitting `""` here
 *   would silently blank a field the pre-flight already accepted and hand back
 *   the exact 422 this seam exists to avoid — better to let PRO name it.
 *
 * Deliberately NOT a validator and NOT a library (no runtime dependency): it
 * never rejects, so it can never block a label the pre-flight already cleared.
 */
export const normalizePhone = (value?: string | null): string | undefined => {
  const raw = text(value)
  if (!raw) {
    return undefined
  }

  const digits = raw.replace(/\D/g, "")
  if (!digits) {
    return raw
  }

  for (const [prefix, totalLength] of MX_LEGACY_TRUNK_PREFIXES) {
    if (digits.length === totalLength && digits.startsWith(prefix)) {
      return digits.slice(prefix.length)
    }
  }

  return digits
}

type AddressLike = {
  country_code?: string | null
  postal_code?: string | null
  province?: string | null
  city?: string | null
  address_2?: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * Address-sourcing seam (design §4.1): map a Medusa address to the PRO quote
 * address hierarchy. Returns `undefined` when a required component
 * (country/postal/state/city) is missing → the caller degrades to manual (SD-3).
 * `area_level3` (colonia) is best-effort (address_2 / metadata.colonia), never
 * fabricated when absent.
 */
const toAddress = (
  address: AddressLike | undefined | null
): SkydropxQuoteAddress | undefined => {
  if (!address) {
    return undefined
  }
  const country_code = text(address.country_code)?.toUpperCase()
  const postal_code = text(address.postal_code)
  const area_level1 = normalizeState(address.province)
  const area_level2 = text(address.city)
  const colonia =
    text(address.address_2) ??
    text(address.metadata?.colonia as string | undefined)

  if (!country_code || !postal_code || !area_level1 || !area_level2) {
    return undefined
  }

  return {
    country_code,
    postal_code,
    area_level1,
    area_level2,
    ...(colonia ? { area_level3: colonia } : {}),
  }
}

type ShipAddressLike = AddressLike & {
  address_1?: string | null
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  phone?: string | null
}

/**
 * Contact/street address seam (design §4.1) for `POST /shipments`. Distinct from
 * `toAddress` because the PRO ship address is `street1`-based with contact fields.
 */
const toShipAddress = (
  address: ShipAddressLike,
  extra: {
    name?: string
    email?: string
    /** Fallbacks used ONLY when the address itself has no value (design §4.1). */
    company?: string
    phone?: string
  } = {}
): SkydropxShipAddress => ({
  street1: text(address.address_1) ?? "",
  name:
    text(extra.name) ??
    text([address.first_name, address.last_name].filter(Boolean).join(" ")),
  company: text(address.company) ?? text(extra.company),
  // CRITICAL 1: the ONLY place a phone reaches the wire, for both ends.
  phone: normalizePhone(address.phone) ?? normalizePhone(extra.phone),
  email: text(extra.email),
  reference: text(address.address_2),
})

/**
 * Which components `toAddress` found missing, named with their stock-location
 * column names so the admin can fix them directly (design §4.1 pre-flight).
 */
const missingAddressComponents = (
  address: AddressLike | undefined | null
): string[] => {
  const missing: string[] = []
  if (!text(address?.country_code)) {
    missing.push("country_code")
  }
  if (!text(address?.postal_code)) {
    missing.push("postal_code")
  }
  if (!normalizeState(address?.province)) {
    missing.push("province")
  }
  if (!text(address?.city)) {
    missing.push("city")
  }
  return missing
}

/** Contact values that can fill an origin field the stock location cannot. */
type OriginContact = {
  name?: string
  company?: string
  phone?: string
  email?: string
}

/**
 * Every origin field `POST /shipments` needs on `address_from`
 * (pro-api-reference §4a), checked BEFORE the quotation is issued so a gap costs
 * an actionable message instead of a full quote+poll cycle and an opaque PRO 422.
 *
 * `reference` (colonia) and `tax_id_number` are deliberately NOT enforced: the
 * quote path already treats the colonia as best-effort (`toAddress` omits
 * `area_level3` when absent) and we never send a tax id, so hard-failing on them
 * would block origins PRO accepts today.
 *
 * Exported ONLY so `provider-settings/__tests__/origin-contract.unit.spec.ts`
 * can pin it against `PROVIDER_FORMS.skydropx` in both directions (WARNING 4):
 * a field this guard hard-requires must be marked required in the admin form,
 * and a field it tolerates must stay optional there.
 */
export const missingOriginFields = (
  address: ShipAddressLike | undefined | null,
  contact: OriginContact
): string[] => {
  const missing = missingAddressComponents(address)
  if (!text(address?.address_1)) {
    missing.push("address_1")
  }
  if (!text(contact.name)) {
    missing.push("name")
  }
  if (!text(address?.company) && !text(contact.company)) {
    missing.push("company")
  }
  if (!text(address?.phone) && !text(contact.phone)) {
    missing.push("phone")
  }
  if (!text(contact.email)) {
    missing.push("email")
  }
  return missing
}

/**
 * Every destination field `POST /shipments` needs on `address_to`
 * (pro-api-reference §4a), checked BEFORE the quotation for the same reason as
 * {@link missingOriginFields}: without it a blank phone/email costs a full
 * quote+poll cycle and surfaces PRO's raw Spanish 422 body
 * (`{"address_to":{"phone":["no puede estar en blanco"]}}`) instead of an
 * actionable message.
 *
 * `company` and `reference` are deliberately NOT enforced even though the PRO
 * reference marks them Required: consumer orders legitimately have neither, and
 * PRO accepts the shipment without them today (the observed 422 named only
 * `phone` and `email`). Enforcing them would block every B2C label.
 */
const missingDestinationFields = (
  address: ShipAddressLike | undefined | null,
  contact: { name?: string; phone?: string; email?: string }
): string[] => {
  const missing = missingAddressComponents(address)
  if (!text(address?.address_1)) {
    missing.push("address_1")
  }
  if (!text(contact.name)) {
    missing.push("name")
  }
  if (!text(contact.phone)) {
    missing.push("phone")
  }
  if (!text(contact.email)) {
    missing.push("email")
  }
  return missing
}

/** Where the operator fixes each origin field named by {@link missingOriginFields}. */
const ORIGIN_FIX_HINTS: Record<string, string> = {
  country_code: "set the country on the stock location address",
  postal_code:
    'set the postal code on the stock location address, or set "Origin ZIP" in the Skydropx provider settings',
  province: "set the state on the stock location address",
  city: "set the city on the stock location address",
  address_1: "set address line 1 on the stock location address",
  name: "set a name on the stock location",
  company:
    'set the company on the stock location address, or set "Origin company" in the Skydropx provider settings',
  phone:
    'set the phone on the stock location address, or set "Origin phone" in the Skydropx provider settings',
  email:
    'set "Origin contact email" in the Skydropx provider settings — stock locations have no email column',
}

/**
 * Where the operator fixes each destination field named by
 * {@link missingDestinationFields}. Same shape as {@link ORIGIN_FIX_HINTS}, but
 * pointing at the order/customer rather than the stock location — the two are
 * the only places these values can come from.
 */
const DESTINATION_FIX_HINTS: Record<string, string> = {
  country_code: "set the country on the order shipping address",
  postal_code: "set the postal code on the order shipping address",
  province: "set the state on the order shipping address",
  city: "set the city on the order shipping address",
  address_1: "set address line 1 on the order shipping address",
  name: "set a first/last name on the order shipping address",
  phone:
    "set a phone on the order shipping address, or on the customer record for this order",
  email: "set an email on the customer record for this order",
}

/**
 * Render a missing-field list as `field (how to fix it)` pairs. Shared by the
 * origin and destination pre-flights so both failures read the same way.
 */
const describeMissingFields = (
  missing: string[],
  hints: Record<string, string>,
  fallback: string
): string =>
  missing.map((field) => `${field} (${hints[field] ?? fallback})`).join("; ")

/** A rate is usable only when priced and successful (spec Capability 3). */
const isUsableRate = (rate: SkydropxRate): boolean =>
  rate.success === true &&
  Number.isFinite(Number(rate.total)) &&
  !(rate.status !== undefined && UNPRICED_STATUSES.has(rate.status))

/**
 * Deterministic rate selection shared by quote and label paths (spec Capability
 * 3): cheapest `total`, ties broken by fewest `days`, then `provider_name`
 * alphabetically so repeated calls always pick the same rate.
 */
const selectCheapestRate = (rates: SkydropxRate[]): SkydropxRate =>
  [...rates].sort((a, b) => {
    const priceDiff = Number(a.total) - Number(b.total)
    if (priceDiff !== 0) {
      return priceDiff
    }
    const daysDiff = (a.days ?? Infinity) - (b.days ?? Infinity)
    if (daysDiff !== 0) {
      return daysDiff
    }
    return a.provider_name.localeCompare(b.provider_name)
  })[0]

/**
 * SEAM (risk R10): the ONLY place where cart/order line items are read into
 * parcel inputs.
 */
const toParcelItems = (
  items: { quantity?: number; variant?: Record<string, unknown> | null }[]
): ParcelItem[] =>
  items.map((item) => ({
    quantity: item.quantity ?? 1,
    weight: item.variant?.weight as number | null | undefined,
    length: item.variant?.length as number | null | undefined,
    width: item.variant?.width as number | null | undefined,
    height: item.variant?.height as number | null | undefined,
  }))

export default class SkydropxFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = SKYDROPX_IDENTIFIER

  protected readonly logger_: Logger
  private readonly credentialSource_: CredentialSource<SkydropxCredentials>
  private readonly stockLocationSource_: StockLocationSource
  private clientCache_?: { fingerprint: string; client: SkydropxClient }

  constructor(
    { logger }: InjectedDependencies,
    options: SkydropxOptions = {}
  ) {
    super()
    this.logger_ = logger
    // Lazy per-operation resolution (design F1/F2): the container is NEVER
    // touched here — module load order at boot is not guaranteed. Same rule for
    // the stock-location (origin address) seam.
    this.credentialSource_ =
      options.credentialSource ??
      makeDbCredentialSource<SkydropxCredentials>(SKYDROPX_IDENTIFIER)
    this.stockLocationSource_ =
      options.stockLocationSource ?? makeStockLocationSource()
  }

  /**
   * Shape-only validation (always-registered): EMPTY options are valid because
   * credentials are DB-resolved per operation. A present-but-empty `clientId`
   * or `clientSecret` still fails loudly.
   */
  static validateOptions(options: Record<string, unknown>): void {
    for (const key of ["clientId", "clientSecret"] as const) {
      if (key in options && (typeof options[key] !== "string" || !options[key])) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Skydropx provider option \`${key}\`, when set, must be a non-empty string.`
        )
      }
    }
  }

  /** Unconfigured → typed MedusaError so checkout/admin degrade gracefully. */
  private async requireConfig_(): Promise<SkydropxCredentials> {
    const config = await this.credentialSource_()
    if (!config) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Skydropx is not configured."
      )
    }
    return config
  }

  /**
   * Immutable client cache keyed by credential fingerprint (design §3.2).
   *
   * Tradeoff (accepted): the fingerprint covers the whole resolved config, so
   * editing a cosmetic field (e.g. the origin contact fallbacks) also drops the
   * cached client and its OAuth token. Narrowing it to the auth fields would
   * risk keeping a client built with stale credentials — an occasional extra
   * token fetch after an admin save is the cheaper side of that trade.
   */
  private getClient_(config: SkydropxCredentials): SkydropxClient {
    const fingerprint = credentialFingerprint(config)
    if (this.clientCache_?.fingerprint !== fingerprint) {
      this.clientCache_ = {
        fingerprint,
        client: new SkydropxClient({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          baseUrl: config.baseUrl,
        }),
      }
    }
    return this.clientCache_.client
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [{ id: OPTION_ID, name: "Envío estándar" }]
  }

  async canCalculate(_data?: unknown): Promise<boolean> {
    return true
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    return data.id === OPTION_ID
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return { ...optionData, ...data }
  }

  async calculatePrice(
    _optionData: CalculateShippingOptionPriceDTO["optionData"],
    _data: CalculateShippingOptionPriceDTO["data"],
    context: CalculateShippingOptionPriceDTO["context"]
  ): Promise<CalculatedShippingOptionPrice> {
    const config = await this.requireConfig_()

    const ctx = context as unknown as {
      shipping_address?: AddressLike
      from_location?: { address?: AddressLike }
      items?: { quantity?: number; variant?: Record<string, unknown> | null }[]
    }

    let parcel
    try {
      parcel = buildParcel(toParcelItems(ctx.items ?? []))
    } catch (error) {
      if (error instanceof MissingDimensionsError) {
        // SD-3: graceful, thrown BEFORE any API call — checkout keeps manual options.
        throw new MedusaError(MedusaError.Types.INVALID_DATA, error.message)
      }
      throw error
    }

    const addressTo = toAddress(ctx.shipping_address)
    if (!addressTo) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Skydropx quote requires a destination country, postal code, state, and city."
      )
    }

    const addressFrom = toAddress(this.withOriginZip_(ctx.from_location?.address, config))
    if (!addressFrom) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Skydropx quote requires an origin country, postal code, state, and city (stock location or origin settings)."
      )
    }

    const client = this.getClient_(config)
    const deadline = Date.now() + SKYDROPX_QUOTATION_TIMEOUT_MS
    const rates = await this.fetchUsableRates_(() =>
      client.quoteAndPoll_(
        {
          quotation: {
            address_from: addressFrom,
            address_to: addressTo,
            parcels: [parcel],
          },
        },
        deadline
      )
    )

    const rate = selectCheapestRate(rates)

    return {
      // Amount as-is MXN — never cent-converted (data-price-format rule).
      // `rate.total` is IVA-inclusive per the PRO reference (S5.0b closed).
      calculated_amount: Number(rate.total),
      // IVA inclusion is DB-resolved ONLY; default true.
      is_calculated_price_tax_inclusive: config.taxInclusive ?? true,
    }
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: { quantity?: number; line_item_id?: string }[],
    order: Record<string, any> | undefined,
    fulfillment: Record<string, any>
  ): Promise<CreateFulfillmentResult> {
    const config = await this.requireConfig_()
    const client = this.getClient_(config)

    const orderItems: Record<string, any>[] = order?.items ?? []
    const parcelItems = toParcelItems(
      items.map((item) => ({
        quantity: item.quantity,
        variant: orderItems.find((oi) => oi.id === item.line_item_id)?.variant,
      }))
    )

    let parcel
    try {
      parcel = buildParcel(parcelItems)
    } catch (error) {
      if (error instanceof MissingDimensionsError) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, error.message)
      }
      throw error
    }

    const shippingAddress = order?.shipping_address ?? {}
    // The Fulfillment entity carries only `location_id` (no `location`
    // relation), so the origin comes from the lazy stock-location seam.
    // `resolveOrigin_` is TOTAL by construction (see `readStockLocation_`): an
    // injected `stockLocationSource` that rejects or never settles degrades to
    // `readFailed`, so no raw non-MedusaError can escape ahead of the SD-4 wrap.
    const origin = await this.resolveOrigin_(fulfillment)
    // Post-fallback origin: exactly what goes on the wire (originZip applied).
    const originAddress = this.withOriginZip_(origin.address, config) ?? {}
    // Tracked so the failure message never implies the stock location has a
    // postal code it does not actually have.
    const zipFromSettings =
      !text(origin.address?.postal_code) && Boolean(config.originZip)

    /**
     * Single source for the `address_to` contact fields: the pre-flight below and
     * the shipment payload MUST read the same values, or the guard could pass on
     * something the wire never sends.
     *
     * PRO marks email/phone Required on `address_to`. Medusa's create-fulfillment
     * order projection does NOT select `email` — it selects `customer.*` and
     * `shipping_address.*` (@medusajs/core-flows create-fulfillment) — so the
     * CUSTOMER record is the real source here and `order.email` is only a
     * best-effort first choice for direct callers that DO project it. Phone falls
     * back to the customer when the shipping address has none (design §4.1).
     */
    const destinationContact = {
      name: [shippingAddress.first_name, shippingAddress.last_name]
        .filter(Boolean)
        .join(" "),
      email: order?.email || order?.customer?.email,
      phone: shippingAddress.phone || order?.customer?.phone,
    }

    // Full pre-flight against the SHIPMENT shape on BOTH ends, before any API
    // call: a gap must cost an actionable message, not a quotation + a PRO 422.
    const addressTo = this.requireDestination_(shippingAddress, destinationContact)
    const addressFrom = this.requireOrigin_(
      origin,
      originAddress,
      config,
      zipFromSettings
    )

    let shipmentId: string | undefined
    try {
      // D4: fresh quotation at fulfillment time → deterministic cheapest rate.
      const deadline = Date.now() + SKYDROPX_REQUEST_TIMEOUT_MS
      const rates = await this.fetchUsableRates_(() =>
        client.quoteAndPoll_(
          {
            quotation: {
              address_from: addressFrom,
              address_to: addressTo,
              parcels: [parcel],
            },
          },
          deadline
        )
      )
      const rate = selectCheapestRate(rates)

      // D5: origin verification is a carrier-side one-time action — fail loud.
      if (rate.requires_origin_verification === true) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Skydropx rate for carrier ${rate.provider_name} requires origin verification. ` +
            "Verify the origin address for this carrier in the Skydropx dashboard (runbook §7), then retry."
        )
      }

      // D2: Carta Porte fields. Per-product override is a later enhancement;
      // config default only for now. MX + absent → fail loud (no wrong SAT code).
      const consignmentNote = config.consignmentNote
      const packageType = config.packageType
      const isMx = (addressTo.country_code ?? "").toUpperCase() === "MX"
      if (isMx && (!consignmentNote || !packageType)) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Skydropx MX label requires a consignment_note (Carta Porte SAT code) and package_type. " +
            "Set them in the Skydropx provider settings before purchasing a label."
        )
      }

      const shipment = await client.createShipment({
        shipment: {
          rate_id: rate.id,
          address_from: toShipAddress(originAddress, {
            name: origin.name,
            // stock_location_address has no email column and its company/phone
            // are often blank, but PRO marks all three as required on
            // address_from — public-config fallbacks (design §4.1).
            company: config.originCompany,
            phone: config.originPhone,
            email: config.originEmail,
          }),
          // Exactly the values the pre-flight validated (see
          // `destinationContact`) — guard and payload must never drift.
          address_to: toShipAddress(shippingAddress, destinationContact),
          packages: [
            {
              package_number: "1",
              consignment_note: consignmentNote ?? "",
              package_type: packageType ?? "",
            },
          ],
        },
      })
      shipmentId = shipment.id

      // Quote-vs-label rate delta for ops visibility (spec Capability 6).
      const quotedAmount = Number(order?.shipping_methods?.[0]?.amount)
      const labelAmount = Number(rate.total)
      if (Number.isFinite(quotedAmount)) {
        this.logger_.info(
          `Skydropx quote-vs-label rate delta for order #${order?.display_id}: ` +
            `quoted=${quotedAmount} label=${labelAmount} delta=${(
              labelAmount - quotedAmount
            ).toFixed(2)} MXN (carrier=${rate.provider_name})`
        )
      }

      // Bounded shipment polling (design §4): anchor the deadline once.
      let current = shipment
      const pollDeadline = Date.now() + LABEL_POLL_BOUND_MS
      while (current.workflow_status !== "success") {
        if (Date.now() > pollDeadline) {
          throw new MedusaError(
            MedusaError.Types.UNEXPECTED_STATE,
            `Skydropx shipment ${shipment.id} not ready after ${LABEL_POLL_BOUND_MS}ms.`
          )
        }
        await this.sleep_(LABEL_POLL_INTERVAL_MS)
        current = await client.getShipment(shipment.id)
      }

      const attrs = current.included?.[0]?.attributes
      const trackingNumber =
        attrs?.tracking_number ?? current.master_tracking_number
      const labelUrl = attrs?.label_url ?? current.label_url

      return {
        data: {
          ...(data ?? {}),
          shipment_id: shipment.id,
          rate_id: rate.id,
          tracking_number: trackingNumber,
          label_url: labelUrl,
        },
        labels: [
          {
            tracking_number: trackingNumber ?? "",
            tracking_url: "",
            label_url: labelUrl ?? "",
          },
        ],
      }
    } catch (error) {
      // SD-4: orphaned-shipment best-effort cancel, then surface UNEXPECTED_STATE.
      if (shipmentId) {
        await this.abandonShipment_(client, shipmentId, describeError(error))
      }
      if (error instanceof MedusaError) {
        throw error
      }
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Skydropx label purchase failed: ${describeError(error)}`
      )
    }
  }

  /**
   * Orphaned-shipment containment (SD-4): log the shipment id for manual
   * reconciliation, then best-effort cancel it. Cancel errors are swallowed
   * (logged) so the original failure is always what surfaces.
   */
  private async abandonShipment_(
    client: SkydropxClient,
    shipmentId: string,
    reason: string
  ): Promise<void> {
    this.logger_.error(
      `Skydropx shipment abandoned (${reason}) — reconcile manually if cancel fails: ` +
        `shipment_id=${shipmentId}`
    )
    try {
      await client.cancelShipment(shipmentId, `abandoned: ${reason}`)
    } catch (cancelError) {
      this.logger_.warn(
        `Skydropx best-effort cancel of shipment ${shipmentId} failed: ${describeError(cancelError)}`
      )
    }
  }

  async cancelFulfillment(data: Record<string, unknown>): Promise<any> {
    const shipmentId = data?.shipment_id as string | undefined
    if (!shipmentId) {
      // Nothing was purchased — nothing to cancel.
      return {}
    }

    // Unconfigured → log-and-proceed: Medusa-side cancellation must never block
    // on missing credentials (fail-safe).
    const config = await this.credentialSource_()
    if (!config) {
      this.logger_.warn(
        `Skydropx shipment ${shipmentId} could not be cancelled (provider unconfigured) — proceeding.`
      )
      return {}
    }

    try {
      await this.getClient_(config).cancelShipment(
        shipmentId,
        "Order fulfillment cancelled."
      )
    } catch (error) {
      // Log-and-proceed so Medusa-side cancellation never blocks on carrier
      // "not cancellable" windows.
      this.logger_.warn(
        `Skydropx shipment ${shipmentId} could not be cancelled (proceeding): ${describeError(error)}`
      )
    }

    return {}
  }

  /**
   * Origin (`address_from`) resolution for the label path (design §4.1).
   *
   * The Medusa `Fulfillment` entity has NO `location` relation — only
   * `location_id` — and the fulfillment module passes the raw entity here, so
   * the stock location must be looked up through the lazy seam.
   *
   * The `fulfillment.location.address` branch is DEFENSIVE ONLY: no Medusa
   * version hydrates that relation for a fulfillment provider today. It is kept
   * so a future Medusa (or a direct caller) that DOES hydrate it skips a
   * redundant DB read — it is not a live production path, and exactly one test
   * covers it.
   *
   * Total by construction: it never throws, so `createFulfillment` can call it
   * before the SD-4 try/catch without leaking a raw error.
   */
  private async resolveOrigin_(
    fulfillment: Record<string, any> | undefined
  ): Promise<ResolvedOrigin> {
    const locationId = fulfillment?.location_id as string | undefined

    const inline = fulfillment?.location
    if (inline?.address) {
      return {
        address: inline.address as ShipAddressLike,
        name: inline.name,
        locationId: locationId ?? (inline.id as string | undefined),
        readFailed: false,
        notFound: false,
      }
    }

    if (!locationId) {
      return { address: null, readFailed: false, notFound: false }
    }

    const read = await this.readStockLocation_(locationId)
    if (!read.ok) {
      return { address: null, locationId, readFailed: true, notFound: false }
    }

    if (read.value === STOCK_LOCATION_NOT_FOUND) {
      // The read SUCCEEDED and the row is gone: a data condition, not an
      // incident. Kept separate so the caller can say so (and NOT ask for a retry).
      return { address: null, locationId, readFailed: false, notFound: true }
    }

    return {
      // `read.value === null` also means the read failed (the default seam is
      // fail-safe and returns null on module/DB/timeout failure).
      address: (read.value?.address as ShipAddressLike | undefined) ?? null,
      name: read.value?.name,
      locationId,
      readFailed: read.value === null,
      notFound: false,
    }
  }

  /**
   * Bounded, fail-safe read of the stock-location seam.
   *
   * `stockLocationSource` is a PUBLIC injection point (`SkydropxOptions`), so
   * the service must not assume it is bounded or that it settles at all. A
   * rejecting or hanging source degrades to `{ ok: false }` here instead of
   * escaping `createFulfillment` as a raw non-MedusaError (SD-4).
   */
  private async readStockLocation_(
    locationId: string
  ): Promise<
    | { ok: true; value: StockLocationOrigin | StockLocationNotFound | null }
    | { ok: false }
  > {
    let settled: Promise<
      | { ok: true; value: StockLocationOrigin | StockLocationNotFound | null }
      | { ok: false }
    >
    try {
      settled = this.stockLocationSource_(locationId).then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const })
      )
    } catch {
      // A source that throws synchronously never produced a promise.
      return { ok: false }
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<{ ok: false }>((resolve) => {
      timer = setTimeout(
        () => resolve({ ok: false as const }),
        STOCK_LOCATION_RESOLUTION_TIMEOUT_MS
      )
    })

    try {
      return await Promise.race([settled, timeout])
    } finally {
      // Never leak the timer when the read wins the race.
      if (timer) {
        clearTimeout(timer)
      }
    }
  }

  /**
   * Origin pre-flight (design §4.1, SD-4): validate the origin against the
   * SHIPMENT shape before any API call and return the quotation-shaped origin.
   *
   * Every failure names what is empty AND where to fix it, and keeps the three
   * causes distinct: the location could not be read (infrastructure), the
   * location has no address row, or specific fields are empty.
   */
  private requireOrigin_(
    origin: ResolvedOrigin,
    originAddress: ShipAddressLike,
    config: SkydropxCredentials,
    zipFromSettings: boolean
  ): SkydropxQuoteAddress {
    if (origin.notFound) {
      // DATA condition, not an incident: the read worked and the row is gone.
      // INVALID_DATA (400) on purpose — retrying can never succeed, so this must
      // not page ops the way the UNEXPECTED_STATE below does.
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Skydropx label origin could not be resolved: stock location ${origin.locationId} no longer exists. ` +
          "This fulfillment points at a deleted or stale stock location, so retrying the label cannot succeed. " +
          "Reassign it to an existing stock location in Admin → Settings → Locations."
      )
    }

    if (origin.readFailed) {
      // Infrastructure failure — the address may be perfectly fine, so this
      // message must NOT send the operator to edit the location.
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Skydropx label origin could not be resolved: stock location ${origin.locationId} could not be READ ` +
          `(the stock location module was unavailable, the read failed, or it exceeded ` +
          `${STOCK_LOCATION_RESOLUTION_TIMEOUT_MS}ms). This is an infrastructure failure, not a bad address — ` +
          "retry the label and check the backend logs if it persists."
      )
    }

    if (!origin.address) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        origin.locationId
          ? `Skydropx label requires an origin address, but stock location ${origin.locationId} has no address configured. ` +
            "Add one in Admin → Settings → Locations."
          : "Skydropx label requires an origin address, but this fulfillment has no stock location. " +
            "Assign a stock location to the fulfillment before purchasing a label."
      )
    }

    const where = origin.locationId
      ? ` (stock location ${origin.locationId})`
      : ""
    const missing = missingOriginFields(originAddress, {
      name: origin.name,
      company: config.originCompany,
      phone: config.originPhone,
      email: config.originEmail,
    })

    if (missing.length) {
      const details = describeMissingFields(
        missing,
        ORIGIN_FIX_HINTS,
        "set it on the stock location"
      )
      const zipNote = zipFromSettings
        ? ` Note: the origin postal code came from the Skydropx "Origin ZIP" setting, not from the stock location.`
        : ""
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Skydropx label requires a complete origin address${where}. Missing: ${details}.${zipNote}`
      )
    }

    const quoteAddress = toAddress(originAddress)
    if (!quoteAddress) {
      // Defensive: `missingOriginFields` covers every component `toAddress`
      // requires, so this is only reachable if one of the two drifts.
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Skydropx label origin address is incomplete${where}.`
      )
    }
    return quoteAddress
  }

  /**
   * Destination pre-flight (design §4.1, SD-4) — the `address_to` mirror of
   * {@link SkydropxFulfillmentProviderService.requireOrigin_}.
   *
   * Runs BEFORE the quotation for the same reason: without it a blank phone or
   * email burns a full quote+poll cycle and then surfaces PRO's raw Spanish 422
   * body instead of naming the field and where it comes from.
   */
  private requireDestination_(
    shippingAddress: ShipAddressLike,
    contact: { name?: string; phone?: string; email?: string }
  ): SkydropxQuoteAddress {
    const missing = missingDestinationFields(shippingAddress, contact)
    if (missing.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Skydropx label requires a complete destination address. Missing: ${describeMissingFields(
          missing,
          DESTINATION_FIX_HINTS,
          "set it on the order shipping address"
        )}.`
      )
    }

    const quoteAddress = toAddress(shippingAddress)
    if (!quoteAddress) {
      // Defensive: `missingDestinationFields` covers every component `toAddress`
      // requires, so this is only reachable if one of the two drifts.
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Skydropx label destination address is incomplete."
      )
    }
    return quoteAddress
  }

  /**
   * Inject the fallback origin zip when the stock location has none.
   *
   * Typed `ShipAddressLike` (not `AddressLike`): the result feeds
   * `toShipAddress`, which reads `address_1`/`company`/`phone` at runtime via
   * spread. The wider type let those fields drop out of the shipment origin
   * without a compile error.
   */
  private withOriginZip_(
    address: ShipAddressLike | undefined | null,
    config: SkydropxCredentials
  ): ShipAddressLike | undefined {
    if (!address) {
      return config.originZip ? { postal_code: config.originZip } : undefined
    }
    // Trimmed (WARNING 3): a whitespace-only postal code must not defeat the
    // fallback and then be reported as "missing" while "Origin ZIP" IS set.
    if (!text(address.postal_code) && config.originZip) {
      return { ...address, postal_code: config.originZip }
    }
    return address
  }

  /**
   * Quote-path helper (SD-3): translate client errors to MedusaError, filter to
   * usable rates, and fail gracefully when none remain (never emits NaN).
   */
  private async fetchUsableRates_(
    quote: () => Promise<SkydropxRate[]>
  ): Promise<SkydropxRate[]> {
    let rates: SkydropxRate[]
    try {
      rates = await quote()
    } catch (error) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Skydropx quotation failed: ${describeError(error)}`
      )
    }

    const usable = rates.filter(isUsableRate)
    if (!usable.length) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Skydropx returned no usable rates for this shipment."
      )
    }
    return usable
  }

  /** Seam for tests to skip real polling delays. */
  private async sleep_(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
}

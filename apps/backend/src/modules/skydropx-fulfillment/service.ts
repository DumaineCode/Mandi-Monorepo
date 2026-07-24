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
  const country_code = address.country_code?.toUpperCase() || undefined
  const postal_code = address.postal_code || undefined
  const area_level1 = normalizeState(address.province)
  const area_level2 = address.city || undefined
  const colonia =
    address.address_2 ||
    (address.metadata?.colonia as string | undefined) ||
    undefined

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
  extra: { name?: string; email?: string } = {}
): SkydropxShipAddress => ({
  street1: address.address_1 || "",
  name:
    extra.name ||
    [address.first_name, address.last_name].filter(Boolean).join(" ") ||
    undefined,
  company: address.company || undefined,
  phone: address.phone || undefined,
  email: extra.email || undefined,
  reference: address.address_2 || undefined,
})

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
  private clientCache_?: { fingerprint: string; client: SkydropxClient }

  constructor(
    { logger }: InjectedDependencies,
    options: SkydropxOptions = {}
  ) {
    super()
    this.logger_ = logger
    // Lazy per-operation resolution (design F1/F2): the container is NEVER
    // touched here — module load order at boot is not guaranteed.
    this.credentialSource_ =
      options.credentialSource ??
      makeDbCredentialSource<SkydropxCredentials>(SKYDROPX_IDENTIFIER)
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

  /** Immutable client cache keyed by credential fingerprint (design §3.2). */
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
    const locationAddress = fulfillment?.location?.address ?? {}

    const addressTo = toAddress(shippingAddress)
    if (!addressTo) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Skydropx label requires a destination country, postal code, state, and city."
      )
    }
    const addressFrom = toAddress(this.withOriginZip_(locationAddress, config))
    if (!addressFrom) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Skydropx label requires an origin country, postal code, state, and city."
      )
    }

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
          address_from: toShipAddress(locationAddress, {
            name: fulfillment?.location?.name,
          }),
          address_to: toShipAddress(shippingAddress, {
            name: [shippingAddress.first_name, shippingAddress.last_name]
              .filter(Boolean)
              .join(" "),
            email: order?.email,
          }),
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

  /** Inject the fallback origin zip when the stock location has none. */
  private withOriginZip_(
    address: AddressLike | undefined | null,
    config: SkydropxCredentials
  ): AddressLike | undefined {
    if (!address) {
      return config.originZip ? { postal_code: config.originZip } : undefined
    }
    if (!address.postal_code && config.originZip) {
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

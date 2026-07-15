/**
 * Skydropx fulfillment provider (design §5, spec SD-1..SD-4).
 *
 * Calculated shipping via the legacy quotations API (checkout, SD-2) and
 * label purchase via shipments → labels (admin, SD-4). Quote failures are
 * always graceful MedusaErrors so checkout degrades to manual options (SD-3);
 * label failures throw UNEXPECTED_STATE so no half-shipped fulfillment is
 * recorded. Rate selection is deterministic and shared by both paths:
 * cheapest total, then fewest estimated days, then carrier name alphabetical.
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
import { SkydropxClient } from "./client"
import { buildParcel, MissingDimensionsError, ParcelItem } from "./parcel"
import {
  SkydropxApiError,
  SkydropxCredentials,
  SkydropxOptions,
  SkydropxRate,
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

/** IN_PROGRESS label polling is bounded to 30s total (design §5.4, SD-4). */
export const LABEL_POLL_BOUND_MS = 30_000
/** Delay between label status polls. */
export const LABEL_POLL_INTERVAL_MS = 2_000

/**
 * Deterministic rate selection shared by quote and label paths (SD-2):
 * cheapest `total_pricing`, ties broken by fewest `days`, then by carrier
 * name alphabetically so repeated calls always pick the same rate.
 */
const selectCheapestRate = (rates: SkydropxRate[]): SkydropxRate =>
  [...rates].sort((a, b) => {
    const priceDiff = Number(a.total_pricing) - Number(b.total_pricing)
    if (priceDiff !== 0) {
      return priceDiff
    }
    const daysDiff = (a.days ?? Infinity) - (b.days ?? Infinity)
    if (daysDiff !== 0) {
      return daysDiff
    }
    return a.provider.localeCompare(b.provider)
  })[0]

/**
 * SEAM (risk R10): the ONLY place where cart/order line items are read into
 * parcel inputs. If gate S5.0a finds that the 2.15.5 `calculatePrice` context
 * lacks variant dims, the documented fallback (explicit variant query inside
 * the provider) replaces this function's sourcing — nothing else changes.
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
   * Shape-only validation (slice 3 — always-registered): EMPTY options are
   * valid because credentials are DB-resolved per operation. A present but
   * malformed apiKey still fails loudly.
   */
  static validateOptions(options: Record<string, unknown>): void {
    if (
      "apiKey" in options &&
      (typeof options.apiKey !== "string" || !options.apiKey)
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Skydropx provider option `apiKey`, when set, must be a non-empty string."
      )
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
      this.clientCache_ = { fingerprint, client: new SkydropxClient(config) }
    }
    return this.clientCache_.client
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    // Single calculated option (SD-1). Name is MX-store UI copy.
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
      shipping_address?: { postal_code?: string }
      from_location?: { address?: { postal_code?: string } }
      items?: { quantity?: number; variant?: Record<string, unknown> | null }[]
    }

    const zipTo = ctx.shipping_address?.postal_code
    if (!zipTo) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Skydropx quote requires a destination postal code."
      )
    }

    // Stock location zip wins; the DB-resolved originZip is the fallback.
    const zipFrom = ctx.from_location?.address?.postal_code || config.originZip
    if (!zipFrom) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Skydropx quote requires an origin postal code (stock location or the origin zip setting)."
      )
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

    const client = this.getClient_(config)
    const rates = await this.fetchRates_(() =>
      client.createQuotation({
        zip_from: zipFrom,
        zip_to: zipTo,
        parcel,
      })
    )

    const rate = selectCheapestRate(rates)

    return {
      // Amounts stay as-is MXN — never cent-converted (data-price-format rule).
      calculated_amount: Number(rate.total_pricing),
      // IVA inclusion is DB-resolved ONLY (spec: DB strictly authoritative);
      // default true. TODO(sandbox-verify): pinned pending gate S5.0b.
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

    const locationAddress = fulfillment?.location?.address ?? {}
    const shippingAddress = order?.shipping_address ?? {}

    try {
      const shipment = await client.createShipment({
        address_from: {
          zip: locationAddress.postal_code,
          name: fulfillment?.location?.name,
          street1: locationAddress.address_1,
          city: locationAddress.city,
          province: locationAddress.province,
          country: locationAddress.country_code?.toUpperCase(),
        },
        address_to: {
          zip: shippingAddress.postal_code,
          name: [shippingAddress.first_name, shippingAddress.last_name]
            .filter(Boolean)
            .join(" "),
          street1: shippingAddress.address_1,
          city: shippingAddress.city,
          province: shippingAddress.province,
          country: shippingAddress.country_code?.toUpperCase(),
          phone: shippingAddress.phone,
          email: order?.email,
        },
        parcels: [parcel],
      })

      if (!shipment.rates?.length) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Skydropx shipment returned no rates — label cannot be purchased."
        )
      }

      // Same deterministic rule as the checkout quote (SD-2/SD-4).
      const rate = selectCheapestRate(shipment.rates)

      // Quote-vs-label rate delta for ops visibility (amendment INFO).
      const quotedAmount = Number(order?.shipping_methods?.[0]?.amount)
      const labelAmount = Number(rate.total_pricing)
      if (Number.isFinite(quotedAmount)) {
        this.logger_.info(
          `Skydropx quote-vs-label rate delta for order #${order?.display_id}: ` +
            `quoted=${quotedAmount} label=${labelAmount} delta=${(
              labelAmount - quotedAmount
            ).toFixed(2)} MXN (carrier=${rate.provider})`
        )
      }

      let label = await client.createLabel({ rate_id: rate.id })

      // Bounded IN_PROGRESS polling (design §5.4): anchor the deadline once.
      const deadline = Date.now() + LABEL_POLL_BOUND_MS
      while (label.status === "IN_PROGRESS") {
        if (Date.now() > deadline) {
          await this.abandonLabel_(
            client,
            shipment.id,
            label.id,
            `still IN_PROGRESS after ${LABEL_POLL_BOUND_MS}ms`
          )
          throw new MedusaError(
            MedusaError.Types.UNEXPECTED_STATE,
            `Skydropx label ${label.id} still IN_PROGRESS after ${LABEL_POLL_BOUND_MS}ms.`
          )
        }
        await this.sleep_(LABEL_POLL_INTERVAL_MS)
        label = await client.getLabel(label.id)
      }

      if (label.status !== "COMPLETED") {
        await this.abandonLabel_(
          client,
          shipment.id,
          label.id,
          `ended in status ${label.status}`
        )
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Skydropx label ${label.id} ended in status ${label.status}.`
        )
      }

      return {
        data: {
          ...(data ?? {}),
          shipment_id: shipment.id,
          label_id: label.id,
          rate_id: rate.id,
          tracking_number: label.tracking_number,
          tracking_url_provider: label.tracking_url_provider,
          label_url: label.label_url,
        },
        labels: [
          {
            tracking_number: label.tracking_number ?? "",
            tracking_url: label.tracking_url_provider ?? "",
            label_url: label.label_url ?? "",
          },
        ],
      }
    } catch (error) {
      // SD-4 failure: everything surfaces as UNEXPECTED_STATE, never a raw error.
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
   * Orphaned-label containment (SD-4): log shipment/label ids for manual
   * reconciliation, then best-effort cancel the label. Cancel errors are
   * swallowed (logged) so the original failure is always what surfaces.
   */
  private async abandonLabel_(
    client: SkydropxClient,
    shipmentId: string,
    labelId: string,
    reason: string
  ): Promise<void> {
    this.logger_.error(
      `Skydropx label abandoned (${reason}) — reconcile manually if cancel fails: ` +
        `shipment_id=${shipmentId} label_id=${labelId}`
    )
    try {
      await client.cancelLabel(labelId)
    } catch (cancelError) {
      this.logger_.warn(
        `Skydropx best-effort cancel of label ${labelId} failed: ${describeError(cancelError)}`
      )
    }
  }

  async cancelFulfillment(data: Record<string, unknown>): Promise<any> {
    const labelId = data?.label_id as string | undefined
    if (!labelId) {
      // Nothing was purchased — nothing to cancel.
      return {}
    }

    // Unconfigured → log-and-proceed: Medusa-side cancellation must never
    // block on missing credentials (fail-safe, same spirit as "not cancellable").
    const config = await this.credentialSource_()
    if (!config) {
      this.logger_.warn(
        `Skydropx label ${labelId} could not be cancelled (provider unconfigured) — proceeding.`
      )
      return {}
    }

    try {
      await this.getClient_(config).cancelLabel(labelId)
    } catch (error) {
      // SD-4 cancel: log-and-proceed so Medusa-side cancellation never blocks
      // on carrier "not cancellable" windows.
      this.logger_.warn(
        `Skydropx label ${labelId} could not be cancelled (proceeding): ${describeError(error)}`
      )
    }

    return {}
  }

  /** Quote-path error translation (SD-3): everything becomes a MedusaError. */
  private async fetchRates_(
    quote: () => Promise<{ rates?: SkydropxRate[] }>
  ): Promise<SkydropxRate[]> {
    let response
    try {
      response = await quote()
    } catch (error) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Skydropx quotation failed: ${describeError(error)}`
      )
    }

    if (!response.rates?.length) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Skydropx returned no rates for this shipment."
      )
    }

    return response.rates
  }

  /** Seam for tests to skip real polling delays. */
  private async sleep_(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
}

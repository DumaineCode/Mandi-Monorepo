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
  CREDENTIAL_RESOLUTION_TIMEOUT_MS,
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
  MIN_VIABLE_QUOTE_BUDGET_MS,
  SKYDROPX_CANCEL_TIMEOUT_MS,
  SKYDROPX_QUOTE_CYCLE_BUDGET_MS,
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

/**
 * Never returns an empty string.
 *
 * A blank description produced "Skydropx label purchase failed: " in production —
 * an error with no status, no body and no failing endpoint. Whatever the shape of
 * the failure, the operator gets SOMETHING to act on.
 */
/**
 * Who is going to read the message being built.
 *
 * `storefront` messages are returned by a PUBLIC, unauthenticated route, so they
 * carry no upstream detail; `admin` messages are for an authenticated operator
 * who needs the carrier's own words to act.
 */
type RateAudience = "storefront" | "admin"

const describeError = (error: unknown): string => {
  const described =
    error instanceof SkydropxApiError
      ? error.description || error.message
      : error instanceof Error
        ? error.message || error.name
        : String(error)

  const trimmed = described?.trim()
  if (trimmed) {
    return trimmed
  }
  // Last resort: dump whatever the value actually is rather than say nothing.
  try {
    return `unrecognised error: ${JSON.stringify(error)}`
  } catch {
    return `unrecognised error: ${Object.prototype.toString.call(error)}`
  }
}

/**
 * Budget composition (post-incident, design §4).
 *
 * Declared in DEPENDENCY order, and every value below the gateway is DERIVED from
 * it rather than picked. The incident that produced this block was a per-REQUEST
 * bound (15s) used as the budget for a whole multi-round async cycle: each number
 * looked reasonable alone, only the composition was wrong, and nothing failed
 * when it drifted. `constants.unit.spec.ts` pins the composition.
 */

/** Delay between shipment status polls. */
export const LABEL_POLL_INTERVAL_MS = 2_000
/**
 * Budget a status poll needs to COMPLETE, not merely to be dispatched.
 *
 * Below this the loop stops and reports the shipment state instead of firing a
 * request that is guaranteed to abort — which produced the unactionable
 * "only 14ms of the shared deadline remained" in place of the carrier's reason.
 */
export const LABEL_POLL_MIN_REQUEST_MS = 3_000
/** `workflow_status` that means the label exists and is downloadable. */
export const LABEL_STATUS_SUCCESS = "success"
/**
 * `workflow_status` values that mean Skydropx has STOPPED working on the label.
 * Polling past one of these cannot change the outcome; it only burns the budget
 * and replaces the carrier's reason with a timeout.
 */
export const TERMINAL_LABEL_FAILURE_STATUSES = new Set([
  "error",
  "failed",
  "failure",
  "cancelled",
  "canceled",
  "rejected",
  "expired",
])

export const isTerminalLabelFailure = (status?: string): boolean =>
  status !== undefined &&
  TERMINAL_LABEL_FAILURE_STATUSES.has(status.trim().toLowerCase())
/** Shipment (label) polling is bounded to 30s total (design §4, SD-4). */
export const LABEL_POLL_BOUND_MS = 30_000
/**
 * Bounded work that runs BEFORE the anchor is taken and therefore is NOT covered
 * by it. DERIVED from the two bounds that actually enforce it — `requireConfig_`
 * races the credential read against `CREDENTIAL_RESOLUTION_TIMEOUT_MS`, and
 * `resolveOrigin_` races the stock location read against
 * `STOCK_LOCATION_RESOLUTION_TIMEOUT_MS` — so it can never drift into a claim
 * about work that nothing actually bounds.
 */
export const PRE_ANCHOR_BUDGET_MS =
  CREDENTIAL_RESOLUTION_TIMEOUT_MS + STOCK_LOCATION_RESOLUTION_TIMEOUT_MS
/**
 * Fraction of the gateway this design is allowed to spend. Nothing else budgets
 * for TLS, DNS, JSON parsing, event-loop lag or workflow overhead, and a ceiling
 * with zero slack is a ceiling that is already breached.
 */
export const GATEWAY_SAFETY_MARGIN = 0.9
/**
 * Smallest anchor that can fund one label purchase and read one status poll.
 * Below this the derived budget is arithmetically incapable of buying a label.
 */
export const MIN_VIABLE_ANCHOR_MS =
  SKYDROPX_REQUEST_TIMEOUT_MS + LABEL_POLL_INTERVAL_MS
/**
 * Share of the fulfillment anchor the async quote+poll cycle may consume before
 * the label purchase is starved. Named so both `LABEL_QUOTE_BUDGET_MS` and the
 * gateway floor (`MIN_VIABLE_QUOTE_ANCHOR_MS`) read the same ratio — the floor
 * inverts it (`MIN_VIABLE_QUOTE_BUDGET_MS / LABEL_QUOTE_SHARE`) to guarantee the
 * quote slice clears the physical cold-quote floor.
 */
export const LABEL_QUOTE_SHARE = 0.45
/**
 * DERIVED, not guessed: the smallest gateway timeout from which a viable anchor
 * can be derived at all. A hand-picked floor here was wrong — it accepted 30_000,
 * which derives an 11_000ms anchor that cannot fund a single 15s request.
 *
 * It funds BOTH a viable label PURCHASE (`MIN_VIABLE_ANCHOR_MS`) and a viable
 * label QUOTE. The label quote is `floor(fulfillment * 0.45)`, so for it to clear
 * the shared cold-quote floor the fulfillment budget must reach
 * `MIN_VIABLE_QUOTE_BUDGET_MS / 0.45` — otherwise a `SKYDROPX_GATEWAY_TIMEOUT_MS`
 * reduction could silently starve the label quote below the floor S1 exists to
 * enforce (CRITICAL-2 / M2, one level up). The gateway floor is the max of the
 * two funding requirements.
 *
 * An override below this is rejected. That is not merely typo defence: it tells
 * the operator their environment cannot support a SYNCHRONOUS label purchase,
 * which is real information rather than a nuisance.
 */
export const MIN_VIABLE_QUOTE_ANCHOR_MS = Math.ceil(
  MIN_VIABLE_QUOTE_BUDGET_MS / LABEL_QUOTE_SHARE
)
export const MIN_VIABLE_GATEWAY_TIMEOUT_MS = Math.ceil(
  (PRE_ANCHOR_BUDGET_MS +
    SKYDROPX_CANCEL_TIMEOUT_MS +
    Math.max(MIN_VIABLE_ANCHOR_MS, MIN_VIABLE_QUOTE_ANCHOR_MS)) /
    GATEWAY_SAFETY_MARGIN
)
export const DEFAULT_GATEWAY_TIMEOUT_MS = 60_000

/**
 * Validated, because an unvalidated override is an outage waiting to happen: the
 * realistic typo `SKYDROPX_GATEWAY_TIMEOUT_MS=60` (seconds, not ms) would derive a
 * NEGATIVE anchor, every deadline would land in the past, and EVERY label purchase
 * would fail instantly with "0ms remained". Reject and fall back loudly instead.
 *
 * Parameterised for tests; production reads `process.env` and `console.warn`.
 */
export function readGatewayTimeout(
  raw: string | undefined = process.env.SKYDROPX_GATEWAY_TIMEOUT_MS,
  warn: (message: string) => void = console.warn
): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_GATEWAY_TIMEOUT_MS
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < MIN_VIABLE_GATEWAY_TIMEOUT_MS) {
    // Throwing here would take the whole boot down for an optional tuning knob,
    // and the provider is required to stay inert-safe (see medusa-config.ts).
    warn(
      `[skydropx] Ignoring SKYDROPX_GATEWAY_TIMEOUT_MS=${raw}: expected a number ` +
        `of milliseconds >= ${MIN_VIABLE_GATEWAY_TIMEOUT_MS}. ` +
        `Falling back to ${DEFAULT_GATEWAY_TIMEOUT_MS}ms.`
    )
    return DEFAULT_GATEWAY_TIMEOUT_MS
  }
  return parsed
}

/**
 * Assumed edge gateway request timeout — the REAL ceiling on this call.
 *
 * It lives outside this repo (Medusa 2.15 exposes no
 * `projectConfig.http.requestTimeout`), so 60s is a conservative default for a
 * managed platform, overridable without a code change once the deployment
 * target's actual limit is known. Exceeding it is the worst available failure
 * mode: the client sees a 504 while this process keeps going, buys a real label,
 * and orphans it — SD-4 containment never runs, because this process was never
 * the one that gave up.
 */
export const ASSUMED_GATEWAY_TIMEOUT_MS = readGatewayTimeout()
/**
 * Total wall-clock budget for the Skydropx work in ONE `createFulfillment` call,
 * anchored once.
 *
 * Every outbound bound is a SUB-bound of this one, so the worst case is this
 * number by construction rather than a sum that must be recomputed whenever
 * someone touches an individual constant.
 */
export const SKYDROPX_FULFILLMENT_BUDGET_MS =
  Math.floor(ASSUMED_GATEWAY_TIMEOUT_MS * GATEWAY_SAFETY_MARGIN) -
  PRE_ANCHOR_BUDGET_MS -
  SKYDROPX_CANCEL_TIMEOUT_MS
/**
 * Sub-bound: how much of the fulfillment budget the async quote+poll cycle may
 * consume before the label purchase itself is starved. A PRO quotation needs
 * several poll rounds to reach `is_completed` — the 15s per-REQUEST bound that
 * used to be misused here was never sized for a multi-round cycle.
 *
 * Expressed as a share of the anchor rather than a literal so it cannot silently
 * grow past it when the anchor is retuned.
 */
export const LABEL_QUOTE_BUDGET_MS = Math.floor(
  SKYDROPX_FULFILLMENT_BUDGET_MS * LABEL_QUOTE_SHARE
)

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
    // Checkout CYCLE deadline (create + N poll rounds), NOT a per-request bound.
    // The whole quote-and-poll cycle needs ~18s (measured; see client.ts §1.2);
    // the per-request bound stays ~8s inside `quoteAndPoll_`.
    const deadline = Date.now() + SKYDROPX_QUOTE_CYCLE_BUDGET_MS
    const rates = await this.fetchUsableRates_(
      () =>
        client.quoteAndPoll_(
          {
            quotation: {
              address_from: addressFrom,
              address_to: addressTo,
              parcels: [parcel],
            },
          },
          deadline
        ),
      "storefront"
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
      // One anchor for the whole call; every bound below is carved out of it, so
      // the worst case is SKYDROPX_FULFILLMENT_BUDGET_MS and nothing else.
      const fulfillmentDeadline = Date.now() + SKYDROPX_FULFILLMENT_BUDGET_MS
      // The quote gets its own slice: a slow quotation must not eat the budget the
      // label purchase and its polling still need.
      const quoteDeadline = Math.min(
        Date.now() + LABEL_QUOTE_BUDGET_MS,
        fulfillmentDeadline
      )
      const rates = await this.fetchUsableRates_(
        () =>
          client.quoteAndPoll_(
            {
              quotation: {
                address_from: addressFrom,
                address_to: addressTo,
                parcels: [parcel],
              },
            },
            quoteDeadline
          ),
        "admin"
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

      // KNOWN GAP (not closed here): aborting this POST does not undo it
      // server-side. Skydropx can accept the shipment while we see an AbortError,
      // and `shipmentId` is only assigned below, so SD-4 containment cannot even
      // log it for reconciliation. Closing that needs an idempotency key or a
      // post-abort lookup — a design change, not a timeout fix.
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
      }, fulfillmentDeadline)
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
      // Capped by the shared deadline too: LABEL_POLL_BOUND_MS alone bounded the
      // GUARD, not the loop — a getShipment issued at t=29.9s with its own 15s
      // bound resolved the "30s" limit at ~47s.
      const pollStart = Date.now()
      const pollDeadline = Math.min(
        pollStart + LABEL_POLL_BOUND_MS,
        fulfillmentDeadline
      )
      // The bound actually APPLIED, which is not LABEL_POLL_BOUND_MS whenever the
      // shared anchor is the binding constraint — reporting the nominal one would
      // be the same dishonest-timing message this change exists to remove.
      const appliedBound = pollDeadline - pollStart
      let polls = 0
      // The state sequence is the diagnosis: "pending→pending→error" and
      // "pending→pending→pending" are entirely different failures, and the final
      // message is the only place an operator ever sees either of them.
      const observedStatuses: string[] = [shipment.workflowStatus ?? "unknown"]
      // Distinguishes "Skydropx refused the label" (a real failure) from
      // "Skydropx has not finished yet" (normal, and not ours to punish).
      let labelPending = false
      /**
       * Always names the LAST OBSERVED STATE, never just the elapsed time.
       * "not ready after 38000ms" says nothing an operator can act on; the state
       * Skydropx left the shipment in, plus whatever `error_detail` it attached,
       * is the whole diagnosis.
       */
      const notReady = (reason: string) =>
        new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Skydropx shipment ${shipment.id} did not produce a label (${reason}). ` +
            `Last workflow_status=${current.workflowStatus ?? "unknown"}` +
            (current.errorDetail
              ? `, carrier error: ${
                  current.errorDetail.error_message ??
                  current.errorDetail.error_code
                }${
                  current.errorDetail.error_message_detail
                    ? ` — ${current.errorDetail.error_message_detail}`
                    : ""
                }`
              : "") +
            `. Polled ${polls} time(s) over ${Date.now() - pollStart}ms ` +
            `(bound ${appliedBound}ms), states seen: ${observedStatuses.join("→")}. ` +
            `The shipment exists in Skydropx and may need manual reconciliation.`
        )

      // `workflowStatus` comes from `data.attributes` (see `normalizeShipment`).
      while (current.workflowStatus !== LABEL_STATUS_SUCCESS) {
        // A shipment that FAILED is not a shipment that is "still working": polling
        // it again cannot change the answer. Without this, a sandbox label rejected
        // at t=2s burned the entire 38s budget and then reported a timeout, hiding
        // the carrier's actual reason for refusing the label.
        if (isTerminalLabelFailure(current.workflowStatus)) {
          throw notReady(`Skydropx reported a terminal failure state`)
        }

        const remaining = pollDeadline - Date.now()
        // Require enough budget for the poll to actually COMPLETE, not merely to
        // start. Firing a request with 14ms left guarantees an abort, and the
        // caller then gets transport jargon ("only 14ms remained") in place of the
        // shipment state that explains the failure.
        if (remaining < LABEL_POLL_MIN_REQUEST_MS) {
          labelPending = true
          break
        }
        await this.sleep_(Math.min(LABEL_POLL_INTERVAL_MS, remaining))
        if (pollDeadline - Date.now() < LABEL_POLL_MIN_REQUEST_MS) {
          labelPending = true
          break
        }
        current = await client.getShipment(shipment.id, pollDeadline)
        polls += 1
        observedStatuses.push(current.workflowStatus ?? "unknown")
      }

      const trackingNumber =
        current.trackingNumber ?? current.masterTrackingNumber
      const labelUrl = current.labelUrl

      if (labelPending) {
        // NOT an error. Skydropx generates labels asynchronously and can take
        // longer than any HTTP request may reasonably last; a shipment still in a
        // healthy state is progressing normally, and failing here used to destroy
        // a perfectly good shipment by "abandoning" it. The fulfillment is real —
        // it simply has no label YET.
        this.logger_.info(
          `Skydropx shipment ${shipment.id} for order #${order?.display_id} is still ` +
            `${current.workflowStatus ?? "unknown"} after ${polls} poll(s) over ` +
            `${Date.now() - pollStart}ms. The fulfillment was created WITHOUT a label; ` +
            `Skydropx is still generating it. States seen: ${observedStatuses.join("→")}.`
        )
      }

      return {
        data: {
          ...(data ?? {}),
          shipment_id: shipment.id,
          rate_id: rate.id,
          tracking_number: trackingNumber,
          label_url: labelUrl,
          // Marks the fulfillment as awaiting its label, so whatever completes it
          // later (job, webhook, manual refresh) can find it without guessing.
          label_pending: labelPending,
          label_status: current.workflowStatus,
        },
        // No fabricated label: emitting a row of empty strings would show the
        // operator a label that does not exist and cannot be downloaded.
        labels: labelUrl
          ? [
              {
                tracking_number: trackingNumber ?? "",
                tracking_url: "",
                label_url: labelUrl,
              },
            ]
          : [],
      }
    } catch (error) {
      // SD-4: orphaned-shipment best-effort cancel, then surface UNEXPECTED_STATE.
      if (shipmentId) {
        await this.abandonShipment_(client, shipmentId, describeError(error))
      }
      if (error instanceof MedusaError) {
        throw error
      }
      // Logged as well as thrown: the workflow wraps this message, and the raw
      // detail is what makes a carrier-side failure diagnosable at all.
      this.logger_.error(
        `Skydropx label purchase failed for order #${order?.display_id}: ${describeError(error)}`
      )
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
    quote: () => Promise<SkydropxRate[]>,
    audience: RateAudience
  ): Promise<SkydropxRate[]> {
    let rates: SkydropxRate[]
    try {
      rates = await quote()
    } catch (error) {
      const detail = describeError(error)
      // The detail ALWAYS reaches the server log, whoever asked.
      this.logger_.error(`Skydropx quotation failed (${audience}): ${detail}`)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        // ...but it must never reach the storefront. `calculatePrice` is reached
        // from the PUBLIC `POST /store/shipping-options/:id/calculate`, and
        // Medusa's error handler passes UNEXPECTED_STATE messages through to the
        // response verbatim. Echoing an upstream body there would hand any
        // anonymous visitor our internal endpoints, upstream status codes and
        // third-party error payloads.
        audience === "storefront"
          ? "Skydropx could not quote this shipment."
          : `Skydropx quotation failed: ${detail}`
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

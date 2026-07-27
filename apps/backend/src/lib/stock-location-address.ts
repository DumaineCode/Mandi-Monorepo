/**
 * Lazy stock-location (origin address) resolution seam.
 *
 * Same discipline as `./provider-credentials` (admin-provider-settings design
 * §3.1, verified facts F1/F2): the global container is resolved PER OPERATION,
 * never in a constructor — module load order at boot is not guaranteed and
 * unresolved keys register as `undefined` (F2). Everything here is fail-safe:
 * the source NEVER throws; any failure resolves to `null`.
 *
 * Why it exists: the Medusa `Fulfillment` entity carries only `location_id` —
 * there is NO `location` relation, and the fulfillment module hands the raw
 * entity to the provider. A fulfillment provider that needs the origin address
 * (design §4.1, `address_from`) must therefore look the stock location up
 * itself.
 */
import { container } from "@medusajs/framework"
import { MedusaError, Modules } from "@medusajs/framework/utils"

/** Columns of `stock_location_address` (no `email` column exists). */
export interface StockLocationAddressLike {
  address_1?: string | null
  address_2?: string | null
  company?: string | null
  city?: string | null
  country_code?: string | null
  phone?: string | null
  province?: string | null
  postal_code?: string | null
  metadata?: Record<string, unknown> | null
}

export interface StockLocationOrigin {
  /** Stock location name — used as the origin contact name. */
  name?: string
  /** `null` when the location exists but has no address relation. */
  address: StockLocationAddressLike | null
}

/**
 * Sentinel for the one rejection that is NOT an infrastructure failure: the read
 * SUCCEEDED and the stock location definitively does not exist (deleted or stale
 * `location_id`).
 *
 * Deliberately a distinct outcome from `null`: `null` means "the read failed"
 * (module unregistered, container throw, DB error, timeout) and is worth
 * retrying, while this is a DATA condition no retry can ever fix. Collapsing the
 * two pages ops with a 500 for a row that was deleted on purpose.
 */
export const STOCK_LOCATION_NOT_FOUND = "stock-location:not-found" as const
export type StockLocationNotFound = typeof STOCK_LOCATION_NOT_FOUND

/**
 * Injectable source (mirrors `CredentialSource`): tests pass their own.
 *
 * Three outcomes: the origin, {@link STOCK_LOCATION_NOT_FOUND} (location gone),
 * or `null` (the read failed — fail-safe, the source NEVER throws).
 */
export type StockLocationSource = (
  locationId: string
) => Promise<StockLocationOrigin | StockLocationNotFound | null>

/**
 * Structural NOT_FOUND check — structural rather than `instanceof MedusaError` so
 * a rejection crossing a module/realm boundary is still classified correctly.
 */
const isNotFoundError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { type?: unknown }).type === MedusaError.Types.NOT_FOUND

/**
 * Upper bound on a single stock-location read. Bounded for the same reason as
 * credential resolution: a slow-but-up DB must not hang the admin label path.
 * Past it we fail safe to `null` and the caller surfaces a descriptive error.
 */
export const STOCK_LOCATION_RESOLUTION_TIMEOUT_MS = 3_000

/** How often a sustained-timeout condition may log (rate-limited). */
const TIMEOUT_LOG_INTERVAL_MS = 30_000

interface StockLocationReader {
  retrieveStockLocation(
    id: string,
    config?: { relations?: string[] }
  ): Promise<{ name?: string; address?: StockLocationAddressLike | null }>
}

export interface StockLocationSourceOptions {
  /** Resolution timeout in ms (default {@link STOCK_LOCATION_RESOLUTION_TIMEOUT_MS}). */
  timeoutMs?: number
  /** Sink for the rate-limited timeout log (default `console`). */
  logger?: { error(message: string): void }
  /** Clock seam for tests. */
  now?: () => number
}

export function makeStockLocationSource(
  options: StockLocationSourceOptions = {}
): StockLocationSource {
  const timeoutMs = options.timeoutMs ?? STOCK_LOCATION_RESOLUTION_TIMEOUT_MS
  const now = options.now ?? Date.now
  const logger = options.logger ?? console
  let lastTimeoutLogAt = Number.NEGATIVE_INFINITY

  return async (locationId: string) => {
    if (!locationId) {
      return null
    }

    try {
      const service = container.resolve<StockLocationReader | undefined>(
        Modules.STOCK_LOCATION,
        { allowUnregistered: true } as never
      )
      if (!service) {
        return null
      }

      // Race the read against a timeout. `settled` never rejects (late
      // rejections are swallowed) so a timed-out read cannot surface an
      // unhandled rejection.
      const settled = service
        .retrieveStockLocation(locationId, { relations: ["address"] })
        .then(
          (value) => ({
            timedOut: false as const,
            value: value as
              | { name?: string; address?: StockLocationAddressLike | null }
              | StockLocationNotFound
              | null,
          }),
          (error: unknown) => ({
            timedOut: false as const,
            // A NOT_FOUND rejection is a SUCCESSFUL read of a location that is
            // gone — never folded into the retry-oriented `null`.
            value: isNotFoundError(error) ? STOCK_LOCATION_NOT_FOUND : null,
          })
        )

      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<{ timedOut: true }>((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs)
      })

      const outcome = await Promise.race([settled, timeout])
      if (timer) {
        clearTimeout(timer)
      }

      if (outcome.timedOut) {
        const ts = now()
        if (ts - lastTimeoutLogAt >= TIMEOUT_LOG_INTERVAL_MS) {
          lastTimeoutLogAt = ts
          logger.error(
            `[stock-location-address] Origin resolution for stock location ` +
              `"${locationId}" exceeded ${timeoutMs}ms — treating the origin as ` +
              `unresolved (fail-safe).`
          )
        }
        return null
      }

      if (outcome.value === STOCK_LOCATION_NOT_FOUND) {
        return STOCK_LOCATION_NOT_FOUND
      }

      const location = outcome.value
      if (!location) {
        return null
      }

      return {
        name: location.name,
        address: location.address ?? null,
      }
    } catch {
      // Fail-safe: an unresolvable module or a failed read means "no origin",
      // never a crash on the label path.
      return null
    }
  }
}

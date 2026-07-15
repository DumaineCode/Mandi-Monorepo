/**
 * Lazy DB credential resolution seam for always-registered providers
 * (admin-provider-settings design §3.1, verified facts F1/F2).
 *
 * Providers call the returned source PER OPERATION — never in constructors:
 * module load order is not guaranteed and unresolved keys register as
 * `undefined` in the global container (F2). Everything here is fail-safe:
 * a source NEVER throws; any failure resolves to `null` (= unconfigured).
 */
import { container } from "@medusajs/framework"
import { createHash } from "node:crypto"

export type CredentialSource<T> = () => Promise<T | null>

/** Module key of ./src/modules/provider-settings (PROVIDER_SETTINGS_MODULE). */
const PROVIDER_SETTINGS_KEY = "providerSettings"

/**
 * FIX 3 (resilience): upper bound on a single credential resolution.
 *
 * The seam is called PER payment/webhook operation (initiatePayment,
 * authorizePayment, verifyWebhookAuth, quotations). A cache hit is a memory
 * read; only a cache MISS touches the DB. Without a bound, a slow-but-up DB
 * would hang the hot path. A few seconds is generous for a single indexed
 * single-row SELECT + one AES-GCM decrypt; past it we fail safe to `null`
 * (provider resolves unconfigured) exactly like the existing DB-down path.
 */
export const CREDENTIAL_RESOLUTION_TIMEOUT_MS = 3_000

/** How often a sustained-timeout condition may log (secret-free, rate-limited). */
const TIMEOUT_LOG_INTERVAL_MS = 30_000

interface ProviderSettingsReader {
  getResolvedCredentials(provider: string): Promise<unknown | null>
}

export interface DbCredentialSourceOptions {
  /** Resolution timeout in ms (default {@link CREDENTIAL_RESOLUTION_TIMEOUT_MS}). */
  timeoutMs?: number
  /** Sink for the rate-limited, secret-free timeout log (default `console`). */
  logger?: { error(message: string): void }
  /** Clock seam for tests. */
  now?: () => number
}

export function makeDbCredentialSource<T>(
  provider: string,
  options: DbCredentialSourceOptions = {}
): CredentialSource<T> {
  const timeoutMs = options.timeoutMs ?? CREDENTIAL_RESOLUTION_TIMEOUT_MS
  const now = options.now ?? Date.now
  const logger = options.logger ?? console
  // Per-source (per-provider) rate-limit state so a sustained slow DB logs at
  // most once per window instead of on every hot-path call.
  let lastTimeoutLogAt = Number.NEGATIVE_INFINITY

  return async () => {
    try {
      const settings = container.resolve<ProviderSettingsReader | undefined>(
        PROVIDER_SETTINGS_KEY,
        { allowUnregistered: true } as never
      )
      if (!settings) {
        return null
      }

      // Race the read against a timeout. `settled` never rejects (late rejections
      // are swallowed) so a timed-out read can't surface an unhandled rejection.
      const settled = settings.getResolvedCredentials(provider).then(
        (value) => ({ timedOut: false as const, value }),
        () => ({ timedOut: false as const, value: null })
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
            `[provider-credentials] Credential resolution for provider ` +
              `"${provider}" exceeded ${timeoutMs}ms — treating the provider as ` +
              `unconfigured (fail-safe). No secret material is affected.`
          )
        }
        return null
      }

      return (outcome.value as T) ?? null
    } catch {
      // Fail-safe (spec: Fail-Safe Unconfigured Behavior) — resolution errors
      // mean "unconfigured", never a crash on the payment/webhook hot path.
      return null
    }
  }
}

/**
 * Short, key-order-independent hash of resolved credentials. Providers key
 * their immutable client cache on it so a save/rotation rebuilds the client
 * (design §3.2) without ever mutating or logging credential material.
 */
export function credentialFingerprint(value: object): string {
  const record = value as Record<string, unknown>
  const canonical = JSON.stringify(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]])
  )
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16)
}

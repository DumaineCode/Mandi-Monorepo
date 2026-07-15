/**
 * Provider settings module service (design §1.3) + pure collaborators.
 *
 * Per `logic-module-service` the service stays thin: heavy logic lives in
 * `crypto.ts` and in the pure collaborators below, which are exported so
 * unit tests exercise them without the ORM (design §10):
 *
 * - `prepareProviderSettingRow` — upsert write path: encrypt secrets,
 *   compute `secret_hints` at write time, derive `sandbox` from mode.
 *   Consumed by the slice-2 `encrypt-and-upsert-provider-setting` workflow
 *   step and the slice-6 env seed.
 * - `CredentialResolver` — read path behind `getResolvedCredentials`:
 *   cache-aware (save-triggered invalidation + TTL backstop, design §3.3),
 *   fail-safe (`null` on: no row, disabled, no secrets, decrypt failure).
 *   NEVER throws on the read path.
 */
import { MedusaService } from "@medusajs/framework/utils"

import {
  createProviderSettingsCrypto,
  type ProviderSettingsCrypto,
} from "./crypto"
import ProviderSetting from "./models/provider-setting"
import {
  SANDBOX_FLAG_PROVIDERS,
  SKYDROPX_DEFAULT_BASE_URL,
  type ProviderMode,
  type ProviderSettingsModuleOptions,
  type ResolvedProviderConfig,
  type SecretHints,
} from "./types"

/** Minimum plaintext length before a last-4 hint is stored (spec: masked reads). */
const LAST4_MIN_LENGTH = 8

/** Default credential cache TTL backstop (design §3.3). */
const DEFAULT_TTL_MS = 30_000

interface ResolverLogger {
  error(message: string): void
}

/** The subset of a provider_setting row the pure collaborators need. */
export interface ProviderSettingRowLike {
  provider: string
  mode: string
  is_enabled: boolean
  public_config: Record<string, unknown> | null
  encrypted_secrets: string | null
  secret_hints: SecretHints | null
}

export interface PrepareProviderSettingInput {
  provider: string
  mode: ProviderMode
  isEnabled?: boolean
  publicConfig: Record<string, unknown> | null
  secrets: Record<string, string>
}

export interface PreparedProviderSettingRow {
  provider: string
  mode: ProviderMode
  is_enabled: boolean
  public_config: Record<string, unknown> | null
  encrypted_secrets: string | null
  secret_hints: SecretHints | null
}

/**
 * Builds the persistable row for an upsert: encrypts ALL secret fields into
 * one envelope, computes `secret_hints` (write-time masking metadata), and
 * derives the `sandbox` flag from `mode` for providers that expose it.
 * Throws when the KEK is invalid (write path must fail loudly).
 */
export function prepareProviderSettingRow(
  crypto: ProviderSettingsCrypto,
  input: PrepareProviderSettingInput
): PreparedProviderSettingRow {
  const hints: SecretHints = {}
  for (const [field, value] of Object.entries(input.secrets)) {
    hints[field] = {
      last4: value.length >= LAST4_MIN_LENGTH ? value.slice(-4) : null,
      set: true,
    }
  }

  const publicConfig = input.publicConfig ? { ...input.publicConfig } : null
  const derived =
    SANDBOX_FLAG_PROVIDERS.includes(input.provider) && publicConfig
      ? { ...publicConfig, sandbox: input.mode !== "production" }
      : publicConfig

  return {
    provider: input.provider,
    mode: input.mode,
    is_enabled: input.isEnabled ?? true,
    public_config: derived,
    encrypted_secrets: crypto.encryptSecrets(input.provider, input.secrets),
    secret_hints: hints,
  }
}

/**
 * Merges a row's public_config with its decrypted secrets into the exact
 * options shape each provider consumes today (design §1.1/§9).
 */
function mergeResolvedConfig(
  provider: string,
  row: ProviderSettingRowLike,
  secrets: Record<string, string>,
  env: Record<string, string | undefined>
): ResolvedProviderConfig {
  const publicConfig = row.public_config ?? {}
  const merged: Record<string, unknown> = { ...publicConfig, ...secrets }

  if (provider === "skydropx" && merged.baseUrl === undefined) {
    merged.baseUrl = SKYDROPX_DEFAULT_BASE_URL
  }

  if (provider === "mercadopago") {
    // backendUrl is env-mapped at resolution time — NOT stored (design §9).
    merged.backendUrl = env.BACKEND_PUBLIC_URL
  }

  return merged as unknown as ResolvedProviderConfig
}

export interface CredentialResolverOptions {
  readRow: (provider: string) => Promise<ProviderSettingRowLike | null>
  crypto: ProviderSettingsCrypto
  /** TTL backstop in ms; 0 disables caching (tests). */
  ttlMs: number
  logger?: ResolverLogger
  now?: () => number
  /** Env source for resolution-time mappings (tests pass explicit objects). */
  env?: Record<string, string | undefined>
}

/**
 * Cache-aware, fail-safe credential resolution (design §1.3/§3.3).
 * Null results are cached too, which rate-limits decrypt-failure logging to
 * once per TTL window.
 */
export class CredentialResolver {
  private readonly cache_ = new Map<
    string,
    { value: ResolvedProviderConfig | null; expiresAt: number }
  >()

  constructor(private readonly options_: CredentialResolverOptions) {}

  private now_(): number {
    return this.options_.now?.() ?? Date.now()
  }

  async resolve(provider: string): Promise<ResolvedProviderConfig | null> {
    const { ttlMs } = this.options_

    if (ttlMs > 0) {
      const cached = this.cache_.get(provider)
      if (cached && cached.expiresAt > this.now_()) {
        return cached.value
      }
    }

    const value = await this.resolveUncached_(provider)

    if (ttlMs > 0) {
      this.cache_.set(provider, { value, expiresAt: this.now_() + ttlMs })
    }

    return value
  }

  invalidate(provider?: string): void {
    if (provider) {
      this.cache_.delete(provider)
    } else {
      this.cache_.clear()
    }
  }

  private async resolveUncached_(
    provider: string
  ): Promise<ResolvedProviderConfig | null> {
    const row = await this.options_.readRow(provider)

    if (!row || !row.is_enabled || !row.encrypted_secrets) {
      return null
    }

    const secrets = this.options_.crypto.decryptSecrets(
      provider,
      row.encrypted_secrets
    )

    if (secrets === null) {
      this.options_.logger?.error(
        `[provider-settings] Failed to decrypt stored secrets for provider ` +
          `"${provider}" (wrong KEK or corrupt ciphertext) — treating the ` +
          `provider as unconfigured.`
      )
      return null
    }

    return mergeResolvedConfig(
      provider,
      row,
      secrets,
      this.options_.env ?? {}
    )
  }
}

type InjectedDependencies = {
  logger?: ResolverLogger
}

class ProviderSettingsModuleService extends MedusaService({
  ProviderSetting,
}) {
  private readonly resolver_: CredentialResolver

  constructor(
    container: InjectedDependencies,
    options: ProviderSettingsModuleOptions = {}
  ) {
    // eslint-disable-next-line prefer-rest-params
    super(...arguments)

    const crypto = createProviderSettingsCrypto(
      options.encryptionKey ?? process.env.PROVIDER_SETTINGS_ENCRYPTION_KEY,
      container.logger
    )

    this.resolver_ = new CredentialResolver({
      readRow: async (provider) => {
        const [row] = await this.listProviderSettings(
          { provider },
          { take: 1 }
        )
        return (row as unknown as ProviderSettingRowLike) ?? null
      },
      crypto,
      ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
      logger: container.logger,
      env: process.env,
    })
  }

  /**
   * Cache-aware read → decrypt → merge public_config. Returns `null` when:
   * no row, `is_enabled=false`, no secrets, decrypt failure (logged), or
   * invalid KEK. NEVER throws on the read path (design §1.3).
   */
  async getResolvedCredentials(
    provider: string
  ): Promise<ResolvedProviderConfig | null> {
    return this.resolver_.resolve(provider)
  }

  /** Called by upsert/delete workflow steps (slice 2) after mutations. */
  invalidateCredentialCache(provider?: string): void {
    this.resolver_.invalidate(provider)
  }
}

export default ProviderSettingsModuleService

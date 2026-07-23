/**
 * Pure env-seed core (design §8, spec "One-Time Idempotent Env Seed").
 *
 * Zero framework/container imports so it runs under `pnpm test:unit`. The thin
 * `medusa exec` wrapper (`seed-provider-settings.ts`) resolves the loaded
 * container's `providerSettings` service + logger and delegates here.
 *
 * Contract:
 * - Reads provider env vars ONCE (mirroring today's `providerEnvReady` gating).
 * - Seeds a provider ONLY when no `provider_setting` row exists for it AND its
 *   full required env set is present — idempotent, admin edits are preserved.
 * - Partial env set → WARN naming the missing vars, no partial row written.
 * - Absent env set → quietly skipped (not a misconfiguration).
 * - Reuses the slice-1 crypto seam + `prepareProviderSettingRow` (encrypt +
 *   write-time secret_hints + mode-derived sandbox) — never re-implements crypto.
 * - Logs one outcome line per provider + a final summary. NO secret value is
 *   ever logged or written as plaintext.
 */
import {
  createProviderSettingsCrypto,
  type ProviderSettingsCrypto,
} from "../modules/provider-settings/crypto"
import {
  prepareProviderSettingRow,
  type PreparedProviderSettingRow,
} from "../modules/provider-settings/service"
import type { ProviderMode } from "../modules/provider-settings/types"

type Env = Record<string, string | undefined>

export interface SeedLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** The narrow slice of the settings service the seed needs (ORM-free in tests). */
export interface SeedSettingsService {
  listProviderSettings(
    filter: { provider: string },
    config?: { take?: number }
  ): Promise<Array<{ provider: string }>>
  createProviderSettings(
    data: PreparedProviderSettingRow
  ): Promise<unknown>
}

export type SeedOutcome =
  | "seeded"
  | "skipped-existing"
  | "skipped-incomplete"
  | "skipped-absent"

export interface ProviderSeedResult {
  provider: string
  outcome: SeedOutcome
  /** Env vars that were required but absent (only for `skipped-incomplete`). */
  missing?: string[]
}

/**
 * Per-provider env→settings mapping. `requiredEnv` mirrors today's
 * `providerEnvReady` gating exactly; `secretEnv`/`publicEnv` map DB fields to
 * their env source. Only listed fields are read — no env is consulted elsewhere.
 */
interface ProviderEnvMapping {
  provider: string
  requiredEnv: string[]
  /** DB secret field → env var name. */
  secretEnv: Record<string, string>
  /** DB public_config field → env var name (included only when present). */
  publicEnv: Record<string, string>
  /** Derives the active mode from env (defaults to sandbox). */
  mode(env: Env): ProviderMode
  /** Optional per-field coercion for public_config values (e.g. booleans). */
  coerce?: Record<string, (raw: string) => unknown>
}

const PROVIDER_MAPPINGS: ProviderEnvMapping[] = [
  {
    provider: "openpay",
    requiredEnv: [
      "OPENPAY_MERCHANT_ID",
      "OPENPAY_PRIVATE_KEY",
      "OPENPAY_WEBHOOK_USER",
      "OPENPAY_WEBHOOK_PASSWORD",
    ],
    secretEnv: {
      privateKey: "OPENPAY_PRIVATE_KEY",
      webhookUser: "OPENPAY_WEBHOOK_USER",
      webhookPassword: "OPENPAY_WEBHOOK_PASSWORD",
    },
    publicEnv: {
      merchantId: "OPENPAY_MERCHANT_ID",
      publicKey: "OPENPAY_PUBLIC_KEY",
    },
    // Mirrors medusa-config's `sandbox = OPENPAY_SANDBOX !== 'false'`.
    mode: (env) =>
      env.OPENPAY_SANDBOX === "false" ? "production" : "sandbox",
  },
  {
    provider: "skydropx",
    requiredEnv: [
      "SKYDROPX_CLIENT_ID",
      "SKYDROPX_CLIENT_SECRET",
      "SKYDROPX_ORIGIN_ZIP",
    ],
    secretEnv: {
      clientId: "SKYDROPX_CLIENT_ID",
      clientSecret: "SKYDROPX_CLIENT_SECRET",
    },
    publicEnv: {
      originZip: "SKYDROPX_ORIGIN_ZIP",
      baseUrl: "SKYDROPX_BASE_URL",
      taxInclusive: "SKYDROPX_TAX_INCLUSIVE",
      consignmentNote: "SKYDROPX_CONSIGNMENT_NOTE",
      packageType: "SKYDROPX_PACKAGE_TYPE",
    },
    // Skydropx has no sandbox/production concept today — single mode.
    mode: () => "sandbox",
    coerce: {
      // Service default is tax-inclusive (`config.taxInclusive ?? true`); an
      // explicit "false" opts out.
      taxInclusive: (raw) => raw !== "false",
    },
  },
  {
    provider: "mercadopago",
    requiredEnv: ["MP_ACCESS_TOKEN", "MP_WEBHOOK_SECRET", "BACKEND_PUBLIC_URL"],
    secretEnv: {
      accessToken: "MP_ACCESS_TOKEN",
      webhookSecret: "MP_WEBHOOK_SECRET",
    },
    // backendUrl is env-mapped at runtime (design §9) — NOT stored here.
    publicEnv: { publicKey: "MP_PUBLIC_KEY" },
    mode: () => "sandbox",
  },
]

function present(env: Env, key: string): boolean {
  const value = env[key]
  return typeof value === "string" && value.length > 0
}

function buildSecrets(
  env: Env,
  mapping: ProviderEnvMapping
): Record<string, string> {
  const secrets: Record<string, string> = {}
  for (const [field, envKey] of Object.entries(mapping.secretEnv)) {
    const value = env[envKey]
    if (typeof value === "string" && value.length > 0) {
      secrets[field] = value
    }
  }
  return secrets
}

function buildPublicConfig(
  env: Env,
  mapping: ProviderEnvMapping
): Record<string, unknown> | null {
  const config: Record<string, unknown> = {}
  for (const [field, envKey] of Object.entries(mapping.publicEnv)) {
    const raw = env[envKey]
    if (typeof raw === "string" && raw.length > 0) {
      config[field] = mapping.coerce?.[field] ? mapping.coerce[field](raw) : raw
    }
  }
  return Object.keys(config).length > 0 ? config : null
}

async function seedProvider(
  service: SeedSettingsService,
  crypto: ProviderSettingsCrypto,
  env: Env,
  mapping: ProviderEnvMapping,
  logger: SeedLogger
): Promise<ProviderSeedResult> {
  const { provider } = mapping

  const existing = await service.listProviderSettings({ provider }, { take: 1 })
  if (existing.length > 0) {
    logger.info(`[seed-provider-settings] ${provider}: skipped-existing (a settings row already exists; admin edits preserved).`)
    return { provider, outcome: "skipped-existing" }
  }

  const missing = mapping.requiredEnv.filter((key) => !present(env, key))

  if (missing.length === mapping.requiredEnv.length) {
    logger.info(`[seed-provider-settings] ${provider}: skipped-absent (no env vars set).`)
    return { provider, outcome: "skipped-absent" }
  }

  if (missing.length > 0) {
    logger.warn(`[seed-provider-settings] ${provider}: skipped-incomplete — missing required env var(s): ${missing.join(", ")}. Not seeded (no partial row written).`)
    return { provider, outcome: "skipped-incomplete", missing }
  }

  const rowData = prepareProviderSettingRow(crypto, {
    provider,
    mode: mapping.mode(env),
    publicConfig: buildPublicConfig(env, mapping),
    secrets: buildSecrets(env, mapping),
  })

  await service.createProviderSettings(rowData)
  logger.info(`[seed-provider-settings] ${provider}: seeded (mode=${rowData.mode}, encrypted; secrets never logged).`)
  return { provider, outcome: "seeded" }
}

/**
 * Imports provider env vars into encrypted DB settings once. Idempotent and
 * safe to run on every deploy. Throws before touching anything when the KEK is
 * missing/invalid (the write path must fail loudly, never store plaintext).
 */
export async function seedFromEnv(
  service: SeedSettingsService,
  env: Env,
  logger: SeedLogger
): Promise<ProviderSeedResult[]> {
  const crypto = createProviderSettingsCrypto(env.PROVIDER_SETTINGS_ENCRYPTION_KEY)

  if (!crypto.kekValid) {
    throw new Error(
      "[seed-provider-settings] PROVIDER_SETTINGS_ENCRYPTION_KEY is missing or " +
        "invalid (must be base64 or hex decoding to exactly 32 bytes). Cannot " +
        "seed encrypted provider settings; aborting without writing anything."
    )
  }

  const results: ProviderSeedResult[] = []
  for (const mapping of PROVIDER_MAPPINGS) {
    results.push(await seedProvider(service, crypto, env, mapping, logger))
  }

  const counts = results.reduce<Record<SeedOutcome, number>>(
    (acc, r) => {
      acc[r.outcome] += 1
      return acc
    },
    {
      seeded: 0,
      "skipped-existing": 0,
      "skipped-incomplete": 0,
      "skipped-absent": 0,
    }
  )

  logger.info(
    `[seed-provider-settings] summary: ${counts.seeded} seeded, ` +
      `${counts["skipped-existing"]} skipped-existing, ` +
      `${counts["skipped-incomplete"]} skipped-incomplete, ` +
      `${counts["skipped-absent"]} skipped-absent.`
  )

  return results
}

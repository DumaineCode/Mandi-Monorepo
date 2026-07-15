/**
 * Unit tests for the pure env-seed core (task 6.1, spec "One-Time Idempotent
 * Env Seed"). Exercises the ORM-free `seedFromEnv` with a fake settings service,
 * an explicit env object, and a capturing logger — no framework, no container.
 *
 * Pinned behavior:
 * - full env set → seeded (encrypted envelope, mode from OPENPAY_SANDBOX,
 *   public fields in public_config, secrets never plaintext in the row);
 * - partial set → skipped-incomplete + WARN naming the missing env vars, no row;
 * - absent set → skipped-absent, no warning noise;
 * - existing row → skipped-existing (admin edits preserved), no create call;
 * - per-provider outcome lines + a final summary;
 * - NO secret value ever appears in any log call or in a persisted row's
 *   plaintext (success criterion #2 for the seed).
 */
import { createProviderSettingsCrypto } from "../../modules/provider-settings/crypto"
import {
  seedFromEnv,
  type SeedLogger,
  type SeedSettingsService,
} from "../seed-provider-settings.core"

// Deterministic 32-byte KEK (ASCII → base64) — same construction as setup.js.
const TEST_KEK = Buffer.from("0123456789abcdef0123456789abcdef").toString(
  "base64"
)

const OPENPAY_PRIVATE = "sk_openpay_private_abcd"
const OPENPAY_WH_PASS = "whpass_secret_1234"
const OPENPAY_WH_USER = "whuser_secret"
const SKYDROPX_KEY = "sky_apikey_secret_9999"
const MP_TOKEN = "mp_token_secret_5678"
const MP_WH_SECRET = "mp_whsecret_secret_val"

const ALL_SECRET_VALUES = [
  OPENPAY_PRIVATE,
  OPENPAY_WH_PASS,
  OPENPAY_WH_USER,
  SKYDROPX_KEY,
  MP_TOKEN,
  MP_WH_SECRET,
]

function fullEnv(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    PROVIDER_SETTINGS_ENCRYPTION_KEY: TEST_KEK,
    OPENPAY_MERCHANT_ID: "mid_123",
    OPENPAY_PRIVATE_KEY: OPENPAY_PRIVATE,
    OPENPAY_PUBLIC_KEY: "pk_openpay_public",
    OPENPAY_SANDBOX: "true",
    OPENPAY_WEBHOOK_USER: OPENPAY_WH_USER,
    OPENPAY_WEBHOOK_PASSWORD: OPENPAY_WH_PASS,
    SKYDROPX_API_KEY: SKYDROPX_KEY,
    SKYDROPX_ORIGIN_ZIP: "11000",
    SKYDROPX_BASE_URL: "https://api.skydropx.com/v1",
    SKYDROPX_TAX_INCLUSIVE: "true",
    MP_ACCESS_TOKEN: MP_TOKEN,
    MP_WEBHOOK_SECRET: MP_WH_SECRET,
    MP_PUBLIC_KEY: "mp_pubkey",
    BACKEND_PUBLIC_URL: "https://backend.example.com",
    ...overrides,
  }
}

interface CreatedRow {
  provider: string
  mode: string
  is_enabled: boolean
  public_config: Record<string, unknown> | null
  encrypted_secrets: string | null
  secret_hints: Record<string, unknown> | null
}

function makeService(
  existing: Record<string, boolean> = {}
): SeedSettingsService & { created: CreatedRow[] } {
  const created: CreatedRow[] = []
  return {
    created,
    async listProviderSettings(filter: { provider: string }) {
      return existing[filter.provider]
        ? [{ provider: filter.provider }]
        : []
    },
    async createProviderSettings(data: CreatedRow) {
      created.push(data)
      return { id: `ps_${data.provider}`, ...data }
    },
  }
}

interface CapturingLogger extends SeedLogger {
  all: string[]
  info: jest.Mock
  warn: jest.Mock
  error: jest.Mock
}

function makeLogger(): CapturingLogger {
  const all: string[] = []
  const mk = () =>
    jest.fn((msg: string) => {
      all.push(msg)
    })
  return { all, info: mk(), warn: mk(), error: mk() }
}

describe("seedFromEnv", () => {
  it("seeds all three providers from a full env set with no existing rows", async () => {
    const service = makeService()
    const logger = makeLogger()

    const results = await seedFromEnv(service, fullEnv(), logger)

    expect(service.created).toHaveLength(3)
    const providers = service.created.map((r) => r.provider).sort()
    expect(providers).toEqual(["mercadopago", "openpay", "skydropx"])
    expect(results.every((r) => r.outcome === "seeded")).toBe(true)
  })

  it("encrypts secrets into a pset envelope and never persists plaintext", async () => {
    const service = makeService()
    await seedFromEnv(service, fullEnv(), makeLogger())

    const crypto = createProviderSettingsCrypto(TEST_KEK)
    const openpay = service.created.find((r) => r.provider === "openpay")!

    expect(openpay.encrypted_secrets).toMatch(/^pset\.v1\./)

    // No plaintext secret survives anywhere in the serialized row.
    const serialized = JSON.stringify(openpay)
    for (const secret of ALL_SECRET_VALUES) {
      expect(serialized).not.toContain(secret)
    }

    // Round-trips back to the exact secret set.
    const decrypted = crypto.decryptSecrets("openpay", openpay.encrypted_secrets!)
    expect(decrypted).toEqual({
      privateKey: OPENPAY_PRIVATE,
      webhookUser: OPENPAY_WH_USER,
      webhookPassword: OPENPAY_WH_PASS,
    })
  })

  it("puts only non-secret fields in public_config and derives sandbox from mode", async () => {
    const service = makeService()
    await seedFromEnv(service, fullEnv({ OPENPAY_SANDBOX: "true" }), makeLogger())

    const openpay = service.created.find((r) => r.provider === "openpay")!
    expect(openpay.mode).toBe("sandbox")
    expect(openpay.public_config).toEqual({
      merchantId: "mid_123",
      publicKey: "pk_openpay_public",
      sandbox: true,
    })
    expect(JSON.stringify(openpay.public_config)).not.toContain(OPENPAY_PRIVATE)
  })

  it("derives production mode when OPENPAY_SANDBOX is 'false'", async () => {
    const service = makeService()
    await seedFromEnv(service, fullEnv({ OPENPAY_SANDBOX: "false" }), makeLogger())

    const openpay = service.created.find((r) => r.provider === "openpay")!
    expect(openpay.mode).toBe("production")
    expect((openpay.public_config as { sandbox: boolean }).sandbox).toBe(false)
  })

  it("maps skydropx originZip/baseUrl/taxInclusive into public_config", async () => {
    const service = makeService()
    await seedFromEnv(service, fullEnv(), makeLogger())

    const skydropx = service.created.find((r) => r.provider === "skydropx")!
    expect(skydropx.public_config).toEqual({
      originZip: "11000",
      baseUrl: "https://api.skydropx.com/v1",
      taxInclusive: true,
    })
    const decrypted = createProviderSettingsCrypto(TEST_KEK).decryptSecrets(
      "skydropx",
      skydropx.encrypted_secrets!
    )
    expect(decrypted).toEqual({ apiKey: SKYDROPX_KEY })
  })

  it("skips a provider whose env set is partial and WARNs with the missing names", async () => {
    const service = makeService()
    const logger = makeLogger()

    // Openpay: merchant + private present, webhook creds missing → partial.
    const env = fullEnv({
      OPENPAY_WEBHOOK_USER: undefined,
      OPENPAY_WEBHOOK_PASSWORD: undefined,
    })
    const results = await seedFromEnv(service, env, logger)

    const openpayResult = results.find((r) => r.provider === "openpay")!
    expect(openpayResult.outcome).toBe("skipped-incomplete")
    expect(service.created.find((r) => r.provider === "openpay")).toBeUndefined()

    const warnMsg = logger.warn.mock.calls.map((c) => c[0]).join(" ")
    expect(warnMsg).toContain("OPENPAY_WEBHOOK_USER")
    expect(warnMsg).toContain("OPENPAY_WEBHOOK_PASSWORD")
    // Present-but-not-missing vars are not listed as missing.
    expect(warnMsg).not.toContain("OPENPAY_MERCHANT_ID")
  })

  it("skips a provider with no env at all as skipped-absent without warning", async () => {
    const service = makeService()
    const logger = makeLogger()

    const env = fullEnv({
      SKYDROPX_API_KEY: undefined,
      SKYDROPX_ORIGIN_ZIP: undefined,
    })
    const results = await seedFromEnv(service, env, logger)

    const skydropx = results.find((r) => r.provider === "skydropx")!
    expect(skydropx.outcome).toBe("skipped-absent")
    expect(service.created.find((r) => r.provider === "skydropx")).toBeUndefined()
    // Absent is not a misconfiguration → no WARN for skydropx absence.
    const warnMsg = logger.warn.mock.calls.map((c) => c[0]).join(" ")
    expect(warnMsg).not.toContain("SKYDROPX_API_KEY")
  })

  it("preserves an existing row as skipped-existing without creating a duplicate", async () => {
    const service = makeService({ openpay: true })
    const logger = makeLogger()

    const results = await seedFromEnv(service, fullEnv(), logger)

    const openpay = results.find((r) => r.provider === "openpay")!
    expect(openpay.outcome).toBe("skipped-existing")
    expect(service.created.find((r) => r.provider === "openpay")).toBeUndefined()
    // Idempotent re-run: the other two still seed on first run.
    expect(service.created.map((r) => r.provider).sort()).toEqual([
      "mercadopago",
      "skydropx",
    ])
  })

  it("logs a per-provider outcome line and a final summary", async () => {
    const service = makeService()
    const logger = makeLogger()

    await seedFromEnv(service, fullEnv(), logger)

    // One info line per provider naming its outcome, plus a summary.
    const infoText = logger.info.mock.calls.map((c) => c[0]).join("\n")
    expect(infoText).toMatch(/openpay/)
    expect(infoText).toMatch(/skydropx/)
    expect(infoText).toMatch(/mercadopago/)
    expect(infoText.toLowerCase()).toContain("seed")
    expect(infoText.toLowerCase()).toMatch(/summary|seeded 3|3 seeded/)
  })

  it("never leaks a secret value in any log call", async () => {
    const service = makeService()
    const logger = makeLogger()

    // Mix of seeded, partial, and existing to exercise every log branch.
    const env = fullEnv({ MP_ACCESS_TOKEN: undefined })
    await seedFromEnv(makeService({ skydropx: true }), env, logger)
    await seedFromEnv(service, fullEnv(), logger)

    for (const line of logger.all) {
      for (const secret of ALL_SECRET_VALUES) {
        expect(line).not.toContain(secret)
      }
    }
  })

  it("throws a clear error when the KEK is missing or invalid (write path fails loudly)", async () => {
    const service = makeService()
    const env = fullEnv({ PROVIDER_SETTINGS_ENCRYPTION_KEY: "not-a-valid-kek" })

    await expect(seedFromEnv(service, env, makeLogger())).rejects.toThrow(
      /PROVIDER_SETTINGS_ENCRYPTION_KEY/
    )
    expect(service.created).toHaveLength(0)
  })

  it("seeds mercadopago secrets/public without storing backendUrl", async () => {
    const service = makeService()
    await seedFromEnv(service, fullEnv(), makeLogger())

    const mp = service.created.find((r) => r.provider === "mercadopago")!
    expect(mp.public_config).toEqual({ publicKey: "mp_pubkey", sandbox: true })
    const decrypted = createProviderSettingsCrypto(TEST_KEK).decryptSecrets(
      "mercadopago",
      mp.encrypted_secrets!
    )
    expect(decrypted).toEqual({
      accessToken: MP_TOKEN,
      webhookSecret: MP_WH_SECRET,
    })
    // backendUrl is env-mapped at runtime, never persisted.
    expect(JSON.stringify(mp)).not.toContain("backend.example.com")
  })
})

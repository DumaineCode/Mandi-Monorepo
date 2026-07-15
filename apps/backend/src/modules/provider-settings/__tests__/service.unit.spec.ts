/**
 * Slice 1 (task 1.4) — provider-settings service unit tests.
 *
 * Per design §10, cache + crypto composition is isolated in pure
 * collaborators exported from service.ts so units never need the ORM:
 * - `prepareProviderSettingRow` — the upsert write path: encrypts secrets,
 *   computes `secret_hints` at write time, derives `sandbox` from mode.
 * - `CredentialResolver` — the read path behind `getResolvedCredentials`:
 *   cache-aware, fail-safe (null on: no row, disabled, no secrets, decrypt
 *   failure), never throws.
 */
import { createProviderSettingsCrypto } from "../crypto"
import {
  CredentialResolver,
  prepareProviderSettingRow,
  type ProviderSettingRowLike,
} from "../service"

const KEK = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
const cryptoSeam = createProviderSettingsCrypto(KEK)

const OPENPAY_SECRETS = {
  privateKey: "sk_test_private_key_1234",
  webhookUser: "hook_user_abcd",
  webhookPassword: "shrt",
}

const OPENPAY_PUBLIC = {
  merchantId: "m_test_123",
  publicKey: "pk_test_public_5678",
}

const makeLogger = () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
})

const makeRow = (
  overrides: Partial<ProviderSettingRowLike> = {}
): ProviderSettingRowLike => ({
  provider: "openpay",
  mode: "sandbox",
  is_enabled: true,
  public_config: { ...OPENPAY_PUBLIC, sandbox: true },
  encrypted_secrets: cryptoSeam.encryptSecrets("openpay", OPENPAY_SECRETS),
  secret_hints: null,
  ...overrides,
})

describe("prepareProviderSettingRow (upsert write path)", () => {
  it("encrypts secrets into the versioned envelope and persists no plaintext", () => {
    const row = prepareProviderSettingRow(cryptoSeam, {
      provider: "openpay",
      mode: "sandbox",
      publicConfig: OPENPAY_PUBLIC,
      secrets: OPENPAY_SECRETS,
    })

    expect(row.encrypted_secrets).toMatch(/^pset\.v1\./)
    expect(
      cryptoSeam.decryptSecrets("openpay", row.encrypted_secrets!)
    ).toEqual(OPENPAY_SECRETS)

    // Success criterion #2 pin: no secret plaintext anywhere in the row.
    const serialized = JSON.stringify(row)
    for (const value of Object.values(OPENPAY_SECRETS)) {
      expect(serialized).not.toContain(value)
    }
  })

  it("computes secret_hints at write time: last4 for secrets ≥ 8 chars, null otherwise", () => {
    const row = prepareProviderSettingRow(cryptoSeam, {
      provider: "openpay",
      mode: "sandbox",
      publicConfig: OPENPAY_PUBLIC,
      secrets: OPENPAY_SECRETS,
    })

    expect(row.secret_hints).toEqual({
      privateKey: { last4: "1234", set: true },
      webhookUser: { last4: "abcd", set: true },
      // "shrt" is < 8 chars → fully masked, no last4 leak.
      webhookPassword: { last4: null, set: true },
    })
  })

  it("derives the sandbox flag in public_config from mode", () => {
    const sandbox = prepareProviderSettingRow(cryptoSeam, {
      provider: "openpay",
      mode: "sandbox",
      publicConfig: OPENPAY_PUBLIC,
      secrets: OPENPAY_SECRETS,
    })
    const production = prepareProviderSettingRow(cryptoSeam, {
      provider: "openpay",
      mode: "production",
      publicConfig: OPENPAY_PUBLIC,
      secrets: OPENPAY_SECRETS,
    })

    expect(sandbox.public_config).toMatchObject({ sandbox: true })
    expect(production.public_config).toMatchObject({ sandbox: false })
    expect(sandbox.mode).toBe("sandbox")
    expect(production.mode).toBe("production")
  })

  it("defaults is_enabled to true and honors an explicit false", () => {
    const on = prepareProviderSettingRow(cryptoSeam, {
      provider: "skydropx",
      mode: "production",
      publicConfig: { originZip: "64000" },
      secrets: { apiKey: "sky_live_key_9876" },
    })
    const off = prepareProviderSettingRow(cryptoSeam, {
      provider: "skydropx",
      mode: "production",
      isEnabled: false,
      publicConfig: { originZip: "64000" },
      secrets: { apiKey: "sky_live_key_9876" },
    })

    expect(on.is_enabled).toBe(true)
    expect(off.is_enabled).toBe(false)
  })
})

describe("CredentialResolver (read path — fail-safe, cache-aware)", () => {
  const makeResolver = (opts: {
    row?: ProviderSettingRowLike | null
    readRow?: jest.Mock
    ttlMs?: number
    now?: () => number
    env?: Record<string, string | undefined>
    logger?: ReturnType<typeof makeLogger>
  }) => {
    const readRow =
      opts.readRow ?? jest.fn(async () => opts.row ?? null)
    const logger = opts.logger ?? makeLogger()
    const resolver = new CredentialResolver({
      readRow,
      crypto: cryptoSeam,
      ttlMs: opts.ttlMs ?? 0,
      logger,
      now: opts.now,
      env: opts.env ?? {},
    })
    return { resolver, readRow, logger }
  }

  it("returns null when no row exists", async () => {
    const { resolver } = makeResolver({ row: null })
    expect(await resolver.resolve("openpay")).toBeNull()
  })

  it("returns null when the row is disabled (kill-switch)", async () => {
    const { resolver } = makeResolver({ row: makeRow({ is_enabled: false }) })
    expect(await resolver.resolve("openpay")).toBeNull()
  })

  it("returns null when the row has no stored secrets", async () => {
    const { resolver } = makeResolver({
      row: makeRow({ encrypted_secrets: null }),
    })
    expect(await resolver.resolve("openpay")).toBeNull()
  })

  it("returns null and logs on decrypt failure — never throws", async () => {
    const tampered = makeRow()
    tampered.encrypted_secrets =
      tampered.encrypted_secrets!.slice(0, -4) + "AAAA"
    const { resolver, logger } = makeResolver({ row: tampered })

    expect(await resolver.resolve("openpay")).toBeNull()
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(String(logger.error.mock.calls[0][0])).toContain("openpay")
  })

  it("resolves the merged provider config (public_config + decrypted secrets)", async () => {
    const { resolver } = makeResolver({ row: makeRow() })

    expect(await resolver.resolve("openpay")).toEqual({
      merchantId: "m_test_123",
      publicKey: "pk_test_public_5678",
      sandbox: true,
      privateKey: "sk_test_private_key_1234",
      webhookUser: "hook_user_abcd",
      webhookPassword: "shrt",
    })
  })

  it("maps mercadopago backendUrl from env at resolution time (never stored)", async () => {
    const row: ProviderSettingRowLike = {
      provider: "mercadopago",
      mode: "sandbox",
      is_enabled: true,
      public_config: { publicKey: "APP_USR-pk", sandbox: true },
      encrypted_secrets: cryptoSeam.encryptSecrets("mercadopago", {
        accessToken: "APP_USR-token-1234",
        webhookSecret: "whsec_mp_5678",
      }),
      secret_hints: null,
    }
    const { resolver } = makeResolver({
      row,
      env: { BACKEND_PUBLIC_URL: "https://backend.example.com" },
    })

    expect(await resolver.resolve("mercadopago")).toEqual({
      publicKey: "APP_USR-pk",
      sandbox: true,
      accessToken: "APP_USR-token-1234",
      webhookSecret: "whsec_mp_5678",
      backendUrl: "https://backend.example.com",
    })
  })

  it("defaults the skydropx baseUrl when public_config omits it", async () => {
    const row: ProviderSettingRowLike = {
      provider: "skydropx",
      mode: "production",
      is_enabled: true,
      public_config: { originZip: "64000", taxInclusive: true },
      encrypted_secrets: cryptoSeam.encryptSecrets("skydropx", {
        apiKey: "sky_live_key_9876",
      }),
      secret_hints: null,
    }
    const { resolver } = makeResolver({ row })

    expect(await resolver.resolve("skydropx")).toEqual({
      apiKey: "sky_live_key_9876",
      baseUrl: "https://api.skydropx.com/v1",
      originZip: "64000",
      taxInclusive: true,
    })
  })

  describe("cache behavior", () => {
    it("ttlMs 0 disables caching — every resolve re-reads", async () => {
      const readRow = jest.fn(async () => makeRow())
      const { resolver } = makeResolver({ readRow, ttlMs: 0 })

      await resolver.resolve("openpay")
      await resolver.resolve("openpay")
      expect(readRow).toHaveBeenCalledTimes(2)
    })

    it("serves cache hits within the TTL without re-reading", async () => {
      const readRow = jest.fn(async () => makeRow())
      let clock = 1_000
      const { resolver } = makeResolver({
        readRow,
        ttlMs: 30_000,
        now: () => clock,
      })

      const first = await resolver.resolve("openpay")
      clock += 10_000
      const second = await resolver.resolve("openpay")

      expect(readRow).toHaveBeenCalledTimes(1)
      expect(second).toEqual(first)
    })

    it("re-reads after TTL expiry", async () => {
      const readRow = jest.fn(async () => makeRow())
      let clock = 1_000
      const { resolver } = makeResolver({
        readRow,
        ttlMs: 30_000,
        now: () => clock,
      })

      await resolver.resolve("openpay")
      clock += 30_001
      await resolver.resolve("openpay")
      expect(readRow).toHaveBeenCalledTimes(2)
    })

    it("caches null results too (rate-limits decrypt-failure logging to the TTL)", async () => {
      const tampered = makeRow()
      tampered.encrypted_secrets =
        tampered.encrypted_secrets!.slice(0, -4) + "AAAA"
      const readRow = jest.fn(async () => tampered)
      const logger = makeLogger()
      const { resolver } = makeResolver({
        readRow,
        ttlMs: 30_000,
        now: () => 1_000,
        logger,
      })

      await resolver.resolve("openpay")
      await resolver.resolve("openpay")
      expect(readRow).toHaveBeenCalledTimes(1)
      expect(logger.error).toHaveBeenCalledTimes(1)
    })

    it("invalidateCredentialCache(provider) forces a re-read for that provider", async () => {
      const readRow = jest.fn(async (provider: string) =>
        provider === "openpay" ? makeRow() : null
      )
      const { resolver } = makeResolver({
        readRow,
        ttlMs: 30_000,
        now: () => 1_000,
      })

      await resolver.resolve("openpay")
      resolver.invalidate("openpay")
      await resolver.resolve("openpay")
      expect(readRow).toHaveBeenCalledTimes(2)
    })

    it("invalidateCredentialCache() with no args clears every provider", async () => {
      const readRow = jest.fn(async () => makeRow())
      const { resolver } = makeResolver({
        readRow,
        ttlMs: 30_000,
        now: () => 1_000,
      })

      await resolver.resolve("openpay")
      resolver.invalidate()
      await resolver.resolve("openpay")
      expect(readRow).toHaveBeenCalledTimes(2)
    })
  })
})

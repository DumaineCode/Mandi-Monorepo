/**
 * Slice 5 — public store config assembly (spec "Public Store Config Endpoint").
 *
 * These tests pin the CRITICAL public-data safety contract: the projection is
 * built from `public_config` ONLY, exposes exclusively the whitelisted
 * non-secret fields per provider (Openpay merchantId/publicKey/sandbox, MP
 * publicKey/sandbox), omits Skydropx entirely, and returns `null` for any
 * provider that is unconfigured or disabled — never a secret and never a throw.
 */
import {
  buildPublicProviderConfig,
  type PublicConfigRow,
} from "../public-config"

function openpayRow(overrides: Partial<PublicConfigRow> = {}): PublicConfigRow {
  return {
    provider: "openpay",
    mode: "sandbox",
    is_enabled: true,
    public_config: { merchantId: "m_123", publicKey: "pk_abc", sandbox: true },
    encrypted_secrets: "pset.v1.iv.tag.ct",
    ...overrides,
  }
}

function mercadopagoRow(
  overrides: Partial<PublicConfigRow> = {}
): PublicConfigRow {
  return {
    provider: "mercadopago",
    mode: "production",
    is_enabled: true,
    public_config: { publicKey: "APP_USR-pub", sandbox: false },
    encrypted_secrets: "pset.v1.iv.tag.ct",
    ...overrides,
  }
}

describe("buildPublicProviderConfig", () => {
  it("serves openpay merchantId, publicKey and sandbox flag when configured+enabled", () => {
    const result = buildPublicProviderConfig([openpayRow()])

    expect(result.openpay).toEqual({
      merchantId: "m_123",
      publicKey: "pk_abc",
      sandbox: true,
    })
    expect(result.mercadopago).toBeNull()
  })

  it("serves mercadopago publicKey and sandbox flag when configured+enabled", () => {
    const result = buildPublicProviderConfig([mercadopagoRow()])

    expect(result.mercadopago).toEqual({
      publicKey: "APP_USR-pub",
      sandbox: false,
    })
    expect(result.openpay).toBeNull()
  })

  it("returns both providers when both are configured", () => {
    const result = buildPublicProviderConfig([openpayRow(), mercadopagoRow()])

    expect(result.openpay).not.toBeNull()
    expect(result.mercadopago).not.toBeNull()
  })

  it("returns null for a provider with no row (unconfigured)", () => {
    const result = buildPublicProviderConfig([])

    expect(result.openpay).toBeNull()
    expect(result.mercadopago).toBeNull()
  })

  it("returns null for a disabled provider (is_enabled=false)", () => {
    const result = buildPublicProviderConfig([
      openpayRow({ is_enabled: false }),
    ])

    expect(result.openpay).toBeNull()
  })

  it("returns null when the provider has no secrets (not configured)", () => {
    const result = buildPublicProviderConfig([
      openpayRow({ encrypted_secrets: null }),
    ])

    expect(result.openpay).toBeNull()
  })

  it("returns null when required public fields are missing", () => {
    const result = buildPublicProviderConfig([
      openpayRow({ public_config: { merchantId: "m_123" } }),
    ])

    expect(result.openpay).toBeNull()
  })

  it("never includes skydropx in the output, even when configured", () => {
    const result = buildPublicProviderConfig([
      {
        provider: "skydropx",
        mode: "production",
        is_enabled: true,
        public_config: { originZip: "06600", taxInclusive: true },
        encrypted_secrets: "pset.v1.iv.tag.ct",
      },
    ])

    expect(Object.keys(result)).toEqual(["openpay", "mercadopago"])
    expect(
      (result as unknown as Record<string, unknown>).skydropx
    ).toBeUndefined()
  })

  it("derives sandbox from mode when public_config.sandbox is absent", () => {
    const sandbox = buildPublicProviderConfig([
      openpayRow({
        mode: "sandbox",
        public_config: { merchantId: "m_123", publicKey: "pk_abc" },
      }),
    ])
    const production = buildPublicProviderConfig([
      openpayRow({
        mode: "production",
        public_config: { merchantId: "m_123", publicKey: "pk_abc" },
      }),
    ])

    expect(sandbox.openpay?.sandbox).toBe(true)
    expect(production.openpay?.sandbox).toBe(false)
  })

  it("prefers an explicit public_config.sandbox flag over the mode", () => {
    const result = buildPublicProviderConfig([
      openpayRow({
        mode: "production",
        public_config: { merchantId: "m_123", publicKey: "pk_abc", sandbox: true },
      }),
    ])

    expect(result.openpay?.sandbox).toBe(true)
  })

  it("NEVER exposes a secret field — output contains only whitelisted keys", () => {
    // Rows deliberately carry hostile extra fields in public_config to prove the
    // projection is a strict whitelist, not a passthrough.
    const result = buildPublicProviderConfig([
      openpayRow({
        public_config: {
          merchantId: "m_123",
          publicKey: "pk_abc",
          sandbox: true,
          privateKey: "sk_LEAK",
          webhookPassword: "hunter2",
        },
      }),
      mercadopagoRow({
        public_config: {
          publicKey: "APP_USR-pub",
          sandbox: false,
          accessToken: "APP_USR-SECRET",
        },
      }),
    ])

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("sk_LEAK")
    expect(serialized).not.toContain("hunter2")
    expect(serialized).not.toContain("APP_USR-SECRET")
    expect(serialized).not.toContain("pset.v1")
    expect(serialized).not.toMatch(/privateKey|webhookPassword|accessToken|encrypted_secrets/)

    expect(Object.keys(result.openpay!).sort()).toEqual([
      "merchantId",
      "publicKey",
      "sandbox",
    ])
    expect(Object.keys(result.mercadopago!).sort()).toEqual([
      "publicKey",
      "sandbox",
    ])
  })
})

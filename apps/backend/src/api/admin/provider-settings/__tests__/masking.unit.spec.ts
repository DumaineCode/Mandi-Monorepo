/**
 * Task 2.8 (RED) — masked admin reads via secret_hints (never decrypts).
 *
 * Spec "Masked Secret Reads": fixed mask + last-4 when plaintext length >= 8,
 * fully masked otherwise; metadata includes configured flag, mode and
 * last-updated. The helper only ever sees hints — no plaintext exists here.
 */
import { toMaskedProviderSetting } from "../helpers"

const row = {
  mode: "sandbox",
  is_enabled: true,
  public_config: { merchantId: "m_test_123", publicKey: "pk", sandbox: true },
  encrypted_secrets: "pset.v1.aaa.bbb.ccc",
  secret_hints: {
    privateKey: { last4: "5678", set: true as const },
    webhookUser: { last4: null, set: true as const },
  },
  last_verified_at: new Date("2026-07-01T00:00:00Z"),
  updated_at: new Date("2026-07-02T00:00:00Z"),
}

describe("toMaskedProviderSetting", () => {
  it("returns an unconfigured shape for a missing row", () => {
    const masked = toMaskedProviderSetting("openpay", null)

    expect(masked).toEqual({
      provider: "openpay",
      configured: false,
      mode: null,
      is_enabled: false,
      public_config: null,
      secrets: {},
      last_verified_at: null,
      updated_at: null,
    })
  })

  it("masks long secrets as •••• + last4 and short ones fully", () => {
    const masked = toMaskedProviderSetting("openpay", row)

    expect(masked.secrets).toEqual({
      privateKey: "••••5678",
      webhookUser: "••••••••",
    })
  })

  it("exposes configured/mode/metadata without any secret material", () => {
    const masked = toMaskedProviderSetting("openpay", row)

    expect(masked.configured).toBe(true)
    expect(masked.mode).toBe("sandbox")
    expect(masked.is_enabled).toBe(true)
    expect(masked.public_config).toEqual(row.public_config)
    expect(masked.last_verified_at).toEqual(row.last_verified_at)
    expect(masked.updated_at).toEqual(row.updated_at)
    expect(JSON.stringify(masked)).not.toContain("pset.v1")
  })

  it("treats a row without encrypted secrets as unconfigured but keeps metadata", () => {
    const masked = toMaskedProviderSetting("openpay", {
      ...row,
      encrypted_secrets: null,
      secret_hints: null,
    })

    expect(masked.configured).toBe(false)
    expect(masked.secrets).toEqual({})
    expect(masked.mode).toBe("sandbox")
  })
})

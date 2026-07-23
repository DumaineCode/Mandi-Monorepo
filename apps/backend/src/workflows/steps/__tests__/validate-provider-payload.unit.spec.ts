/**
 * Task 2.1 (RED) — validate-provider-payload pure validation.
 *
 * Covers spec "Admin Settings API" (partial save rejected, descriptive error
 * naming the field, nothing persisted — validation is the first workflow step)
 * and spec "Mode Toggle" (mode switch without re-entered secrets rejected).
 */
import { MedusaError } from "@medusajs/framework/utils"

import {
  PROVIDER_PUBLIC_FIELDS,
  PROVIDER_SECRET_FIELDS,
  validateProviderPayload,
  type ExistingSettingSnapshot,
} from "../validate-provider-payload"

const fullOpenpayBody = {
  mode: "sandbox",
  merchantId: "m_test_123",
  publicKey: "pk_test_public",
  privateKey: "sk_secret_12345678",
  webhookUser: "hook",
  webhookPassword: "hook-pass-9123",
}

const allSetHints = (provider: string) =>
  Object.fromEntries(
    PROVIDER_SECRET_FIELDS[provider].map((field) => [
      field,
      { last4: "1234", set: true as const },
    ])
  )

describe("validateProviderPayload", () => {
  it("accepts a complete openpay payload and splits public/secret fields", () => {
    const result = validateProviderPayload("openpay", fullOpenpayBody, null)

    expect(result.provider).toBe("openpay")
    expect(result.mode).toBe("sandbox")
    expect(result.isEnabled).toBe(true)
    expect(result.publicConfig).toEqual({
      merchantId: "m_test_123",
      publicKey: "pk_test_public",
    })
    expect(result.secrets).toEqual({
      privateKey: "sk_secret_12345678",
      webhookUser: "hook",
      webhookPassword: "hook-pass-9123",
    })
    expect(result.retainedSecretFields).toEqual([])
  })

  it("rejects an unknown provider naming it", () => {
    expect(() =>
      validateProviderPayload("stripe", fullOpenpayBody, null)
    ).toThrow(/stripe/)
  })

  it("rejects a fresh save missing a required secret, naming the field", () => {
    const { webhookPassword: _omit, ...body } = fullOpenpayBody

    expect(() => validateProviderPayload("openpay", body, null)).toThrow(
      /webhookPassword/
    )
  })

  it("rejects a missing required non-secret field, naming it", () => {
    const { merchantId: _omit, ...body } = fullOpenpayBody

    expect(() => validateProviderPayload("openpay", body, null)).toThrow(
      /merchantId/
    )
  })

  it("rejects an invalid mode value", () => {
    expect(() =>
      validateProviderPayload(
        "openpay",
        { ...fullOpenpayBody, mode: "staging" },
        null
      )
    ).toThrow(/mode/)
  })

  it("throws MedusaError of type INVALID_DATA on validation failures", () => {
    let caught: unknown
    try {
      validateProviderPayload("openpay", { mode: "sandbox" }, null)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(MedusaError)
    expect((caught as MedusaError).type).toBe(MedusaError.Types.INVALID_DATA)
  })

  it("keeps omitted secrets when a same-mode row exists with the hint set", () => {
    const existing: ExistingSettingSnapshot = {
      mode: "sandbox",
      secret_hints: allSetHints("openpay"),
    }
    const body = {
      mode: "sandbox",
      merchantId: "m_test_123",
      publicKey: "pk_test_public",
      privateKey: "sk_rotated_87654321",
    }

    const result = validateProviderPayload("openpay", body, existing)

    expect(result.secrets).toEqual({ privateKey: "sk_rotated_87654321" })
    expect([...result.retainedSecretFields].sort()).toEqual([
      "webhookPassword",
      "webhookUser",
    ])
  })

  it("rejects a mode switch without re-entered secrets (spec Mode Toggle)", () => {
    const existing: ExistingSettingSnapshot = {
      mode: "sandbox",
      secret_hints: allSetHints("openpay"),
    }
    const body = {
      mode: "production",
      merchantId: "m_test_123",
      publicKey: "pk_test_public",
    }

    expect(() => validateProviderPayload("openpay", body, existing)).toThrow(
      /privateKey/
    )
  })

  it("accepts a mode switch when all secrets are re-entered", () => {
    const existing: ExistingSettingSnapshot = {
      mode: "sandbox",
      secret_hints: allSetHints("openpay"),
    }

    const result = validateProviderPayload(
      "openpay",
      { ...fullOpenpayBody, mode: "production" },
      existing
    )

    expect(result.mode).toBe("production")
    expect(result.retainedSecretFields).toEqual([])
  })

  it("classifies skydropx fields as two secrets + PRO public fields", () => {
    expect(PROVIDER_SECRET_FIELDS.skydropx).toEqual(["clientId", "clientSecret"])
    expect(PROVIDER_PUBLIC_FIELDS.skydropx).toEqual([
      "baseUrl",
      "originZip",
      "taxInclusive",
      "consignmentNote",
      "packageType",
    ])
    // Legacy single-secret apiKey is no longer a skydropx field anywhere.
    expect(PROVIDER_SECRET_FIELDS.skydropx).not.toContain("apiKey")
    expect(PROVIDER_PUBLIC_FIELDS.skydropx).not.toContain("apiKey")
  })

  it("accepts a complete two-secret skydropx payload with the new public fields", () => {
    const result = validateProviderPayload(
      "skydropx",
      {
        mode: "production",
        originZip: "64000",
        clientId: "sd_client_1234",
        clientSecret: "sd_secret_12345678",
        consignmentNote: "31181701",
        packageType: "4G",
      },
      null
    )

    expect(result.publicConfig).toEqual({
      originZip: "64000",
      consignmentNote: "31181701",
      packageType: "4G",
    })
    expect(result.secrets).toEqual({
      clientId: "sd_client_1234",
      clientSecret: "sd_secret_12345678",
    })
  })

  it("rejects a fresh skydropx save without originZip or the two secrets", () => {
    expect(() =>
      validateProviderPayload("skydropx", { mode: "production" }, null)
    ).toThrow(/originZip/)
    expect(() =>
      validateProviderPayload(
        "skydropx",
        { mode: "production", originZip: "64000" },
        null
      )
    ).toThrow(/clientId/)
  })

  it("keeps the omitted skydropx secret on a same-mode partial update (S1-T1: one of two)", () => {
    const existing: ExistingSettingSnapshot = {
      mode: "production",
      secret_hints: {
        clientId: { last4: "1234", set: true },
        clientSecret: { last4: "5678", set: true },
      },
    }

    const result = validateProviderPayload(
      "skydropx",
      {
        mode: "production",
        originZip: "64000",
        clientSecret: "sd_secret_rotated_9012",
      },
      existing
    )

    // Only the re-entered secret is new; the untouched one is retained (kept).
    expect(result.secrets).toEqual({ clientSecret: "sd_secret_rotated_9012" })
    expect(result.retainedSecretFields).toEqual(["clientId"])
  })

  it("does not treat apiKey as a valid skydropx secret", () => {
    // apiKey is unknown to the schema (stripped) → the two secrets are still missing.
    expect(() =>
      validateProviderPayload(
        "skydropx",
        { mode: "production", originZip: "64000", apiKey: "sd_key_12345678" },
        null
      )
    ).toThrow(/clientId/)
  })

  it("rejects a non-skydropx baseUrl on save (SSRF write-path guard, design D1)", () => {
    expect(() =>
      validateProviderPayload(
        "skydropx",
        {
          mode: "production",
          originZip: "64000",
          clientId: "sd_client_1234",
          clientSecret: "sd_secret_12345678",
          baseUrl: "https://evil.example.com/api/v1",
        },
        null
      )
    ).toThrow(/skydropx\.com|base url/i)
  })

  it("accepts an allowlisted PRO baseUrl on save", () => {
    const result = validateProviderPayload(
      "skydropx",
      {
        mode: "production",
        originZip: "64000",
        clientId: "sd_client_1234",
        clientSecret: "sd_secret_12345678",
        baseUrl: "https://api-pro.skydropx.com/api/v1",
      },
      null
    )

    expect(result.publicConfig.baseUrl).toBe(
      "https://api-pro.skydropx.com/api/v1"
    )
  })

  it("accepts a complete mercadopago payload", () => {
    const result = validateProviderPayload(
      "mercadopago",
      {
        mode: "sandbox",
        publicKey: "APP_USR-public",
        accessToken: "APP_USR-token-123",
        webhookSecret: "whsec_12345678",
      },
      null
    )

    expect(result.publicConfig).toEqual({ publicKey: "APP_USR-public" })
    expect(Object.keys(result.secrets).sort()).toEqual([
      "accessToken",
      "webhookSecret",
    ])
  })

  it("honours is_enabled=false in the payload", () => {
    const result = validateProviderPayload(
      "openpay",
      { ...fullOpenpayBody, is_enabled: false },
      null
    )

    expect(result.isEnabled).toBe(false)
  })
})

/**
 * Task 2.1 (RED) — validate-provider-payload pure validation.
 *
 * Covers spec "Admin Settings API" (partial save rejected, descriptive error
 * naming the field, nothing persisted — validation is the first workflow step)
 * and spec "Mode Toggle" (mode switch without re-entered secrets rejected).
 */
import { MedusaError } from "@medusajs/framework/utils"

import {
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

  it("accepts a complete skydropx payload, defaults omitted optionals", () => {
    const result = validateProviderPayload(
      "skydropx",
      { mode: "production", originZip: "64000", apiKey: "sd_key_12345678" },
      null
    )

    expect(result.publicConfig).toEqual({ originZip: "64000" })
    expect(result.secrets).toEqual({ apiKey: "sd_key_12345678" })
  })

  it("rejects a fresh skydropx save without originZip or apiKey", () => {
    expect(() =>
      validateProviderPayload("skydropx", { mode: "production" }, null)
    ).toThrow(/originZip/)
    expect(() =>
      validateProviderPayload(
        "skydropx",
        { mode: "production", originZip: "64000" },
        null
      )
    ).toThrow(/apiKey/)
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

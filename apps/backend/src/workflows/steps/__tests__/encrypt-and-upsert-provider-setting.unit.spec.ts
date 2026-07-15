/**
 * Task 2.3 (RED) — encrypt-and-upsert pure row builder.
 *
 * Covers spec "Secrets Encrypted at Rest" (no plaintext persisted) and the
 * design §5 upsert semantics: omitted secret = keep existing (merged from the
 * decrypted stored envelope), write-time secret_hints.
 */
import { createProviderSettingsCrypto } from "../../../modules/provider-settings/crypto"
import type { ValidatedProviderPayload } from "../validate-provider-payload"
import { buildProviderSettingRow } from "../encrypt-and-upsert-provider-setting"

// base64 of the 32 ASCII bytes "0123456789abcdef0123456789abcdef"
const TEST_KEK = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="

const crypto = createProviderSettingsCrypto(TEST_KEK)

const validated: ValidatedProviderPayload = {
  provider: "openpay",
  mode: "sandbox",
  isEnabled: true,
  publicConfig: { merchantId: "m_test_123", publicKey: "pk_test_public" },
  secrets: {
    privateKey: "sk_secret_12345678",
    webhookUser: "hook",
    webhookPassword: "hook-pass-9123",
  },
  retainedSecretFields: [],
}

describe("buildProviderSettingRow", () => {
  it("encrypts all secrets into a pset.v1 envelope with no plaintext in the row", () => {
    const row = buildProviderSettingRow(crypto, validated, null)

    expect(row.encrypted_secrets).toMatch(/^pset\.v1\./)
    const serialized = JSON.stringify(row)
    expect(serialized).not.toContain("sk_secret_12345678")
    expect(serialized).not.toContain("hook-pass-9123")
  })

  it("computes write-time secret_hints (last4 only for secrets >= 8 chars)", () => {
    const row = buildProviderSettingRow(crypto, validated, null)

    expect(row.secret_hints).toEqual({
      privateKey: { last4: "5678", set: true },
      webhookUser: { last4: null, set: true },
      webhookPassword: { last4: "9123", set: true },
    })
  })

  it("derives the sandbox flag from mode in public_config", () => {
    const row = buildProviderSettingRow(crypto, validated, null)

    expect(row.public_config).toEqual({
      merchantId: "m_test_123",
      publicKey: "pk_test_public",
      sandbox: true,
    })
  })

  it("roundtrips: the stored envelope decrypts back to the full secrets object", () => {
    const row = buildProviderSettingRow(crypto, validated, null)

    expect(crypto.decryptSecrets("openpay", row.encrypted_secrets!)).toEqual(
      validated.secrets
    )
  })

  it("merges retained secrets from the existing decrypted envelope", () => {
    const input: ValidatedProviderPayload = {
      ...validated,
      secrets: { privateKey: "sk_rotated_87654321" },
      retainedSecretFields: ["webhookUser", "webhookPassword"],
    }
    const existingSecrets = {
      privateKey: "sk_old_00000000",
      webhookUser: "hook",
      webhookPassword: "hook-pass-9123",
    }

    const row = buildProviderSettingRow(crypto, input, existingSecrets)

    expect(crypto.decryptSecrets("openpay", row.encrypted_secrets!)).toEqual({
      privateKey: "sk_rotated_87654321",
      webhookUser: "hook",
      webhookPassword: "hook-pass-9123",
    })
  })

  it("throws naming the field when a retained secret is unavailable", () => {
    const input: ValidatedProviderPayload = {
      ...validated,
      secrets: { privateKey: "sk_rotated_87654321" },
      retainedSecretFields: ["webhookUser", "webhookPassword"],
    }

    expect(() => buildProviderSettingRow(crypto, input, null)).toThrow(
      /webhookUser/
    )
  })
})

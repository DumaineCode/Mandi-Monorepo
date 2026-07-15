/**
 * Slice 1 (task 1.1/1.3) — AES-256-GCM envelope crypto unit tests.
 *
 * Design contract (design §2):
 * - Envelope format: `pset.v1.<iv_b64url>.<tag_b64url>.<ct_b64url>`
 * - KEK: base64 or hex decoding to exactly 32 bytes
 * - AAD binds ciphertext to its provider row: `"${provider}:v1"`
 * - Decrypt failures (tamper, wrong KEK, AAD mismatch, malformed envelope)
 *   return `null` — NEVER throw (fail-safe read path)
 * - Invalid/missing KEK → disabled state: `encrypt` throws, `decrypt` returns
 *   `null`, error logged exactly once, no secret material in messages
 */
import {
  createProviderSettingsCrypto,
  decodeKek,
  ENVELOPE_PREFIX,
} from "../crypto"

/** 32 ASCII bytes "0123456789abcdef0123456789abcdef" in base64. */
const KEK_B64 = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
/** A different valid 32-byte KEK (base64 of 32 x 0x07). */
const OTHER_KEK_B64 = Buffer.alloc(32, 7).toString("base64")
/** Same 32 bytes as KEK_B64 but hex-encoded (64 hex chars). */
const KEK_HEX = Buffer.from(
  "0123456789abcdef0123456789abcdef",
  "utf8"
).toString("hex")

const SECRETS = {
  privateKey: "sk_test_private_key_1234",
  webhookPassword: "hunter2!",
}

const B64URL = /^[A-Za-z0-9_-]+$/

const makeLogger = () => ({ error: jest.fn() })

const tamperPart = (envelope: string, index: number): string => {
  const parts = envelope.split(".")
  const part = parts[index]
  // Flip the first character to a different base64url character.
  parts[index] = (part[0] === "A" ? "B" : "A") + part.slice(1)
  return parts.join(".")
}

describe("provider-settings crypto", () => {
  describe("decodeKek", () => {
    it("decodes a base64 KEK of exactly 32 bytes", () => {
      const key = decodeKek(KEK_B64)
      expect(key).not.toBeNull()
      expect(key!.length).toBe(32)
    })

    it("decodes a hex KEK of exactly 32 bytes", () => {
      const key = decodeKek(KEK_HEX)
      expect(key).not.toBeNull()
      expect(key!.length).toBe(32)
      expect(key!.equals(decodeKek(KEK_B64)!)).toBe(true)
    })

    it("rejects missing, short, and undecodable KEKs", () => {
      expect(decodeKek(undefined)).toBeNull()
      expect(decodeKek("")).toBeNull()
      // 16 bytes only
      expect(decodeKek(Buffer.alloc(16, 1).toString("base64"))).toBeNull()
      // decodes to garbage that is not 32 bytes
      expect(decodeKek("!!!not-a-key!!!")).toBeNull()
    })
  })

  describe("encrypt/decrypt roundtrip", () => {
    it("roundtrips a secrets object for the same provider", () => {
      const crypto = createProviderSettingsCrypto(KEK_B64)
      const envelope = crypto.encryptSecrets("openpay", SECRETS)
      expect(crypto.decryptSecrets("openpay", envelope)).toEqual(SECRETS)
    })

    it("produces the versioned envelope format pset.v1.<iv>.<tag>.<ct> in b64url", () => {
      const crypto = createProviderSettingsCrypto(KEK_B64)
      const envelope = crypto.encryptSecrets("openpay", SECRETS)
      const parts = envelope.split(".")

      expect(parts).toHaveLength(5)
      expect(parts[0]).toBe(ENVELOPE_PREFIX)
      expect(parts[1]).toBe("v1")
      for (const part of parts.slice(2)) {
        expect(part).toMatch(B64URL)
      }
      // 12-byte IV, 16-byte GCM tag
      expect(Buffer.from(parts[2], "base64url").length).toBe(12)
      expect(Buffer.from(parts[3], "base64url").length).toBe(16)
    })

    it("never embeds plaintext secret values in the envelope", () => {
      const crypto = createProviderSettingsCrypto(KEK_B64)
      const envelope = crypto.encryptSecrets("openpay", SECRETS)
      for (const value of Object.values(SECRETS)) {
        expect(envelope).not.toContain(value)
      }
    })

    it("uses a random IV per encryption (same input → different envelope)", () => {
      const crypto = createProviderSettingsCrypto(KEK_B64)
      const a = crypto.encryptSecrets("openpay", SECRETS)
      const b = crypto.encryptSecrets("openpay", SECRETS)
      expect(a).not.toBe(b)
    })
  })

  describe("fail-safe decrypt (returns null, never throws)", () => {
    const crypto = createProviderSettingsCrypto(KEK_B64)

    it("returns null on tampered auth tag", () => {
      const envelope = crypto.encryptSecrets("openpay", SECRETS)
      expect(crypto.decryptSecrets("openpay", tamperPart(envelope, 3))).toBeNull()
    })

    it("returns null on tampered IV", () => {
      const envelope = crypto.encryptSecrets("openpay", SECRETS)
      expect(crypto.decryptSecrets("openpay", tamperPart(envelope, 2))).toBeNull()
    })

    it("returns null on tampered ciphertext", () => {
      const envelope = crypto.encryptSecrets("openpay", SECRETS)
      expect(crypto.decryptSecrets("openpay", tamperPart(envelope, 4))).toBeNull()
    })

    it("returns null when decrypting with a different KEK", () => {
      const envelope = crypto.encryptSecrets("openpay", SECRETS)
      const other = createProviderSettingsCrypto(OTHER_KEK_B64)
      expect(other.decryptSecrets("openpay", envelope)).toBeNull()
    })

    it("returns null on AAD mismatch (ciphertext moved to another provider)", () => {
      const envelope = crypto.encryptSecrets("openpay", SECRETS)
      expect(crypto.decryptSecrets("skydropx", envelope)).toBeNull()
    })

    it("returns null on malformed envelopes", () => {
      expect(crypto.decryptSecrets("openpay", "")).toBeNull()
      expect(crypto.decryptSecrets("openpay", "garbage")).toBeNull()
      expect(crypto.decryptSecrets("openpay", "pset.v2.a.b.c")).toBeNull()
      expect(crypto.decryptSecrets("openpay", "other.v1.a.b.c")).toBeNull()
    })
  })

  describe("KEK validation (disabled state)", () => {
    it.each([
      ["missing", undefined],
      ["short (16 bytes)", Buffer.alloc(16, 1).toString("base64")],
      ["undecodable", "!!!not-a-key!!!"],
    ])(
      "with %s KEK: encrypt throws, decrypt returns null, error logged once",
      (_label, rawKek) => {
        const logger = makeLogger()
        const crypto = createProviderSettingsCrypto(rawKek, logger)

        expect(crypto.kekValid).toBe(false)
        expect(() => crypto.encryptSecrets("openpay", SECRETS)).toThrow()
        expect(crypto.decryptSecrets("openpay", "pset.v1.a.b.c")).toBeNull()
        // Repeated use must not spam the log — exactly one ERROR at init.
        crypto.decryptSecrets("openpay", "pset.v1.a.b.c")
        expect(logger.error).toHaveBeenCalledTimes(1)
      }
    )

    it("never includes KEK material in error messages or logs", () => {
      const shortKek = Buffer.alloc(16, 1).toString("base64")
      const logger = makeLogger()
      const crypto = createProviderSettingsCrypto(shortKek, logger)

      const logged = logger.error.mock.calls.map((c) => String(c[0])).join(" ")
      expect(logged).not.toContain(shortKek)

      let thrown: Error | undefined
      try {
        crypto.encryptSecrets("openpay", SECRETS)
      } catch (e) {
        thrown = e as Error
      }
      expect(thrown).toBeDefined()
      expect(thrown!.message).not.toContain(shortKek)
      for (const value of Object.values(SECRETS)) {
        expect(thrown!.message).not.toContain(value)
      }
    })

    it("reports kekValid true for a valid KEK and does not log", () => {
      const logger = makeLogger()
      const crypto = createProviderSettingsCrypto(KEK_HEX, logger)
      expect(crypto.kekValid).toBe(true)
      expect(logger.error).not.toHaveBeenCalled()
    })
  })
})

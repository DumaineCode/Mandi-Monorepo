/**
 * Pure AES-256-GCM envelope crypto for provider settings (design §2).
 *
 * - Zero framework imports — `node:crypto` only (unit-testable seam).
 * - KEK: `PROVIDER_SETTINGS_ENCRYPTION_KEY` env value passed in by the caller;
 *   accepted encodings are base64 or hex decoding to exactly 32 bytes. No KDF:
 *   the KEK is used directly as the AES key (single-purpose key; rotation
 *   story = re-paste via admin).
 * - AAD `"${provider}:v1"` binds ciphertext to its provider row — an envelope
 *   copied to another provider fails authentication. Mode is NOT part of the
 *   AAD so a mode toggle that retains secrets does not invalidate them.
 * - Envelope format: `pset.v1.<iv_b64url>.<tag_b64url>.<ct_b64url>` — the
 *   version prefix enables future algorithm migration.
 * - Fail-safe semantics: decrypt NEVER throws (returns `null` on tamper,
 *   wrong KEK, AAD mismatch, malformed envelope). An invalid/missing KEK puts
 *   the seam in a disabled state: `encryptSecrets` throws (admin saves surface
 *   a clear error), `decryptSecrets` returns `null` (providers resolve
 *   unconfigured), and the failure is logged exactly ONCE at creation with no
 *   secret material in the message. Boot never fails.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto"

export const ENVELOPE_PREFIX = "pset"
export const ENVELOPE_VERSION = "v1"

const AES_ALGORITHM = "aes-256-gcm"
const KEY_LENGTH_BYTES = 32
const IV_LENGTH_BYTES = 12
const AUTH_TAG_LENGTH_BYTES = 16

export interface CryptoLogger {
  error(message: string): void
}

export interface ProviderSettingsCrypto {
  /** False when the KEK is missing/short/undecodable → disabled state. */
  readonly kekValid: boolean
  /**
   * Encrypts a flat secrets object for `provider`. Throws when the KEK is
   * invalid (write path must fail loudly; never silently store plaintext).
   */
  encryptSecrets(provider: string, secrets: Record<string, string>): string
  /**
   * Decrypts an envelope for `provider`. Returns `null` on ANY failure —
   * never throws (fail-safe read path, design §2).
   */
  decryptSecrets(
    provider: string,
    envelope: string
  ): Record<string, string> | null
}

/**
 * Decodes a KEK given as base64 or hex. Returns `null` unless the decoded
 * key is exactly 32 bytes.
 */
export function decodeKek(raw: string | undefined | null): Buffer | null {
  if (!raw) {
    return null
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex")
  }

  try {
    const decoded = Buffer.from(raw, "base64")
    // Reject lenient/partial base64 decodes: re-encoding must match the
    // input (modulo padding) and the key must be exactly 32 bytes.
    const normalized = raw.replace(/=+$/, "")
    if (
      decoded.length === KEY_LENGTH_BYTES &&
      decoded.toString("base64").replace(/=+$/, "") === normalized
    ) {
      return decoded
    }
  } catch {
    // fall through → null
  }

  return null
}

const aadFor = (provider: string): Buffer =>
  Buffer.from(`${provider}:${ENVELOPE_VERSION}`, "utf8")

export function createProviderSettingsCrypto(
  rawKek: string | undefined | null,
  logger?: CryptoLogger
): ProviderSettingsCrypto {
  const key = decodeKek(rawKek)

  if (!key) {
    // Log exactly once at creation; never include the KEK value itself.
    logger?.error(
      "[provider-settings] PROVIDER_SETTINGS_ENCRYPTION_KEY is missing or " +
        "invalid (must be base64 or hex decoding to exactly 32 bytes). " +
        "Secret encryption is DISABLED: saves will fail and all providers " +
        "resolve unconfigured."
    )
  }

  return {
    kekValid: key !== null,

    encryptSecrets(provider, secrets) {
      if (!key) {
        throw new Error(
          "Provider settings encryption key is missing or invalid; cannot " +
            "encrypt secrets. Set PROVIDER_SETTINGS_ENCRYPTION_KEY to a " +
            "base64- or hex-encoded 32-byte key."
        )
      }

      const iv = randomBytes(IV_LENGTH_BYTES)
      const cipher = createCipheriv(AES_ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH_BYTES,
      })
      cipher.setAAD(aadFor(provider))

      const plaintext = Buffer.from(JSON.stringify(secrets), "utf8")
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ])
      const tag = cipher.getAuthTag()

      return [
        ENVELOPE_PREFIX,
        ENVELOPE_VERSION,
        iv.toString("base64url"),
        tag.toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(".")
    },

    decryptSecrets(provider, envelope) {
      if (!key) {
        return null
      }

      try {
        const parts = envelope.split(".")
        if (
          parts.length !== 5 ||
          parts[0] !== ENVELOPE_PREFIX ||
          parts[1] !== ENVELOPE_VERSION
        ) {
          return null
        }

        const iv = Buffer.from(parts[2], "base64url")
        const tag = Buffer.from(parts[3], "base64url")
        const ciphertext = Buffer.from(parts[4], "base64url")

        if (
          iv.length !== IV_LENGTH_BYTES ||
          tag.length !== AUTH_TAG_LENGTH_BYTES
        ) {
          return null
        }

        const decipher = createDecipheriv(AES_ALGORITHM, key, iv, {
          authTagLength: AUTH_TAG_LENGTH_BYTES,
        })
        decipher.setAAD(aadFor(provider))
        decipher.setAuthTag(tag)

        const plaintext = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]).toString("utf8")

        const parsed: unknown = JSON.parse(plaintext)
        if (parsed === null || typeof parsed !== "object") {
          return null
        }

        return parsed as Record<string, string>
      } catch {
        // Tamper, wrong KEK, AAD mismatch, corrupt envelope — all fail safe.
        return null
      }
    },
  }
}

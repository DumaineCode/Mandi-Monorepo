/**
 * Slice 3 (tasks 3.1/3.2) — makeDbCredentialSource + credentialFingerprint.
 *
 * The factory resolves the providerSettings module from the GLOBAL framework
 * container lazily, PER CALL (design F1/F2 — never in constructors, module
 * load order is not guaranteed and unresolved keys register as `undefined`).
 * The global container is faked via jest.mock so no framework boot is needed.
 */
import { container } from "@medusajs/framework"
import {
  credentialFingerprint,
  makeDbCredentialSource,
} from "../provider-credentials"

jest.mock("@medusajs/framework", () => ({
  container: { resolve: jest.fn() },
}))

const resolveMock = container.resolve as jest.Mock

describe("makeDbCredentialSource", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns null when the settings module is unresolved (undefined key, F2)", async () => {
    resolveMock.mockReturnValue(undefined)
    const source = makeDbCredentialSource("openpay")

    await expect(source()).resolves.toBeNull()
    expect(resolveMock).toHaveBeenCalledWith(
      "providerSettings",
      expect.objectContaining({ allowUnregistered: true })
    )
  })

  it("returns null when container resolution throws (fail-safe, never throws)", async () => {
    resolveMock.mockImplementation(() => {
      throw new Error("AwilixResolutionError")
    })
    const source = makeDbCredentialSource("openpay")

    await expect(source()).resolves.toBeNull()
  })

  it("delegates to getResolvedCredentials(provider) and returns its value", async () => {
    const creds = { merchantId: "m_1", privateKey: "sk_1", sandbox: true }
    const getResolvedCredentials = jest.fn().mockResolvedValue(creds)
    resolveMock.mockReturnValue({ getResolvedCredentials })
    const source = makeDbCredentialSource<typeof creds>("openpay")

    await expect(source()).resolves.toEqual(creds)
    expect(getResolvedCredentials).toHaveBeenCalledWith("openpay")
  })

  it("returns null when the settings service resolves the provider to null", async () => {
    resolveMock.mockReturnValue({
      getResolvedCredentials: jest.fn().mockResolvedValue(null),
    })
    const source = makeDbCredentialSource("skydropx")

    await expect(source()).resolves.toBeNull()
  })

  it("returns null when getResolvedCredentials rejects (read path stays fail-safe)", async () => {
    resolveMock.mockReturnValue({
      getResolvedCredentials: jest.fn().mockRejectedValue(new Error("boom")),
    })
    const source = makeDbCredentialSource("skydropx")

    await expect(source()).resolves.toBeNull()
  })

  it("resolves the container on EVERY call, never caching the service (per-call resolution)", async () => {
    resolveMock.mockReturnValue(undefined)
    const source = makeDbCredentialSource("openpay")

    await source()
    await source()

    expect(resolveMock).toHaveBeenCalledTimes(2)
  })

  // FIX 3 (resilience): the per-request DB read on the payment/webhook hot path
  // MUST be bounded so a slow-but-up DB cannot hang initiate/authorize/webhook.
  describe("credential resolution timeout (hot-path fail-safe)", () => {
    it("fails safe to null when the read exceeds the timeout", async () => {
      resolveMock.mockReturnValue({
        // Never resolves — simulates a slow-but-up DB.
        getResolvedCredentials: jest.fn(() => new Promise(() => {})),
      })
      const source = makeDbCredentialSource("openpay", { timeoutMs: 10 })

      await expect(source()).resolves.toBeNull()
    })

    it("returns credentials normally when the read resolves before the timeout", async () => {
      const creds = { merchantId: "m", privateKey: "sk", sandbox: true }
      resolveMock.mockReturnValue({
        getResolvedCredentials: jest.fn().mockResolvedValue(creds),
      })
      const source = makeDbCredentialSource<typeof creds>("openpay", {
        timeoutMs: 1_000,
      })

      await expect(source()).resolves.toEqual(creds)
    })

    it("logs a timeout once (rate-limited) without leaking secret material", async () => {
      const error = jest.fn()
      let clock = 0
      const now = () => (clock += 1)
      resolveMock.mockReturnValue({
        getResolvedCredentials: jest.fn(() => new Promise(() => {})),
      })
      const source = makeDbCredentialSource("openpay", {
        timeoutMs: 5,
        logger: { error },
        now,
      })

      await source()
      await source()

      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0][0])).not.toMatch(/sk_|privateKey|token/i)
    })
  })
})

describe("credentialFingerprint", () => {
  it("is stable for equal credentials regardless of key order", () => {
    const a = credentialFingerprint({ merchantId: "m", privateKey: "sk" })
    const b = credentialFingerprint({ privateKey: "sk", merchantId: "m" })
    expect(a).toBe(b)
  })

  it("changes when any credential value changes (rotation detection)", () => {
    const base = { merchantId: "m", privateKey: "sk", sandbox: true }
    expect(credentialFingerprint(base)).not.toBe(
      credentialFingerprint({ ...base, privateKey: "sk_rotated" })
    )
    expect(credentialFingerprint(base)).not.toBe(
      credentialFingerprint({ ...base, sandbox: false })
    )
  })

  it("never contains raw credential material", () => {
    const fp = credentialFingerprint({ privateKey: "sk_super_secret_value" })
    expect(fp).not.toContain("sk_super_secret_value")
  })
})

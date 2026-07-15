/**
 * FIX 4b (resilience) — GET /store/provider-config must honor its documented
 * "never a 5xx" contract: a DB read failure yields the empty/all-null public
 * projection, not a throw. Success still serves the whitelisted public fields.
 */
import { GET } from "../route"

type ListImpl = (...args: unknown[]) => Promise<unknown>

function makeReq(listProviderSettings: ListImpl) {
  return {
    scope: { resolve: () => ({ listProviderSettings }) },
  } as never
}

function makeRes() {
  const res = {
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(key: string, value: string) {
      this.headers[key] = value
    },
    json(body: unknown) {
      this.body = body
    },
  }
  return res
}

describe("GET /store/provider-config", () => {
  it("returns the empty all-null projection when the read throws (never 5xx)", async () => {
    const req = makeReq(jest.fn().mockRejectedValue(new Error("db unavailable")))
    const res = makeRes()

    await expect(GET(req, res as never)).resolves.toBeUndefined()
    expect(res.body).toEqual({ openpay: null, mercadopago: null })
  })

  it("marks the degraded (catch-path) response non-cacheable so a transient DB blip is not cached for 60s", async () => {
    const req = makeReq(jest.fn().mockRejectedValue(new Error("db unavailable")))
    const res = makeRes()

    await GET(req, res as never)

    // Degraded response MUST NOT be cached under the 60s success TTL — a recovery
    // must be picked up on the next render, not up to 60s later.
    expect(res.headers["Cache-Control"]).toBe("no-store")
    expect(res.headers["Cache-Control"]).not.toContain("max-age=60")
  })

  it("serves the whitelisted public projection on a successful read", async () => {
    const rows = [
      {
        provider: "openpay",
        mode: "sandbox",
        is_enabled: true,
        public_config: { merchantId: "m_1", publicKey: "pk_1" },
        encrypted_secrets: "pset.v1.ciphertext",
      },
    ]
    const req = makeReq(jest.fn().mockResolvedValue(rows))
    const res = makeRes()

    await GET(req, res as never)

    expect(res.body).toEqual({
      openpay: { merchantId: "m_1", publicKey: "pk_1", sandbox: true },
      mercadopago: null,
    })
    // Healthy success path keeps the 60s public cache.
    expect(res.headers["Cache-Control"]).toBe("public, max-age=60")
  })

  it("keeps the 60s cache on a healthy-but-empty read (unconfigured is a normal success, not a degradation)", async () => {
    const req = makeReq(jest.fn().mockResolvedValue([]))
    const res = makeRes()

    await GET(req, res as never)

    expect(res.body).toEqual({ openpay: null, mercadopago: null })
    // Absent rows with no error is a normal, cacheable "unconfigured" success.
    expect(res.headers["Cache-Control"]).toBe("public, max-age=60")
  })
})

/**
 * Task 2.5 (RED) — test-connection probes (mocked fetch, bounded timeout).
 *
 * Design §6 probe table: Openpay GET /v1/{merchantId}/charges?limit=1,
 * Skydropx POST /quotations to fixed destination zip 06600, MP
 * GET /users/me Bearer token (+ live_mode vs mode mismatch warning).
 * Probes NEVER throw — every failure resolves to { ok: false, detail }.
 */
import { probeMercadopago } from "../mercadopago"
import { probeOpenpay } from "../openpay"
import { probeSkydropx } from "../skydropx"

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  }) as unknown as Response

const fetchReturning = (response: Response) =>
  jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => response)

/** A fetch that only settles when the probe's AbortController fires. */
const hangingFetch = ((_url: unknown, init?: RequestInit) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(Object.assign(new Error("The operation was aborted"), {
        name: "AbortError",
      }))
    )
  })) as unknown as typeof fetch

describe("probeOpenpay", () => {
  const creds = {
    merchantId: "m_test_123",
    privateKey: "sk_secret_12345678",
    sandbox: true,
  }

  it("passes on HTTP 200 and calls the sandbox charges endpoint with Basic auth", async () => {
    const fetchImpl = fetchReturning(jsonResponse([]))

    const result = await probeOpenpay(creds, { fetchImpl })

    expect(result.ok).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toBe(
      "https://sandbox-api.openpay.mx/v1/m_test_123/charges?limit=1"
    )
    expect(
      (init?.headers as Record<string, string>)["Authorization"]
    ).toBe(`Basic ${Buffer.from("sk_secret_12345678:").toString("base64")}`)
  })

  it("uses the production base URL when sandbox is false", async () => {
    const fetchImpl = fetchReturning(jsonResponse([]))

    await probeOpenpay({ ...creds, sandbox: false }, { fetchImpl })

    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "https://api.openpay.mx/v1/m_test_123/charges?limit=1"
    )
  })

  it.each([401, 403])("fails on HTTP %i blaming the private key", async (status) => {
    const result = await probeOpenpay(creds, {
      fetchImpl: fetchReturning(jsonResponse({}, status)),
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/private key|credential/i)
  })

  it("fails on HTTP 404 pointing at the merchant id or environment", async () => {
    const result = await probeOpenpay(creds, {
      fetchImpl: fetchReturning(jsonResponse({}, 404)),
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/merchant/i)
  })

  it("reports a timeout as failure with a reason", async () => {
    const result = await probeOpenpay(creds, {
      fetchImpl: hangingFetch,
      timeoutMs: 10,
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/timed out/i)
  })
})

describe("probeSkydropx", () => {
  const creds = { apiKey: "sd_key_12345678", originZip: "64000" }

  it("passes on 2xx posting a smallest-parcel quotation to zip 06600", async () => {
    const fetchImpl = fetchReturning(jsonResponse({ id: "q_1" }, 201))

    const result = await probeSkydropx(creds, { fetchImpl })

    expect(result.ok).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toBe("https://api.skydropx.com/v1/quotations")
    expect(init?.method).toBe("POST")
    expect(
      (init?.headers as Record<string, string>)["Authorization"]
    ).toBe("Token token=sd_key_12345678")
    const body = JSON.parse(String(init?.body))
    expect(body.zip_from).toBe("64000")
    expect(body.zip_to).toBe("06600")
  })

  it("respects a stored baseUrl override on an allowlisted skydropx host", async () => {
    const fetchImpl = fetchReturning(jsonResponse({}, 200))

    await probeSkydropx(
      { ...creds, baseUrl: "https://api-sandbox.skydropx.com/v1" },
      { fetchImpl }
    )

    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "https://api-sandbox.skydropx.com/v1/quotations"
    )
  })

  // FIX 1 (SSRF guard): a baseUrl that is not an allowlisted https skydropx host
  // MUST NOT receive the apiKey — the probe fails WITHOUT issuing the request.
  it.each([
    "http://attacker.example",
    "http://169.254.169.254/latest/meta-data/",
    "https://evil.example.com/v1",
  ])("refuses to send the apiKey to a non-skydropx base %s", async (baseUrl) => {
    const fetchImpl = fetchReturning(jsonResponse({}, 200))

    const result = await probeSkydropx({ ...creds, baseUrl }, { fetchImpl })

    expect(result.ok).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("fails on HTTP 401 blaming the API key", async () => {
    const result = await probeSkydropx(creds, {
      fetchImpl: fetchReturning(jsonResponse({}, 401)),
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/api key/i)
  })

  it("reports a timeout as failure with a reason", async () => {
    const result = await probeSkydropx(creds, {
      fetchImpl: hangingFetch,
      timeoutMs: 10,
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/timed out/i)
  })
})

describe("probeMercadopago", () => {
  const creds = { accessToken: "APP_USR-token-123", sandbox: true }

  it("passes on HTTP 200 calling /users/me with a Bearer token", async () => {
    const fetchImpl = fetchReturning(jsonResponse({ live_mode: false }))

    const result = await probeMercadopago(creds, { fetchImpl })

    expect(result.ok).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toBe("https://api.mercadopago.com/users/me")
    expect(
      (init?.headers as Record<string, string>)["Authorization"]
    ).toBe("Bearer APP_USR-token-123")
  })

  it("passes with a mismatch warning when live_mode conflicts with the mode", async () => {
    const result = await probeMercadopago(creds, {
      fetchImpl: fetchReturning(jsonResponse({ live_mode: true })),
    })

    expect(result.ok).toBe(true)
    expect(result.detail).toMatch(/mismatch|live/i)
  })

  it("fails on HTTP 401 blaming the token", async () => {
    const result = await probeMercadopago(creds, {
      fetchImpl: fetchReturning(jsonResponse({}, 401)),
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/token/i)
  })

  it("reports a timeout as failure with a reason", async () => {
    const result = await probeMercadopago(creds, {
      fetchImpl: hangingFetch,
      timeoutMs: 10,
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/timed out/i)
  })

  it("never throws on network-level fetch errors", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error("ECONNREFUSED")
    }) as unknown as typeof fetch

    const result = await probeMercadopago(creds, { fetchImpl })

    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/ECONNREFUSED|failed/i)
  })
})

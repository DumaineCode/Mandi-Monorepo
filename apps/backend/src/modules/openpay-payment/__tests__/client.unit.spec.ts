/**
 * S2.1 — OpenpayClient unit tests (hermetic, mocked global.fetch).
 *
 * Covers design §3.1/§6: Basic auth header (private key as user, empty
 * password), sandbox/prod base URL switch, 15s AbortController timeout,
 * typed OpenpayApiError on non-2xx responses.
 */
import { OpenpayClient, OPENPAY_REQUEST_TIMEOUT_MS } from "../client"
import { OpenpayApiError } from "../types"

const MERCHANT_ID = "m_test_123"
const PRIVATE_KEY = "sk_test_private"

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  }) as unknown as Response

describe("OpenpayClient", () => {
  let fetchMock: jest.SpyInstance

  beforeEach(() => {
    fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(jsonResponse({ id: "ch_1", status: "completed" }))
  })

  afterEach(() => {
    fetchMock.mockRestore()
    jest.useRealTimers()
  })

  it("sends HTTP Basic auth with the private key as user and empty password", async () => {
    const client = new OpenpayClient({
      merchantId: MERCHANT_ID,
      privateKey: PRIVATE_KEY,
      sandbox: true,
    })

    await client.getCharge("ch_1")

    const [, init] = fetchMock.mock.calls[0]
    const expected = `Basic ${Buffer.from(`${PRIVATE_KEY}:`).toString("base64")}`
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      expected
    )
  })

  it("uses the sandbox base URL when sandbox is true", async () => {
    const client = new OpenpayClient({
      merchantId: MERCHANT_ID,
      privateKey: PRIVATE_KEY,
      sandbox: true,
    })

    await client.getCharge("ch_1")

    expect(fetchMock).toHaveBeenCalledWith(
      `https://sandbox-api.openpay.mx/v1/${MERCHANT_ID}/charges/ch_1`,
      expect.objectContaining({ method: "GET" })
    )
  })

  it("uses the production base URL when sandbox is false", async () => {
    const client = new OpenpayClient({
      merchantId: MERCHANT_ID,
      privateKey: PRIVATE_KEY,
      sandbox: false,
    })

    await client.getCharge("ch_1")

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.openpay.mx/v1/${MERCHANT_ID}/charges/ch_1`,
      expect.objectContaining({ method: "GET" })
    )
  })

  it("aborts the request after the 15s timeout and throws a typed timeout error", async () => {
    jest.useFakeTimers()
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          )
        })
    )
    const client = new OpenpayClient({
      merchantId: MERCHANT_ID,
      privateKey: PRIVATE_KEY,
      sandbox: true,
    })

    const pending = client.getCharge("ch_slow")
    const assertion = expect(pending).rejects.toMatchObject({
      constructor: OpenpayApiError,
      errorCode: "timeout",
    })
    jest.advanceTimersByTime(OPENPAY_REQUEST_TIMEOUT_MS)
    await assertion
  })

  it("throws a typed OpenpayApiError carrying error_code and description on non-2xx", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error_code: 3001, description: "The card was declined", http_code: 402 },
        402
      )
    )
    const client = new OpenpayClient({
      merchantId: MERCHANT_ID,
      privateKey: PRIVATE_KEY,
      sandbox: true,
    })

    await expect(
      client.createCharge({
        method: "card",
        source_id: "tok_1",
        amount: 100,
        currency: "MXN",
        device_session_id: "dev_1",
        order_id: "sess_1-1",
        use_3d_secure: true,
        capture: true,
      })
    ).rejects.toMatchObject({
      constructor: OpenpayApiError,
      httpStatus: 402,
      errorCode: 3001,
      description: "The card was declined",
    })
  })
})

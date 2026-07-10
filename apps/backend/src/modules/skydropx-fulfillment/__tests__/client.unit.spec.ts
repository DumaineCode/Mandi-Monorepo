/**
 * S5.3 — SkydropxClient unit tests (hermetic, mocked global.fetch).
 *
 * Covers design §5.3/§5.4/§6: `Authorization: Token token={key}` header,
 * SKYDROPX_BASE_URL override (default https://api.skydropx.com/v1), 8s
 * AbortController timeout on quotations, typed SkydropxApiError on non-2xx,
 * and the endpoint surface (quotations, shipments, labels, label cancel).
 */
import { SkydropxClient, SKYDROPX_QUOTATION_TIMEOUT_MS } from "../client"
import { SkydropxApiError } from "../types"

const API_KEY = "sk_test_skydropx"
const DEFAULT_BASE_URL = "https://api.skydropx.com/v1"

const QUOTATION_BODY = {
  zip_from: "64000",
  zip_to: "06600",
  parcel: { weight: 1.23, length: 25, width: 15, height: 25 },
}

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  }) as unknown as Response

describe("SkydropxClient", () => {
  let fetchMock: jest.SpyInstance

  beforeEach(() => {
    fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(jsonResponse({ rates: [] }))
  })

  afterEach(() => {
    fetchMock.mockRestore()
    jest.useRealTimers()
  })

  it("sends the legacy token auth header: Token token={key}", async () => {
    const client = new SkydropxClient({ apiKey: API_KEY })

    await client.createQuotation(QUOTATION_BODY)

    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      `Token token=${API_KEY}`
    )
  })

  it("uses the default base URL when no override is provided", async () => {
    const client = new SkydropxClient({ apiKey: API_KEY })

    await client.createQuotation(QUOTATION_BODY)

    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_BASE_URL}/quotations`,
      expect.objectContaining({ method: "POST" })
    )
  })

  it("honors the SKYDROPX_BASE_URL override", async () => {
    const client = new SkydropxClient({
      apiKey: API_KEY,
      baseUrl: "https://api-pro.skydropx.example/v2",
    })

    await client.createQuotation(QUOTATION_BODY)

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-pro.skydropx.example/v2/quotations",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("exposes the full endpoint surface with the documented paths", async () => {
    const client = new SkydropxClient({ apiKey: API_KEY })

    await client.createShipment({
      address_from: { zip: "64000" },
      address_to: { zip: "06600" },
      parcels: [QUOTATION_BODY.parcel],
    })
    await client.createLabel({ rate_id: "rate_1" })
    await client.getLabel("lab_1")
    await client.cancelLabel("lab_1")

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      [`${DEFAULT_BASE_URL}/shipments`, "POST"],
      [`${DEFAULT_BASE_URL}/labels`, "POST"],
      [`${DEFAULT_BASE_URL}/labels/lab_1`, "GET"],
      [`${DEFAULT_BASE_URL}/labels/lab_1/cancel`, "POST"],
    ])
  })

  it("aborts quotations after the 8s timeout with a typed timeout error", async () => {
    jest.useFakeTimers()
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          )
        })
    )
    const client = new SkydropxClient({ apiKey: API_KEY })

    const pending = client.createQuotation(QUOTATION_BODY)
    const assertion = expect(pending).rejects.toMatchObject({
      constructor: SkydropxApiError,
      errorCode: "timeout",
    })
    jest.advanceTimersByTime(SKYDROPX_QUOTATION_TIMEOUT_MS)
    await assertion
  })

  it("throws a typed SkydropxApiError carrying status and description on non-2xx", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: "invalid_zip", message: "zip_to is invalid" }, 422)
    )
    const client = new SkydropxClient({ apiKey: API_KEY })

    await expect(client.createQuotation(QUOTATION_BODY)).rejects.toMatchObject({
      constructor: SkydropxApiError,
      httpStatus: 422,
      errorCode: "invalid_zip",
      description: "zip_to is invalid",
    })
  })
})

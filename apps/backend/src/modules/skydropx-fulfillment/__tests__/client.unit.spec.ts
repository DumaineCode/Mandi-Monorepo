/**
 * S2 — SkydropxClient PRO unit tests (hermetic, mocked global.fetch).
 *
 * Covers design §3 / spec Capability 2–3: OAuth2 client-credentials token
 * fetch + cache reuse, `Authorization: Bearer` (never `Token token=`), single
 * 401 refresh-and-retry, async quotation poll to completion + shared-budget
 * timeout, typed error-body mapping, defensive SSRF in the constructor, and the
 * PRO cancellations endpoint.
 */
import {
  SkydropxClient,
  DEFAULT_BASE_URL,
} from "../client"
import { SkydropxApiError } from "../types"

const CLIENT_ID = "sky_client_id"
const CLIENT_SECRET = "sky_client_secret_value"

const QUOTATION_BODY = {
  quotation: {
    address_from: { country_code: "MX", postal_code: "06600" },
    address_to: { country_code: "MX", postal_code: "64000" },
    parcels: [{ length: 25, width: 15, height: 25, weight: 1.23 }],
  },
}

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  }) as unknown as Response

const tokenResponse = () =>
  jsonResponse({ access_token: "tok_123", token_type: "Bearer", expires_in: 7200 })

/** Route the mocked fetch by (method, path) so token + API calls interleave. */
const routeFetch = (
  fetchMock: jest.SpyInstance,
  handlers: Record<string, (init: RequestInit) => Response>
) => {
  fetchMock.mockImplementation((url: string, init: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? "GET"
    let key = ""
    if (u.includes("/oauth/token")) key = "POST /oauth/token"
    else if (u.includes("/cancellations")) key = "POST /cancellations"
    else if (u.includes("/quotations")) key = `${method} /quotations`
    else if (u.includes("/shipments")) key = `${method} /shipments`
    const handler = handlers[key]
    if (!handler) {
      return Promise.reject(new Error(`no handler for ${key} (${u})`))
    }
    return Promise.resolve(handler(init))
  })
}

describe("SkydropxClient (PRO OAuth)", () => {
  let fetchMock: jest.SpyInstance

  beforeEach(() => {
    fetchMock = jest.spyOn(global, "fetch")
  })

  afterEach(() => {
    fetchMock.mockRestore()
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  const makeClient = (baseUrl?: string) =>
    new SkydropxClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      baseUrl,
    })

  describe("OAuth token (Capability 2)", () => {
    it("fetches the token via client-credentials then sends it as Bearer", async () => {
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /quotations": () =>
          jsonResponse({ id: "q1", is_completed: true, rates: [] }),
      })
      const client = makeClient()

      await client.createQuotation(QUOTATION_BODY)

      const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]
      expect(String(tokenUrl)).toBe(`${DEFAULT_BASE_URL}/oauth/token`)
      expect(JSON.parse((tokenInit as RequestInit).body as string)).toEqual({
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      })

      const apiInit = fetchMock.mock.calls[1][1] as RequestInit
      expect((apiInit.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer tok_123"
      )
    })

    it("never sends the legacy Token token= header", async () => {
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /quotations": () =>
          jsonResponse({ id: "q1", is_completed: true, rates: [] }),
      })
      const client = makeClient()

      await client.createQuotation(QUOTATION_BODY)

      for (const [, init] of fetchMock.mock.calls) {
        const auth = (init.headers as Record<string, string>)?.["Authorization"]
        expect(auth ?? "").not.toContain("Token token=")
      }
    })

    it("reuses the cached token across calls (no re-fetch within TTL)", async () => {
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /quotations": () =>
          jsonResponse({ id: "q1", is_completed: true, rates: [] }),
      })
      const client = makeClient()

      await client.createQuotation(QUOTATION_BODY)
      await client.createQuotation(QUOTATION_BODY)

      const tokenCalls = fetchMock.mock.calls.filter(([u]) =>
        String(u).includes("/oauth/token")
      )
      expect(tokenCalls).toHaveLength(1)
    })

    it("refreshes the token once on a 401 and retries the call (then surfaces a second 401)", async () => {
      // First quotation call 401s, retry after refresh succeeds.
      let quotationCalls = 0
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /quotations": () => {
          quotationCalls += 1
          return quotationCalls === 1
            ? jsonResponse({ error: "unauthorized" }, 401)
            : jsonResponse({ id: "q1", is_completed: true, rates: [] })
        },
      })
      const client = makeClient()

      await expect(client.createQuotation(QUOTATION_BODY)).resolves.toMatchObject({
        id: "q1",
      })
      const tokenCalls = fetchMock.mock.calls.filter(([u]) =>
        String(u).includes("/oauth/token")
      )
      expect(tokenCalls).toHaveLength(2) // initial + refresh

      // A persistent 401 surfaces after the single retry (no infinite loop).
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /quotations": () => jsonResponse({ error: "unauthorized" }, 401),
      })
      const client2 = makeClient()
      await expect(
        client2.createQuotation(QUOTATION_BODY)
      ).rejects.toMatchObject({ constructor: SkydropxApiError, httpStatus: 401 })
    })
  })

  describe("async quotation (Capability 3)", () => {
    it("polls create→get until is_completed then returns rates", async () => {
      let getCalls = 0
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /quotations": () =>
          jsonResponse({ id: "q1", is_completed: false }),
        "GET /quotations": () => {
          getCalls += 1
          return getCalls < 2
            ? jsonResponse({ id: "q1", is_completed: false })
            : jsonResponse({
                id: "q1",
                is_completed: true,
                rates: [
                  { id: "r1", provider_name: "fedex", total: "150.50", success: true },
                ],
              })
        },
      })
      const client = makeClient()
      jest.spyOn(client as any, "sleep_").mockResolvedValue(undefined)

      const rates = await client.quoteAndPoll_(
        QUOTATION_BODY,
        Date.now() + 8_000
      )

      expect(rates).toHaveLength(1)
      expect(rates[0].total).toBe("150.50")
    })

    it("surfaces a timeout error when the quotation never completes within the budget", async () => {
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /quotations": () =>
          jsonResponse({ id: "q1", is_completed: false }),
        "GET /quotations": () =>
          jsonResponse({ id: "q1", is_completed: false }),
      })
      const client = makeClient()
      jest.spyOn(client as any, "sleep_").mockResolvedValue(undefined)

      // Deadline already in the past → loop times out immediately.
      await expect(
        client.quoteAndPoll_(QUOTATION_BODY, Date.now() - 1)
      ).rejects.toMatchObject({
        constructor: SkydropxApiError,
        errorCode: "timeout",
      })
    })
  })

  describe("error mapping + endpoints", () => {
    it("maps non-2xx bodies to a typed SkydropxApiError (error / error_description)", async () => {
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /quotations": () =>
          jsonResponse(
            { error: "unprocessable_entity", error_description: "zip invalid" },
            422
          ),
      })
      const client = makeClient()

      await expect(
        client.createQuotation(QUOTATION_BODY)
      ).rejects.toMatchObject({
        constructor: SkydropxApiError,
        httpStatus: 422,
        errorCode: "unprocessable_entity",
        description: "zip invalid",
      })
    })

    it("cancelShipment POSTs the PRO cancellations endpoint with a reason", async () => {
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /cancellations": () =>
          jsonResponse({ id: "c1", status: "approved", success: true }),
      })
      const client = makeClient()

      await client.cancelShipment("shp_1", "cancelled by admin")

      const cancelCall = fetchMock.mock.calls.find(([u]) =>
        String(u).includes("/cancellations")
      )
      expect(String(cancelCall?.[0])).toBe(
        `${DEFAULT_BASE_URL}/shipments/shp_1/cancellations`
      )
      expect(
        JSON.parse((cancelCall?.[1] as RequestInit).body as string)
      ).toEqual({ reason: "cancelled by admin" })
    })
  })

  describe("SSRF constructor guard (design D1)", () => {
    it("throws before any request when baseUrl is not a skydropx.com host", () => {
      expect(() =>
        makeClient("https://evil.example.com/api/v1")
      ).toThrow()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("constructs fine with the pinned PRO host", () => {
      expect(() =>
        makeClient("https://api-pro.skydropx.com/api/v1")
      ).not.toThrow()
    })
  })
})

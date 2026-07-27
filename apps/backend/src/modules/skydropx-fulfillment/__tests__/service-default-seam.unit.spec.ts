/**
 * NEW-1 — executable pin for the DEFAULT stock-location seam wiring.
 *
 * `service.unit.spec.ts` is the only place that constructs this service, and it
 * always injects `stockLocationSource`, so `options.stockLocationSource ??
 * makeStockLocationSource()` had no test at all: the fallback could be deleted
 * or mis-resolved and the whole suite stayed green.
 *
 * Why that is dangerous rather than cosmetic: with no default,
 * `this.stockLocationSource_` is `undefined`, `readStockLocation_` calls
 * `undefined(locationId)`, and its synchronous `catch` swallows the `TypeError`
 * into `{ ok: false }`. Every label then fails as "infrastructure failure, retry
 * the label" — a wiring bug permanently disguised as a DB incident, with green
 * CI. These tests fail loudly instead.
 *
 * The load-bearing one is the BEHAVIORAL test: the default source is invoked and
 * its origin reaches the wire. A fourth test used to assert the disguise itself
 * by nulling `stockLocationSource_` on a built instance — it set up its own
 * precondition, asserted the consequence of that setup, SURVIVED the mutation it
 * was written to guard against, and defeated `private readonly` to do it. It was
 * removed rather than kept as false assurance.
 *
 * This lives in its OWN file because it needs a module-level `jest.mock` of
 * `../../../lib/stock-location-address`, which must not leak into the main spec.
 */
import { makeStockLocationSource } from "../../../lib/stock-location-address"
import SkydropxFulfillmentProviderService from "../service"

/** The function the mocked factory hands back — the identity we assert on. */
const mockDefaultSource = jest.fn()

jest.mock("../../../lib/stock-location-address", () => {
  const actual = jest.requireActual("../../../lib/stock-location-address")
  return {
    ...actual,
    makeStockLocationSource: jest.fn(() => mockDefaultSource),
  }
})

const makeStockLocationSourceMock = makeStockLocationSource as jest.Mock

const config = {
  clientId: "sky_client_id",
  clientSecret: "sky_client_secret_value",
  consignmentNote: "53102400",
  packageType: "4G",
  originEmail: "ops@mandi.mx",
}

const stockLocation = {
  name: "CDMX Warehouse",
  address: {
    address_1: "Valle del Carmen 184",
    address_2: "Valle de Aragon",
    city: "Ciudad Nezahualcoyotl",
    province: "México",
    postal_code: "57100",
    country_code: "mx",
    company: "Bodega Mandi",
    phone: "5555550100",
  },
}

const makeLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
})

/** Constructs the service the way medusa-config does: NO seam injected. */
const makeServiceWithoutSeam = () =>
  new SkydropxFulfillmentProviderService(
    { logger: makeLogger() },
    { credentialSource: (async () => config) as any }
  )

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  }) as unknown as Response

const order = {
  display_id: 42,
  items: [
    {
      id: "li_1",
      quantity: 2,
      variant: { weight: 500, length: 10, width: 8, height: 4 },
    },
  ],
  customer: { email: "ana@example.com", phone: "5544332211" },
  shipping_address: {
    first_name: "Ana",
    last_name: "López",
    address_1: "Av. Reforma 1",
    city: "Monterrey",
    province: "NL",
    postal_code: "64000",
    country_code: "mx",
    phone: "8110000000",
  },
} as any

const fulfillment = { location_id: "sloc_1" } as any

describe("default stock-location seam wiring (NEW-1)", () => {
  let fetchMock: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    makeStockLocationSourceMock.mockImplementation(() => mockDefaultSource)
    fetchMock = jest.spyOn(global, "fetch")
  })

  afterEach(() => {
    fetchMock.mockRestore()
  })

  it("builds a source from makeStockLocationSource() when none is injected", () => {
    const service = makeServiceWithoutSeam()

    expect(makeStockLocationSourceMock).toHaveBeenCalledTimes(1)
    // Not just truthy: `readStockLocation_` CALLS this value, so anything that is
    // not a function turns every label into a fake infrastructure incident.
    expect(typeof (service as any).stockLocationSource_).toBe("function")
    expect((service as any).stockLocationSource_).toBe(mockDefaultSource)
  })

  it("still prefers an injected source over the default", () => {
    const injected = jest.fn()
    const service = new SkydropxFulfillmentProviderService(
      { logger: makeLogger() },
      {
        credentialSource: (async () => config) as any,
        stockLocationSource: injected as any,
      }
    )

    expect((service as any).stockLocationSource_).toBe(injected)
    expect(makeStockLocationSourceMock).not.toHaveBeenCalled()
  })

  it("INVOKES the default source on the label path and puts its origin on the wire", async () => {
    mockDefaultSource.mockResolvedValue(stockLocation)
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      const u = String(url)
      if (u.includes("/oauth/token")) {
        return Promise.resolve(
          jsonResponse({
            access_token: "tok_123",
            token_type: "Bearer",
            expires_in: 7200,
          })
        )
      }
      if (u.includes("/quotations")) {
        return Promise.resolve(
          jsonResponse({
            id: "q1",
            is_completed: true,
            rates: [
              {
                id: "rate_cheap",
                provider_name: "estafeta",
                total: "140",
                days: 3,
                success: true,
              },
            ],
          })
        )
      }
      if (u.includes("/shipments") && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse({
            id: "shp_1",
            workflow_status: "success",
            master_tracking_number: "TRK123",
            included: [
              {
                attributes: {
                  tracking_number: "TRK123",
                  label_url: "https://labels.example/shp_1.pdf",
                },
              },
            ],
          })
        )
      }
      return Promise.reject(new Error(`no handler for ${u}`))
    })

    const service = makeServiceWithoutSeam()
    const result = await service.createFulfillment(
      { id: "skydropx-standard" },
      [{ quantity: 2, line_item_id: "li_1" }] as any,
      order,
      fulfillment
    )

    expect(mockDefaultSource).toHaveBeenCalledWith("sloc_1")
    const shipmentCall = fetchMock.mock.calls.find(
      ([u, i]) =>
        String(u).includes("/shipments") && (i as RequestInit).method === "POST"
    )
    const body = JSON.parse((shipmentCall?.[1] as RequestInit).body as string)
    expect(body.shipment.address_from.street1).toBe("Valle del Carmen 184")
    expect(result.data).toMatchObject({ shipment_id: "shp_1" })
  })
})

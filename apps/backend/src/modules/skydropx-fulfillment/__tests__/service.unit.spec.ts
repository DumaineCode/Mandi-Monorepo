/**
 * S3 — SkydropxFulfillmentProviderService PRO unit tests (hermetic, mocked fetch).
 *
 * Coverage per design §4 + spec Capabilities 3–6:
 * - options surface (SD-1)
 * - calculatePrice: async quotation from the destination address hierarchy;
 *   `normalizeState` code→name; cheapest usable rate; `calculated_amount =
 *   Number(rate.total)` as-is MXN, tax-inclusive true (DB override honored, env
 *   never read); usable-rate filter; degrade-to-manual on missing dims/address/
 *   zero-rates/API-error/timeout (SD-3)
 * - createFulfillment: fresh quote → shipment → poll → tracking/label;
 *   requires_origin_verification and missing Carta Porte fail loud (SD-4);
 *   orphaned-shipment best-effort cancel; rate-delta log
 * - validateOptions clientId/clientSecret; unconfigured inert; cancel via
 *   the PRO cancellations endpoint
 */
import { MedusaError } from "@medusajs/framework/utils"
import SkydropxFulfillmentProviderService, {
  normalizeState,
} from "../service"

const CLIENT_ID = "sky_client_id"
const CLIENT_SECRET = "sky_client_secret_value"
const ORIGIN_ZIP = "01000"

const config = {
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  originZip: ORIGIN_ZIP,
  consignmentNote: "53102400",
  packageType: "4G",
}

const makeLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
})

const makeService = (
  overrides: Record<string, unknown> | null = {},
  logger = makeLogger()
) => {
  const credentialSource =
    overrides === null
      ? async () => null
      : async () => ({ ...config, ...overrides })
  const service = new SkydropxFulfillmentProviderService(
    { logger },
    { credentialSource: credentialSource as any }
  )
  return { service, logger }
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

/** Route the mocked fetch by (method, path); the token is always served. */
const mockApi = (
  fetchMock: jest.SpyInstance,
  handlers: Record<string, (init: RequestInit) => Response>
) => {
  const all = { "POST /oauth/token": () => tokenResponse(), ...handlers }
  fetchMock.mockImplementation((url: string, init: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? "GET"
    let key = ""
    if (u.includes("/oauth/token")) key = "POST /oauth/token"
    else if (u.includes("/cancellations")) key = "POST /cancellations"
    else if (u.includes("/quotations")) key = `${method} /quotations`
    else if (u.includes("/shipments")) key = `${method} /shipments`
    const handler = all[key]
    if (!handler) {
      return Promise.reject(new Error(`no handler for ${key} (${u})`))
    }
    return Promise.resolve(handler(init))
  })
}

const completedQuotation = (rates: unknown[]) => () =>
  jsonResponse({ id: "q1", is_completed: true, rates })

/** Cart context per CalculateShippingOptionPriceDTO["context"]. */
const cartContext = (overrides: Record<string, unknown> = {}) =>
  ({
    shipping_address: {
      country_code: "mx",
      postal_code: "64000",
      province: "NL",
      city: "Monterrey",
    },
    from_location: {
      address: {
        country_code: "mx",
        postal_code: "06600",
        province: "CDMX",
        city: "Ciudad de México",
      },
    },
    items: [
      { quantity: 2, variant: { weight: 500, length: 10, width: 8, height: 4 } },
    ],
    ...overrides,
  }) as any

const OPTION_DATA = { id: "skydropx-standard" }

describe("SkydropxFulfillmentProviderService (PRO)", () => {
  let fetchMock: jest.SpyInstance

  beforeEach(() => {
    fetchMock = jest.spyOn(global, "fetch")
  })

  afterEach(() => {
    fetchMock.mockRestore()
    jest.restoreAllMocks()
  })

  describe("normalizeState (seam, design D3)", () => {
    it("maps a known MX code to the full state name", () => {
      expect(normalizeState("NL")).toBe("Nuevo León")
      expect(normalizeState("MX-NLE")).toBe("Nuevo León")
    })

    it("passes through a value that is already a full name", () => {
      expect(normalizeState("Nuevo León")).toBe("Nuevo León")
    })
  })

  describe("options surface (SD-1)", () => {
    it("exposes the skydropx identifier", () => {
      expect(SkydropxFulfillmentProviderService.identifier).toBe("skydropx")
    })

    it("getFulfillmentOptions returns the single skydropx-standard option", async () => {
      const { service } = makeService()
      await expect(service.getFulfillmentOptions()).resolves.toEqual([
        { id: "skydropx-standard", name: "Envío estándar" },
      ])
    })

    it("validateOption accepts skydropx-standard and rejects unknown ids", async () => {
      const { service } = makeService()
      await expect(service.validateOption(OPTION_DATA)).resolves.toBe(true)
      await expect(service.validateOption({ id: "other" })).resolves.toBe(false)
    })
  })

  describe("calculatePrice (Capability 3 / SD-3)", () => {
    it("builds the quotation from the destination address hierarchy and returns rate.total as-is", async () => {
      mockApi(fetchMock, {
        "POST /quotations": completedQuotation([
          { id: "r1", provider_name: "estafeta", total: "150.50", days: 3, success: true },
        ]),
      })
      const { service } = makeService()

      const price = await service.calculatePrice(OPTION_DATA, {}, cartContext())

      const quotationCall = fetchMock.mock.calls.find(
        ([u, i]) =>
          String(u).includes("/quotations") &&
          (i as RequestInit).method === "POST"
      )
      const body = JSON.parse((quotationCall?.[1] as RequestInit).body as string)
      expect(body.quotation.address_to).toMatchObject({
        country_code: "MX",
        postal_code: "64000",
        area_level1: "Nuevo León",
        area_level2: "Monterrey",
      })
      expect(body.quotation.address_from.area_level1).toBe("Ciudad de México")
      // Amount as-is MXN — never cent-converted.
      expect(price.calculated_amount).toBe(150.5)
      expect(price.is_calculated_price_tax_inclusive).toBe(true)
    })

    it("omits area_level3 when the cart has no colonia source but includes it when present", async () => {
      mockApi(fetchMock, {
        "POST /quotations": completedQuotation([
          { id: "r1", provider_name: "dhl", total: "99", success: true },
        ]),
      })
      const { service } = makeService()

      await service.calculatePrice(
        OPTION_DATA,
        {},
        cartContext({
          shipping_address: {
            country_code: "mx",
            postal_code: "64000",
            province: "NL",
            city: "Monterrey",
            address_2: "Centro",
          },
        })
      )

      const quotationCall = fetchMock.mock.calls.find(
        ([u, i]) =>
          String(u).includes("/quotations") &&
          (i as RequestInit).method === "POST"
      )
      const body = JSON.parse((quotationCall?.[1] as RequestInit).body as string)
      expect(body.quotation.address_to.area_level3).toBe("Centro")
    })

    it("falls back to the origin zip setting when the stock location has none", async () => {
      mockApi(fetchMock, {
        "POST /quotations": completedQuotation([
          { id: "r1", provider_name: "dhl", total: "99", success: true },
        ]),
      })
      const { service } = makeService()

      await service.calculatePrice(
        OPTION_DATA,
        {},
        cartContext({
          from_location: {
            address: { country_code: "mx", province: "CDMX", city: "CDMX" },
          },
        })
      )

      const quotationCall = fetchMock.mock.calls.find(
        ([u, i]) =>
          String(u).includes("/quotations") &&
          (i as RequestInit).method === "POST"
      )
      const body = JSON.parse((quotationCall?.[1] as RequestInit).body as string)
      expect(body.quotation.address_from.postal_code).toBe(ORIGIN_ZIP)
    })

    it("honors the DB taxInclusive:false override and never reads the env", async () => {
      mockApi(fetchMock, {
        "POST /quotations": completedQuotation([
          { id: "r1", provider_name: "dhl", total: "99", success: true },
        ]),
      })
      const previous = process.env.SKYDROPX_TAX_INCLUSIVE
      process.env.SKYDROPX_TAX_INCLUSIVE = "true"
      try {
        const { service } = makeService({ taxInclusive: false })
        const price = await service.calculatePrice(OPTION_DATA, {}, cartContext())
        expect(price.is_calculated_price_tax_inclusive).toBe(false)
      } finally {
        if (previous === undefined) delete process.env.SKYDROPX_TAX_INCLUSIVE
        else process.env.SKYDROPX_TAX_INCLUSIVE = previous
      }
    })

    it("selects the cheapest usable rate and filters unpriced/unsuccessful rates", async () => {
      mockApi(fetchMock, {
        "POST /quotations": completedQuotation([
          { id: "r-nan", provider_name: "aa", total: "not-a-number", success: true },
          { id: "r-nocov", provider_name: "bb", total: "10", success: true, status: "no_coverage" },
          { id: "r-fail", provider_name: "cc", total: "20", success: false },
          { id: "r-expensive", provider_name: "dhl", total: "200", days: 1, success: true },
          { id: "r-cheap", provider_name: "estafeta", total: "150", days: 4, success: true },
        ]),
      })
      const { service } = makeService()

      const price = await service.calculatePrice(OPTION_DATA, {}, cartContext())
      expect(price.calculated_amount).toBe(150)
    })

    it("degrades to manual (INVALID_DATA) without an API call when dims are missing (SD-3)", async () => {
      const { service } = makeService()
      const context = cartContext({
        items: [{ quantity: 1, variant: { weight: 500, length: 10, width: 8 } }],
      })

      await expect(
        service.calculatePrice(OPTION_DATA, {}, context)
      ).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("degrades to manual when the destination state/city is missing (SD-3)", async () => {
      const { service } = makeService()
      await expect(
        service.calculatePrice(
          OPTION_DATA,
          {},
          cartContext({
            shipping_address: { country_code: "mx", postal_code: "64000" },
          })
        )
      ).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("degrades gracefully when the quotation returns zero usable rates (SD-3)", async () => {
      mockApi(fetchMock, { "POST /quotations": completedQuotation([]) })
      const { service } = makeService()

      await expect(
        service.calculatePrice(OPTION_DATA, {}, cartContext())
      ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
    })

    it("translates API errors into a graceful MedusaError (SD-3)", async () => {
      mockApi(fetchMock, {
        "POST /quotations": () =>
          jsonResponse({ error: "server_error", error_description: "boom" }, 500),
      })
      const { service } = makeService()

      await expect(
        service.calculatePrice(OPTION_DATA, {}, cartContext())
      ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
    })
  })

  describe("createFulfillment (Capability 5 / SD-4)", () => {
    const fulfillmentItems = [{ quantity: 2, line_item_id: "li_1" }] as any[]

    const order = {
      display_id: 42,
      email: "buyer@example.com",
      items: [
        {
          id: "li_1",
          quantity: 2,
          variant: { weight: 500, length: 10, width: 8, height: 4 },
        },
      ],
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
      shipping_methods: [{ amount: 150.5 }],
    } as any

    const fulfillment = {
      location: {
        name: "CDMX Warehouse",
        address: {
          address_1: "Calle Origen 5",
          city: "Ciudad de México",
          province: "CDMX",
          postal_code: "06600",
          country_code: "mx",
        },
      },
    } as any

    const quoteRates = [
      { id: "rate_cheap", provider_name: "estafeta", total: "140", days: 3, success: true },
      { id: "rate_dear", provider_name: "dhl", total: "220", days: 1, success: true },
    ]

    const successShipment = {
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
    }

    it("fresh-quotes, buys the shipment with the cheapest rate, and returns tracking + label", async () => {
      mockApi(fetchMock, {
        "POST /quotations": completedQuotation(quoteRates),
        "POST /shipments": () => jsonResponse(successShipment),
      })
      const { service, logger } = makeService()

      const result = await service.createFulfillment(
        { id: "skydropx-standard" },
        fulfillmentItems,
        order,
        fulfillment
      )

      const shipmentCall = fetchMock.mock.calls.find(
        ([u, i]) =>
          String(u).includes("/shipments") &&
          (i as RequestInit).method === "POST"
      )
      const shipmentBody = JSON.parse(
        (shipmentCall?.[1] as RequestInit).body as string
      )
      expect(shipmentBody.shipment.rate_id).toBe("rate_cheap")
      expect(shipmentBody.shipment.packages[0]).toMatchObject({
        consignment_note: "53102400",
        package_type: "4G",
      })

      expect(result.data).toMatchObject({
        shipment_id: "shp_1",
        rate_id: "rate_cheap",
        tracking_number: "TRK123",
        label_url: "https://labels.example/shp_1.pdf",
      })
      expect(result.labels).toEqual([
        {
          tracking_number: "TRK123",
          tracking_url: "",
          label_url: "https://labels.example/shp_1.pdf",
        },
      ])
      // Quote-vs-label rate delta is logged for ops visibility (Capability 6).
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("delta"))
    })

    it("fails loud (UNEXPECTED_STATE) when the selected rate requires origin verification (D5)", async () => {
      mockApi(fetchMock, {
        "POST /quotations": completedQuotation([
          {
            id: "rate_cheap",
            provider_name: "estafeta",
            total: "140",
            days: 3,
            success: true,
            requires_origin_verification: true,
          },
        ]),
      })
      const { service } = makeService()

      await expect(
        service.createFulfillment(
          { id: "skydropx-standard" },
          fulfillmentItems,
          order,
          fulfillment
        )
      ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
    })

    it("fails loud when Carta Porte fields are absent for an MX label (D2)", async () => {
      mockApi(fetchMock, {
        "POST /quotations": completedQuotation(quoteRates),
      })
      // No consignmentNote / packageType configured.
      const { service } = makeService({
        consignmentNote: undefined,
        packageType: undefined,
      })

      await expect(
        service.createFulfillment(
          { id: "skydropx-standard" },
          fulfillmentItems,
          order,
          fulfillment
        )
      ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
    })

    it("best-effort cancels the orphaned shipment and throws when it fails after creation", async () => {
      // Shipment is created (pending) but the follow-up poll reports a failure via
      // error_detail → getShipment fast-fails → the orphaned shipment is cancelled.
      mockApi(fetchMock, {
        "POST /quotations": completedQuotation(quoteRates),
        "POST /shipments": () =>
          jsonResponse({ id: "shp_1", workflow_status: "pending" }),
        "GET /shipments": () =>
          jsonResponse({
            id: "shp_1",
            workflow_status: "pending",
            error_detail: { error_code: "failed", error_message: "carrier rejected" },
          }),
        "POST /cancellations": () =>
          jsonResponse({ id: "c1", status: "approved", success: true }),
      })
      const { service, logger } = makeService()
      jest.spyOn(service as any, "sleep_").mockResolvedValue(undefined)

      await expect(
        service.createFulfillment(
          { id: "skydropx-standard" },
          fulfillmentItems,
          order,
          fulfillment
        )
      ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })

      const cancelCall = fetchMock.mock.calls.find(([u]) =>
        String(u).includes("/cancellations")
      )
      expect(cancelCall).toBeDefined()
      const reconciliationLog = (logger.error as jest.Mock).mock.calls.find(
        ([m]) => String(m).includes("shp_1")
      )
      expect(reconciliationLog).toBeDefined()
    })

    it("throws UNEXPECTED_STATE when shipment creation fails (SD-4)", async () => {
      mockApi(fetchMock, {
        "POST /quotations": completedQuotation(quoteRates),
        "POST /shipments": () =>
          jsonResponse({ error: "unprocessable_entity", error_description: "no funds" }, 422),
      })
      const { service } = makeService()

      await expect(
        service.createFulfillment(
          { id: "skydropx-standard" },
          fulfillmentItems,
          order,
          fulfillment
        )
      ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
    })
  })

  describe("unconfigured provider (source → null) — fail-safe inert", () => {
    it("calculatePrice rejects with INVALID_DATA and never calls the API", async () => {
      const { service } = makeService(null)
      await expect(
        service.calculatePrice(OPTION_DATA, {}, cartContext())
      ).rejects.toMatchObject({
        type: MedusaError.Types.INVALID_DATA,
        message: expect.stringContaining("not configured"),
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("cancelFulfillment logs and proceeds without the API", async () => {
      const { service, logger } = makeService(null)
      await expect(
        service.cancelFulfillment({ shipment_id: "shp_1" })
      ).resolves.not.toThrow()
      expect(fetchMock).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalled()
    })
  })

  describe("validateOptions (always-registered, empty options valid)", () => {
    it("accepts an EMPTY options object", () => {
      expect(() =>
        SkydropxFulfillmentProviderService.validateOptions({})
      ).not.toThrow()
    })

    it("rejects a present-but-empty clientId or clientSecret", () => {
      expect(() =>
        SkydropxFulfillmentProviderService.validateOptions({ clientId: "" })
      ).toThrow(MedusaError)
      expect(() =>
        SkydropxFulfillmentProviderService.validateOptions({ clientSecret: "" })
      ).toThrow(MedusaError)
    })
  })

  describe("cancelFulfillment (SD-4 cancel via PRO cancellations)", () => {
    it("cancels the shipment via the cancellations endpoint", async () => {
      mockApi(fetchMock, {
        "POST /cancellations": () =>
          jsonResponse({ id: "c1", status: "approved", success: true }),
      })
      const { service } = makeService()

      await service.cancelFulfillment({ shipment_id: "shp_1" })

      const cancelCall = fetchMock.mock.calls.find(([u]) =>
        String(u).includes("/cancellations")
      )
      expect(String(cancelCall?.[0])).toContain("/shipments/shp_1/cancellations")
    })

    it("tolerates 'not cancellable' provider errors via log-and-proceed", async () => {
      mockApi(fetchMock, {
        "POST /cancellations": () =>
          jsonResponse({ error: "unprocessable_entity", error_description: "not cancellable" }, 422),
      })
      const { service, logger } = makeService()

      await expect(
        service.cancelFulfillment({ shipment_id: "shp_1" })
      ).resolves.not.toThrow()
      expect(logger.warn).toHaveBeenCalled()
    })

    it("is a no-op without a shipment id", async () => {
      const { service } = makeService()
      await expect(service.cancelFulfillment({})).resolves.not.toThrow()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})

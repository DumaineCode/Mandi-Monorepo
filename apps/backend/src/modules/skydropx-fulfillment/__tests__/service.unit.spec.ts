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
 *   origin resolved from `fulfillment.location_id` through the stock-location
 *   seam (the Fulfillment entity carries NO `location` relation);
 *   requires_origin_verification and missing Carta Porte fail loud (SD-4);
 *   orphaned-shipment best-effort cancel; rate-delta log
 * - validateOptions clientId/clientSecret; unconfigured inert; cancel via
 *   the PRO cancellations endpoint
 */
import { MedusaError } from "@medusajs/framework/utils"
import {
  STOCK_LOCATION_NOT_FOUND,
  STOCK_LOCATION_RESOLUTION_TIMEOUT_MS,
} from "../../../lib/stock-location-address"
import SkydropxFulfillmentProviderService, {
  normalizePhone,
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
  // `stock_location_address` has NO email column, but PRO requires an email on
  // `address_from`, so a shippable setup ALWAYS has this set (design §4.1).
  originEmail: "ops@mandi.mx",
}

/**
 * What the stock-location seam resolves for `location_id: "sloc_1"`.
 *
 * Complete on purpose: this is the origin every label test uses, and the origin
 * pre-flight validates the full shipment `address_from` shape before quoting.
 */
const stockLocation = (over: Record<string, unknown> = {}) => ({
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
    ...over,
  },
})

const makeLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
})

const makeService = (
  overrides: Record<string, unknown> | null = {},
  logger = makeLogger(),
  // The seam is injected for EVERY service under test: the Fulfillment entity
  // Medusa hands the provider carries only `location_id`, so this is the path
  // production actually takes.
  stockLocationSource: jest.Mock = jest.fn().mockResolvedValue(stockLocation())
) => {
  const credentialSource =
    overrides === null
      ? async () => null
      : async () => ({ ...config, ...overrides })
  const service = new SkydropxFulfillmentProviderService(
    { logger },
    {
      credentialSource: credentialSource as any,
      stockLocationSource: stockLocationSource as any,
    }
  )
  return { service, logger, stockLocationSource }
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

  /**
   * CRITICAL 1. The storefront `pattern` is the friendly front door; this is the
   * seam that decides what actually reaches `address_to.phone` /
   * `address_from.phone`. Both lists below are the reviewers' executed cases: the
   * first is what the old exactly-10-digit pattern accepted, the second is what it
   * REJECTED — including `+52…` (what MX tel autofill stores) and `5215555555555`
   * (the form Skydropx's own docs use).
   */
  describe("normalizePhone (seam, CRITICAL 1)", () => {
    it.each([
      ["5512345678", "5512345678"],
      ["55 1234 5678", "5512345678"],
      ["(55) 1234-5678", "5512345678"],
      ["55-1234-5678", "5512345678"],
    ])("reduces the national form %s to bare digits", (input, expected) => {
      expect(normalizePhone(input)).toBe(expected)
    })

    it.each([
      ["+52 55 1234 5678", "525512345678"],
      ["+525512345678", "525512345678"],
      ["52 55 1234 5678", "525512345678"],
      ["+521 55 1234 5678", "5215512345678"],
    ])("preserves the %s country prefix", (input, expected) => {
      expect(normalizePhone(input)).toBe(expected)
    })

    it("leaves the Skydropx-documented 5215555555555 form untouched", () => {
      expect(normalizePhone("5215555555555")).toBe("5215555555555")
    })

    it.each(["01 55 1234 5678", "044 55 1234 5678", "045 55 1234 5678"])(
      "strips the legacy trunk prefix in %s",
      (input) => {
        expect(normalizePhone(input)).toBe("5512345678")
      }
    )

    it.each([undefined, null, "", "   "])(
      "reports %p as absent so the settings fallback can take over",
      (input) => {
        expect(normalizePhone(input)).toBeUndefined()
      }
    )

    /**
     * The guard's promise is "no more opaque 422". Emitting "" for a value the
     * pre-flight already accepted would BREAK that promise from the other side, so
     * a digitless value is passed through for PRO to name.
     */
    it("never blanks a non-blank value that carries no digits", () => {
      expect(normalizePhone("n/a")).toBe("n/a")
      expect(normalizePhone("  sin teléfono  ")).toBe("sin teléfono")
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
      const { service, stockLocationSource } = makeService()

      const price = await service.calculatePrice(OPTION_DATA, {}, cartContext())

      // The quote path reads `ctx.from_location.address` and MUST NOT touch the
      // stock-location seam — that read is label-path only (design §4.1).
      expect(stockLocationSource).not.toHaveBeenCalled()

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

    /**
     * EXACTLY what the fulfillment module passes: the Medusa `Fulfillment`
     * entity has NO `location` relation, only `location_id`. Every label test
     * uses this shape so the whole suite exercises the stock-location seam, the
     * path production actually takes.
     */
    const fulfillment = { location_id: "sloc_1" } as any

    /** Read a POSTed request body by path (quotation / shipment). */
    const bodyOf = (path: string) => {
      const call = fetchMock.mock.calls.find(
        ([u, i]) =>
          String(u).includes(path) && (i as RequestInit).method === "POST"
      )
      return JSON.parse((call?.[1] as RequestInit).body as string)
    }

    /** Reject and return the thrown error, so several fields can be asserted. */
    const failLabel = async (
      service: SkydropxFulfillmentProviderService,
      target: unknown = fulfillment
    ): Promise<any> =>
      service
        .createFulfillment(
          { id: "skydropx-standard" },
          fulfillmentItems,
          order,
          target as any
        )
        .then(
          () => {
            throw new Error("expected createFulfillment to reject")
          },
          (error) => error
        )

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

    /**
     * Origin (`address_from`) resolution + pre-flight (design §4.1).
     *
     * The whole suite above already runs through the seam (see the `fulfillment`
     * fixture); these cases pin the wire mapping, the settings fallbacks, and the
     * failure taxonomy: read failure vs no address row vs empty fields.
     */
    describe("origin resolution and pre-flight (design §4.1)", () => {
      it("resolves the origin via the seam and sends it to BOTH the quotation and the shipment", async () => {
        mockApi(fetchMock, {
          "POST /quotations": completedQuotation(quoteRates),
          "POST /shipments": () => jsonResponse(successShipment),
        })
        const { service, stockLocationSource } = makeService()

        await service.createFulfillment(
          { id: "skydropx-standard" },
          fulfillmentItems,
          order,
          fulfillment
        )

        expect(stockLocationSource).toHaveBeenCalledWith("sloc_1")
        expect(bodyOf("/quotations").quotation.address_from).toMatchObject({
          country_code: "MX",
          postal_code: "57100",
          area_level1: "México",
          area_level2: "Ciudad Nezahualcoyotl",
          area_level3: "Valle de Aragon",
        })
        expect(bodyOf("/shipments").shipment.address_from).toMatchObject({
          street1: "Valle del Carmen 184",
          name: "CDMX Warehouse",
          reference: "Valle de Aragon",
        })
      })

      /**
       * DEFENSIVE BRANCH — the ONLY test for it.
       *
       * No Medusa version hydrates `location` on the Fulfillment entity handed to
       * a fulfillment provider, so this shape NEVER occurs in production. The
       * branch is kept so a future Medusa (or a direct caller) that DOES hydrate
       * the relation skips a redundant DB read; it must not be mistaken for a
       * live path, which is why every other label test uses `location_id` only.
       */
      it("prefers an already-hydrated fulfillment.location.address without calling the seam", async () => {
        mockApi(fetchMock, {
          "POST /quotations": completedQuotation(quoteRates),
          "POST /shipments": () => jsonResponse(successShipment),
        })
        const { service, stockLocationSource } = makeService()

        await service.createFulfillment(
          { id: "skydropx-standard" },
          fulfillmentItems,
          order,
          {
            location_id: "sloc_1",
            location: {
              name: "CDMX Warehouse",
              address: {
                address_1: "Calle Origen 5",
                city: "Ciudad de México",
                province: "CDMX",
                postal_code: "06600",
                country_code: "mx",
                company: "Bodega Centro",
                phone: "5555550101",
              },
            },
          } as any
        )

        expect(stockLocationSource).not.toHaveBeenCalled()
        expect(bodyOf("/shipments").shipment.address_from.street1).toBe(
          "Calle Origen 5"
        )
      })

      it("keeps the originZip fallback when the stock location has no postal code", async () => {
        mockApi(fetchMock, {
          "POST /quotations": completedQuotation(quoteRates),
          "POST /shipments": () => jsonResponse(successShipment),
        })
        const source = jest
          .fn()
          .mockResolvedValue(stockLocation({ postal_code: "" }))
        const { service } = makeService({}, makeLogger(), source)

        await service.createFulfillment(
          { id: "skydropx-standard" },
          fulfillmentItems,
          order,
          fulfillment
        )

        expect(bodyOf("/quotations").quotation.address_from.postal_code).toBe(
          ORIGIN_ZIP
        )
      })

      it("falls back to the origin contact settings when the stock location fields are blank", async () => {
        mockApi(fetchMock, {
          "POST /quotations": completedQuotation(quoteRates),
          "POST /shipments": () => jsonResponse(successShipment),
        })
        const source = jest
          .fn()
          .mockResolvedValue(stockLocation({ company: "", phone: "" }))
        const { service } = makeService(
          {
            originEmail: "ops@mandi.mx",
            originCompany: "Mandi",
            originPhone: "5555555555",
          },
          makeLogger(),
          source
        )

        await service.createFulfillment(
          { id: "skydropx-standard" },
          fulfillmentItems,
          order,
          fulfillment
        )

        expect(bodyOf("/shipments").shipment.address_from).toMatchObject({
          company: "Mandi",
          phone: "5555555555",
          email: "ops@mandi.mx",
        })
      })

      it("prefers the stock location company/phone over the settings fallback", async () => {
        mockApi(fetchMock, {
          "POST /quotations": completedQuotation(quoteRates),
          "POST /shipments": () => jsonResponse(successShipment),
        })
        const source = jest
          .fn()
          .mockResolvedValue(
            stockLocation({ company: "Bodega SA", phone: "5511111111" })
          )
        const { service } = makeService(
          { originCompany: "Mandi", originPhone: "5555555555" },
          makeLogger(),
          source
        )

        await service.createFulfillment(
          { id: "skydropx-standard" },
          fulfillmentItems,
          order,
          fulfillment
        )

        expect(bodyOf("/shipments").shipment.address_from).toMatchObject({
          company: "Bodega SA",
          phone: "5511111111",
        })
      })

      /**
       * WARNING 3 — the origin counterpart of the destination's whitespace test.
       * The origin guard used to be the ONLY untrimmed one, so a stock location
       * with `company: "   "` / `phone: "   "` plus a whitespace `originEmail`
       * passed the pre-flight and the shipment body went out as
       * `{"company":"   ","phone":"   ","email":"  "}` — exactly the
       * "no puede estar en blanco" class the pre-flight exists to prevent, and
       * only AFTER a full quotation had been paid for.
       */
      it("rejects whitespace-only origin contact fields the same as blank ones", async () => {
        const source = jest
          .fn()
          .mockResolvedValue(stockLocation({ company: "   ", phone: "   " }))
        const { service } = makeService(
          {
            originEmail: "  ",
            originCompany: "   ",
            originPhone: " ",
          },
          makeLogger(),
          source
        )

        const error = await failLabel(service)

        expect(error).toBeInstanceOf(MedusaError)
        expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
        expect(error.message).toContain("company (")
        expect(error.message).toContain("phone (")
        expect(error.message).toContain('email (set "Origin contact email"')
        expect(fetchMock).not.toHaveBeenCalled()
      })

      /**
       * WARNING 3 — `missingAddressComponents` was untrimmed for BOTH ends, so a
       * whitespace-only city/state reached `area_level1`/`area_level2`.
       */
      it("rejects whitespace-only origin address components", async () => {
        const source = jest
          .fn()
          .mockResolvedValue(stockLocation({ city: "   ", country_code: " " }))
        const { service } = makeService({}, makeLogger(), source)

        const error = await failLabel(service)

        expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
        expect(error.message).toContain("country_code (")
        expect(error.message).toContain("city (")
        expect(fetchMock).not.toHaveBeenCalled()
      })

      /**
       * WARNING 3 — a whitespace postal code must not defeat the "Origin ZIP"
       * fallback and then be reported as missing while the setting IS filled in.
       */
      it("applies the originZip fallback over a whitespace-only stock location zip", async () => {
        mockApi(fetchMock, {
          "POST /quotations": completedQuotation(quoteRates),
          "POST /shipments": () => jsonResponse(successShipment),
        })
        const source = jest
          .fn()
          .mockResolvedValue(stockLocation({ postal_code: "   " }))
        const { service } = makeService({}, makeLogger(), source)

        await service.createFulfillment(
          { id: "skydropx-standard" },
          fulfillmentItems,
          order,
          fulfillment
        )

        expect(bodyOf("/quotations").quotation.address_from.postal_code).toBe(
          ORIGIN_ZIP
        )
      })

      /**
       * CRITICAL 1 — the origin end of the phone seam. The stock location phone is
       * operator-entered free text, so it needs the same normalization as the
       * customer-entered destination phone.
       */
      it("normalizes the origin phone before it reaches address_from", async () => {
        mockApi(fetchMock, {
          "POST /quotations": completedQuotation(quoteRates),
          "POST /shipments": () => jsonResponse(successShipment),
        })
        const source = jest
          .fn()
          .mockResolvedValue(stockLocation({ phone: "(55) 1234-5678" }))
        const { service } = makeService({}, makeLogger(), source)

        await service.createFulfillment(
          { id: "skydropx-standard" },
          fulfillmentItems,
          order,
          fulfillment
        )

        expect(bodyOf("/shipments").shipment.address_from.phone).toBe(
          "5512345678"
        )
      })

      it("normalizes the origin phone that comes from the settings fallback", async () => {
        mockApi(fetchMock, {
          "POST /quotations": completedQuotation(quoteRates),
          "POST /shipments": () => jsonResponse(successShipment),
        })
        const source = jest.fn().mockResolvedValue(stockLocation({ phone: "" }))
        const { service } = makeService(
          { originPhone: "+52 55 1234 5678" },
          makeLogger(),
          source
        )

        await service.createFulfillment(
          { id: "skydropx-standard" },
          fulfillmentItems,
          order,
          fulfillment
        )

        expect(bodyOf("/shipments").shipment.address_from.phone).toBe(
          "525512345678"
        )
      })

      /**
       * PRO rejects `address_from` without company/phone/email with a 422. Failing
       * BEFORE the quotation turns an opaque, expensive carrier rejection into an
       * actionable message (this replaces a test that snapshotted the rejected
       * payload as if it were acceptable).
       */
      it("fails loud BEFORE quoting when nothing provides company/phone/email", async () => {
        const source = jest
          .fn()
          .mockResolvedValue(stockLocation({ company: "", phone: "" }))
        const { service } = makeService(
          {
            originEmail: undefined,
            originCompany: undefined,
            originPhone: undefined,
          },
          makeLogger(),
          source
        )

        const error = await failLabel(service)

        expect(error).toBeInstanceOf(MedusaError)
        expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
        expect(error.message).toContain("company (")
        expect(error.message).toContain("phone (")
        expect(error.message).toContain('email (set "Origin contact email"')
        // Actionable BEFORE the money/time is spent: no quotation, no poll.
        expect(fetchMock).not.toHaveBeenCalled()
      })

      it("fails loud when the stock location has no street address (PRO street1)", async () => {
        const source = jest
          .fn()
          .mockResolvedValue(stockLocation({ address_1: "" }))
        const { service } = makeService({}, makeLogger(), source)

        const error = await failLabel(service)

        expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
        expect(error.message).toContain("address_1 (")
        expect(fetchMock).not.toHaveBeenCalled()
      })

      it("fails loud when the stock location has no name (PRO name)", async () => {
        const source = jest
          .fn()
          .mockResolvedValue({ ...stockLocation(), name: "  " })
        const { service } = makeService({}, makeLogger(), source)

        const error = await failLabel(service)

        expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
        expect(error.message).toContain("name (")
        expect(fetchMock).not.toHaveBeenCalled()
      })

      it("names the missing address components and where to fix each one", async () => {
        const source = jest
          .fn()
          .mockResolvedValue(stockLocation({ province: "", city: "" }))
        const { service } = makeService({}, makeLogger(), source)

        const error = await failLabel(service)

        expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
        expect(error.message).toContain("sloc_1")
        expect(error.message).toContain("province (set the state on the stock location address)")
        expect(error.message).toContain("city (set the city on the stock location address)")
      })

      it("says the postal code came from settings when the location has none", async () => {
        const source = jest
          .fn()
          .mockResolvedValue(stockLocation({ postal_code: "", city: "" }))
        const { service } = makeService({}, makeLogger(), source)

        const error = await failLabel(service)

        // postal_code is NOT listed as missing (originZip filled it), so the
        // message must say where it came from instead of implying the location
        // has one.
        expect(error.message).not.toContain("postal_code (")
        expect(error.message).toContain('came from the Skydropx "Origin ZIP" setting')
      })

      it("distinguishes a location with NO address row from a failed read", async () => {
        const source = jest
          .fn()
          .mockResolvedValue({ name: "Bodega sin dirección", address: null })
        const { service } = makeService({}, makeLogger(), source)

        const error = await failLabel(service)

        expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
        expect(error.message).toContain("sloc_1")
        expect(error.message).toContain("has no address configured")
        expect(error.message).toContain("Admin → Settings → Locations")
        expect(fetchMock).not.toHaveBeenCalled()
      })

      it("fails loud when the fulfillment carries no stock location at all", async () => {
        const { service, stockLocationSource } = makeService()

        const error = await failLabel(service, {})

        expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
        expect(error.message).toContain("no stock location")
        expect(stockLocationSource).not.toHaveBeenCalled()
      })

      /**
       * The seam returns `null` for FOUR distinct infrastructure conditions
       * (module unregistered, container throw, rejected read, timeout). None of
       * them means the address is wrong, so the message must not send an operator
       * to edit a healthy row mid-incident.
       */
      describe("read failure vs bad address (WARNING 5)", () => {
        it("reports a READ failure, not an address-edit prompt, when the seam resolves null", async () => {
          const source = jest.fn().mockResolvedValue(null)
          const { service } = makeService({}, makeLogger(), source)

          const error = await failLabel(service)

          expect(error).toBeInstanceOf(MedusaError)
          expect(error.type).toBe(MedusaError.Types.UNEXPECTED_STATE)
          expect(error.message).toContain("sloc_1")
          expect(error.message).toContain("could not be READ")
          expect(error.message).not.toContain("Admin → Settings → Locations")
          expect(error.message).not.toContain("is missing")
          expect(fetchMock).not.toHaveBeenCalled()
        })

        it("stays honest about the postal code when originZip IS set", async () => {
          // Regression: the old message listed only the components
          // `missingAddressComponents` found. With `originZip` set it silently
          // dropped `postal_code`, implying the location had one.
          const source = jest.fn().mockResolvedValue(null)
          const { service } = makeService(
            { originZip: "06600" },
            makeLogger(),
            source
          )

          const error = await failLabel(service)

          expect(error.message).toContain("could not be READ")
          expect(error.message).not.toContain("postal_code")
          expect(error.message).not.toContain("06600")
        })
      })

      /**
       * NEW-2: a deleted or stale `location_id` is a DATA condition. Retrying can
       * never fix it, so it must NOT reuse the retry-oriented infrastructure
       * message (or its 500). The three causes below each have to stay legible on
       * their own.
       */
      describe("unknown location id vs failed read (NEW-2)", () => {
        it("reports an unknown/stale location as INVALID_DATA that names the id and says retrying cannot help", async () => {
          const source = jest.fn().mockResolvedValue(STOCK_LOCATION_NOT_FOUND)
          const { service } = makeService({}, makeLogger(), source)

          const error = await failLabel(service)

          expect(error).toBeInstanceOf(MedusaError)
          expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
          expect(error.message).toContain("sloc_1")
          expect(error.message).toContain("no longer exists")
          expect(error.message).toContain("retrying the label cannot succeed")
          // Explicitly NOT the infrastructure wording — that is what caused the
          // wiring/data mix-up this finding is about.
          expect(error.message).not.toContain("could not be READ")
          expect(error.message).not.toContain("infrastructure failure")
          expect(fetchMock).not.toHaveBeenCalled()
        })

        it("keeps a module-unavailable read as UNEXPECTED_STATE with the retry wording", async () => {
          // The default seam collapses "module unregistered / container threw /
          // read errored" into `null`.
          const source = jest.fn().mockResolvedValue(null)
          const { service } = makeService({}, makeLogger(), source)

          const error = await failLabel(service)

          expect(error.type).toBe(MedusaError.Types.UNEXPECTED_STATE)
          expect(error.message).toContain("could not be READ")
          expect(error.message).toContain("retry the label")
          expect(error.message).not.toContain("no longer exists")
        })

        it("keeps a timed-out read as UNEXPECTED_STATE with the retry wording", async () => {
          jest.useFakeTimers()
          try {
            const source = jest.fn(
              () => new Promise(() => {})
            ) as unknown as jest.Mock
            const { service } = makeService({}, makeLogger(), source)

            const settled = failLabel(service)
            await jest.advanceTimersByTimeAsync(
              STOCK_LOCATION_RESOLUTION_TIMEOUT_MS + 1
            )
            const error = await settled

            expect(error.type).toBe(MedusaError.Types.UNEXPECTED_STATE)
            expect(error.message).toContain(
              `${STOCK_LOCATION_RESOLUTION_TIMEOUT_MS}ms`
            )
            expect(error.message).not.toContain("no longer exists")
          } finally {
            jest.useRealTimers()
          }
        })
      })

      /**
       * `stockLocationSource` is a PUBLIC injection point (`SkydropxOptions`) and
       * `resolveOrigin_` runs BEFORE the SD-4 try/catch, so a hostile or broken
       * source must not escape `createFulfillment` as a raw error.
       */
      describe("untrusted injected source (WARNING 4)", () => {
        it("surfaces a typed MedusaError when the source REJECTS", async () => {
          const source = jest
            .fn()
            .mockRejectedValue(new Error("AwilixResolutionError"))
          const { service } = makeService({}, makeLogger(), source)

          const error = await failLabel(service)

          expect(error).toBeInstanceOf(MedusaError)
          expect(error.type).toBe(MedusaError.Types.UNEXPECTED_STATE)
          expect(error.message).toContain("could not be READ")
          // Internal failure detail never leaks into the admin-facing message.
          expect(error.message).not.toContain("AwilixResolutionError")
          expect(fetchMock).not.toHaveBeenCalled()
        })

        it("surfaces a typed MedusaError when the source NEVER settles", async () => {
          jest.useFakeTimers()
          try {
            const source = jest.fn(
              () => new Promise(() => {})
            ) as unknown as jest.Mock
            const { service } = makeService({}, makeLogger(), source)

            const settled = failLabel(service)
            await jest.advanceTimersByTimeAsync(
              STOCK_LOCATION_RESOLUTION_TIMEOUT_MS + 1
            )
            const error = await settled

            expect(error).toBeInstanceOf(MedusaError)
            expect(error.type).toBe(MedusaError.Types.UNEXPECTED_STATE)
            expect(error.message).toContain("could not be READ")
            expect(fetchMock).not.toHaveBeenCalled()
          } finally {
            jest.useRealTimers()
          }
        })
      })
    })

    /**
     * Destination (`address_to`) contact sourcing + pre-flight (design §4.1).
     *
     * WHY the customer record is the source of truth here: Medusa's
     * create-fulfillment order projection selects `customer.*` and
     * `shipping_address.*` but NOT `email`
     * (@medusajs/core-flows/dist/order/workflows/create-fulfillment.js), so
     * `order.email` is ALWAYS undefined on this path and the customer is the only
     * place an email can come from. Every fixture below starts from that shape.
     *
     * PRO marks phone/email Required on `address_to`; a real order with
     * `shipping_address.phone = ""` and `customer.phone = NULL` was rejected with
     * `{"address_to":{"phone":["no puede estar en blanco"]}}` AFTER a full
     * quotation, which is what the pre-flight exists to prevent.
     */
    describe("destination contact and pre-flight (design §4.1)", () => {
      /** The order shape the projection actually produces: NO top-level `email`. */
      const projectedOrder = (over: Record<string, any> = {}) => ({
        ...order,
        email: undefined,
        ...over,
        shipping_address: {
          ...order.shipping_address,
          ...(over.shipping_address ?? {}),
        },
      })

      const labelWith = (
        service: SkydropxFulfillmentProviderService,
        orderOverride: Record<string, any>
      ) =>
        service.createFulfillment(
          { id: "skydropx-standard" },
          fulfillmentItems,
          orderOverride as any,
          fulfillment
        )

      const failLabelWith = (
        service: SkydropxFulfillmentProviderService,
        orderOverride: Record<string, any>
      ): Promise<any> =>
        labelWith(service, orderOverride).then(
          () => {
            throw new Error("expected createFulfillment to reject")
          },
          (error) => error
        )

      const mockHappyPath = () =>
        mockApi(fetchMock, {
          "POST /quotations": completedQuotation(quoteRates),
          "POST /shipments": () => jsonResponse(successShipment),
        })

      it("falls back to the CUSTOMER record for email and phone (order.email is absent from the projection)", async () => {
        mockHappyPath()
        const { service } = makeService()

        await labelWith(
          service,
          projectedOrder({
            shipping_address: { phone: "" },
            customer: { email: "ana@example.com", phone: "5544332211" },
          })
        )

        expect(bodyOf("/shipments").shipment.address_to).toMatchObject({
          email: "ana@example.com",
          phone: "5544332211",
        })
      })

      it("prefers the shipping address phone over the customer phone", async () => {
        mockHappyPath()
        const { service } = makeService()

        await labelWith(
          service,
          projectedOrder({
            shipping_address: { phone: "8110000000" },
            customer: { email: "ana@example.com", phone: "5544332211" },
          })
        )

        expect(bodyOf("/shipments").shipment.address_to).toMatchObject({
          phone: "8110000000",
          email: "ana@example.com",
        })
      })

      it("still prefers order.email for a direct caller that DOES project it", async () => {
        mockHappyPath()
        const { service } = makeService()

        await labelWith(
          service,
          projectedOrder({
            email: "order@example.com",
            customer: { email: "customer@example.com" },
          })
        )

        expect(bodyOf("/shipments").shipment.address_to.email).toBe(
          "order@example.com"
        )
      })

      it("sends the shipping address contact name and street on address_to", async () => {
        mockHappyPath()
        const { service } = makeService()

        await labelWith(
          service,
          projectedOrder({ customer: { email: "ana@example.com" } })
        )

        expect(bodyOf("/shipments").shipment.address_to).toMatchObject({
          street1: "Av. Reforma 1",
          name: "Ana López",
        })
      })

      /**
       * The exact production incident: a blank shipping phone and a customer with
       * no phone. Before the guard this cost a full quotation and then surfaced
       * PRO's raw Spanish 422 body.
       */
      it("fails loud BEFORE quoting when neither the order nor the customer has a phone", async () => {
        const { service } = makeService()

        const error = await failLabelWith(
          service,
          projectedOrder({
            shipping_address: { phone: "" },
            customer: { email: "ana@example.com", phone: null },
          })
        )

        expect(error).toBeInstanceOf(MedusaError)
        expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
        expect(error.message).toContain("destination address")
        expect(error.message).toContain(
          "phone (set a phone on the order shipping address, or on the customer record for this order)"
        )
        // Actionable BEFORE the money/time is spent: no quotation, no poll.
        expect(fetchMock).not.toHaveBeenCalled()
      })

      it("names BOTH phone and email when the order and the customer have neither", async () => {
        const { service } = makeService()

        const error = await failLabelWith(
          service,
          projectedOrder({ shipping_address: { phone: "" }, customer: null })
        )

        expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
        expect(error.message).toContain("phone (")
        expect(error.message).toContain(
          "email (set an email on the customer record for this order)"
        )
        expect(fetchMock).not.toHaveBeenCalled()
      })

      /**
       * CRITICAL 1 — the reviewers' point: `(55) 1234-5678` PASSES the storefront
       * pattern and used to reach `address_to.phone` verbatim, so the guard's
       * promise ("no more opaque 422") only held for BLANK phones. These pin the
       * whole accepted set down to what PRO gets.
       */
      it.each([
        ["(55) 1234-5678", "5512345678"],
        ["55 1234 5678", "5512345678"],
        ["+52 55 1234 5678", "525512345678"],
        ["5215555555555", "5215555555555"],
        ["045 55 1234 5678", "5512345678"],
      ])(
        "normalizes the destination phone %s to %s before it reaches address_to",
        async (input, expected) => {
          mockHappyPath()
          const { service } = makeService()

          await labelWith(
            service,
            projectedOrder({
              shipping_address: { phone: input },
              customer: { email: "ana@example.com" },
            })
          )

          expect(bodyOf("/shipments").shipment.address_to.phone).toBe(expected)
        }
      )

      it("normalizes the destination phone that comes from the customer record", async () => {
        mockHappyPath()
        const { service } = makeService()

        await labelWith(
          service,
          projectedOrder({
            shipping_address: { phone: "" },
            customer: { email: "ana@example.com", phone: "(81) 1000-0000" },
          })
        )

        expect(bodyOf("/shipments").shipment.address_to.phone).toBe("8110000000")
      })

      it("rejects a whitespace-only phone the same as a blank one", async () => {
        const { service } = makeService()

        const error = await failLabelWith(
          service,
          projectedOrder({
            shipping_address: { phone: "   " },
            customer: { email: "ana@example.com" },
          })
        )

        expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
        expect(error.message).toContain("phone (")
        expect(fetchMock).not.toHaveBeenCalled()
      })

      it("names the missing destination components and where to fix each one", async () => {
        const { service } = makeService()

        const error = await failLabelWith(
          service,
          projectedOrder({
            shipping_address: { province: "", city: "", address_1: "" },
            customer: { email: "ana@example.com" },
          })
        )

        expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
        expect(error.message).toContain(
          "province (set the state on the order shipping address)"
        )
        expect(error.message).toContain(
          "city (set the city on the order shipping address)"
        )
        expect(error.message).toContain(
          "address_1 (set address line 1 on the order shipping address)"
        )
        expect(fetchMock).not.toHaveBeenCalled()
      })

      it("fails loud when the order carries no shipping address at all", async () => {
        const { service } = makeService()

        const error = await failLabelWith(service, {
          ...order,
          email: undefined,
          shipping_address: undefined,
          customer: { email: "ana@example.com" },
        })

        expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
        expect(error.message).toContain("destination address")
        expect(fetchMock).not.toHaveBeenCalled()
      })

      /**
       * The PRO reference marks `company` and `reference` Required on `address_to`,
       * but consumer orders legitimately have neither and PRO accepts the shipment
       * without them (the observed 422 named only phone and email). Enforcing them
       * would block every B2C label — this pins that they stay unenforced.
       */
      it("does NOT require company or reference on the destination (B2C orders have neither)", async () => {
        mockHappyPath()
        const { service } = makeService()

        const result = await labelWith(
          service,
          projectedOrder({
            shipping_address: { company: "", address_2: "" },
            customer: { email: "ana@example.com" },
          })
        )

        expect(result.data).toMatchObject({ shipment_id: "shp_1" })
        const addressTo = bodyOf("/shipments").shipment.address_to
        expect(addressTo.company).toBeUndefined()
        expect(addressTo.reference).toBeUndefined()
      })
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

/**
 * S4.1 — MercadoPagoPaymentProviderService unit tests (hermetic, mocked fetch).
 *
 * Mercado Pago Checkout Pro (redirect) provider. Credentials arrive through the
 * async `credentialSource` seam (DB-backed in production, faked here) exactly
 * like Openpay: unconfigured (source → null) rejects payment ops with
 * INVALID_DATA and never calls the API; a rotation (new fingerprint) rebuilds
 * the immutable client on the next op.
 *
 * Contract per design §4.1 + amendment (obs #110) fix 3:
 * - initiatePayment creates a Checkout Pro preference (POST /checkout/preferences)
 *   with amount as-is MXN (no cent conversion), 3 back_urls from
 *   `data.back_urls_base`, notification_url from the resolved backendUrl, and
 *   external_reference = session_id.
 * - MP API error on preference creation → MedusaError, session unusable.
 * - updatePayment recreates the preference when the amount changed (fix 3).
 * - authorizePayment searches payments by external_reference (newest first):
 *   approved/authorized → captured (amount asserted); only pending/in_process →
 *   requires_more; rejected/cancelled → throw; none → requires_more. Redirect
 *   params are NEVER consulted (MP-3 forged-success).
 * - refundPayment posts to /v1/payments/{id}/refunds with the as-is amount.
 */
import { MedusaError } from "@medusajs/framework/utils"
import { MERCADOPAGO_IDENTIFIER } from "../../../lib/constants"
import MercadoPagoPaymentProviderService from "../service"

const ACCESS_TOKEN = "TEST-access-token-123"
const WEBHOOK_SECRET = "whsec_test"
const BACKEND_URL = "https://api.store.example"
const SESSION_ID = "payses_01MP"
const BACK_URLS_BASE = "https://store.example/mx/payment/mercadopago"

const credentials = {
  accessToken: ACCESS_TOKEN,
  webhookSecret: WEBHOOK_SECRET,
  backendUrl: BACKEND_URL,
  sandbox: true,
}

const container = {
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}

const makeService = (
  credentialSource: () => Promise<typeof credentials | null> = async () =>
    credentials
) =>
  new MercadoPagoPaymentProviderService(container as never, { credentialSource })

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  }) as unknown as Response

const preferenceResponse = (overrides: Record<string, unknown> = {}) => ({
  id: "pref_123",
  init_point: "https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=pref_123",
  sandbox_init_point:
    "https://sandbox.mercadopago.com.mx/checkout/v1/redirect?pref_id=pref_123",
  ...overrides,
})

const baseSessionData = {
  session_id: SESSION_ID,
  amount: 499,
  currency_code: "mxn",
  back_urls_base: BACK_URLS_BASE,
}

describe("MercadoPagoPaymentProviderService", () => {
  let fetchMock: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    fetchMock = jest.spyOn(global, "fetch")
  })

  afterEach(() => {
    fetchMock.mockRestore()
  })

  it("exposes the identifier from the shared constants module", () => {
    expect(MercadoPagoPaymentProviderService.identifier).toBe(
      MERCADOPAGO_IDENTIFIER
    )
  })

  describe("validateOptions (always-registered, empty options valid)", () => {
    it("accepts an EMPTY options object (credentials live in the DB)", () => {
      expect(() =>
        MercadoPagoPaymentProviderService.validateOptions({})
      ).not.toThrow()
    })

    it("still rejects PRESENT but malformed fields with INVALID_DATA", () => {
      expect(() =>
        MercadoPagoPaymentProviderService.validateOptions({ accessToken: 42 })
      ).toThrow(MedusaError)
      expect(() =>
        MercadoPagoPaymentProviderService.validateOptions({ webhookSecret: "" })
      ).toThrow(MedusaError)
    })
  })

  describe("unconfigured provider (source → null) — fail-safe inert", () => {
    const unconfigured = () => makeService(async () => null)

    it.each([
      [
        "initiatePayment",
        (s: MercadoPagoPaymentProviderService) =>
          s.initiatePayment({
            amount: 499,
            currency_code: "mxn",
            data: { ...baseSessionData },
          }),
      ],
      [
        "authorizePayment",
        (s: MercadoPagoPaymentProviderService) =>
          s.authorizePayment({ data: { ...baseSessionData } }),
      ],
      [
        "refundPayment",
        (s: MercadoPagoPaymentProviderService) =>
          s.refundPayment({
            amount: 100,
            data: { ...baseSessionData, payment_id: "pay_1" },
          }),
      ],
    ])(
      "%s rejects with INVALID_DATA 'not configured' and never calls the API",
      async (_name, op) => {
        await expect(op(unconfigured())).rejects.toMatchObject({
          constructor: MedusaError,
          type: MedusaError.Types.INVALID_DATA,
          message: expect.stringContaining("not configured"),
        })
        expect(fetchMock).not.toHaveBeenCalled()
      }
    )

    it("keeps session-lifecycle no-ops harmless (capture/cancel/delete never throw)", async () => {
      const service = unconfigured()
      await expect(
        service.capturePayment({ data: { ...baseSessionData } })
      ).resolves.toBeDefined()
      await expect(
        service.cancelPayment({ data: { ...baseSessionData } })
      ).resolves.toBeDefined()
      await expect(
        service.deletePayment({ data: { ...baseSessionData } })
      ).resolves.toBeDefined()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe("client rebuild on credential fingerprint change (rotation)", () => {
    it("uses the rotated access token on the next op without a restart", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ results: [] }))
      let current = { ...credentials }
      const service = makeService(async () => current)

      await service.authorizePayment({ data: { ...baseSessionData } })
      current = { ...credentials, accessToken: "TEST-rotated-token" }
      await service.authorizePayment({ data: { ...baseSessionData } })

      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
        `Bearer ${ACCESS_TOKEN}`
      )
      expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
        `Bearer TEST-rotated-token`
      )
    })
  })

  describe("initiatePayment — preference creation (MP-2)", () => {
    it("creates a Checkout Pro preference with as-is MXN amount, back_urls, notification_url and external_reference", async () => {
      fetchMock.mockResolvedValue(jsonResponse(preferenceResponse()))
      const service = makeService()

      const result = await service.initiatePayment({
        amount: 499,
        currency_code: "mxn",
        data: { ...baseSessionData },
      })

      expect(result.id).toBe(SESSION_ID)
      expect(result.data).toMatchObject({
        session_id: SESSION_ID,
        preference_id: "pref_123",
        external_reference: SESSION_ID,
        init_point: expect.stringContaining("mercadopago"),
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe("https://api.mercadopago.com/checkout/preferences")
      expect(init.method).toBe("POST")
      const body = JSON.parse(init.body as string)
      expect(body).toMatchObject({
        external_reference: SESSION_ID,
        auto_return: "approved",
        notification_url: `${BACKEND_URL}/hooks/payment/pp_mercadopago_mercadopago`,
        back_urls: {
          success: `${BACK_URLS_BASE}/success`,
          failure: `${BACK_URLS_BASE}/failure`,
          pending: `${BACK_URLS_BASE}/pending`,
        },
      })
      expect(body.items).toHaveLength(1)
      expect(body.items[0]).toMatchObject({
        quantity: 1,
        unit_price: 499, // as-is, no cent conversion
        currency_id: "MXN",
      })
    })

    it("throws a MedusaError when preference creation fails (session unusable)", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ message: "invalid token", status: 401 }, 401)
      )
      const service = makeService()

      await expect(
        service.initiatePayment({
          amount: 499,
          currency_code: "mxn",
          data: { ...baseSessionData },
        })
      ).rejects.toThrow(MedusaError)
    })

    it("rejects with INVALID_DATA when session_id is missing (no API call)", async () => {
      const service = makeService()

      await expect(
        service.initiatePayment({
          amount: 499,
          currency_code: "mxn",
          data: { back_urls_base: BACK_URLS_BASE },
        })
      ).rejects.toMatchObject({
        constructor: MedusaError,
        type: MedusaError.Types.INVALID_DATA,
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("rejects with INVALID_DATA when back_urls_base is missing (no API call)", async () => {
      const service = makeService()

      await expect(
        service.initiatePayment({
          amount: 499,
          currency_code: "mxn",
          data: { session_id: SESSION_ID },
        })
      ).rejects.toMatchObject({
        constructor: MedusaError,
        type: MedusaError.Types.INVALID_DATA,
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe("updatePayment — recreate preference on amount change (fix 3)", () => {
    it("recreates the preference when the amount changed", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(preferenceResponse({ id: "pref_new" }))
      )
      const service = makeService()

      const result = await service.updatePayment({
        amount: 999,
        currency_code: "mxn",
        data: { ...baseSessionData, preference_id: "pref_old", amount: 499 },
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.items[0].unit_price).toBe(999)
      expect(result.data).toMatchObject({
        preference_id: "pref_new",
        amount: 999,
      })
    })

    it("does NOT call the API when the amount is unchanged", async () => {
      const service = makeService()

      const result = await service.updatePayment({
        amount: 499,
        currency_code: "mxn",
        data: { ...baseSessionData, preference_id: "pref_old", amount: 499 },
      })

      expect(fetchMock).not.toHaveBeenCalled()
      expect(result.data).toMatchObject({ preference_id: "pref_old" })
    })
  })

  describe("authorizePayment — search by external_reference (MP-3)", () => {
    const searchUrl = `https://api.mercadopago.com/v1/payments/search?external_reference=${SESSION_ID}&sort=date_created&criteria=desc`

    it("maps the newest approved payment → captured and asserts the amount", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          results: [
            {
              id: 111,
              status: "approved",
              transaction_amount: 499,
              external_reference: SESSION_ID,
            },
          ],
        })
      )
      const service = makeService()

      const result = await service.authorizePayment({
        data: { ...baseSessionData },
      })

      expect(result.status).toBe("captured")
      expect(result.data).toMatchObject({ payment_id: 111 })
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toBe(searchUrl)
      expect(init.method).toBe("GET")
    })

    it("maps only-pending results → requires_more (no order placed)", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          results: [
            {
              id: 112,
              status: "pending",
              transaction_amount: 499,
              external_reference: SESSION_ID,
            },
          ],
        })
      )
      const service = makeService()

      const result = await service.authorizePayment({
        data: { ...baseSessionData },
      })

      expect(result.status).toBe("requires_more")
    })

    it("maps no results → requires_more (customer has not paid yet)", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ results: [] }))
      const service = makeService()

      const result = await service.authorizePayment({
        data: { ...baseSessionData },
      })

      expect(result.status).toBe("requires_more")
    })

    it("throws PAYMENT_AUTHORIZATION_ERROR when the newest payment is rejected", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          results: [
            {
              id: 113,
              status: "rejected",
              transaction_amount: 499,
              external_reference: SESSION_ID,
            },
          ],
        })
      )
      const service = makeService()

      await expect(
        service.authorizePayment({ data: { ...baseSessionData } })
      ).rejects.toMatchObject({
        constructor: MedusaError,
        type: MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
      })
    })

    it("rejects when the approved payment amount does not match the session amount (fix 3)", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          results: [
            {
              id: 114,
              status: "approved",
              transaction_amount: 1.0,
              external_reference: SESSION_ID,
            },
          ],
        })
      )
      const service = makeService()

      await expect(
        service.authorizePayment({ data: { ...baseSessionData } })
      ).rejects.toMatchObject({
        constructor: MedusaError,
        message: expect.stringContaining("mismatch"),
      })
    })

    it("prefers the newest approved payment over an older pending one", async () => {
      // MP returns newest first (criteria=desc). Approved is index 0.
      fetchMock.mockResolvedValue(
        jsonResponse({
          results: [
            {
              id: 200,
              status: "approved",
              transaction_amount: 499,
              external_reference: SESSION_ID,
            },
            {
              id: 199,
              status: "pending",
              transaction_amount: 499,
              external_reference: SESSION_ID,
            },
          ],
        })
      )
      const service = makeService()

      const result = await service.authorizePayment({
        data: { ...baseSessionData },
      })

      expect(result.status).toBe("captured")
      expect(result.data).toMatchObject({ payment_id: 200 })
    })
  })

  describe("refundPayment", () => {
    it("posts to /v1/payments/{id}/refunds with the as-is amount", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ id: 900, status: "approved" })
      )
      const service = makeService()

      await service.refundPayment({
        amount: 250.5,
        data: { ...baseSessionData, payment_id: 111 },
      })

      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toBe(
        "https://api.mercadopago.com/v1/payments/111/refunds"
      )
      expect(init.method).toBe("POST")
      expect(JSON.parse(init.body as string)).toMatchObject({ amount: 250.5 })
    })

    it("throws NOT_ALLOWED when there is no captured payment to refund", async () => {
      const service = makeService()

      await expect(
        service.refundPayment({ amount: 100, data: { ...baseSessionData } })
      ).rejects.toMatchObject({
        constructor: MedusaError,
        type: MedusaError.Types.NOT_ALLOWED,
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("throws a MedusaError when the provider refund fails", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ message: "refund not allowed", status: 400 }, 400)
      )
      const service = makeService()

      await expect(
        service.refundPayment({
          amount: 100,
          data: { ...baseSessionData, payment_id: 111 },
        })
      ).rejects.toThrow(MedusaError)
    })
  })

  describe("capturePayment / cancelPayment / deletePayment", () => {
    it("capturePayment is a no-op returning the session data (Checkout Pro arrives captured)", async () => {
      const service = makeService()

      const result = await service.capturePayment({
        data: { ...baseSessionData, payment_id: 111 },
      })

      expect(result.data).toMatchObject({ payment_id: 111 })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("cancelPayment / deletePayment make no API call", async () => {
      const service = makeService()

      await service.cancelPayment({ data: { ...baseSessionData } })
      await service.deletePayment({ data: { ...baseSessionData } })

      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})

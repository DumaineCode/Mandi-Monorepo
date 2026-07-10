/**
 * S2.3 — Openpay webhook unit tests (hermetic, mocked fetch).
 *
 * Design §3.4 + amendment (obs #110) fixes 3/4/6:
 * - Basic-auth verification against OPENPAY_WEBHOOK_USER/PASSWORD using
 *   crypto.timingSafeEqual WITH a length guard (fix 6); invalid/absent/
 *   odd-length auth → not_supported, no state change, no API call.
 * - Server-side re-fetch: GET /charges/{transaction.id} is the ONLY status
 *   source — payload status/amounts are never trusted.
 * - Amount guard (fix 3): the returned amount is ALWAYS the fetched charge
 *   amount (never the payload amount); Medusa's processPayment compares it to
 *   the session amount before capturing.
 * - session_id correlation from fetched charge.order_id by PREFIX, stripping
 *   the `-{n}` attempt nonce suffix (fix 4).
 * - Event table: verification → not_supported (verification_code logged);
 *   charge.succeeded → captured (idempotent); charge.failed|cancelled|expired
 *   → failed; chargeback.created|accepted → failed; chargeback.rejected,
 *   charge.refunded, unknown → not_supported.
 */
import OpenpayPaymentProviderService from "../service"

const MERCHANT_ID = "m_test_123"
const PRIVATE_KEY = "sk_test_private"
const WEBHOOK_USER = "hookuser"
const WEBHOOK_PASSWORD = "hookpass"
const SESSION_ID = "payses_01TEST"
const CHARGE_ID = "trx_openpay_001"

const options = {
  merchantId: MERCHANT_ID,
  privateKey: PRIVATE_KEY,
  sandbox: true,
  webhookUser: WEBHOOK_USER,
  webhookPassword: WEBHOOK_PASSWORD,
}

const VALID_AUTH = `Basic ${Buffer.from(
  `${WEBHOOK_USER}:${WEBHOOK_PASSWORD}`
).toString("base64")}`

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

const container = { logger }

const makeService = (opts = options) =>
  new OpenpayPaymentProviderService(container as never, opts)

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  }) as unknown as Response

type WebhookBody = {
  type?: string
  verification_code?: string
  transaction?: {
    id?: string
    status?: string
    amount?: number
    order_id?: string
  }
}

const makePayload = (body: WebhookBody, authorization?: string) => ({
  data: body as Record<string, unknown>,
  rawData: JSON.stringify(body),
  headers: (authorization
    ? { authorization }
    : {}) as Record<string, unknown>,
})

const fetchedCharge = (overrides: Record<string, unknown> = {}) => ({
  id: CHARGE_ID,
  status: "completed",
  amount: 150.5,
  currency: "MXN",
  order_id: `${SESSION_ID}-1`,
  ...overrides,
})

const succeededBody = (
  transactionOverrides: Record<string, unknown> = {}
): WebhookBody => ({
  type: "charge.succeeded",
  transaction: {
    id: CHARGE_ID,
    status: "completed",
    amount: 150.5,
    order_id: `${SESSION_ID}-1`,
    ...transactionOverrides,
  },
})

describe("OpenpayPaymentProviderService.getWebhookActionAndData", () => {
  let fetchMock: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    fetchMock = jest.spyOn(global, "fetch")
  })

  afterEach(() => {
    fetchMock.mockRestore()
  })

  describe("basic-auth verification (fix 6)", () => {
    it("accepts a valid Basic auth header and processes the event", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(fetchedCharge()))
      const service = makeService()

      const result = await service.getWebhookActionAndData(
        makePayload(succeededBody(), VALID_AUTH)
      )

      expect(result.action).toBe("captured")
    })

    it("rejects an absent authorization header without calling the API", async () => {
      const service = makeService()

      const result = await service.getWebhookActionAndData(
        makePayload(succeededBody())
      )

      expect(result).toEqual({ action: "not_supported" })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalled()
    })

    it("rejects invalid credentials of the SAME length without calling the API", async () => {
      const service = makeService()
      // Same byte length as the valid header — exercises timingSafeEqual itself.
      const sameLengthWrong = `Basic ${Buffer.from(
        `${WEBHOOK_USER}:hookpasX`
      ).toString("base64")}`
      expect(sameLengthWrong).toHaveLength(VALID_AUTH.length)

      const result = await service.getWebhookActionAndData(
        makePayload(succeededBody(), sameLengthWrong)
      )

      expect(result).toEqual({ action: "not_supported" })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("rejects an odd-length header without throwing (length guard, fix 6)", async () => {
      const service = makeService()

      // timingSafeEqual throws on length mismatch — the guard must prevent that.
      const result = await service.getWebhookActionAndData(
        makePayload(succeededBody(), "Basic x")
      )

      expect(result).toEqual({ action: "not_supported" })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("rejects everything when webhook credentials are not configured", async () => {
      const service = makeService({
        merchantId: MERCHANT_ID,
        privateKey: PRIVATE_KEY,
        sandbox: true,
      } as typeof options)

      const result = await service.getWebhookActionAndData(
        makePayload(succeededBody(), VALID_AUTH)
      )

      expect(result).toEqual({ action: "not_supported" })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("never logs the webhook password on rejection", async () => {
      const service = makeService()

      await service.getWebhookActionAndData(makePayload(succeededBody()))

      const logged = logger.warn.mock.calls.flat().join(" ")
      expect(logged).not.toContain(WEBHOOK_PASSWORD)
      expect(logged).not.toContain(VALID_AUTH)
    })
  })

  describe("server-side re-fetch is the only status source", () => {
    it("re-fetches the charge via GET /charges/{transaction.id}", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(fetchedCharge()))
      const service = makeService()

      await service.getWebhookActionAndData(
        makePayload(succeededBody(), VALID_AUTH)
      )

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toBe(
        `https://sandbox-api.openpay.mx/v1/${MERCHANT_ID}/charges/${CHARGE_ID}`
      )
      expect(init.method).toBe("GET")
    })

    it("maps to failed when payload claims completed but fetched charge is failed", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(fetchedCharge({ status: "failed" }))
      )
      const service = makeService()

      const result = await service.getWebhookActionAndData(
        makePayload(succeededBody({ status: "completed" }), VALID_AUTH)
      )

      expect(result.action).toBe("failed")
    })

    it("THROWS when the re-fetch fails transiently so Medusa responds 5xx and Openpay redelivers", async () => {
      // Persistent 5xx — exhausts the client's single bounded retry too.
      fetchMock.mockResolvedValue(
        jsonResponse({ error_code: 1001, description: "upstream down" }, 500)
      )
      const service = makeService()

      await expect(
        service.getWebhookActionAndData(makePayload(succeededBody(), VALID_AUTH))
      ).rejects.toThrow()
    })

    it("THROWS on a non-transient re-fetch failure as well (redelivery over silent ack)", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error_code: 1001, description: "not found" }, 404)
      )
      const service = makeService()

      await expect(
        service.getWebhookActionAndData(makePayload(succeededBody(), VALID_AUTH))
      ).rejects.toThrow()
    })

    it("still acks bad auth quietly — auth failures NEVER throw", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error_code: 1001, description: "upstream down" }, 500)
      )
      const service = makeService()

      const result = await service.getWebhookActionAndData(
        makePayload(succeededBody(), "Basic bogus")
      )

      expect(result).toEqual({ action: "not_supported" })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("returns not_supported when the event carries no transaction id", async () => {
      const service = makeService()

      const result = await service.getWebhookActionAndData(
        makePayload({ type: "charge.succeeded" }, VALID_AUTH)
      )

      expect(result).toEqual({ action: "not_supported" })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe("amount guard (fix 3)", () => {
    it("returns the FETCHED charge amount, never the payload amount", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(fetchedCharge()))
      const service = makeService()

      const result = await service.getWebhookActionAndData(
        makePayload(succeededBody({ amount: 999999 }), VALID_AUTH)
      )

      expect(result.action).toBe("captured")
      expect(result.data?.amount).toBe(150.5)
    })
  })

  describe("session_id correlation by prefix (fix 4)", () => {
    it("strips the attempt nonce suffix from fetched charge.order_id", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(fetchedCharge({ order_id: `${SESSION_ID}-3` }))
      )
      const service = makeService()

      const result = await service.getWebhookActionAndData(
        makePayload(succeededBody(), VALID_AUTH)
      )

      expect(result.data?.session_id).toBe(SESSION_ID)
    })

    it("keeps an order_id without nonce suffix as-is", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(fetchedCharge({ order_id: SESSION_ID }))
      )
      const service = makeService()

      const result = await service.getWebhookActionAndData(
        makePayload(succeededBody(), VALID_AUTH)
      )

      expect(result.data?.session_id).toBe(SESSION_ID)
    })

    it("returns not_supported when the fetched charge has no order_id", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(fetchedCharge({ order_id: undefined }))
      )
      const service = makeService()

      const result = await service.getWebhookActionAndData(
        makePayload(succeededBody(), VALID_AUTH)
      )

      expect(result).toEqual({ action: "not_supported" })
    })
  })

  describe("event → action table (design §3.4)", () => {
    it("verification → not_supported and logs the verification_code", async () => {
      const service = makeService()

      const result = await service.getWebhookActionAndData(
        makePayload(
          { type: "verification", verification_code: "vc_12345" },
          VALID_AUTH
        )
      )

      expect(result).toEqual({ action: "not_supported" })
      expect(fetchMock).not.toHaveBeenCalled()
      const logged = logger.info.mock.calls.flat().join(" ")
      expect(logged).toContain("vc_12345")
    })

    it("charge.succeeded with fetched completed charge → captured with session data", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(fetchedCharge()))
      const service = makeService()

      const result = await service.getWebhookActionAndData(
        makePayload(succeededBody(), VALID_AUTH)
      )

      expect(result).toEqual({
        action: "captured",
        data: { session_id: SESSION_ID, amount: 150.5 },
      })
    })

    it.each(["charge.failed", "charge.cancelled", "charge.expired"])(
      "%s → failed",
      async (type) => {
        fetchMock.mockResolvedValueOnce(
          jsonResponse(fetchedCharge({ status: "failed" }))
        )
        const service = makeService()

        const result = await service.getWebhookActionAndData(
          makePayload({ ...succeededBody(), type }, VALID_AUTH)
        )

        expect(result).toEqual({
          action: "failed",
          data: { session_id: SESSION_ID, amount: 150.5 },
        })
      }
    )

    it("late charge.failed for a charge already completed → captured (out-of-order redelivery)", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(fetchedCharge({ status: "completed" }))
      )
      const service = makeService()

      const result = await service.getWebhookActionAndData(
        makePayload({ ...succeededBody(), type: "charge.failed" }, VALID_AUTH)
      )

      expect(result).toEqual({
        action: "captured",
        data: { session_id: SESSION_ID, amount: 150.5 },
      })
    })

    it("chargeback.created still maps to failed even when the charge shows completed", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(fetchedCharge({ status: "completed" }))
      )
      const service = makeService()

      const result = await service.getWebhookActionAndData(
        makePayload({ ...succeededBody(), type: "chargeback.created" }, VALID_AUTH)
      )

      expect(result).toEqual({
        action: "failed",
        data: { session_id: SESSION_ID, amount: 150.5 },
      })
    })

    it.each(["chargeback.created", "chargeback.accepted"])(
      "%s → failed",
      async (type) => {
        fetchMock.mockResolvedValueOnce(
          jsonResponse(fetchedCharge({ status: "chargeback_pending" }))
        )
        const service = makeService()

        const result = await service.getWebhookActionAndData(
          makePayload({ ...succeededBody(), type }, VALID_AUTH)
        )

        expect(result).toEqual({
          action: "failed",
          data: { session_id: SESSION_ID, amount: 150.5 },
        })
      }
    )

    it.each(["chargeback.rejected", "charge.refunded", "totally.unknown"])(
      "%s → not_supported without any API call",
      async (type) => {
        const service = makeService()

        const result = await service.getWebhookActionAndData(
          makePayload({ ...succeededBody(), type }, VALID_AUTH)
        )

        expect(result).toEqual({ action: "not_supported" })
        expect(fetchMock).not.toHaveBeenCalled()
      }
    )
  })
})

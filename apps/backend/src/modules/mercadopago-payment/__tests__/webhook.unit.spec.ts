/**
 * S4.2 — Mercado Pago webhook unit tests (hermetic, mocked fetch).
 *
 * Design §4.2 + amendment (obs #110) fixes 3/6:
 * - x-signature HMAC-SHA256 over the manifest
 *   `id:{data.id};request-id:{x-request-id};ts:{ts};` keyed by the resolved
 *   webhookSecret, compared with crypto.timingSafeEqual WITH a length guard
 *   (fix 6). Tampered/absent/odd-length signatures → not_supported, no state
 *   change, no API call.
 * - Only `type=payment` notifications are processed.
 * - Fetch-by-id (GET /v1/payments/{data.id}) is the ONLY source of truth —
 *   the returned amount is ALWAYS the fetched transaction_amount (fix 3).
 * - session_id correlation = fetched payment.external_reference.
 * - Status mapping: approved/authorized → captured; rejected/cancelled →
 *   failed; pending/in_process → pending. Unknown external_reference →
 *   acknowledged not_supported.
 */
import { createHmac } from "node:crypto"
import MercadoPagoPaymentProviderService from "../service"

const ACCESS_TOKEN = "TEST-access-token-123"
const WEBHOOK_SECRET = "whsec_test"
const SESSION_ID = "payses_01MP"
const PAYMENT_ID = "111"
const REQUEST_ID = "req-abc-123"
const TS = "1700000000"

const credentials = {
  accessToken: ACCESS_TOKEN,
  webhookSecret: WEBHOOK_SECRET,
  backendUrl: "https://api.store.example",
  sandbox: true,
}

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

const container = { logger }

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

/** Builds the exact v1 signature Mercado Pago would send for these inputs. */
const signManifest = (
  dataId: string,
  requestId: string,
  ts: string,
  secret = WEBHOOK_SECRET
) => {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`
  return createHmac("sha256", secret).update(manifest).digest("hex")
}

const validSignatureHeader = (
  dataId = PAYMENT_ID,
  requestId = REQUEST_ID,
  ts = TS
) => `ts=${ts},v1=${signManifest(dataId, requestId, ts)}`

type WebhookBody = {
  type?: string
  action?: string
  data?: { id?: string }
  ["data.id"]?: string
}

const makePayload = (
  body: WebhookBody,
  headers: Record<string, unknown> = {
    "x-signature": validSignatureHeader(),
    "x-request-id": REQUEST_ID,
  }
) => ({
  data: body as Record<string, unknown>,
  rawData: JSON.stringify(body),
  headers,
})

const paymentBody = (): WebhookBody => ({
  type: "payment",
  action: "payment.updated",
  data: { id: PAYMENT_ID },
})

const fetchedPayment = (overrides: Record<string, unknown> = {}) => ({
  id: Number(PAYMENT_ID),
  status: "approved",
  transaction_amount: 499,
  external_reference: SESSION_ID,
  ...overrides,
})

describe("MercadoPagoPaymentProviderService.getWebhookActionAndData", () => {
  let fetchMock: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    fetchMock = jest.spyOn(global, "fetch")
  })

  afterEach(() => {
    fetchMock.mockRestore()
  })

  describe("x-signature verification (fix 6)", () => {
    it("accepts a valid signature and processes the event", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(fetchedPayment()))
      const service = makeService()

      const result = await service.getWebhookActionAndData(makePayload(paymentBody()))

      expect(result.action).toBe("captured")
    })

    it("rejects a tampered signature without calling the API", async () => {
      const service = makeService()

      const result = await service.getWebhookActionAndData(
        makePayload(paymentBody(), {
          "x-signature": `ts=${TS},v1=${"0".repeat(64)}`,
          "x-request-id": REQUEST_ID,
        })
      )

      expect(result).toEqual({ action: "not_supported" })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalled()
    })

    it("rejects an absent x-signature header without calling the API", async () => {
      const service = makeService()

      const result = await service.getWebhookActionAndData(
        makePayload(paymentBody(), { "x-request-id": REQUEST_ID })
      )

      expect(result).toEqual({ action: "not_supported" })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("rejects an odd/short v1 without throwing (length guard, fix 6)", async () => {
      const service = makeService()

      const result = await service.getWebhookActionAndData(
        makePayload(paymentBody(), {
          "x-signature": `ts=${TS},v1=abc`,
          "x-request-id": REQUEST_ID,
        })
      )

      expect(result).toEqual({ action: "not_supported" })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("rejects ALL deliveries when the provider is unconfigured (source → null)", async () => {
      const service = makeService(async () => null)

      const result = await service.getWebhookActionAndData(makePayload(paymentBody()))

      expect(result).toEqual({ action: "not_supported" })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("resolves credentials PER DELIVERY: a rotated secret takes effect without restart", async () => {
      fetchMock.mockResolvedValue(jsonResponse(fetchedPayment()))
      let current = { ...credentials }
      const service = makeService(async () => current)

      const before = await service.getWebhookActionAndData(makePayload(paymentBody()))
      expect(before.action).toBe("captured")

      // Admin rotates the webhook secret; a delivery still signed with the OLD
      // secret is now rejected, one signed with the NEW secret is accepted.
      current = { ...credentials, webhookSecret: "whsec_rotated" }

      const stale = await service.getWebhookActionAndData(makePayload(paymentBody()))
      expect(stale).toEqual({ action: "not_supported" })

      const fresh = await service.getWebhookActionAndData(
        makePayload(paymentBody(), {
          "x-signature": `ts=${TS},v1=${signManifest(
            PAYMENT_ID,
            REQUEST_ID,
            TS,
            "whsec_rotated"
          )}`,
          "x-request-id": REQUEST_ID,
        })
      )
      expect(fresh.action).toBe("captured")
    })

    it("never logs the webhook secret on rejection", async () => {
      const service = makeService()

      await service.getWebhookActionAndData(
        makePayload(paymentBody(), {
          "x-signature": `ts=${TS},v1=${"0".repeat(64)}`,
          "x-request-id": REQUEST_ID,
        })
      )

      const logged = logger.warn.mock.calls.flat().join(" ")
      expect(logged).not.toContain(WEBHOOK_SECRET)
    })
  })

  describe("event filtering", () => {
    it("ignores non-payment notifications (not_supported, no API call)", async () => {
      const service = makeService()

      const result = await service.getWebhookActionAndData(
        makePayload({ type: "merchant_order", data: { id: PAYMENT_ID } })
      )

      expect(result).toEqual({ action: "not_supported" })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe("fetch-by-id is the only source of truth", () => {
    it("re-fetches the payment via GET /v1/payments/{data.id}", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(fetchedPayment()))
      const service = makeService()

      await service.getWebhookActionAndData(makePayload(paymentBody()))

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toBe(
        `https://api.mercadopago.com/v1/payments/${PAYMENT_ID}`
      )
      expect(init.method).toBe("GET")
    })

    it("returns the FETCHED transaction_amount, never a payload amount (fix 3)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(fetchedPayment()))
      const service = makeService()

      const result = await service.getWebhookActionAndData(makePayload(paymentBody()))

      expect(result.action).toBe("captured")
      expect(result.data?.amount).toBe(499)
    })

    it("correlates session_id from the fetched external_reference", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(fetchedPayment()))
      const service = makeService()

      const result = await service.getWebhookActionAndData(makePayload(paymentBody()))

      expect(result.data?.session_id).toBe(SESSION_ID)
    })

    it("acknowledges (not_supported) when the fetched payment has no external_reference", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(fetchedPayment({ external_reference: undefined }))
      )
      const service = makeService()

      const result = await service.getWebhookActionAndData(makePayload(paymentBody()))

      expect(result).toEqual({ action: "not_supported" })
    })

    it("THROWS when the re-fetch fails so Medusa responds 5xx and MP redelivers", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ message: "server error", status: 500 }, 500)
      )
      const service = makeService()

      await expect(
        service.getWebhookActionAndData(makePayload(paymentBody()))
      ).rejects.toThrow()
    })
  })

  describe("status → action mapping", () => {
    it.each(["approved", "authorized"])(
      "%s → captured with session data",
      async (status) => {
        fetchMock.mockResolvedValueOnce(jsonResponse(fetchedPayment({ status })))
        const service = makeService()

        const result = await service.getWebhookActionAndData(makePayload(paymentBody()))

        expect(result).toEqual({
          action: "captured",
          data: { session_id: SESSION_ID, amount: 499 },
        })
      }
    )

    it.each(["rejected", "cancelled"])("%s → failed", async (status) => {
      fetchMock.mockResolvedValueOnce(jsonResponse(fetchedPayment({ status })))
      const service = makeService()

      const result = await service.getWebhookActionAndData(makePayload(paymentBody()))

      expect(result).toEqual({
        action: "failed",
        data: { session_id: SESSION_ID, amount: 499 },
      })
    })

    it.each(["pending", "in_process"])("%s → pending", async (status) => {
      fetchMock.mockResolvedValueOnce(jsonResponse(fetchedPayment({ status })))
      const service = makeService()

      const result = await service.getWebhookActionAndData(makePayload(paymentBody()))

      expect(result.action).toBe("pending")
    })

    it("maps an unmapped status → not_supported", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(fetchedPayment({ status: "in_mediation" }))
      )
      const service = makeService()

      const result = await service.getWebhookActionAndData(makePayload(paymentBody()))

      expect(result.action).toBe("not_supported")
    })
  })
})

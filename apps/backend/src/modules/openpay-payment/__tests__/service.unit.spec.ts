/**
 * S2.2 — OpenpayPaymentProviderService unit tests (hermetic, mocked fetch).
 *
 * Slice 3 (admin-provider-settings): credentials now arrive through an async
 * `credentialSource` (DB-backed in production, faked here). Unconfigured
 * (source → null) rejects every payment op with INVALID_DATA and never calls
 * the API; a credential rotation (new fingerprint) rebuilds the immutable
 * client on the next op.
 *
 * Authorize mapping table per design §3.2 + amendment (obs #110) fixes 3/4:
 * - completed → captured
 * - charge_pending + payment_method.url → requires_more with redirect_url + charge_id
 * - declined → MedusaError carrying the Openpay error code
 * - re-entry with charge_id re-fetches, NEVER creates a second charge
 * - amount derived at authorize-time from session data; mismatch between
 *   session amount and fetched charge amount rejected (fix 3)
 * - order_id sent as `{session_id}-{n}` attempt nonce, incremented on
 *   retry-after-decline (fix 4)
 * - missing token → PAYMENT_AUTHORIZATION_ERROR, no charge attempted
 * - raw card fields in initiate data → INVALID_DATA
 * - refund posts to /charges/{id}/refund with as-is amount; failure throws
 * - cancel with no/uncompleted charge makes no API call
 */
import { MedusaError } from "@medusajs/framework/utils"
import { OPENPAY_IDENTIFIER } from "../../../lib/constants"
import OpenpayPaymentProviderService, { sessionIdFromOrderId } from "../service"

const MERCHANT_ID = "m_test_123"
const PRIVATE_KEY = "sk_test_private"
const SESSION_ID = "payses_01TEST"

const credentials = {
  merchantId: MERCHANT_ID,
  privateKey: PRIVATE_KEY,
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
  new OpenpayPaymentProviderService(container as never, { credentialSource })

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  }) as unknown as Response

const baseSessionData = {
  session_id: SESSION_ID,
  amount: 150.5,
  currency_code: "mxn",
  token_id: "tok_abc",
  device_session_id: "dev_xyz",
  return_url: "https://store.example/mx/payment/openpay/return",
  // Openpay requires a customer on card charges (API error 1001). The storefront
  // sends this off the cart so it is present for guest checkout too.
  customer: {
    name: "Juan",
    last_name: "Perez",
    email: "juan@example.com",
    phone_number: "5512345678",
  },
}

describe("OpenpayPaymentProviderService", () => {
  let fetchMock: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    fetchMock = jest.spyOn(global, "fetch")
  })

  afterEach(() => {
    fetchMock.mockRestore()
  })

  it("exposes the identifier from the shared constants module", () => {
    expect(OpenpayPaymentProviderService.identifier).toBe(OPENPAY_IDENTIFIER)
  })

  describe("validateOptions (slice 3 — always-registered, empty options valid)", () => {
    it("accepts an EMPTY options object (credentials live in the DB now)", () => {
      expect(() =>
        OpenpayPaymentProviderService.validateOptions({})
      ).not.toThrow()
    })

    it("accepts a legacy well-shaped options object", () => {
      expect(() =>
        OpenpayPaymentProviderService.validateOptions(credentials)
      ).not.toThrow()
    })

    it("still rejects PRESENT but malformed fields with INVALID_DATA", () => {
      expect(() =>
        OpenpayPaymentProviderService.validateOptions({ merchantId: 42 })
      ).toThrow(MedusaError)
      expect(() =>
        OpenpayPaymentProviderService.validateOptions({ privateKey: "" })
      ).toThrow(MedusaError)
    })
  })

  describe("unconfigured provider (source → null) — fail-safe inert", () => {
    const unconfigured = () => makeService(async () => null)

    it.each([
      [
        "initiatePayment",
        (s: OpenpayPaymentProviderService) =>
          s.initiatePayment({
            amount: 100,
            currency_code: "mxn",
            data: { ...baseSessionData },
          }),
      ],
      [
        "authorizePayment",
        (s: OpenpayPaymentProviderService) =>
          s.authorizePayment({ data: { ...baseSessionData } }),
      ],
      [
        "getPaymentStatus (with charge)",
        (s: OpenpayPaymentProviderService) =>
          s.getPaymentStatus({
            data: { ...baseSessionData, charge_id: "ch_100" },
          }),
      ],
      [
        "retrievePayment (with charge)",
        (s: OpenpayPaymentProviderService) =>
          s.retrievePayment({
            data: { ...baseSessionData, charge_id: "ch_100" },
          }),
      ],
      [
        "refundPayment",
        (s: OpenpayPaymentProviderService) =>
          s.refundPayment({
            amount: 50,
            data: { ...baseSessionData, charge_id: "ch_100" },
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
    it("uses the rotated key and base URL on the next op without a restart", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "ch_100",
          status: "completed",
          amount: 150.5,
          currency: "MXN",
          order_id: `${SESSION_ID}-1`,
        })
      )
      let current = { ...credentials }
      const service = makeService(async () => current)

      await service.retrievePayment({
        data: { ...baseSessionData, charge_id: "ch_100" },
      })
      // Admin rotates the private key and flips to production mode.
      current = {
        merchantId: MERCHANT_ID,
        privateKey: "sk_live_rotated",
        sandbox: false,
      }
      await service.retrievePayment({
        data: { ...baseSessionData, charge_id: "ch_100" },
      })

      const firstInit = fetchMock.mock.calls[0][1]
      const secondInit = fetchMock.mock.calls[1][1]
      expect(firstInit.headers.Authorization).toBe(
        `Basic ${Buffer.from(`${PRIVATE_KEY}:`).toString("base64")}`
      )
      expect(secondInit.headers.Authorization).toBe(
        `Basic ${Buffer.from("sk_live_rotated:").toString("base64")}`
      )
      expect(String(fetchMock.mock.calls[0][0])).toContain("sandbox-api")
      expect(String(fetchMock.mock.calls[1][0])).toContain(
        "https://api.openpay.mx"
      )
    })

    it("reuses the cached client while the fingerprint is unchanged", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "ch_100",
          status: "completed",
          amount: 150.5,
          currency: "MXN",
          order_id: `${SESSION_ID}-1`,
        })
      )
      const source = jest.fn(async () => ({ ...credentials }))
      const service = makeService(source)

      await service.retrievePayment({
        data: { ...baseSessionData, charge_id: "ch_100" },
      })
      await service.retrievePayment({
        data: { ...baseSessionData, charge_id: "ch_100" },
      })

      // Credentials are re-resolved per op (rotation window), but the equal
      // fingerprint keeps both requests on the same immutable client config.
      expect(source).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
        fetchMock.mock.calls[1][1].headers.Authorization
      )
    })
  })

  describe("initiatePayment", () => {
    it("stores session data without any external call", async () => {
      const service = makeService()

      const result = await service.initiatePayment({
        amount: 150.5,
        currency_code: "mxn",
        data: { ...baseSessionData },
      })

      expect(result.id).toBe(SESSION_ID)
      expect(result.data).toMatchObject({
        session_id: SESSION_ID,
        amount: 150.5,
        currency_code: "mxn",
        token_id: "tok_abc",
        device_session_id: "dev_xyz",
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("strips provider-owned keys injected by the client (charge replay guard)", async () => {
      const service = makeService()

      const result = await service.initiatePayment({
        amount: 150.5,
        currency_code: "mxn",
        data: {
          ...baseSessionData,
          charge_id: "ch_foreign",
          charge_status: "completed",
          redirect_url: "https://evil.example/3ds",
        },
      })

      expect(result.data).not.toHaveProperty("charge_id")
      expect(result.data).not.toHaveProperty("charge_status")
      expect(result.data).not.toHaveProperty("redirect_url")
    })

    it("rejects raw card fields with INVALID_DATA and never calls the API (OP-2)", async () => {
      const service = makeService()

      await expect(
        service.initiatePayment({
          amount: 100,
          currency_code: "mxn",
          data: {
            session_id: SESSION_ID,
            card_number: "4111111111111111",
            cvv2: "123",
          },
        })
      ).rejects.toMatchObject({
        constructor: MedusaError,
        type: MedusaError.Types.INVALID_DATA,
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe("updatePayment", () => {
    it("strips provider-owned keys injected by the client (charge replay guard)", async () => {
      const service = makeService()

      const result = await service.updatePayment({
        amount: 150.5,
        currency_code: "mxn",
        data: {
          ...baseSessionData,
          charge_id: "ch_foreign",
          charge_status: "completed",
          redirect_url: "https://evil.example/3ds",
        },
      })

      expect(result.data).not.toHaveProperty("charge_id")
      expect(result.data).not.toHaveProperty("charge_status")
      expect(result.data).not.toHaveProperty("redirect_url")
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe("authorizePayment — fresh charge", () => {
    it("creates a charge with authorize-time amount and maps completed → captured", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "ch_100",
          status: "completed",
          amount: 150.5,
          currency: "MXN",
          order_id: `${SESSION_ID}-1`,
        })
      )
      const service = makeService()

      const result = await service.authorizePayment({
        data: { ...baseSessionData },
      })

      expect(result.status).toBe("captured")
      expect(result.data).toMatchObject({ charge_id: "ch_100" })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(
        `https://sandbox-api.openpay.mx/v1/${MERCHANT_ID}/charges`
      )
      expect(init.method).toBe("POST")
      const body = JSON.parse(init.body as string)
      expect(body).toMatchObject({
        method: "card",
        source_id: "tok_abc",
        amount: 150.5, // derived at authorize-time from session data (fix 3)
        currency: "MXN",
        device_session_id: "dev_xyz",
        order_id: `${SESSION_ID}-1`, // attempt nonce (fix 4)
        use_3d_secure: true,
        capture: true,
        redirect_url: baseSessionData.return_url,
        // Openpay requires customer (API error 1001) — sent off the cart.
        customer: {
          name: "Juan",
          last_name: "Perez",
          email: "juan@example.com",
          phone_number: "5512345678",
        },
      })
    })

    it("maps charge_pending + payment_method.url → requires_more with redirect_url and charge_id (3DS)", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "ch_3ds",
          status: "charge_pending",
          amount: 150.5,
          currency: "MXN",
          payment_method: {
            type: "redirect",
            url: "https://sandbox-api.openpay.mx/3ds/ch_3ds",
          },
        })
      )
      const service = makeService()

      const result = await service.authorizePayment({
        data: { ...baseSessionData },
      })

      expect(result.status).toBe("requires_more")
      expect(result.data).toMatchObject({
        charge_id: "ch_3ds",
        redirect_url: "https://sandbox-api.openpay.mx/3ds/ch_3ds",
      })
    })

    it("sends the client IP as X-Forwarded-For (anti-fraud) and NOT in the charge body", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "ch_ip",
          status: "completed",
          amount: 150.5,
          currency: "MXN",
          order_id: `${SESSION_ID}-1`,
        })
      )
      const service = makeService()

      await service.authorizePayment({
        data: { ...baseSessionData, customer_ip: "201.150.10.20" },
      })

      const [, init] = fetchMock.mock.calls[0]
      expect(init.headers).toMatchObject({ "X-Forwarded-For": "201.150.10.20" })
      // The IP is a header, never part of the JSON charge body.
      const body = JSON.parse(init.body as string)
      expect(body).not.toHaveProperty("customer_ip")
    })

    it("omits X-Forwarded-For entirely when no client IP is present (never sends server IP)", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "ch_noip",
          status: "completed",
          amount: 150.5,
          currency: "MXN",
          order_id: `${SESSION_ID}-1`,
        })
      )
      const service = makeService()

      await service.authorizePayment({
        data: { ...baseSessionData, customer_ip: undefined },
      })

      const [, init] = fetchMock.mock.calls[0]
      expect(init.headers).not.toHaveProperty("X-Forwarded-For")
    })

    /**
     * ## The message on this error is READ BY THE SHOPPER
     *
     * Medusa puts a `PAYMENT_AUTHORIZATION_ERROR` message on the cart-completion
     * response, and the storefront renders `Error.message` verbatim. This test
     * used to assert `stringContaining("3001")`, which is exactly backwards: it
     * PINNED the leak. The string it was guarding —
     * `Openpay error 3001: The card was declined` — was the single most-read
     * failure sentence in the checkout, in English, with an internal error
     * number in it.
     *
     * The error now carries a classified token. The Spanish lives in the
     * storefront's own catalogue, where that app's specs sweep it for register
     * and language; this side only decides WHICH failure it was.
     */
    it("throws a classified token, never the Openpay code or description", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          {
            error_code: 3001,
            description: "The card was declined",
            http_code: 402,
          },
          402
        )
      )
      const service = makeService()

      await expect(
        service.authorizePayment({ data: { ...baseSessionData } })
      ).rejects.toMatchObject({
        constructor: MedusaError,
        type: MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
        message: "payment_failed:card_declined",
      })
    })

    /**
     * The code did not disappear — it moved to the log, which is now the ONLY
     * record of it. A decline nobody can diagnose is not an improvement over a
     * decline the customer had to read.
     */
    it("logs the code and description it no longer transmits", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          {
            error_code: 3003,
            description: "The card doesn't have sufficient funds",
            http_code: 402,
          },
          402
        )
      )
      container.logger.error.mockClear()
      const service = makeService()

      await expect(
        service.authorizePayment({ data: { ...baseSessionData } })
      ).rejects.toMatchObject({ message: "payment_failed:insufficient_funds" })

      const logged = container.logger.error.mock.calls
        .map(([message]) => String(message))
        .join("\n")

      expect(logged).toContain("3003")
      expect(logged).toContain("insufficient_funds")
      // The description too: support needs the provider's own words, and this
      // line is the only place they still exist.
      expect(logged).toContain("sufficient funds")
    })

    /**
     * The OTHER leak, and the one with more volume behind it: a charge that
     * came back 2xx in a failed status. It threw
     * `Openpay charge ch_x is failed: <english>` — our internal charge id, in
     * front of the customer.
     *
     * There is no `error_code` on a charge body, so there is nothing to
     * classify and the token is the unclassified default.
     */
    it("does not leak the charge id or provider text on a failed charge", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "ch_failed_01",
          status: "failed",
          amount: 150.5,
          currency: "MXN",
          order_id: `${SESSION_ID}-1`,
          error_message: "The card was declined by the bank",
        })
      )
      const service = makeService()

      await expect(
        service.authorizePayment({ data: { ...baseSessionData } })
      ).rejects.toMatchObject({
        type: MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
        message: "payment_failed:card_declined",
      })
    })

    it("persists the attempt counter in session data and builds the order_id nonce from it (multi-instance safe)", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "ch_retry",
          status: "completed",
          amount: 150.5,
          currency: "MXN",
          order_id: `${SESSION_ID}-2`,
        })
      )
      const service = makeService()

      // A prior attempt was persisted in session data by an earlier authorize
      // (possibly on ANOTHER instance) — the nonce must continue from it.
      const result = await service.authorizePayment({
        data: { ...baseSessionData, attempt: 1 },
      })

      expect(result.status).toBe("captured")
      expect(result.data).toMatchObject({ attempt: 2 })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.order_id).toBe(`${SESSION_ID}-2`)
    })

    it("starts the persisted attempt counter at 1 for a fresh session", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "ch_100",
          status: "completed",
          amount: 150.5,
          currency: "MXN",
          order_id: `${SESSION_ID}-1`,
        })
      )
      const service = makeService()

      const result = await service.authorizePayment({
        data: { ...baseSessionData },
      })

      expect(result.data).toMatchObject({ attempt: 1 })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.order_id).toBe(`${SESSION_ID}-1`)
    })

    it("throws PAYMENT_AUTHORIZATION_ERROR without any API call when the token is missing (OP-2)", async () => {
      const service = makeService()

      await expect(
        service.authorizePayment({
          data: { ...baseSessionData, token_id: undefined },
        })
      ).rejects.toMatchObject({
        constructor: MedusaError,
        type: MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("throws (no API call) when neither session nor context carries a customer — Openpay requires it (API error 1001)", async () => {
      const service = makeService()

      await expect(
        service.authorizePayment({
          data: { ...baseSessionData, customer: undefined },
        })
      ).rejects.toMatchObject({
        constructor: MedusaError,
        type: MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("falls back to input.context.customer when the session has no customer (logged-in checkout)", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "ch_ctx",
          status: "completed",
          amount: 150.5,
          currency: "MXN",
          order_id: `${SESSION_ID}-1`,
        })
      )
      const service = makeService()

      await service.authorizePayment({
        data: { ...baseSessionData, customer: undefined },
        context: {
          customer: {
            first_name: "Ana",
            last_name: "Lopez",
            email: "ana@example.com",
            phone: "5599998888",
          },
        },
      } as never)

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.customer).toMatchObject({
        name: "Ana",
        last_name: "Lopez",
        email: "ana@example.com",
        phone_number: "5599998888",
      })
    })
  })

  describe("authorizePayment — re-entry with existing charge_id (OP-4 resume)", () => {
    it("re-fetches the charge and NEVER creates a second charge", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "ch_100",
          status: "completed",
          amount: 150.5,
          currency: "MXN",
          order_id: `${SESSION_ID}-1`,
        })
      )
      const service = makeService()

      const result = await service.authorizePayment({
        data: { ...baseSessionData, charge_id: "ch_100" },
      })

      expect(result.status).toBe("captured")
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(
        `https://sandbox-api.openpay.mx/v1/${MERCHANT_ID}/charges/ch_100`
      )
      expect(init.method).toBe("GET")
    })

    it("maps a still-pending fetched charge → requires_more with redirect_url", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "ch_3ds",
          status: "charge_pending",
          amount: 150.5,
          currency: "MXN",
          order_id: `${SESSION_ID}-1`,
          payment_method: {
            type: "redirect",
            url: "https://sandbox-api.openpay.mx/3ds/ch_3ds",
          },
        })
      )
      const service = makeService()

      const result = await service.authorizePayment({
        data: { ...baseSessionData, charge_id: "ch_3ds" },
      })

      expect(result.status).toBe("requires_more")
      expect(result.data).toMatchObject({
        redirect_url: "https://sandbox-api.openpay.mx/3ds/ch_3ds",
      })
    })

    it("rejects a replayed charge that belongs to ANOTHER session (charge replay guard)", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "ch_foreign",
          status: "completed",
          amount: 150.5, // amount matches — the order_id correlation must catch it
          currency: "MXN",
          order_id: "payses_01OTHER-1",
        })
      )
      const service = makeService()

      await expect(
        service.authorizePayment({
          data: { ...baseSessionData, charge_id: "ch_foreign" },
        })
      ).rejects.toMatchObject({
        constructor: MedusaError,
        type: MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
        message: expect.stringContaining("does not belong"),
      })
    })

    it("rejects when the fetched charge amount does not match the session amount (fix 3)", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "ch_100",
          status: "completed",
          amount: 999.99, // tampered / stale — session says 150.5
          currency: "MXN",
          order_id: `${SESSION_ID}-1`,
        })
      )
      const service = makeService()

      await expect(
        service.authorizePayment({
          data: { ...baseSessionData, charge_id: "ch_100" },
        })
      ).rejects.toMatchObject({
        constructor: MedusaError,
        message: expect.stringContaining("mismatch"),
      })
    })

    it("tolerates float noise in the fetched amount via centavo-integer comparison", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "ch_100",
          status: "completed",
          amount: 1234.5600000001, // float noise — same centavo value
          currency: "MXN",
          order_id: `${SESSION_ID}-1`,
        })
      )
      const service = makeService()

      const result = await service.authorizePayment({
        data: { ...baseSessionData, amount: 1234.56, charge_id: "ch_100" },
      })

      expect(result.status).toBe("captured")
    })

    it("still rejects a real centavo-level amount mismatch", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "ch_100",
          status: "completed",
          amount: 1235.56,
          currency: "MXN",
          order_id: `${SESSION_ID}-1`,
        })
      )
      const service = makeService()

      await expect(
        service.authorizePayment({
          data: { ...baseSessionData, amount: 1234.56, charge_id: "ch_100" },
        })
      ).rejects.toMatchObject({
        constructor: MedusaError,
        message: expect.stringContaining("mismatch"),
      })
    })

    it("throws PAYMENT_AUTHORIZATION_ERROR when the fetched charge failed", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "ch_100",
          status: "failed",
          amount: 150.5,
          currency: "MXN",
          order_id: `${SESSION_ID}-1`,
          error_message: "3DS authentication failed",
        })
      )
      const service = makeService()

      await expect(
        service.authorizePayment({
          data: { ...baseSessionData, charge_id: "ch_100" },
        })
      ).rejects.toMatchObject({
        constructor: MedusaError,
        type: MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
      })
    })
  })

  describe("refundPayment (OP-5)", () => {
    it("posts to /charges/{id}/refund with the as-is amount", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ id: "ch_100", status: "refunded", amount: 150.5 })
      )
      const service = makeService()

      await service.refundPayment({
        amount: 50.25,
        data: { ...baseSessionData, charge_id: "ch_100" },
      })

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(
        `https://sandbox-api.openpay.mx/v1/${MERCHANT_ID}/charges/ch_100/refund`
      )
      expect(init.method).toBe("POST")
      expect(JSON.parse(init.body as string)).toMatchObject({ amount: 50.25 })
    })

    it("throws a MedusaError when the provider refund fails, leaving Medusa state unchanged", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          { error_code: 1001, description: "Refund not allowed" },
          409
        )
      )
      const service = makeService()

      await expect(
        service.refundPayment({
          amount: 50,
          data: { ...baseSessionData, charge_id: "ch_100" },
        })
      ).rejects.toThrow(MedusaError)
    })
  })

  describe("cancelPayment (OP-5)", () => {
    it("makes no API call when there is no charge", async () => {
      const service = makeService()

      const result = await service.cancelPayment({
        data: { ...baseSessionData },
      })

      expect(result.data).toMatchObject({ session_id: SESSION_ID })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("makes no API call for an uncompleted charge", async () => {
      const service = makeService()

      await service.cancelPayment({
        data: {
          ...baseSessionData,
          charge_id: "ch_3ds",
          charge_status: "charge_pending",
        },
      })

      expect(fetchMock).not.toHaveBeenCalled()
      expect(container.logger.info).not.toHaveBeenCalled()
    })

    it("logs the no-op when cancelling a completed charge (refund is admin-driven)", async () => {
      const service = makeService()

      await service.cancelPayment({
        data: {
          ...baseSessionData,
          charge_id: "ch_100",
          charge_status: "completed",
        },
      })

      expect(fetchMock).not.toHaveBeenCalled()
      const logged = container.logger.info.mock.calls.flat().join(" ")
      expect(logged).toContain("ch_100")
    })
  })

  describe("sessionIdFromOrderId format invariant", () => {
    it("strips exactly one trailing -{digits} attempt nonce", () => {
      expect(sessionIdFromOrderId(`${SESSION_ID}-3`)).toBe(SESSION_ID)
      expect(sessionIdFromOrderId(SESSION_ID)).toBe(SESSION_ID)
    })

    it("documents that session ids must NEVER end in -digits (would be mangled)", () => {
      // INVARIANT: Medusa session ids (payses_...) never end in `-digits`.
      // If one ever did, the prefix correlation would strip part of the id:
      expect(sessionIdFromOrderId("sess-42")).toBe("sess")
      // ...so the `{session_id}-{n}` order_id format depends on this guard.
      expect(SESSION_ID).not.toMatch(/-\d+$/)
    })
  })

  describe("capturePayment", () => {
    it("is a no-op returning the session data (capture-at-creation)", async () => {
      const service = makeService()

      const result = await service.capturePayment({
        data: { ...baseSessionData, charge_id: "ch_100" },
      })

      expect(result.data).toMatchObject({ charge_id: "ch_100" })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

})

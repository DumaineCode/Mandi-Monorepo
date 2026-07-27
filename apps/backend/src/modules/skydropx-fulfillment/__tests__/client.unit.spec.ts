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
  QUOTE_POLL_INTERVAL_MS,
  SKYDROPX_CANCEL_TIMEOUT_MS,
  SKYDROPX_QUOTATION_TIMEOUT_MS,
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
    // Mirrors a real Response: the error path reads text() so an unanticipated
    // body shape is never lost.
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }) as unknown as Response

/**
 * A request that never answers on its own and rejects with `AbortError` when the
 * caller's AbortController fires — the shape native `fetch` produces on abort.
 * Needed because a plain mocked Response resolves instantly and can never
 * exercise the timeout branch.
 */
const hangingResponse = (init: RequestInit): Response =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => {
      const abortError = new Error("The operation was aborted.")
      abortError.name = "AbortError"
      reject(abortError)
    })
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

    /**
     * A retry the budget cannot afford must not rewrite the diagnosis. The
     * no-dispatch guard turns an unaffordable retry into a timeout error; if that
     * replaced the 401, an operator reading the containment log would chase a
     * budget problem that is actually an auth problem.
     */
    it("surfaces the 401, not a timeout, when the retry cannot be afforded", async () => {
      let now = 1_700_000_000_000
      jest.spyOn(Date, "now").mockImplementation(() => now)

      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /quotations": () => {
          now += 8_000 // the first attempt spends the whole deadline
          return jsonResponse({ error: "unauthorized" }, 401)
        },
      })
      const client = makeClient()

      const error = await client
        .createQuotation(QUOTATION_BODY, now + 8_000)
        .then(
          () => {
            throw new Error("expected createQuotation to reject")
          },
          (e) => e as SkydropxApiError
        )

      expect(error.httpStatus).toBe(401)
      expect(error.errorCode).not.toBe("timeout")
      // ...and the budget fact is preserved, not erased: "401" alone would send
      // an operator to rotate credentials over an exhausted deadline.
      expect(error.description).toMatch(/retry was never attempted/)
      expect(error.description).toMatch(/budget/)
    })

    /**
     * `getToken_` de-duplicates concurrent cold callers onto ONE in-flight fetch,
     * which carries the FIRST caller's deadline. A joiner with budget of its own —
     * above all the containment cancel, whose entire job is to run when some other
     * budget just died — must not inherit that caller's exhaustion.
     */
    it("does not hand a joiner the first caller's token failure", async () => {
      let tokenAttempts = 0
      routeFetch(fetchMock, {
        "POST /oauth/token": () => {
          tokenAttempts += 1
          return tokenResponse()
        },
      })
      const client = makeClient()

      // First caller's budget is already spent, so its in-flight fetch is refused
      // before it leaves the process. The joiner still has 10s of its own.
      const doomed = (client as any).getToken_(Date.now() - 1)
      const joiner = (client as any).getToken_(Date.now() + 10_000)

      await expect(doomed).rejects.toMatchObject({ errorCode: "timeout" })
      await expect(joiner).resolves.toBe("tok_123")
      // The joiner had to run its own fetch — it could not reuse a failed one.
      expect(tokenAttempts).toBe(1)
    })

    /**
     * ...but the joiners must retry as ONE new leader, not N independent fetches.
     * A bare per-joiner retry turns a single auth blip into the exact stampede
     * single-flight exists to prevent, against a documented 2 req/s carrier cap.
     */
    it("retries a failed shared token fetch once, not once per joiner", async () => {
      let tokenAttempts = 0
      routeFetch(fetchMock, {
        "POST /oauth/token": () => {
          tokenAttempts += 1
          // The leader's fetch fails; every joiner must converge on ONE retry.
          return tokenAttempts === 1
            ? jsonResponse({ error: "server_error" }, 500)
            : tokenResponse()
        },
      })
      const client = makeClient()

      const deadline = Date.now() + 10_000
      const leader = (client as any).getToken_(deadline)
      const joiners = [
        (client as any).getToken_(deadline),
        (client as any).getToken_(deadline),
        (client as any).getToken_(deadline),
      ]
      const settled = await Promise.allSettled([leader, ...joiners])

      // The leader owns its own failure and propagates it...
      expect(settled[0].status).toBe("rejected")
      // ...while every joiner, whose budget is its own, recovers.
      expect(settled.slice(1).every((c) => c.status === "fulfilled")).toBe(true)
      // 1 failed leader + exactly 1 shared retry — never one retry per joiner.
      expect(tokenAttempts).toBe(2)
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

    /**
     * Regression for the production incident: a poll cut short by the SHARED
     * deadline used to report "Skydropx request timed out after 912ms", blaming
     * Skydropx for a budget the caller had spent. The two failures must be
     * distinguishable in the message, because they have opposite remedies:
     * one is "the carrier is slow", the other is "our budget is too small".
     */
    it("names the caller's budget — not Skydropx — when the shared deadline cuts a poll short", async () => {
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "GET /quotations": (init) => hangingResponse(init),
      })
      const client = makeClient()

      const error = await client
        .getQuotation("q1", Date.now() + 150)
        .then(
          () => {
            throw new Error("expected getQuotation to reject")
          },
          (e) => e as SkydropxApiError
        )

      expect(error).toBeInstanceOf(SkydropxApiError)
      expect(error.errorCode).toBe("timeout")
      expect(error.description).toMatch(/cut short by the caller's budget/)
      expect(error.description).toMatch(/Skydropx did not time out/)
      // The misleading phrasing must be gone from this path entirely.
      expect(error.description).not.toMatch(/timed out after/)
    })

    it("still reports a genuine Skydropx timeout as a request timeout", async () => {
      jest.useFakeTimers()
      try {
        routeFetch(fetchMock, {
          "POST /oauth/token": () => tokenResponse(),
          "GET /quotations": (init) => hangingResponse(init),
        })
        const client = makeClient()

        // No deadline → the LOCAL per-request bound is what fires, and that
        // genuinely is Skydropx failing to answer. Driven through the public API
        // with fake timers rather than by calling the private transport.
        const pending = client.getQuotation("q1").then(
          () => {
            throw new Error("expected getQuotation to reject")
          },
          (e: SkydropxApiError) => e
        )
        await jest.advanceTimersByTimeAsync(SKYDROPX_QUOTATION_TIMEOUT_MS + 1)
        const error = await pending

        expect(error.description).toBe(
          `Skydropx request timed out after ${SKYDROPX_QUOTATION_TIMEOUT_MS}ms`
        )
      } finally {
        jest.useRealTimers()
      }
    })

    /**
     * The poll loop must keep spending budget it actually has. An earlier fix
     * reserved a fixed floor before each poll, which silently discarded the last
     * round on the 8s checkout budget — a regression on the shopper-facing path.
     * Asserted against the checkout budget specifically, with a fake clock the
     * poll sleep advances, so the count is deterministic and not wall-clock bound.
     */
    it("spends every poll round the budget affords on the checkout path", async () => {
      let now = 1_700_000_000_000
      jest.spyOn(Date, "now").mockImplementation(() => now)

      let getCalls = 0
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /quotations": () => {
          now += 300 // the create itself costs budget
          return jsonResponse({ id: "q1", is_completed: false })
        },
        "GET /quotations": () => {
          getCalls += 1
          return jsonResponse({ id: "q1", is_completed: false })
        },
      })
      const client = makeClient()
      jest
        .spyOn(client as any, "sleep_")
        .mockImplementation(async (ms) => {
          now += ms as number
        })

      const deadline = now + SKYDROPX_QUOTATION_TIMEOUT_MS
      await expect(client.quoteAndPoll_(QUOTATION_BODY, deadline)).rejects.toMatchObject({
        errorCode: "timeout",
      })

      // 8000ms budget, 300ms spent creating, one poll per 1000ms sleep.
      const affordable = Math.floor(
        (SKYDROPX_QUOTATION_TIMEOUT_MS - 300) / QUOTE_POLL_INTERVAL_MS
      )
      expect(getCalls).toBe(affordable)
    })

    it("reports budget exhaustion without telling the caller to retry a fulfillment", async () => {
      let now = 1_700_000_000_000
      jest.spyOn(Date, "now").mockImplementation(() => now)

      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /quotations": () =>
          jsonResponse({ id: "q1", is_completed: false }),
        "GET /quotations": () => jsonResponse({ id: "q1", is_completed: false }),
      })
      const client = makeClient()
      jest
        .spyOn(client as any, "sleep_")
        .mockImplementation(async (ms) => {
          now += ms as number
        })

      // Enough budget to start and poll once, not enough to finish.
      const error = await client
        .quoteAndPoll_(QUOTATION_BODY, now + 1_500)
        .then(
          () => {
            throw new Error("expected quoteAndPoll_ to reject")
          },
          (e) => e as SkydropxApiError
        )

      expect(error.description).toMatch(/did not reach is_completed within the budget/)
      expect(error.description).toContain("q1")
      // quoteAndPoll_ is shared with the storefront checkout path, where a shopper
      // must never be told to retry an operation they cannot perform.
      expect(error.description).not.toMatch(/fulfillment/i)
    })

    /**
     * A request whose budget is already spent aborts on the next tick no matter
     * what, so issuing it only buys a wasted round-trip — and on a POST it can
     * cost a real side effect the caller never learns about. Nothing may leave
     * the process.
     */
    it("issues no request at all when the budget is already spent", async () => {
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /quotations": () =>
          jsonResponse({ id: "q1", is_completed: false }),
      })
      const client = makeClient()

      const error = await client
        .quoteAndPoll_(QUOTATION_BODY, Date.now() - 1)
        .then(
          () => {
            throw new Error("expected quoteAndPoll_ to reject")
          },
          (e) => e as SkydropxApiError
        )

      expect(error.errorCode).toBe("timeout")
      expect(error.description).toMatch(/cut short by the caller's budget/)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("refuses to poll a quotation Skydropx returned without an id", async () => {
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /quotations": () => jsonResponse({ is_completed: false }),
      })
      const client = makeClient()

      await expect(
        client.quoteAndPoll_(QUOTATION_BODY, Date.now() + 8_000)
      ).rejects.toMatchObject({ errorCode: "invalid_response" })
      // No `GET /quotations/undefined` may be attempted.
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).includes("undefined"))
      ).toBe(false)
    })

    /**
     * `authed_` refreshes the token and retries ONCE on a 401, so the containment
     * cancel is 2 token fetches + 2 attempts. With a bare per-request bound those
     * four are independent and cost 3+10+3+10 = 26s appended to an ALREADY-failing
     * request — on top of a fulfillment budget that is, by definition, spent.
     * Anchored, the whole path fits in SKYDROPX_CANCEL_TIMEOUT_MS.
     *
     * Asserted on simulated wall-clock, not on the sum of armed timers: bounds are
     * recomputed against the deadline, so they overlap rather than accumulate.
     */
    it("keeps the containment cancel inside its bound across the 401 retry", async () => {
      let now = 1_700_000_000_000
      const start = now
      jest.spyOn(Date, "now").mockImplementation(() => now)

      routeFetch(fetchMock, {
        "POST /oauth/token": () => {
          now += 3_000 // a slow token fetch spends the cancel's budget
          return tokenResponse()
        },
        "POST /cancellations": () => {
          now += 7_000 // ...and so does the attempt itself
          return jsonResponse({ error: "unauthorized" }, 401)
        },
      })
      const client = makeClient()

      await expect(client.cancelShipment("shp_1", "abandoned")).rejects.toBeInstanceOf(
        SkydropxApiError
      )

      expect(now - start).toBeLessThanOrEqual(SKYDROPX_CANCEL_TIMEOUT_MS)
      // The retry must not be dispatched on a budget that is already gone.
      expect(fetchMock).toHaveBeenCalledTimes(2)
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
        // Method, path and status lead the message: the label flow issues
        // several calls and knowing WHICH one broke is most of the diagnosis.
        description: "POST /quotations → HTTP 422: zip invalid",
      })
    })

    /**
     * Regression for a blind production failure: the admin surfaced
     * "Skydropx label purchase failed: " — no status, no body, no endpoint.
     *
     * The old cascade ended at `response.statusText`, which Node's fetch routinely
     * leaves blank, so any error body without `error_description`/`errors`
     * described itself as the empty string. An unactionable error is worse than a
     * crash: the operator cannot even tell which request failed.
     */
    it.each([
      [
        "a body with an unanticipated shape",
        { message: "Carta Porte code rejected" },
        /Carta Porte code rejected/,
      ],
      [
        "a body with only an error code",
        { error: "insufficient_funds" },
        /insufficient_funds/,
      ],
      [
        "a non-JSON body",
        "<html><body>502 Bad Gateway</body></html>",
        /502 Bad Gateway/,
      ],
      ["an empty body", "", /no error body returned by Skydropx/],
    ])("never describes %s as an empty string", async (_label, body, expected) => {
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        // statusText is blank, exactly as Node's fetch leaves it.
        "POST /shipments": () => ({
          ok: false,
          status: 422,
          statusText: "",
          json: async () => body,
          text: async () =>
            typeof body === "string" ? body : JSON.stringify(body),
        }) as unknown as Response,
      })
      const client = makeClient()

      const error = await client
        .createShipment({ shipment: { rate_id: "r1" } } as never)
        .then(
          () => {
            throw new Error("expected createShipment to reject")
          },
          (e) => e as SkydropxApiError
        )

      expect(error.description.trim()).not.toBe("")
      expect(error.description).toMatch(expected)
      // The failing endpoint and status are always present.
      expect(error.description).toContain("POST /shipments")
      expect(error.description).toContain("422")
    })

    it("truncates a huge error body instead of flooding the logs", async () => {
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /shipments": () => ({
          ok: false,
          status: 500,
          statusText: "",
          json: async () => undefined,
          text: async () => "x".repeat(200_000),
        }) as unknown as Response,
      })
      const client = makeClient()

      const error = await client
        .createShipment({ shipment: { rate_id: "r1" } } as never)
        .then(
          () => {
            throw new Error("expected createShipment to reject")
          },
          (e) => e as SkydropxApiError
        )

      expect(error.description.length).toBeLessThan(1_000)
    })

    /**
     * Pinned against the shape PRO documents for `POST /api/v1/shipments` (202),
     * copied from the API reference rather than from our own assumptions:
     * `{ data: { id, type, attributes }, included: [{ type, attributes }] }`.
     *
     * The previous model read `id` / `workflow_status` / `master_tracking_number`
     * from the ROOT while correctly reading `included` from the root — a
     * half-applied envelope that shipped `GET /shipments/undefined → HTTP 404`.
     */
    it("reads the shipment out of PRO's JSON:API envelope, not the root", async () => {
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /shipments": () =>
          jsonResponse({
            data: {
              id: "envio-def456",
              type: "shipment",
              attributes: {
                carrier_name: "interrapidisimo",
                workflow_status: "pending",
                payment_status: "paid",
                master_tracking_number: "IR123456789CO",
                total: "12500.0",
              },
            },
            included: [
              {
                type: "package",
                attributes: {
                  tracking_number: "IR123456789CO",
                  label_url: "https://labels.example/envio-def456.pdf",
                },
              },
            ],
          }),
      })
      const client = makeClient()

      const shipment = await client.createShipment({
        shipment: { rate_id: "rate-xyz789" },
      } as never)

      expect(shipment.id).toBe("envio-def456")
      expect(shipment.workflowStatus).toBe("pending")
      expect(shipment.masterTrackingNumber).toBe("IR123456789CO")
      expect(shipment.trackingNumber).toBe("IR123456789CO")
      expect(shipment.labelUrl).toBe("https://labels.example/envio-def456.pdf")
    })

    /**
     * Regression for the exact production failure: a shipment with no id was
     * carried forward as `undefined` and turned into `GET /shipments/undefined`.
     * The shipment is created and CHARGED by then, so this must fail loudly with
     * the raw payload attached — it is the only reconciliation trail there is.
     */
    it("fails loudly, with the raw payload, when the shipment has no id", async () => {
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /shipments": () =>
          jsonResponse({
            data: { type: "shipment", attributes: { workflow_status: "pending" } },
          }),
      })
      const client = makeClient()

      const error = await client
        .createShipment({ shipment: { rate_id: "r1" } } as never)
        .then(
          () => {
            throw new Error("expected createShipment to reject")
          },
          (e) => e as SkydropxApiError
        )

      expect(error.errorCode).toBe("invalid_response")
      expect(error.description).toMatch(/no id/)
      expect(error.description).toMatch(/MAY have been created and charged/)
      // The raw body is the reconciliation trail.
      expect(error.description).toContain("workflow_status")
      // Nothing may be polled with an undefined id.
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).includes("undefined"))
      ).toBe(false)
    })

    it("still reads a flat response, so a shape change cannot silently blank it", async () => {
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "POST /shipments": () =>
          jsonResponse({
            id: "flat_1",
            workflow_status: "success",
            master_tracking_number: "TRK_FLAT",
          }),
      })
      const client = makeClient()

      const shipment = await client.createShipment({
        shipment: { rate_id: "r1" },
      } as never)

      expect(shipment.id).toBe("flat_1")
      expect(shipment.workflowStatus).toBe("success")
      expect(shipment.masterTrackingNumber).toBe("TRK_FLAT")
    })

    it("surfaces error_detail from data.attributes as a typed failure", async () => {
      routeFetch(fetchMock, {
        "POST /oauth/token": () => tokenResponse(),
        "GET /shipments": () =>
          jsonResponse({
            data: {
              id: "shp_1",
              type: "shipment",
              attributes: {
                workflow_status: "pending",
                error_detail: {
                  error_code: "carrier_rejected",
                  error_message: "El carrier rechazó la guía.",
                },
              },
            },
          }),
      })
      const client = makeClient()

      await expect(client.getShipment("shp_1")).rejects.toMatchObject({
        constructor: SkydropxApiError,
        errorCode: "carrier_rejected",
        description: "El carrier rechazó la guía.",
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

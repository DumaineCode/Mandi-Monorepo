import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * `fulfillment.ts` is a `"use server"` module: it reaches for the SDK and for
 * cookies at call time, neither of which exists under the node test runner. The
 * mocks below replace exactly those two edges and nothing else, so what is under
 * test is the module's own control flow — which attempt is made, when, and with
 * what — rather than a stub of it.
 */
/**
 * `vi.hoisted` because `vi.mock` factories are lifted above every import, so a
 * plain `const` declared here would not exist yet when the factory runs.
 */
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

vi.mock("@lib/config", () => ({
  sdk: {
    client: { fetch: fetchMock },
  },
}))

vi.mock("./cookies", () => ({
  getAuthHeaders: vi.fn(async () => ({ authorization: "Bearer test" })),
  getCacheOptions: vi.fn(async () => ({})),
}))

import { listCartShippingMethods } from "./fulfillment"

const CART_ID = "cart_01JQZ8V3K7NB2XW9RTPY4C6HDM"

const SHIPPING_OPTIONS = [{ id: "so_01", name: "Estándar" }]

/** A `FetchError`-shaped rejection: an `Error` carrying an HTTP `status`. */
const httpError = (status: number, message = "backend said no") =>
  Object.assign(new Error(message), { status })

/**
 * What `AbortSignal.timeout` produces, and what a dropped connection produces:
 * an error with NO status, because no HTTP response was ever received.
 */
const transportError = (name: string) =>
  Object.assign(new Error(`${name}: the operation was aborted`), { name })

beforeEach(() => {
  fetchMock.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("listCartShippingMethods", () => {
  it("returns the options on a first-attempt success without retrying", async () => {
    fetchMock.mockResolvedValueOnce({ shipping_options: SHIPPING_OPTIONS })

    await expect(listCartShippingMethods(CART_ID)).resolves.toEqual(
      SHIPPING_OPTIONS
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  /**
   * The retry exists to absorb a TRANSIENT failure. Whether a failure is
   * transient is knowable from the status, and the previous version did not
   * look: it caught unconditionally, so a 400, a 404 or a 401 bought a second
   * identical request, a second log line and up to 2s of extra time-to-first-byte
   * for a guaranteed-identical answer. This call is awaited during the server
   * render of the checkout page, so that time is paid by the customer.
   */
  describe("what may be retried", () => {
    it.each([
      ["a 500", httpError(500)],
      ["a 502", httpError(502)],
      ["a 503", httpError(503)],
      ["a 504", httpError(504)],
    ])(
      "retries %s and returns the second attempt's options",
      async (_label, error) => {
        fetchMock
          .mockRejectedValueOnce(error)
          .mockResolvedValueOnce({ shipping_options: SHIPPING_OPTIONS })

        await expect(listCartShippingMethods(CART_ID)).resolves.toEqual(
          SHIPPING_OPTIONS
        )
        expect(fetchMock).toHaveBeenCalledTimes(2)
      }
    )

    it.each([
      ["a timeout", transportError("TimeoutError")],
      ["an abort", transportError("AbortError")],
      ["a bare transport failure", new Error("fetch failed")],
    ])("retries %s, which carries no status at all", async (_label, error) => {
      // No status means no HTTP response was received. That is the most
      // transient failure there is, and the case the retry was added for.
      fetchMock
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ shipping_options: SHIPPING_OPTIONS })

      await expect(listCartShippingMethods(CART_ID)).resolves.toEqual(
        SHIPPING_OPTIONS
      )
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe("what may NOT be retried", () => {
    it.each([
      ["a 400", httpError(400, "cart_id must be a string")],
      ["a 401", httpError(401, "Unauthorized")],
      ["a 403", httpError(403, "Forbidden")],
      ["a 404", httpError(404, "Cart id not found")],
      ["a 422", httpError(422, "Unprocessable")],
    ])("does not retry %s", async (_label, error) => {
      fetchMock.mockRejectedValue(error)

      await expect(listCartShippingMethods(CART_ID)).resolves.toBeNull()

      // The whole point: ONE request, not two. A 4xx is a statement about the
      // request, and the second request is byte-identical to the first.
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it("still logs a non-retryable failure", async () => {
      // Not retrying must not mean not reporting. This failure renders an error
      // state to the customer, so it has to be visible to the team.
      fetchMock.mockRejectedValue(httpError(404, "Cart id not found"))

      await listCartShippingMethods(CART_ID)

      expect(console.error).toHaveBeenCalledTimes(1)
    })
  })

  describe("when both attempts fail", () => {
    it("returns null so the caller can render its error state", async () => {
      fetchMock.mockRejectedValue(httpError(503))

      await expect(listCartShippingMethods(CART_ID)).resolves.toBeNull()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it("never writes the raw cart id into the log", async () => {
      // `lib/util/log-safe.ts` is only load-bearing if the call sites actually
      // route through it. This asserts the wiring, not the helper.
      fetchMock.mockRejectedValue(
        httpError(404, `Cart id not found: ${CART_ID}`)
      )

      await listCartShippingMethods(CART_ID)

      const logged = JSON.stringify(
        (console.error as unknown as { mock: { calls: unknown[][] } }).mock
          .calls
      )

      // Both channels: the explicit `cart:` field AND the backend's own message
      // text, which embeds the id verbatim on exactly this error.
      expect(logged).not.toContain(CART_ID)
    })
  })
})

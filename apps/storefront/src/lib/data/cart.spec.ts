import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The first tests `persistCheckoutDraft` has ever had.
 *
 * ## Why this file has to exist
 *
 * The externally visible contract of this change is one sentence: **a failed
 * read never produces an id-less write**. Until now that sentence was asserted
 * only against `resolveShippingAddressId`, a pure helper, in isolation — the
 * WIRING was unverified. A reviewer deleted the entire
 * `if (resolution.status === "unresolved") return` block from `cart.ts` and the
 * whole suite stayed green. A guarantee whose removal is invisible is not a
 * guarantee.
 *
 * ## Why mocks, and which ones
 *
 * `cart.ts` is `"use server"`: it reaches for cookies, `next/cache` and the SDK
 * at call time, none of which exist under the node runner. Every mock below
 * replaces an EDGE of the module — the transport and the request-scoped
 * globals — and nothing in between. What is under test is the module's own
 * decision-making.
 *
 * Assertions are made against the arguments `sdk.store.cart.update` was ACTUALLY
 * called with, never against a stub's return value. That is the difference
 * between testing the write and testing the test.
 */
const { fetchMock, updateMock, getCartIdMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  updateMock: vi.fn(),
  getCartIdMock: vi.fn(),
}))

vi.mock("@lib/config", () => ({
  sdk: {
    client: { fetch: fetchMock },
    store: { cart: { update: updateMock, create: vi.fn() } },
  },
}))

vi.mock("./cookies", () => ({
  getAuthHeaders: vi.fn(async () => ({ authorization: "Bearer test" })),
  getCacheOptions: vi.fn(async () => ({})),
  getCacheTag: vi.fn(async () => "cache-tag"),
  getCartId: getCartIdMock,
  removeCartId: vi.fn(),
  setCartId: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
vi.mock("./regions", () => ({ getRegion: vi.fn() }))
vi.mock("./locale-actions", () => ({ getLocale: vi.fn(async () => "es") }))
vi.mock("@lib/util/medusa-error", () => ({ default: vi.fn() }))
// `constants.tsx` pulls in React icon components that have no business being
// loaded by a node-environment data-layer test.
vi.mock("@lib/constants", () => ({ isOpenpay: () => false }))

import { persistCheckoutDraft } from "./cart"

const CART_ID = "cart_01JQZ8V3K7NB2XW9RTPY4C6HDM"
const ADDRESS_ID = "caaddr_01JQZ8V3K7NB2XW9RTPY4C6HDM"

const PATCH = {
  address_1: "Av. Insurgentes Sur 1602",
  postal_code: "03940",
  city: "Ciudad de México",
  province: "CDMX",
  country_code: "mx",
}

/** What `GET /store/carts/:id` returns for a cart that HAS an address row. */
const cartWithAddress = () => ({
  cart: {
    id: CART_ID,
    shipping_address_id: ADDRESS_ID,
    shipping_address: { id: ADDRESS_ID },
  },
})

/** What it returns for a cart that has never had one. */
const cartWithoutAddress = () => ({
  cart: { id: CART_ID, shipping_address_id: null, shipping_address: null },
})

/** The shipping_address object actually sent on the wire. */
const sentShippingAddress = () =>
  (updateMock.mock.calls[0][1] as { shipping_address: Record<string, unknown> })
    .shipping_address

beforeEach(() => {
  fetchMock.mockReset()
  updateMock.mockReset()
  getCartIdMock.mockReset()
  getCartIdMock.mockResolvedValue(CART_ID)
  updateMock.mockResolvedValue({
    cart: { id: CART_ID, shipping_address: { id: ADDRESS_ID } },
  })
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("persistCheckoutDraft", () => {
  /**
   * THE ABORT GUARANTEE. Each case below is a different way for the read to
   * fail to establish an answer, and every one of them must end with zero calls
   * to `sdk.store.cart.update`.
   *
   * The assertion is on the WRITE NOT HAPPENING, not on the returned value. A
   * returned `{ ok: false }` alongside a write that already went out would be
   * the worst of both worlds, and only this assertion can tell the difference.
   */
  describe("a read that did not establish an answer", () => {
    it("performs NO write when the read rejects", async () => {
      fetchMock.mockRejectedValue(
        Object.assign(new Error("connect ECONNREFUSED"), { status: undefined })
      )

      const result = await persistCheckoutDraft(PATCH, null)

      expect(updateMock).not.toHaveBeenCalled()
      expect(result.ok).toBe(false)
    })

    it("performs NO write when the read times out", async () => {
      fetchMock.mockRejectedValue(
        Object.assign(new Error("The operation was aborted"), {
          name: "TimeoutError",
        })
      )

      await persistCheckoutDraft(PATCH, null)

      expect(updateMock).not.toHaveBeenCalled()
    })

    it("performs NO write when the read 500s", async () => {
      fetchMock.mockRejectedValue(
        Object.assign(new Error("Internal Server Error"), { status: 500 })
      )

      await persistCheckoutDraft(PATCH, null)

      expect(updateMock).not.toHaveBeenCalled()
    })

    it("performs NO write when a 200 carried no cart", async () => {
      fetchMock.mockResolvedValue({ cart: null })

      await persistCheckoutDraft(PATCH, null)

      expect(updateMock).not.toHaveBeenCalled()
    })

    it("performs NO write when the projection delivered neither the FK nor the relation", async () => {
      // The G3 defect, asserted end to end: a clean 200 with a cart in it and
      // no shipping address information whatsoever. This used to look exactly
      // like "the cart has no address" and let the destructive write through,
      // with the step-6 tripwire disarmed because no id was sent.
      fetchMock.mockResolvedValue({ cart: { id: CART_ID } })

      await persistCheckoutDraft(PATCH, null)

      expect(updateMock).not.toHaveBeenCalled()
    })

    it("performs NO write when the FK says a row exists but no id arrived", async () => {
      fetchMock.mockResolvedValue({
        cart: { id: CART_ID, shipping_address_id: ADDRESS_ID },
      })

      await persistCheckoutDraft(PATCH, null)

      expect(updateMock).not.toHaveBeenCalled()
    })

    it("performs NO write and never reads when there is no cart at all", async () => {
      getCartIdMock.mockResolvedValue(null)

      const result = await persistCheckoutDraft(PATCH, null)

      expect(fetchMock).not.toHaveBeenCalled()
      expect(updateMock).not.toHaveBeenCalled()
      expect(result.ok).toBe(false)
    })
  })

  describe("a read that resolved an id", () => {
    it("sends that exact id on the wire", async () => {
      fetchMock.mockResolvedValue(cartWithAddress())

      await persistCheckoutDraft(PATCH, null)

      expect(updateMock).toHaveBeenCalledTimes(1)
      expect(sentShippingAddress().id).toBe(ADDRESS_ID)
    })

    it("sends the patched fields alongside the id and nothing else", async () => {
      fetchMock.mockResolvedValue(cartWithAddress())

      await persistCheckoutDraft({ postal_code: "06700" }, null)

      expect(Object.keys(sentShippingAddress()).sort()).toEqual([
        "id",
        "postal_code",
      ])
    })

    it("asks the backend for both id signals", async () => {
      // The projection is the single point of failure in this fix, so the field
      // string is pinned. A star projection or a dropped FK would silently
      // reintroduce the ambiguity `resolveShippingAddressId` exists to reject.
      fetchMock.mockResolvedValue(cartWithAddress())

      await persistCheckoutDraft(PATCH, null)

      expect(fetchMock.mock.calls[0][1].query.fields).toBe(
        "id,shipping_address_id,shipping_address.id"
      )
    })

    it("reads with no-store so it cannot observe a stale address", async () => {
      fetchMock.mockResolvedValue(cartWithAddress())

      await persistCheckoutDraft(PATCH, null)

      expect(fetchMock.mock.calls[0][1].cache).toBe("no-store")
    })
  })

  describe("a read that positively established absence", () => {
    it("writes WITHOUT an id key when the cart genuinely has no address row", async () => {
      // The one legitimate id-less write. `em.create` makes the row and there is
      // nothing to destroy. The assertion is on key ABSENCE — `id: null` would
      // still yield `pk === undefined` at `EntityAssigner.js:81` while looking
      // like an intent was expressed.
      fetchMock.mockResolvedValue(cartWithoutAddress())
      updateMock.mockResolvedValue({ cart: { id: CART_ID } })

      await persistCheckoutDraft(PATCH, null)

      expect(updateMock).toHaveBeenCalledTimes(1)
      expect("id" in sentShippingAddress()).toBe(false)
    })

    it("still writes when only the FK proves absence", async () => {
      // The false-positive guard. If the backend omits the relation key for an
      // empty to-one, the FK is the only thing standing between a new customer
      // and an autosave that never fires.
      fetchMock.mockResolvedValue({
        cart: { id: CART_ID, shipping_address_id: null },
      })
      updateMock.mockResolvedValue({ cart: { id: CART_ID } })

      await persistCheckoutDraft(PATCH, null)

      expect(updateMock).toHaveBeenCalledTimes(1)
    })
  })

  describe("the email field", () => {
    it("omits email entirely when the caller passed null", async () => {
      // An address-only autosave must never clear a previously persisted email.
      fetchMock.mockResolvedValue(cartWithAddress())

      await persistCheckoutDraft(PATCH, null)

      expect("email" in (updateMock.mock.calls[0][1] as object)).toBe(false)
    })

    it("sends email when the caller supplied one", async () => {
      fetchMock.mockResolvedValue(cartWithAddress())

      await persistCheckoutDraft(PATCH, "ana@example.com")

      expect((updateMock.mock.calls[0][1] as { email: string }).email).toBe(
        "ana@example.com"
      )
    })
  })

  /**
   * The step-6 tripwire. It is the only signal that exists for a `cart_address`
   * row being REPLACED rather than merged, and there is no automated safety net
   * for that invariant — it needs a live backend. So the tripwire's own wiring
   * is what gets asserted here.
   */
  describe("the replaced-row tripwire", () => {
    it("fires when the id that came back differs from the one sent", async () => {
      fetchMock.mockResolvedValue(cartWithAddress())
      updateMock.mockResolvedValue({
        cart: {
          id: CART_ID,
          shipping_address: { id: "caaddr_01JQZ8V3K7NB2XW9RTPY4C6ZZZ" },
        },
      })

      await persistCheckoutDraft(PATCH, null)

      expect(console.error).toHaveBeenCalledTimes(1)
      expect(
        (console.error as unknown as { mock: { calls: unknown[][] } }).mock
          .calls[0][0]
      ).toContain("REPLACED")
    })

    it("fires when no address came back at all", async () => {
      fetchMock.mockResolvedValue(cartWithAddress())
      updateMock.mockResolvedValue({ cart: { id: CART_ID } })

      await persistCheckoutDraft(PATCH, null)

      expect(console.error).toHaveBeenCalledTimes(1)
    })

    it("stays quiet when the same id came back", async () => {
      fetchMock.mockResolvedValue(cartWithAddress())

      await persistCheckoutDraft(PATCH, null)

      expect(console.error).not.toHaveBeenCalled()
    })

    it("stays quiet on a legitimate id-less write", async () => {
      // No id was sent, so there is nothing to compare and nothing was
      // replaced. A tripwire that cries on the safe path gets muted.
      fetchMock.mockResolvedValue(cartWithoutAddress())
      updateMock.mockResolvedValue({
        cart: { id: CART_ID, shipping_address: { id: ADDRESS_ID } },
      })

      await persistCheckoutDraft(PATCH, null)

      expect(console.error).not.toHaveBeenCalled()
    })

    it("never writes a raw id into the tripwire log line", async () => {
      fetchMock.mockResolvedValue(cartWithAddress())
      updateMock.mockResolvedValue({
        cart: {
          id: CART_ID,
          shipping_address: { id: "caaddr_01JQZ8V3K7NB2XW9RTPY4C6ZZZ" },
        },
      })

      await persistCheckoutDraft(PATCH, null)

      const logged = JSON.stringify(
        (console.error as unknown as { mock: { calls: unknown[][] } }).mock
          .calls
      )

      expect(logged).not.toContain(CART_ID)
      expect(logged).not.toContain(ADDRESS_ID)
    })
  })

  /**
   * `cart.ts` is `"use server"`, so everything this function returns crosses
   * into the browser. The same change argues at length that the backend's error
   * text can echo customer data and must be kept out of LOGS; shipping that
   * exact text to the client while withholding it from the log is not a coherent
   * threat model.
   */
  describe("what crosses back to the client", () => {
    it("does not return the backend's raw message when the read fails", async () => {
      fetchMock.mockRejectedValue(
        Object.assign(new Error(`Cart with id '${CART_ID}' not found`), {
          status: 404,
        })
      )

      const result = await persistCheckoutDraft(PATCH, null)

      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).not.toContain(CART_ID)
      expect(result.ok === false && result.error).not.toContain("not found")
    })

    it("does not return the backend's raw message when the write fails", async () => {
      fetchMock.mockResolvedValue(cartWithAddress())
      updateMock.mockRejectedValue(
        new Error(
          `Invalid value for shipping_address.address_1: Av. Insurgentes Sur 1602`
        )
      )

      const result = await persistCheckoutDraft(PATCH, null)

      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).not.toContain("Insurgentes")
    })

    it("still records the detail server-side when the write fails", async () => {
      // Generic to the client, specific to the log. Withholding it from both
      // would trade one incoherence for a blind spot.
      fetchMock.mockResolvedValue(cartWithAddress())
      updateMock.mockRejectedValue(
        Object.assign(new Error("Unprocessable"), { status: 422 })
      )

      await persistCheckoutDraft(PATCH, null)

      expect(console.error).toHaveBeenCalled()
    })
  })
})

import { describe, expect, it } from "vitest"

import { describeError, toLogReference } from "./log-safe"

/**
 * A realistic Medusa cart id: a `cart_` prefix plus a 26-character ULID.
 * The exact value matters — several assertions below are about what is NOT in
 * the output, and a toy id would make them pass for the wrong reason.
 */
const CART_ID = "cart_01JQZ8V3K7NB2XW9RTPY4C6HDM"

/**
 * The disclosure BUDGET, stated here as policy rather than imported from the
 * module.
 *
 * Importing `REFERENCE_TAIL_LENGTH` would make every assertion below a tautology
 * that moves whenever the implementation moves — which is precisely how the
 * original version of this suite stayed green while a reviewer raised the tail
 * to 29 and emitted 29 of this id's 30 characters. The number lives here because
 * it is a decision about what may leave the process, not an implementation
 * detail.
 */
const MAX_DISCLOSED_CHARACTERS = 6

/**
 * Length of the longest run of characters that `emitted` and `source` share.
 *
 * This is the assertion the suite was missing. `not.toContain(id)` only rejects
 * the WHOLE id, and `not.toContain(id.slice(0, -6))` only rejects the prefix —
 * both are satisfied by an output that leaks everything except the first six
 * characters. Measuring the longest shared run bounds the leak from ABOVE
 * regardless of which part of the id an implementation chooses to keep, so it
 * holds for a tail, a head, a middle slice or an interleave.
 */
const longestSharedRun = (emitted: string, source: string): number => {
  let best = 0

  for (let start = 0; start < emitted.length; start++) {
    for (let length = best + 1; start + length <= emitted.length; length++) {
      if (!source.includes(emitted.slice(start, start + length))) {
        break
      }
      best = length
    }
  }

  return best
}

describe("toLogReference", () => {
  describe("what it must never emit", () => {
    it("never emits the full id", () => {
      // A cart id is a credential. `GET /store/carts/:id` and
      // `POST /store/carts/:id` carry NO `authenticate("customer", ...)`
      // middleware (`@medusajs/medusa/dist/api/store/carts/middlewares.js:44-51`,
      // `:63-70`); the only gate is the publishable key, which ships to every
      // browser. Anyone holding a cart id can read and modify
      // `shipping_address.*`, `email` and `customer.email` for the whole 7-day
      // cookie lifetime. A log stream is not an authorised audience.
      expect(toLogReference(CART_ID)).not.toContain(CART_ID)
    })

    it("emits no more than the last 6 characters of the id", () => {
      const reference = toLogReference(CART_ID)

      // 20+ unknown characters cannot be reconstructed from the tail, so the
      // reference is correlation-grade, not credential-grade.
      expect(reference).not.toContain(CART_ID.slice(0, -6))
      expect(reference).toContain(CART_ID.slice(-6))
    })

    it.each([
      ["a cart id", CART_ID],
      ["a cart address id", "caaddr_01JQZ8V3K7NB2XW9RTPY4C6HDM"],
      ["a long opaque token", "tok_opaque_9f2b7c1d4e6a8b0c3d5f7e9a1b3c5d7e"],
    ])("discloses at most 6 consecutive characters of %s", (_label, id) => {
      // THE UPPER BOUND. The two assertions above pin a LOWER bound ("the tail
      // must be there") and reject two specific shapes; neither rejects an
      // implementation that emits more. Raising the tail length to 29 kept the
      // whole suite green while this function emitted 29 of the id's 30
      // characters — the exact failure this module exists to prevent, passing
      // its own tests.
      expect(longestSharedRun(toLogReference(id), id)).toBeLessThanOrEqual(
        MAX_DISCLOSED_CHARACTERS
      )
    })

    it("emits a reference no longer than the budget plus its marker", () => {
      // A second, cruder bound on the same property, from a different angle: a
      // reference cannot leak six characters at a time if it is only seven
      // characters long. The `+ 1` is the `…` marker, and nothing else may ride
      // along.
      expect(toLogReference(CART_ID).length).toBeLessThanOrEqual(
        MAX_DISCLOSED_CHARACTERS + 1
      )
    })

    it("withholds the overwhelming majority of the id", () => {
      const reference = toLogReference(CART_ID)

      // Stated as a count rather than a shape so it survives a change of
      // masking strategy. 30 - 6 = 24 characters must not leave the process;
      // that is what makes the tail unwalkable back to the credential.
      const disclosed = longestSharedRun(reference, CART_ID)

      expect(CART_ID.length - disclosed).toBeGreaterThanOrEqual(24)
    })
  })

  describe("what it must still be good for", () => {
    it("is deterministic, so two log lines about one cart can be joined", () => {
      // The whole point of keeping a reference at all is correlation. A random
      // or time-seeded token would be safe AND useless.
      expect(toLogReference(CART_ID)).toBe(toLogReference(CART_ID))
    })

    it("distinguishes two different carts", () => {
      const other = "cart_01JQZ8V3K7NB2XW9RTPY4C6ZZZ"

      expect(toLogReference(CART_ID)).not.toBe(toLogReference(other))
    })
  })

  describe("absent and unsafe inputs", () => {
    it.each([null, undefined, ""])(
      "reports %j as unknown rather than throwing",
      (id) => {
        expect(toLogReference(id)).toBe("unknown")
      }
    )

    it("fully masks an id too short to truncate safely", () => {
      // Showing the last 6 of a 6-character id is showing the id.
      expect(toLogReference("abc123")).toBe("***")
    })
  })
})

describe("describeError", () => {
  it("extracts message and status from a Medusa FetchError-shaped error", () => {
    const error = Object.assign(new Error("Cart not found"), {
      status: 404,
    })

    expect(describeError(error)).toEqual({
      message: "Cart not found",
      status: 404,
    })
  })

  it("reports an undefined status when the error carries none", () => {
    expect(describeError(new Error("boom"))).toEqual({
      message: "boom",
      status: undefined,
    })
  })

  it("does not carry the original error object through", () => {
    // Logging the whole error object drags along `cause`, `request`, headers and
    // any response body the transport attached — which on this API can echo
    // address content straight back into the log stream.
    const error = Object.assign(new Error("boom"), {
      status: 500,
      cause: { shipping_address: { address_1: "Av. Insurgentes Sur 1602" } },
    })

    expect(Object.keys(describeError(error)).sort()).toEqual([
      "message",
      "status",
    ])
    expect(JSON.stringify(describeError(error))).not.toContain("Insurgentes")
  })

  /**
   * The messages below are NOT invented. `FetchError` is constructed with the
   * backend's response body verbatim — `new FetchError(jsonError.message ??
   * resp.statusText, ...)` at
   * `@medusajs/js-sdk/dist/esm/client.js:90` — and Medusa embeds the raw cart id
   * in exactly the not-found errors these log lines exist to capture:
   *
   * - `@medusajs/orchestration/dist/joiner/remote-joiner.js:475` —
   *   `` `${entityName} ${pkField} not found: ` + ids.join(", ") ``, reached from
   *   `GET /store/shipping-options` through
   *   `useRemoteQueryStep({ throwIfKeyNotFound: true })`
   *   (`list-shipping-options-for-cart.js:128`);
   * - `@medusajs/medusa/dist/api/store/carts/helpers.js:14` —
   *   `` `Cart with id '${id}' not found` ``.
   *
   * A completed, expired or deleted cart is the MOST likely reason these calls
   * fail, so this is the common path, not an exotic one. Masking the id in the
   * `cart:` field while the `message:` field next to it prints the same id in
   * full is not redaction, it is theatre. The earlier version of this suite used
   * `"Cart not found"` as its sample — a sanitised fiction that no backend ever
   * emits, and which hid this completely.
   */
  describe("ids embedded in the backend's own message text", () => {
    it("redacts the id in a remote-joiner not-found message", () => {
      const error = Object.assign(new Error(`Cart id not found: ${CART_ID}`), {
        status: 404,
      })

      const { message } = describeError(error)

      expect(message).not.toContain(CART_ID)
      expect(longestSharedRun(message, CART_ID)).toBeLessThanOrEqual(
        MAX_DISCLOSED_CHARACTERS
      )
    })

    it("redacts the id in a refetchCart not-found message", () => {
      const error = Object.assign(
        new Error(`Cart with id '${CART_ID}' not found`),
        { status: 404 }
      )

      expect(describeError(error).message).not.toContain(CART_ID)
    })

    it("keeps the diagnostic text around the redacted id", () => {
      // Redaction must not cost the reason. "not found" is the whole diagnostic
      // value of this line; blanking the message would trade one blind spot for
      // another.
      const { message } = describeError(
        new Error(`Cart with id '${CART_ID}' not found`)
      )

      expect(message).toContain("not found")
      expect(message).toContain("Cart with id")
    })

    it("leaves a correlatable reference in place of the id", () => {
      // The redacted message must still join to the `cart:` field logged beside
      // it, otherwise the log line cannot be tied to the cart it is about.
      const { message } = describeError(
        new Error(`Cart id not found: ${CART_ID}`)
      )

      expect(message).toContain(toLogReference(CART_ID))
    })

    it("redacts every id when the message carries several", () => {
      // `remote-joiner.js:475` joins the whole not-found set with ", ". A
      // single-match redaction would leak all but the first.
      const other = "cart_01JQZ8V3K7NB2XW9RTPY4C6ZZZ"
      const { message } = describeError(
        new Error(`Cart id not found: ${CART_ID}, ${other}`)
      )

      expect(message).not.toContain(CART_ID)
      expect(message).not.toContain(other)
    })

    it("redacts a cart_address id, not only a cart id", () => {
      const addressId = "caaddr_01JQZ8V3K7NB2XW9RTPY4C6HDM"
      const { message } = describeError(
        new Error(`Cart address id not found: ${addressId}`)
      )

      expect(message).not.toContain(addressId)
    })

    it("redacts an id shape it has never been told about", () => {
      // The point is the ULID SHAPE, not an allow-list of prefixes. A new
      // entity type must not need a code change here to stop leaking.
      const unknownId = "whatever_01JQZ8V3K7NB2XW9RTPY4C6HDM"

      expect(describeError(new Error(unknownId)).message).not.toContain(
        unknownId
      )
    })

    it("preserves the status while redacting the message", () => {
      const error = Object.assign(
        new Error(`Cart with id '${CART_ID}' not found`),
        { status: 404 }
      )

      expect(describeError(error).status).toBe(404)
    })

    it("leaves a message with no id in it untouched", () => {
      // Redaction that rewrites innocent text is a different kind of damage:
      // the next reader stops trusting the log.
      expect(describeError(new Error("Network request failed")).message).toBe(
        "Network request failed"
      )
    })
  })

  it("handles a non-Error throw without inventing a message", () => {
    expect(describeError("just a string")).toEqual({
      message: "Unknown error",
      status: undefined,
    })
  })

  it("ignores a non-numeric status", () => {
    const error = Object.assign(new Error("boom"), { status: "500" })

    expect(describeError(error)).toEqual({ message: "boom", status: undefined })
  })
})

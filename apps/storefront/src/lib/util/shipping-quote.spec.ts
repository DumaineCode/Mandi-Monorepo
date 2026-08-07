import { describe, expect, it } from "vitest"

import {
  AUTOSAVE_DEBOUNCE_MS,
  buildQuoteSignature,
  classifyQuoteResult,
  evaluateQuoteReadiness,
  isQuotable,
  isShippingSelectionStale,
  MX_POSTAL_CODE_PATTERN,
  QUOTE_DEBOUNCE_MS,
  type QuoteRelevantAddress,
} from "./shipping-quote"

/**
 * A destination that satisfies every branch, so each test states only its own
 * deviation. Spread, never destructuring defaults: `{ city: undefined }` has to
 * mean "this address has no city", and a destructuring default would silently
 * hand the happy value back — the "missing city" tests would then assert nothing.
 */
const COMPLETE: QuoteRelevantAddress = {
  country_code: "mx",
  postal_code: "06700",
  province: "CDMX",
  city: "Cuauhtémoc",
}

const address = (
  overrides: Partial<QuoteRelevantAddress> = {}
): QuoteRelevantAddress => ({ ...COMPLETE, ...overrides })

describe("MX_POSTAL_CODE_PATTERN", () => {
  it("accepts exactly five digits", () => {
    expect(MX_POSTAL_CODE_PATTERN.test("06700")).toBe(true)
  })

  it.each(["067", "0670", "067000", "0670a", "", " 06700"])(
    "rejects %j",
    (candidate) => {
      expect(MX_POSTAL_CODE_PATTERN.test(candidate)).toBe(false)
    }
  )

  /**
   * Both bounds pinned by construction, not by example.
   *
   * The example list above was chosen to cover *shapes* of malformation — too
   * short, too long, non-digit, empty, padded — and none of its entries had
   * four digits. `/^\d{4,5}$/` therefore passed the whole suite. That is not a
   * cosmetic loosening: `isQuotable` gates the outbound carrier request, so a
   * four-digit code that cannot name any Mexican locality would be accepted by
   * the form, persisted to the cart, and spend a live Skydropx quote on a
   * destination that does not exist — and the customer's reward for the round
   * trip is a "no serviceable options" state that blames the carrier for a
   * validation the form should have done.
   *
   * Sweeping the lengths makes the exactly-five rule true of every arity rather
   * than of the five arities somebody happened to think of.
   */
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "accepts a %i-digit code only when it is exactly five digits",
    (length) => {
      expect(MX_POSTAL_CODE_PATTERN.test("1".repeat(length))).toBe(length === 5)
    }
  )

  /**
   * A `g`-flagged regex carries `lastIndex` across calls, so the SECOND
   * `.test()` on the same input can return false. The module exports this
   * pattern for reuse by form validation, so a stateful regex would produce a
   * field that rejects its own value every other keystroke.
   */
  it("is stateless across repeated tests", () => {
    expect(MX_POSTAL_CODE_PATTERN.test("06700")).toBe(true)
    expect(MX_POSTAL_CODE_PATTERN.test("06700")).toBe(true)
  })
})

describe("buildQuoteSignature", () => {
  it("returns the same non-null signature for the same destination", () => {
    const first = buildQuoteSignature(address())
    const second = buildQuoteSignature(address())

    expect(first).not.toBeNull()
    expect(first).toBe(second)
  })

  /**
   * The whole point of the change (R4). `buildCartShippingSignature`
   * (`shipping-address/index.tsx:33-45`) includes `address_1`/`address_2`,
   * which is why a postal code alone can never trigger a quote today.
   */
  it("ignores street fields entirely", () => {
    const withStreet = {
      ...address(),
      address_1: "Av. Insurgentes Sur 1602",
      address_2: "Piso 4",
    } as QuoteRelevantAddress

    const withOtherStreet = {
      ...address(),
      address_1: "Calle Durango 12",
      address_2: null,
    } as QuoteRelevantAddress

    expect(buildQuoteSignature(withStreet)).toBe(
      buildQuoteSignature(withOtherStreet)
    )
  })

  it("normalizes case, padding and internal whitespace runs", () => {
    const noisy = address({
      country_code: "MX",
      postal_code: " 06700 ",
      province: "CDMX",
      city: "Ciudad  de  México",
    })
    const clean = address({
      country_code: "mx",
      postal_code: "06700",
      province: "cdmx",
      city: "ciudad de méxico",
    })

    expect(buildQuoteSignature(noisy)).toBe(buildQuoteSignature(clean))
  })

  it.each([
    ["a malformed postal code", { postal_code: "067" }],
    ["a postal code with letters", { postal_code: "0670a" }],
    ["a missing city", { city: null }],
    ["a blank city", { city: "   " }],
    ["a missing province", { province: undefined }],
    ["a missing country code", { country_code: "" }],
  ])("returns null for %s", (_label, overrides) => {
    expect(buildQuoteSignature(address(overrides))).toBeNull()
  })

  it.each([null, undefined])("returns null for a %j address", (input) => {
    expect(buildQuoteSignature(input)).toBeNull()
  })

  /**
   * Field-boundary integrity, stated as a PROPERTY rather than against one
   * character.
   *
   * If any character a customer can type also separates fields, then
   * `{province:"x‹c›y", city:"z"}` and `{province:"x", city:"y‹c›z"}` join to the
   * same string: two different destinations dedupe against each other and the
   * customer is shown a price quoted for somewhere else.
   *
   * An earlier version of this test hardcoded `\u001f`, the delimiter the
   * implementation happens to use. That is a tautology — it passes for ANY
   * delimiter, including a printable `|` with no control-character stripping,
   * which is precisely the unsafe implementation. Mutation testing caught it.
   * The candidate set below is deliberately adversarial and deliberately
   * ignorant of the chosen delimiter.
   */
  const BOUNDARY_CANDIDATES = [
    "|",
    "-",
    "_",
    ":",
    ";",
    ",",
    ".",
    "/",
    "\\",
    "#",
    "~",
    "^",
    "@",
    "$",
    "&",
    "*",
    "+",
    "=",
    "!",
    "?",
    " ",
    "\t",
    "\n",
    "\u00a0",
    "\u0000",
    "\u001e",
    "\u001f",
    "\u007f",
    "\u2028",
    "\u3000",
  ]

  it.each(BOUNDARY_CANDIDATES)(
    "cannot have its field boundaries shifted by %j",
    (candidate) => {
      const shiftedLeft = buildQuoteSignature(
        address({ province: `x${candidate}y`, city: "z" })
      )
      const shiftedRight = buildQuoteSignature(
        address({ province: "x", city: `y${candidate}z` })
      )

      expect(shiftedLeft).not.toBeNull()
      expect(shiftedRight).not.toBeNull()
      expect(shiftedLeft).not.toBe(shiftedRight)
    }
  )

  /**
   * The spec's own collision example, kept for traceability. It bottoms out on
   * `province: ""` returning null, so on its own it proves far less than the
   * property above — which is why the property above exists.
   */
  it("does not collide with the spec's stated example", () => {
    expect(buildQuoteSignature(address({ city: "a", province: "b" }))).not.toBe(
      buildQuoteSignature(address({ city: "a|b", province: "" }))
    )
  })

  /**
   * The two Unicode spellings of "México": precomposed é (U+00E9) and
   * `e` + combining acute (U+0065 U+0301). macOS/iOS text input and a pasted
   * value from SEPOMEX do not agree on which they emit, so without an explicit
   * NFC pass a customer switching devices re-quotes — and, worse, a selection
   * made on one device reads as stale on the other.
   */
  it("treats decomposed and precomposed accents as the same destination", () => {
    const precomposed = "Ciudad de M\u00e9xico"
    const decomposed = "Ciudad de Me\u0301xico"

    expect(precomposed).not.toBe(decomposed)
    expect(buildQuoteSignature(address({ city: precomposed }))).toBe(
      buildQuoteSignature(address({ city: decomposed }))
    )
  })

  it("ignores a province that differs only by trailing whitespace", () => {
    expect(buildQuoteSignature(address({ province: "Jalisco  " }))).toBe(
      buildQuoteSignature(address({ province: "Jalisco" }))
    )
  })

  it("ignores a province that differs only by a non-breaking space", () => {
    expect(buildQuoteSignature(address({ province: "Nuevo\u00a0León" }))).toBe(
      buildQuoteSignature(address({ province: "Nuevo León" }))
    )
  })

  /**
   * Normalization must not RESCUE a malformed postal code. "067 00" collapses
   * to a five-character string only if the collapse is allowed to delete rather
   * than fold whitespace; the pattern must still see the space and reject.
   */
  it("does not let whitespace collapsing rescue a malformed postal code", () => {
    expect(buildQuoteSignature(address({ postal_code: "067 00" }))).toBeNull()
  })

  it("rejects full-width digits rather than folding them", () => {
    expect(
      buildQuoteSignature(address({ postal_code: "０６７００" }))
    ).toBeNull()
  })

  /**
   * Key order in the source object must not reach the signature. A naive
   * `JSON.stringify(address)` or `Object.values(address).join()` passes every
   * other case in this file and fails here — two identical destinations built by
   * two different call sites would dedupe against nothing and re-quote forever.
   */
  it("is independent of the key order of the source object", () => {
    const declared: QuoteRelevantAddress = {
      country_code: "mx",
      postal_code: "06700",
      province: "CDMX",
      city: "Cuauhtémoc",
    }
    const reversed: QuoteRelevantAddress = {
      city: "Cuauhtémoc",
      province: "CDMX",
      postal_code: "06700",
      country_code: "mx",
    }

    expect(buildQuoteSignature(declared)).toBe(buildQuoteSignature(reversed))
  })

  /**
   * ...but the FIELDS must stay distinguishable from each other. An
   * implementation that sorted the components before joining would satisfy the
   * case above and collide here, quoting Jalisco/Guadalajara against
   * Guadalajara/Jalisco.
   */
  it("does not collide when province and city values are swapped", () => {
    expect(
      buildQuoteSignature(address({ province: "jalisco", city: "guadalajara" }))
    ).not.toBe(
      buildQuoteSignature(address({ province: "guadalajara", city: "jalisco" }))
    )
  })

  it("keeps distinct destinations distinct", () => {
    const signatures = new Set(
      [
        address(),
        address({ postal_code: "44160" }),
        address({ city: "Benito Juárez" }),
        address({ province: "Jalisco" }),
        address({ country_code: "us" }),
      ].map(buildQuoteSignature)
    )

    expect(signatures.size).toBe(5)
  })
})

describe("isQuotable", () => {
  it("is true exactly when a signature can be built", () => {
    expect(isQuotable(address())).toBe(true)
    expect(isQuotable(address({ postal_code: "067" }))).toBe(false)
    expect(isQuotable(null)).toBe(false)
  })

  /**
   * The postal-code bound asserted where it actually costs money.
   *
   * `MX_POSTAL_CODE_PATTERN` having the right shape is necessary but not
   * sufficient — this is the predicate the caller consults before spending a
   * carrier request, so the four-digit case is pinned on the gate itself and
   * not only on the regex it happens to delegate to today.
   */
  it("refuses to quote a four-digit postal code", () => {
    expect(isQuotable(address({ postal_code: "0670" }))).toBe(false)
  })
})

describe("debounce constants", () => {
  /**
   * Pinned to the values they replace, not to a preference. 600 ms is today's
   * `PREFETCH_DEBOUNCE_MS` (`shipping-address/index.tsx:20`); changing it here
   * changes how many live Skydropx quotes a customer's typing produces (F2).
   * They live in this module so no component repeats a literal.
   */
  it("preserves the existing quote debounce", () => {
    expect(QUOTE_DEBOUNCE_MS).toBe(600)
  })

  it("autosaves faster than it quotes", () => {
    expect(AUTOSAVE_DEBOUNCE_MS).toBe(400)
    expect(AUTOSAVE_DEBOUNCE_MS).toBeLessThan(QUOTE_DEBOUNCE_MS)
  })
})

const SIG_A = buildQuoteSignature(COMPLETE)
const SIG_B = buildQuoteSignature({ ...COMPLETE, postal_code: "44160" })

describe("evaluateQuoteReadiness", () => {
  const input = (
    overrides: Partial<Parameters<typeof evaluateQuoteReadiness>[0]> = {}
  ) => ({
    draftAddress: address(),
    lastRequestedSignature: null,
    inFlightSignature: null,
    cartId: "cart_01",
    ...overrides,
  })

  it("quotes a complete address that has never been quoted", () => {
    expect(evaluateQuoteReadiness(input())).toEqual({
      action: "quote",
      signature: SIG_A,
      supersedes: null,
    })
  })

  it("skips an address whose signature was already quoted", () => {
    expect(
      evaluateQuoteReadiness(input({ lastRequestedSignature: SIG_A }))
    ).toEqual({ action: "skip", reason: "already_quoted" })
  })

  it("skips an address whose signature is already in flight", () => {
    expect(evaluateQuoteReadiness(input({ inFlightSignature: SIG_A }))).toEqual(
      { action: "skip", reason: "already_in_flight" }
    )
  })

  it("supersedes a different in-flight request", () => {
    expect(evaluateQuoteReadiness(input({ inFlightSignature: SIG_B }))).toEqual(
      { action: "quote", signature: SIG_A, supersedes: SIG_B }
    )
  })

  it("idles without a cart, even with a complete address", () => {
    expect(evaluateQuoteReadiness(input({ cartId: null }))).toEqual({
      action: "idle",
      reason: "no_cart",
    })
  })

  it("idles on an incomplete address", () => {
    expect(
      evaluateQuoteReadiness(input({ draftAddress: address({ city: null }) }))
    ).toEqual({ action: "idle", reason: "incomplete_address" })
  })

  it("idles on a null draft address", () => {
    expect(evaluateQuoteReadiness(input({ draftAddress: null }))).toEqual({
      action: "idle",
      reason: "incomplete_address",
    })
  })

  /**
   * Rule ORDER, not just the individual answers. `no_cart` outranks
   * `incomplete_address`, and both outrank the dedupe rules — an implementation
   * that reshuffled the branches would still satisfy every case above one at a
   * time.
   */
  it("reports no_cart ahead of incomplete_address", () => {
    expect(
      evaluateQuoteReadiness(
        input({ cartId: undefined, draftAddress: address({ city: null }) })
      )
    ).toEqual({ action: "idle", reason: "no_cart" })
  })

  it("reports already_in_flight ahead of already_quoted", () => {
    expect(
      evaluateQuoteReadiness(
        input({ inFlightSignature: SIG_A, lastRequestedSignature: SIG_A })
      )
    ).toEqual({ action: "skip", reason: "already_in_flight" })
  })

  /**
   * The retryability guarantee. `lastRequestedSignature` is advanced only on
   * SUCCESS, so after a failed quote the same address must produce `quote`
   * again. If this ever returns `skip`, the `failed` state becomes unrecoverable
   * without a page reload — the customer retypes the same postal code and
   * nothing happens.
   */
  it("re-quotes the same address after a failure left the last signature behind", () => {
    expect(
      evaluateQuoteReadiness(input({ lastRequestedSignature: SIG_B }))
    ).toEqual({ action: "quote", signature: SIG_A, supersedes: null })
  })

  it("is free of side effects on its input", () => {
    const frozen = Object.freeze(input())
    expect(() => evaluateQuoteReadiness(frozen)).not.toThrow()
  })
})

describe("isShippingSelectionStale", () => {
  it("is false when the selection was made under the current signature", () => {
    expect(isShippingSelectionStale(SIG_A, SIG_A)).toBe(false)
  })

  it("is true when the signature moved under the selection", () => {
    expect(isShippingSelectionStale(SIG_A, SIG_B)).toBe(true)
  })

  /**
   * A method selected before any signature existed is NOT stale. Returning true
   * here would block the CTA on a returning cart that has a shipping method but
   * whose client signature has not been derived yet — an order the customer can
   * never place, reported as "you changed your postal code" when they did not.
   */
  it("is false when there is no selection signature", () => {
    expect(isShippingSelectionStale(null, SIG_A)).toBe(false)
    expect(isShippingSelectionStale(null, null)).toBe(false)
  })

  /**
   * The mirror image, and the dangerous direction: a selection exists, the
   * address is no longer quotable, so the price on screen belongs to a
   * destination that is no longer being shipped to. Stale.
   */
  it("is true when the address stopped being quotable under a live selection", () => {
    expect(isShippingSelectionStale(SIG_A, null)).toBe(true)
  })
})

/**
 * `failed` vs `not_serviceable` — the distinction that decides whether the
 * storefront tells a customer their address is wrong or tells them the store
 * could not price the order.
 *
 * Getting it backwards is not a cosmetic bug: the `MissingDimensionsError`
 * signature is a CATALOGUE data problem (a variant with no weight or no L/W/H,
 * `parcel.ts:49-79`), so the copy the customer reads must not send them off to
 * re-check a postal code that was correct all along, and re-typing it will never
 * help.
 *
 * The expected values below are written out literally rather than imported from
 * the module. Asserting `X === X` passes for every value of `X`.
 */
describe("classifyQuoteResult", () => {
  const calculated = (id: string) => ({ id, price_type: "calculated" })
  const flat = (id: string) => ({ id, price_type: "flat" })

  it("is priced when every calculated option resolved an amount", () => {
    expect(
      classifyQuoteResult({
        options: [calculated("so_a"), calculated("so_b")],
        prices: { so_a: 15000, so_b: 21000 },
      })
    ).toBe("priced")
  })

  it("is priced when at least ONE calculated option resolved an amount", () => {
    // A partial result is a real answer: the customer can pick the carrier that
    // did quote. Only a TOTAL absence of prices is the dimensions signature.
    expect(
      classifyQuoteResult({
        options: [calculated("so_a"), calculated("so_b")],
        prices: { so_b: 21000 },
      })
    ).toBe("priced")
  })

  /**
   * The `MissingDimensionsError` signature: the backend returned options — so the
   * address IS serviceable — and every single one came back priceless because
   * `buildParcel` threw before any carrier call.
   */
  it("is unpriceable when a non-empty calculated list resolved no amount at all", () => {
    expect(
      classifyQuoteResult({
        options: [calculated("so_a"), calculated("so_b")],
        prices: {},
      })
    ).toBe("unpriceable")
  })

  /**
   * An EMPTY list is a different answer and must not be reported as a failure.
   * It is `not_serviceable` — derived downstream from the option count — and
   * telling that customer "we could not calculate shipping, try again" would
   * invite them to retry an address the carrier will never serve, at the cost of
   * a live carrier quote per press.
   */
  it("is priced when the option list is empty, because that is not a failure", () => {
    expect(classifyQuoteResult({ options: [], prices: {} })).toBe("priced")
  })

  /**
   * Flat-rate options carry their amount on the option itself and are never
   * routed through `calculatePriceForShippingOption`, so an empty price map says
   * nothing about them. Reporting a failure here would break a store that sells
   * flat-rate shipping only.
   */
  it("is priced when the list is entirely flat-rate and the price map is empty", () => {
    expect(
      classifyQuoteResult({
        options: [flat("so_a"), flat("so_b")],
        prices: {},
      })
    ).toBe("priced")
  })

  it("ignores flat-rate options when deciding, so one priceless carrier still fails", () => {
    expect(
      classifyQuoteResult({
        options: [flat("so_pickup"), calculated("so_a")],
        prices: {},
      })
    ).toBe("unpriceable")
  })

  /**
   * Free shipping is a price. `0` is falsy, and the component this rule was
   * extracted from used a truthiness check — so a carrier quoting zero read as
   * "no price returned".
   */
  it("counts a zero amount as a real price", () => {
    expect(
      classifyQuoteResult({
        options: [calculated("so_a")],
        prices: { so_a: 0 },
      })
    ).toBe("priced")
  })

  /**
   * A price recorded against an option that is not in the list cannot rescue the
   * options that are. Counting the map's size instead of matching per option is
   * the mutation this kills.
   */
  it("ignores prices belonging to options that are not on the list", () => {
    expect(
      classifyQuoteResult({
        options: [calculated("so_a")],
        prices: { so_from_a_previous_quote: 19900 },
      })
    ).toBe("unpriceable")
  })

  it("treats a non-finite amount as no price", () => {
    expect(
      classifyQuoteResult({
        options: [calculated("so_a")],
        prices: { so_a: Number.NaN },
      })
    ).toBe("unpriceable")
  })

  it("is free of side effects on its input", () => {
    const options = Object.freeze([Object.freeze(calculated("so_a"))])
    const prices = Object.freeze({ so_a: 100 })

    expect(() => classifyQuoteResult({ options, prices })).not.toThrow()
  })
})

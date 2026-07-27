import { describe, expect, it } from "vitest"

import { MX_PHONE_PATTERN, MX_PHONE_TITLE, isValidMxPhone } from "./phone"

/**
 * A `pattern` attribute is not evaluated the way `new RegExp(MX_PHONE_PATTERN)`
 * evaluates it. The browser:
 *
 *   1. anchors the value implicitly, as `^(?:…)$`, and
 *   2. compiles it with the `v` flag, falling back to `u`.
 *
 * Asserting against the bare, unanchored source string would happily pass on
 * inputs the real `<input>` rejects — an unanchored regex matches any substring,
 * so `55 1234 567a` would "pass" a test while failing a customer. Every
 * assertion below therefore goes through this helper, under both flags.
 */
const anchored = (flags: "u" | "v") =>
  new RegExp(`^(?:${MX_PHONE_PATTERN})$`, flags)

/** The flags a browser may use for `pattern`, in preference order. */
const PATTERN_FLAGS = ["u", "v"] as const

/**
 * The formats Mexican customers actually type, plus the ones OS/browser `tel`
 * autofill produces. Every entry here was rejected by the original
 * `(?:[\s()-]*\d){10}[\s()-]*` pattern, which is what made checkout
 * uncompletable — these are regression cases, not hypotheticals.
 */
const ACCEPTED = [
  // 10 national digits, with the separators people actually use.
  "5512345678",
  "55 1234 5678",
  "(55) 1234-5678",
  "55-1234-5678",
  // Country prefix. `+52…` is what MX tel autofill stores (E.164).
  "+52 55 1234 5678",
  "+525512345678",
  "52 55 1234 5678",
  // `521…` mobile form — the one Skydropx's own docs use in examples.
  "5215555555555",
  "+521 55 1234 5678",
  // Legacy national trunk prefixes, still muscle memory for many customers.
  "01 55 1234 5678",
  "045 55 1234 5678",
]

/**
 * Genuinely malformed input. The point of the phone field is that it is
 * required and usable, so the pattern must stay strict about digit count and
 * non-digits while staying permissive about prefixes and separators.
 */
const REJECTED = [
  "551234567", // 9 digits — one short of a national number
  "55123456789012", // 14 digits — longer than any accepted prefix + 10
  "55 1234 567a", // letters are never valid
  "", // empty: the field is required
  "   ", // whitespace only must not satisfy "required"
]

describe("MX_PHONE_PATTERN", () => {
  /**
   * The separator class escapes its parentheses (`[\s\(\)\-]*`) specifically so
   * it compiles under `v`, where an unescaped `(` is a syntax error. If someone
   * "simplifies" those escapes away, the pattern still works in browsers that
   * fall back to `u` and silently stops validating in browsers that do not.
   */
  describe.each(PATTERN_FLAGS)("compiled with the %s flag", (flags) => {
    it("compiles without throwing", () => {
      expect(() => anchored(flags)).not.toThrow()
    })

    it.each(ACCEPTED)("accepts %j", (value) => {
      expect(anchored(flags).test(value)).toBe(true)
    })

    it.each(REJECTED)("rejects %j", (value) => {
      expect(anchored(flags).test(value)).toBe(false)
    })
  })

  it("is left unanchored, so the browser's implicit anchoring is the boundary", () => {
    expect(MX_PHONE_PATTERN.startsWith("^")).toBe(false)
    expect(MX_PHONE_PATTERN.endsWith("$")).toBe(false)
  })
})

describe("isValidMxPhone", () => {
  it.each(ACCEPTED)("accepts %j", (value) => {
    expect(isValidMxPhone(value)).toBe(true)
  })

  it.each(REJECTED)("rejects %j", (value) => {
    expect(isValidMxPhone(value)).toBe(false)
  })

  it.each([undefined, null])("treats %j as invalid rather than throwing", (value) => {
    expect(isValidMxPhone(value)).toBe(false)
  })

  /**
   * The helper exists as a programmatic mirror of the attribute. If the two ever
   * disagree, one of the callers is enforcing a rule the other does not — which
   * is precisely how a field ends up rejecting input the copy says is fine.
   */
  it("agrees with the anchored pattern on every case", () => {
    const pattern = anchored("u")

    for (const value of [...ACCEPTED, ...REJECTED]) {
      expect(isValidMxPhone(value)).toBe(pattern.test(value))
    }
  })
})

describe("MX_PHONE_TITLE", () => {
  /**
   * The `title` is the native validation bubble. The incident was not only that
   * the pattern rejected valid numbers, but that the bubble insisted on "10
   * dígitos" while the customer was looking at a number they knew was right. The
   * copy has to advertise the country-prefixed form the pattern now accepts.
   */
  it("documents the country-prefixed form the pattern accepts", () => {
    expect(MX_PHONE_TITLE).toContain("+52")
  })

  it("stays a non-empty Spanish message", () => {
    expect(MX_PHONE_TITLE.trim().length).toBeGreaterThan(0)
    expect(MX_PHONE_TITLE).toContain("teléfono")
  })

  /**
   * The bubble shows a worked example; if the copy is edited, that example must
   * still be something the field will actually take.
   */
  it("cites an example the pattern accepts", () => {
    expect(isValidMxPhone("+52 55 1234 5678")).toBe(true)
    expect(MX_PHONE_TITLE).toContain("+52 55 1234 5678")
  })
})

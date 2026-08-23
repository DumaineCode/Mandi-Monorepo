/**
 * The classification that stands between an Openpay error body and a shopper.
 *
 * Every assertion here is about what a CUSTOMER ends up being told, not about
 * table lookups. The three that matter most are negative: `4001` must not be
 * reported as the shopper's insufficient funds, the stolen/fraud codes must not
 * be distinguishable from an ordinary decline, and NOTHING may return a message
 * carrying an Openpay code or an English description.
 */
import {
  classifyOpenpayFailure,
  PAYMENT_FAILURE_PREFIX,
  toPaymentFailureMessage,
} from "../decline"

describe("classifyOpenpayFailure", () => {
  /**
   * `3003` is the ONLY code that may tell a shopper their card has no money.
   */
  it("maps 3003, and only 3003, to insufficient funds", () => {
    expect(classifyOpenpayFailure(3003)).toBe("insufficient_funds")

    const everythingElse = [
      1000, 1001, 1002, 1006, 1018, 2004, 2005, 2006, 2009, 2010, 3001, 3002,
      3004, 3005, 3008, 3012, 4001, 4002,
    ]

    for (const code of everythingElse) {
      expect(classifyOpenpayFailure(code)).not.toBe("insufficient_funds")
    }
  })

  /**
   * ## The one that blames the customer for our accounting
   *
   * Openpay's `4001` reads "There are not enough funds in the openpay account"
   * and refers to the MERCHANT's balance. Read quickly it looks like a funds
   * decline, and mapping it as one tells a shopper holding a perfectly funded
   * card that their card is empty — sending them to another card that will fail
   * identically, because the problem is on our side.
   *
   * `merchant_config`'s copy is the counterpart: it does not mention their card
   * and it does not invite a retry.
   */
  it("treats 4001 as OUR problem, never the customer's funds", () => {
    expect(classifyOpenpayFailure(4001)).toBe("merchant_config")
    expect(classifyOpenpayFailure(4002)).toBe("merchant_config")
  })

  /**
   * ## The card-testing oracle
   *
   * `3004` (reported stolen), `3005` (anti-fraud / blacklist) and the
   * undocumented `3007` must be INDISTINGUISHABLE from `3001`. Anything else
   * publishes the anti-fraud verdict: someone feeding stolen PANs into the
   * checkout would learn from the wording which numbers are already flagged,
   * which is the single signal the system exists to withhold.
   *
   * Asserted as equality between the codes rather than against a literal, so it
   * keeps holding if the token is ever renamed — the property is that they
   * cannot be told apart.
   */
  it("makes stolen, fraud and plain declines indistinguishable", () => {
    const plain = classifyOpenpayFailure(3001)

    expect(classifyOpenpayFailure(3004)).toBe(plain)
    expect(classifyOpenpayFailure(3005)).toBe(plain)
    expect(classifyOpenpayFailure(3007)).toBe(plain)
  })

  /**
   * The codes worth distinguishing, because each implies a different next move:
   * another card, a corrected field, or a phone call to the bank.
   */
  it("keeps the actionable codes apart", () => {
    expect(classifyOpenpayFailure(3002)).toBe("card_expired")
    expect(classifyOpenpayFailure(2005)).toBe("card_expired")
    expect(classifyOpenpayFailure(2004)).toBe("invalid_card_number")
    expect(classifyOpenpayFailure(2006)).toBe("missing_cvv")
    expect(classifyOpenpayFailure(2009)).toBe("invalid_cvv")
    expect(classifyOpenpayFailure(2010)).toBe("three_ds_failed")
    expect(classifyOpenpayFailure(3008)).toBe("card_not_supported")
    expect(classifyOpenpayFailure(3012)).toBe("bank_authorization_required")
    expect(classifyOpenpayFailure(1018)).toBe("retry_limit_reached")
  })

  /**
   * `1006` means the `order_id` was already processed — so the charge very
   * probably WENT THROUGH. It must never share a token with the declines, whose
   * copy invites a retry, because a retry here is how one order becomes two.
   */
  it("separates an already-processed order from a decline", () => {
    expect(classifyOpenpayFailure(1006)).toBe("duplicate_order")
  })

  /**
   * `null` is "we have no opinion", which is NOT the same as "the card is bad".
   * The caller renders it as a generic decline, but the distinction has to
   * survive to the caller — a code we have never seen is not evidence about a
   * card.
   */
  it("answers null for anything it does not recognise", () => {
    expect(classifyOpenpayFailure(9999)).toBeNull()
    expect(classifyOpenpayFailure(undefined)).toBeNull()
    expect(classifyOpenpayFailure(null)).toBeNull()
  })

  /**
   * The field is documented as a number and arrives as a string from some
   * endpoints, so both have to work. What must NOT work is anything that
   * `Number()` coerces to a value that could index the table by accident:
   * `Number("")` is `0` and `Number(" ")` is `0`, and a table that ever grows a
   * `0` entry would start reporting it for every blank code.
   */
  it("accepts a numeric string and refuses coercible junk", () => {
    expect(classifyOpenpayFailure("3003")).toBe("insufficient_funds")
    expect(classifyOpenpayFailure(" 3003 ")).toBe("insufficient_funds")

    expect(classifyOpenpayFailure("")).toBeNull()
    expect(classifyOpenpayFailure("   ")).toBeNull()
    expect(classifyOpenpayFailure("3003abc")).toBeNull()
    expect(classifyOpenpayFailure("3.5")).toBeNull()
    expect(classifyOpenpayFailure(Number.NaN)).toBeNull()
  })
})

describe("toPaymentFailureMessage", () => {
  it("prefixes the token so the storefront can recognise it", () => {
    expect(toPaymentFailureMessage("insufficient_funds")).toBe(
      `${PAYMENT_FAILURE_PREFIX}insufficient_funds`
    )
  })

  /**
   * The default is a sentence THIS SYSTEM owns.
   *
   * The alternative default — passing the provider's own text through — is the
   * leak this module exists to close, and it is the one that silently comes
   * back the day somebody adds a throw site and forgets. An unclassified
   * failure at authorization time is most often a decline, and that copy is
   * actionable and true regardless.
   */
  it("falls back to a decline rather than to anything from the provider", () => {
    expect(toPaymentFailureMessage(null)).toBe(
      `${PAYMENT_FAILURE_PREFIX}card_declined`
    )
  })

  /**
   * The property that actually protects the shopper, asserted over the whole
   * catalogue rather than case by case: no message this function can produce
   * contains an Openpay error number, the word "Openpay", or any English.
   */
  it("never emits a code, a provider name or a description", () => {
    const codes = [
      1000, 1001, 1002, 1003, 1004, 1006, 1007, 1008, 1010, 1012, 1014, 1015,
      1017, 1018, 1020, 1023, 1024, 2004, 2005, 2006, 2007, 2009, 2010, 2011,
      3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010, 3011, 3012,
      4001, 4002, 9999,
    ]

    for (const code of codes) {
      const message = toPaymentFailureMessage(classifyOpenpayFailure(code))

      expect(message).toMatch(/^payment_failed:[a-z_]+$/)
      expect(message).not.toContain(String(code))
      expect(message.toLowerCase()).not.toContain("openpay")
    }
  })
})

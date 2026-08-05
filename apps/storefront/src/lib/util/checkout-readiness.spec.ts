import type { HttpTypes } from "@medusajs/types"
import { describe, expect, it } from "vitest"

import {
  canPlaceOrder,
  getMissingOrderRequirements,
  isOpenpayOffered,
  isOpenpayProviderId,
  OPENPAY_PROVIDER_ID_PREFIX,
  toReadinessInput,
  type MissingRequirementCode,
  type OrderReadinessInput,
} from "./checkout-readiness"

const OPENPAY = "pp_openpay_openpay"
const MERCADOPAGO = "pp_mercadopago_mercadopago"
const MANUAL = "pp_system_default"

const SIGNATURE = "mx\u001f06700\u001fcdmx\u001fcuauhtemoc"
const OTHER_SIGNATURE = "mx\u001f44160\u001fjalisco\u001fguadalajara"

/**
 * A cart that satisfies every branch, so each test states only its own
 * deviation. Applied by SPREAD, never destructuring defaults: `{ email:
 * undefined }` has to mean "this cart has no email", and a destructuring
 * default would silently hand the happy value back — the "missing email" tests
 * would then quietly assert nothing. Same reasoning as
 * `checkout-step.spec.ts`, which this file supersedes.
 */
const READY: OrderReadinessInput = {
  itemCount: 1,
  email: "cliente@example.mx",
  shippingAddress: {
    first_name: "Ana",
    last_name: "Ruiz",
    address_1: "Av. Insurgentes Sur 1602",
    postal_code: "06700",
    city: "Cuauhtémoc",
    province: "CDMX",
    country_code: "mx",
    phone: "5512345678",
  },
  hasBillingAddress: true,
  hasShippingMethod: true,
  selectionSignature: SIGNATURE,
  currentQuoteSignature: SIGNATURE,
  selectedPaymentProviderId: MERCADOPAGO,
  paymentDetailsComplete: false,
  paidByGiftCard: false,
}

const input = (
  overrides: Partial<OrderReadinessInput> = {}
): OrderReadinessInput => ({ ...READY, ...overrides })

/** Same idea one level down: the address is patched, not rebuilt. */
const withAddress = (
  overrides: Partial<NonNullable<OrderReadinessInput["shippingAddress"]>>
): OrderReadinessInput =>
  input({ shippingAddress: { ...READY.shippingAddress, ...overrides } })

const codes = (value: OrderReadinessInput): MissingRequirementCode[] =>
  getMissingOrderRequirements(value).map((requirement) => requirement.code)

const messageFor = (
  value: OrderReadinessInput,
  code: MissingRequirementCode
): string | undefined =>
  getMissingOrderRequirements(value).find(
    (requirement) => requirement.code === code
  )?.message

/**
 * ## Why this predicate gets its own block
 *
 * It looks like a one-line string test and it is not. Three things depend on it
 * being exactly what it is:
 *
 * 1. `lib/constants.tsx:89` — `isOpenpay` no longer holds the rule, it delegates
 *    here. Every provider-branching switch in checkout resolves through this.
 * 2. `payment-button/index.tsx:30` — calls it with
 *    `paymentSession?.provider_id`, and under R5 there is routinely NO payment
 *    session, so the argument is `undefined` on the normal path. The `typeof`
 *    guard is not defensive noise; it is the reason the place-order button can
 *    render at all.
 * 3. `payment-wrapper/index.tsx` — decides whether Openpay's
 *    device-fingerprinting collector is loaded into the page (H2).
 *
 * The prefix literal is declared HERE rather than compared against the imported
 * constant. Asserting `OPENPAY_PROVIDER_ID_PREFIX === OPENPAY_PROVIDER_ID_PREFIX`
 * is a tautology that passes for any value, which is the exact defect that let a
 * credential leak survive a green suite in the `log-safe` pass (G1).
 */
describe("isOpenpayProviderId", () => {
  /**
   * Cross-repo contract, not an implementation detail: the same literal is
   * registered in `apps/backend/medusa-config.ts` and mirrored in
   * `apps/backend/src/lib/constants.ts`. If the backend renames the provider,
   * this is the test that says so.
   */
  it("is anchored on the backend's registered prefix", () => {
    expect(OPENPAY_PROVIDER_ID_PREFIX).toBe("pp_openpay_")
  })

  it("accepts the provider id the backend actually registers", () => {
    expect(isOpenpayProviderId("pp_openpay_openpay")).toBe(true)
  })

  /**
   * Absence must answer `false`, not throw.
   *
   * `payment-button/index.tsx:30` reads `paymentSession?.provider_id` on a cart
   * that under R5 has no payment session until the final CTA is clicked, so
   * `undefined` is the COMMON argument, not the edge case. Without the `typeof`
   * guard this is a TypeError thrown during render — the place-order button
   * crashes on mount and takes the checkout page with it. A future
   * "simplification" that drops the guard because the signature already says
   * `string | undefined` is caught here and nowhere else.
   */
  it.each([
    ["undefined", undefined],
    ["null", null],
  ])("returns false without throwing for %s", (_label, providerId) => {
    expect(() => isOpenpayProviderId(providerId)).not.toThrow()
    expect(isOpenpayProviderId(providerId)).toBe(false)
  })

  /**
   * Position matters: the prefix must open the string, not merely appear in it.
   *
   * `startsWith` → `includes` is a one-word edit that reads as harmless and is
   * not. Provider ids arrive from the backend and are echoed into ids and data
   * attributes; a containment test lets any id that merely MENTIONS the prefix
   * claim to be Openpay, which routes a payment through the wrong provider
   * branch and, via H2, loads a fingerprinting script for a provider that was
   * never on offer.
   */
  it.each([
    "pp_evil_pp_openpay_x",
    "pp_stripe_pp_openpay_",
    "_pp_openpay_openpay",
    " pp_openpay_openpay",
  ])("rejects %j, where the prefix is present but not leading", (providerId) => {
    expect(isOpenpayProviderId(providerId)).toBe(false)
  })

  /**
   * The trailing underscore is load-bearing.
   *
   * Dropping it from the literal widens the match to every provider id that
   * merely begins with the word, so a hypothetical `pp_openpayments_*` provider
   * would be handed Openpay's tokenization path. The underscore is what makes
   * this a segment boundary rather than a word stem.
   */
  it.each(["pp_openpay", "pp_openpayX", "pp_openpayments_foo"])(
    "rejects %j, which lacks the segment boundary",
    (providerId) => {
      expect(isOpenpayProviderId(providerId)).toBe(false)
    }
  )

  it.each(["", "   ", "pp_mercadopago_mercadopago", "pp_system_default"])(
    "rejects %j",
    (providerId) => {
      expect(isOpenpayProviderId(providerId)).toBe(false)
    }
  )
})

/**
 * ## What this predicate actually gates
 *
 * `payment-wrapper/index.tsx` consults it to decide whether to mount
 * `OpenpayWrapper`, and mounting `OpenpayWrapper` loads
 * `openpay-data.v1.min.js` and runs `deviceData.setup()` — Openpay's device
 * fingerprinting. So every case below is a statement about whether a real
 * visitor gets fingerprinted by a payment processor.
 *
 * The rule it enforces is narrow and worth stating plainly: having Openpay
 * MERCHANT KEYS is not the same as OFFERING Openpay on this cart. Provider
 * config answers the first, this list answers the second, and only the second
 * one means a purchase might happen.
 */
describe("isOpenpayOffered", () => {
  const provider = (id: string) => ({ id })

  it("is true when Openpay is among the region's providers", () => {
    expect(
      isOpenpayOffered([provider(MERCADOPAGO), provider(OPENPAY)])
    ).toBe(true)
  })

  /**
   * The case the whole predicate exists for: Openpay is disabled for this
   * region in the backend, but the merchant still HAS Openpay keys, so
   * `/store/provider-config` keeps returning them. Gating on the config alone
   * shipped the fingerprinting collector to every visitor in that region.
   */
  it("is false when the region offers other providers but not Openpay", () => {
    expect(
      isOpenpayOffered([provider(MERCADOPAGO), provider(MANUAL)])
    ).toBe(false)
  })

  it("is false for an empty provider list", () => {
    expect(isOpenpayOffered([])).toBe(false)
  })

  /**
   * Fails CLOSED on absence.
   *
   * `listCartPaymentMethods` returns `null` when the request FAILED
   * (`payment.ts:31`), and an unpassed prop is `undefined`. Neither is evidence
   * that Openpay is on offer, so neither may start device collection. This also
   * kills the `Array.isArray` guard: without it, `null.some(...)` is a
   * TypeError thrown during checkout render.
   */
  it.each([
    ["null (the lookup failed)", null],
    ["undefined (no prop passed)", undefined],
  ])("is false without throwing for %s", (_label, methods) => {
    expect(() => isOpenpayOffered(methods)).not.toThrow()
    expect(isOpenpayOffered(methods)).toBe(false)
  })

  /**
   * `some` → `every` is a plausible edit that inverts the meaning: it would
   * require EVERY provider to be Openpay, so a region offering both Openpay and
   * Mercado Pago would stop loading the SDK and Openpay card fields would never
   * tokenize. The mixed-list case above proves the true direction; this one
   * proves the predicate is not merely "all providers are Openpay".
   */
  it("is true for a single-provider Openpay region", () => {
    expect(isOpenpayOffered([provider(OPENPAY)])).toBe(true)
  })

  /**
   * Delegation to `isOpenpayProviderId` is load-bearing, not decorative: a
   * containment or prefix-less match here would mount the fingerprinter for a
   * provider that merely resembles Openpay.
   */
  it.each(["pp_evil_pp_openpay_x", "pp_openpayments_foo", "pp_openpay"])(
    "is false for a look-alike provider id %j",
    (id) => {
      expect(isOpenpayOffered([provider(id)])).toBe(false)
    }
  )

  it("tolerates a malformed entry without throwing", () => {
    expect(() =>
      isOpenpayOffered([{ id: undefined }, { id: null }])
    ).not.toThrow()
    expect(isOpenpayOffered([{ id: undefined }, { id: null }])).toBe(false)
  })
})

describe("getMissingOrderRequirements", () => {
  it("returns an empty list for a fully ready cart", () => {
    expect(getMissingOrderRequirements(input())).toEqual([])
    expect(canPlaceOrder(input())).toBe(true)
  })

  /**
   * The itemization guarantee (R8 / S9). Reporting only the first blocker is
   * what today's single disabled button does, and it is why a customer can fix
   * one thing, see nothing change, and leave.
   */
  it("reports every missing requirement, not just the first", () => {
    const missing = getMissingOrderRequirements(
      input({
        email: null,
        shippingAddress: { ...READY.shippingAddress, phone: null },
        hasShippingMethod: false,
        selectedPaymentProviderId: null,
      })
    )

    expect(missing.map((requirement) => requirement.code)).toEqual([
      "email",
      "phone",
      "shipping_method",
      "payment_method",
    ])
    expect(missing).toHaveLength(4)
  })

  it("orders the list top-to-bottom by page position", () => {
    expect(
      codes(
        input({
          email: null,
          hasShippingMethod: false,
          selectedPaymentProviderId: null,
        })
      )
    ).toEqual(["email", "shipping_method", "payment_method"])
  })

  it("treats whitespace-only values as absent", () => {
    expect(
      codes(
        input({
          email: "   ",
          shippingAddress: { ...READY.shippingAddress, phone: "\t" },
        })
      )
    ).toEqual(["email", "phone"])
  })

  it("does not throw and reports only cart_empty for a null cart", () => {
    const readiness = toReadinessInput(null, {
      selectionSignature: null,
      currentQuoteSignature: null,
      selectedPaymentProviderId: null,
      paymentDetailsComplete: false,
    })

    expect(() => getMissingOrderRequirements(readiness)).not.toThrow()
    expect(getMissingOrderRequirements(readiness)).toEqual([
      { code: "cart_empty", message: "Tu carrito está vacío." },
    ])
  })

  /**
   * `cart_empty` short-circuits. Telling a customer with an empty cart that
   * their phone is missing is noise dressed up as help.
   */
  it("suppresses every other message when the cart is empty", () => {
    expect(
      getMissingOrderRequirements(
        input({
          itemCount: 0,
          email: null,
          shippingAddress: null,
          hasBillingAddress: false,
          hasShippingMethod: false,
          selectedPaymentProviderId: null,
        })
      )
    ).toEqual([{ code: "cart_empty", message: "Tu carrito está vacío." }])
  })

  it("reports card_details for Openpay with incomplete card data", () => {
    expect(
      getMissingOrderRequirements(
        input({
          selectedPaymentProviderId: OPENPAY,
          paymentDetailsComplete: false,
        })
      )
    ).toEqual([
      { code: "card_details", message: "Completa los datos de tu tarjeta." },
    ])
  })

  it("clears card_details once the Openpay card form is complete", () => {
    expect(
      codes(
        input({
          selectedPaymentProviderId: OPENPAY,
          paymentDetailsComplete: true,
        })
      )
    ).toEqual([])
  })

  /**
   * Mercado Pago collects card data off-site, so card completeness is not a
   * cart concern for it. A predicate that policed it would leave the CTA
   * permanently disabled for every MP customer.
   */
  it("ignores card completeness for non-Openpay providers", () => {
    expect(
      codes(
        input({
          selectedPaymentProviderId: MERCADOPAGO,
          paymentDetailsComplete: false,
        })
      )
    ).toEqual([])
    expect(
      codes(
        input({
          selectedPaymentProviderId: MANUAL,
          paymentDetailsComplete: false,
        })
      )
    ).toEqual([])
  })

  it.each([
    "first_name",
    "last_name",
    "address_1",
    "postal_code",
    "city",
    "province",
    "country_code",
  ] as const)("reports shipping_address when %s is missing", (field) => {
    expect(codes(withAddress({ [field]: null }))).toContain("shipping_address")
  })

  it("reports shipping_address when there is no address at all", () => {
    expect(codes(input({ shippingAddress: null }))).toContain(
      "shipping_address"
    )
  })

  it("carries the catalogue message for every code", () => {
    const bare = input({
      email: null,
      shippingAddress: null,
      hasBillingAddress: false,
      hasShippingMethod: false,
      selectedPaymentProviderId: null,
    })

    expect(messageFor(bare, "email")).toBe("Falta tu correo electrónico.")
    expect(messageFor(bare, "phone")).toBe("Falta tu teléfono.")
    expect(messageFor(bare, "shipping_address")).toBe(
      "Completa tu dirección de envío."
    )
    expect(messageFor(bare, "billing_address")).toBe(
      "Falta tu dirección de facturación."
    )
    expect(messageFor(bare, "shipping_method")).toBe(
      "Elige un método de envío."
    )
    expect(messageFor(bare, "payment_method")).toBe("Elige un método de pago.")
  })

  /**
   * The copy register is Mexican `tú`, matching the storefront
   * (`"Completa los datos a mano."`, `shipping-address/index.tsx:481`). The
   * proposal's R8 examples and `design.md` §2 are voseo — `"Elegí"`, `"Volvé"`
   * — which is Rioplatense and belongs to neither this store nor its customers.
   * The spec records the correction; this test enforces it, because a voseo
   * string would otherwise sail through review looking like Spanish.
   */
  const VOSEO_IMPERATIVES =
    /(Elegí|Completá|Volvé|Ingresá|Seleccioná|Revisá|Confirmá|Verificá|Probá)/i

  it("uses the Mexican tú imperative, never voseo", () => {
    const everything = [
      ...getMissingOrderRequirements(
        input({
          email: null,
          shippingAddress: null,
          hasBillingAddress: false,
          hasShippingMethod: false,
          selectedPaymentProviderId: null,
        })
      ),
      ...getMissingOrderRequirements(input({ itemCount: 0 })),
      ...getMissingOrderRequirements(
        input({ currentQuoteSignature: OTHER_SIGNATURE })
      ),
      ...getMissingOrderRequirements(
        input({
          selectedPaymentProviderId: OPENPAY,
          paymentDetailsComplete: false,
        })
      ),
    ]

    // Every one of the nine codes has to be represented, or this guard is
    // asserting over a subset and the untested message is the one that drifts.
    expect(
      new Set(everything.map((requirement) => requirement.code)).size
    ).toBe(9)

    for (const { message } of everything) {
      expect(message).not.toMatch(VOSEO_IMPERATIVES)
    }
  })

  /**
   * The guard above is only worth anything if it can actually fail. `Complet[áa]`
   * would have matched "Completa" — the CORRECT Mexican form — and the first
   * version of this test did exactly that, failing on correct copy while a real
   * voseo string would have been indistinguishable from a false positive.
   */
  it("has a voseo guard that recognises actual voseo", () => {
    expect("Elegí un método de envío").toMatch(VOSEO_IMPERATIVES)
    expect("Volvé a elegir el método de envío").toMatch(VOSEO_IMPERATIVES)
    expect("Elige un método de envío.").not.toMatch(VOSEO_IMPERATIVES)
    expect("Completa tu dirección de envío.").not.toMatch(VOSEO_IMPERATIVES)
  })
})

/**
 * ## `shipping_method_stale` — the ninth code (RC-2)
 *
 * The spec's catalogue calls itself "exhaustive and fixed" at eight codes. It
 * gains a ninth, at position 5.5, and this is an amendment rather than drift:
 * settled decision 8 post-dates the spec, and findings F1/F2 make the original
 * mechanism inexpressible.
 *
 * F1: there is no store API to remove a shipping method, so the spec's own
 * scenario "THEN `cart.shipping_methods` is empty" cannot be produced by any
 * storefront call. F2: the backend instead silently RE-PRICES the surviving
 * method to the new destination. Without this code the CTA has no way to block
 * an order placed against a superseded quote — which is the entire product
 * guarantee decision 1 asked for.
 */
describe("shipping_method_stale", () => {
  it("reports the code when the selection belongs to a superseded signature", () => {
    expect(codes(input({ currentQuoteSignature: OTHER_SIGNATURE }))).toEqual([
      "shipping_method_stale",
    ])
  })

  it("carries the Mexican tú message naming the cause", () => {
    expect(
      messageFor(
        input({ currentQuoteSignature: OTHER_SIGNATURE }),
        "shipping_method_stale"
      )
    ).toBe("Vuelve a elegir el método de envío: cambiaste el código postal.")
  })

  it("stays silent when the signatures agree", () => {
    expect(codes(input())).toEqual([])
  })

  /**
   * A method selected before any signature existed is NOT stale. Reporting it
   * would block a returning cart the customer has no way to unblock, with a
   * message accusing them of changing a postal code they never touched.
   */
  it("stays silent when the selection has no signature", () => {
    expect(codes(input({ selectionSignature: null }))).toEqual([])
  })

  /**
   * Staleness is meaningless without a selection: `shipping_method` already
   * covers "nothing chosen". Emitting both would tell the customer to re-choose
   * something they never chose.
   */
  it("does not stack on top of shipping_method", () => {
    expect(
      codes(
        input({
          hasShippingMethod: false,
          currentQuoteSignature: OTHER_SIGNATURE,
        })
      )
    ).toEqual(["shipping_method"])
  })

  it("sits immediately after shipping_method in the order", () => {
    expect(
      codes(
        input({
          hasBillingAddress: false,
          currentQuoteSignature: OTHER_SIGNATURE,
          selectedPaymentProviderId: null,
        })
      )
    ).toEqual(["billing_address", "shipping_method_stale", "payment_method"])
  })
})

/**
 * ## Ported verbatim in intent from `lib/util/checkout-step.spec.ts` (`design.md` D8)
 *
 * `hasCompleteShippingContact` was a single boolean answering "may this cart
 * leave the address step?". R8 needs field-level codes for the itemized list, so
 * the rule survives as three separate requirements rather than one flag — but
 * every case it pinned has to survive with it, and it has to survive HERE before
 * `checkout-step.spec.ts` may be deleted. Deleting first would drop the incident
 * coverage into a window where nothing enforces it.
 *
 * The cases run through `toReadinessInput` on cart stubs, not on hand-built
 * POJOs: the original predicate took a cart, and porting it against anything
 * else would quietly stop testing the mapping the components actually use.
 */
describe("hasCompleteShippingContact port (D8)", () => {
  type CartOverrides = {
    address_1?: string | null
    email?: string | null
    phone?: string | null
    shipping_methods?: unknown[]
    shipping_address?: null
  }

  const COMPLETE_CART = {
    address_1: "Av. Insurgentes Sur 1602",
    email: "cliente@example.mx",
    phone: "5512345678",
    shipping_methods: [{ id: "sm_1" }] as unknown[],
    shipping_address: undefined as null | undefined,
  }

  const buildCart = (overrides: CartOverrides = {}): HttpTypes.StoreCart => {
    const { address_1, email, phone, shipping_methods, shipping_address } = {
      ...COMPLETE_CART,
      ...overrides,
    }

    return {
      items: [{ id: "li_1" }],
      email,
      billing_address: { id: "caaddr_bill" },
      shipping_address:
        shipping_address === null
          ? null
          : {
              first_name: "Ana",
              last_name: "Ruiz",
              address_1,
              postal_code: "06700",
              city: "Cuauhtémoc",
              province: "CDMX",
              country_code: "mx",
              phone,
            },
      shipping_methods,
    } as unknown as HttpTypes.StoreCart
  }

  const cartCodes = (
    cart: HttpTypes.StoreCart | null | undefined
  ): MissingRequirementCode[] =>
    getMissingOrderRequirements(
      toReadinessInput(cart, {
        selectionSignature: null,
        currentQuoteSignature: null,
        selectedPaymentProviderId: MANUAL,
        paymentDetailsComplete: false,
      })
    ).map((requirement) => requirement.code)

  it("blocks nothing when address, email and phone are all present", () => {
    expect(cartCodes(buildCart())).toEqual([])
  })

  it.each([undefined, null])(
    "reports only cart_empty for a %j cart",
    (cart) => {
      expect(cartCodes(cart)).toEqual(["cart_empty"])
    }
  )

  it("reports address and phone when the cart has no shipping address", () => {
    expect(cartCodes(buildCart({ shipping_address: null }))).toEqual([
      "phone",
      "shipping_address",
    ])
  })

  describe.each([
    ["address_1", "shipping_address", "address_1"],
    ["email", "email", "email"],
    ["phone", "phone", "phone"],
  ] as const)("%s", (_label, expectedCode, key) => {
    it.each([
      ["missing", undefined],
      ["blank", ""],
      ["whitespace only", "   "],
    ])(`reports ${expectedCode} when %s`, (_state, value) => {
      expect(cartCodes(buildCart({ [key]: value }))).toContain(expectedCode)
    })
  })

  /**
   * The predicate is blank-vs-present ON PURPOSE. Format is the input
   * `pattern`'s job (`lib/util/phone.ts`) and the backend normalizes before the
   * wire; re-checking format here would risk trapping a customer behind a CTA
   * they cannot satisfy — the same over-strictness that made the phone
   * `pattern` a revenue stopper. If someone later "tightens" this to a format
   * check, this test is the one that should object.
   */
  it("does not police phone format, only presence", () => {
    expect(cartCodes(buildCart({ phone: "12" }))).toEqual([])
  })

  /**
   * `getCheckoutStep`'s characterization case, inverted on purpose.
   *
   * The old resolver used `shipping_methods?.length === 0`, which is FALSE for
   * an absent field, so a cart fetched without `+shipping_methods.name` skipped
   * the delivery step entirely and went straight to payment. It was unreachable
   * through the app's own fetch path, and the old spec recorded it as "the
   * behaviour you get" rather than as desired.
   *
   * The new predicate is a gate on placing an order, not a router, so absence
   * must BLOCK rather than wave through: an order with no shipping method is one
   * Skydropx can never label. This is a deliberate tightening, and it is the
   * shape of the strictness floor the spec demands.
   */
  it("blocks rather than skips when shipping_methods is absent", () => {
    expect(cartCodes(buildCart({ shipping_methods: undefined }))).toEqual([
      "shipping_method",
    ])
  })

  it("reports shipping_method when the list is present but empty", () => {
    expect(cartCodes(buildCart({ shipping_methods: [] }))).toEqual([
      "shipping_method",
    ])
  })
})

/**
 * ## The strictness floor (R8, risk #5)
 *
 * The new predicate must be AT LEAST as strict as the one it replaces. Medusa's
 * `completeCart` checks only "has items" and "has an acceptable payment session"
 * (`explore §7`), so any condition dropped here is not caught anywhere else — it
 * becomes an order that reaches fulfilment and cannot be labelled.
 *
 * `notReadyToday` below is today's `notReady` transcribed from
 * `payment-button/index.tsx:26-31`, character for character. The property is
 * one-directional on purpose: today-blocked implies still-blocked. The reverse
 * must NOT hold — the new predicate is deliberately stricter (phone,
 * per-field address completeness, staleness, payment selection).
 */
describe("strictness floor", () => {
  const notReadyToday = (cart: HttpTypes.StoreCart | null): boolean =>
    !cart ||
    !cart.shipping_address ||
    !cart.billing_address ||
    !cart.email ||
    (cart.shipping_methods?.length ?? 0) < 1

  const FULL_ADDRESS = {
    first_name: "Ana",
    last_name: "Ruiz",
    address_1: "Av. Insurgentes Sur 1602",
    postal_code: "06700",
    city: "Cuauhtémoc",
    province: "CDMX",
    country_code: "mx",
    phone: "5512345678",
  }

  const cart = (overrides: Record<string, unknown> = {}) =>
    ({
      items: [{ id: "li_1" }],
      email: "cliente@example.mx",
      shipping_address: FULL_ADDRESS,
      billing_address: { id: "caaddr_bill" },
      shipping_methods: [{ id: "sm_1" }],
      ...overrides,
    } as unknown as HttpTypes.StoreCart)

  /**
   * One entry per condition in today's `notReady`, plus the null cart — and for
   * every condition, BOTH shapes of absence.
   *
   * `null` and `undefined` are not interchangeable here and treating them as if
   * they were is how this table stops being a floor. A Medusa cart fetched
   * without a relation omits the field (`undefined`); a cart fetched WITH the
   * relation and nothing in it returns `null`. Both reach `toReadinessInput`,
   * so a row that only covers one of them leaves the adapter free to answer
   * differently for the other — and the direction it drifts is always the same
   * one, because `x !== null` reads as a natural tightening of `Boolean(x)` and
   * is in fact a fail-OPEN.
   *
   * That is not hypothetical: `hasBillingAddress: cart?.billing_address !== null`
   * passed this entire suite before the `undefined` row below existed. The
   * file's own rule at `checkout-readiness.ts:351-357` — "A gate must fail
   * closed: absence blocks" — was being violated by the adapter while the test
   * that exists to enforce it stayed green.
   */
  const BLOCKED_TODAY: [string, HttpTypes.StoreCart | null][] = [
    ["a null cart", null],
    ["no shipping address", cart({ shipping_address: null })],
    ["an undefined shipping address", cart({ shipping_address: undefined })],
    ["no billing address", cart({ billing_address: null })],
    /**
     * The row that kills `hasBillingAddress: cart?.billing_address !== null`.
     * An unfetched `billing_address` relation is the normal shape of a cart
     * read that did not ask for it, so this is the reachable case, not the
     * exotic one.
     */
    ["an undefined billing address", cart({ billing_address: undefined })],
    ["no email", cart({ email: null })],
    ["a blank email", cart({ email: "" })],
    /**
     * Enumeration completeness, stated honestly: this row kills no mutant that
     * the `null` row above does not already kill, because `isAbsent` discards
     * both through one `typeof` guard. It is here so the table's own invariant
     * — every condition, both shapes of absence — is true by inspection, and so
     * that a future split of that guard cannot quietly reach only one of them.
     */
    ["an undefined email", cart({ email: undefined })],
    ["an empty shipping method list", cart({ shipping_methods: [] })],
    ["an absent shipping method list", cart({ shipping_methods: undefined })],
  ]

  it.each(BLOCKED_TODAY)(
    "still blocks a cart with %s",
    (_label, blockedCart) => {
      expect(notReadyToday(blockedCart)).toBe(true)

      expect(
        canPlaceOrder(
          toReadinessInput(blockedCart, {
            selectionSignature: null,
            currentQuoteSignature: null,
            selectedPaymentProviderId: MANUAL,
            paymentDetailsComplete: true,
          })
        )
      ).toBe(false)
    }
  )

  /**
   * The cases today's predicate lets THROUGH and this one must not. Without
   * these the floor test above is satisfied by a predicate that merely copies
   * `notReady`, and the whole point of the rewrite disappears.
   */
  it.each([
    ["no phone", cart({ shipping_address: { ...FULL_ADDRESS, phone: null } })],
    [
      "a whitespace phone",
      cart({ shipping_address: { ...FULL_ADDRESS, phone: "  " } }),
    ],
    [
      "an address missing only the street",
      cart({ shipping_address: { ...FULL_ADDRESS, address_1: "" } }),
    ],
    [
      "an address missing only the last name",
      cart({ shipping_address: { ...FULL_ADDRESS, last_name: null } }),
    ],
    ["no line items", cart({ items: [] })],
  ])("blocks a cart with %s that today would pass", (_label, laxCart) => {
    expect(notReadyToday(laxCart)).toBe(false)

    expect(
      canPlaceOrder(
        toReadinessInput(laxCart, {
          selectionSignature: null,
          currentQuoteSignature: null,
          selectedPaymentProviderId: MANUAL,
          paymentDetailsComplete: true,
        })
      )
    ).toBe(false)
  })

  it("lets a genuinely complete cart through", () => {
    expect(notReadyToday(cart())).toBe(false)
    expect(
      canPlaceOrder(
        toReadinessInput(cart(), {
          selectionSignature: null,
          currentQuoteSignature: null,
          selectedPaymentProviderId: MANUAL,
          paymentDetailsComplete: false,
        })
      )
    ).toBe(true)
  })
})

describe("full catalogue ordering", () => {
  /**
   * Locks the ORDER, not just the individual answers. Every case elsewhere in
   * this file would still pass under an implementation that reshuffled the
   * branches; this one fails the moment the customer's reading order and the
   * list's order stop agreeing.
   *
   * `cart_empty` cannot appear alongside anything (it short-circuits) and
   * `shipping_method_stale` cannot appear alongside `shipping_method` (a
   * selection is either absent or stale, never both), so the catalogue is swept
   * in three overlapping passes rather than one impossible cart.
   */
  it("emits codes in catalogue order when everything is missing at once", () => {
    expect(
      codes(
        input({
          email: null,
          shippingAddress: null,
          hasBillingAddress: false,
          hasShippingMethod: false,
          selectedPaymentProviderId: null,
        })
      )
    ).toEqual([
      "email",
      "phone",
      "shipping_address",
      "billing_address",
      "shipping_method",
      "payment_method",
    ])
  })

  it("emits the stale and card branches in the same positions", () => {
    expect(
      codes(
        input({
          email: null,
          shippingAddress: null,
          hasBillingAddress: false,
          hasShippingMethod: true,
          currentQuoteSignature: OTHER_SIGNATURE,
          selectedPaymentProviderId: OPENPAY,
          paymentDetailsComplete: false,
        })
      )
    ).toEqual([
      "email",
      "phone",
      "shipping_address",
      "billing_address",
      "shipping_method_stale",
      "card_details",
    ])
  })

  it("never emits both shipping_method and shipping_method_stale", () => {
    for (const hasShippingMethod of [true, false]) {
      for (const currentQuoteSignature of [SIGNATURE, OTHER_SIGNATURE, null]) {
        const emitted = codes(
          input({ hasShippingMethod, currentQuoteSignature })
        )

        expect(
          emitted.filter((code) => code.startsWith("shipping_method")).length
        ).toBeLessThanOrEqual(1)
      }
    }
  })

  it("never emits both payment_method and card_details", () => {
    for (const provider of [null, "", "   ", OPENPAY, MERCADOPAGO, MANUAL]) {
      const emitted = codes(
        input({
          selectedPaymentProviderId: provider,
          paymentDetailsComplete: false,
        })
      )

      expect(
        emitted.filter(
          (code) => code === "payment_method" || code === "card_details"
        ).length
      ).toBeLessThanOrEqual(1)
    }
  })

  it("treats a whitespace-only provider id as no provider at all", () => {
    expect(codes(input({ selectedPaymentProviderId: "   " }))).toEqual([
      "payment_method",
    ])
  })
})

/**
 * ## The gift-card bypass
 *
 * Carried from `payment/index.tsx:83-88`, where `paidByGiftcard` already
 * short-circuits `paymentReady`. Two properties matter and neither is obvious
 * from the field name.
 */
describe("paidByGiftCard", () => {
  it("suppresses the payment codes when the cart is fully covered", () => {
    expect(
      codes(input({ selectedPaymentProviderId: null, paidByGiftCard: true }))
    ).toEqual([])
    expect(
      codes(
        input({
          selectedPaymentProviderId: OPENPAY,
          paymentDetailsComplete: false,
          paidByGiftCard: true,
        })
      )
    ).toEqual([])
  })

  /**
   * It bypasses PAYMENT and nothing else. A gift card pays for an order; it does
   * not address, phone or ship one. If this ever starts suppressing an address
   * code, the bypass has become a hole.
   */
  it("suppresses nothing else", () => {
    expect(
      codes(
        input({
          paidByGiftCard: true,
          email: null,
          shippingAddress: null,
          hasBillingAddress: false,
          hasShippingMethod: false,
        })
      )
    ).toEqual([
      "email",
      "phone",
      "shipping_address",
      "billing_address",
      "shipping_method",
    ])
  })

  /**
   * The derivation, which is where the safety actually lives. BOTH conditions
   * are required: a gift card that does not cover the whole total leaves a
   * balance that still needs a payment method. And `gift_cards` is not on
   * Medusa v2's `StoreCart` at all, so in this deployment the adapter can only
   * ever produce `false` — which is the reason the branch above is currently
   * unreachable and must be re-verified against `completeCart` before gift
   * cards are ever enabled.
   */
  it.each([
    ["no gift cards and a zero total", { gift_cards: [], total: 0 }, false],
    [
      "gift cards but a non-zero total",
      { gift_cards: [{ id: "gc" }], total: 10 },
      false,
    ],
    ["no gift_cards key at all", { total: 0 }, false],
    [
      "gift cards covering the total",
      { gift_cards: [{ id: "gc" }], total: 0 },
      true,
    ],
  ])("derives %s as %s", (_label, overrides, expected) => {
    const derived = toReadinessInput(
      {
        items: [{ id: "li_1" }],
        ...overrides,
      } as unknown as HttpTypes.StoreCart,
      {
        selectionSignature: null,
        currentQuoteSignature: null,
        selectedPaymentProviderId: null,
        paymentDetailsComplete: false,
      }
    )

    expect(derived.paidByGiftCard).toBe(expected)
  })
})

describe("canPlaceOrder", () => {
  /**
   * `canPlaceOrder` is DEFINED as the emptiness of the missing list, never as a
   * second derivation of the same conditions. A copy is how the button and its
   * explanation drift apart — the customer sees an enabled CTA with a list of
   * reasons it cannot be clicked, or worse, the reverse.
   *
   * The cases below sweep one blocker at a time so any independent
   * re-derivation has to reproduce all of them exactly.
   */
  it.each([
    ["ready", {}],
    ["empty cart", { itemCount: 0 }],
    ["no email", { email: null }],
    ["no billing address", { hasBillingAddress: false }],
    ["no shipping method", { hasShippingMethod: false }],
    ["no payment provider", { selectedPaymentProviderId: null }],
    ["no address", { shippingAddress: null }],
    ["stale shipping selection", { currentQuoteSignature: OTHER_SIGNATURE }],
    [
      "openpay without card data",
      { selectedPaymentProviderId: OPENPAY, paymentDetailsComplete: false },
    ],
  ] as const)(
    "agrees with the missing list for a cart with %s",
    (_label, overrides) => {
      const value = input(overrides)

      expect(canPlaceOrder(value)).toBe(
        getMissingOrderRequirements(value).length === 0
      )
    }
  )
})

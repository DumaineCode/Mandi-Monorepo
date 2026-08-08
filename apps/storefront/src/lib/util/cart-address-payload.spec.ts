import { HttpTypes } from "@medusajs/types"
import { describe, expect, it } from "vitest"

import {
  buildCheckoutAddressesPayload,
  buildPartialShippingAddressPayload,
  PERSISTABLE_ADDRESS_FIELDS,
  resolveBillingAddressId,
  resolveShippingAddressId,
  type CheckoutDraftAddress,
  type FreshCartRead,
} from "./cart-address-payload"

/**
 * The persistable field set, written out by hand ON PURPOSE.
 *
 * Asserting `PERSISTABLE_ADDRESS_FIELDS` against anything derived from itself
 * is a tautology that passes no matter what the array says. This list is the
 * independent second opinion: it is the set of address fields the checkout form
 * actually collects (`shipping-address/index.tsx`), and it must be edited
 * deliberately. A field that disappears from the array — and therefore silently
 * stops persisting — fails here.
 */
const EXPECTED_PERSISTABLE_FIELDS = [
  "first_name",
  "last_name",
  "company",
  "address_1",
  "address_2",
  "postal_code",
  "city",
  "province",
  "country_code",
  "phone",
]

/**
 * Minimal cart stub. `StoreCart` is far too wide to build honestly here and the
 * builder reads exactly one path off it — `shipping_address.id`. The cast keeps
 * every test showing only the values that actually participate in the decision.
 */
const buildCart = (
  shippingAddress: Partial<HttpTypes.StoreCartAddress> | null | undefined
): HttpTypes.StoreCart =>
  ({ id: "cart_01", shipping_address: shippingAddress } as HttpTypes.StoreCart)

/**
 * A cart whose `shipping_address` KEY is not present at all.
 *
 * This is the shape a broken projection returns, and it is deliberately built
 * without the key rather than with `undefined`: `"shipping_address" in cart` is
 * the only thing that can tell "the relation was not requested / not returned"
 * apart from "the relation was requested and is empty", and an object literal
 * with an explicit `undefined` value HAS the key.
 */
const buildCartWithoutAddressKey = (): HttpTypes.StoreCart =>
  ({ id: "cart_01" } as HttpTypes.StoreCart)

/**
 * A cart carrying the FK SCALAR `shipping_address_id` alongside (or instead of)
 * the relation.
 *
 * `shipping_address_id` is a plain column on the cart, and it sits in Medusa's
 * OWN default store projection one line above the relation
 * (`@medusajs/medusa/dist/api/store/carts/query-config.js:102-103`). A selected
 * scalar always materialises its key — there is no relation-serialisation
 * semantics in the way — which makes it the unambiguous witness the relation
 * alone cannot be.
 *
 * Not in the published `StoreCart` type (`common.d.ts:40` declares only
 * `shipping_address`), hence the cast, exactly as production code probes it.
 */
const buildCartWithFk = (
  fk: string | null,
  shippingAddress?: Partial<HttpTypes.StoreCartAddress> | null
): HttpTypes.StoreCart =>
  ({
    id: "cart_01",
    shipping_address_id: fk,
    ...(shippingAddress === undefined
      ? {}
      : { shipping_address: shippingAddress }),
  } as unknown as HttpTypes.StoreCart)

/** A full address, so each test only states its one deviation. */
const FULL_ADDRESS: Partial<HttpTypes.StoreCartAddress> = {
  id: "caaddr_01",
  first_name: "Ana",
  last_name: "Ramírez",
  company: "MANDO",
  phone: "5512345678",
  address_1: "Av. Insurgentes Sur 1602",
  address_2: "Piso 4",
  postal_code: "03940",
  city: "Ciudad de México",
  province: "CDMX",
  country_code: "mx",
}

const QUOTE_PATCH: Partial<CheckoutDraftAddress> = {
  postal_code: "06700",
  city: "Ciudad de México",
  province: "CDMX",
  country_code: "mx",
}

describe("buildPartialShippingAddressPayload", () => {
  describe("id propagation", () => {
    it("propagates an existing shipping address id", () => {
      const payload = buildPartialShippingAddressPayload(
        buildCart(FULL_ADDRESS),
        QUOTE_PATCH
      )

      expect(payload.shipping_address.id).toBe("caaddr_01")
    })

    it("omits the id key entirely when the cart has no shipping address", () => {
      const payload = buildPartialShippingAddressPayload(
        buildCart(null),
        QUOTE_PATCH
      )

      // The assertion is on KEY ABSENCE, not on a falsy value. `id: null` or
      // `id: ""` would reach `Utils.extractPK` and still fail to resolve a pk,
      // which is the exact path that creates a new cart_address row.
      expect("id" in payload.shipping_address).toBe(false)
      expect(payload.shipping_address).not.toHaveProperty("id")
    })

    it("omits the id key when the existing address has no id", () => {
      const payload = buildPartialShippingAddressPayload(
        buildCart({ postal_code: "03940" }),
        QUOTE_PATCH
      )

      expect("id" in payload.shipping_address).toBe(false)
    })

    it("omits the id key when the existing address id is null", () => {
      // `""` is covered below, but `null` is the likelier value on the wire:
      // `AddressPayload` declares every field `nullish()`, and a cart serialised
      // with an explicitly-null relation id round-trips as `null`, not `""`.
      // Both must reach the same place — key ABSENT, never `id: null`, which
      // yields `pk === undefined` at `EntityAssigner.js:81` and creates a row.
      const payload = buildPartialShippingAddressPayload(
        buildCart({
          id: null,
        } as unknown as Partial<HttpTypes.StoreCartAddress>),
        QUOTE_PATCH
      )

      expect("id" in payload.shipping_address).toBe(false)
      expect(payload.shipping_address).not.toHaveProperty("id")
    })
  })

  describe("key selection", () => {
    it("sends only the patched keys plus the id", () => {
      const payload = buildPartialShippingAddressPayload(
        buildCart(FULL_ADDRESS),
        { postal_code: "06700" }
      )

      expect(Object.keys(payload.shipping_address).sort()).toEqual([
        "id",
        "postal_code",
      ])
    })

    it("never copies unpatched fields from the cart into the payload", () => {
      const payload = buildPartialShippingAddressPayload(
        buildCart(FULL_ADDRESS),
        { postal_code: "06700" }
      )

      expect(payload.shipping_address).not.toHaveProperty("first_name")
      expect(payload.shipping_address).not.toHaveProperty("phone")
    })
  })

  describe("the persistable field set", () => {
    it("persists exactly the fields the checkout form collects", () => {
      // The type used to be hand-written alongside the array, and
      // `satisfies readonly (keyof CheckoutDraftAddress)[]` proved only that
      // every ELEMENT is a valid key — never that every key is an element. Add
      // a field to the type, forget the array, and it silently stops
      // persisting: clean compile, green suite, customer data quietly dropped.
      //
      // `CheckoutDraftAddress` is now DERIVED from this array, so that drift is
      // structurally impossible. This assertion covers the half derivation
      // cannot: that the array itself has not lost an entry.
      expect([...PERSISTABLE_ADDRESS_FIELDS].sort()).toEqual(
        [...EXPECTED_PERSISTABLE_FIELDS].sort()
      )
    })

    it("carries every persistable field through to the payload", () => {
      const patch = Object.fromEntries(
        EXPECTED_PERSISTABLE_FIELDS.map((field) => [field, `value_${field}`])
      ) as Partial<CheckoutDraftAddress>

      const payload = buildPartialShippingAddressPayload(
        buildCart(FULL_ADDRESS),
        patch
      )

      // The behavioural half of the assertion above: it is not enough for the
      // name to be in the array, the value has to arrive in the payload.
      expect(Object.keys(payload.shipping_address).sort()).toEqual(
        ["id", ...EXPECTED_PERSISTABLE_FIELDS].sort()
      )
      EXPECTED_PERSISTABLE_FIELDS.forEach((field) => {
        expect(payload.shipping_address[field]).toBe(`value_${field}`)
      })
    })
  })

  describe("absent carts and absent addresses", () => {
    it.each([null, undefined])("tolerates a %j cart", (cart) => {
      const payload = buildPartialShippingAddressPayload(cart, QUOTE_PATCH)

      expect("id" in payload.shipping_address).toBe(false)
      expect(payload.shipping_address.postal_code).toBe("06700")
    })

    it("tolerates a cart whose shipping_address is undefined", () => {
      // The `it.each` above varies the CART. This varies the ADDRESS, which is
      // the shape a real `fields=id,*shipping_address` read returns for a cart
      // that has never had an address: the cart object is there, the relation
      // simply is not.
      const payload = buildPartialShippingAddressPayload(
        buildCart(undefined),
        QUOTE_PATCH
      )

      expect("id" in payload.shipping_address).toBe(false)
      expect(payload.shipping_address.postal_code).toBe("06700")
    })
  })

  /**
   * Triangulation. Every case below passes a naive `{ id, ...patch }` spread
   * while being wrong, so they are what pins the allow-list construction in
   * place. Deleting any of them lets the spread come back unnoticed.
   */
  describe("triangulation — cases a naive spread would get wrong", () => {
    it("omits a patch key whose value is undefined instead of sending it", () => {
      const payload = buildPartialShippingAddressPayload(
        buildCart(FULL_ADDRESS),
        { postal_code: "06700", city: undefined }
      )

      // `{ ...patch }` keeps the key with an `undefined` value. That key then
      // reaches a `.strict()` zod object as a present-but-undefined field, and
      // more importantly it states an intent the customer never expressed.
      expect("city" in payload.shipping_address).toBe(false)
      expect(Object.keys(payload.shipping_address).sort()).toEqual([
        "id",
        "postal_code",
      ])
    })

    it("sends a patch key whose value is an empty string", () => {
      const payload = buildPartialShippingAddressPayload(
        buildCart(FULL_ADDRESS),
        { address_2: "" }
      )

      // Clearing a field is legitimate — the customer deleted the apartment
      // number. Treating "" as absent would make that edit unsaveable.
      expect("address_2" in payload.shipping_address).toBe(true)
      expect(payload.shipping_address.address_2).toBe("")
    })

    it("sends a patch key whose value is null", () => {
      const payload = buildPartialShippingAddressPayload(
        buildCart(FULL_ADDRESS),
        // `StoreCartAddress` types these fields `string | undefined`, so a
        // TYPED caller cannot produce null and the cast is required. The case
        // is still worth pinning: this function sits behind a server-action
        // boundary where the payload arrives as plain JSON and the types have
        // already been erased. `AddressPayload` declares every field
        // `nullish()`, so null is a valid explicit clear on the wire. The rule
        // is therefore "only `undefined` means not-part-of-this-patch", not
        // "only strings survive".
        { company: null } as unknown as Partial<CheckoutDraftAddress>
      )

      expect("company" in payload.shipping_address).toBe(true)
      expect(payload.shipping_address.company).toBeNull()
    })

    it("never lets an id in the patch override the cart's id", () => {
      const payload = buildPartialShippingAddressPayload(
        buildCart(FULL_ADDRESS),
        { postal_code: "06700", id: "caaddr_ATTACKER" } as never
      )

      // A mismatched pk is WORSE than no pk: `EntityAssigner.js:81-92` fails
      // `sameTarget` and falls through to `assignReference` anyway, now with a
      // misleading id in the payload. The cart is the only id authority.
      expect(payload.shipping_address.id).toBe("caaddr_01")
    })

    it("drops patch keys that are not persistable address fields", () => {
      const payload = buildPartialShippingAddressPayload(
        buildCart(FULL_ADDRESS),
        { postal_code: "06700", metadata: { evil: true } } as never
      )

      // `StoreCartUpsertAddress` is `.strict()`. One stray key fails the whole
      // write with a 400, and the customer's data silently stops persisting.
      expect("metadata" in payload.shipping_address).toBe(false)
    })

    it("omits an empty-string id on the cart's address", () => {
      const payload = buildPartialShippingAddressPayload(
        buildCart({ id: "", postal_code: "03940" }),
        QUOTE_PATCH
      )

      expect("id" in payload.shipping_address).toBe(false)
    })
  })

  /**
   * SETTLED DECISION, recorded here because the code alone cannot state it.
   *
   * An all-`undefined` patch against a cart that HAS an id yields a bare-PK
   * upsert: `{ shipping_address: { id } }`. That is INTENDED, not a bug.
   *
   * The builder is pure and describes a payload; it has no authority to cancel a
   * write. And the payload it produces is a faithful description of "this row,
   * no field changes" — `EntityAssigner.js:81` extracts the pk, `sameTarget`
   * holds, and `:89` merges zero fields. The address row is untouched.
   *
   * What it is NOT is free: `updateCartWorkflow` still runs and still
   * recalculates the cart. Suppressing that pointless round trip is the
   * CALLER's job, and design §D3 already assigns it to the PR2a reducer's
   * "skip when the draft is unchanged" rule. It is deliberately not done here:
   * a no-op return would need the builder to distinguish "nothing changed" from
   * "nothing persistable was sent", and PR1a's single caller always passes six
   * populated fields, so the case cannot occur yet.
   */
  describe("a patch with nothing to persist", () => {
    it("emits a bare-PK upsert when every persistable key is undefined", () => {
      const emptyPatch = Object.fromEntries(
        EXPECTED_PERSISTABLE_FIELDS.map((field) => [field, undefined])
      ) as Partial<CheckoutDraftAddress>

      const payload = buildPartialShippingAddressPayload(
        buildCart(FULL_ADDRESS),
        emptyPatch
      )

      expect(payload.shipping_address).toEqual({ id: "caaddr_01" })
    })

    it("emits an empty shipping_address when there is no id either", () => {
      const payload = buildPartialShippingAddressPayload(buildCart(null), {})

      // Nothing to merge and nothing to key by. Notably this is NOT harmless
      // the way the bare-PK case is: `assignReference` -> `em.create` would
      // create an empty cart_address row. It is pinned so that the day a caller
      // can produce it, the consequence is already written down.
      expect(payload.shipping_address).toEqual({})
    })
  })
})

/**
 * The abort/proceed decision, extracted from `persistCheckoutDraft` so it can be
 * tested at all. The orchestrator around it is a `"use server"` function that
 * reads cookies and calls the SDK; this is the part that decides whether a write
 * is safe, and it is pure.
 */
describe("resolveShippingAddressId", () => {
  describe("a successful read", () => {
    it("resolves the id when the cart has an address row", () => {
      const read: FreshCartRead = { ok: true, cart: buildCart(FULL_ADDRESS) }

      expect(resolveShippingAddressId(read)).toEqual({
        status: "resolved",
        id: "caaddr_01",
      })
    })

    it("reports absence when the cart genuinely has no address row", () => {
      // This is the ONE case where writing without an id is correct:
      // `assignReference` -> `em.create` makes the row, and there is nothing to
      // destroy. It must stay distinguishable from a failed read.
      const read: FreshCartRead = { ok: true, cart: buildCart(null) }

      expect(resolveShippingAddressId(read)).toEqual({ status: "absent" })
    })

    it("reports absence for a key that is present and undefined", () => {
      // Key PRESENT, value empty. The projection ran and told us there is no
      // address row, which is the safe id-less write.
      expect(
        resolveShippingAddressId({ ok: true, cart: buildCart(undefined) })
      ).toEqual({ status: "absent" })
    })
  })

  /**
   * The projection is the single point of failure in this fix, and until now it
   * failed UNSAFE.
   *
   * `persistCheckoutDraft` asks for one projection and derives the entire
   * merge-vs-replace decision from the answer. If that projection ever stops
   * materialising the relation — a field-parser change, a future `allowed` list
   * on the route, a typo in the field string — the response is a clean 200 with
   * a cart in it and no `shipping_address`. That used to resolve to `absent`,
   * the id-less destructive write proceeded, and the step-6 tripwire could not
   * fire because it only fires when an id WAS sent. Silent, and it shreds PII.
   *
   * "The relation is empty" and "the relation never arrived" are different
   * claims and must resolve differently. The first is a fact about the cart; the
   * second is a fact about our own request, and it is not evidence about the
   * cart at all.
   */
  describe("a read whose projection did not deliver the relation", () => {
    it("refuses to resolve when the shipping_address key is absent entirely", () => {
      const resolution = resolveShippingAddressId({
        ok: true,
        cart: buildCartWithoutAddressKey(),
      })

      expect(resolution.status).toBe("unresolved")
    })

    it("distinguishes an absent key from a present-but-empty one", () => {
      // The two states this suite could not previously tell apart, asserted
      // side by side so they can never collapse back into one.
      expect(
        resolveShippingAddressId({
          ok: true,
          cart: buildCartWithoutAddressKey(),
        }).status
      ).toBe("unresolved")

      expect(
        resolveShippingAddressId({ ok: true, cart: buildCart(null) }).status
      ).toBe("absent")
    })

    it.each([
      ["an empty-string id", buildCart({ id: "" })],
      ["a null id", buildCart({ id: null } as never)],
      ["no id key at all", buildCart({ postal_code: "03940" })],
    ])(
      "refuses to resolve an address row that arrived with %s",
      (_label, cart) => {
        // An address OBJECT is present, so a `cart_address` row EXISTS — but its
        // id did not arrive. Writing id-less here takes `assignReference` ->
        // `em.create` and destroys that existing row. This is the shape a
        // future `allowed` list would produce by stripping `shipping_address.id`
        // while keeping the relation, so it is the projection failure mode of
        // the dotted form specifically.
        //
        // These three cases previously resolved to `absent`. That was the
        // destructive direction, and it was pinned by a passing test.
        expect(resolveShippingAddressId({ ok: true, cart }).status).toBe(
          "unresolved"
        )
      }
    )
  })

  /**
   * The FK scalar is what stops the projection guard from failing the OTHER way.
   *
   * A guard that reads "relation key missing => unresolved" is fail-safe against
   * data loss but it is only sound if the backend really does materialise the
   * key for an empty relation. If it omits the key instead, then EVERY cart
   * that has never had an address resolves to `unresolved`, the first autosave
   * never fires, and the shipping prefetch silently stops working for every new
   * customer. That is a functional regression bought with a safety property.
   *
   * `shipping_address_id` removes the guess. It is a scalar column, so a
   * selected key is always present, and its VALUE is positive evidence either
   * way: `null` means there is genuinely no address row, a value means a row
   * exists. The resolver takes the best available evidence rather than betting
   * the whole decision on one key's presence.
   */
  describe("the FK scalar as the unambiguous witness", () => {
    it("reports absence from a null FK even when the relation key never arrived", () => {
      // The false-positive case. The FK says "no row", which is a fact about the
      // cart, so the missing relation key is not evidence of anything.
      expect(
        resolveShippingAddressId({ ok: true, cart: buildCartWithFk(null) })
      ).toEqual({ status: "absent" })
    })

    it("refuses to resolve when the FK says a row exists but the relation did not arrive", () => {
      // The dangerous case, now caught by positive evidence rather than by the
      // absence of a key: a `cart_address` row EXISTS and we do not have its id,
      // so an id-less write would destroy it.
      const resolution = resolveShippingAddressId({
        ok: true,
        cart: buildCartWithFk("caaddr_01JQZ8V3K7NB2XW9RTPY4C6HDM"),
      })

      expect(resolution.status).toBe("unresolved")
    })

    it("refuses to resolve when the FK says a row exists but the relation is empty", () => {
      // A contradiction between the two signals. The safe reading of a
      // contradiction is "we do not know".
      expect(
        resolveShippingAddressId({
          ok: true,
          cart: buildCartWithFk("caaddr_01JQZ8V3K7NB2XW9RTPY4C6HDM", null),
        }).status
      ).toBe("unresolved")
    })

    it("prefers the relation id over the FK when both arrived", () => {
      // The relation id is the value actually written into the payload, so when
      // both signals are present the relation wins. The FK is corroboration,
      // not the source.
      expect(
        resolveShippingAddressId({
          ok: true,
          cart: buildCartWithFk("caaddr_01", { id: "caaddr_01" }),
        })
      ).toEqual({ status: "resolved", id: "caaddr_01" })
    })

    it("resolves from the relation even if the FK key was filtered out", () => {
      // Symmetry with the case above: neither signal may become a single point
      // of failure. A future `allowed` list that strips the scalar but keeps
      // `shipping_address.id` must not break the resolver.
      expect(
        resolveShippingAddressId({ ok: true, cart: buildCart(FULL_ADDRESS) })
      ).toEqual({ status: "resolved", id: "caaddr_01" })
    })
  })

  describe("a read that did not succeed", () => {
    it("refuses to resolve when the read failed", () => {
      const read: FreshCartRead = { ok: false, error: "network down" }

      // NOT `absent`. This is the whole finding: a failed read used to arrive as
      // `null`, indistinguishable from "no address", and the caller then wrote a
      // partial address with no id — recreating the PII-shredding bug, silently,
      // with the step-6 tripwire disarmed because no id was sent.
      expect(resolveShippingAddressId(read)).toEqual({
        status: "unresolved",
        error: "network down",
      })
    })

    it("propagates the underlying error so the caller can surface it", () => {
      const read: FreshCartRead = { ok: false, error: "TimeoutError" }

      const resolution = resolveShippingAddressId(read)

      expect(resolution.status).toBe("unresolved")
      expect(resolution).toHaveProperty("error", "TimeoutError")
    })

    it.each([null, undefined])(
      "refuses to resolve an ok read that carried %j instead of a cart",
      (cart) => {
        // A 200 from `GET /store/carts/:id` always carries a cart. If it did
        // not, the response does not mean what the caller assumes, and the
        // cheap guess ("probably a new cart") is the destructive one.
        const resolution = resolveShippingAddressId({ ok: true, cart })

        expect(resolution.status).toBe("unresolved")
      }
    )
  })
})

/**
 * ---------------------------------------------------------------------------
 * PR2c — the CTA-time write (task 2c.12)
 * ---------------------------------------------------------------------------
 *
 * `syncCheckoutAddresses` writes BOTH addresses at once, and `design.md` D5 is
 * explicit that billing is exposed to the IDENTICAL `EntityAssigner`
 * replacement hazard as shipping: a nested `billing_address` with no `id` takes
 * `assignReference` -> `em.create` and repoints the cart FK at a brand-new row.
 *
 * The consequence differs from the autosave case and is worth stating, because
 * "the payload is complete so nothing is lost" is the reasoning that would let
 * this through review. A full write does not destroy field VALUES — it churns
 * the row ID. That is what made the deleted `setAddresses` self-staling and is
 * quoted verbatim in `persistCheckoutDraft`'s own docstring as the reason a
 * client-held id hint could not be trusted. Every submit minted a new
 * `cart_address` row, so any id captured earlier was already wrong. Carrying
 * the id keeps the row stable, which is what the autosave that runs after the
 * CTA aborts (total-change guard) depends on.
 */
describe("buildCheckoutAddressesPayload", () => {
  const CDMX: CheckoutDraftAddress = {
    first_name: "Ana",
    last_name: "Ruiz",
    company: "",
    address_1: "Av. Álvaro Obregón 100",
    address_2: "Roma Norte",
    postal_code: "06700",
    city: "Ciudad de México",
    province: "CDMX",
    country_code: "mx",
    phone: "5512345678",
  }

  const MONTERREY: CheckoutDraftAddress = {
    ...CDMX,
    address_1: "Av. Constitución 300",
    address_2: "Centro",
    postal_code: "64000",
    city: "Monterrey",
    province: "Nuevo León",
  }

  it("carries both address ids when the cart has both rows", () => {
    const payload = buildCheckoutAddressesPayload(
      { shipping: "caaddr_ship", billing: "caaddr_bill" },
      { shipping: CDMX, billing: MONTERREY }
    )

    expect(payload.shipping_address.id).toBe("caaddr_ship")
    expect(payload.billing_address.id).toBe("caaddr_bill")
    expect(payload.shipping_address.city).toBe("Ciudad de México")
    expect(payload.billing_address.city).toBe("Monterrey")
  })

  /**
   * The `absent` path, and the one moment an id-less write is legitimate: there
   * is no row, so `em.create` is correct and there is nothing to churn.
   *
   * The key must be OMITTED, never sent as `null` or `""`. A falsy id still
   * yields `pk === undefined` at `EntityAssigner.js:81`, so it buys exactly
   * nothing while reading like an intent that was never expressed.
   */
  it("omits the id key entirely when the cart has no billing row", () => {
    const payload = buildCheckoutAddressesPayload(
      { shipping: "caaddr_ship", billing: null },
      { shipping: CDMX, billing: MONTERREY }
    )

    expect("id" in payload.billing_address).toBe(false)
    expect(payload.shipping_address.id).toBe("caaddr_ship")
  })

  it("omits the shipping id key entirely when the cart has no shipping row", () => {
    const payload = buildCheckoutAddressesPayload(
      { shipping: null, billing: "caaddr_bill" },
      { shipping: CDMX, billing: MONTERREY }
    )

    expect("id" in payload.shipping_address).toBe(false)
    expect(payload.billing_address.id).toBe("caaddr_bill")
  })

  /**
   * Same `.strict()` zod constraint as the autosave path
   * (`common-validators/common.js:6-20`): an unexpected key fails the WHOLE
   * write with a 400. At CTA time that is an order that cannot be placed, so
   * the filter matters more here than it does on a skippable autosave.
   */
  it("sends only the persistable fields, dropping anything else", () => {
    const payload = buildCheckoutAddressesPayload(
      { shipping: null, billing: null },
      {
        shipping: {
          ...CDMX,
          id: "caaddr_forged",
          metadata: { spoofed: true },
        } as unknown as CheckoutDraftAddress,
        billing: CDMX,
      }
    )

    expect(Object.keys(payload.shipping_address).sort()).toEqual(
      [...EXPECTED_PERSISTABLE_FIELDS].sort()
    )
  })

  /**
   * The security invariant from D3, restated for the CTA write. A caller-held
   * id is an unauthenticated claim about which `cart_address` row to write, and
   * a WRONG id is worse than none: `sameTarget` fails on a mismatched pk and
   * execution falls through to the same destructive `assignReference` path,
   * now with a misleading id in the payload making the postmortem harder.
   */
  it("never lets an id in the address payload override the resolved id", () => {
    const payload = buildCheckoutAddressesPayload(
      { shipping: "caaddr_real", billing: "caaddr_real_bill" },
      {
        shipping: { ...CDMX, id: "caaddr_forged" } as unknown as CheckoutDraftAddress,
        billing: { ...CDMX, id: "caaddr_forged" } as unknown as CheckoutDraftAddress,
      }
    )

    expect(payload.shipping_address.id).toBe("caaddr_real")
    expect(payload.billing_address.id).toBe("caaddr_real_bill")
  })

  /**
   * `""` is a CLEAR, not an absence — `AddressPayload` declares every field
   * `nullish()`. Deleting a company name or an apartment number has to be
   * saveable, and collapsing `""` into "absent" is a data-loss bug pointing the
   * other way.
   */
  it("sends empty strings, because clearing a field is legitimate", () => {
    const payload = buildCheckoutAddressesPayload(
      { shipping: null, billing: null },
      {
        shipping: { ...CDMX, company: "", address_2: "" },
        billing: CDMX,
      }
    )

    expect(payload.shipping_address.company).toBe("")
    expect(payload.shipping_address.address_2).toBe("")
  })
})

/**
 * `billing_address_id` is part of Medusa's OWN default store cart projection
 * (`@medusajs/medusa/dist/api/store/carts/query-config.js:115`), one line below
 * the `shipping_address` block, so the two-signal resolution `resolveShipping
 * AddressId` performs is available for billing on exactly the same terms.
 *
 * The asymmetry that matters is preserved: absence must be POSITIVELY
 * ESTABLISHED. "The read failed" and "the cart has no billing row" are opposite
 * situations and a single `null` cannot tell them apart.
 */
describe("resolveBillingAddressId", () => {
  const cartWith = (fields: Record<string, unknown>): HttpTypes.StoreCart =>
    ({ id: "cart_01", ...fields } as unknown as HttpTypes.StoreCart)

  it("resolves the id off the relation when it is there", () => {
    const resolution = resolveBillingAddressId({
      ok: true,
      cart: cartWith({ billing_address: { id: "caaddr_bill" } }),
    })

    expect(resolution).toEqual({ status: "resolved", id: "caaddr_bill" })
  })

  it("reports absent when the FK scalar is positively null", () => {
    const resolution = resolveBillingAddressId({
      ok: true,
      cart: cartWith({ billing_address_id: null, billing_address: null }),
    })

    expect(resolution).toEqual({ status: "absent" })
  })

  /**
   * The dangerous shape: a row EXISTS and we do not have its key. Writing
   * id-less here churns the row, so it aborts.
   */
  it("refuses to resolve when a row exists but its id did not arrive", () => {
    const resolution = resolveBillingAddressId({
      ok: true,
      cart: cartWith({
        billing_address_id: "caaddr_bill",
        billing_address: { first_name: "Ana" },
      }),
    })

    expect(resolution.status).toBe("unresolved")
  })

  it("refuses to resolve a failed read", () => {
    const resolution = resolveBillingAddressId({
      ok: false,
      error: "TimeoutError",
    })

    expect(resolution.status).toBe("unresolved")
  })

  /**
   * A projection that stopped materialising the relation returns a clean 200, a
   * cart, and no relation. Resolving that to `absent` is exactly the silent
   * destructive path the shipping resolver was hardened against, so the billing
   * one must not reintroduce it.
   */
  it("refuses to resolve when neither the relation nor the FK arrived", () => {
    const resolution = resolveBillingAddressId({
      ok: true,
      cart: cartWith({}),
    })

    expect(resolution.status).toBe("unresolved")
  })
})

/**
 * ---------------------------------------------------------------------------
 * Triangulation — the mutants a shared implementation invites
 * ---------------------------------------------------------------------------
 *
 * `resolveBillingAddressId` and `resolveShippingAddressId` share a body
 * parameterised by the relation name. That removes the drift risk two copies
 * would have carried, and introduces exactly one new one in its place: a key
 * that is threaded WRONG, or not threaded at all, reads the other address's
 * row. Every test above passes under that bug whenever both rows happen to
 * exist, because both answers are then non-null and plausible.
 *
 * These cases separate the two addresses so the wrong key cannot look right.
 */
describe("the two address resolvers never read each other's row", () => {
  const cartWith = (fields: Record<string, unknown>): HttpTypes.StoreCart =>
    ({ id: "cart_01", ...fields } as unknown as HttpTypes.StoreCart)

  it("resolves billing as absent on a cart that HAS a shipping row", () => {
    const read: FreshCartRead = {
      ok: true,
      cart: cartWith({
        shipping_address_id: "caaddr_ship",
        shipping_address: { id: "caaddr_ship" },
        billing_address_id: null,
        billing_address: null,
      }),
    }

    // The bug this pins: reading `shipping_address` for the billing question
    // returns `caaddr_ship`, and the CTA write would then send the SHIPPING
    // row's id as the billing id. `sameTarget` fails on the mismatched pk,
    // execution falls to `assignReference` -> `em.create`, and the shipping
    // row is now referenced by a billing payload. Worse than no id.
    expect(resolveBillingAddressId(read)).toEqual({ status: "absent" })
    expect(resolveShippingAddressId(read)).toEqual({
      status: "resolved",
      id: "caaddr_ship",
    })
  })

  it("resolves shipping as absent on a cart that HAS a billing row", () => {
    const read: FreshCartRead = {
      ok: true,
      cart: cartWith({
        shipping_address_id: null,
        shipping_address: null,
        billing_address_id: "caaddr_bill",
        billing_address: { id: "caaddr_bill" },
      }),
    }

    expect(resolveShippingAddressId(read)).toEqual({ status: "absent" })
    expect(resolveBillingAddressId(read)).toEqual({
      status: "resolved",
      id: "caaddr_bill",
    })
  })

  it("gives the two rows their own distinct ids", () => {
    const read: FreshCartRead = {
      ok: true,
      cart: cartWith({
        shipping_address: { id: "caaddr_ship" },
        billing_address: { id: "caaddr_bill" },
      }),
    }

    expect(resolveShippingAddressId(read)).toEqual({
      status: "resolved",
      id: "caaddr_ship",
    })
    expect(resolveBillingAddressId(read)).toEqual({
      status: "resolved",
      id: "caaddr_bill",
    })
  })

  /**
   * EVIDENCE 3 for billing: no FK scalar in the response at all, relation key
   * present and nullish. `absent` is correct here and it must not be reached by
   * accident — the companion case one line below proves the same shape WITHOUT
   * the key aborts instead.
   */
  it("falls back to the relation key alone when no billing FK arrived", () => {
    expect(
      resolveBillingAddressId({
        ok: true,
        cart: cartWith({ billing_address: null }),
      })
    ).toEqual({ status: "absent" })

    expect(
      resolveBillingAddressId({
        ok: true,
        cart: cartWith({ shipping_address: null }),
      }).status
    ).toBe("unresolved")
  })

  it("aborts on a billing object that arrived without an id and without a FK", () => {
    const resolution = resolveBillingAddressId({
      ok: true,
      cart: cartWith({ billing_address: { first_name: "Ana" } }),
    })

    expect(resolution.status).toBe("unresolved")
    expect(resolution).toHaveProperty(
      "error",
      "Cart billing_address arrived without an id"
    )
  })

  /**
   * The error text has to name the address it is about. Both resolvers used to
   * be one function hard-coded to "shipping"; a log line that says "shipping"
   * while the billing write aborted sends the next person reading it to the
   * wrong half of the flow.
   */
  it("names the failing relation in the error, per address", () => {
    const bodilessRead: FreshCartRead = { ok: true, cart: {} as HttpTypes.StoreCart }

    expect(resolveShippingAddressId(bodilessRead)).toHaveProperty(
      "error",
      "Cart read returned neither shipping_address nor its id"
    )
    expect(resolveBillingAddressId(bodilessRead)).toHaveProperty(
      "error",
      "Cart read returned neither billing_address nor its id"
    )
  })
})

describe("buildCheckoutAddressesPayload — absent fields", () => {
  it("omits a field the caller did not supply, rather than sending undefined", () => {
    const payload = buildCheckoutAddressesPayload(
      { shipping: "caaddr_ship", billing: "caaddr_bill" },
      {
        shipping: { city: "Ciudad de México", phone: undefined },
        billing: { postal_code: "64000" },
      }
    )

    expect("phone" in payload.shipping_address).toBe(false)
    expect(Object.keys(payload.shipping_address).sort()).toEqual([
      "city",
      "id",
    ])
    expect(Object.keys(payload.billing_address).sort()).toEqual([
      "id",
      "postal_code",
    ])
  })

  /**
   * The two halves are built independently. A builder that computed one payload
   * and reused it for both would pass every test above that supplies identical
   * addresses — which is the `sameAsBilling` case, i.e. the common one.
   */
  it("does not let one address leak into the other", () => {
    const payload = buildCheckoutAddressesPayload(
      { shipping: "caaddr_ship", billing: "caaddr_bill" },
      {
        shipping: { city: "Ciudad de México" },
        billing: { city: "Monterrey" },
      }
    )

    expect(payload.shipping_address).toEqual({
      city: "Ciudad de México",
      id: "caaddr_ship",
    })
    expect(payload.billing_address).toEqual({
      city: "Monterrey",
      id: "caaddr_bill",
    })
  })
})

/**
 * The layer that ACTUALLY rejects a forged id, pinned on its own.
 *
 * Mutation M3 — moving the resolved id BEFORE the field spread in
 * `buildCheckoutAddressesPayload`, so a caller-supplied `id` would win —
 * survived a green suite. It is an EQUIVALENT mutant, and finding out why is
 * the point: `id` is absent from `PERSISTABLE_ADDRESS_FIELDS`, so
 * `pickPatchedFields` never emits the key and the two orderings produce
 * byte-identical payloads.
 *
 * So the spread order is defence in depth, not the guard. The guard is this
 * field set, and it was previously asserted only as a side effect of a test
 * about something else. Asserting it directly is what makes the builder's
 * docstring claim ("an `id` smuggled inside either address object cannot reach
 * the wire") a checked statement rather than a confident one — which is a
 * distinction this change has already had to learn three separate times.
 */
describe("the persistable field set is the guard against a forged id", () => {
  it("excludes id, so no caller-supplied primary key can ever be emitted", () => {
    expect(PERSISTABLE_ADDRESS_FIELDS).not.toContain("id")
  })

  it("drops id from both halves of the CTA payload", () => {
    const forged = { id: "caaddr_forged", city: "Monterrey" } as unknown as Partial<CheckoutDraftAddress>

    const payload = buildCheckoutAddressesPayload(
      { shipping: null, billing: null },
      { shipping: forged, billing: forged }
    )

    expect("id" in payload.shipping_address).toBe(false)
    expect("id" in payload.billing_address).toBe(false)
  })
})

import { HttpTypes } from "@medusajs/types"

/**
 * The shipping-address fields the checkout draft is allowed to persist, and the
 * SINGLE SOURCE OF TRUTH for that set.
 *
 * A runtime list is unavoidable: the type alone cannot filter a patch, because
 * callers reach this module through a server-action boundary where the payload
 * is plain JSON and TypeScript has already left the building. Keys matter —
 * `StoreCartUpsertAddress` is a `.strict()` zod object
 * (`@medusajs/medusa/dist/api/utils/common-validators/common.js:6-20`), so an
 * unexpected key is not a harmless extra; it fails the whole write with a 400
 * and the customer's data silently stops persisting.
 *
 * ## Why the type is derived from the array and not the other way round
 *
 * This used to be a hand-written `Pick<...>` type with the array pinned to it
 * by `satisfies readonly (keyof CheckoutDraftAddress)[]`. That proves every
 * ELEMENT is a valid key. It does NOT prove every key is an element. Adding a
 * field to the type and forgetting the array compiled cleanly, kept the suite
 * green, and quietly stopped persisting that field — a data-loss bug with no
 * failing signal anywhere.
 *
 * Deriving the type from the array makes that drift structurally impossible:
 * there is only one list to edit. `satisfies readonly (keyof
 * HttpTypes.StoreCartAddress)[]` still rejects a name Medusa does not know.
 * The remaining risk — the form starts collecting a field and nobody adds it
 * here — is not type-checkable, so `cart-address-payload.spec.ts` pins the set
 * against an independently written list instead.
 */
export const PERSISTABLE_ADDRESS_FIELDS = [
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
] as const satisfies readonly (keyof HttpTypes.StoreCartAddress)[]

/**
 * The shipping-address shape the checkout draft persists.
 *
 * `billing_address` is NOT part of this on purpose. Billing is written at CTA
 * time by a function that does not exist yet — it is planned for PR2c — and it
 * is exposed to the identical replacement hazard described below.
 */
export type CheckoutDraftAddress = Pick<
  HttpTypes.StoreCartAddress,
  (typeof PERSISTABLE_ADDRESS_FIELDS)[number]
>

export type PartialShippingAddressPayload = {
  shipping_address: Record<string, unknown>
}

/**
 * Picks the persistable keys out of a patch, dropping anything absent from it.
 *
 * `undefined` means "this field is not part of this patch" and is omitted.
 * `null` and `""` mean "the customer cleared this field" and ARE sent —
 * `AddressPayload` declares every field `nullish()`, so both are valid clears.
 * Collapsing them into "absent" would make deleting an apartment number
 * unsaveable, which is a data-loss bug pointing the other way.
 */
const pickPatchedFields = (
  patch: Partial<CheckoutDraftAddress>
): Record<string, unknown> => {
  const picked: Record<string, unknown> = {}

  for (const field of PERSISTABLE_ADDRESS_FIELDS) {
    const value = patch[field]
    if (value !== undefined) {
      picked[field] = value
    }
  }

  return picked
}

/**
 * Builds the `shipping_address` payload for a PARTIAL cart update, carrying the
 * existing address id whenever the cart has one.
 *
 * ## Why the id is load-bearing, not an optimisation
 *
 * Medusa resolves a nested `shipping_address` through MikroORM's
 * `EntityAssigner` with `updateByPrimaryKey: true`
 * (`@mikro-orm/core/utils/Configuration.js:64-70`, reached via
 * `updateCartWorkflow` -> `cart-module.js:174-209` ->
 * `mikro-orm-repository.js:221-231` `manager.assign(entity, update,
 * { mergeObjectProperties: true })`).
 *
 * `EntityAssigner.js:77-98` then decides between a merge and a replacement:
 *
 * - `:81` `pk = Utils.extractPK(value)` — with no `id` in the payload the pk is
 *   `undefined`;
 * - `:92` falls through to `assignReference`;
 * - `assignReference` (`:142-159`) sees a plain object with no `merge` flag and
 *   calls `em.create(prop.type, value)`.
 *
 * That is **a brand-new `cart_address` row with the cart FK repointed at it**.
 * Every field not present in the payload — `first_name`, `last_name`,
 * `company`, `phone`, `address_1`, `address_2` — is destroyed. Not stale: gone.
 *
 * With `id` present, `extractPK` succeeds, `sameTarget` holds, and `:89` takes
 * `EntityAssigner.assign(ref, value, options)` — a true field-level merge. The
 * id is supported API, not a workaround: `StoreCartUpsertAddress =
 * AddressPayload.merge(z.object({ id: z.string().optional() }))`
 * (`@medusajs/medusa/dist/api/store/carts/validators.js:38-40`).
 *
 * ## Why the id comes from the cart and never from the patch
 *
 * A *wrong* id is worse than no id. `sameTarget` fails on a mismatched pk and
 * execution falls through to the same destructive `assignReference` path, now
 * with a misleading id in the payload making the postmortem harder. The cart is
 * the only authority; `id` is therefore not in `PERSISTABLE_ADDRESS_FIELDS`.
 *
 * This is also why no caller may pass an id "hint". `persistCheckoutDraft` lives
 * in a `"use server"` module, which makes it a publicly reachable POST endpoint
 * with client-controlled arguments; an id taken from that boundary is an
 * unauthenticated claim about which `cart_address` row to write, and nothing
 * downstream checks that the row belongs to the cart. An earlier revision had
 * exactly that parameter and it was removed on security grounds. A hint that
 * has to be verified server-side is not an optimisation.
 *
 * ## The one legitimate id-less write
 *
 * A cart with no `shipping_address` has no id to send, and `em.create` is then
 * the correct behaviour — there is nothing to destroy. The key is omitted
 * ENTIRELY rather than sent as `null`/`""`: a falsy id still yields
 * `pk === undefined` at `:81`, so it buys nothing and reads like an intent that
 * was never expressed. This path is self-limiting; the next write picks the id
 * up off the returned cart.
 */
export function buildPartialShippingAddressPayload(
  cart: HttpTypes.StoreCart | null | undefined,
  patch: Partial<CheckoutDraftAddress>
): PartialShippingAddressPayload {
  const id = readShippingAddressId(cart)

  return {
    shipping_address: {
      ...(id ? { id } : {}),
      ...pickPatchedFields(patch),
    },
  }
}

/**
 * The one place that knows where a shipping-address id lives on a cart.
 *
 * Shared by the payload builder and by `resolveShippingAddressId` so the two
 * can never disagree about whether a cart "has" an id — a disagreement would
 * mean deciding it is safe to write and then writing without a key.
 *
 * Returns `null` for `null`, `undefined` and `""` alike: every falsy id yields
 * `pk === undefined` at `EntityAssigner.js:81`, so they are the same case.
 */
const readShippingAddressId = (
  cart: HttpTypes.StoreCart | null | undefined
): string | null => cart?.shipping_address?.id || null

/**
 * Reads the `shipping_address_id` FK SCALAR off a cart.
 *
 * Not in the published type — `common.d.ts:40` declares only the relation — so
 * the shape is probed rather than asserted, the same way `describeError` probes
 * `status`. It is nonetheless part of Medusa's OWN default store projection
 * (`@medusajs/medusa/dist/api/store/carts/query-config.js:102`), one line above
 * `shipping_address.id`, so this is the most-exercised field list in the
 * product, not a private detail.
 *
 * Three distinguishable outcomes, and the distinction is the whole point:
 * `"missing"` (the key never arrived), `null` (positively no address row), or
 * the id of the row that exists.
 */
const readShippingAddressFk = (
  cart: HttpTypes.StoreCart
): string | null | "missing" => {
  if (!("shipping_address_id" in cart)) {
    return "missing"
  }

  const fk = (cart as { shipping_address_id?: unknown }).shipping_address_id

  return typeof fk === "string" && fk.length > 0 ? fk : null
}

/**
 * The outcome of a fresh cart read, with failure kept distinct from absence.
 *
 * `retrieveCartFresh` used to end in `.catch(() => null)`, which collapsed two
 * opposite situations into one value:
 *
 * - the cart genuinely has no shipping address — writing without an id is
 *   CORRECT, `em.create` makes the row and there is nothing to destroy;
 * - the read failed — writing without an id is DESTRUCTIVE, it reinstates the
 *   exact PII-shredding bug this module exists to prevent.
 *
 * A single `null` cannot tell those apart, and the step-6 tripwire cannot cover
 * the gap because it only fires when an id WAS sent. In PR1a this read is the
 * ONLY id source, so the whole correctness of the fix rested on a call whose
 * every failure was invisible by construction.
 */
export type FreshCartRead =
  | { ok: true; cart: HttpTypes.StoreCart | null | undefined }
  | { ok: false; error: string }

export type ShippingAddressIdResolution =
  /** The cart has an address row; merge into it. */
  | { status: "resolved"; id: string }
  /** Positively established: the cart has no address row. Create one. */
  | { status: "absent" }
  /** Could not be established either way. Do not write. */
  | { status: "unresolved"; error: string }

/**
 * Decides whether a write may proceed, and with what key.
 *
 * The asymmetry is deliberate and is the whole point: "no id" is only safe when
 * absence was POSITIVELY ESTABLISHED by a successful read. Anything else —
 * transport error, timeout, HTTP failure, or a 200 that somehow carried no cart
 * — is `unresolved`, and the caller must abort rather than fall back to an
 * id-less write. A skipped autosave costs a shipping quote the customer can
 * retrigger by typing; a destroyed `cart_address` row costs data nobody can get
 * back. Those are not comparable failures, so they do not get the same handling.
 */
export const resolveShippingAddressId = (
  read: FreshCartRead
): ShippingAddressIdResolution => {
  if (!read.ok) {
    return { status: "unresolved", error: read.error }
  }

  // A successful `GET /store/carts/:id` always carries a cart. If it did not,
  // the response did not mean what this code assumes it means, and guessing
  // "probably a new cart with no address" is guessing in the destructive
  // direction.
  if (!read.cart) {
    return {
      status: "unresolved",
      error: "Cart read succeeded but returned no cart",
    }
  }

  // EVIDENCE 1 — the relation itself carries an id. Best possible answer, and
  // the id here is the exact value the payload will be keyed by, so it wins
  // whenever it is available. Checked BEFORE the FK so that a future `allowed`
  // list which strips the scalar but keeps `shipping_address.id` cannot break
  // the resolver: neither signal is permitted to become a single point of
  // failure, which is the entire lesson of this finding.
  const id = readShippingAddressId(read.cart)

  if (id) {
    return { status: "resolved", id }
  }

  // EVIDENCE 2 — the FK scalar, which is POSITIVE evidence in both directions.
  //
  // This is what makes the guard sound instead of merely cautious. Reading only
  // "the relation key is missing => unresolved" is fail-safe against data loss,
  // but it is sound only if the backend really does materialise the key for an
  // empty relation. If it omits it, every cart that never had an address
  // becomes `unresolved`, the first autosave never fires, and the shipping
  // prefetch silently stops working for every new customer — a real regression
  // bought with a safety property. `shipping_address_id` is a scalar column, so
  // a selected key is always present and its value answers the question
  // outright.
  const fk = readShippingAddressFk(read.cart)

  if (fk !== "missing") {
    // `null` FK is a FACT about the cart: there is no address row. `em.create`
    // is correct and there is nothing to destroy. A truthy FK with no id on the
    // relation is the dangerous shape — a row EXISTS and we do not have its key
    // — so it aborts.
    return fk === null
      ? { status: "absent" }
      : {
          status: "unresolved",
          error:
            "Cart has a shipping address row but the read did not return its id",
        }
  }

  // EVIDENCE 3 — no FK in the response, so fall back to what the relation key
  // alone can say.
  //
  // A missing KEY is not a fact about the cart, it is a fact about our own
  // request. `"shipping_address" in cart` is what separates the two: a cart
  // whose relation was requested and is empty carries the key with a nullish
  // value; a cart whose relation never arrived does not carry the key at all.
  //
  // Until this existed, a projection that stopped materialising the relation
  // produced a clean 200, a cart, and no relation — which resolved to `absent`,
  // let the id-less destructive write through, and left the step-6 tripwire
  // disarmed because no id was sent. Every layer silent, and the customer's
  // `first_name`, `last_name`, `company`, `phone`, `address_1` and `address_2`
  // gone.
  if (!("shipping_address" in read.cart)) {
    return {
      status: "unresolved",
      error: "Cart read returned neither shipping_address nor its id",
    }
  }

  const address = read.cart.shipping_address

  if (address === null || address === undefined) {
    return { status: "absent" }
  }

  // An address OBJECT arrived, so a row exists, but no id came with it and no
  // FK is available to corroborate. Writing id-less would take
  // `assignReference` -> `em.create` and destroy that row.
  return {
    status: "unresolved",
    error: "Cart shipping address arrived without an id",
  }
}

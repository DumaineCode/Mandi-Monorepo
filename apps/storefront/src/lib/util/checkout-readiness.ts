import type { HttpTypes } from "@medusajs/types"

import { isShippingSelectionStale } from "./shipping-quote"

/**
 * R8: what is stopping this order, in the order the customer will scan the page.
 *
 * Pure by contract (`design.md` D2): no `fetch`, no React, no server actions,
 * no `window`, no timers, no module-level mutable state. The `@medusajs/types`
 * import is type-only and erases at compile time.
 *
 * ## Why this predicate carries more weight than it looks
 *
 * Medusa's `completeCart` validates exactly two things: the cart has items, and
 * the payment collection holds at least one session in an acceptable status
 * (`explore §7`). No address check. No email check. No shipping-method check.
 * This function is therefore the ONLY thing standing between a customer and an
 * order Skydropx can never produce a label for — which is not a hypothetical,
 * it is the incident recorded on the `phone` case below.
 *
 * Loosening anything here is a product decision, not a refactor.
 */

/**
 * The provider-id prefix Openpay registers under
 * (`apps/backend/medusa-config.ts`; the literal is mirrored in
 * `apps/backend/src/lib/constants.ts` and asserted by a backend contract test).
 *
 * It lives here rather than being imported from `lib/constants.tsx` because
 * that module is a `.tsx` carrying JSX icon elements and component imports;
 * pulling it in would drag React into a module whose purity is the reason it
 * can be tested at all. `lib/constants.tsx` delegates to this predicate instead,
 * so there is still exactly one definition — the direction of the dependency is
 * simply inverted so the pure side stays pure.
 */
export const OPENPAY_PROVIDER_ID_PREFIX = "pp_openpay_"

export const isOpenpayProviderId = (providerId?: string | null): boolean =>
  typeof providerId === "string" &&
  providerId.startsWith(OPENPAY_PROVIDER_ID_PREFIX)

/**
 * The other two provider prefixes, here for the same reason Openpay's is
 * (task 2c.7): `place-order.ts` has to dispatch on the selected provider to
 * pick a payment tail, and it cannot import `lib/constants.tsx` without
 * dragging React into a module whose purity is what makes it testable.
 *
 * `lib/constants.tsx` delegates to both, so each prefix still has exactly one
 * definition. Two copies is how the tail that runs and the label that renders
 * would come to disagree about which provider the customer picked.
 */
export const MERCADOPAGO_PROVIDER_ID_PREFIX = "pp_mercadopago_"

export const isMercadopagoProviderId = (
  providerId?: string | null
): boolean =>
  typeof providerId === "string" &&
  providerId.startsWith(MERCADOPAGO_PROVIDER_ID_PREFIX)

/**
 * Medusa's built-in `manual` provider registers as `pp_system_default`.
 *
 * Matched by prefix rather than by equality to stay consistent with the other
 * two — Medusa composes provider ids as `pp_{provider}_{id}` and the system
 * default is the one that happens to have no suffix today.
 */
export const MANUAL_PROVIDER_ID_PREFIX = "pp_system_default"

export const isManualProviderId = (providerId?: string | null): boolean =>
  typeof providerId === "string" &&
  providerId.startsWith(MANUAL_PROVIDER_ID_PREFIX)

/**
 * Whether Openpay is actually purchasable on this cart, per the provider list
 * the backend returned for the cart's region (`listCartPaymentMethods`).
 *
 * ## Why this is not inlined at its one call site
 *
 * Its call site is `payment-wrapper/index.tsx`, and what it gates there is
 * whether Openpay's device-fingerprinting collector (`openpay-data.v1.min.js`,
 * `deviceData.setup()`) is loaded into the customer's browser. This project's
 * test harness is node-only (`src/**\/*.spec.ts`, no jsdom, no
 * @testing-library, Playwright an explicit non-goal), so a rule left inside
 * that component cannot be tested at all.
 *
 * A one-line `.some()` is exactly the kind of expression that looks too small
 * to be worth extracting right up until it is the only thing standing between a
 * visitor and a third-party fingerprint. Extracted so the rule is provable;
 * only the wiring is left to manual QA.
 *
 * Fails CLOSED on `null`/`undefined` — the shape `listCartPaymentMethods`
 * returns when the lookup FAILED. Not knowing whether Openpay is offered is not
 * a reason to collect device data on the chance that it is.
 *
 * Typed structurally rather than as `HttpTypes.StorePaymentProvider[]` so this
 * module keeps depending on the one field it actually reads.
 */
export const isOpenpayOffered = (
  paymentMethods?: readonly { id?: string | null }[] | null
): boolean =>
  Array.isArray(paymentMethods) &&
  paymentMethods.some((method) => isOpenpayProviderId(method?.id))

/**
 * The catalogue. Nine codes, ordered top-to-bottom by page position so the
 * itemized list matches the order the customer will read (R8 / S9).
 *
 * Adding, removing or reordering an entry is a spec change, not an
 * implementation detail — the order is asserted, and the CTA's explanation is
 * only useful if it points at the next thing to fix rather than a random one.
 */
export type MissingRequirementCode =
  | "cart_empty"
  | "email"
  | "phone"
  | "shipping_address"
  | "colonia"
  | "billing_address"
  | "shipping_method"
  | "shipping_method_stale"
  | "payment_method"
  | "card_details"

export type MissingRequirement = {
  code: MissingRequirementCode
  /** Customer-facing, Mexican Spanish, `tú` imperative. Never voseo. */
  message: string
}

/**
 * Customer-facing copy, in the storefront's own register: Mexican Spanish, `tú`
 * form (`"Completa los datos a mano."`, `shipping-address/index.tsx:481`;
 * `"Selecciona un método de pago"`, `payment-button/index.tsx:61`).
 *
 * `proposal.md` R8 and `design.md` §2 write these in voseo — `"Elegí un método
 * de envío"`, `"Volvé a elegir…"` — which is Rioplatense and matches neither
 * this store nor its customers. The spec records the correction; a test enforces
 * it, because a voseo string reads as perfectly good Spanish in review and only
 * the customer notices it is the wrong country's.
 */
export const MISSING_REQUIREMENT_MESSAGES: Record<
  MissingRequirementCode,
  string
> = {
  cart_empty: "Tu carrito está vacío.",
  email: "Falta tu correo electrónico.",
  phone: "Falta tu teléfono.",
  shipping_address: "Completa tu dirección de envío.",
  colonia: "Elige tu colonia.",
  billing_address: "Falta tu dirección de facturación.",
  shipping_method: "Elige un método de envío.",
  shipping_method_stale:
    "Vuelve a elegir el método de envío: cambiaste el código postal.",
  payment_method: "Elige un método de pago.",
  card_details: "Completa los datos de tu tarjeta.",
}

/**
 * The address fields whose absence reports `shipping_address`.
 *
 * `phone` is deliberately NOT here — it gets its own code. See the incident
 * docstring on the phone rule below. `address_2` (the colonia) is NOT here
 * either, and for the same reason: it gets its own `colonia` code (S3) so the
 * customer is told which single control to fix. Adding it here would fold it
 * into the generic "complete your address" message.
 */
const REQUIRED_ADDRESS_FIELDS = [
  "first_name",
  "last_name",
  "address_1",
  "postal_code",
  "city",
  "province",
  "country_code",
] as const

export type ReadinessAddressSnapshot = {
  first_name?: string | null
  last_name?: string | null
  address_1?: string | null
  /** The colonia. Its absence reports the `colonia` code (S3), not `shipping_address`. */
  address_2?: string | null
  postal_code?: string | null
  city?: string | null
  province?: string | null
  country_code?: string | null
  phone?: string | null
}

/**
 * A plain POJO on purpose: the predicate must be testable from fixtures without
 * constructing a `StoreCart`, and must not drift when Medusa's types move.
 * `toReadinessInput` is the one adapter, and it is spec'd in the same file as
 * the rule it feeds so the mapping cannot rot separately.
 */
export type OrderReadinessInput = {
  itemCount: number
  email?: string | null
  shippingAddress?: ReadinessAddressSnapshot | null
  /**
   * Whether the customer has told us what to write into `billing_address`.
   *
   * A CLIENT fact, not a cart fact, and the distinction is the whole point.
   * See {@link toReadinessInput} for the deadlock that made it one.
   */
  hasBillingAddress: boolean
  /** Whether `cart.shipping_methods` carries a row. Server-side fact. */
  hasShippingMethod: boolean
  /**
   * Whether the CLIENT currently holds a shipping selection — i.e. whether a radio
   * is checked on screen.
   *
   * Separate from {@link hasShippingMethod} because per F1 the two can disagree
   * and routinely do: there is no store API to remove a shipping method, so the
   * cart row survives every invalidation while the client selection is cleared.
   * The cart row alone answers "has the backend been told about a method"; only
   * this answers "has the customer chosen one".
   */
  hasSelectedShippingOption: boolean
  /** Quote signature in force when the customer picked the shipping method. */
  selectionSignature: string | null
  /** Quote signature of the address as it stands right now. */
  currentQuoteSignature: string | null
  selectedPaymentProviderId?: string | null
  paymentDetailsComplete: boolean
  paidByGiftCard: boolean
}

/**
 * A string field is absent when it is `null`, `undefined`, or trims to `""`.
 *
 * Whitespace counts as absent consistently with the backend guards and with the
 * predicate this replaces. `" "` in a phone field is not a phone number; a
 * customer who sees the CTA unblock on a space has been told a lie by the UI.
 */
const isAbsent = (value: string | null | undefined): boolean =>
  typeof value !== "string" || value.trim().length === 0

/**
 * Whether the customer has typed a usable SEPARATE billing address.
 *
 * Same field set as {@link REQUIRED_ADDRESS_FIELDS}, and the two exclusions are
 * deliberate rather than inherited. `phone` and `address_2` are required on the
 * SHIPPING address for fulfilment reasons — Skydropx rejects a quote with no
 * `area_level3` and its origin/destination pre-flight needs a phone. Nothing is
 * ever shipped to the billing address, and `buildOpenpaySessionData` already
 * emits `phone_number: undefined` without complaint. Requiring them here would
 * block a checkout over a field no downstream system asks for.
 *
 * Completeness rather than mere presence, because an all-empty billing form is
 * exactly what the customer is looking at the moment they uncheck the "same as
 * billing" box. Waving that through hands Openpay an empty `customer` object,
 * which it refuses with API error 1001 — and the customer reads that as a
 * decline on a card that is perfectly good.
 */
export function billingDraftIsComplete(
  draft: ReadinessAddressSnapshot | null | undefined
): boolean {
  return (
    !!draft && REQUIRED_ADDRESS_FIELDS.every((field) => !isAbsent(draft[field]))
  )
}

/**
 * Returns the ordered list of everything preventing order placement.
 *
 * Side-effect free and deterministic, including list order: the same input
 * always produces the same output, so the itemized list under the CTA cannot
 * flicker or reorder between renders.
 */
export function getMissingOrderRequirements(
  input: OrderReadinessInput
): MissingRequirement[] {
  const codes: MissingRequirementCode[] = []

  /**
   * `cart_empty` short-circuits everything else. Listing "falta tu teléfono" to
   * a customer whose cart is empty is noise dressed up as help, and it buries
   * the one thing they actually have to do.
   */
  if (input.itemCount <= 0) {
    return [toRequirement("cart_empty")]
  }

  if (isAbsent(input.email)) {
    codes.push("email")
  }

  /**
   * ## The phone rule, and the incident it records
   *
   * Carried over verbatim from `lib/util/checkout-step.ts:5-27`, where it was
   * the docstring of `hasCompleteShippingContact`. `design.md` D8 requires it to
   * survive the move unchanged; it is the only record of the failure, and the
   * failure is the reason the rule exists.
   *
   * > `phone` is part of this predicate, not decoration. The address `<form>`
   * > (and with it the required phone input) renders ONLY while
   * > `step === "address"` (`checkout/components/addresses/index.tsx`). The
   * > previous predicate looked at `address_1` + `email` only, so any cart that
   * > already had those jumped straight to `delivery` and the required phone
   * > input was never rendered, never validated, never submitted.
   * >
   * > That is exactly the cohort that caused the incident this fix exists for:
   * > every pre-existing cart, every address applied through `AddressSelect`
   * > (which copies `address?.phone || ""` from a saved address that may have
   * > none), and every cart whose address came from the store API. They could
   * > still place an order with `phone: ""`, and the Skydropx origin/destination
   * > pre-flight would then block the label AFTER the sale.
   * >
   * > Blank-vs-present only, deliberately: FORMAT is the input's `pattern` job
   * > (`lib/util/phone.ts`) and the backend normalizes before the wire.
   * > Re-checking the format here would risk trapping a customer in a step they
   * > cannot leave — the same over-strictness that made the phone `pattern` a
   * > revenue stopper.
   * >
   * > Whitespace counts as absent, consistently with the backend guards.
   *
   * The step-based mechanism in that text is gone with `?step=`, but the cohort
   * is not: a saved address with no phone still copies through, and the CTA is
   * now the only gate. It gets its OWN code rather than folding into
   * `shipping_address` so the customer is told which single field to fix,
   * instead of being sent to re-read an address that is already correct.
   */
  if (isAbsent(input.shippingAddress?.phone)) {
    codes.push("phone")
  }

  const address = input.shippingAddress

  if (
    !address ||
    REQUIRED_ADDRESS_FIELDS.some((field) => isAbsent(address[field]))
  ) {
    codes.push("shipping_address")
  }

  /**
   * ## The colonia rule (S3, position 3.5)
   *
   * Skydropx PRO maps `address_2` to `area_level3` and rejects a quote without
   * it (`422 {"address_to":{"area_level3":["no puede estar en blanco"]}}`), so a
   * cart reaching the CTA with no colonia produces an order that can never be
   * labelled — the same after-the-sale failure the `phone` rule records. It gets
   * its OWN code rather than folding into `shipping_address` so the customer is
   * told which single control to fix, and it sits immediately after the generic
   * address item because the colonia control lives inside the address block: a
   * customer missing the whole address should read "complete your address"
   * before "pick your colonia".
   *
   * This is intentionally STRICTER than before S3 — a mid-checkout cart with no
   * colonia is now blocked. Absence is trim-based, consistently with every other
   * field.
   */
  if (isAbsent(address?.address_2)) {
    codes.push("colonia")
  }

  if (!input.hasBillingAddress) {
    codes.push("billing_address")
  }

  if (!input.hasShippingMethod) {
    codes.push("shipping_method")
  } else if (
    !input.hasSelectedShippingOption ||
    isShippingSelectionStale(
      input.selectionSignature,
      input.currentQuoteSignature
    )
  ) {
    /**
     * Only reachable when a cart row EXISTS: `shipping_method` already covers
     * "nothing chosen at all", and emitting both would tell the customer to
     * re-choose something they never chose.
     *
     * ## Why the client selection is a condition and not just the signature
     *
     * The signature comparison alone has a hole it cannot see by construction,
     * because a signature can come back to where it started while a selection
     * cannot. Postal code A -> B -> A: the reducer clears
     * `selectedShippingOptionId` on the way out and never restores it, and it
     * deliberately keeps `selectionSignature` at A. On the way back
     * `isShippingSelectionStale(A, A)` is `false` again, `hasShippingMethod` is
     * still `true` because F1 makes the row unremovable, and NOTHING was emitted:
     * no radio checked, CTA enabled, summary presenting the twice-re-priced total
     * as final. The customer could place an order for a shipping method the page
     * showed as unselected.
     *
     * The alternative fix — clearing `selectionSignature` alongside the option id
     * — is strictly worse. `isShippingSelectionStale(null, …)` is documented to
     * answer `false`, so the ORDINARY A -> B case would unblock the CTA
     * immediately, which is the precise failure this whole mechanism exists to
     * prevent. Gating on the selection is also the truer statement of what the
     * module promises: the CTA and the summary must not disagree with the radio
     * group, and the radio group renders from `selectedShippingOptionId`, so that
     * is the thing the CTA has to read.
     *
     * Both conditions produce THIS code rather than `shipping_method` on purpose.
     * `selectShippingIsProvisional` is defined as the presence of
     * `shipping_method_stale`, so routing the cleared-selection case to the
     * generic code would leave a blocked CTA beside a total presented as FINAL.
     * The message is accurate either way: the only thing that clears the client
     * selection is a signature change, which is a destination change.
     *
     * This is the F1/F2 mitigation. Per F1 there is no store API to remove a
     * shipping method, so the spec's original outcome — `cart.shipping_methods`
     * is empty — cannot be produced from the storefront at all. Per F2 the
     * backend instead silently re-prices the surviving method to the new
     * destination. The block therefore lives here, client-side, and the
     * customer re-picks. The product guarantee decision 1 asked for is intact;
     * only the mechanism differs.
     *
     * ## The seam PR1b opened, closed in PR2b
     *
     * This code shipped with no producer and no consumer, deliberately
     * (`design.md` §13). Both now exist: PR2a's reducer moves
     * `selectionSignature`, and PR2b's Envío section and summary render the
     * result. The rule shipped ahead of them because the catalogue has to be
     * complete on arrival — shipping an under-strict
     * `getMissingOrderRequirements` and amending it later means touching the
     * strictness floor twice, and this predicate is the only guard against orders
     * Skydropx can never label.
     *
     * @see `modules/checkout/state/checkout-reducer.ts` — PR2a. Clears
     * `selectedShippingOptionId` in the same transition that recomputes
     * `quoteSignature`, and is what makes `selectionSignature` move.
     * @see `modules/checkout/components/shipping-section/index.tsx` — PR2b.
     * Renders the cleared radio group.
     * @see `modules/checkout/state/checkout-reducer.ts` —
     * `selectShippingIsProvisional`, defined AS the presence of this code so the
     * summary and the CTA cannot disagree about whether the order is ready.
     * @see `modules/checkout/templates/checkout-summary/index.tsx` — PR2b.
     * Renders the provisional-total state this code puts the summary into.
     */
    codes.push("shipping_method_stale")
  }

  /**
   * The gift-card bypass, carried from `payment/index.tsx:83-88` and
   * `review/index.tsx:14-21`, where `paidByGiftcard` already short-circuits
   * `paymentReady`.
   *
   * ## Two things about it that a reader must not have to discover the hard way
   *
   * 1. It is unreachable in this deployment. `gift_cards` is not on Medusa v2's
   *    `StoreCart` — the existing call sites cast through
   *    `Record<string, unknown>` precisely because the field is not in the type
   *    — so `toReadinessInput` can only ever set this to `false` here. The
   *    branch is inherited-starter surface, kept because `design.md` D2 lists
   *    the input field.
   * 2. If it ever DID become reachable, it would need verifying against
   *    `completeCart`, which per `explore §7` requires the payment collection to
   *    hold at least one session in an acceptable status. A CTA enabled by this
   *    bypass on a cart with no session would fail at placement with no way for
   *    the customer to diagnose it. Enabling gift cards is therefore a change
   *    that has to re-open this branch, not one that can assume it.
   *
   * Recorded as a risk on PR1b rather than silently resolved either way.
   */
  if (!input.paidByGiftCard) {
    if (isAbsent(input.selectedPaymentProviderId)) {
      codes.push("payment_method")
    } else if (
      isOpenpayProviderId(input.selectedPaymentProviderId) &&
      !input.paymentDetailsComplete
    ) {
      /**
       * Openpay-only. Mercado Pago collects card data off-site, and a predicate
       * that policed card completeness for it would leave the CTA permanently
       * disabled for every MP customer.
       */
      codes.push("card_details")
    }
  }

  return codes.map(toRequirement)
}

const toRequirement = (code: MissingRequirementCode): MissingRequirement => ({
  code,
  message: MISSING_REQUIREMENT_MESSAGES[code],
})

/**
 * Defined AS the emptiness of the missing list, never as a second derivation of
 * the same conditions.
 *
 * A copy is how the button and its explanation drift apart, and the drift is
 * always discovered by a customer: an enabled CTA that fails on click, or a
 * disabled CTA whose list is empty and which therefore says nothing at all.
 * If this function ever grows a condition of its own, that is the bug.
 */
export function canPlaceOrder(input: OrderReadinessInput): boolean {
  return getMissingOrderRequirements(input).length === 0
}

/**
 * The client-side half of {@link toReadinessInput}'s input.
 *
 * Named rather than inlined so the two halves are visibly two halves: what the
 * SERVER has recorded on the cart, and what the CUSTOMER currently holds on
 * screen. Every field here is reducer state.
 */
export type ReadinessClientInput = {
  selectedShippingOptionId: string | null
  selectionSignature: string | null
  currentQuoteSignature: string | null
  selectedPaymentProviderId: string | null
  paymentDetailsComplete: boolean
  /** The "misma dirección de facturación" checkbox. */
  sameAsBilling: boolean
  /** The separate billing form, as typed. Only read when `sameAsBilling` is false. */
  billingDraft: ReadinessAddressSnapshot | null
}

/**
 * The one adapter from a Medusa cart to the readiness input.
 *
 * Kept in this file, per `design.md` D2, so the mapping is spec'd next to the
 * rule it feeds: a predicate that is provably correct against a POJO nobody
 * builds correctly is not correct in production.
 *
 * Tolerates `null`/`undefined` because it is the path the empty-cart case takes
 * — a checkout rendered before the cart resolves must report `Tu carrito está
 * vacío.` rather than throw.
 */
export function toReadinessInput(
  cart: HttpTypes.StoreCart | null | undefined,
  client: ReadinessClientInput
): OrderReadinessInput {
  return {
    itemCount: cart?.items?.length ?? 0,
    email: cart?.email,
    shippingAddress: cart?.shipping_address ?? null,
    /**
     * ## A CLIENT fact, and it has to be — Amendment A5
     *
     * This read `Boolean(cart?.billing_address)` and it DEADLOCKED the
     * checkout. The only production writer of `cart.billing_address` left in
     * the storefront is `syncCheckoutAddresses`, which runs at `design.md` D5
     * step 2 — behind this gate. `persistCheckoutDraft` never writes billing by
     * design (D3), and `setAddresses`, the historical writer, was deleted by
     * PR2c. So a cart that had never had a billing address could never acquire
     * one: `Falta tu dirección de facturación.`, forever. That is the same
     * shape as the `?step=payment` deadlock this change exists to remove.
     *
     * The split is the one this file already makes twelve lines below for
     * `hasShippingMethod` vs `hasSelectedShippingOption`, for the identical F1
     * reason: the gate's question is not "has the backend been told" but "has
     * the customer decided".
     *
     * `sameAsBilling` short-circuits WITHOUT re-checking the address, because
     * the shipping address is already checked field by field by
     * `shipping_address`, `colonia` and `phone`. A second copy of that rule
     * here is the exact defect class this change is about.
     *
     * What is NOT weakened: the billing ROW still has to exist on the cart
     * before Openpay is asked for a charge. D5 makes step 2 before step 4
     * mandatory for precisely that reason, and `place-order-flow.spec.ts`
     * asserts the ordering (mutations M11/M16). The row must exist before the
     * charge; it no longer has to exist before the customer may try.
     */
    hasBillingAddress:
      client.sameAsBilling || billingDraftIsComplete(client.billingDraft),
    /**
     * `?? 0` and not `!== 0`. The predicate this replaces used
     * `shipping_methods?.length === 0`, which is FALSE for an absent field, so a
     * cart fetched without the relation skipped the delivery step entirely. A
     * gate must fail closed: absence blocks.
     */
    hasShippingMethod: (cart?.shipping_methods?.length ?? 0) > 0,
    hasSelectedShippingOption: client.selectedShippingOptionId !== null,
    selectionSignature: client.selectionSignature,
    currentQuoteSignature: client.currentQuoteSignature,
    selectedPaymentProviderId: client.selectedPaymentProviderId,
    paymentDetailsComplete: client.paymentDetailsComplete,
    paidByGiftCard: readPaidByGiftCard(cart),
  }
}

/**
 * Probed rather than typed: `gift_cards` is not on Medusa v2's `StoreCart`, the
 * same way `shipping_address_id` is not (see `cart-address-payload.ts`).
 *
 * BOTH conditions are required — a gift card that does not cover the whole
 * total leaves a balance that still needs a payment method. Matches
 * `payment/index.tsx:83-88` exactly.
 */
const readPaidByGiftCard = (
  cart: HttpTypes.StoreCart | null | undefined
): boolean => {
  if (!cart) {
    return false
  }

  const giftCards = (cart as { gift_cards?: unknown }).gift_cards

  return Array.isArray(giftCards) && giftCards.length > 0 && cart.total === 0
}

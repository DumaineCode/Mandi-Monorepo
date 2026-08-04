# SDD Explore — checkout-single-page-flow

Read-only exploration. Facts + evidence only, no solution design.
Repo: mandi-oficial. All paths relative to repo root.

> Mirrored in Engram under topic `sdd/checkout-single-page-flow/explore` (observation 218).

## 0. Tooling caveat (affects trust in this artifact)

- `.codegraph/` contains only `.gitignore` (no index) and the exploring context had
  **no shell tool**, so `codegraph init` could not be run. Fallback: Read/Grep only.
- Medusa internals were traced through the real installed packages via the pnpm
  hidden hoist store: `node_modules/.pnpm/node_modules/@medusajs/...` and
  `apps/backend/node_modules/@medusajs/medusa/dist/...`. Grep does not follow
  symlinks during traversal, so all package paths below are explicit.

## 1. Current architecture (verified)

### Server round-trip chain
- `apps/storefront/src/app/[countryCode]/(checkout)/checkout/page.tsx:15,21,22`
  RSC awaits `retrieveCart()` -> `retrieveCustomer()` -> `getProviderConfig()` sequentially.
- `apps/storefront/src/modules/checkout/templates/checkout-form/index.tsx:18,19`
  then awaits `listCartShippingMethods(cart.id)` -> `listCartPaymentMethods(region.id)` sequentially.
- CONFIRMED: every `router.push("?step=...")` re-runs the whole RSC chain.

### `?step=` readers (complete blast radius)
- `modules/checkout/components/addresses/index.tsx:32` (`=== "address"`)
- `modules/checkout/components/shipping/index.tsx:107` (`=== "delivery"`)
- `modules/checkout/components/payment/index.tsx:68` (`=== "payment"`)
- `modules/checkout/components/review/index.tsx:12` (`=== "review"`)

### `?step=` writers
- `modules/cart/templates/summary.tsx:14,29` — `getCheckoutStep(cart)` -> `/checkout?step=<step>`
- `modules/checkout/components/addresses/index.tsx:41` (`?step=address`), `:68` (`?step=delivery`)
- `modules/checkout/components/shipping/index.tsx:164` (`?step=delivery`), `:168` (`?step=payment`)
- `modules/checkout/components/payment/index.tsx:136,155,172` — `createQueryString("step","review")`
- **Not in the original brief** (newly found, must be handled):
  - `app/[countryCode]/(checkout)/payment/openpay/return/route.ts:22`
    -> `/{cc}/checkout?step=review&error=payment_failed`
  - `app/[countryCode]/(checkout)/payment/mercadopago/failure/route.ts:19`
    -> `/{cc}/checkout?step=payment&error=payment_failed`
  - Latent bug: **no component reads `searchParams.get("error")` anywhere**, so
    `error=payment_failed` is silently dropped today.

### `checkout-step.ts` importers
- `lib/util/checkout-step.ts` — `hasCompleteShippingContact` (address_1 + email + phone,
  trim-based), `getCheckoutStep` (address -> delivery -> payment).
- Consumers: `modules/cart/templates/summary.tsx:6` ONLY.
- Test: `lib/util/checkout-step.spec.ts` (2 describes, ~14 cases).

## 2. Q1 — Payment session preconditions (HIGHEST RISK) — ANSWERED

`sdk.store.payment.initiatePaymentSession(cart, body)` is a 2-call SDK helper
(`apps/storefront/node_modules/@medusajs/js-sdk/dist/store/index.js:904-921`):
1. if `cart.payment_collection` is absent -> `POST /store/payment-collections { cart_id }`
2. `POST /store/payment-collections/:id/payment-sessions { provider_id, data }`

### (a) Can a session be created with NO shipping method and NO address? YES.
- `apps/backend/node_modules/@medusajs/medusa/dist/api/store/payment-collections/route.js`
  -> `createPaymentCollectionForCartWorkflow`.
- `.pnpm/node_modules/@medusajs/core-flows/dist/cart/workflows/create-payment-collection-for-cart.js`
  validates exactly two things:
  - `validateCartStep` (`.../cart/steps/validate-cart.js:24-29`) -> only rejects `cart.completed_at`.
  - `validateExistingPaymentCollectionStep` (same file, L31-35) -> rejects a cart that
    already has a payment collection.
  - Amount is captured as `cart.raw_total` at creation time (`transform` block).
  - **No address check. No shipping-method check.**
- `.../payment-collection/workflows/create-payment-session.js` reads only
  `payment_collection.{id,amount,currency_code,payment_sessions}` and the optional
  customer. Session `amount` = `paymentCollection.amount`. **No cart validation at all.**

=> The Payment section CAN be genuinely interactive from the start, not just visually open.

### (b) What happens to the amount when shipping is added later? The session is DELETED.
- `.../cart/workflows/add-shipping-method-to-cart.js:129` -> `refreshCartItemsWorkflow.runAsStep`
- `.../cart/workflows/refresh-cart-items.js:184` -> `refreshPaymentCollectionForCartWorkflow.runAsStep`
- `.../cart/workflows/refresh-payment-collection.js` `when("should-update-payment-collection")`:
  - `valueIsEqual = MathBN.eq(payment_collection.raw_amount ?? -1, cart.raw_total)`
  - if NOT equal -> `parallelize(deletePaymentSessionsWorkflow(all session ids),
    updatePaymentCollectionStep({ amount: cart.raw_total }))`

=> The amount is **never stale**. Medusa **destroys every payment session** whenever the
cart total changes (shipping method chosen/changed, promo applied, line item edited).
The payment collection survives; the sessions do not.

**Consequence for the target design:** a session initiated before shipping is chosen is
guaranteed to be wiped when the shipping method lands. Any "payment ready" state must be
derived from live cart state, not from a one-shot init. Note the existing
`initiatedDefaultRef` one-shot guard in `payment/index.tsx:186-205` would silently fail
to re-initiate after such a wipe.

### (c) Provider amount handling
- Openpay `apps/backend/src/modules/openpay-payment/service.ts:241-267` — `initiatePayment`
  requires `data.session_id`, stores `amount: toAmountNumber(input.amount)`. No money moves
  at init. `updatePayment` (`:270-281`) just restamps amount/currency.
- Mercado Pago `apps/backend/src/modules/mercadopago-payment/service.ts:184-218` —
  `initiatePayment` requires `data.session_id` AND `data.back_urls_base`, and **calls
  MP to create a Checkout Pro preference immediately**, returning `init_point`.
  `updatePayment` (`:226-259`) recreates the preference only when the amount changed.
  => Initiating MP early is a real outbound API call per init; because sessions get
  deleted on total change, an early MP init is wasted work and produces a dead `init_point`.

## 3. Q2 — Partial `cart.update` address semantics — REPLACE, NOT MERGE (decisive)

Chain, all verified in installed source:
1. `apps/backend/node_modules/@medusajs/medusa/dist/api/store/carts/[id]/route.js` -> `updateCartWorkflow`
2. `.pnpm/node_modules/@medusajs/core-flows/dist/cart/workflows/update-cart.js:141-151`
   sets `data_.shipping_address = { ...shippingAddress, country_code }` — **no `id` injected**.
3. `.pnpm/node_modules/@medusajs/cart/dist/services/cart-module.js:174-209` -> `cartService_.update`
4. `.pnpm/node_modules/@medusajs/utils/dist/dal/mikro-orm/mikro-orm-repository.js:221-231`
   -> `manager.assign(entity, update, { mergeObjectProperties: true })`
5. `.pnpm/node_modules/@mikro-orm/core/utils/Configuration.js:64-70` defaults:
   `updateNestedEntities: true`, **`updateByPrimaryKey: true`**
6. `.pnpm/node_modules/@mikro-orm/core/entity/EntityAssigner.js:77-98`:
   - `shipping_address` is ONE_TO_ONE/MANY_TO_ONE (model `hasOne(..., { foreignKey: true })`,
     `@medusajs/cart/dist/models/cart.js:60-65`; FK `cart.shipping_address_id`,
     migration `Migration20240222170223.js:15,97`)
   - L81 `updateByPrimaryKey` true -> `pk = Utils.extractPK(value)`; payload has no `id`
     -> pk undefined -> L92 `return assignReference(...)`
   - `assignReference` (L142-159): plain object, no `merge` -> `em.create(prop.type, value)`
     => **a brand-new `cart_address` row is created and the cart FK is repointed.**

=> `sdk.store.cart.update(id, { shipping_address: { postal_code, city, province, country_code } })`
**WIPES `first_name`, `last_name`, `address_1`, `address_2`, `company`, `phone`.**

### Escape hatch (verified, and it is supported API)
`apps/backend/node_modules/@medusajs/medusa/dist/api/store/carts/validators.js:38-40`
```
const StoreCartUpsertAddress = AddressPayload.merge(z.object({ id: z.string().optional() }))
```
and `UpdateCart.shipping_address = z.union([StoreCartUpsertAddress, z.string()])` (L46).
With `id` present, `extractPK` succeeds, `sameTarget` holds, and EntityAssigner.js:89 takes
`EntityAssigner.assign(ref, value, options)` = **true field-level merge**.

### Existing latent bug this exposes
`apps/storefront/src/lib/data/cart.ts:109-155` `persistShippingForCalc` sends exactly the
6 partial fields with **no `id`**. Its docstring ("A partial shipping_address update is
safe...") is correct only about `billing_address` being untouched; it is **wrong about the
shipping address itself**. Today the damage is masked because the prefetch gate requires
`address_1 && address_2` and `setAddresses` (`cart.ts:520-560`) re-sends the full payload
on submit — but `first_name`, `last_name`, `company` and `phone` ARE destroyed on every
prefetch in the meantime. In a "quote from CP alone, no step gating" design this becomes
live, user-visible data loss.

## 4. Q3 — Minimum viable Skydropx quote payload — CONFIRMED

`apps/backend/src/modules/skydropx-fulfillment/service.ts:774-840` `calculatePrice`:
- destination via `toAddress(ctx.shipping_address)` (`service.ts:431-456`): requires
  `country_code`, `postal_code`, `normalizeState(province)`, `city`. `area_level3`
  (colonia, from `address_2` or `metadata.colonia`) is **best-effort/optional**.
  Missing any of the four -> `undefined` -> `MedusaError INVALID_DATA`
  "Skydropx quote requires a destination country, postal code, state, and city."
- **No `address_1`, no name, no phone, no email** on the quote path
  (contrast `toShipAddress`, `service.ts:469-486`, used only for `POST /shipments`).
- origin: `toAddress(this.withOriginZip_(ctx.from_location?.address, config))` — already configured.
- parcel: `buildParcel(toParcelItems(ctx.items ?? []))`.
  - `toParcelItems` (`service.ts:667-677`) reads `item.variant.{weight,length,width,height}`.
  - `buildParcel` (`parcel.ts:49-79`) throws `MissingDimensionsError` if **any** item has a
    missing/non-finite/<=0 weight or dimension, **or if `items.length === 0`**.
  - `service.ts:790-796` converts it to `MedusaError INVALID_DATA` **before any API call**.

=> The 4-field CP-derived address is sufficient. Confirms the premise of the change.
=> Hard dependency: every cart variant must carry weight+L+W+H, else the quote fails
   deterministically regardless of address completeness.

Route: `POST /store/shipping-options/:id/calculate` ->
`apps/backend/node_modules/@medusajs/medusa/dist/api/store/shipping-options/[id]/calculate/route.js`
-> `calculateShippingOptionsPricesWorkflow({ shipping_options:[{id,data}], cart_id })`.
Storefront wrapper: `lib/data/fulfillment.ts:33-66` — swallows all errors, returns `null`.

## 5. Q4 — Shipping-options listing IS address-dependent (contradicts a common assumption)

`.pnpm/node_modules/@medusajs/core-flows/dist/cart/workflows/list-shipping-options-for-cart.js`:
- `validatePresenceOfStep` requires only `sales_channel_id`, `region_id`, `currency_code`
  — **not** the address.
- BUT the shipping-options remote query is filtered by the cart address:
```
filters: { fulfillment_set_id, address: {
  country_code:      cart.shipping_address?.country_code,
  province_code:     cart.shipping_address?.province,
  city:              cart.shipping_address?.city,
  postal_expression: cart.shipping_address?.postal_code } }
```
=> The list **must be refetched after the address changes**. Which options come back can
change with the geo/service-zone rules.

### Staleness risk is real
- `lib/data/fulfillment.ts:11-31` `listCartShippingMethods` uses `cache: "force-cache"` with
  `next: await getCacheOptions("fulfillment")`.
- `lib/data/cookies.ts:22-34,36-48`: `getCacheTag` returns `""` when the `_medusa_cache_id`
  cookie is absent, and `getCacheOptions` then returns `{}`.
- => `force-cache` with **no tags** = an entry that `revalidateTag("fulfillment-...")` can
  never invalidate. `persistShippingForCalc` (`cart.ts:145-146`) and `updateCart`
  (`cart.ts:169-172`) both revalidate a tag that may be `""`.
- `retrieveCart` (`cart.ts:44-51`) has the identical pattern for the `carts` tag.
- Separately, `listCartOptions` (`cart.ts:565-586`) applies a 5s `AbortSignal.timeout`;
  `listCartShippingMethods` — the one actually used by checkout — does **not**.

## 6. Q5 — Wrapper lifecycle

- `modules/checkout/components/payment-wrapper/index.tsx:37-58`: the wrapper is chosen from
  `cart.payment_collection.payment_sessions.find(s => s.status === "pending")`.
  Openpay wrapper mounts **only when an Openpay session already exists**; otherwise a plain
  `<div>`. It is mounted at `checkout/page.tsx:26`, i.e. it wraps the whole form.
- `payment-wrapper/openpay-wrapper.tsx`: `configMissing` (no merchantId/publicKey) short-circuits
  to `unavailable` and logs; scripts are `strategy="lazyOnload"`, core -> data chained.
  `handleDataScriptLoaded` runs `setId/setApiKey/setSandboxMode` + `deviceData.setup()`.
  Mounting it before a session exists is **harmless in itself** (no session data is read),
  but today it is unreachable without a session, and `deviceSessionId` is required later by
  `payment/index.tsx:120-124`.
  => Chicken-and-egg: card fields need the wrapper; the wrapper needs a session; the session
  gets deleted whenever the total changes (see 2b).
- Mercado Pago needs nothing at mount. At click time `payment-button/index.tsx:249-268`
  needs only `paymentSession.data.init_point` (a string) and `!notReady`; it does
  `window.location.href = initPoint`. `placeOrder` is NOT called for MP — the webhook is
  the source of truth.

## 7. Q6 — What must be true to place the order

### Storefront-side gate (the only real one today)
`modules/checkout/components/payment-button/index.tsx:26-31`:
```
notReady = !cart || !cart.shipping_address || !cart.billing_address
        || !cart.email || (cart.shipping_methods?.length ?? 0) < 1
```
plus provider dispatch on `cart.payment_collection.payment_sessions[0].provider_id`
(**index 0, not the pending one** — the Stripe branch separately re-finds the pending
session at L98-100; that asymmetry is a latent inconsistency).
Default branch renders a disabled "Selecciona un método de pago".
Per provider: Stripe additionally needs `stripe && elements && card`;
Openpay needs nothing extra at click (token was attached at session init);
MP needs `init_point`.

### Backend-side gate (weaker than the storefront's)
`.pnpm/node_modules/@medusajs/core-flows/dist/cart/workflows/complete-cart.js:253-291`:
- `validateCartItemsStep` -> only "Cannot complete a cart with no items"
- `validateCartPaymentsStep` (`.../cart/steps/validate-cart-payments.js`) ->
  payment collection must exist and hold >=1 session with status in
  `pending | requires_more | authorized | captured`
- **No shipping-address check. No billing-address check. No email check.
  No shipping-method check.**

=> The "Realizar pedido" enable predicate is a **product decision enforced client-side**;
Medusa will happily complete an address-less cart. Also relevant: `email` and `phone` are
NOT backend-enforced, yet Skydropx `POST /shipments` marks both Required on `address_to`
(`service.ts` `toShipAddress` + the pre-flight around `:1379-1420`) — that is the documented
reason `hasCompleteShippingContact` includes `phone` (`lib/util/checkout-step.ts:10-27`).

### placeOrder wrapper
`lib/data/cart.ts:592-640`: `sdk.store.cart.complete` -> on `type === "order"` redirect to
`/{cc}/order/{id}/confirmed`; on `type === "cart"` (HTTP 200 = FAILED completion) it throws
so the button stops spinning.

## 8. Q7 — Test infrastructure in `apps/storefront` — CONFIRMED vitest, not jest

- `apps/storefront/package.json:16-17`: `"test": "vitest run"`, `"test:watch": "vitest"`;
  devDep `vitest ^3.2.4`. **No jest anywhere in the storefront.**
- `apps/storefront/vitest.config.ts`: `environment: "node"`, `include: ["src/**/*.spec.ts"]`,
  aliases `@lib`/`@modules`/`@pages` mirroring tsconfig paths.
- **No jsdom, no happy-dom, no @testing-library, no Playwright** in storefront deps.
  Only pure-module unit tests are currently possible.
- Existing specs (4 files, 8 describes): `lib/util/phone.spec.ts`,
  `lib/util/carousel-pages.spec.ts`, `lib/util/checkout-step.spec.ts`,
  `lib/util/category-image.spec.ts`.
- Commands:
  - `cd apps/storefront && pnpm test` (= `vitest run`)
  - `cd apps/storefront && pnpm test:watch`
  - `pnpm turbo run test --filter=@dtc/storefront` (turbo.json:18-20 declares `test`)
- `openspec/config.yaml` `testing.runner: jest` + `cd apps/backend && pnpm test:unit`
  applies to `apps/backend` ONLY. This change is 100% in `apps/storefront`.
  Strict TDD for this change must run on vitest.
- Consequence: any logic that must be TDD'd has to live in a **pure module under
  `src/lib/util/`** (or similar), because component testing is not set up. Adding
  jsdom + @testing-library would itself be a non-trivial scope addition — the existing
  vitest.config.ts comment explicitly recommends a per-suite `environment: "jsdom"`
  override rather than flipping the global default.

## 9. Q8 — Blast radius

- Components to restructure: `addresses`, `shipping`, `payment`, `review`,
  `address-shipping-group`, `checkout-form`, `checkout/page.tsx`, `shipping-address`.
- `?step=` producers outside checkout: `modules/cart/templates/summary.tsx:29`,
  `payment/openpay/return/route.ts:22`, `payment/mercadopago/failure/route.ts:19`.
- `checkout-step.ts` + its spec: only consumer is `summary.tsx`. Removing `?step=` makes
  `getCheckoutStep` dead for routing but `hasCompleteShippingContact` is still the
  phone-completeness rule (incident-driven — see its docstring).
- **e2e/Playwright: NONE.** No test files reference `submit-address-button`,
  `submit-delivery-option-button`, `submit-payment-button` or `submit-order-button`;
  the only occurrences are the components themselves
  (`shipping/index.tsx:434`, `payment/index.tsx:318`, `addresses/index.tsx:123`,
  `review/index.tsx:50`, `payment-button/index.tsx:322`).
  `@playwright/test` appears in `pnpm-lock.yaml:7389` only as another package's peer.
  => Renaming/removing these testids breaks **zero** automated tests. Manual QA is the
  only safety net today.

## 10. Existing prefetch gate (confirmed)

`modules/checkout/components/shipping-address/index.tsx:296-305`:
```
if (cpStatus !== "found" || !postalCode || !province || !city
    || !address1 || !address2 || !countryCode) return
```
plus `calculatedOptionIds.length && cart?.id`, 600ms debounce
(`PREFETCH_DEBOUNCE_MS`, L20), signature dedupe, AbortController.
Requires `address_1` AND `address_2` — i.e. nearly the whole form — which is exactly
why quoting never happens early. Skydropx needs neither (see §4).
Consumption path: `address-shipping-group/index.tsx` -> `shipping/index.tsx:88-97`
(`hasValidPrefetch` requires an exact signature match against the **persisted cart**
address, built by `buildCartShippingSignature`, L33-45 — which includes `address_1`
and `address_2`).

## 11. Risks / constraints carried into design

1. **CRITICAL — partial address update destroys fields.** Any "quote from CP alone" write
   must send `shipping_address.id` (supported by `StoreCartUpsertAddress`) or accept
   wiping name/phone/street. This is already happening today in `persistShippingForCalc`.
2. **CRITICAL — payment sessions are deleted on every cart-total change.** Choosing or
   changing a shipping method, or applying a promo, wipes the session and (for Openpay)
   unmounts the card wrapper. An always-open Payment section must react to that, and the
   `initiatedDefaultRef` one-shot guard is incompatible with it.
3. **HIGH — shipping-options list is address-filtered** and cached with `force-cache` under
   a tag that can be `""`. Removing step navigation removes the full remounts that
   accidentally refreshed it today.
4. **HIGH — no component test harness in the storefront.** Strict TDD is only achievable
   for pure modules; UI behaviour is untested and there are no e2e tests to catch regressions.
5. **MEDIUM — backend does not enforce address/shipping/email on complete.** The CTA's
   enable predicate is the only guard; if it is loosened, orders can be created that
   Skydropx can never label (the documented prior incident).
6. **MEDIUM — `error=payment_failed` is produced by two return routes and read by nothing.**
7. **MEDIUM — variant dimensions are a hard precondition** for any quote; carts with a
   dimensionless variant fail deterministically, and `listCartShippingMethods` has no timeout.
8. **LOW — `payment-button` dispatches on `payment_sessions[0]`** while other code uses the
   `status === "pending"` session.

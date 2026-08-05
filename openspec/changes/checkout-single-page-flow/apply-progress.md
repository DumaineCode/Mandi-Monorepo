# Apply Progress — checkout-single-page-flow

Artifact store: `both` (this file + Engram `sdd/checkout-single-page-flow/apply-progress`).
Branch: `fix/checkout-persist-draft-address-id` (branched from `main`).
Run scope: **PR1a only**, tasks 1a.1 – 1a.14. Nothing from PR1b or downstream was started.
Execution mode: `auto`. Strict TDD: **active** for the pure module.

---

## Status

**PR1a implementation complete.** 1a.1 – 1a.14 done and ticked in `tasks.md`.
1a.15 and 1a.16 are MANUAL QA against a running backend and **could not be performed by this agent** — they remain unchecked. 1a.17 (PR description) is left to the parent, which owns git.

Nothing was committed. All work is in the working tree.

---

## TDD Cycle Evidence — `buildPartialShippingAddressPayload`

Runner: `cd apps/storefront && pnpm test` (vitest 3.2.7, `environment: "node"`).

**Baseline before any change:** `Test Files 4 passed (4)` · `Tests 109 passed (109)`.

### 1a.1 — RED

Command: `cd apps/storefront && pnpm test`

```
FAIL  src/lib/util/cart-address-payload.spec.ts [ src/lib/util/cart-address-payload.spec.ts ]
Error: Cannot find module './cart-address-payload' imported from
'.../src/lib/util/cart-address-payload.spec.ts'
 ❯ src/lib/util/cart-address-payload.spec.ts:4:1

Test Files  1 failed | 4 passed (5)
     Tests  109 passed (109)
```

Red for the right reason: the spec exists, the implementation does not. 7 scenarios written first, covering the four spec cases from *Every Partial Shipping-Address Write Carries `shipping_address.id`* — id propagated, id key **absent** (not `null`/`undefined`/`""`) when the cart has no address, only patched keys sent, null/undefined cart tolerated.

### 1a.2 — GREEN

Created `src/lib/util/cart-address-payload.ts` exporting `CheckoutDraftAddress` (the 10 D3 fields), `PERSISTABLE_ADDRESS_FIELDS` and `buildPartialShippingAddressPayload`. Pure: no `fetch`, no React, no `window`; the only `@medusajs/types` import is type-only.

```
✓ src/lib/util/cart-address-payload.spec.ts (7 tests) 7ms
Test Files  5 passed (5)
     Tests  116 passed (116)
```

### 1a.3 — TRIANGULATE

Added 6 cases: `undefined` patch value omitted; `""` sent; `null` sent; `id` in the patch never overriding the cart's id; non-persistable keys dropped; an empty-string id on the cart omitted.

```
Test Files  5 passed (5)
     Tests  122 passed (122)
```

**Honest deviation from the RED-per-case script.** All 6 passed on the first run. The GREEN implementation used an allow-list rather than a spread, and was already general enough to satisfy them. Rather than assert "these would have caught a naive implementation", it was **verified by mutation**: the implementation was temporarily swapped for the naive `{ ...(id ? {id} : {}), ...patch }` and the suite re-run.

```
× triangulation > omits a patch key whose value is undefined instead of sending it
× triangulation > never lets an id in the patch override the cart's id
× triangulation > drops patch keys that are not persistable address fields
Test Files  1 failed | 4 passed (5)
     Tests  3 failed | 119 passed (122)
```

3 of the 6 are genuinely discriminating and fail against the naive spread. The other 3 (`""` sent, `null` sent, empty-string cart id omitted) are decision-recording cases, not discriminating ones — stated plainly rather than counted as triangulation wins. The real implementation was restored immediately and re-verified at 122 passing.

### 1a.4 — REFACTOR

Extracted `pickPatchedFields`. Wrote the docstrings: the `EntityAssigner.js:77-98` mechanism (`:81` `extractPK` → undefined pk → `:92` `assignReference` → `em.create` = new `cart_address` row), why a missing `id` is a replacement and not a merge, that `StoreCartUpsertAddress` (`validators.js:38-40`) accepts the optional `id`, why the id comes from the cart and never from the patch (a *wrong* pk fails `sameTarget` and takes the same destructive path), and why the id-less first write is legitimate and self-limiting.

```
Test Files  5 passed (5)
     Tests  122 passed (122)
```

---

## 1a.14 — PR1a gate

```
✓ src/lib/util/category-image.spec.ts        (12 tests)
✓ src/lib/util/cart-address-payload.spec.ts  (13 tests)   ← new
✓ src/lib/util/phone.spec.ts                 (57 tests)
✓ src/lib/util/carousel-pages.spec.ts        (17 tests)
✓ src/lib/util/checkout-step.spec.ts         (23 tests)

Test Files  5 passed (5)
     Tests  122 passed (122)
```

Spec-file count **4 → 5**, tests **109 → 122**. S10 satisfied: the count went up, never down. All four pre-existing spec files still pass.

**Type check.** `npx tsc --noEmit` reports **309** `src/` errors both before and after this change, and **0** in any file touched here. The 309 are a pre-existing duplicate-`@types/react` problem across the whole storefront (`TS2786` / `ReactNode` mismatches). Verified by `git stash` baseline comparison, not assumed.

---

## Files created

| File | Lines | Task |
|---|---|---|
| `apps/storefront/src/lib/util/cart-address-payload.ts` | 135 (53 code / 82 comment+blank) | 1a.2, 1a.4 |
| `apps/storefront/src/lib/util/cart-address-payload.spec.ts` | 192 (132 code / 60 comment+blank) | 1a.1, 1a.3 |

## Files modified

| File | Changed | Tasks |
|---|---|---|
| `apps/storefront/src/lib/data/cart.ts` | +184 / −40 | 1a.5, 1a.6, 1a.7, 1a.8, 1a.9 |
| `apps/storefront/src/lib/data/fulfillment.ts` | +55 / −7 | 1a.11, 1a.12, 1a.13 |
| `apps/storefront/src/modules/checkout/components/shipping-address/index.tsx` | +17 / −9 | 1a.10 |
| `openspec/changes/checkout-single-page-flow/tasks.md` | checkboxes 1a.1–1a.14 | tracking |

### What landed in each

- **1a.5** `retrieveCartFresh(cartId?, fields?)` — `cache: "no-store"`, no `next` options. Docstring records the actual reason: `getCacheTag` returns `""` without the `_medusa_cache_id` cookie (`cookies.ts:22-34`), so `force-cache` + empty tags is unreachable by `revalidateTag`, and `revalidateTag`-then-read in one request is not a documented Next 15 ordering guarantee.
- **1a.6** `persistShippingForCalc` → `persistCheckoutDraft(addr, email, addressIdHint?)` returning `{ok:true,cart} | {ok:false,error}`. All 8 D3 steps implemented and numbered in comments. `email` is sent only when non-`null`, so an address-only autosave cannot clear a stored email. Keeps `revalidateTag("fulfillment")`; still does **not** revalidate `carts`.
- **1a.7** Step-6 tripwire: `console.error("cart_address row was REPLACED, not merged", { cartId, sent, got })`. Does not throw — the write already happened.
- **1a.8** `setShippingMethod` now returns `Promise<HttpTypes.StoreCart>` (the SDK already resolved `{ cart }` and it was discarded).
- **1a.9** `applyPromotions` now returns the updated cart, same reason.
- **1a.10** Every caller checked by grep before editing. Only **one** needed a real edit.
- **1a.11/1a.12** `listCartShippingMethods` → `cache: "no-store"` + `AbortSignal.timeout(SHIPPING_OPTIONS_TIMEOUT_MS = 5_000)`, `next` removed. The comment states the F3 truth — `listShippingOptionsForCartWorkflow` does **not** call the carrier — and explicitly warns against copying `CART_OPTIONS_TIMEOUT_MS`' inaccurate justification. Also records why the `categories.ts:18` bounded-TTL precedent was rejected.
- **1a.13** `calculatePriceForShippingOption` now `console.error`s `{ optionId, cartId, error }` before returning `null`. Return contract unchanged.

### 1a.10 — caller audit (zero user-visible behaviour change)

`grep -rn "persistShippingForCalc\|setShippingMethod\|applyPromotions" src/` before editing:

| Call site | Action | Why |
|---|---|---|
| `shipping-address/index.tsx:1,296` | **edited** | rename + new arg shape; same 6 fields, same `!persisted.ok` branch |
| `shipping/index.tsx:190` | untouched | `await setShippingMethod(...).catch(...)` — resolved value discarded |
| `discount-code/index.tsx:25,44` | untouched | return value discarded |
| `cart.ts:561` `submitPromotionForm` | untouched | return value discarded |

Widening a return type is source-compatible for callers that ignore it, so three of the four needed nothing. The existing four-step checkout renders and behaves exactly as before; no UI component was touched beyond the one import and one call expression.

---

## Deviations from design

1. **`fields` projection in D3 step 3.** Design specifies `retrieveCartFresh(cartId, "id,shipping_address.id")`. Implemented as `"id,*shipping_address"`. Every other projection in this data layer uses the `*relation` / `+field` prefixes (`categories.ts:66`, `orders.ts:52`); bare dot notation on a relation is not exercised anywhere in the repo. If it resolved to nothing, `addressId` would be `null`, no id would be sent, and **the bug would silently return with the step-6 tripwire disarmed** — the tripwire only fires when an id was actually sent. Step semantics are unchanged; only the projection is widened, on a debounced path. Documented inline at the call site.
2. **Triangulation did not produce a per-case RED.** See 1a.3 above. Verified by mutation instead of claimed.

No other deviation. `null` handling in the payload builder is worth flagging to review: `undefined` means "not in this patch" and is omitted, while `null` and `""` mean "the customer cleared this" and are sent (`AddressPayload` declares every field `nullish()`). `StoreCartAddress` types these `string | undefined`, so a typed caller cannot produce `null`; the rule exists because this function sits behind a server-action boundary where types are erased.

---

## Changed-line count vs estimate

| | Lines |
|---|---|
| Tracked files (added + deleted) | 312 |
| New files | 327 |
| **Total changed** | **639** |
| Estimate in `tasks.md` | ~280 |

**The estimate was missed by 2.3x and that needs a decision, not a footnote.**

Breakdown: roughly **312 of the 639 are comment or blank lines**. Code-only volume is ~327, within ~17 % of the ~280 estimate. The overrun is almost entirely documentation that the tasks themselves mandated — 1a.4 requires the full `EntityAssigner` docstring, 1a.5 requires the `revalidateTag`-ordering rationale, 1a.12 requires an accurate timeout justification plus the rejected-alternative record, and D3's 8 steps are individually annotated.

**Consequence the parent must rule on:** `tasks.md` says PR1a needs **no `size:exception`** on the basis of ~280 against a 600 budget. At 639 actual it is over budget. Two defensible readings — count code only (~327, comfortably under) or count lines as the settled rule states (639, over). The settled rule in `tasks.md` is that **deletions and lines count, full stop**, applied consistently to PR2c. Applying it consistently here means PR1a now needs a `size:exception` too. Flagging rather than shaving the number.

---

## Remaining tasks in PR1a

```
- [ ] **1a.15 — MANUAL QA (blocking merge).** … fill the full checkout address including
      first_name, last_name, company, phone; submit; trigger a partial persist by editing
      and blurring the postal code; reload. All four fields must still be present and
      cart.shipping_address.id unchanged. Watch for the 1a.7 console.error — it must not fire.
- [ ] **1a.16 — MANUAL QA (blocking merge).** Full regression of the existing four-step
      checkout, Openpay happy path end to end.
- [ ] **1a.17** PR description: title the live bug, link explore §3, state that reverting
      reintroduces PII destruction (design §12), paste the 1a.15 QA evidence.
```

1a.15 and 1a.16 require a running backend and a browser. This agent cannot perform them and did **not** mark them done. 1a.17 is the parent's, which owns git.

**1a.15 is the only gate that can catch deviation 1.** If the `*shipping_address` projection is also wrong, the symptom is exactly the original bug — `first_name` / `last_name` / `company` / `phone` disappearing after a postal-code blur, with no `console.error`. Run it first.

---

## Workload / PR boundary

PR1a is complete at the code level and stops cleanly at its boundary. No PR1b file was created or modified: no `checkout-readiness.ts`, no `shipping-quote.ts`, no `payment-wrapper` change, no `checkout-step.ts` deletion, no `?step=` edits. `isStripeLike` untouched (RC-4).

PR1a targets `main` directly and stays independently revertible, per `design.md` §12.

## Structured status consumed

Native status was supplied by the parent and treated as authoritative: change `checkout-single-page-flow`, store `both`, `applyState: ready`, proposal/spec/design/tasks all complete and user-approved, `actionContext.mode: implementation`, allowed edit roots `apps/storefront/src/` and `openspec/changes/checkout-single-page-flow/`. Every file written is inside those roots. No `apps/backend` file was read for modification (backend `node_modules` and `medusa-config` were read only as evidence). No `actionContext` warning raised.

---

# Remediation pass — PR1a review findings (F1–F7)

Two fresh-context reviews (`review-reliability`, `review-risk`) ran blind and independently on the PR1a diff and converged on the same defects. All in-scope findings below are fixed. Nothing was redesigned, no PR1b work started, nothing committed.

**Gate result:** `cd apps/storefront && pnpm test` → **6 spec files / 150 tests green** (was 5 / 122 at the end of the first pass; `cart-address-payload.spec.ts` went 13 → 28, plus 13 new `log-safe` specs). `npx tsc --noEmit` → **313 src errors vs a 309 baseline**, delta measured not assumed (see below).

## Findings and what changed

### F1 — BLOCKER. `addressIdHint` removed entirely

`persistCheckoutDraft` lives in a `"use server"` module, so it is a publicly reachable POST endpoint with client-controlled arguments, and the hint was injected verbatim as a `cart_address` primary key with no check that the row belonged to `cartId`. It also self-staled: `setAddresses` sends `shipping_address` without an id, so every form submit churns the row id and any captured hint goes stale — and a stale id takes the same destructive `assignReference` path as no id, while a colliding one risks a PK 500.

- Parameter and the synthetic-cart branch **deleted** from `persistCheckoutDraft` (`cart.ts`). The id is now always resolved server-side from a fresh read.
- Caller comment in `shipping-address/index.tsx` that promised "the reducer starts supplying the hint in PR2a" — deleted.
- `cart-address-payload.ts` "the cart is the only id authority" docstring extended to state explicitly that no caller may supply an id and why.
- `design.md` updated: signature, the D3 step list, and the effects diagram no longer carry the hint; a new **"`addressIdHint` is REJECTED"** subsection records the security and staleness grounds and states that **PR2a must not add an id parameter to any cart-writing server action**.
- Verification: `grep -rn addressIdHint apps/storefront/src` returns only the docstring that explains the removal.

### F2 — CRITICAL. Failure is no longer indistinguishable from absence

`retrieveCartFresh` ended in `.catch(() => null)`, and `null` meant both "the cart has no shipping address" (safe) and "the read failed" (destructive). Since this read is PR1a's only id source, the whole fix rested on a call whose every failure was invisible — the step-6 tripwire cannot cover it, because it only fires when an id *was* sent.

- `retrieveCartFresh` now returns a discriminated `FreshCartRead = { ok: true; cart } | { ok: false; error }`.
- New **pure** `resolveShippingAddressId(read)` → `resolved | absent | unresolved` (in `cart-address-payload.ts`, so it is unit-testable without mocking the SDK, cookies and `next/cache`).
- `persistCheckoutDraft` **aborts** on `unresolved` and returns `{ ok: false, error }`. It proceeds id-less only on `absent`, i.e. only when a successful read positively established that the cart has no address row.
- `AbortSignal.timeout(CART_READ_TIMEOUT_MS = 5_000)` added to the read. It now sits sequentially in front of every autosave write, so unbounded was the worst possible place for it.
- A `200` that somehow carries no cart is treated as `unresolved`, not as "probably a new cart" — the cheap guess is the destructive one.
- **Caller degradation verified, not assumed:** in `shipping-address/index.tsx` the `!persisted.ok` branch is a bare `return` out of a `setTimeout` callback. Nothing is dispatched, `lastPrefetchedSignature` is left untouched, and `onPrefetch` never fires — so the form keeps every typed value and stays editable. The loss is the prefetched quote, which the next edit recomputes. Skipped quote, never a broken form. Comment added at the branch recording this.

### F3 — CRITICAL. A shipping-options failure no longer blanks the checkout

`checkout-form/index.tsx` did `if (!shippingMethods || !paymentMethods) return null`, so one timeout or 5xx rendered the entire subtree as nothing. `force-cache` used to mask backend blips; removing it was right but removed the mask without a fallback, and this PR raised the failure probability.

**What I chose, and why:**

1. **One retry, with a shorter second budget** (`5_000` then `2_000` ms) in `listCartShippingMethods`. Rationale: this call is awaited during a server render, so a retry is paid in TTFB by every customer who hits a blip. Capping the worst case at ~7 s instead of 10 s means the case retrying helps least (a hung upstream) gets the smaller half. No backoff and no second retry: if the backend is genuinely down, more attempts make a slow checkout slower and add load to a struggling service.
2. **A contained error state**, `CheckoutUnavailable` — an honest message plus a `router.refresh()` retry button, rendered in place of `null`. The message distinguishes shipping-options failure from payment-methods failure.
3. **Rejected:** rendering the address form with an empty shipping list. That asserts "no delivery options exist for your address" — a confident claim about the customer we have no evidence for. An honest "we could not load this" is a smaller lie.

Scope held: one new leaf component, no UI restructure, no `?step=` or reducer work.

### F4 — CRITICAL. Cart ids are credentials and are no longer logged

Verified independently: `GET /store/carts/:id` and `POST /store/carts/:id` carry **no** `authenticate("customer", …)` middleware (`@medusajs/medusa/dist/api/store/carts/middlewares.js:44-51`, `:63-70`); the only gate is the publishable key, which ships to every browser. `defaultStoreCartFields` (`query-config.js:103+`) includes the whole `shipping_address` block plus `email` and `customer.email`. A cart id in a log stream is read/write access to that customer's data for the 7-day cookie lifetime.

- New `lib/util/log-safe.ts`: `toLogReference(id)` (deterministic, non-reversible tail; `"unknown"` for absent, `"***"` when the id is too short to truncate safely) and `describeError(error)` → `{ message, status }` only.
- Truncation over hashing, deliberately: this runs on a request path, and a hash needs `crypto.subtle` (async) or a hand-rolled digest to buy a property that withholding 20+ characters already has.
- Both new `console.error` sites rewritten. `calculatePriceForShippingOption` now logs `optionId` + masked cart reference + `message`/`status` — which fully serves the `MissingDimensionsError` observability goal. The whole `error` object is no longer logged anywhere new.
- `listCartShippingMethods` gained a log line for the both-attempts-failed case, since that is now customer-visible and a silent `catch(() => null)` would leave the team debugging a screenshot.

### F5 — WARNING. Three docstrings that stated premises the code disproves

1. **The `getCacheTag` "NEVER reachable" claim** (`cart.ts`, `fulfillment.ts`) was too strong and is corrected. Verified: `middleware.ts:120-124` sets `_medusa_cache_id` with `maxAge: 86400` and `config.matcher` (`:140-142`) covers every page route, so a user who has a cart almost always has the cookie and the tag *was* real. The untagged window is genuine but narrow (first request of a session; the gap after the 24 h cache cookie expires while the 7-day cart cookie lives on). The load-bearing arguments are restated as what they actually are: address-filtering for `listCartShippingMethods`, and the undocumented same-request `revalidateTag`-then-read ordering for `retrieveCartFresh`.
   Also recorded: after this diff **`revalidateTag(fulfillmentCacheTag)` is inert** — the only remaining `getCacheOptions("fulfillment")` is on a POST, which Next never caches. Documented in place at the `persistCheckoutDraft` call site and kept, because the tag is still the correct expression of "this cart's shipping options are stale"; deleting every call means the day a cached fulfillment read returns, it returns silently wrong. Logged as follow-up #5.
2. **The `"id,*shipping_address"` rationale was false and is replaced.** Bare dot notation is not unexercised — it is Medusa's own default: `defaultStoreCartFields` at `query-config.js:103` is literally `"shipping_address.id"`. The star form is **kept** (verified to work through the field parser, and it matches every other projection in this data layer), but the comment now states the true tradeoff: a star field must match an `allowed` entry in full while a dotted field passes by prefix, so if Medusa ever adds an `allowed` list to this route the star form breaks and the dotted one would not. Confirmed the route has no `allowed` list today (`query-config.js:137-140` sets only `defaults`).
3. **`syncCheckoutAddresses` marked as planned.** It does not exist; it is a PR2c function. Both references (`cart-address-payload.ts`, `cart.ts`) now say so explicitly instead of pointing at a callee that cannot be found.

### F6 — WARNING. `PERSISTABLE_ADDRESS_FIELDS` exhaustiveness now enforced

`satisfies readonly (keyof CheckoutDraftAddress)[]` proved every element is a valid key but never that every key is an element.

**Fixed by inverting the dependency rather than only testing for it:** `PERSISTABLE_ADDRESS_FIELDS` is now the single source of truth and `CheckoutDraftAddress` is *derived* from it (`Pick<StoreCartAddress, (typeof PERSISTABLE_ADDRESS_FIELDS)[number]>`). `satisfies readonly (keyof HttpTypes.StoreCartAddress)[]` still rejects a name Medusa does not know. Type-vs-array drift is now structurally impossible — there is only one list to edit.

The remaining risk (the form starts collecting a field and nobody adds it here) is not type-checkable, so two specs cover it: one pins the array against an independently hand-written expected set, one asserts every one of those fields actually arrives in the payload.

### F7 — Missing spec cases added

- **cart address with `id: null`** — pinned to key-absence, with the note that `null` is the likelier wire value than `""` since `AddressPayload` is `nullish()`.
- **cart present but `shipping_address: undefined`** — the pre-existing `it.each([null, undefined])` varied the *cart*; this varies the *address*, which is the shape a real `fields=id,*shipping_address` read returns for a cart that never had one.
- **every persistable key `undefined` while the cart HAS an id.** **Decision recorded: the bare-PK upsert `{ shipping_address: { id } }` is INTENDED, not a no-op.** The builder is pure and has no authority to cancel a write, and the payload faithfully says "this row, no field changes" — `extractPK` succeeds, `sameTarget` holds, zero fields merge, the address row is untouched. It is not free, though: `updateCartWorkflow` still runs. Suppressing the pointless round trip is the caller's job and `design.md` §D3 already assigns it to the PR2a reducer's "skip when the draft is unchanged" rule; PR1a's single caller always passes six populated fields, so the case cannot occur yet. Recorded as follow-up #6.
- Bonus pin: an empty patch against a cart with no id yields `{}`, which is **not** harmless the way the bare-PK case is (`em.create` of an empty row). Pinned so the consequence is already written down the day a caller can produce it.

## TDD Cycle Evidence

Runner: `cd apps/storefront && pnpm test` (vitest 3.2.7). Start of pass: **5 files / 122 tests**.

| # | Cycle | Evidence |
| --- | --- | --- |
| 1 | **RED** — `log-safe` (F4) | Spec written first. `FAIL src/lib/util/log-safe.spec.ts — Failed to load url ./log-safe`. `1 failed \| 5 passed (6)`, 122 tests. Red for the right reason: spec exists, implementation does not. |
| 2 | **GREEN** — `log-safe` | `toLogReference` + `describeError` implemented. `6 passed (6)` / **135 tests**. |
| 3 | **TRIANGULATE** — `log-safe` | Verified by MUTATION, not claimed. Mutation A: `toLogReference` returns the id unmasked. Mutation B: `describeError` spreads the whole error object. Result `5 failed \| 130 passed` — the two never-emit-the-full-id specs and three `describeError` specs discriminate. Real implementations restored, 135 green. |
| 4 | **RED** — exhaustiveness (F6) | Specs written first, then `"phone"` deliberately removed from `PERSISTABLE_ADDRESS_FIELDS` with the type left intact — the exact silent-drop scenario, which under the old `satisfies` construction compiled cleanly and kept the suite green. Result: `2 failed \| 139 passed (141)`. Array restored. |
| 5 | **RED** — `resolveShippingAddressId` (F2) | The drafted implementation was **stripped back out** of the module so the RED would be real rather than claimed, then the spec was run: **9 failed**, every `resolveShippingAddressId` case. |
| 6 | **GREEN** — `resolveShippingAddressId` | Implementation restored. `6 passed (6)` / **150 tests**. |
| 7 | **TRIANGULATE** — `resolveShippingAddressId` | Mutation: reinstate the collapsed behaviour (`read.ok ? read.cart : null`, then any missing id ⇒ `absent`) — i.e. the exact bug F2 exists to close. Result `4 failed \| 146 passed`: all four "a read that did not succeed" cases fire. Restored, 150 green. |
| 8 | **REFACTOR** | `readShippingAddressId` extracted as the single place that knows where a shipping-address id lives on a cart, shared by the payload builder and the resolver so the two can never disagree about whether a cart "has" an id. Suite green throughout. |

Honest note on ordering: for cycles 4 and 5 the RED was produced by deliberately removing working code (a field from the array; the resolver from the module) rather than by writing the spec into a genuinely empty repo state. That is a real observed failure, not an assumed one, but it is not identical to a from-scratch RED and is reported as such.

## Verification evidence

```
cd apps/storefront && pnpm test
→ Test Files  6 passed (6)
→      Tests  150 passed (150)     (start of pass: 5 files / 122 tests — S10 satisfied, count went UP)

npx tsc --noEmit
→ 313 src errors   (baseline 309)
```

**The +4 delta was measured, not assumed.** Moving only the new `checkout-unavailable/` component out of the tree and reverting its one import returns the count to **exactly 309**, matching the recorded PR1a baseline. All four are `TS2786 'X' cannot be used as a JSX component` on `Container` / `Heading` / `Text` / `Button` — the same pre-existing duplicate-`@types/react` problem that accounts for **256 of the 313** errors repo-wide. **Zero errors of any other class in any touched file.**

`git stash push --include-untracked -- <paths>` was attempted for the baseline and silently did nothing (pathspec + `-u`); confirmed via `git stash list` that no work was lost, and the surgical measurement above was used instead.

## Files changed in this pass

Created:
- `src/lib/util/log-safe.ts`, `src/lib/util/log-safe.spec.ts` (F4)
- `src/modules/checkout/components/checkout-unavailable/index.tsx` (F3)

Modified:
- `src/lib/data/cart.ts` — F1 hint removal, F2 discriminated read + abort + timeout, F4 masked logging, F5.1/F5.2/F5.3 docstrings
- `src/lib/data/fulfillment.ts` — F3 retry, F4 logging, F5.1 docstring
- `src/lib/util/cart-address-payload.ts` — F6 inverted type derivation, F2 resolver, F1/F5.3 docstrings
- `src/lib/util/cart-address-payload.spec.ts` — F6 + F7 specs, F2 resolver specs
- `src/modules/checkout/templates/checkout-form/index.tsx` — F3 error state
- `src/modules/checkout/components/shipping-address/index.tsx` — F1 comment, F2 degradation note
- `openspec/changes/checkout-single-page-flow/design.md` — F1 rejection + PR2a constraint, D3 step list, effects diagram, new §14 follow-ups

## Deferred, with an owner (recorded in `design.md` §14)

| # | Item | Owner |
| --- | --- | --- |
| 1 | No supersession/sequence control on the debounced writer (two edits 700 ms apart can land out of order) | **PR2a** |
| 2 | `persistCheckoutDraft` has no unit tests of its own — needs `vi.mock` infrastructure this repo has never had | **Task-list change; parent decides** |
| 3 | `retrieveCart` / `retrieveCartFresh` are near-identical siblings (now also differing in return type) | Follow-up |
| 4 | Remaining `force-cache` + `Authorization` sites in `customer.ts`, `orders.ts`, `cart.ts`, `payment.ts` | Follow-up |
| 5 | `revalidateTag(fulfillmentCacheTag)` is inert at six call sites | Follow-up |
| 6 | Bare-PK upsert on an all-`undefined` patch — suppression belongs to the reducer | **PR2a** |

## Unchanged from the first pass

1a.15 / 1a.16 remain **unchecked** — they are manual QA against a running backend and a browser, which this agent cannot perform. 1a.17 (PR description) is the parent's. **1a.15 is still the only gate that can catch the `*shipping_address` projection deviation**, and F2's abort now makes a projection failure loud (`{ ok: false }` and no quote) instead of silent, but a projection that resolves to *nothing* would surface as `absent` — so run 1a.15 first.

The PR1a **line-count overrun flagged in the first pass is now larger** (this pass adds roughly 300 more tracked lines plus two new files). The `size:exception` question that was already open for PR1a is unchanged in kind and worse in degree. Flagged, not shaved.

Nothing committed. No PR1b file created or modified.

---

# PART 3 — SECOND REMEDIATION PASS. THIS IS THE CURRENT STATE.

A second blind dual review (`review-reliability` + `review-risk`) ran on the remediated diff and converged again — including on two defects introduced or left standing by the FIRST remediation. All seven in-scope findings fixed. No redesign, no PR1b, nothing committed.

**Gate: 8 spec files / 211 tests green** (was 6 / 150). `tsc --noEmit`: **313 src errors, measured before and after this pass — delta ZERO**, and zero non-`TS2786` errors in any touched file. The 4-over-309 gap is unchanged from the first pass and is the same duplicate-`@types/react` JSX noise in `checkout-unavailable/index.tsx`.

## G1 BLOCKER — `log-safe.spec.ts` was green while leaking a bearer credential

The suite asserted `not.toContain(CART_ID.slice(0, -6))` — a **prefix** containment check satisfied by any output missing the first six characters — plus `toContain(slice(-6))`. That is a **lower** bound and nothing else. There was no tail length in the entire range 7–29 that the suite rejected.

**Reproduced before fixing:** raised `REFERENCE_TAIL_LENGTH` to 29, which emits `…rt_01JQZ8V3K7NB2XW9RTPY4C6HDM` — 29 of the id's 30 characters — and all 13 tests stayed green.

Fixed with a real **upper** bound: `longestSharedRun(emitted, source)` measures the longest run of characters the output and the id share, asserted `<= 6` across three id shapes. It is implementation-shape-agnostic — a tail, a head, a middle slice or an interleave are all bounded. Plus an exact-length bound and a "24 characters withheld" count. The budget `MAX_DISCLOSED_CHARACTERS = 6` is declared **in the spec, not imported** from the module: importing the constant is the tautology that let this through.

## G2 CRITICAL — `describeError().message` printed the id `toLogReference` had just masked

Verified in `node_modules`, not assumed:
- `@medusajs/js-sdk/dist/esm/client.js:90` — `new FetchError(jsonError.message ?? resp.statusText, ...)`: the message IS the backend's response body verbatim.
- `@medusajs/orchestration/dist/joiner/remote-joiner.js:475` — `` `${entityName} ${pkField} not found: ` + Array.from(notFound).join(", ") ``.
- `@medusajs/medusa/dist/api/store/carts/helpers.js:14` — `` `Cart with id '${id}' not found` ``.

So on a completed/expired/deleted cart — the most likely failure — the log line masked the id in its `cart:` field and printed it in full in `message:` immediately beside it. Worse than not masking, because it looked safe. The old spec's `"Cart not found"` sample was a sanitized fiction no backend emits.

Fixed: `redactIds` replaces `/\b[a-z][a-z0-9_]*_[0-9A-HJKMNP-TV-Z]{26}\b/g` with `toLogReference(match)`, so the redacted message still joins to the `cart:` field. Shape-matched, not prefix-allow-listed — `cart_`, `caaddr_` and every entity type nobody has thought about are covered without a code change. Crockford base32 excludes `I/L/O/U`, which is what stops it eating ordinary words. Diagnostic text survives ("not found" is preserved). `status` untouched. Specs use the **real** message strings quoted above.

## G3 CRITICAL (converged twice) — the projection was a single point of failure that failed UNSAFE

Both halves fixed, and the fix is stronger than the finding asked for.

**Half 1 — the projection.** `"id,*shipping_address"` → `"id,shipping_address_id,shipping_address.id"`. A star field must match an `allowed` entry in FULL while a dotted field passes by PREFIX, so the star form was the one that breaks if the route ever gains an `allowed` list. Data-layer style consistency is not worth failing on the one read the entire PII fix depends on. Docstring rationale replaced with the true one.

**Half 2 — the runtime guard.** `resolveShippingAddressId` now takes the **best available evidence** instead of betting everything on one key's presence:

1. relation carries a truthy `id` → `resolved` (checked first, so a future `allowed` list stripping the FK cannot break it);
2. else FK key present → its VALUE answers outright: `null` = `absent`, truthy = `unresolved` (a row exists and we do not have its key);
3. else relation key present-and-nullish → `absent`; relation key entirely absent, or present as an object with no id → `unresolved`.

**Why the FK scalar and not just the key-presence check the finding described.** A guard reading only "relation key missing ⇒ unresolved" is fail-safe against data loss but sound only if the backend really materialises the key for an empty to-one. If it omits it, **every cart that never had an address becomes `unresolved`, the first autosave never fires, and the shipping prefetch silently stops working for every new customer** — a real functional regression bought with a safety property. `shipping_address_id` is a plain column: a selected scalar always materialises its key, and its value is positive evidence in both directions. It sits at `query-config.js:102`, one line above `shipping_address.id`, in Medusa's OWN default store projection — so both fields are the most-exercised field list in the product, not a clever choice.

Three previously-passing cases were **inverted** as unsafe: an address object arriving with `id: ""`, `id: null`, or no `id` key used to resolve to `absent`. A row EXISTS in all three, so an id-less write destroys it. That is exactly the shape a future `allowed` list produces by filtering `shipping_address.id` while keeping the relation.

## G4 CRITICAL — the abort guarantee had zero tests

New `apps/storefront/src/lib/data/cart.spec.ts` (23 tests) and `fulfillment.spec.ts` (16 tests), on `vi.mock` + `vi.hoisted` infrastructure this repo did not have. **This resolves deferred item §14.2.**

Every assertion is against the arguments `sdk.store.cart.update` was ACTUALLY called with, never a stub's return value. Coverage: seven ways a read can fail to establish an answer, each asserting **zero writes** (reject / timeout / 500 / 200-with-no-cart / neither signal delivered / FK-says-row-exists-but-no-id / no cart at all); the exact id on the wire; key-ABSENCE on the legitimate id-less write; the pinned projection string; `no-store`; email omitted when `null`; tripwire fires on a differing id and on no address returned, stays silent when ids match and on a legitimate id-less write; no raw id in any log line.

## G5 WARNING — the retry fired on non-retryable errors

`isRetryable(error)`: no status (transport / DNS / `AbortSignal.timeout`) or `>= 500` retries; 4xx never does. A 4xx is a statement about the request, and this call is awaited during the checkout server render, so the old unconditional catch spent up to 2 s of the customer's TTFB on a byte-identical request that could not succeed. Non-retryable failures are still logged — not retrying must not mean not reporting.

## G6 WARNING — incoherent threat model on backend error text

`persistCheckoutDraft` returned `resolution.error` and the caught `error.message` verbatim across the `"use server"` boundary to the browser, while the same PR argued that this exact text echoes cart ids and address content and must be kept out of logs. Now both paths return `PERSIST_DRAFT_GENERIC_ERROR` and the sanitized detail goes to the server log via `describeError` / `redactIds`. The abort path previously logged **nothing** at all — a broken projection could have gone unnoticed for a week. The caller does not display this string (`!persisted.ok` is a bare return), so no user-facing message degrades.

## G7 WARNING — four overstated or dead things

1. **`CART_READ_TIMEOUT_MS` docstring.** Claim corrected, write NOT bounded — and the choice is stated. `sdk.store.cart.update` is typed `(id, body, query?, headers?)` (`@medusajs/js-sdk/dist/esm/store/index.d.ts:424`) and takes no request init, so a signal means abandoning the typed SDK method and hand-rolling `sdk.client.fetch` **on the destructive write itself** — a bad trade inside a pass whose purpose is de-risking that exact line. Recorded as a follow-up; the docstring now says plainly that a hung upstream can still hang the autosave.
2. **`checkout-unavailable` docstring.** The "considered and rejected" claim was false: `listCartShippingMethods` returns `null` only on failure, `[]` is truthy, so a successful empty list still renders the address form with no options. Rewritten around the real distinction — a failed call is not evidence, a successful empty list is.
3. **`toLogReference` docstring.** "Non-reversible" overstated it. Unsalted and deterministic ⇒ not reversible but **confirmable**: anyone already holding the id can compute the reference and pick out its lines. It is redaction, not pseudonymization, and salting would destroy the correlation that is its only reason to exist. Said plainly.
4. **`checkout-form`'s dead `if (!cart) return null`.** Now renders `CheckoutUnavailable`. A bare null is the blank-page failure this component was just changed to remove; leaving one behind means the bug returns silently the day the template is rendered from somewhere with a weaker guarantee.

## TDD evidence — second pass (vitest 3.2.7)

REDs in this pass were produced from a **virgin state** wherever the property was new, answering the first pass's honest note that two of its REDs came from deleting working code.

| # | Cycle | Method | Observed |
| --- | --- | --- | --- |
| 1 | G1 reproduce | Raised `REFERENCE_TAIL_LENGTH` 6 → 29 | **13/13 green** while emitting 29 of 30 characters — the defect, confirmed |
| 2 | G1 RED | New upper-bound tests written **while the constant was still 29** | **5 failed \| 13 passed** |
| 3 | G1 GREEN | Restored the constant to 6 | 18 passed |
| 4 | G2 RED | New specs using the real `remote-joiner` / `refetchCart` message strings, against un-redacted `describeError` | **6 failed \| 21 passed** |
| 5 | G2 GREEN | `redactIds` | 27 passed |
| 6 | G2 TRIANGULATE | Mutation A: drop the regex `g` flag | **1 failed** (multi-id case) — restored |
| 7 | G2 TRIANGULATE | Mutation B: replace with a fixed `[redacted]` placeholder | **1 failed** (correlatability) — restored |
| 8 | G3 RED (guard) | Projection-failure + falsy-id-in-object specs | **5 failed \| 26 passed** |
| 9 | G3 GREEN | Key-presence guard | 31 passed |
| 10 | G3 RED (FK) | FK-evidence specs, incl. the false-positive case | **2 failed \| 34 passed** |
| 11 | G3 GREEN | Evidence-priority resolver | 36 passed |
| 12 | G5 RED | New `fulfillment.spec.ts`; 11 passed proving the harness, 5 non-retryable cases failing with *"expected 1 times, got 2"* | **5 failed \| 11 passed** |
| 13 | G5 GREEN | `isRetryable` | 16 passed |
| 14 | G4 | New `cart.spec.ts`; **20 passed immediately**, confirming the abort wiring was already correct; the 3 failures were exactly G6 | **3 failed \| 20 passed** |
| 15 | G6 GREEN | `PERSIST_DRAFT_GENERIC_ERROR` + server-side logging | 23 passed |
| 16 | G4 TRIANGULATE | **The reviewer's own mutation**: deleted the whole `if (resolution.status === "unresolved")` block | **7 failed \| 204 passed** — the same mutation previously left 150/150 green |
| 17 | G3 TRIANGULATE | Mutation C: reverted the projection to `id,*shipping_address` | **1 failed** — restored |
| 18 | G3 TRIANGULATE | Mutation D: removed the FK evidence branch | **3 failed** — restored |
| 19 | Final | Full suite + `prettier --write` on all touched files | **8 files / 211 tests green** |

## `tsc` delta — measured

`313` before this pass and `313` after. Zero delta, including the new `<CheckoutUnavailable>` usage added to `checkout-form`. Zero non-`TS2786` errors in any touched file.

## Files — second pass

Created: `src/lib/data/cart.spec.ts`, `src/lib/data/fulfillment.spec.ts`.
Modified: `src/lib/util/log-safe.ts` (+spec), `src/lib/util/cart-address-payload.ts` (+spec), `src/lib/data/cart.ts`, `src/lib/data/fulfillment.ts`, `src/modules/checkout/templates/checkout-form/index.tsx`, `src/modules/checkout/components/checkout-unavailable/index.tsx`, `design.md` (§14 items 1, 1b, 2, 5b, 5c), `tasks.md` (second remediation note).

## Recorded as follow-ups, NOT fixed here (all in `design.md` §14)

| # | Item | Owner |
| --- | --- | --- |
| 1 | Reorder window **widened** by this remediation — a sequential read now precedes every write, and the `AbortController` at `shipping-address/index.tsx:292` is never passed into the server action (`:352-353`), so the write always lands. §14 item 1 amended to cover the read-write interleave explicitly, not only same-writer reordering. | **PR2a** |
| 1b | The `absent` TOCTOU window: read says `absent` → a concurrent `setAddresses` creates the row → the in-flight autosave lands id-less and shreds it. The one remaining path to the original bug. | **PR2a** |
| 5b | `retrieveCartFresh` is a `"use server"` export with client-controlled `cartId` and `fields`. Same shape as the pre-existing `retrieveCart`, so not a regression in kind — recorded, not blocking. | Follow-up |
| 5c | Worst-case checkout render ~7 s **plus unbounded**: `checkout-form` awaits shipping then payment sequentially and `payment.ts` has no timeout. Not parallelised here — that is PR2a's `Promise.all`. | **PR2a** |
| — | `sdk.store.cart.update` has no timeout (see G7.1). | Follow-up |

## Remaining / boundary

- [ ] **1a.15 MANUAL QA (blocking)** — now with a **third** check, and it is the single assumption in this fix that no automated test can settle: **on a cart that has NEVER had a shipping address, the first autosave must still produce a `POST /store/carts/:id`.** If it does not, the backend omits `shipping_address_id` for empty relations and the projection guard needs a different signal. Plus the two checks from the first pass: (a) backend stopped ⇒ "No pudimos cargar el checkout" with a working Reintentar, never a blank page; (b) no raw `cart_…` id in the server log — now check the `message:` field too, not only `cart:`.
- [ ] **1a.16 MANUAL QA (blocking)** — full regression of the existing four-step checkout, Openpay happy path.
- [ ] **1a.17** PR description — the parent owns git.

PR1a line-count overrun grows again (~450 more tracked lines, two more files, both tests). The `size:exception` question already open for PR1a is unchanged in kind and worse in degree. Flagged, not shaved — the added lines are the automated proof the reviewers said was missing.

Nothing committed. No PR1b file created or modified. All edits inside `apps/storefront/src/` and `openspec/changes/checkout-single-page-flow/`.

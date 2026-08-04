# Exploration — storefront-cache-and-seed-hardening

> Change: `storefront-cache-and-seed-hardening` · Store: openspec · Status: explored
> Source: two adversarial subagent reviews (`review-risk`, `review-reliability`), 2026-08-04
> Every framework claim below was verified against `node_modules` sources, not recalled.

Deferred deliberately. Discovered while shipping category cover images
(`60099a4`…`02db4f1`); none of it blocks that feature, and the cache items carry
product trade-offs that need a decision rather than a quick patch.

---

## 1. How the storefront caches today

Every module in `apps/storefront/src/lib/data/` follows one pattern:

```ts
const next = { ...(await getCacheOptions("<tag>")) }
sdk.client.fetch(url, { next, cache: "force-cache" })
```

`apps/storefront/src/lib/data/cookies.ts`:

- `getCacheTag(tag)` → `""` when the `_medusa_cache_id` cookie is absent, else `` `${tag}-${cacheId}` ``
- `getCacheOptions(tag)` → `{}` when the tag is empty, else `{ tags: [cacheTag] }`

So the tag — and therefore the entire ability to invalidate — is **conditional on a
cookie that is not guaranteed to exist when the entry is written**.

`categories.ts` was already migrated off this pattern in `fab812f` (300s revalidate,
no `force-cache`). It is the template for the rest, and is out of scope here.

---

## 2. Verified Next.js 15.5.18 behaviour

### 2.1 Cache keys DO include request headers — no cross-user collision

Initial hypothesis was that per-user reads (`customer`, `orders`) could be
populated by user A and served to user B. **Refuted.**

- `next/dist/server/lib/patch-fetch.js:545` — `generateCacheKey(fetchUrl, init)`
- `next/dist/server/lib/incremental-cache/index.js:235` — headers normalised into the key
- `incremental-cache/index.js:240-264` — `sha256(JSON.stringify([...url, method, headers, ...]))`
- Only `traceparent`/`tracestate` are stripped (`index.js:237-239`)

The Medusa SDK passes a `URL` + init (not a `Request`), so `isRequestInput === false`
and `init.headers` reaches the key. Auth travels **only** as `Authorization: Bearer`
(`@medusajs/js-sdk/dist/esm/client.js:81-83` resolves `credentials: "omit"`; no cookie
is forwarded). Different JWT → different key.

Recorded so this hypothesis is not re-raised.

### 2.2 `force-cache` disables Next's own "never cache authorized fetches" guard

This is the real problem, and it is the inverse of the hypothesis above.

```js
// patch-fetch.js:355 — the guard exists
const hasUnCacheableHeader = initHeaders.get('authorization') || initHeaders.get('cookie')
```

It only fires through `autoNoCache` (`:375`), which requires `hasNoExplicitCacheConfig`
(`:369-374`). Passing `cache: "force-cache"` makes that `false`, opting out by hand.

What replaces it:

```js
// patch-fetch.js:343-345
if (currentFetchCacheConfig === 'force-cache' && typeof currentFetchRevalidate === 'undefined') {
    currentFetchRevalidate = false   // → INFINITE_CACHE
}
```

`INFINITE_CACHE = 0xfffffffe` (`next/dist/lib/constants.js:264`) ≈ **136 years**. No
`cacheHandler` is configured in `next.config.js`, so this is the default server-global
filesystem cache, shared across all requests and persisted to disk.

Consequences for `customer.ts:40`, `orders.ts:26`, `orders.ts:57`:

1. **Token revocation stops working.** Medusa JWTs are stateless and
   `sdk.auth.logout()` (`customer.ts:131`) performs no server-side revocation.
   Once cached, the profile, addresses and order history are served from disk
   without the backend ever being asked again — **the cache makes the
   authorization decision, not Medusa**.
2. **A leaked JWT replays indefinitely** instead of expiring with the token.
3. **Unbounded PII at rest.** Each login mints a new JWT → new key → another
   permanent copy. Nothing evicts.

`cookies()` does not save this: it marks the *render* dynamic, but the Data Cache is
independent (`patch-fetch.js:277-278`).

### 2.3 The tag-write window makes invalidation structurally dead

`apps/storefront/src/middleware.ts:122` sets the cookie on the **response**:

```js
response.cookies.set("_medusa_cache_id", cacheId, { maxAge: 60 * 60 * 24 })
```

It does not rewrite inbound request headers, so during the **first request of every
session** the RSC render sees no cookie → `getCacheTag` returns `""` → the fetch is
written with **zero tags at INFINITE_CACHE**. That entry is unreachable by
`revalidateTag` forever.

This is why adding TTLs alone is insufficient — it papers over permanently
unreachable entries.

### 2.4 Dead invalidation code

`revalidateTag("")` passes validation (only non-strings and over-length are rejected),
matches nothing, and logs nothing.

Unguarded call sites that can pass `""`:

- `customer.ts:57, 97, 117, 136, 141, 191, 210, 255`
- `cart.ts:82, 88, 148, 171, 174, 216, 219, 249, 252, 276, 279, 299, 349, 370, 373, 522, 532, 565, 569, 572`

Guarded against `""` but still unable to reach untagged entries:

- `locale-actions.ts:53, 60, 65, 70` (the `if (cacheTag)` pattern — the only file that got it right)

Dead even when the cookie is present (tag-name mismatch):

- `cart.ts:600` (`listCartOptions`) tags `shippingOptions`; every invalidator uses
  `fulfillment` (`cart.ts:148, 174, 219, 252, 279, 373`). Shipping options and their
  calculated prices are never invalidated.

Tags written with no invalidator anywhere in the repo: `variants`,
`payment_providers`, `locales`.

### 2.5 Dead auth guard

`customer.ts:20-22` and `variants.ts:11-13`:

```ts
if (!authHeaders) return null
```

`getAuthHeaders()` returns `{}` on the no-token path (`cookies.ts:12`), and `{}` is
truthy. `retrieveCustomer()` therefore fires an unauthenticated request for
logged-out visitors and swallows the 401 (`customer.ts:43`). Not a disclosure — but
the stated precondition is enforced nowhere.

### 2.6 Cookie hardening gap

`middleware.ts:122-124` sets `_medusa_cache_id` without `httpOnly` / `secure` /
`sameSite`, unlike `cookies.ts:54-59` and `:76-81` which set all three. It is not auth
state, but it *is* the cache-invalidation namespace selector: client-writable and
cross-site-sendable, so it can be pinned or collided to force or suppress a victim's
invalidation. Low exploitability, trivial fix, inconsistent with its own file.

---

## 3. Call-site inventory

16 sites outside `categories.ts`. (`middleware.ts:35` also uses `force-cache` but
pairs it with `revalidate: 3600` — the one correct usage in the repo.)

| file:line | fetches | per-user | risk | proposed action |
|---|---|---|---|---|
| `customer.ts:40` | `/store/customers/me` + orders | yes (JWT) | **CRITICAL** | remove caching |
| `orders.ts:26` | `/store/orders/{id}` + payments | yes (JWT) | **CRITICAL** | remove caching |
| `orders.ts:57` | `/store/orders` list | yes (JWT) | **CRITICAL** | remove caching |
| `cart.ts:51` | `/store/carts/{id}` + totals | yes (cart id) | **HIGH** | remove caching |
| `cart.ts:600` | `/store/shipping-options` | yes (cart id) | **HIGH** | remove caching |
| `fulfillment.ts:26` | `/store/shipping-options` | yes (cart id) | **HIGH** | remove caching |
| `products.ts:71` | products + price + inventory | partial | **HIGH** | TTL 60s; drop auth header |
| `variants.ts:33` | variant + inventory | partial | **HIGH** | TTL 60s |
| `payment.ts:24` | payment providers | no | MEDIUM | TTL 300s; drop auth header |
| `collections.ts:17,39,56` | collections | no | MEDIUM | TTL 300s |
| `regions.ts:16,30` | regions | no | MEDIUM | TTL 3600s (align with `middleware.ts:35`) |
| `locales.ts:24` | locales | no | LOW | TTL 3600s |
| `postal-code.ts:43` | SEPOMEX lookup | no | LOW | leave as-is — static dataset, no auth header, correct by design |

**Known cost of removing cache on cart/customer/orders:** checkout and account pages
get slower. That is the price of the backend re-authorizing every request, and it
needs to be an accepted trade-off rather than a surprise.

---

## 4. Seed script — the fix in `02db4f1` did not close the hole

`apps/backend/src/scripts/seed-product-categories.core.ts` claimed to end the
duplicate-category incident by replacing handle-based identity with an immutable
`metadata.__seed_key`. A follow-up review **executed** the scenarios against the
compiled core and reproduced the duplicate through the new code.

### 4.1 BLOCKER — `claimed` is dead on the primary lookup

`core.ts:178` / `:201`:

```ts
const matched = byKey.get(seed.key) ?? byHandle.get(seed.handle)   // claimed not consulted
claimed.add(matched.id)                                            // added after the fact
```

`claimed` is only read inside the `!matched` rename branch (`:183`), so two seeds can
bind to the same row. The wrapper writes sequentially, so the second overwrites the
first: the row's `__seed_key` is stolen, its cover replaced, and one category vanishes
for that run. On the next run the guard is silent (the row now carries *a* seed key,
so the `renamed` lookup at `:185` excludes it) and the duplicate is created.

**The trigger is the fix's own remediation text.** `core.ts:190-193` instructs the
operator to *"set `metadata.__seed_key="X"` on it to adopt it"*, which by construction
produces a row whose key and handle disagree.

Fix: consult `claimed` on the primary lookup, and reject a `byHandle` hit on a row
already carrying a *different* `__seed_key` — treating that as a conflict, not a create.

### 4.2 BLOCKER — the conflict guard is order-dependent

`core.ts:181-187` — `claimed` is mutated during `seeds.forEach`, so eligibility for the
rename check depends on array position rather than data.

Executed, same input row `{name:"Envases", handle:"cappuccinis", metadata:null}`:

| seed order | result |
|---|---|
| `[cappuccinis, envases]` | `conflicts: 0` → adopts as **cappuccinis** and **creates** a new "Envases" |
| `[envases, cappuccinis]` | `conflicts: 1` → throws, writes nothing |

With the **shipped ordering** the guard fails silently: a row
`{name:"Cappuccinis", handle:"frappuccinis"}` is stamped with the *frappuccinis*
identity and a near-duplicate "Cappuccinis" is created, `conflicts: 0`.

Fix: two passes — settle all unambiguous key/handle bindings first, then evaluate name
conflicts against the final `claimed` set. Pin with a test that shuffles
`CATEGORY_SEEDS` and asserts the plan is invariant.

### 4.3 CRITICAL — duplicate `__seed_key` routes the write to the wrong row

`core.ts:159-164` — `byKey.set(key, category)` is last-write-wins with no duplicate
detection. Two roots stamped with the same key produce a silent write to whichever
Postgres returned last. Fix: detect a second `set` for an existing key and conflict.

### 4.4 CRITICAL — the wrapper has zero tests

The 24 tests cover only the pure planner. Untested: the re-read + merge
(`seed-product-categories.ts:105-117` — the entire point of the commit), the conflict
gate (`:62-66`), failure collection (`:127-137`), and the create payload (`:76-91`).

`__tests__/seed-product-categories.core.unit.spec.ts:157` is a tautology:

```ts
expect(plan.toCreate[0]).not.toHaveProperty("rank")
```

`SeedCategory` has no `rank` field, so TypeScript already guarantees it. The real
contract lives in the workflow input the wrapper builds.

Fix: wrapper tests with a stubbed container (fake `query.graph` + mocked workflows)
asserting create payload shape, that the update uses the **re-read** value, mid-loop
failure handling, and that a conflict throws with no workflow invoked.

### 4.5 MAJOR — the roots filter turned a silent mis-write into an opaque crash

`core.ts:157`. `handle` is globally unique (`@medusajs/product` `product-category.js:42-46`,
partial unique index `WHERE deleted_at IS NULL`), so filtering to roots is correct in
intent. But a **subcategory** squatting a seed handle is now invisible to the planner:
the seed plans a create, `createProductCategoriesWorkflow` submits all nine in one
batch, the unique violation rolls back the whole batch, and the script dies before any
update runs — with a raw constraint error naming neither the offender nor the remedy.
No run can succeed until a human finds it.

Fix: keep the roots filter for matching, but scan the full `existing` list for a
non-root holding any handle in `toCreate` and emit a named conflict.

### 4.6 WARNING — renaming both handle and name still duplicates

Executed: `{name:"Frapes", handle:"frapes", metadata:null}` vs the `frappuccinis` seed
→ `toCreate: [frappuccinis]`, `conflicts: 0`.

Defensible — "renamed" and "absent" are genuinely undecidable — but it is the residual
of the CRITICAL the commit claims to close, and it is neither documented nor pinned.
Note the exposure covers the entire pre-adoption population: a store seeded by the old
version has no seed keys at all until a successful run stamps them.

### 4.7 WARNING — one conflict blocks hardening the other eight

`seed-product-categories.ts:62-66` throws before any write. A conflict is exactly when
the healthy categories most want their immutable key stamped; instead they stay
handle-fragile until a human resolves an unrelated row.

### 4.8 WARNING — "Updated X" is logged for writes that did not happen

`updateProductCategoriesWorkflow` does not throw on a zero-match selector; it returns
`[]` (`core-flows/product-category/steps/update-product-categories.js`). A row deleted
between plan and write yields `fresh[0]?.metadata ?? {}`, matches nothing, and still
logs success. (The feared `{...{}, ...patch}` clobber does **not** occur — the same
disappearance empties the update selector.) Fix: assert on the returned array length.

### 4.9 SUGGESTION — the re-read narrows the race, it does not close it

A window remains between `query.graph` and the workflow run, with no compare-and-swap.
Acceptable for an operator-invoked script, but `seed-product-categories.ts:99-107`
presents it as a fix rather than a mitigation.

---

## 5. Pre-existing, unrelated

- **CI is red.** `pnpm test:unit` → 1 failed / 490 passed, in
  `src/modules/openpay-payment/__tests__/service.unit.spec.ts:363` (`use_3d_secure`
  expected `true`, got `false`). Introduced by `656ad2c`, before any of this work —
  which means the 24 category tests have never been validated by a green pipeline.
- `next.config.js:19-24` disables ESLint and TypeScript at build
  (`ignoreDuringBuilds`, `ignoreBuildErrors`). Item 2.5 is exactly the class of bug a
  type-aware lint rule catches.

**Secrets sweep: clean.** No hardcoded credentials in `apps/storefront/src`,
`.env.local` gitignored, no `dangerouslySetInnerHTML`, no SQL/command concatenation.

---

## 6. Suggested sequencing

1. `middleware.ts:122` — set the cookie on the **forwarded request**
   (`NextResponse.next({ request: { headers } })`) plus `httpOnly`/`secure`/`sameSite`.
   Everything else is cosmetic until entries stop being written untagged.
2. Remove `force-cache` from `customer.ts`, `orders.ts` — stale-auth on PII.
3. Remove `force-cache` from `cart.ts`, `fulfillment.ts` — a stale cart reaches
   `placeOrder` (`cart.ts:508`) and charges the wrong total.
4. Rework the seed planner (4.1–4.5) — future risk only; the database is correct today.
5. TTLs for the remaining public reads.
6. Fix the openpay unit test to get CI green again.

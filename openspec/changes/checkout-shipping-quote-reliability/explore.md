# Exploration: checkout-shipping-quote-reliability

**Phase**: sdd-explore · **Scope**: solution space only — the diagnosis was delivered as verified fact
and is NOT re-derived here.

> Every file:line reference below was read in this phase. Where I state something I could NOT verify,
> it is labelled **UNVERIFIED** and carried into §9 as an open question for design. I did not run the
> backend, did not call Skydropx, and did not re-measure anything.

---

## 0. The reframe that changes the answer

The stated concern is *"naively raising the budget to ~15s means the customer stares at a spinner for
12 seconds during checkout."*

**That premise does not hold against the code.** The storefront already quotes in the background,
and it already starts as early as it possibly can.

Verified chain:

1. `checkout-reducer.ts` `commitDraft` (`:279-321`) recomputes `quoteSignature` on **every** draft
   commit.
2. `buildQuoteSignature` (`shipping-quote.ts:127-152`) needs only `country_code | postal_code |
   province | city`. It deliberately excludes street and colonia (`:14-39`).
3. `CP_LOOKUP_FOUND` (`checkout-reducer.ts:503-548`) fills `province` + `city` from the offline
   SEPOMEX dataset. So the signature completes **the moment the postal code resolves** — before the
   customer has typed a phone, chosen a payment method, or entered card details.
4. The requote effect (`checkout-context.tsx:366-497`) arms a `QUOTE_DEBOUNCE_MS = 600` trailing
   debounce off that signature and then runs the whole round asynchronously. Nothing in the form is
   blocked while it runs — the customer keeps typing.
5. `calculatePriceForShippingOption` (`lib/data/fulfillment.ts:175-230`) carries **no
   `AbortSignal`** — verified by reading the whole function. Unlike `listCartShippingMethods`
   (`:118-133`, `AbortSignal.timeout(5_000)`), the calculate call has no storefront-side deadline at
   all. A 20 s backend response would reach the browser intact.

So the asynchronous pre-warm the request asks for is **already built and already correct in shape**.
What is missing is not a new async mechanism. It is that:

- **the 8 s server budget kills the background quote before it can ever pay off** (finding 1), and
- **the background quote fires on a payload that is guaranteed to be rejected**, because the colonia
  has just been wiped (findings 2 + 3), and
- **`buildQuoteSignature` does not include the colonia**, so when the customer finally picks one, the
  signature does not move and **no requote is ever triggered**. This is a NEW consequence that falls
  straight out of findings 2+3 and is load-bearing: fixing the colonia retention and the backend
  requirement *without* touching the signature leaves the quote permanently parked on the pre-colonia
  failure.

The 12 s is therefore spent in parallel with typing **today**, not after it. The customer only stares
at a spinner if they finish the whole form in under ~12 s, which for an address + phone + card is not
the common case. The correct move is to let the background quote finish and to stop wasting its head
start on a doomed request — not to build a second async transport.

### Correction to a docstring that is now falsified

`shipping-quote.ts:14-39` states, as the justification for excluding `address_2` from the signature:

> *"the carrier's quote path reads country, postal code, state and city off the destination. **No
> street, no colonia**, no name, no phone."*

Verified finding 2 falsifies the colonia half of that claim: Skydropx PRO returns
`422 {"errors":{"address_to":{"area_level3":["no puede estar en blanco"]}}}`. That docstring is not
decoration — it is the recorded reasoning for a decision this change must reverse. It has to be
**corrected in place with the new evidence**, not silently contradicted. The street half of the claim
is untouched and stays.

---

## 1. Current state — what already exists and is the right shape

| Machinery | Where | Verdict |
|---|---|---|
| Debounced background requote | `checkout-context.tsx:366-497` | **Keep.** Already fires on signature completion, already non-blocking. |
| Signature / supersession | `shipping-quote.ts:127-231`, reducer `commitDraft` | **Keep, extend.** Needs colonia as a component. |
| In-flight + terminal-dispatch guarantee | `checkout-context.tsx:462-485` | **Do not touch.** The unconditional `QUOTE_READY` dispatch exists because a `cancelled` early-return permanently leaked `inFlightSignature`. |
| Serialised single cart writer | `checkout-write-scheduler.ts` | **Keep.** `persistNow()` is already awaited by the requote path; a second writer re-opens the `em.create` PII-destruction path. |
| Failure parking | `selectQuoteIsBlockedByFailure` (`checkout-reducer.ts:~955`) + `QUOTE_RETRY` (`:719-720`) | **Keep.** Without it a failed address retries in a tight loop, one live carrier quote per pass. |
| Shared-deadline client with `budgetBound` provenance | `client.ts:459-470`, `:546-560` | **Keep.** This is what makes "our budget died" distinguishable from "Skydropx was slow" — exactly the distinction this change is about. |
| Lazy container access seam | `lib/provider-credentials.ts:57-62` — `container.resolve(key, { allowUnregistered: true })` from `@medusajs/framework`, per operation, fail-safe to `null` | **Copy this.** It is the proven pattern for reaching a module from inside a provider without touching the container at construction time. |
| Custom public store route precedent | `api/store/postal-codes/[code]/route.ts` | **Exists.** A two-phase quote route would follow it. |
| Redis infra | `medusa-config.ts:35-52` — `cache-redis`, `event-bus-redis`, `workflow-engine-redis`, all conditional on `REDIS_URL`; `docker-compose.yml:47-65` runs `mandi-redis` | **Available.** Falls back to in-memory when `REDIS_URL` is unset (local + CI). |

### Budget asymmetry, verified by arithmetic

```
CREDENTIAL_RESOLUTION_TIMEOUT_MS      = 3_000   (lib/provider-credentials.ts:28)
STOCK_LOCATION_RESOLUTION_TIMEOUT_MS  = 3_000   (lib/stock-location-address.ts:76)
PRE_ANCHOR_BUDGET_MS                  = 6_000   (service.ts:175)
ASSUMED_GATEWAY_TIMEOUT_MS            = 60_000  (default; SKYDROPX_GATEWAY_TIMEOUT_MS absent from .env.template)
SKYDROPX_FULFILLMENT_BUDGET_MS        = floor(60_000 * 0.9) - 6_000 - 10_000 = 38_000
LABEL_QUOTE_BUDGET_MS                 = floor(38_000 * 0.45)                 = 17_100
```

**The admin label path already grants the identical `quoteAndPoll_` call ~17.1 s. The checkout path
grants it 8 s.** Same function, same carrier, same polling loop. The 8 s is not a considered
trade-off against 17.1 s — it is an unmeasured literal (`client.ts:36`), and the docstring at
`client.ts:15-16` presents it as a designed fact (*"8s on the checkout path, where a shopper is
waiting"*). That docstring is the second artefact this change has to correct rather than contradict.

Also verified: `calculatePrice` anchors its deadline at `service.ts:815`, **after**
`requireConfig_()`. Credential resolution is outside the 8 s. The 8 s covers OAuth token + create +
poll only, which matches the measurements.

---

## 2. Approach comparison — the async / pre-warm question

### A. Calibrate the budget (the baseline, explicitly rejected as a *complete* answer)

| | |
|---|---|
| **What** | Raise `SKYDROPX_QUOTATION_TIMEOUT_MS` from 8 s to a measured value; derive it rather than hardcode. |
| **Pros** | Smallest possible diff. No new transport, no new cache, no new failure mode. Storefront needs zero changes — verified no client-side abort exists on the calculate path. Restores parity with a budget the admin path already uses successfully. |
| **Cons** | Does nothing for the cold-vs-warm asymmetry. Every first-visit-to-a-destination still pays ~12 s. Latency is *moved*, not removed. |
| **Effort** | Low |
| **Unblocks purchase?** | **Yes**, for carts whose `address_2` is already populated (returning customers with a saved colonia, and anyone who picks a colonia before the requote fires). |

This was rejected as the whole fix, and correctly. But it is not optional and it is not a hack — it is
the arithmetic floor. A budget smaller than the carrier's own completion time is a defect regardless
of what else is built on top.

### B. Backend quotation cache keyed on `origin | destination | parcel`

| | |
|---|---|
| **What** | Short-TTL server-side cache in front of `quoteAndPoll_`. Key = normalized `address_from ⨯ address_to ⨯ parcel`. Explicitly **not** cart-scoped — cross-customer sharing is the entire value. |
| **Pros** | Turns a 12 s cold path into a sub-millisecond warm path for the second and every subsequent customer shipping to the same colonia with the same parcel. A small catalogue means the parcel dimension set repeats heavily. Independent of any storefront change. Also protects the 2 req/s carrier cap. |
| **Cons** | Does **not** help the first customer to a new destination — that is the case finding 1 says fails *by construction*. Introduces a staleness window on a price we then sell. Needs an invalidation story for a carrier price change. |
| **Effort** | Medium |
| **Unblocks purchase?** | **No, on its own.** It converts "every new destination fails" into "every new destination is slow, once". It is a multiplier on A, never a substitute. |

**Where it lives.** In the `skydropx-fulfillment` module, behind a seam of the same shape as
`credentialSource_` / `stockLocationSource_` (`service.ts:682-699`): an injectable
`options.quoteCacheSource`, defaulting to a factory that lazily resolves the cache module from the
global container with `allowUnregistered: true`. That keeps the constructor container-free (the
recorded reason: *"module load order at boot is not guaranteed"*, `service.ts:692-694`) and keeps the
whole thing unit-testable with a fake, which strict TDD requires.

**Redis vs in-process.** `cache-redis` is already registered whenever `REDIS_URL` is set and the
in-memory default applies otherwise (`medusa-config.ts:35-41`). Using the Medusa cache module rather
than a hand-rolled `Map` therefore gets both behaviours for free and matches the existing deployment
posture exactly. An in-process `Map` would be per-replica, which defeats the point the moment there is
more than one backend container — and the config file's own comment already anticipates that scaling
step. **Recommend the cache module.**

### C. Two-phase kick-off + poll through a custom store route

| | |
|---|---|
| **What** | `POST /store/shipping-quotes` to kick off, `GET /store/shipping-quotes/:id` to poll. Storefront drives it through `sdk.client.fetch` (precedent: `getPostalCode` → `api/store/postal-codes/[code]/route.ts`). |
| **Pros** | The only design that never holds an HTTP connection open for 12 s. Allows honest progress reporting. |
| **Cons** | **Does not replace the synchronous path.** `POST /store/shipping-options/:id/calculate` is synchronous per Medusa's contract, and `refreshCartShippingMethodsWorkflow` re-invokes `calculatePrice` whenever a shipping method is set on the cart. So the provider path still has to complete inside a budget regardless — you end up maintaining two quote paths, and the one that actually prices the cart at selection time is still the synchronous one. |
| **Effort** | High |
| **Unblocks purchase?** | No — and it cannot, without A. |

**The honest framing:** C is not an alternative to B, it is *a way to warm B's cache earlier*. C
without B is two code paths and no speedup on the path that matters. **Defer it behind a
measurement** (§8, S6).

### D. Event-driven pre-warm via a `cart.updated` subscriber

| | |
|---|---|
| **What** | `event-bus-redis` is registered. A subscriber warms B's cache off-band on the address write. |
| **Pros** | Zero storefront code. The autosave (`AUTOSAVE_DEBOUNCE_MS = 400`) fires *before* the requote (`QUOTE_DEBOUNCE_MS = 600`), so the subscriber gets a head start by construction. |
| **Cons** | With today's constants that head start is **200 ms** — not the 12 s the request is after. It only becomes meaningful if the debounces are re-tuned, and every blur is an address write, so a naive subscriber fires live carrier quotes on partial addresses against a 2 req/s cap. |
| **Effort** | Medium |
| **Unblocks purchase?** | No. |

**Verdict: not now.** It is a refinement of B once B exists and once there is a measurement saying the
remaining latency is worth it.

### Recommendation

**A (calibrated, derived) + B (cache module), in that order. C and D deferred behind a measurement.**

Single strongest reason: **the pre-warm the request asks for already exists in the storefront and is
already firing at the earliest possible moment — it is being thrown away by an 8 s budget that the
admin path already proves should be ~17 s.** Building a second async transport to solve a latency
problem caused by a budget that is arithmetically incapable of completing the call would add a whole
parallel quoting path and still leave the synchronous path — the one that prices the cart when the
customer actually picks a method — broken.

---

## 3. Budget calibration

Measured cold completions: **12811 ms, 11353 ms, 12043 ms** (three destinations). Max observed 12.8 s.

Three samples is **not a p99**, and a budget must cover p99, not p50. Setting the budget at 13 s
because 12.8 s was the worst of three would re-create today's failure at a lower rate — which is
strictly worse than today, because a low-rate failure is the one nobody reproduces.

**Recommended shape (numbers are design's to fix, the discipline is the point):**

1. Introduce an explicit, documented, measured constant — e.g. `SKYDROPX_QUOTE_COMPLETION_P99_MS` —
   carrying the observation and its date. Budgets are **derived from it with headroom**, never
   written as bare literals. The codebase already has this discipline on the label side
   (`LABEL_QUOTE_BUDGET_MS = floor(SKYDROPX_FULFILLMENT_BUDGET_MS * 0.45)`, `service.ts:266-267`);
   the checkout side is the one place that skipped it.
2. Add a load-time guard, in the style of `readGatewayTimeout` (`service.ts:213-228`), that refuses
   or loudly warns on any quote budget below that constant. **8 s was reachable precisely because
   nothing could contradict it.**
3. Target for the checkout budget: **~20 s** (measured max ≈ 12.8 s + ~55 % headroom). Below 15 s and
   you are betting against the observed distribution with three samples.

**Should the storefront and label paths share one constant? No — they should share a floor.**

They have genuinely different remaining-work profiles: the label path must still fund
shipment create + poll + a containment cancel after the quote, which is exactly why
`LABEL_QUOTE_BUDGET_MS` is a *fraction* of `SKYDROPX_FULFILLMENT_BUDGET_MS`. The checkout path has
nothing after the quote. Collapsing them to one number would either starve the label path or
over-grant the checkout path. What they must share is the **floor**: no budget anywhere may be
arithmetically incapable of completing a quotation. That is the invariant the guard in (2) encodes.

**UNVERIFIED and blocking for the number:** whether the reverse proxy / platform in front of the
backend will hold a ~20 s response open on `POST /store/shipping-options/:id/calculate`.
`ASSUMED_GATEWAY_TIMEOUT_MS = 60_000` is, by its own name and its docstring, an *assumption* used for
the admin path. And whether the storefront's deploy target caps the server-side execution of the
requote effect's awaited `calculatePriceForShippingOption` — there is no client-side abort (verified),
so the platform limit is the only bound. Both must be measured in design before a number is fixed.

---

## 4. Colonia as a first-class required field — where enforcement goes

Not one layer. **Three, each with a different job**, and the form is already correct.

### 4.1 Storefront signature — `buildQuoteSignature` (`shipping-quote.ts:127-152`)

Colonia must become a signature component. This is what makes the background quote fire *when it can
succeed* and re-fire *when the colonia changes*.

Two variants, and the choice is a real one:

- **(i) Colonia as a full component** — the signature is `null` until a colonia exists and moves when
  the colonia moves. Safe. Cost: a colonia change spends a live carrier quote. Colonia is a dropdown
  picked once, so the cost is near zero.
- **(ii) Colonia required for non-null, but its *value* excluded from the join** — colonia A → B does
  not requote. Cheaper, but it risks selling a price quoted for a different `area_level3`. Only
  defensible if `area_level3` provably cannot move the rate, which is **UNVERIFIED** (§9).

**Recommend (i)** until (ii) is proven safe. `isQuotable` is *defined as* signature existence
(`:160-164`), so this keeps quotability and the requirement in exactly one place, which is the
property that docstring was written to protect.

**Product consequence that must be recorded, not slipped in:** requirement R4's promise degrades from
*"a postal code alone shows a price"* to *"a postal code plus a colonia shows a price"*. In the form
the colonia field is the **very next control after the postal code** (`shipping-address/index.tsx:163-211`),
so the delay is a couple of seconds of human time in exchange for a request that can actually succeed.
This is a spec change and belongs in the delta spec.

### 4.2 Storefront readiness — `checkout-readiness.ts`

Colonia gets **its own `MissingRequirementCode`**, not a fold into `shipping_address`. The `phone`
rule (`:218-255`) is the exact template and the exact same class of failure: *a field the carrier
requires, whose absence produces an order that can never be labelled*. Its docstring is explicit that
it was given its own code *"so the customer is told which single field to fix, instead of being sent
to re-read an address that is already correct."* Same reasoning, same shape.

Adding a code is a spec change — the catalogue's order is asserted (`:74-90`) and the order matches
page position, so `colonia` slots between `shipping_address` and `billing_address` or inside the
address group. Design's call.

### 4.3 Backend — `toAddress` (`service.ts:431-456`) and the origin

`toAddress` today builds an address we **know** the carrier will reject, then spends a network
round-trip discovering it. That must stop. But `toAddress` is **shared by origin and destination**
(`:798`, `:806`), and `missingOriginFields`' docstring (`:522-536`) explicitly and deliberately
tolerates a missing origin colonia:

> *"`reference` (colonia) and `tax_id_number` are deliberately NOT enforced: the quote path already
> treats the colonia as best-effort… so hard-failing on them would block origins PRO accepts today."*

That reasoning is now falsified by the same 422 (`address_from.area_level3` is named in it too), but
hard-requiring inside the shared `toAddress` would break every stock location without an `address_2`.
So:

- **Destination**: hard-required. `calculatePrice` throws `INVALID_DATA` with an actionable message
  naming the colonia, *before* any network call — the same discipline `buildParcel`'s
  `MissingDimensionsError` already uses (`:788-796`).
- **Origin**: an explicit `originColonia` provider setting with a `withOriginColonia_` fallback,
  **mirroring `withOriginZip_` (`:1435-1448`) exactly**. There is a precedent to copy verbatim, right
  down to the whitespace-trim guard (`:1442-1446`) and the `ORIGIN_FIX_HINTS` entry (`:596-598`).
  The origin currently passing "by luck" on `laddr_01KVBXQ47PRFFTWYFCZMVHJ26W`'s `address_2 = "Valle
  de Aragón"` is exactly the kind of accidental dependency that constant exists to remove.
- `missingOriginFields` / `missingDestinationFields` / both hint maps gain the field, and the
  falsified paragraph in that docstring is rewritten with the 422 as its evidence. Note
  `missingOriginFields` is pinned against `PROVIDER_FORMS.skydropx` by
  `provider-settings/__tests__/origin-contract.unit.spec.ts` in **both directions** (`:532-535`) — a
  field this guard hard-requires must be marked required in the admin form. That test will go RED and
  that is the intended signal.

### 4.4 The form — already correct, no change needed

Verified: `required` is present on **both** branches — the colonia `<NativeSelect>`
(`shipping-address/index.tsx:190`) and the free-text `<Input>` fallback (`:208`). The form is not the
bug. The bug is that the value is emptied out from under a field that already demands it.

### 4.5 Finding 3 is a hard prerequisite

None of 4.1–4.3 is reachable if the colonia list is wiped one tick after it arrives. The intent of
`selectShouldLookUpPostalCode` (`checkout-reducer.ts:931-943`) is right and its docstring records a
real regression (`CP_LOOKUP_FOUND` rewriting `"CDMX"` → `"Ciudad de México"` on mount, moving the
signature and dropping a returning customer's selection). **Do not weaken that guard.**

The defect is narrower: `CP_LOOKUP_RESET` (`:569-572`) collapses two different statements into one
action — *"no lookup is in flight"* and *"there is no list to show"*. The effect
(`checkout-context.tsx:265-275`) even documents that it reaches this branch for two different reasons,
and then dispatches the same thing for both.

**Recommended fix, in the reducer where it can be tested:** split the action. A new pure selector —
`selectPostalCodeIsUsable(state)` — decides which of two actions the effect dispatches:

- postal code not usable at all → clear `cpStatus` **and** `colonias` (today's behaviour);
- postal code usable, lookup simply not needed again → clear `cpStatus` only, **keep `colonias`**.

No regression for the returning-cart case: `initFromServer` seeds `colonias: []` (`:389`), so a
returning complete address has nothing to preserve, and its saved colonia already renders as free text
through `coloniaManual` (`:544-545`). This keeps the rule in the reducer — which is the whole stated
division of labour (`checkout-context.tsx:50-59`: *"anything resembling a rule that ends up in this
file is a rule that has escaped verification"*).

Alternative considered and rejected: remembering in `selectShouldLookUpPostalCode` that a lookup
already succeeded. It adds state to a pure selector to work around a mis-shaped action, and the
mis-shaped action is the actual defect.

---

## 5. Partial-failure presentation

### 5.1 The bug in finding 4 is in the caller, not in `classifyQuoteResult`

`classifyQuoteResult` (`shipping-quote.ts:293-327`) answers a narrow, correct question: *did the
**calculated** subset produce any price?* Its docstring is explicit that flat rates are excluded
**from the judgement** deliberately, *"so an empty price map says nothing about them"* — and that is
right.

The defect is that `checkout-context.tsx:457-460` treats that narrow answer as *"the whole round
failed"*, which then makes `selectQuoteStatus` report `failed`, which makes `selectShippingChoices`
return `[]` (`checkout-reducer.ts:~858`). A perfectly sellable flat `Gratis` option is withheld while
the screen says shipping cannot be calculated.

The function already encodes the right intuition one line up: `if (calculated.length === 0) return
"priced"` (`:309-311`) — an all-flat store is fine. It simply does not extend that to a **mixed**
store. The change is one condition: *is any option presentable at all?* — not *did the calculated
subset price?*

This is the smallest and cheapest revenue unblock in the entire change, and it has **no backend
dependency whatsoever**. It lets `Gratis` sell even while Skydropx is completely down.

### 5.2 What the customer should see

The right model is already half-built. `selectShippingChoices`' own docstring
(`checkout-reducer.ts:~838-852`) states the per-row rules correctly: *"Unpriced rows are RETURNED,
not filtered. The section renders them without an amount and unselectable — which is the honest
statement."* The list-level model just has not caught up with the row-level one.

**Three distinguishable customer situations, and they must not read alike:**

| Situation | Today | Should be |
|---|---|---|
| No options at all for this address | `not_serviceable` | unchanged — correct |
| Options exist, **none** priceable (catalogue data problem) | `failed` | unchanged — correct, and `classifyQuoteResult`'s docstring at `:251-272` explains exactly why this must not read as "wrong address" |
| Options exist, calculated ones failed, **a flat one is sellable** | `failed`, empty list | **list renders**, flat options selectable, calculated rows unpriced/unselectable, plus an inline note that live carrier rates are unavailable |

**Should `QuoteStatus` gain a seventh value?** Two candidates:

- **(a) New `partially_quoted` status.** Explicit. But `QuoteStatus` is rendered by an exhaustive
  switch in `shipping-section/index.tsx:241-281` whose docstring says *"exactly one … on screen, and
  always one"* — a seventh value touches every branch and every assertion.
- **(b) Stay at `quoted`, add a separate additive selector** (e.g. `selectCarrierRatesUnavailable`)
  that the section renders as a banner above an otherwise-normal list. The status set stays a
  six-value exhaustive switch; the new fact is orthogonal, which it genuinely is — "some carriers did
  not answer" is not a *state*, it is an *annotation on the quoted state*.

**Lean (b)** — smaller blast radius, and it composes with the per-row unselectable rendering that
already exists. But it is a design call and both belong in the delta spec.

**Note on the storefront's blindness.** `calculatePriceForShippingOption` catches everything and
returns `null` (`lib/data/fulfillment.ts:203-229`), so the storefront cannot tell a budget timeout
from a no-coverage answer from a missing-dimensions error. It logs `describeError(error)` server-side
but discards the discrimination. If the banner copy in (b) is to be more specific than *"carrier rates
unavailable"*, that discrimination has to survive the catch — which is its own (small) slice and a
design decision about how much upstream detail may reach a public storefront. The backend's
storefront-audience redaction (`service.ts:1473-1474`) is deliberate and must not be loosened; the
distinction would have to come from the HTTP status or an explicit non-secret error code, not from the
message.

---

## 6. Slice boundaries — chained PRs, stacked to main, 400-line budget

**Forecast: the full change is well over 400 lines. Chained delivery is correct, not optional.**

Ordering principle: because stacked-to-main means main is partially fixed between merges, **the
slices that unblock purchase go first**, and every intermediate state must be defensible on its own.

| # | Slice | App | Est. lines | Independently shippable? | Unblocks purchase? |
|---|---|---|---|---|---|
| **S0** | **Flat-option rescue** — `classifyQuoteResult` sees the whole option set; caller stops turning it into `QUOTE_FAILED`; the "carrier rates unavailable" annotation | storefront | ~120 | **Yes** — zero backend dependency | **YES — immediately, for any cart with a flat option. Ship this first.** |
| **S1** | **Budget calibration** — measured constant + derived checkout budget + load-time floor guard; correct `client.ts:15-16` and `:36` docstrings | backend | ~100 | Yes | **YES — for carts whose `address_2` is already populated (returning customers, saved addresses).** |
| **S2** | **Colonia retention** — split `CP_LOOKUP_RESET`, add `selectPostalCodeIsUsable`, keep the mount guard intact | storefront | ~150 | Yes — a colonia that survives is only ever an improvement | No, but it is the prerequisite for S3 |
| **S3** | **Colonia as quote-relevant + required** — signature component, readiness code + message, correct the falsified `shipping-quote.ts:14-39` docstring | storefront | ~180 | Yes, **but only on top of S2** | No — and it makes main **stricter** (see below) |
| **S4** | **Backend colonia enforcement** — destination `area_level3` required with an actionable pre-flight message; `originColonia` setting + `withOriginColonia_` mirroring `withOriginZip_`; extend both missing-field guards and both hint maps | backend | ~200 | Yes | No — changes *which* error you get, not whether you get one |
| **S5** | **Quotation cache** — `quoteCacheSource` seam, key normalization, TTL, fail-open | backend | ~250 | Yes | No — pure latency multiplier |
| **S6** | **(deferred, NOT in this change)** two-phase route / subscriber pre-warm | both | — | Gate on a measurement after S1+S5, not on a guess | — |

### Explicit call-outs about intermediate main states

- **S0 is the emergency slice.** It is small, storefront-only, has no carrier dependency, and it makes
  free shipping sellable *even while Skydropx is completely down*. Everything else can slip; this
  should not.
- **S1 before S4 is deliberate.** It means main will briefly spend up to ~20 s on requests that still
  422 for empty-colonia carts. The cost is added latency on a path that **already fails today** — not
  new breakage. In exchange, the returning-customer cohort is unblocked days earlier. If the team
  disagrees, swapping S1 and S4 is safe; the reverse order costs revenue, not correctness.
- **S3 makes main stricter and that is intentional.** After S3, carts that could previously reach the
  CTA without a colonia can no longer do so. Those carts were producing orders Skydropx can never
  label — the exact class of failure the `phone` rule was added for. It is still a real behavioural
  narrowing and must be stated in the proposal, not discovered in production.
- **S2 → S3 is a hard dependency.** S3 alone (colonia in the signature, colonia retention still
  broken) would make the signature permanently incomplete and stop quoting entirely. **Do not land S3
  without S2.**
- **S5 last on purpose.** It is the only slice with no correctness content. If the budget runs out, it
  is the one to drop.

### Strict TDD per slice

Both apps, RED first, no production code before a failing test.

| Slice | Command | Landing spot |
|---|---|---|
| S0 | `pnpm --filter @dtc/storefront test` | `lib/util/shipping-quote.spec.ts` (extend) |
| S1 | `pnpm --filter @dtc/backend test:unit` | `modules/skydropx-fulfillment/__tests__/constants.unit.spec.ts` + `client.unit.spec.ts` |
| S2 | `pnpm --filter @dtc/storefront test` | `modules/checkout/state/checkout-reducer.spec.ts` (extend) |
| S3 | `pnpm --filter @dtc/storefront test` | `lib/util/shipping-quote.spec.ts` + `lib/util/checkout-readiness.spec.ts` |
| S4 | `pnpm --filter @dtc/backend test:unit` | `modules/skydropx-fulfillment/__tests__/service.unit.spec.ts` + `provider-settings/__tests__/origin-contract.unit.spec.ts` (**will go RED — that is the signal**) |
| S5 | `pnpm --filter @dtc/backend test:unit` | new `__tests__/quote-cache.unit.spec.ts`, driven through a fake cache source |

Harness constraints confirmed: backend jest `TEST_TYPE=unit` matches
`**/src/**/__tests__/**/*.unit.spec.[jt]s`, `testEnvironment: "node"`. Storefront vitest is node-only,
`include: ["src/**/*.spec.{ts,tsx}"]`, aliases `@lib` / `@modules` / `@pages`. **No jsdom, no
`@testing-library`, Playwright an explicit non-goal** — so every rule in this change must land in a
pure module, never in a `.tsx`. `checkout-context.tsx` is untestable by construction and its own
docstring says so.

---

## 7. Conflict with `openspec/changes/skydropx-webhook-and-carrier-selection/` — **CONFIRMED, REPORT**

Different scope, but a **real and specific merge-conflict surface**. That exploration's §8.1 plans to
thread `requested_carriers` into the quotation body literal, naming:

> `| calculatePrice (checkout quote) | service.ts:816–829 | "storefront" |`

**`service.ts:816-829` is the exact block S1, S4 and S5 rewrite** — the deadline anchor, the address
construction, and the cache lookup all sit there. Additional overlap:

- `fetchUsableRates_` (`service.ts:1454-1487`) — their OQ-11 proposes changing the admin-audience
  message; our §5 reads the storefront-audience redaction at `:1473-1474`. Adjacent lines, same
  function.
- `modules/skydropx-fulfillment/__tests__/service.unit.spec.ts` — both changes extend it.
- `types.ts:95` `requested_carriers` is theirs; our cache key normalization must account for it, or a
  carrier-restricted quote and an unrestricted one will collide on the same cache key. **If they land
  first, `requested_carriers` is a mandatory cache-key component.**

**Recommendation:** land this change first — it is a revenue stopper, theirs is a feature — and have
the webhook change rebase. If sequencing goes the other way, S1/S4/S5 must rebase onto their body
literal and S5's key must include `requested_carriers`. Either way, **the two must not be developed in
parallel against the same block.**

Their exploration is untracked and out of scope. **Nothing in it was modified.**

---

## 8. Risks

1. **The budget number is set from three samples.** Three cold measurements (11.4–12.8 s) are not a
   p99. A budget chosen from them will fail at a lower, harder-to-reproduce rate. **Widen the sample
   before fixing the number.**
2. **Platform response limits are unmeasured.** A ~20 s synchronous `POST
   /store/shipping-options/:id/calculate` may be cut by a proxy or a serverless execution cap on
   either app. If it is, approach C stops being deferrable. **Measure before committing to A.**
3. **S3 narrows what can be purchased.** Intentional, but real. Any cohort mid-checkout when it lands
   will find the CTA newly blocked until they pick a colonia.
4. **Cache staleness sells a price.** A cached rate is a price the customer is charged. TTL is a
   revenue decision, not a performance knob.
5. **The heavily-commented guards are load-bearing.** `?? null` never `?? 0`
   (`checkout-context.tsx:432-441`), the unconditional terminal dispatch (`:462-485`), the controlled
   RadioGroup, `hasShippingMethod: (… ?? 0) > 0` failing closed
   (`checkout-readiness.ts:431-437`), the single-writer scheduler. Each records a specific past
   regression. **None of the proposed slices requires touching any of them — if a slice starts to,
   that is the signal the slice is wrong.**
6. **Merge conflict with the webhook change** — §7. Concrete, not hypothetical.
7. **`origin-contract.unit.spec.ts` will go RED in S4** by design (it pins the origin guard against
   the admin form in both directions). Landing S4 without also marking the colonia required in
   `PROVIDER_FORMS.skydropx` will not compile past that test — which is the guard working.
8. **Cache module resolution from inside a fulfillment provider is UNVERIFIED** (§9). If it does not
   resolve, S5 falls back to a per-replica in-process cache, which is materially weaker under more
   than one backend container.

---

## 9. Open questions for design — things I could NOT verify

1. **Does `container.resolve(Modules.CACHE, { allowUnregistered: true })` actually return the cache
   service from inside a fulfillment *provider's* execution context?** The credential seam
   (`lib/provider-credentials.ts:57-62`) proves the *mechanism* — global container, lazy,
   `allowUnregistered` — but it resolves a **custom module key** (`"providerSettings"`), not a Medusa
   infrastructure module. I did not run this. **Needs a runtime probe before S5 is designed.**
2. **Will the backend's reverse proxy / platform hold a ~20 s response open** on `POST
   /store/shipping-options/:id/calculate`? `ASSUMED_GATEWAY_TIMEOUT_MS = 60_000` is an assumption by
   its own name and is used for the admin path only.
3. **Does the storefront's deploy target cap server-side execution** of the requote effect's awaited
   `calculatePriceForShippingOption`? There is no client-side abort (verified), so the platform limit
   is the only bound and I do not know it.
4. **Does `area_level3` affect the rate *value*, or only pass validation?** If only validation, §4.1
   variant (ii) becomes available and requoting gets cheaper. Untested.
5. **What is Skydropx's server-side quotation cache keyed on, and what is its TTL?** One warm
   observation (0.996 s) on one payload. Our TTL cannot be derived from theirs.
6. **Is the 2 req/s rate limit accurate and per-account or per-endpoint?** It is asserted in
   `client.ts:48` and it constrains any pre-warm design. I did not re-verify it.
7. **True p99 of cold quotation completion** — see risk 1.
8. **Does `refreshCartShippingMethodsWorkflow` re-invoke `calculatePrice` on every address write?**
   Finding F2 as recorded in `shipping-quote.ts:36-38` and `:344-348` says yes, and I am relying on
   that recorded finding rather than re-reading Medusa's workflow source. It matters for how often the
   cache is hit and for whether a subscriber pre-warm would double the carrier traffic.
9. **Cache invalidation on a carrier price change** — is there any signal, or is TTL the only lever?
10. **Where does `colonia` slot into the `MissingRequirementCode` order?** The order is asserted and
    matches page position (`checkout-readiness.ts:74-90`).
11. **Seventh `QuoteStatus` value vs. an orthogonal selector** (§5.2 (a) vs (b)).

---

## 10. Ready for Proposal

**Yes.** The solution space is bounded, the recommended architecture is A + B with C/D explicitly
deferred behind a measurement, six slices are drafted with dependencies and revenue impact marked, and
the eleven open questions are all *design* questions rather than *exploration* questions — none of
them changes which approach to take, only how to parameterise it.

**Two things the orchestrator should surface to the user before proposal:**

1. **The premise behind the request has shifted.** The async pre-warm they asked for already exists in
   the storefront and already fires at the earliest possible moment. The 12 s is spent in parallel with
   typing today. What is broken is that an 8 s budget throws that work away, and that the pre-warmed
   request is guaranteed to be rejected because the colonia was wiped. Raising the budget is therefore
   **not** the quick patch they rejected — it is the arithmetic floor, and the admin label path already
   grants the identical call ~17.1 s.
2. **Slice S0 (flat-option rescue) should ship on its own, first.** ~120 storefront lines, no backend
   dependency, and it makes free shipping sellable even while Skydropx is fully down.

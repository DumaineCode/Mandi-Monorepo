# Adversarial review findings — `design.md` r1

**Date**: 2026-08-07
**Protocol**: blind dual review. Two reviewers, independent contexts, neither saw the other's output.
**Both verdicts**: NOT SAFE TO IMPLEMENT AS WRITTEN.

Four findings converged across both reviewers independently. Convergence is treated as strong evidence, not proof — a disagreement must be documented, never silently ignored.

The orchestrator independently verified CRITICAL-1 against source before accepting it.

---

## CRITICAL-1 — ORCHESTRATOR-VERIFIED. The design misread the code. Resolve first; it changes S1.

`design.md` argues `constants.unit.spec.ts:89` (`SKYDROPX_QUOTATION_TIMEOUT_MS <= LABEL_QUOTE_BUDGET_MS`) is "coherence, not containment" because checkout and label are independent call paths, and proposes replacing it.

**That is false.** Verified by direct grep:

```
client.ts:36   export const SKYDROPX_QUOTATION_TIMEOUT_MS = 8_000
client.ts:310  createQuotation → authed_(..., SKYDROPX_QUOTATION_TIMEOUT_MS, deadline)
client.ts:323  getQuotation    → authed_(..., SKYDROPX_QUOTATION_TIMEOUT_MS, deadline)
service.ts:815 checkout cycle deadline
service.ts:818 quoteAndPoll_ ← checkout path
service.ts:927 quoteAndPoll_ ← LABEL path, deadline derived from LABEL_QUOTE_BUDGET_MS
```

The constant has **two roles**: a per-request bound used on BOTH paths (inside `quoteAndPoll_` via `authed_` → `remaining_`), and the checkout cycle deadline. On the label path the per-request bound genuinely IS contained by `LABEL_QUOTE_BUDGET_MS`. The test's own name says exactly this: `it("keeps every per-request bound inside the budget that contains it")`.

Consequences of shipping `18_000` as designed:

1. **The label quote loses its poll loop.** Today a hung POST is capped at 8_000, guaranteeing ≥9_100ms of the 17_100ms budget survives for polling. At 18_000, one hung POST consumes the entire label quote budget — zero poll rounds — while `constants.unit.spec.ts:78-86` ("gives the quote slice room for several poll rounds") still passes numerically. The property is gone; the assertion protecting it is not.
2. **It inverts a documented diagnosis.** `budgetBound` flips to `true`, so `timeoutError_` (`client.ts:546-560`) reports *"cut short by the caller's budget… Skydropx did not time out"* for a genuine Skydropx hang. `client.ts:450-458` names that confusion "the production incident this pair of return values kills."

Note `constants.unit.spec.ts:4-7`: the incident that produced that file was *a per-request bound being used as the budget for a whole multi-round async cycle*. The design commits the same category error in reverse.

**Required fix — split the constant, do not delete the assertion:**

| Constant | Value | Used at |
|---|---|---|
| `SKYDROPX_QUOTE_CYCLE_BUDGET_MS` | ~18_000 | `service.ts:815` — checkout deadline ONLY |
| `SKYDROPX_QUOTATION_REQUEST_TIMEOUT_MS` | stays ~8_000 | `client.ts:310`, `client.ts:323` — per-request bound, both paths |

`constants.unit.spec.ts:89` then survives unchanged and still binds. `CHECKOUT_QUOTE_CEILING_MS` becomes unnecessary — drop it.

---

## CRITICAL-2 — The floor guard binds nothing that runs in production (both reviewers)

`readQuoteBudget()` returns the derived default WITHOUT a floor check when the env var is unset or blank. Nothing in the repo sets `SKYDROPX_QUOTE_BUDGET_MS`, so in production the guard sits on a code path that never executes.

Neither replacement assertion checks the checkout budget against the floor:
- `SKYDROPX_QUOTATION_TIMEOUT_MS <= CHECKOUT_QUOTE_CEILING_MS` → 18_000 ≤ 48_000 (2.7× slack)
- `LABEL_QUOTE_BUDGET_MS >= MIN_VIABLE_QUOTE_BUDGET_MS` → 17_100 ≥ 14_300

**Never** `checkout budget >= MIN_VIABLE_QUOTE_BUDGET_MS`. If a future edit drops `SKYDROPX_COLD_QUOTE_P95_MS` to 9_000, the derived budget falls below the floor and every guard and every test still passes.

This also violates the test file's own stated bar (`constants.unit.spec.ts:9-13`): *"Every assertion here must be capable of FAILING on a plausible retune."*

**Fix**: clamp the default — `Math.max(derived, MIN_VIABLE_QUOTE_BUDGET_MS)` — AND assert the cycle budget against the floor.

**Related (reviewer 2, M2)**: `MIN_VIABLE_GATEWAY_TIMEOUT_MS = 36_667` is derived from one 15s request plus one 2s poll and knows nothing about a PRO quotation needing ~14.3s. At that currently-accepted value:

```
SKYDROPX_FULFILLMENT_BUDGET_MS = 33_000 − 6_000 − 10_000 = 17_000
LABEL_QUOTE_BUDGET_MS          = floor(17_000 × 0.45)     =  7_650   ← below the 14_300 floor
```

The same bug S1 exists to fix, one level up, left in place. Raise that derivation so it funds `MIN_VIABLE_QUOTE_BUDGET_MS / 0.45`, enforced inside `readGatewayTimeout` where it is actually enforceable.

---

## CRITICAL-3 — Cache key is account/environment blind (BOTH reviewers, converged)

Key is `origin ⨯ destination ⨯ parcel ⨯ (reserved carriers)`. Nothing identifies whose account or which environment produced the rate.

`SkydropxCredentials.baseUrl` (`types.ts:25`) and `provider_setting.mode` select `sb-pro.skydropx.com` vs `api-pro.skydropx.com`. Flip mode, rotate accounts, or share one Redis between staging and production, and for up to 300s `calculatePrice` returns another environment's tariff as `calculated_amount` — **a sandbox price charged to a real shopper.**

The codebase already knows this matters: `getClient_` re-keys its client cache on `credentialFingerprint(config)` (`service.ts:740-741`) for exactly this reason. `design.md` §4.3 opens with "a cached rate is a price we charge" and then omits the one dimension separating a real price from a fake one.

**Fix**: add a leading key segment = `credentialFingerprint(config)` (or at minimum `mode` + `baseUrl`), ahead of origin.

---

## CRITICAL-4 — The cache seam bounds rejections but not HANGS, on a public endpoint (reviewer 2)

§4.1 claims the seam is injected "exactly like `credentialSource_`" with "try/catch → no-op". It is not.

`makeDbCredentialSource` (`lib/provider-credentials.ts:66-80`) races the read against `CREDENTIAL_RESOLUTION_TIMEOUT_MS = 3_000` via `Promise.race`. Its docstring: *"Without a bound, a slow-but-up DB would hang the hot path."* `makeStockLocationSource` does the same (`lib/stock-location-address.ts:76`).

A `try/catch` catches **rejections**. It does not bound a **hang**. ioredis with default `enableOfflineQueue: true` and no `commandTimeout` **queues** commands while the connection is down — it never rejects.

§4.4 places the cache read BEFORE the `service.ts:815` deadline anchor, so the hang is outside `SKYDROPX_QUOTATION_TIMEOUT_MS`, outside `PRE_ANCHOR_BUDGET_MS`, outside `ASSUMED_GATEWAY_TIMEOUT_MS` — on the PUBLIC `POST /store/shipping-options/:id/calculate`.

"No cache path can produce an error" is true and irrelevant. The failure mode is not an error; it is never returning.

**Fix**: race both `get` and `set` against `QUOTE_CACHE_TIMEOUT_MS` (~200-500ms — it is a memory read), swallowing late settlements exactly as `provider-credentials.ts:67-80` does. Add hang cases to the cache unit tests, not only throw cases.

---

## CRITICAL-5 — S4 orphans existing orders AND can hard-fail all label purchases (BOTH reviewers, converged)

### (a) Label guard drift
§5.1 makes `toAddress` strict but deliberately keeps `address_2` out of `missingDestinationFields`. So `requireDestination_` (`service.ts:1399-1424`) passes the field guard, then `toAddress` returns `undefined`, and execution lands at `:1416-1422` — the branch whose own comment reads *"Defensive: `missingDestinationFields` covers every component `toAddress` requires, so this is only reachable if one of the two drifts."*

S4 designs in that drift. The operator gets `"Skydropx label destination address is incomplete."` — no field named, no hint. **Worse** than today's 422, which at least names `area_level3`. The claim "S4 moves that failure earlier, with a better message" is false for the label path.

### (b) Blast radius is not "carts mid-checkout"
It is **every existing order with no `address_2`** — the `AddressSelect` / store-API / legacy cohort. Sellable yesterday, unlabelable tomorrow. Neither §6's rollback column nor §7 mentions existing orders at all.

### (c) `origin-contract.unit.spec.ts` will NOT go RED
The design, the proposal risk table ("Certain | Intended signal") and the spec all rest on this. The file is 94 lines, hand-asserts three named fields, has no exhaustive or loop-based pinning, and its fixture already carries `address_2: "Valle de Aragon"` (`:29`). So `missing` stays `[]` and the suite stays green.

Meanwhile `PROVIDER_FORMS.skydropx` (`apps/backend/src/admin/routes/provider-settings/form-model.ts:85-145`) has `originZip`, `originEmail`, `originCompany`, `originPhone` — **nothing colonia-shaped**. S4 could therefore ship a hard origin requirement with no way for an operator to supply the value, reproducing the exact `originEmail` incident that test file's header was written to prevent.

And since `calculatePrice:806` builds the origin through the same `toAddress`, that would take **calculated shipping to 100% failure at checkout**, with the storefront told only "Skydropx is not configured for shipping quotes."

Compounding: the setting and the guard land in the SAME slice, so no deploy ordering lets an operator save `originColonia` before the guard turns on.

**Fix**:
1. Add `address_2` to `missingDestinationFields` plus a `DESTINATION_FIX_HINTS.address_2` entry, so both guards stay coherent with `toAddress`.
2. WRITE the RED test — a bidirectional assertion iterating every field `missingOriginFields` can emit against `PROVIDER_FORMS.skydropx`, so this drift class cannot recur silently. Do not rely on the existing file.
3. SPLIT S4 so the form field + setting + schema land BEFORE the guard turns on, or gate the guard behind "setting present OR stock-location value present" for one release.
4. Own the existing-order migration explicitly in §7 and in the PR body.

---

## MAJOR findings — resolve, or explicitly accept with a stated reason

| id | Finding | Required action |
|---|---|---|
| MAJ-1 | `COLONIA_MANUAL_REQUESTED` (`checkout-reducer.ts:574-579`) is the only draft write bypassing `commitDraft`. Harmless today; under S3 a customer clicking "enter manually" clears `address_2` while `quoteSignature` stays `S` — status still reports `quoted`, prices render for a colonia just cleared, the effect never re-fires (deps unchanged), and the draft-derived signature permanently disagrees with `state.quoteSignature`. | Route through `commitDraft`. RED test in S3 asserting the signature goes non-null → null. |
| MAJ-2 | `commitDraft` clears `calculatedPrices` but never `quotedSignature`. Pre-existing (postal A→B→A inside the 600ms debounce); S3 widens it badly by putting a DROPDOWN in the signature — colonia X→Y→X is two clicks. Result: status reports `quoted`, every calculated row renders `amount: null`, `evaluateQuoteReadiness` says `already_quoted` and skips, and no retry button exists (it only renders on `failed`). S0's new selector then displays "live carrier rates are unavailable right now" — false and unactionable. | `commitDraft` must clear `quotedSignature` whenever it clears `calculatedPrices`; they describe the same round. Belongs in S3. |
| MAJ-3 | Guard and wire builder read different colonia sources. `toAddress:441-443` reads `text(address.address_2) ?? text(address.metadata?.colonia)`; the proposed `missingQuoteDestinationFields` reads only `address_2`, so it would reject requests the wire builder could build and the carrier would price. | Extract one `readColonia(address)` used by `toAddress`, `missingQuoteDestinationFields` and `missingOriginFields`. Same invariant `service.ts:980-982` already states for `destinationContact`. |
| MAJ-4 | The cache's business case is unverified AND self-defeating. It promotes an explicitly-unverified proposal open question (`refreshCartShippingMethodsWorkflow` re-invokes `calculatePrice`) to the load-bearing TTL justification. If true, it removes the cache's value: the same-shopper repeat already costs ~996ms because Skydropx caches server-side. The only material win is cross-shopper cold-quote elimination — demoted to "a bonus" — which carries all the price-correctness risk. | Re-read the workflow and measure the warm path before S5 is scheduled, or restate the business case honestly as cross-shopper and defend the TTL on that harder basis. The proposal already ranks S5 "drop it first"; do not argue it up. |
| MAJ-5 | `QUOTE_BUDGET_HEADROOM = 1.4` is the reintroduced unexplained literal. The arithmetic is honest; the derivation is not. M0 recommended 18_000 by judgement first, and §1.2 then built a formula landing on it. Nothing explains 1.4 over 1.3 or 1.5, and no test can falsify it. | State plainly that 18_000 is a judgement and show what it is a multiple of, OR derive upward from the floor as `MIN_VIABLE_QUOTE_BUDGET_MS + TAIL_ALLOWANCE_MS`, named for what it absorbs (peak carrier load, cold token, production host delta). Keep 18_000; make the unmeasured part explicit. |
| MAJ-6 | 8s→18s more than doubles per-shopper quote pile-up against a 2 req/s cap. `checkout-context.tsx:385-397` starts a round for a new signature without acting on `supersedes`, and `calculatePriceForShippingOption` has no `AbortSignal` (deliberately), so abandoned rounds run to completion. Four postal-code corrections >600ms apart leave four concurrent quotations, each now holding 18s. The token is single-flighted (`client.ts:190-223`); quotations are not. No 429 handling anywhere. | Minimum: record in §7 with the amplification factor. Better: single-flight in-flight quotations by cache key in the provider (the pattern `getToken_` already implements), which also kills the cold-start stampede S5 would otherwise create. |
| MAJ-7 | S3+S4 close the BLANK colonia case only. §0's own measurement proves a nonexistent colonia prices byte-identically — Skydropx validates non-blank, nothing more. And `toShipAddress:488` uses `address_2` as the label reference/apartment field, which is also Medusa's convention. A returning customer whose saved `address_2` is "Depto 3B" passes readiness, passes the pre-flight, quotes fine, and produces an order whose `area_level3` is "Depto 3B". | State plainly in §7 that the unlabelable-order class remains open for wrong-but-present values. To actually close it, validate the picked colonia against the SEPOMEX list for the current CP — which `coloniasPostalCode` now makes expressible. |
| MAJ-8 | S3 shrinks the pre-warm window the proposal's central argument rests on. After S3 `quoteSignature` is `null` until a colonia exists, so quoting starts at colonia SELECTION, not postal-code resolution. The proposal claims "nobody stares at a spinner for 12s"; S3 partially dismantles that and the design never revisits it. M0 explicitly instructed this phase that a ~10.9s median needs a visible progress state; `shipping-section/index.tsx:245` renders a skeleton with no progress or elapsed-time affordance. | Add a §7 item for the pre-warm-window reduction, and either specify the `quoting` affordance for a double-digit-second wait or record explicitly that the existing skeleton ships as-is and is accepted. |

---

## MINOR

- §3.5 path 1 contradicts its own closing paragraph: a colonia-less draft yields a `null` signature, so no failure can be "parked". Spec wording is correct; design prose is muddled.
- n=40 supports "max observed 12_252ms", not a true p95 — the 95th percentile of 40 samples is essentially the 38th order statistic, CI roughly 11_502–12_252, and the draws are not independent (one session, one account, one parcel, sandbox). Label it honestly.
- Proposal §3's "S1 before S4" paragraph still carries the falsified "12s 422" premise; §0 corrected only the S4 row. Conclusion holds, stated reason does not.
- S3 and S4 are NOT independently revertible. Reverting S3 with S4 on main leaves the backend requiring a colonia with no storefront gate — strictly worse than pre-S4. §6 claims every slice is an independent revert. State that they revert as a pair.
- `SHIPPING_ADDRESS_FIELDS` does not exist. The constant is `REQUIRED_ADDRESS_FIELDS` (`checkout-readiness.ts:190-199`) and is module-private.
- `specs/storefront-checkout/spec.md:519` gives stale `failed` copy that contradicts the same requirement block's "MUST NOT blame the address" rule. Shipped copy (`shipping-section/index.tsx:284-286`) is the deliberate, correct one. **Implementing the spec literally REGRESSES it.** Fix the spec text.
- `shipping-section` is NOT an exhaustive switch (`:234-296` is a sequence of `&&` blocks). The six-status conclusion stands, but not for the reason given.
- Caching `SkydropxRate[]` caches `rate.id`. Harmless at checkout, but §4.4 invites reuse and a 300s-old rate id is not necessarily purchasable by `createShipment:970`.
- Deadlines are wall-clock `Date.now()`; 18s widens the NTP-step / GC-pause window versus 8s. Low probability; worth one sentence.

---

## Confirmed CORRECT by both reviewers — do not "fix" these

- **`coloniasPostalCode` (§3.2)** is correct and load-bearing. Both reviewers tried to break it and could not. It catches a regression the spec's literal text would have introduced (postal B→A→B retaining A's colonia list).
- **The `area_level3` positive control is methodologically valid** — a null result plus a demonstrated detector. Keeping colonia in the cache key against the null result is defensible conservatism, not muddle.
- **S0 is clean.** `checkout-context.tsx` genuinely does not change; the `QuotedOption.amount?` override is justified because `spec.md:94-98` is otherwise unanswerable; and the "purchasable while Skydropx is fully down" claim holds — `listCartShippingMethods` triggers no carrier call.
- **§0's falsification of the "12s 422" claim is correct** (104ms fast-fail).
- **`MIN_VIABLE_QUOTE_BUDGET_MS = MAX + POLL_INTERVAL` is sound** — `quoteAndPoll_` can only observe completion on a sleep boundary.
- **All untouchable guards survive** except via MAJ-1: `?? null` never `?? 0`, the unconditional terminal `QUOTE_READY` dispatch, the single-writer scheduler, `hasShippingMethod` failing closed, and `selectShouldLookUpPostalCode`.

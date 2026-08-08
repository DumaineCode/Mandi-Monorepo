# Design — checkout-shipping-quote-reliability

Inputs: `proposal.md` (authoritative scope), `specs/storefront-checkout/spec.md`,
`specs/skydropx-fulfillment/spec.md`, `m0-measurements.md` (the measurement gate), `explore.md`.
Everything the spec deferred is decided here, with the evidence attached.

> **Size note.** The generic sdd-design 800-word budget is exceeded deliberately. This phase was
> tasked with resolving six deferred decisions and one measured open question; compressing that
> below 800 words would reproduce the exact failure being fixed — a number with no traceable
> derivation.

---

## 0. New measurement taken in this phase — `area_level3` does NOT move the rate

The proposal carried this as an open question and made the cache-key design depend on it. It is now
**MEASURED**, not guessed.

**Method.** Standalone harness outside the repo (`$TMPDIR/opencode/m0/area3.mjs`, `area3b.mjs`),
reusing the M0 credential/decrypt path. Origin, parcel and destination `{country, postal_code,
area_level1, area_level2}` held constant; **only `address_to.area_level3` varied**. The full usable
rate table (provider, service code, total, days) was canonicalized and compared byte-for-byte.
Skydropx **SANDBOX**, 1 req/s, 3 s between samples.

| Cohort | Variants | Result |
|---|---|---|
| CP **06700** CDMX / Cuauhtémoc | `Roma Norte`, `Roma Sur`, `Condesa`, `Hipódromo`, `Zzqq Colonia Inexistente 98765` | **5/5 rate tables byte-identical.** 8 usable rates each, cheapest `35.47` |
| CP **64000** Nuevo León / Monterrey | `Centro`, `Obispado`, `Del Valle`, `Wwzz Colonia Falsa 24680`, `"  Centro  "` | **5/5 rate tables byte-identical** |
| Origin colonia varied (`address_from.area_level3` → garbage) | 1 | **identical to base** |
| **Positive control** — different CP (97000 Mérida, Yucatán) | 1 | **table DIFFERS** (`dhl standard` 292.71 → 178.23; `imile` 117.74 → 117.74/115.39 across CPs; `days` moves on 5 of 8 rows) |
| Colonia **omitted** | 1 | **HTTP 422 in 104 ms**, `{"errors":{"address_to":{"area_level3":["no puede estar en blanco"]}}}` |

**Answer: `area_level3` is validation-only. It does not move the quoted rate.** A deliberately
non-existent colonia string prices identically to the real one, on two different postal codes, at
both ends of the shipment. The positive control proves the harness detects real rate movement, so
the null result is not measurement blindness. Postal code moves the price; colonia does not.

**Second finding, which falsifies a proposal claim.** The colonia-less 422 returns on the **POST, in
104 ms** — a *fast-fail*, consistent with M0(a)'s "invalid CP fails in 556 ms". `proposal.md` §3 says
S4 "trades a **12 s 422** for an instant, actionable message." **That is wrong.** There is no 12 s
422. S4's value is (a) an actionable, leak-free diagnosis instead of `"Skydropx could not quote this
shipment."`, and (b) not spending a token fetch + credential resolve on a request we can refuse
locally. It is a **diagnosis** slice, not a **latency** slice. Its ranking below S1 is unchanged;
its justification is corrected.

*(Corollary: the two production defects are latency-distinct and UX-identical. A colonia-less cart
fails at ~0.7 s; a colonia-bearing cart to a cold destination fails at 8.1 s. Both surface the same
storefront string through `fetchUsableRates_`, which is why they read as one bug.)*

---

## 1. The budget constants, derived (S1)

> **Corrected after adversarial review (CRITICAL-1, orchestrator-verified against source).** The r1
> design misread `constants.unit.spec.ts:89` as a "coherence, not containment" rule and proposed
> deleting it. That was **false**. `SKYDROPX_QUOTATION_TIMEOUT_MS` had **two roles** in the same
> constant: a per-request bound used on BOTH the checkout and label paths (inside `quoteAndPoll_` via
> `authed_` → `remaining_`, at `client.ts:310` and `client.ts:323`), and the checkout cycle deadline
> at `service.ts:815`. On the label path the per-request bound genuinely IS contained by
> `LABEL_QUOTE_BUDGET_MS`, so `:89` is a real containment assertion. Raising the single constant to
> 18_000 would have let one hung POST eat the entire label quote budget — **zero poll rounds** — while
> `constants.unit.spec.ts:78-86` still passed numerically, and would have inverted the `budgetBound`
> diagnosis (`client.ts:546-560`), reporting *"cut short by the caller's budget"* for a genuine
> Skydropx hang — the exact confusion `client.ts:450-458` names as "the production incident this pair
> of return values kills". **The fix is to SPLIT the constant. `:89` survives unchanged.**

### 1.1 The split — one name, two physical roles, two constants

| Constant | Value | Used at | Role |
|---|---|---|---|
| `SKYDROPX_QUOTATION_REQUEST_TIMEOUT_MS` | ~8_000 (unchanged) | `client.ts:310` (`createQuotation`), `client.ts:323` (`getQuotation`) — **both paths** | Per-request bound. A single hung POST/GET is capped here so the surrounding cycle keeps poll rounds. |
| `SKYDROPX_QUOTE_CYCLE_BUDGET_MS` | ~18_000 | `service.ts:815` — **checkout cycle deadline ONLY** | The whole multi-round quote-and-poll cycle at checkout. |

`constants.unit.spec.ts:89` becomes `SKYDROPX_QUOTATION_REQUEST_TIMEOUT_MS <= LABEL_QUOTE_BUDGET_MS`
— **8_000 ≤ 17_100 ✓, unchanged in meaning, still binding.** The per-request bound stays inside the
label budget that contains it, so the label path keeps ≥9_100ms for polling exactly as today. The
label path is **not touched by S1**: it still derives its deadline from `LABEL_QUOTE_BUDGET_MS` at
`service.ts:927` and bounds each request at 8_000.

`CHECKOUT_QUOTE_CEILING_MS` from r1 is **dropped** — it existed only to re-express the deleted
assertion, and the split makes it unnecessary.

### 1.2 The derivation of `SKYDROPX_QUOTE_CYCLE_BUDGET_MS`

Only the **checkout cycle deadline** changes value. It lives in `client.ts` beside the request-timeout
constant (**`client.ts` must not import `service.ts`** — that is a cycle; `service.ts` already imports
`client.ts`), and `service.ts:815` imports it.

```ts
/**
 * MEASURED 2026-08-07, Skydropx SANDBOX, n=40 cold quotations across 40 unique
 * destinations in 28 states. See openspec/changes/.../m0-measurements.md §M0(a).
 * Harness p95 11_574ms + ~1_000ms app-level overhead (credential resolve + cold
 * OAuth token, measured directly in M0(b)).
 *
 * NOTE (n=40): this is a p95 over 40 samples, i.e. ~the 38th order statistic, CI
 * roughly 11_502–12_252ms, drawn from ONE session/account/parcel in SANDBOX — the
 * draws are not independent. Treat as a defensible estimate, not a population p95.
 */
export const SKYDROPX_COLD_QUOTE_P95_MS = 12_600
/** Same sample: harness max 12_252ms + ~1_000ms app-level overhead. */
export const SKYDROPX_COLD_QUOTE_MAX_MS = 13_300

/**
 * The poll loop can only OBSERVE completion on a 1s boundary, so a quote that
 * finishes at 13_300ms is reported at 14_300ms. Anything below this is
 * arithmetically incapable of completing the slowest observed quote. This is the
 * FLOOR shared by both the checkout cycle budget and the label quote budget.
 */
export const MIN_VIABLE_QUOTE_BUDGET_MS =
  SKYDROPX_COLD_QUOTE_MAX_MS + QUOTE_POLL_INTERVAL_MS          // 14_300

/**
 * 18_000 is a JUDGEMENT (M0's recommendation), decomposed here for honesty, not a
 * measured p99. It is the measured floor plus a named tail allowance:
 *   MIN_VIABLE_QUOTE_BUDGET_MS (14_300) + TAIL_ALLOWANCE_MS (3_700) = 18_000.
 * TAIL_ALLOWANCE_MS absorbs the three things n=40 SANDBOX could not see:
 * peak carrier load, a cold-token/credential-resolve spike, and the untested
 * production (api-pro) host delta. No unit test can falsify 3_700; only a
 * production re-measure (see §7) can retune it.
 */
export const TAIL_ALLOWANCE_MS = 3_700
export const DERIVED_QUOTE_CYCLE_BUDGET_MS =
  MIN_VIABLE_QUOTE_BUDGET_MS + TAIL_ALLOWANCE_MS               // 18_000

export const SKYDROPX_QUOTE_CYCLE_BUDGET_MS = readQuoteCycleBudget()
```

**MAJ-5 resolved.** r1 multiplied `12_600 × QUOTE_BUDGET_HEADROOM (1.4)` — a literal nothing could
falsify and which was reverse-engineered to hit 18_000. That multiplier is **removed**. 18_000 is now
`floor + TAIL_ALLOWANCE_MS`, named for what it absorbs. The value is still 18_000; the unmeasured part
is now explicit and points at a concrete follow-up rather than a magic ratio. (For the record, 18_000
remains ~1.43× app-level p95 and ~1.35× max observed — but the derivation no longer *depends* on that
coincidence.)

### 1.3 The load-time floor guard — now CLAMPED, and it binds

`readQuoteCycleBudget(raw = process.env.SKYDROPX_QUOTE_BUDGET_MS, warn = console.warn)`, modelled
line-for-line on `readGatewayTimeout` (`service.ts:212-231`) including its **refusal to throw** — the
provider must stay inert-safe at boot (`medusa-config.ts`), so a bad override warns and falls back
rather than taking the boot down for a tuning knob. Runs at module load, not first quote.

> **CRITICAL-2 resolved.** r1's guard checked the override branch but returned the derived default
> **without a floor check**, and nothing in the repo sets `SKYDROPX_QUOTE_BUDGET_MS`, so the guard sat
> on a dead path. If a future edit dropped `SKYDROPX_COLD_QUOTE_P95_MS`, the derived budget could fall
> below the floor and every test still passed. **Fix: the default is now clamped too, and the test
> asserts the cycle budget against the floor.**

```ts
export function readQuoteCycleBudget(raw, warn): number {
  const clampToFloor = (v: number) => Math.max(v, MIN_VIABLE_QUOTE_BUDGET_MS)
  if (raw == null || raw.trim() === "") return clampToFloor(DERIVED_QUOTE_CYCLE_BUDGET_MS)
  const n = Number(raw)
  if (!Number.isFinite(n) || n < MIN_VIABLE_QUOTE_BUDGET_MS) {
    warn(`SKYDROPX_QUOTE_BUDGET_MS=${raw} below floor ${MIN_VIABLE_QUOTE_BUDGET_MS} (measured 2026-08-07); using ${clampToFloor(DERIVED_QUOTE_CYCLE_BUDGET_MS)}`)
    return clampToFloor(DERIVED_QUOTE_CYCLE_BUDGET_MS)
  }
  return n
}
```

| Input | Outcome |
|---|---|
| unset / blank | `Math.max(DERIVED_QUOTE_CYCLE_BUDGET_MS, MIN_VIABLE_QUOTE_BUDGET_MS)` = 18_000 |
| non-numeric, or `< MIN_VIABLE_QUOTE_BUDGET_MS` | warn naming the floor + measurement date; fall back to the clamped default |
| `>= MIN_VIABLE_QUOTE_BUDGET_MS` | accepted unchanged |

### 1.4 Shared FLOOR across both quote budgets — decided

| Option | Verdict |
|---|---|
| Share one constant across checkout + label | **Rejected.** The label budget is derived from a *gateway* ceiling it must also fund a purchase and a cancel out of; checkout funds neither. Same physics only at the floor. |
| Share nothing (today) | **Rejected — this was the r1 defect at the request level.** One constant carried both the per-request bound and the cycle deadline; §1.1 splits them. |
| **Share the FLOOR `MIN_VIABLE_QUOTE_BUDGET_MS`** | **CHOSEN.** The floor encodes a *physical* fact — how long the carrier actually takes — identical on both paths. Each path keeps its own ceiling. |

The test file's `:89` assertion (per-request bound ≤ label budget) is kept. Two floor assertions are
**added** (CRITICAL-2), each capable of failing on a plausible retune:

- `SKYDROPX_QUOTE_CYCLE_BUDGET_MS >= MIN_VIABLE_QUOTE_BUDGET_MS` — the checkout cycle budget is checked
  against the floor. If `SKYDROPX_COLD_QUOTE_P95_MS`/`TAIL_ALLOWANCE_MS` are retuned below the floor,
  this goes RED.
- `LABEL_QUOTE_BUDGET_MS >= MIN_VIABLE_QUOTE_BUDGET_MS` (17_100 ≥ 14_300 ✓) — so a future
  `SKYDROPX_GATEWAY_TIMEOUT_MS` reduction that starves the *label* quote is caught by the same floor.

> **CRITICAL-2 / MAJ-2-related upstream (M2): `MIN_VIABLE_GATEWAY_TIMEOUT_MS`.** At the currently
> accepted `MIN_VIABLE_GATEWAY_TIMEOUT_MS = 36_667` (one 15s request + one 2s poll), the label quote
> budget derives to `floor((33_000 − 6_000 − 10_000) × 0.45) = 7_650` — **below the 14_300 floor**.
> That is the same starvation bug S1 fixes, one level up. **Raise the gateway floor so it funds the
> quote floor:** `MIN_VIABLE_GATEWAY_TIMEOUT_MS` must be at least large enough that
> `LABEL_QUOTE_BUDGET_MS >= MIN_VIABLE_QUOTE_BUDGET_MS` holds — i.e. derived from
> `MIN_VIABLE_QUOTE_BUDGET_MS / 0.45` (≈ 31_778 for the label slice alone, plus the purchase+cancel
> reserve), enforced **inside `readGatewayTimeout`** where it is actually enforceable, not only
> asserted in the constants test. This lands in S1 alongside the split.

### 1.5 Docstrings corrected in place

- `client.ts:13-16` — the "8s on the checkout path" rationale is split: the **per-request** bound stays
  8s and its docstring says so; the **cycle** deadline moves to `SKYDROPX_QUOTE_CYCLE_BUDGET_MS`, whose
  docstring names the measurement file+date. The measured cold distribution (min 8_163 ms) explains why
  the old 8s *cycle* budget failed 40/40 while the 8s *request* bound is correct.
- `client.ts:36` — the single ambiguous literal is gone; two named constants replace it, each pointing
  at §1.1/§1.2.
- `shipping-quote.ts:14-39` — corrected in S3 (§3).

**A stale comment asserting the old rationale is how this bug survives a second time. Correcting them
is in scope, not cleanup.**

---

## 2. S0 — free-shipping-safe partial pricing

### 2.1 The minimal change, and where it is NOT

The defect is stated in the prompt as "the CALLER treating `classifyQuoteResult`'s narrow answer as
'the whole round failed'". **The minimal fix is to widen the answer, not to teach the caller to
second-guess it.** `checkout-context.tsx:457-460` then becomes correct *unchanged* — which is the
best possible outcome, because that file is node-untestable by construction and the terminal-dispatch
guard lives three lines below it.

**`checkout-context.tsx` is not modified by S0.** No guard is approached.

### 2.2 One definition of "presentable"

`selectShippingChoices` (`checkout-reducer.ts:861-873`) *already* computes exactly this rule
per row. Duplicating it inside `classifyQuoteResult` is how the two drift. Extract it once:

```ts
// shipping-quote.ts
export type QuotedOption = {
  id: string
  price_type?: string | null
  /**
   * ADDED (S0). A flat option carries its own amount and is never routed through
   * `calculatePriceForShippingOption`, so the price map says nothing about it.
   * Optional and structural: `StoreCartShippingOption` already has this field, so
   * the CALL SITE passes `options` verbatim and does not change.
   */
  amount?: number | null
}

/** `Number.isFinite`, never truthiness: free shipping quotes `0`, and `0` is falsy. */
export function readPresentableAmount(
  option: QuotedOption,
  prices: Readonly<Record<string, number | null | undefined>>
): number | null {
  const raw = option.price_type === "calculated" ? prices[option.id] : option.amount
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null
}

export function classifyQuoteResult(input: {
  options: readonly QuotedOption[]
  prices: Readonly<Record<string, number | null | undefined>>
}): QuoteResultClass {
  if (input.options.length === 0) {
    return "priced"   // empty list is `not_serviceable` downstream, never `failed`
  }
  return input.options.some((o) => readPresentableAmount(o, input.prices) !== null)
    ? "priced"
    : "unpriceable"
}
```

`selectShippingChoices` is refactored to call `readPresentableAmount` — **behaviour-identical**, and
it is what makes the classifier and the renderer incapable of disagreeing.

> **Override, named.** The prompt asked for this "without touching `classifyQuoteResult`'s input
> shape". `QuotedOption` **must** gain `amount?`: the spec's own scenario *"a flat option whose
> `amount` is `null` does not rescue the round"* is unanswerable without it. I read the constraint's
> intent as "do not restructure the caller's contract or make it precompute", and that intent is
> fully met — the field is optional, structural, already present on the object the caller passes, and
> `checkout-context.tsx` does not change by one character.

Behaviour deltas, both spec'd: an all-flat list with every amount `null` now classifies `unpriceable`
(was `priced`); a mixed list with a presentable flat option now classifies `priced` (was
`unpriceable` — **the revenue stopper**).

### 2.3 The annotation — six states kept

**The spec's judgement call is HONORED.** No seventh `QuoteStatus`. "some carriers did not answer" is
not a state, it is a property of `quoted`. (MINOR correction: the renderer at
`shipping-section/index.tsx:234-296` is **not** an exhaustive `switch` — it is a sequence of `&&`
blocks. The six-status conclusion stands on the spec's "exactly one on screen, always one" contract,
not on switch exhaustiveness as r1 implied.) Orthogonal selector in the reducer:

```ts
export function selectCarrierRatesUnavailable(state: CheckoutState): boolean {
  return (
    selectQuoteStatus(state) === "quoted" &&
    state.shippingOptions.some(
      (o) => o.price_type === "calculated" &&
             readPresentableAmount(o, state.calculatedPrices) === null
    )
  )
}
```

`false` in every other state by construction. Copy is fixed and never derived from an upstream
message (the storefront cannot tell a timeout from a no-coverage answer).

---

## 3. S2 colonia retention + S3 colonia in the signature

### 3.1 `CP_LOOKUP_RESET` split (S2)

Two facts, two actions. The rule lives in a pure predicate; the `.tsx` only routes.

| Action | Meaning | Effect |
|---|---|---|
| `CP_LOOKUP_NOT_NEEDED` | postal code is usable; no lookup in flight | `cpStatus: "idle"` **only**. `colonias` and `coloniaManual` untouched |
| `CP_LOOKUP_DISCARDED` | postal code is not usable | `cpStatus: "idle"`, `colonias: []`. `coloniaManual` untouched (today's `CP_LOOKUP_RESET` does not touch it; S2 changes the mis-shaped action, not this) |

Both keep today's no-op short-circuit so identity is stable across re-renders.

### 3.2 `selectPostalCodeIsUsable` — and the edge a naive version misses

```ts
export function selectPostalCodeIsUsable(state: CheckoutState): boolean {
  const cp = state.draft.postal_code.trim()
  if (!MX_POSTAL_CODE_PATTERN.test(cp)) return false
  // A list we hold is only meaningful for the postal code it was FETCHED for.
  return state.colonias.length === 0 || state.coloniasPostalCode === cp
}
```

The second clause is a **design addition beyond the spec's literal text**, and it is load-bearing.
With `is-5-digits` alone, the sequence *cart holds CP **B** → customer types **A** → lookup returns
A's list and overwrites province/city → customer types back **B*** reaches the reset branch
(`selectShouldLookUpPostalCode` declines: postal matches the cart, province/city non-empty) and would
**keep A's colonia list under postal code B**. Today's collapsed `CP_LOOKUP_RESET` clears it, so a
naive split is a regression. Combined with §0 (the carrier accepts any colonia string), the shopper
could pick a colonia that does not exist for their CP and the order would only fail at labelling.

Cost: one new state field `coloniasPostalCode: string | null`, written by `CP_LOOKUP_FOUND`
alongside `colonias`, `null` in `initFromServer`, cleared by `CP_LOOKUP_DISCARDED`.

### 3.3 `selectShouldLookUpPostalCode` — NOT weakened

Untouched. Its guard records the "CDMX" → "Ciudad de México" mount-time rewrite that moved the
signature and dropped a returning customer's selection. S2 fixes the mis-shaped *action*; the mount
guard is orthogonal and stays byte-for-byte.

### 3.4 Colonia in `buildQuoteSignature` (S3)

`QuoteRelevantAddress` gains `address_2`; `selectQuoteRelevantAddress` projects `draft.address_2`;
the five-component list gains it. Normalization (NFC → strip C0 → collapse whitespace → trim →
lowercase) and the `\u001f` delimiter are unchanged and now cover it — which is why
`"  Centro  "` and `"centro"` cannot both pay a cold quote.

`shipping-quote.ts:14-39` is corrected in place: the **street** half of the recorded reasoning stands
(`address_1` stays excluded — F2's server-side option filter reads
`country_code | province | city | postal_expression`); the **colonia** half is falsified by the 422
and is rewritten with that evidence plus §0.

### 3.5 Interaction with `isShippingSelectionStale` and the invalidation rule — precise

Two writer defects surface once colonia enters the signature; both are fixed in **S3**, not deferred.

> **MAJ-2 resolved.** `commitDraft` clears `calculatedPrices` but never `quotedSignature`. Pre-existing
> (postal A→B→A inside the 600ms debounce); S3 **widens it** by putting a dropdown in the signature —
> colonia X→Y→X is two clicks. Symptom: status reports `quoted`, every calculated row renders
> `amount: null`, `evaluateQuoteReadiness` says `already_quoted` and skips, no retry button renders (it
> only appears on `failed`), and S0's `selectCarrierRatesUnavailable` then shows "live carrier rates are
> unavailable" — false and unactionable. **Fix: `commitDraft` MUST clear `quotedSignature` whenever it
> clears `calculatedPrices` — they describe the same round.** RED test in S3.

> **MAJ-1 resolved.** `COLONIA_MANUAL_REQUESTED` (`checkout-reducer.ts:574-579`) is the only draft write
> bypassing `commitDraft`. Harmless today; under S3 a customer clicking "enter manually" clears
> `address_2` while `quoteSignature` stays `S` — status still reports `quoted`, prices render for a
> colonia just cleared, the effect never re-fires (deps unchanged), and the draft-derived signature
> permanently disagrees with `state.quoteSignature`. **Fix: route `COLONIA_MANUAL_REQUESTED` through
> `commitDraft`** so clearing the colonia moves the signature. RED test in S3 asserting the signature
> goes non-null → null.

With those two fixes in place, `commitDraft` reacts correctly to the two paths that matter:

1. **Picking a colonia on a colonia-less draft.** `quoteSignature` goes `null → S`. Different, so
   `commitDraft`'s change branch runs: `calculatedPrices: {}`, `quotedSignature: null` (MAJ-2),
   `failedSignature: null` — the parked failure is released — and the requote effect re-fires because
   `quoteSignature` is in its dep array. **This is the whole point of S3.**
   `isShippingSelectionStale(null, S) === false`, so a selection made earlier is not spuriously dropped.
2. **Changing colonia after a selection.** `S → S'`. `isShippingSelectionStale(S, S') === true` →
   `selectedShippingOptionId` cleared, `quotedSignature` cleared (MAJ-2), and
   `getMissingOrderRequirements` reports `shipping_method_stale`. **Correct and intended**: per F2 the
   backend silently re-prices a surviving method on every address write, so a colonia edit must force a
   re-pick even though §0 proves the price will come back the same. We enforce the *invariant*, not the
   *observed value*.

**Consequence to state plainly (MINOR correction):** before a colonia exists, `quoteSignature` is
`null`, so the requote effect early-returns and **no quote fires at all**. There is therefore **no
failure to "park"** in that state — r1's §3.5 path-1 prose contradicted its own close on this; the
spec wording is the correct one. This is the spec'd R4 narrowing ("a postal code plus a colonia shows a
price"), and it is why colonia-in-cache-key costs no extra cold quote (§4.2).

`checkout-readiness.ts` gains `colonia` at position **3.5** (spec's judgement call honored), message
`Elige tu colonia.`, kept out of `REQUIRED_ADDRESS_FIELDS` so both codes may co-appear.

> **MINOR correction:** the r1 text named `SHIPPING_ADDRESS_FIELDS`, which does not exist. The constant
> is `REQUIRED_ADDRESS_FIELDS` (`checkout-readiness.ts:190-199`) and is module-private.

> **MAJ-6 — quote pile-up amplification. ACCEPTED with a recorded mitigation, not fully fixed in S1.**
> 8s→18s (the cycle budget) more than doubles per-shopper quote pile-up against Skydropx's 2 req/s cap:
> `checkout-context.tsx:385-397` starts a round for a new signature without acting on `supersedes`, and
> `calculatePriceForShippingOption` has no `AbortSignal` (deliberate), so abandoned rounds run to
> completion — four postal corrections >600ms apart can leave four concurrent 18s quotations. The token
> is single-flighted (`client.ts:190-223`); quotations are not; no 429 handling exists. **Recorded in §7
> with the amplification factor.** The stronger fix — single-flight in-flight quotations by cache key in
> the provider (the `getToken_` pattern) — is folded into **S5**, where the same cache key already
> exists and it *also* kills the cold-start stampede S5 would otherwise create. Doing it in S1 would
> duplicate keying work S5 does properly; doing it in S5 is strictly better sequencing.

---

## 4. S5 — quotation cache

M0(c) proved the seam: `container.resolve("cache", { allowUnregistered: true })` from the **global**
`@medusajs/framework` container resolves to `RedisCacheService` from inside `calculatePrice`;
fulfillment providers have **no `__container__` at all**, so there is no provider scope to differ and
`provider-credentials.ts:57-62` generalises unchanged.

### 4.1 The seam — bounds HANGS, not only rejections

`quoteCacheSource_`, injected exactly like `credentialSource_` / `stockLocationSource_`, defaulting to
`makeMedusaQuoteCache()`. **Resolved per operation, never in the constructor** (module load order at
boot is not guaranteed — the container-free constructor is an untouchable). `undefined` cache (no
`REDIS_URL`) is "no cache", not a crash.

> **CRITICAL-4 resolved.** r1 said the seam was injected "exactly like `credentialSource_`" with
> "try/catch → no-op", and claimed "no cache path can produce an error". A `try/catch` catches
> **rejections** — it does **not** bound a **hang**. ioredis with default `enableOfflineQueue: true`
> and no `commandTimeout` *queues* commands while the connection is down and never rejects; the read
> sits BEFORE the `service.ts:815` deadline anchor (§4.4), so on the **public** `POST
> /store/shipping-options/:id/calculate` a Redis blip could hang the hot path indefinitely — outside
> every existing timeout. This is exactly why `makeDbCredentialSource` (`lib/provider-credentials.ts:66-80`)
> and `makeStockLocationSource` (`lib/stock-location-address.ts:76`) race their reads against a bound
> via `Promise.race`. **Fix: race BOTH `get` and `set` against `QUOTE_CACHE_TIMEOUT_MS`.**

Every method races the underlying call against `QUOTE_CACHE_TIMEOUT_MS` (≈300ms — it is a memory read;
generous enough for a healthy Redis, tight enough that a hung one falls straight through to a live
quote) inside a `try/catch`, swallowing **late settlements** exactly as `provider-credentials.ts:67-80`
does. A timeout, a rejection, an unregistered cache, or a malformed entry all resolve to "no cache" and
fall through to the live quotation. The tightest bound (the race) plus the widest safety net (the
catch) together make the seam **fail-open against both failure modes: the error and the never-return.**

```ts
export const QUOTE_CACHE_TIMEOUT_MS = 300

export type QuoteCacheSource = {
  // get resolves to `null` on miss, timeout, throw, or malformed entry — never rejects, never hangs.
  get(key: string): Promise<SkydropxRate[] | null>
  // set is fire-and-forget under the same bound; a slow write never delays the response.
  set(key: string, rates: SkydropxRate[], ttlSeconds: number): Promise<void>
}
```

The cache unit tests (§6, S5) add **hang cases** — a `get`/`set` that never settles must resolve to the
fall-through within `QUOTE_CACHE_TIMEOUT_MS`, not only the throw cases r1 listed.

### 4.2 Key composition — ordered, named, additive

```
skydropx:quote:v${QUOTE_CACHE_VERSION}:${sha256(canonical).slice(0, 32)}
```

`canonical` joins an **ordered, named component list** with `\u001f` after the same normalization the
storefront signature uses (strip C0 controls → collapse whitespace → trim → lowercase), so the
delimiter is unrepresentable inside a value and two different component sets cannot collide.

> **CRITICAL-3 resolved.** r1's key was `origin ⨯ destination ⨯ parcel ⨯ (reserved carriers)` —
> **nothing identified whose account or which environment produced the rate.** `SkydropxCredentials.baseUrl`
> (`types.ts:25`) and `provider_setting.mode` select `sb-pro.skydropx.com` vs `api-pro.skydropx.com`.
> Flip mode, rotate accounts, or share one Redis between staging and production, and for up to the TTL
> `calculatePrice` returns another environment's tariff — **a sandbox price charged to a real shopper.**
> The codebase already re-keys its client cache on `credentialFingerprint(config)` (`service.ts:740-741`)
> for exactly this reason, yet §4.3 opens with "a cached rate is a price we charge" and r1 omitted the
> one dimension separating a real price from a fake one. **Fix: `credentialFingerprint(config)` is the
> LEADING key segment.**

| # | Segment | Members |
|---|---|---|
| **0** | **credential fingerprint** | **`credentialFingerprint(config)` — the same function `getClient_` uses at `service.ts:740-741`, which folds in `mode` + `baseUrl` (sandbox vs production) + account. Ahead of everything.** |
| 1 | origin | `country_code`, `postal_code`, `area_level1`, `area_level2`, `area_level3` |
| 2 | destination | same five |
| 3 | parcel | `length`, `width`, `height`, `weight` |
| 4 | *(reserved)* | `requested_carriers`, sorted + joined — **empty string today** |

A sandbox rate and a production rate for the identical shipment now live under **different keys** and
can never cross. Rotating accounts or flipping mode invalidates that tenant's entries automatically,
because the fingerprint changes.

**NOT cart-scoped.** A cart id in the key defeats the entire purpose: cross-cart sharing is the
mechanism.

**`requested_carriers` contingency.** Segment 4 already exists as an empty slot. If
`skydropx-webhook-and-carrier-selection` lands first, the change is *populate segment 4 and bump
`QUOTE_CACHE_VERSION`* — one component, one integer. Appending a segment can never cause a
**collision** (only a full invalidation, because every key changes), which is precisely the property
that makes it additive rather than a rewrite.

**Colonia stays in the key — decided against my own measurement, deliberately.** §0 proves colonia
does not move the rate, so a CP-level key would multiply the hit rate. I am **not** taking that win
in S5:

- The measurement is **SANDBOX**, n=10 variants on 2 postal codes. A cached rate is a **price we
  charge**, and we have no monitoring that would ever catch a wrong one.
- The spec mandates it ("any component of the destination that the carrier reads — including the
  colonia — differing MUST miss"), and overriding a revenue-safety rule on sandbox evidence is the
  wrong trade.
- The cost is bounded: per §3.5 no quote fires before a colonia exists, so this costs **zero extra
  cold quotes in the normal flow** — only cross-shopper sharing across colonias of one CP.

The follow-up is named and cheap: **repeat `area3.mjs` against production `api-pro`, n ≥ 20 postal
codes; if it reproduces, drop `area_level3` from segment 2 and bump the version.** That is a
one-component edit because the key is a named list.

### 4.3 TTL — a revenue decision, stated

| TTL | Trade |
|---|---|
| 60 s | Covers intra-checkout repeats only; near-zero cross-shopper value |
| **300 s (5 min)** | **CHOSEN** |
| 900 s / 3600 s | Materially better hit rate; exposes us to an hour of a stale price with no invalidation signal |

**Rationale — restated honestly after review (MAJ-4).** r1 justified the TTL on the *same* shopper:
`refreshCartShippingMethodsWorkflow` re-invoking `calculatePrice` on address writes and at method
selection. That premise is **an unverified proposal open question** promoted to load-bearing, and it is
**self-defeating** even if true — the same-shopper repeat already costs only ~996ms because Skydropx
caches server-side, so eliminating it wins little. The **only material win is cross-shopper cold-quote
elimination**, and that is where all the price-correctness risk lives. So the business case is stated
as what it actually is: **cross-shopper sharing of a cold quote within a 5-minute window.** 300s is
short enough to bound money exposure below any plausible carrier tariff-publication cadence while still
catching a meaningful fraction of cross-shopper cold quotes to the same origin/destination/parcel.
**Before S5 is scheduled**, re-read `refreshCartShippingMethodsWorkflow` and measure the warm path (§7)
— if the same-shopper repeat is genuinely cheap, that only confirms cross-shopper is the whole case; it
does not change the TTL. The proposal already ranks S5 "drop it first"; this design does **not** argue
it up.

**Invalidation: TTL expiry + `QUOTE_CACHE_VERSION` bump. Nothing else.** We have no carrier
price-change signal, and inventing an event-driven invalidation we cannot trigger would be a
guarantee we cannot keep. Stated rather than implied.

### 4.4 What is cached, and failure semantics

Cache the **usable `SkydropxRate[]`**, not the final amount. `selectCheapestRate` and
`config.taxInclusive ?? true` are our own deterministic post-processing applied at read time, so a
`taxInclusive` change takes effect immediately and a future carrier filter can reuse the entry.

Placement in `calculatePrice`: after `requireConfig_` + address construction (the key needs the
post-`withOriginZip_`/`withOriginColonia_` origin), **before `getClient_`** — so a hit skips the
OAuth token fetch entirely.

**Fail-open by construction.** Miss, read throw, write throw, unregistered cache, malformed entry →
live quotation, always. **No cache path can produce an error.** Reverting S5 removes a latency win,
never a price path.

---

## 5. S4 — backend colonia enforcement (split into S4a + S4b after review)

> **CRITICAL-5 resolved (both reviewers converged).** r1's single S4 had three defects:
> (a) it made `toAddress` strict but kept `address_2` OUT of `missingDestinationFields`, designing in
> the exact "field guard passes, then `toAddress` returns `undefined`" drift the label branch at
> `service.ts:1416-1422` warns is "only reachable if one of the two drifts" — giving the operator
> `"Skydropx label destination address is incomplete."` with no field named, **worse** than today's
> 422 that names `area_level3`;
> (b) the blast radius is **every existing order with no `address_2`** (the `AddressSelect`/store-API/
> legacy cohort), not "carts mid-checkout" — sellable yesterday, unlabelable tomorrow, and r1 mentioned
> them nowhere;
> (c) `origin-contract.unit.spec.ts` would **not** go RED — it is 94 lines, hand-asserts three fields,
> has no loop-based pinning, and its fixture already carries `address_2: "Valle de Aragon"` (`:29`), so
> `missing` stays `[]`. Meanwhile `PROVIDER_FORMS.skydropx` (`form-model.ts:85-145`) has nothing
> colonia-shaped, so r1 could ship a hard origin requirement with **no operator field to satisfy it** —
> reproducing the `originEmail` incident — and since `calculatePrice:806` builds origin through the same
> `toAddress`, that would take calculated shipping to **100% checkout failure**, and the setting + guard
> landed in the SAME slice so no deploy ordering could save `originColonia` first.

**The four required fixes:**

1. Add `address_2` to `missingDestinationFields` **and** a `DESTINATION_FIX_HINTS.address_2` entry, so
   the field guard and `toAddress` stay coherent — the label branch at `:1416-1422` is no longer reachable
   by drift, and the label path names `colonia` instead of the blind "incomplete" string.
2. **Write the RED test** as a bidirectional, loop-based assertion iterating every field
   `missingOriginFields` can emit against `PROVIDER_FORMS.skydropx` (and the destination equivalent), so
   this drift class cannot recur silently. Do **not** rely on the existing hand-asserted file.
3. **Split S4** so the operator-facing plumbing lands **before** the guard turns on (S4a), and the guard
   (S4b) turns on a release later.
4. Own the existing-order migration explicitly in §7 and in the PR body.

### 5.0 The split — S4a (plumbing) before S4b (guard)

| Slice | Turns the guard ON? | Contents |
|---|---|---|
| **S4a** | **No** | Add `originColonia` to `PROVIDER_FORMS.skydropx` (`form-model.ts`) with `optional: false` at the form layer but `.optional()` in `skydropxUpsertSchema` so pre-change rows stay loadable — exact `originEmail` discipline; add `DESTINATION_FIX_HINTS.address_2` and `ORIGIN_FIX_HINTS.address_2`; add `QUOTE_FIELD_LABELS`; ship `withOriginColonia_` (§5.3) so an operator CAN save the value and the stock-location fallback is live. **No `toAddress` change, no new `missing*` requirement wired into a guard.** Storefront and label behaviour unchanged. |
| **S4b** | **Yes** | Flip `toAddress` to require `area_level3`; add `address_2` to `missingDestinationFields` + `missingQuoteDestinationFields`; add `address_2` to `missingOriginFields`. Gated behind **"setting present OR stock-location value present"** for its first release, so an origin with neither still degrades to the carrier 422 rather than 100% hard-fail. The RED `origin-contract`/destination pinning tests land here. |

Deploy ordering is now expressible: **S4a → operators populate `originColonia` → S4b**. Because S4a
ships the setting and fallback with no enforcement, there is a real window in which every operator can
supply the value before any guard rejects on its absence.

### 5.1 Pre-flight, before any network call (S4b)

`toAddress` makes `area_level3` **required** (returns `undefined` without it), matching the MODIFIED
spec requirement. This narrows the **label** path too — not new breakage: the label flow quotes through
the same `quoteAndPoll_`/`toAddress`, so a colonia-less label already fails today at the 422. S4b moves
that failure earlier **and now names the field**, because `address_2` is in `missingDestinationFields`
(fix 1) — the previously-unreachable-by-design `:1416-1422` branch is genuinely unreachable again.

New/changed guards, all reading colonia through **one** helper (MAJ-3, below):

- `missingDestinationFields` **gains `address_2`** — the label guard, now coherent with `toAddress`.
  `DESTINATION_FIX_HINTS.address_2` added alongside.
- `missingQuoteDestinationFields(address)` — the four `missingAddressComponents` plus `address_2`.
  Distinct from `missingDestinationFields` only in that it omits the contact fields the label path adds.
- `missingOriginFields` gains `address_2` (after `withOriginColonia_` has run), **gated** per §5.0 for
  its first release. This is what turns the **new loop-based** `origin-contract` pinning test RED by
  design — made green by S4a's form edit, never by weakening the guard.

> **MAJ-3 resolved.** `toAddress:441-443` reads `text(address.address_2) ?? text(address.metadata?.colonia)`,
> but r1's `missingQuoteDestinationFields` read only `address_2` — it would reject requests the wire
> builder could build. **Fix: extract one `readColonia(address)` = `text(address_2) ?? text(metadata?.colonia)`,
> used by `toAddress`, `missingDestinationFields`, `missingQuoteDestinationFields`, and
> `missingOriginFields`.** Same single-source-of-truth invariant `service.ts:980-982` already states for
> `destinationContact`. The RED pinning test asserts guard and wire builder read the identical source.

### 5.2 The message — actionable AND leak-free, on the seam that already exists

`calculatePrice` is reachable from the public `POST /store/shipping-options/:id/calculate` and Medusa
passes messages through **verbatim**. `fetchUsableRates_` (`:1454-1487`) already splits
`storefront` vs `admin`; the pre-flight follows that seam rather than inventing a second one.

| Audience | Destination gap | Origin gap |
|---|---|---|
| `storefront` | `Skydropx quote requires a complete destination address. Missing: colonia.` — **field labels only**, from our own catalogue | `Skydropx is not configured for shipping quotes.` — **no field detail at all** |
| `admin` | full `describeMissingFields(…, DESTINATION_FIX_HINTS, …)` as today | full `describeMissingFields(…, ORIGIN_FIX_HINTS, …)` as today |

Two rules make this leak-free **by construction**, not by review:

1. **Our vocabulary, never the carrier's.** A new `QUOTE_FIELD_LABELS` map emits `country`,
   `postal code`, `state`, `city`, `colonia` — not `area_level3`. The message cannot contain an
   upstream body, status, host, endpoint or credential because it is assembled only from a closed
   literal map keyed by a closed field list.
2. **Origin gaps carry no detail on the public path.** An origin gap is *our* misconfiguration; the
   existing hints name the Skydropx admin settings, which is useless to a shopper and needlessly
   discloses our stack. Full detail still goes to `logger_.error`, exactly as today.

The existing storefront redaction at `:1473-1474` is **not loosened**.

### 5.3 `withOriginColonia_`

Mirrors `withOriginZip_` (`:1435-1448`) **verbatim**, including the `text()` whitespace-trim guard —
a `"   "` colonia on the stock location must not defeat the fallback and then be reported as missing
while the setting IS configured. Stock location wins when non-blank; the setting fills a blank;
neither → `missingOriginFields` names `address_2` with a hint naming **both** places.

---

## 6. Slices — files, RED-first tests, rollback

Order is the committed `stacked-to-main` **S0 → S1 → S2 → S3 → S4a → S4b → S5** — **seven slices**
(S4 split into S4a plumbing + S4b guard per CRITICAL-5). **Strict TDD is ACTIVE on both apps**: the
listed test file goes RED before any source edit.

| # | App | Files touched | RED first | Est. | Rollback |
|---|---|---|---|---|---|
| **S0** | storefront | `lib/util/shipping-quote.ts` (+`readPresentableAmount`, widen `classifyQuoteResult`, `QuotedOption.amount`); `state/checkout-reducer.ts` (+`selectCarrierRatesUnavailable`, `selectShippingChoices` → helper); `components/shipping-section/index.tsx` (render note). **`checkout-context.tsx` NOT touched.** | `lib/util/shipping-quote.spec.ts`, `state/checkout-reducer.spec.ts` | ~120 | Pure revert; classification narrows back to today |
| **S1** | backend | `skydropx-fulfillment/client.ts` (**split** into `SKYDROPX_QUOTATION_REQUEST_TIMEOUT_MS` + `SKYDROPX_QUOTE_CYCLE_BUDGET_MS`, measurement constants, `readQuoteCycleBudget`, docstrings :13-16/:36); `service.ts` (:815 uses cycle budget; :927 label path untouched; raise `MIN_VIABLE_GATEWAY_TIMEOUT_MS` derivation + enforce in `readGatewayTimeout`) | `__tests__/constants.unit.spec.ts` — **keep `:89`** (now `SKYDROPX_QUOTATION_REQUEST_TIMEOUT_MS <= LABEL_QUOTE_BUDGET_MS`), **add** cycle-budget-≥-floor and label-budget-≥-floor assertions + `readQuoteCycleBudget` cases | ~130 | Revert to the 8 s cycle literal — today's failure, no worse |
| **S2** | storefront | `state/checkout-reducer.ts` (split action, `selectPostalCodeIsUsable`, `coloniasPostalCode`); `state/checkout-context.tsx` — **routing only**, one dispatch line | `state/checkout-reducer.spec.ts` | ~150 | Pure revert; a surviving colonia is strictly an improvement |
| **S3** | storefront | `lib/util/shipping-quote.ts` (5th component + docstring :14-39); `state/checkout-reducer.ts` (projection; **`commitDraft` clears `quotedSignature`** MAJ-2; **`COLONIA_MANUAL_REQUESTED` → `commitDraft`** MAJ-1); `lib/util/checkout-readiness.ts` (`colonia` @3.5) | `shipping-quote.spec.ts`, `checkout-readiness.spec.ts`, `checkout-reducer.spec.ts` (signature non-null→null on manual; quotedSignature cleared on X→Y→X) | ~200 | Revert un-narrows immediately. **Hard dep on S2.** Reverts **as a pair with S4b** — see below |
| **S4a** | backend | `admin/routes/provider-settings/form-model.ts` (`originColonia`); `skydropx-fulfillment/types.ts`, `provider-settings/types.ts`; `workflows/steps/validate-provider-payload.ts` (`.optional()`); `service.ts` (`withOriginColonia_`, `readColonia`, `QUOTE_FIELD_LABELS`, `DESTINATION_FIX_HINTS.address_2`, `ORIGIN_FIX_HINTS.address_2`) — **no guard turned on** | `__tests__/service.unit.spec.ts` (`withOriginColonia_` fallback/blank), form-model test | ~150 | Pure revert; adds an unused setting + fallback, enforces nothing |
| **S4b** | backend | `service.ts` (`toAddress` requires `area_level3`; `missingDestinationFields` += `address_2`; `missingQuoteDestinationFields`; `missingOriginFields` += `address_2` **gated** "setting OR stock-location present"; audience-split message) | `__tests__/service.unit.spec.ts`; **NEW loop-based** `admin/routes/provider-settings/__tests__/origin-contract.unit.spec.ts` + destination pinning — RED by design, green via S4a's form, **never** by weakening the guard | ~180 | Revert → carts fall back to the carrier 422 (~104 ms, §0). Reverts **as a pair with S3** |
| **S5** | backend | `service.ts` (`quoteCacheSource_`, `credentialFingerprint` key segment, `Promise.race` bound, in-flight single-flight by cache key MAJ-6, read/write around `fetchUsableRates_`); new `quote-cache.ts` (key + `makeMedusaQuoteCache` + `QUOTE_CACHE_TIMEOUT_MS`); `types.ts` (`SkydropxOptions.quoteCacheSource`) | **new** `__tests__/quote-cache.unit.spec.ts` (key stability, credential-fingerprint/colonia/parcel/origin miss, expiry, throwing get **and** throwing set, **hanging get and hanging set** CRITICAL-4) | ~260 | Fail-open by construction; reverting removes a cache, never a price path |

> **S3 and S4b are NOT independently revertible — they revert as a PAIR (MINOR, converged).** Reverting
> S3 alone while S4b is on `main` leaves the **backend requiring a colonia with no storefront gate to
> collect one** — strictly worse than pre-S4b. §6's "every slice is an independent revert" claim in r1
> was false for this pair. Any rollback that touches one MUST touch the other. S4a is independently
> revertible (it enforces nothing). Every other slice remains an independent revert.

Every slice leaves `main` coherent (S3+S4b as a unit) and keeps the `manual` provider registered
throughout.

**No slice touches any untouchable.** `?? null` (S0 widens the classifier *around* it), the
unconditional terminal `QUOTE_READY` dispatch (S0 does not enter that file), the single-writer
scheduler, `hasShippingMethod` failing closed, the controlled RadioGroup, failure parking, the
storefront redaction, the container-free constructor (S5 resolves per-operation), and
`selectShouldLookUpPostalCode` (§3.3) are all unmodified.

---

## 7. Open questions and residual risk

- [ ] **UX hole S3 opens.** With no colonia, `quoteSignature` is `null` → `selectQuoteStatus` reports
      `idle` → the section renders *"Ingresa tu código postal para ver las opciones…"* to a customer
      who **just entered one**. The spec's state table keeps that copy. Cheapest honest fix is a
      copy-only tweak to the `idle` branch ("…y elige tu colonia"); it is `MANUAL`-class and belongs
      in S3's PR. **Flagged, not silently absorbed.**
- [ ] **A returning colonia-less cart shows two blockers** (`colonia` + `shipping_method_stale`),
      because `initFromServer` seeds `UNKNOWN_SELECTION_SIGNATURE` when the signature is `null`.
      Correct per both rules; the copy is worse than the spec's single-field scenario implies.
- [ ] **Production `api-pro` latency profile is UNMEASURED** (M0 measured sandbox). If it is slower,
      the floor guard is what makes the gap visible instead of silent.
- [ ] **Production LB/proxy idle timeout is UNMEASURED and lives outside this repo** (M0(b) INFERRED).
      18_000 sits far under the 60_000 assumption, but it must be confirmed before shipping.
- [ ] **Browser → Next.js server-action leg UNMEASURED** (M0(b) INFERRED).
- [ ] **Skydropx's own cache key/TTL is unknown**; our TTL is not derived from it (proposal §4).
- [ ] **`Promise.allSettled` fan-out is N=1 today.** A second calculated option makes Next.js
      server-action concurrency load-bearing — worst case N × 18 s. Recorded in M0(b), unchanged here.
- [ ] **EXISTING-ORDER MIGRATION (CRITICAL-5b) — owned here and in the S4b PR body.** S4b makes
      `address_2` label-required. **Every existing order with no `address_2`** — the `AddressSelect` /
      store-API / legacy cohort — becomes unlabelable, not just carts mid-checkout. Before S4b ships:
      (a) run a read-only count of open/unfulfilled orders missing `address_2`; (b) backfill from
      `metadata.colonia` where present via a workflow; (c) for the residual, the gate "setting OR
      stock-location present" does not help destination — those orders need an operator to edit the
      destination colonia before labelling, and the S4b PR body MUST list the count and the remediation.
      **Do not ship S4b until this count is known.**
- [ ] **MAJ-6 — quote pile-up amplification.** 8s→18s cycle budget more than doubles per-shopper
      in-flight quotation pile-up against Skydropx's 2 req/s cap; abandoned rounds run to completion (no
      `AbortSignal`), no 429 handling exists. Amplification factor ≈ (18/8) per abandoned round.
      **Mitigation folded into S5**: single-flight in-flight quotations by cache key (the `getToken_`
      pattern), which also kills S5's own cold-start stampede. Recorded, not silently absorbed.
- [ ] **MAJ-7 — unlabelable-order class remains OPEN for wrong-but-present colonia values.** S3+S4b
      close the **blank** colonia case only. §0 proves a *nonexistent* colonia prices byte-identically
      (Skydropx validates non-blank, nothing more), and `toShipAddress:488` uses `address_2` as the
      label reference/apartment field (Medusa convention), so a returning customer whose saved
      `address_2` is `"Depto 3B"` passes readiness, passes the pre-flight, quotes fine, and produces an
      order whose `area_level3` is `"Depto 3B"`. **Stated plainly: this class stays open.** To close it,
      validate the picked colonia against the SEPOMEX list for the current CP — which `coloniasPostalCode`
      now makes expressible. **Not in this change**; recorded as the concrete follow-up.
- [ ] **MAJ-8 — S3 shrinks the pre-warm window the proposal's argument rests on.** After S3
      `quoteSignature` is `null` until a colonia exists, so quoting starts at colonia SELECTION, not
      postal-code resolution — partially dismantling "nobody stares at a spinner for 12s". M0 instructed
      that a ~10.9s median needs a visible progress state; `shipping-section/index.tsx:245` renders a
      skeleton with **no** progress or elapsed-time affordance. **Decision: the existing skeleton ships
      as-is and is ACCEPTED for this change** — adding an elapsed-time affordance is `MANUAL`-class UI
      work outside the reducer/selector testable surface and is deferred. The pre-warm-window reduction
      is recorded so a future phase can weigh a `quoting` progress affordance against it.
- [ ] **MAJ-4 — cache business case is cross-shopper; warm path UNMEASURED.** Before S5 is scheduled,
      re-read `refreshCartShippingMethodsWorkflow` and measure the same-shopper warm path. The TTL
      defence stands on cross-shopper cold-quote elimination regardless of the result (§4.3).
- [ ] **Wall-clock deadlines (MINOR).** Deadlines use `Date.now()`; the 18s cycle budget widens the
      NTP-step / GC-pause window versus 8s. Low probability, but a mid-cycle clock step could expire or
      extend a quote by the step size. Accepted; noted for completeness.
- [ ] **Cached `rate.id` staleness (MINOR).** The cache stores `SkydropxRate[]`, including `rate.id`. Harmless
      at checkout (we re-derive the amount), but a 300s-old `rate.id` is **not guaranteed purchasable** by
      `createShipment:970`. The label path does NOT read from this cache, so no purchase uses a stale id;
      recorded against any future reuse of the cached entry.
- [ ] **Proposal §3 stale premise (MINOR).** Proposal §3's "S1 before S4" paragraph still carries the
      falsified "12s 422" premise (§0 corrected only the S4 row). The **conclusion** (S1 before S4)
      holds; the stated reason does not. Flagged for a proposal touch-up, not blocking.

---

## 8. Verification

Unchanged from the two delta specs. `AUTO` covers everything in §2, §3, §5 and §6 through
`pnpm --filter @dtc/storefront test` (vitest, **node env, no jsdom** — every rule above lives in a
pure reducer/selector/util) and `pnpm --filter @dtc/backend test:unit` (jest). `STATIC` covers the
corrected docstrings, the absence of bare budget literals, and the two reset dispatch sites choosing
from `selectPostalCodeIsUsable`. `MANUAL` covers all rendering and every live-carrier claim.
**`sdd-verify` must not claim automated coverage of any `MANUAL` requirement.** No unit test can
prove 18_000 is large enough — only M0(a) can, and `MIN_VIABLE_QUOTE_BUDGET_MS` is what keeps that
measurement binding.

*Probe hygiene: all harnesses ran outside the repo under `$TMPDIR/opencode/m0/`. No secret material
printed. `git status --porcelain` shows only the two untracked openspec change folders.*

---

## Revision history

### r2 — 2026-08-07 — adversarial review resolution

Blind dual review (`review-findings.md`) returned **NOT SAFE TO IMPLEMENT AS WRITTEN** from both
reviewers. r1 is superseded by this revision. The **central structural change is CRITICAL-1: the
budget constant had TWO roles**, and r1 conflated them.

**The r1 approach was wrong because one constant carried two physics.** `SKYDROPX_QUOTATION_TIMEOUT_MS`
was simultaneously the **per-request bound** used on both the checkout and label paths (inside
`quoteAndPoll_` at `client.ts:310`/`:323`) **and** the **checkout cycle deadline** (`service.ts:815`).
r1 read `constants.unit.spec.ts:89` (`… <= LABEL_QUOTE_BUDGET_MS`) as a soft "coherence" rule and
proposed deleting it to raise the value to 18_000. That was false containment-blindness: on the label
path the per-request bound genuinely IS contained by the label budget, and raising the single constant
would have let one hung POST eat the entire label quote budget (zero poll rounds) while the numeric
assertion still passed, and inverted the `budgetBound` diagnosis. **The whole budget approach changed —
from "raise one number and delete the guard" to "SPLIT the constant into
`SKYDROPX_QUOTATION_REQUEST_TIMEOUT_MS` (~8_000, both paths) and `SKYDROPX_QUOTE_CYCLE_BUDGET_MS`
(~18_000, checkout only), keep `:89`, drop the invented `CHECKOUT_QUOTE_CEILING_MS`" — precisely
because the constant had two roles.**

| Finding | Resolution | Where |
|---|---|---|
| **CRITICAL-1** | Split the constant; `:89` kept (now on the request timeout); `CHECKOUT_QUOTE_CEILING_MS` dropped | §1.1, §1.2, §1.4 |
| **CRITICAL-2** | Default clamped `Math.max(derived, floor)`; cycle-budget-≥-floor asserted; upstream `MIN_VIABLE_GATEWAY_TIMEOUT_MS` raised + enforced in `readGatewayTimeout` | §1.2, §1.3, §1.4 |
| **CRITICAL-3** | `credentialFingerprint(config)` is the leading cache-key segment (segment 0), folding in mode + baseUrl + account | §4.2 |
| **CRITICAL-4** | Both `get` and `set` raced against `QUOTE_CACHE_TIMEOUT_MS` (~300ms); hang test cases added — bounds the never-return, not only the throw | §4.1, §6 (S5) |
| **CRITICAL-5** | S4 split into S4a (plumbing) + S4b (guard); `address_2` added to `missingDestinationFields` + `DESTINATION_FIX_HINTS`; new loop-based RED pinning test; guard gated "setting OR stock-location present"; existing-order migration owned | §5.0, §5.1, §6, §7 |
| MAJ-1 | `COLONIA_MANUAL_REQUESTED` routed through `commitDraft`; RED test | §3.5, §6 (S3) |
| MAJ-2 | `commitDraft` clears `quotedSignature` with `calculatedPrices`; RED test | §3.5, §6 (S3) |
| MAJ-3 | Single `readColonia(address)` used by all guards + wire builder | §5.1 |
| MAJ-4 | Business case restated as **cross-shopper**; warm-path measure gated before S5 | §4.3, §7 |
| MAJ-5 | `QUOTE_BUDGET_HEADROOM = 1.4` removed; 18_000 = `MIN_VIABLE_QUOTE_BUDGET_MS + TAIL_ALLOWANCE_MS`, named | §1.2 |
| MAJ-6 | **ACCEPTED** for S1 with recorded amplification; single-flight mitigation folded into S5 | §3.5, §7 |
| MAJ-7 | **ACCEPTED as open** — wrong-but-present colonia stays unlabelable; SEPOMEX validation named as follow-up | §7 |
| MAJ-8 | **ACCEPTED** — existing skeleton ships as-is; pre-warm-window reduction recorded | §7 |
| MINOR: `SHIPPING_ADDRESS_FIELDS` | Corrected to `REQUIRED_ADDRESS_FIELDS` | §3.5 |
| MINOR: §3.5 path-1 "parked failure" | Corrected — a `null` signature parks nothing | §3.5 |
| MINOR: non-exhaustive switch | Corrected — `&&`-block sequence, not a switch | §2.3 |
| MINOR: S3/S4b pair revert | Stated — they revert as a pair, not independently | §6 |
| MINOR: n=40 p95 | Labelled honestly (order statistic + CI + non-independence) | §1.2 |
| MINOR: wall-clock 18s | One sentence added | §7 |
| MINOR: cached `rate.id` | Recorded; label path does not read this cache | §7 |
| MINOR: proposal §3 stale premise | Flagged for proposal touch-up | §7 |
| Spec `failed` copy `:519` | Fixed in `specs/storefront-checkout/spec.md` to match shipped copy (`index.tsx:282-283`) | — |

**Confirmed-correct items left untouched** (both reviewers): `coloniasPostalCode` (§3.2), the
`area_level3` positive control, S0's non-modification of `checkout-context.tsx`, §0's falsification of
the "12s 422" claim, `MIN_VIABLE_QUOTE_BUDGET_MS = MAX + POLL_INTERVAL`, and all untouchable guards.

**No documented disagreement.** Every finding was accepted; the three MAJORs not fully implemented in
their originating slice (MAJ-6, MAJ-7, MAJ-8) are explicitly ACCEPTED with a stated reason and a
recorded location rather than silently dropped.

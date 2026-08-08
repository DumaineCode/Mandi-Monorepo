# Apply Progress — checkout-shipping-quote-reliability

Mode: **Strict TDD** (storefront, vitest node-only). First apply slice; no prior progress to merge.

## Slice S0 — Flat-option rescue (storefront)

Status: **COMPLETE**. Whole storefront suite green (618 passed / 11 files).
`checkout-context.tsx` NOT touched (verified byte-for-byte unchanged via `git diff --name-only`).

### Task status

- [x] S0.1 RED — `lib/util/shipping-quote.spec.ts`: `readPresentableAmount` cases (`Number.isFinite`, `0` presentable) + classifier mixed/all-flat/empty scenarios. Confirmed RED (11 failed: `readPresentableAmount is not a function` + `expected 'unpriceable' to be 'priced'`).
- [x] S0.2 GREEN — `lib/util/shipping-quote.ts`: added `QuotedOption.amount?: number | null`, added `readPresentableAmount(option, prices)` (`Number.isFinite`), widened `classifyQuoteResult` to `input.options.some(readPresentableAmount(...) !== null)`, empty list → `"priced"`. Corrected the classifier docstring in place (flat options now participate). Suite green.
- [x] S0.3 RED+GREEN — `state/checkout-reducer.spec.ts`: added `selectCarrierRatesUnavailable` describe (true only in `quoted` with an unpresentable calculated row; false in idle/looking_up/quoting/failed/not_serviceable/all-flat/zero-priced). Confirmed RED (8 failed: not a function). Added `selectCarrierRatesUnavailable` to `checkout-reducer.ts`; refactored `selectShippingChoices` to call `readPresentableAmount` (behaviour-identical; removed now-dead local `readAmount`). Suite green.
- [x] S0.4 MANUAL — `components/shipping-section/index.tsx`: renders the carrier-rates-unavailable annotation from `selectCarrierRatesUnavailable` above the option list in the `quoted` branch, fixed Mexican-Spanish copy that points at the carrier and does NOT blame the address. `.tsx`, no node harness → **MANUAL visual verification required**.
- [x] S0.5 — `pnpm --filter @dtc/storefront test` → **618 passed (11 files)**.

### TDD Cycle Evidence

| Task | RED (test first) | GREEN (impl passes) | REFACTOR |
|------|------------------|---------------------|----------|
| S0.1/S0.2 `readPresentableAmount` + classifier | ✅ 11 failed pre-impl | ✅ `shipping-quote.spec.ts` 107 passed | classifier docstring rewritten in place |
| S0.3 `selectCarrierRatesUnavailable` + `selectShippingChoices` | ✅ 8 failed pre-impl | ✅ `checkout-reducer.spec.ts` 191 passed | `selectShippingChoices` → `readPresentableAmount`; dead `readAmount` removed |
| S0.4 annotation render | N/A (`.tsx`, MANUAL) | tsc `--noEmit` clean | — |

### Files changed

| File | Action | What |
|------|--------|------|
| `apps/storefront/src/lib/util/shipping-quote.ts` | Modified | `QuotedOption.amount?`, `readPresentableAmount`, widened `classifyQuoteResult`, docstring |
| `apps/storefront/src/lib/util/shipping-quote.spec.ts` | Modified | RED tests for `readPresentableAmount` + classifier scenarios |
| `apps/storefront/src/modules/checkout/state/checkout-reducer.ts` | Modified | `selectCarrierRatesUnavailable`; `selectShippingChoices` → helper; removed dead `readAmount` |
| `apps/storefront/src/modules/checkout/state/checkout-reducer.spec.ts` | Modified | `selectCarrierRatesUnavailable` describe |
| `apps/storefront/src/modules/checkout/components/shipping-section/index.tsx` | Modified | render carrier-rates annotation (MANUAL) |

`checkout-context.tsx` — **unchanged**.

### Diff stat

```
 shipping-quote.spec.ts  | 149 ++-
 shipping-quote.ts       |  66 +--
 shipping-section/index  |  23 ++
 checkout-reducer.spec   | 126 +++
 checkout-reducer.ts     |  40 +-
 5 files changed, 375 insertions(+), 29 deletions(-)
```

Total churn 404 lines. Production code (non-test) ≈129 (`shipping-quote.ts` 66 + `reducer.ts` 40 + `index.tsx` 23) — at the ~120 estimate; the remainder is TDD spec code. Within the ~200 hard cap for production scope.

### Constraint compliance

- `checkout-context.tsx` unchanged (byte-for-byte). ✅
- `readPresentableAmount` uses `Number.isFinite`, never truthiness; `?? null` semantics preserved; `0` is a real price. ✅
- No untouchable touched (terminal `QUOTE_READY`, single-writer scheduler, `hasShippingMethod`, `selectShouldLookUpPostalCode`). ✅
- Prices AS-IS (no /100 or *100). ✅
- No new data access. ✅

### Deviations from design

None. `classifyQuoteResult` and `selectCarrierRatesUnavailable` match design §2.2 / §2.3 exactly. One stale existing test (`is priced when the list is entirely flat-rate and the price map is empty`, premised on amountless flat options) was updated to give flat options real amounts — the spec now classifies an all-`null` flat list as `unpriceable` (task S0.1), so the old premise was superseded.

### Manual verification owed (S0.4)

Render the checkout Envío section with a cart carrying an unpriceable calculated option (e.g. `Expres` while Skydropx is down) beside a presentable flat option (e.g. `Gratis` at `0`). Confirm: both rows render, `Gratis` is selectable, and the inline note "Algunas tarifas de paquetería no están disponibles en este momento…" appears above the list without blaming the address.

---

## Slice S1 — Budget split + floor guards (backend)

Status: **COMPLETE**. Backend suite completes with **497 passed / 1 failed / 498 total (27 suites, 26 passed)**. The single failure is a **PRE-EXISTING** openpay test (`openpay-payment/__tests__/service.unit.spec.ts › authorizePayment — fresh charge`), proven independent of S1: it fails identically on the stashed S1 baseline. S1 touches only `skydropx-fulfillment/`; every skydropx suite passes. Label path (`service.ts:927` / `LABEL_QUOTE_BUDGET_MS`) unchanged. `client.ts` does NOT import `service.ts` (no cycle).

### Task status

- [x] S1.1 RED — `constants.unit.spec.ts`: KEPT `:89` as `SKYDROPX_QUOTATION_REQUEST_TIMEOUT_MS <= LABEL_QUOTE_BUDGET_MS` (8_000 ≤ 17_100 ✓, CRITICAL-1 binding). ADDED floor assertions (`SKYDROPX_QUOTE_CYCLE_BUDGET_MS >= MIN_VIABLE_QUOTE_BUDGET_MS`, `LABEL_QUOTE_BUDGET_MS >= MIN_VIABLE_QUOTE_BUDGET_MS`) + `readQuoteCycleBudget` describe (unset/blank→clamped 18_000 and `>= MIN_VIABLE`; override `>=floor` passthrough; `<floor`/non-numeric/NaN→warn+clamped default). Confirmed **RED: 8 failed, 12 passed** (`SKYDROPX_QUOTATION_REQUEST_TIMEOUT_MS`/`readQuoteCycleBudget`/`MIN_VIABLE_QUOTE_BUDGET_MS`/`DERIVED_QUOTE_CYCLE_BUDGET_MS` did not yet exist).
- [x] S1.2 GREEN — `client.ts`: split `SKYDROPX_QUOTATION_TIMEOUT_MS` → `SKYDROPX_QUOTATION_REQUEST_TIMEOUT_MS = 8_000` (per-request, used at `createQuotation` + `getQuotation`, BOTH paths). Added measurement constants `SKYDROPX_COLD_QUOTE_P95_MS = 12_600`, `SKYDROPX_COLD_QUOTE_MAX_MS = 13_300`, `MIN_VIABLE_QUOTE_BUDGET_MS = 14_300` (MAX + poll interval), `TAIL_ALLOWANCE_MS = 3_700`, `DERIVED_QUOTE_CYCLE_BUDGET_MS = 18_000` (MIN_VIABLE + TAIL). Added clamped `readQuoteCycleBudget(raw, warn)` — default via `Math.max(derived, MIN_VIABLE_QUOTE_BUDGET_MS)` (CRITICAL-2: floor binds the production unset path, not only the env-override path). `SKYDROPX_QUOTE_CYCLE_BUDGET_MS = readQuoteCycleBudget()`. No `CHECKOUT_QUOTE_CEILING_MS` introduced. `client.ts` imports nothing from `service.ts`.
- [x] S1.3 GREEN — `service.ts:815`: checkout cycle deadline now `Date.now() + SKYDROPX_QUOTE_CYCLE_BUDGET_MS` (imported from `client.ts`). Label path at `:939` (`LABEL_QUOTE_BUDGET_MS`) untouched. Extracted `LABEL_QUOTE_SHARE = 0.45` (kills the bare `* 0.45` literal). Raised the gateway floor: added `MIN_VIABLE_QUOTE_ANCHOR_MS = ceil(MIN_VIABLE_QUOTE_BUDGET_MS / LABEL_QUOTE_SHARE)` and `MIN_VIABLE_GATEWAY_TIMEOUT_MS` now takes `max(MIN_VIABLE_ANCHOR_MS, MIN_VIABLE_QUOTE_ANCHOR_MS)` so a gateway-timeout reduction cannot starve the label quote below the floor — enforced inside `readGatewayTimeout` (which rejects overrides `< MIN_VIABLE_GATEWAY_TIMEOUT_MS`).
- [x] S1.4 STATIC — `client.ts` file-header docstring (`:13-16`) rewritten to distinguish per-request bound vs cycle deadline; the old `:36` single-literal comment replaced by two named constants each with a derivation docstring; `quoteAndPoll_` docstring "8s checkout" corrected to name `SKYDROPX_QUOTE_CYCLE_BUDGET_MS`. No bare budget literal remains (`LABEL_QUOTE_SHARE` named in `service.ts`).
- [x] S1.5 Acceptance — full `pnpm --filter @dtc/backend test:unit`: **497 passed, 1 pre-existing openpay failure**; all skydropx suites green.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| S1.1/S1.2 constant split + `readQuoteCycleBudget` | `__tests__/constants.unit.spec.ts` | Unit | ✅ 13/13 baseline | ✅ 8 failed pre-impl | ✅ 20 passed | ✅ 6 `readQuoteCycleBudget` cases + 2 floor assertions | ✅ measurement docstrings, `readQuoteCycleBudget` mirrors `readGatewayTimeout` |
| S1.3 cycle budget at `:815` + gateway floor | `__tests__/constants.unit.spec.ts` (`readGatewayTimeout`, floor) | Unit | ✅ (same suite) | ✅ (floor assertion RED) | ✅ 20 passed | ✅ existing `readGatewayTimeout` `it.each` still binds | ✅ `LABEL_QUOTE_SHARE` extracted, `MIN_VIABLE_QUOTE_ANCHOR_MS` named |
| S1.4 docstrings | — | Static | N/A | N/A | tsc clean via suite compile | ➖ N/A | ✅ no bare literal |

### RED → GREEN evidence

**RED** (`pnpm --filter @dtc/backend test:unit -- constants.unit.spec.ts`):
```
● Skydropx budget composition › keeps every per-request bound inside the budget that contains it
● Skydropx budget composition › keeps both quote budgets above the shared cold-quote floor
● readQuoteCycleBudget › clamps the derived default to the floor when unset or blank
● readQuoteCycleBudget › accepts an override at or above the floor unchanged
● readQuoteCycleBudget › warns on 14299 (just below the floor) …
● readQuoteCycleBudget › warns on 8000 (the pre-fix cycle literal, now below the floor) …
● readQuoteCycleBudget › warns on abc (a non-numeric value) …
● readQuoteCycleBudget › warns on NaN (NaN) …
Tests:       8 failed, 12 passed, 20 total
```

**GREEN** (constants suite): `Tests: 20 passed, 20 total`.
**GREEN** (full backend): `Test Suites: 1 failed, 26 passed, 27 total` / `Tests: 1 failed, 497 passed, 498 total` — the 1 failure is the pre-existing openpay test.

### Files changed

| File | Action | What |
|------|--------|------|
| `apps/backend/src/modules/skydropx-fulfillment/client.ts` | Modified | Split constant into `SKYDROPX_QUOTATION_REQUEST_TIMEOUT_MS` + `SKYDROPX_QUOTE_CYCLE_BUDGET_MS`; measurement constants; clamped `readQuoteCycleBudget`; docstrings `:13-16`/`:36`/`quoteAndPoll_` |
| `apps/backend/src/modules/skydropx-fulfillment/service.ts` | Modified | `:815` uses cycle budget; import updated; `LABEL_QUOTE_SHARE` + `MIN_VIABLE_QUOTE_ANCHOR_MS`; raised `MIN_VIABLE_GATEWAY_TIMEOUT_MS` |
| `apps/backend/src/modules/skydropx-fulfillment/__tests__/constants.unit.spec.ts` | Modified | RED floor/containment assertions + `readQuoteCycleBudget` cases |
| `apps/backend/src/modules/skydropx-fulfillment/__tests__/client.unit.spec.ts` | Modified | Renamed import/usages `SKYDROPX_QUOTATION_TIMEOUT_MS` → `SKYDROPX_QUOTATION_REQUEST_TIMEOUT_MS` (stale name after split caused `advanceTimersByTimeAsync(NaN)` → OOM) |

### Diff stat (backend only)

```
 __tests__/client.unit.spec.ts     |  10 +-
 __tests__/constants.unit.spec.ts  |  73 ++++++++++++-
 client.ts                         | 107 ++++++++++++++++--
 service.ts                        |  33 +++++-
 4 files changed, 202 insertions(+), 21 deletions(-)
```

Production (non-test) change: `client.ts` 97 + `service.ts` 29 = **126 insertions** (10+4 deletions) — at the ~130 estimate. Most of `client.ts`'s churn is the required measurement/derivation docstrings (S1.4). Well within the ~250 hard cap.

### Constraint compliance

- **CRITICAL-1**: `constants.unit.spec.ts:89`-equivalent kept and binding — `expect(SKYDROPX_QUOTATION_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(LABEL_QUOTE_BUDGET_MS)` → 8_000 ≤ 17_100 ✓. Label path unchanged; the per-request bound still contains inside the label budget, so the label quote keeps its poll rounds. ✅
- **CRITICAL-2**: unset/default path returns `DERIVED_QUOTE_CYCLE_BUDGET_MS` clamped via `Math.max(derived, MIN_VIABLE_QUOTE_BUDGET_MS)`; test `clamps the derived default to the floor when unset or blank` asserts `readQuoteCycleBudget(undefined) >= MIN_VIABLE_QUOTE_BUDGET_MS`. The floor binds the production path. ✅
- **Gateway floor (M2)**: `MIN_VIABLE_GATEWAY_TIMEOUT_MS` now funds `MIN_VIABLE_QUOTE_BUDGET_MS / 0.45`; `LABEL_QUOTE_BUDGET_MS >= MIN_VIABLE_QUOTE_BUDGET_MS` (17_100 ≥ 14_300 ✓) asserted. ✅
- `client.ts` does NOT import `service.ts` (no cycle). ✅
- Label path (`service.ts:939`, `LABEL_QUOTE_BUDGET_MS`) NOT reduced. ✅
- No storefront file changed in S1 (S0's 5 files only). ✅ No untouchable touched. Prices AS-IS. ✅
- No bare budget literal remains (extracted `LABEL_QUOTE_SHARE`). ✅

### Deviations from design

Minor, in-scope additions the design's own arithmetic requires:
- Extracted **`LABEL_QUOTE_SHARE = 0.45`** (design used a bare `* 0.45`) so the gateway floor can invert the same ratio and S1.4's "no bare budget literal" holds.
- Added **`MIN_VIABLE_QUOTE_ANCHOR_MS`** as the named intermediate for `MIN_VIABLE_QUOTE_BUDGET_MS / LABEL_QUOTE_SHARE`; `MIN_VIABLE_GATEWAY_TIMEOUT_MS` takes the `max` of it and the existing purchase anchor. Matches design §1.4 M2 intent exactly.
- Renamed the stale constant reference in `client.unit.spec.ts` (test-only; no assertion weakened). This was mandatory — the old name resolved to `undefined` after the split and drove `jest.advanceTimersByTimeAsync(NaN)` into an OOM. Not new behavior; the split's blast radius.

### Issues found

- **Pre-existing failure (NOT S1)**: `openpay-payment/__tests__/service.unit.spec.ts › authorizePayment — fresh charge › creates a charge with authorize-time amount and maps completed → captured` fails on the S1 baseline too (verified via `git stash`). Out of S1 scope; flagged for the orchestrator.

---

## Slice S2 — Colonia retention (storefront)

Status: **COMPLETE**. Whole storefront suite green (**632 passed / 11 files**); the reducer spec grew from 191 (post-S0) to **205 tests** (+14 S2 tests). `selectShouldLookUpPostalCode` UNCHANGED (function body byte-for-byte identical — verified by targeted `git diff`). The B→A→B retention edge is covered by a passing test. `checkout-context.tsx` edited ONLY for the reset-action selection (+ its import + comment).

**MAJ-2 DEFERRED to S3, per tasks.md.** The prompt folded MAJ-2 into S2 conditionally; tasks.md scopes it to **S3.3 (RED) / S3.5 (GREEN)** (`commitDraft` clears `quotedSignature` with `calculatedPrices`). Following tasks.md keeps the stacked-PR boundary clean and preserves the S3/S4b pair-revert coupling. S3 also introduces colonia into `buildQuoteSignature`, which is what turns MAJ-2 from a rare debounce race into a two-click one — so the MAJ-2 RED test belongs with that change. Not landed in S2.

### Task status

- [x] S2.1 RED — `state/checkout-reducer.spec.ts`: added three describes — `CP_LOOKUP_NOT_NEEDED` (idle only; colonias + `coloniasPostalCode` + `coloniaManual` untouched; no-op identity when already idle), `CP_LOOKUP_DISCARDED` (idle + `colonias:[]` + `coloniasPostalCode:null`; `coloniaManual` untouched; no-op identity), and `selectPostalCodeIsUsable` (false on non-`MX_POSTAL_CODE_PATTERN` via `it.each`; true when list empty; true when `coloniasPostalCode === cp`; **false on the B→A→B edge** where a list fetched for A survives under a different draft postal code B). Confirmed **RED: 14 failed / 618 passed** (`selectPostalCodeIsUsable is not a function`, `CP_LOOKUP_NOT_NEEDED`/`CP_LOOKUP_DISCARDED` no-op to same object, `coloniasPostalCode` undefined).
- [x] S2.2 GREEN — `state/checkout-reducer.ts`: added `coloniasPostalCode: string | null` to `CheckoutState` (with the B→A→B rationale docstring); `null` in `initFromServer`; written (trimmed) by `CP_LOOKUP_FOUND` alongside `colonias`; cleared to `null` by `CP_LOOKUP_NOT_FOUND` (keeps the "null when no list" invariant). Split `CP_LOOKUP_RESET` into `CP_LOOKUP_NOT_NEEDED` (idle-only, no-op guard on `cpStatus === "idle"`) and `CP_LOOKUP_DISCARDED` (idle + clear list + clear `coloniasPostalCode`, `coloniaManual` untouched, no-op guard on all-three-clear). Added `selectPostalCodeIsUsable(state)` beside `selectShouldLookUpPostalCode` (which is NOT weakened). Migrated the two old collapsed `CP_LOOKUP_RESET` tests to `CP_LOOKUP_DISCARDED` (the unusable-code path they asserted) — split blast radius, no coverage weakened; the no-op case is retained per new action. Suite green.
- [x] S2.3 STATIC — `state/checkout-context.tsx`: replaced the single `dispatch({ type: "CP_LOOKUP_RESET" })` with a ternary choosing `CP_LOOKUP_NOT_NEEDED` vs `CP_LOOKUP_DISCARDED` from `selectPostalCodeIsUsable(stateRef.current)`. No logic in the `.tsx` — the DECISION lives in the tested pure predicate; the wiring is a static action choice. Only change to this file (plus its import + updated comment).
- [x] S2.4 Acceptance — `pnpm --filter @dtc/storefront test` → **632 passed (11 files)**. `tsc --noEmit` clean on the touched files.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| S2.1/S2.2 split actions + `selectPostalCodeIsUsable` + `coloniasPostalCode` | `state/checkout-reducer.spec.ts` | Unit | ✅ 618 baseline | ✅ 14 failed pre-impl | ✅ 632 passed | ✅ `it.each` malformed CPs + empty-list/match/B→A→B edge + both no-op guards | ✅ `CP_LOOKUP_NOT_FOUND` clears `coloniasPostalCode` too (invariant); `CP_LOOKUP_FOUND` docstring de-referenced dead `CP_LOOKUP_RESET` |
| S2.3 reset-action selection | — (`.tsx`, STATIC) | Static | N/A | N/A | tsc `--noEmit` clean | ➖ static | — |

### RED → GREEN evidence

**RED** (`pnpm --filter @dtc/storefront test -- checkout-reducer.spec.ts`):
```
TypeError: (0 , selectPostalCodeIsUsable) is not a function
AssertionError: expected undefined to be '06700'   // coloniasPostalCode not written yet
(CP_LOOKUP_NOT_NEEDED / CP_LOOKUP_DISCARDED do not yet exist → no-op/identity assertions fail)
 Test Files  1 failed | 10 passed (11)
      Tests  14 failed | 618 passed (632)
```

**GREEN** (whole suite): `Test Files 11 passed (11)` / `Tests 632 passed (632)`.

### Files changed (S2)

| File | Action | What |
|------|--------|------|
| `apps/storefront/src/modules/checkout/state/checkout-reducer.ts` | Modified | `coloniasPostalCode` state field + init/`CP_LOOKUP_FOUND` write/`CP_LOOKUP_NOT_FOUND` clear; `CP_LOOKUP_RESET` → `CP_LOOKUP_NOT_NEEDED` + `CP_LOOKUP_DISCARDED`; `selectPostalCodeIsUsable`; de-referenced dead action name in a docstring |
| `apps/storefront/src/modules/checkout/state/checkout-reducer.spec.ts` | Modified | 3 new describes (+14 tests); migrated 2 old `CP_LOOKUP_RESET` tests to `CP_LOOKUP_DISCARDED` |
| `apps/storefront/src/modules/checkout/state/checkout-context.tsx` | Modified | reset-action selection from `selectPostalCodeIsUsable` (the ONLY change) |

### Diff stat (S2 files; reducer.ts/spec include S0's earlier unstaged changes)

```
 checkout-context.tsx        |  16 +-
 checkout-reducer.spec.ts    | 289 ++-
 checkout-reducer.ts         | 125 ++-
```

Production (non-test) change attributable to S2: reducer.ts S2 share ≈ 71 lines (of 111 additions; ~40 belong to S0) + context.tsx 11 = **~82 production lines** — under the ~150 budget. Much of it is the design-mandated `coloniasPostalCode`/split docstrings; the logic is one state field, two action cases, one selector, and two population sites.

### Constraint compliance

- **`selectShouldLookUpPostalCode` NOT weakened** — function body byte-for-byte identical (verified via targeted `git diff`). Only a `{@link}` back-reference to it was added inside the new selector's docstring. ✅
- **B→A→B retention edge covered** by a passing test (`selectPostalCodeIsUsable > is false when a held list belongs to a different postal code`). ✅
- `checkout-context.tsx` edited ONLY for the reset-action selection (+ import + comment). No other change. Decision lives in the pure tested `selectPostalCodeIsUsable`; `.tsx` wiring is STATIC. ✅
- No untouchable touched: `?? null` never `?? 0`; unconditional terminal `QUOTE_READY` dispatch; single-writer scheduler; `hasShippingMethod`; `selectShouldLookUpPostalCode`. ✅
- Node-only vitest: every S2 rule is asserted in the reducer/selector; the `.tsx` dispatch selection is STATIC. ✅
- No `openspec/changes/` file modified except `apply-progress.md`. ✅
- Mexican-Spanish UI copy untouched (S2 is state-only). ✅

### Deviations from design

None on the S2 scope. `CP_LOOKUP_NOT_NEEDED` / `CP_LOOKUP_DISCARDED` / `selectPostalCodeIsUsable` / `coloniasPostalCode` match design §3.1–§3.2 exactly. One in-scope refinement beyond the literal task text: `CP_LOOKUP_NOT_FOUND` now also nulls `coloniasPostalCode` (it already empties `colonias`), preserving the "null iff no list held" invariant `selectPostalCodeIsUsable` relies on. **MAJ-2 deferred to S3 per tasks.md (noted above), not a deviation — a scope boundary.**

### Manual verification owed (S2)

`.tsx` wiring is STATIC-verifiable (grep confirms the ternary). No new MANUAL rendering owed by S2 beyond the STATIC dispatch-site inspection the spec's "reset action carries which of the two facts it asserts" scenario calls for.

---

## Slice S3 — Colonia in signature + MAJ-1/MAJ-2 (storefront)

Status: **COMPLETE**. Whole storefront suite green (**657 passed / 11 files**; up from 632 post-S2, +25 S3 tests). Hard dep on S2 satisfied (uses `coloniasPostalCode`, `selectPostalCodeIsUsable`, the split reset actions). `selectShouldLookUpPostalCode` UNCHANGED (only a `{@link}` docstring reference, no body change). `tsc --noEmit` clean.

> **S3 makes `main` STRICTER, deliberately.** The colonia (`address_2`) becomes (a) a quote-signature component and (b) a required field for order readiness (code `colonia` at 3.5). A mid-checkout cart with no colonia now finds the CTA newly blocked, and a colonia-less draft is no longer quotable. This is the intended narrowing (Amendment A4 / spec) — it must be stated in the PR body.
>
> **S3 and S4b REVERT AS A PAIR.** Reverting S3 while S4b is on `main` leaves the backend requiring a colonia (`area_level3`) with NO storefront gate — strictly worse than pre-S4. The `stacked-to-main` chain must revert them together.

### Task status

- [x] S3.1 RED — `lib/util/shipping-quote.spec.ts`: base `COMPLETE` fixture gains `address_2: "Roma Norte"`; the old "ignores street fields entirely" test rewritten to vary `address_1` ONLY (colonia held equal); added colonia scenarios — colonia change moves the signature, two colonias under one CP differ, same colonia stable, `"  Centro  "` collapses to `"centro"`, missing/blank/undefined colonia → `null`. Confirmed **RED: 5 failed** (`address_2` not yet in the signature; still non-null on a missing colonia).
- [x] S3.2 GREEN — `shipping-quote.ts`: `QuoteRelevantAddress` gains `address_2?: string | null`; `buildQuoteSignature` adds `readComponent(address.address_2)` as the 5th component under the SAME normalization (NFC → strip C0 → collapse ws → trim → lowercase, `\u001f` delim). Rewrote the type docstring `:10-49` IN PLACE: the STREET half of the exclusion stands (`address_1` still out), the COLONIA half is reversed with the §0/422 evidence (`area_level3` "no puede estar en blanco") — the falsified justification is corrected, not silently contradicted. Suite green.
- [x] S3.3 RED (MAJ-2) — `state/checkout-reducer.spec.ts`: added `commitDraft clears quotedSignature with calculatedPrices (MAJ-2)` describe — a colonia Roma Norte→Sur move drops `calculatedPrices` AND `quotedSignature` (null); a colonia X→Y→X round-trip does NOT falsely report `quoted`; a street edit (signature stable) leaves the held quote intact. Confirmed RED (signatures null pre-projection).
- [x] S3.4 RED (MAJ-1) — `state/checkout-reducer.spec.ts`: added `COLONIA_MANUAL_REQUESTED routes through commitDraft (MAJ-1)` describe — clearing a present colonia drives the draft-derived signature non-null → null, sets `coloniaManual`, and drops held `calculatedPrices`/`quotedSignature`. Confirmed **RED: 5 failed** across S3.3+S3.4 (`quoteSignature` null because `selectQuoteRelevantAddress` did not yet project `address_2`).
- [x] S3.5 GREEN — `checkout-reducer.ts`: (a) `selectQuoteRelevantAddress` now projects `address_2: draft.address_2` (docstring updated: FIVE fields, street out / colonia in); (b) `commitDraft` clears `quotedSignature: null` alongside `calculatedPrices: {}` on a destination move (MAJ-2 — same round, cleared together); (c) `COLONIA_MANUAL_REQUESTED` routed THROUGH `commitDraft({ draft: { …, address_2: "" } })` then re-applies `coloniaManual: true` (MAJ-1 — clearing the colonia now recomputes the signature). Tests → green.
- [x] S3.6 RED+GREEN — `lib/util/checkout-readiness.spec.ts` + `checkout-readiness.ts`: added `colonia` as the tenth `MissingRequirementCode` at position 3.5 (after `shipping_address`, before `billing_address`), message `Elige tu colonia.`, emitted by a trim-based `isAbsent(address?.address_2)` branch. Kept OUT of `REQUIRED_ADDRESS_FIELDS` (its own single-field code, like `phone`). `ReadinessAddressSnapshot` gains `address_2`. Ready fixtures (`READY`, `FULL_ADDRESS`, D8-port built address) gained `address_2` so pre-existing ready-cart tests stay honest; catalogue-ordering + voseo-count (9→10) + catalogue-message tests updated to include `colonia`. Confirmed **RED: 11 failed** pre-impl, then green.
- [x] S3.7 MANUAL — `shipping-section/index.tsx`: idle-branch copy tweaked from `"Ingresa tu código postal para ver…"` to `"Ingresa tu código postal y elige tu colonia para ver las opciones y el costo de envío."` (design §7 UX hole — a shopper who typed a CP saw a CP-only prompt before a colonia existed). Mexican `tú`, does NOT blame the address. `.tsx`, node-untestable → **MANUAL visual verification required**.
- [x] S3.8 Acceptance — `pnpm --filter @dtc/storefront test` → **657 passed (11 files)**.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| S3.1/S3.2 colonia in signature | `shipping-quote.spec.ts` | Unit | ✅ 632 baseline | ✅ 5 failed pre-impl | ✅ 114 passed | ✅ change/stable/two-colonia/normalize/missing cases + `isShippingSelectionStale` both directions | ✅ type docstring rewritten in place |
| S3.3 MAJ-2 (`quotedSignature` cleared) | `checkout-reducer.spec.ts` | Unit | ✅ 632 baseline | ✅ RED (signature null) | ✅ 214 passed | ✅ X→Y move, X→Y→X bounce, street-edit no-op | ✅ commitDraft docstring |
| S3.4 MAJ-1 (`COLONIA_MANUAL_REQUESTED` via commitDraft) | `checkout-reducer.spec.ts` | Unit | ✅ (same) | ✅ 5 failed pre-impl | ✅ green | ✅ signature non-null→null + prices/quotedSignature dropped | ✅ case docstring |
| S3.6 `colonia` code | `checkout-readiness.spec.ts` | Unit | ✅ 632 baseline | ✅ 11 failed pre-impl | ✅ 116 passed | ✅ exactly-one, blocks CTA, missing/undefined/blank, present→absent, ordering after address | ✅ REQUIRED_ADDRESS_FIELDS docstring |
| S3.7 idle copy | `shipping-section/index.tsx` | — (`.tsx`, MANUAL) | N/A | N/A | tsc clean | ➖ MANUAL | — |

### RED → GREEN evidence

**RED** (S3.1, `shipping-quote.spec.ts`): `Tests 5 failed | 634 passed` — `expected 'mx…' to be null` (missing colonia), colonia change not moving signature.
**RED** (S3.3/S3.4, reducer `-t "colonia in the quote signature"`): `5 failed | 2 passed` — `expected null not to be null` (signature null pre-projection).
**RED** (S3.6, `checkout-readiness.spec.ts`): `Tests 11 failed | 105 passed` — colonia code absent from catalogue.
**GREEN** (whole suite): `Test Files 11 passed (11)` / `Tests 657 passed (657)`.

### Blast-radius reconciliations (stale premises corrected, not weakened)

Four pre-existing tests rested on premises S3 falsifies; each was corrected to the NEW correct behaviour with the reasoning recorded:
- `FIELD_BLUR non-quote-relevant > address_2` — `address_2` moved out of the "leaves the signature untouched" list into an explicit "DOES move the signature for the colonia" counter-assertion.
- `SEPOMEX lookup > completes the signature from a postal code alone` — post-S3 a CP + province + city is no longer quotable; the test now asserts the signature stays null until a colonia is picked, then completes.
- `QUOTE_FAILED > leaves quotedSignature unchanged` — split into (a) `QUOTE_FAILED` itself never advances `quotedSignature` (isolated, no destination move) and (b) a destination move ahead of the failure clears the held quote via MAJ-2.
- `paidByGiftCard > suppresses nothing else` + full-catalogue-ordering + D8-port no-address — expected code lists gained `colonia` after `shipping_address` (the correct stricter output).

### `isShippingSelectionStale` — both directions verified

Added `isShippingSelectionStale > colonia in the signature (S3)`: (a) a colonia change (signature moved Roma Norte→Sur) → `true` — CORRECT, the price can differ between colonias; (b) a colonia change that does NOT move the signature (`"  Roma Norte  "` normalizes equal) → `false` — the selection stands. The reducer's street-edit test (`commitDraft` leaves `quotedSignature`/prices intact when the signature is stable) covers the same no-move guarantee at the transition level.

### Files changed (S3)

| File | Action | What |
|------|--------|------|
| `apps/storefront/src/lib/util/shipping-quote.ts` | Modified | `QuoteRelevantAddress.address_2?`; 5th signature component; type docstring rewritten in place (street stays out, colonia in with §0/422 evidence) |
| `apps/storefront/src/lib/util/shipping-quote.spec.ts` | Modified | colonia signature scenarios; `isShippingSelectionStale` both directions; `COMPLETE` fixture + street test updated |
| `apps/storefront/src/modules/checkout/state/checkout-reducer.ts` | Modified | `selectQuoteRelevantAddress` projects `address_2`; `commitDraft` clears `quotedSignature` (MAJ-2); `COLONIA_MANUAL_REQUESTED` via `commitDraft` (MAJ-1) |
| `apps/storefront/src/modules/checkout/state/checkout-reducer.spec.ts` | Modified | MAJ-1/MAJ-2 describes; S3 projection/colonia tests; 3 blast-radius reconciliations |
| `apps/storefront/src/lib/util/checkout-readiness.ts` | Modified | `colonia` code (type + message + snapshot field + 3.5 emit branch); `REQUIRED_ADDRESS_FIELDS` docstring |
| `apps/storefront/src/lib/util/checkout-readiness.spec.ts` | Modified | colonia catalogue scenarios; ready fixtures + ordering + voseo-count reconciled |
| `apps/storefront/src/modules/checkout/components/shipping-section/index.tsx` | Modified | idle-branch copy tweak (S3.7, MANUAL) |

### Diff numstat (S3 files; several also carry S0/S2 unstaged hunks)

```
 checkout-readiness.ts        |  29 +-   (all S3)
 checkout-readiness.spec.ts   |  70 ++-  (all S3)
 shipping-quote.ts            |  83 +-   (S3 code ≈2 lines; rest is the in-place docstring rewrite)
 shipping-quote.spec.ts       | 225 +-   (S3 tests)
 checkout-reducer.ts          | 141 +-   (S3 code ≈8 lines; S0/S2 hunks + docstrings)
 checkout-reducer.spec.ts     | 503 +-   (S3 tests + reconciliations)
 shipping-section/index.tsx   |  24 +-   (1 line S3.7; rest is S0)
 checkout-context.tsx         |  11 +-   (S2 only, untouched by S3)
```

**S3-attributable PRODUCTION code ≈ 17 lines** (`shipping-quote.ts` 2 + `checkout-reducer.ts` 8 + `checkout-readiness.ts` 6 + `index.tsx` 1); the remainder of the S3 production diff is the mandated in-place docstring rewrite. Well under the ~200 hard cap; no extra-scope stop needed.

### Constraint compliance

- **`selectShouldLookUpPostalCode` NOT weakened** — body unchanged; only a docstring `{@link}` reference exists (from S2). ✅
- **`isShippingSelectionStale` both directions** — colonia move → stale; colonia no-move (normalized-equal) → not stale. Explicit tests both ways. ✅
- No untouchable touched: `?? null` never `?? 0` (grep: none introduced); unconditional terminal `QUOTE_READY` dispatch untouched; single-writer scheduler untouched; `hasShippingMethod` untouched. ✅
- Colonia MUST move the signature (else a parked colonia-less 422 could never re-fire) — asserted and implemented. ✅
- MAJ-1 landed: `COLONIA_MANUAL_REQUESTED` routed through `commitDraft`, signature non-null → null. ✅
- MAJ-2 landed: `commitDraft` clears `quotedSignature` whenever it clears `calculatedPrices`. ✅
- No `openspec/changes/` file modified except `apply-progress.md` (and `tasks.md` `[x]` marks). ✅
- Mexican `tú` register; S3.7 copy does NOT blame the customer's address. ✅

### Deviations from design

None on scope. The four blast-radius test reconciliations above are the direct, correct consequence of colonia-in-signature, each recorded rather than silently changed.

### `.tsx` MANUAL items the user must verify visually

- **S3.7** — `shipping-section/index.tsx` idle-branch copy now reads `"Ingresa tu código postal y elige tu colonia para ver las opciones y el costo de envío."`. Confirm it renders in the Envío `idle` state (no complete signature) and reads naturally in Mexican `tú` without blaming the address.
- **CTA colonia message (integration)** — the new `colonia` requirement surfaces `Elige tu colonia.` under a blocked CTA. The reducer/readiness rule is node-tested; the RENDERED disabled-CTA copy and its ordering under the button is `.tsx` and belongs to the place-order-bar/summary consumers — verify a colonia-less cart shows exactly `Elige tu colonia.` and the CTA is disabled.

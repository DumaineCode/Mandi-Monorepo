# Skydropx Fulfillment — Delta

Change: `checkout-shipping-quote-reliability`
Domain: `skydropx-fulfillment`
Scope: `apps/backend` only.
Inputs: [`proposal.md`](../../proposal.md), [`explore.md`](../../explore.md).

## Baseline

`openspec/specs/` does not exist in this repo. The de-facto current spec for this domain is
`openspec/changes/skydropx-pro-oauth-migration/specs/skydropx-fulfillment/spec.md`. Every `MODIFIED`
block below is the **full** requirement copied from that document and then edited, so archive-time
replacement loses nothing.

## Conventions

| Class | Meaning |
|---|---|
| `AUTO` | Verifiable by `pnpm --filter @dtc/backend test:unit` (jest, `testEnvironment: node`, `**/src/**/__tests__/**/*.unit.spec.ts`). |
| `STATIC` | Verifiable by code inspection / grep. |
| `MANUAL` | Requires a live carrier, a live platform, or more than one running container. |

Prices are handled **as-is**: `calculated_amount = Number(rate.total)`, never `/100`, never `*100`.

**Audience rule (binding on every message below).** `calculatePrice` is reachable from the **public**
`POST /store/shipping-options/:id/calculate`, and Medusa's error handler passes messages through to
the HTTP response verbatim. Any message thrown on that path is therefore a **public string**. The
existing storefront-audience redaction MUST NOT be loosened.

## Gate M0 (design phase, zero production diff — not a PR, not a requirement)

No requirement below fixes a number. Three probes must answer first:

- **M0(a)** p99 of cold quotation completion over a widened sample. Blocks the budget constant.
- **M0(b)** whether the proxy/platform holds a ~20 s response on `.../calculate`, on both apps. Blocks
  the derived budget.
- **M0(c)** whether the Medusa cache module resolves inside a fulfillment provider execution context.
  Blocks the cache slice's design.

---

## ADDED Requirements

### Requirement: The Checkout Quote Budget Is Derived From a Dated, Measured Constant

`S1` · `AUTO`

The system MUST express the checkout quotation budget as an **expression derived from a named,
documented, dated measurement constant** carrying its provenance. No bare quote-timeout literal may
remain on the checkout path.

- The measurement constant MUST record what was measured, when, and over what sample.
- The checkout budget MUST be derived from it with explicit headroom, in the same discipline already
  used on the label path, whose budget is a stated fraction of the module budget.
- The spec deliberately **does not fix the number**. It comes from M0(a) and lands in design. What the
  spec fixes is that the number is *derived and attributable*, never chosen.
- A **load-time guard** MUST refuse, or loudly refuse-and-report, any configured quote budget below
  the measured constant. The current 8 s value was reachable precisely because nothing could
  contradict it.
- The guard MUST run at module load, not at first quote, so a misconfiguration is visible before a
  customer meets it.
- The two docstrings that present the 8 s literal as a designed trade-off MUST be corrected in place
  with the new evidence, not silently contradicted.

#### Scenario: The budget is an expression, not a literal

- GIVEN the working tree after this slice
- WHEN the checkout quote budget is read
- THEN it is computed from the measurement constant
- AND no bare quote-timeout numeric literal remains on the checkout path

#### Scenario: A budget below the measured floor is refused at load

- GIVEN a configured quote budget lower than the measurement constant
- WHEN the module loads
- THEN the guard refuses it (or clamps it to the floor and reports loudly)
- AND the outcome is deterministic and asserted

#### Scenario: A budget at or above the floor is accepted unchanged

- GIVEN a configured quote budget greater than or equal to the measurement constant
- WHEN the module loads
- THEN it is accepted unchanged

#### Scenario: The measurement constant carries provenance

- GIVEN the measurement constant
- WHEN it is inspected
- THEN it states the observation, the date, and the sample it came from
- *(`STATIC`.)*

#### Scenario: A first-ever quote to a new destination succeeds on the first attempt

- GIVEN a destination never quoted before and a correctly configured provider
- WHEN checkout requests a calculated price
- THEN a price is returned on the first attempt, with no retry
- *(`MANUAL` — requires the live carrier; this is the S1 success criterion and depends on M0(a).)*

---

### Requirement: Failure Semantics Hold at Any Budget

`S1` · `AUTO`

Whatever the budget value, these MUST hold.

- A quotation that exhausts the budget MUST fail as a budget exhaustion, distinguishable in the
  server log from a carrier-side slowness or a no-coverage answer.
- A budget exhaustion MUST NOT be reported as an empty or unserviceable rate list. "We ran out of
  time" and "we do not ship there" are different facts and MUST NOT collapse into one another.
- The whole flow — token fetch, quotation create, completion polling — MUST share a single budget.
- Every failure path MUST leave checkout degradable to the `manual` provider and MUST NOT crash it.

#### Scenario: A budget exhaustion is not an empty rate list

- GIVEN a quotation that never completes within the budget
- WHEN the budget elapses
- THEN the failure is raised as a budget exhaustion
- AND it is not surfaced as "no usable rates" or as a serviceability answer

#### Scenario: Token fetch time counts against the same budget

- GIVEN a first-call quote that must also fetch a token
- WHEN the budget is measured
- THEN token fetch, create and poll consume the one shared budget

#### Scenario: Every failure path degrades rather than crashes

- GIVEN a quotation that fails by timeout, by transport error, or by returning no usable rate
- WHEN `calculatePrice` runs
- THEN it raises a graceful `MedusaError` and checkout degrades to `manual`

---

### Requirement: The Origin Colonia Has an Explicit Setting With a Fallback

`S4` · `AUTO`

The provider MUST accept an explicit **origin colonia** setting and MUST use it as a fallback when the
stock-location address carries no colonia, mirroring the existing origin-ZIP fallback exactly —
including its whitespace-trim guard.

- When the stock-location address has a non-blank colonia, it MUST win; the setting MUST NOT overwrite
  it.
- When the stock-location address has no colonia, or a whitespace-only one, the setting MUST fill it.
- When neither exists, the origin colonia MUST be reported as missing by the origin field guard, with
  a fix hint naming **both** places an operator can set it — the stock location address and the
  provider setting — exactly as the origin-ZIP hint does.
- The origin field guard's recorded reasoning for tolerating a missing colonia is falsified by the same
  422 (which names `address_from.area_level3` too) and MUST be rewritten in place with that evidence.
- A field this guard hard-requires MUST be marked required in the admin provider form. The origin
  contract test pins the guard against the form **in both directions** and **will go RED** until the
  form is updated. That is the guard working, not a break.

#### Scenario: The stock-location colonia wins

- GIVEN a stock-location address with a colonia and a provider setting with a different one
- WHEN the origin address is built
- THEN the stock-location colonia is used

#### Scenario: The setting fills a blank origin colonia

- GIVEN a stock-location address whose colonia is absent or whitespace-only, and a provider setting that has one
- WHEN the origin address is built
- THEN the setting's value is used

#### Scenario: A whitespace-only colonia does not defeat the fallback

- GIVEN a stock-location colonia of `"   "` and a configured origin colonia
- WHEN the origin address is built
- THEN the configured value is used
- AND the colonia is not subsequently reported as missing

#### Scenario: Neither source reports an actionable origin gap

- GIVEN no stock-location colonia and no provider setting
- WHEN the origin field guard runs
- THEN the missing-field list names the origin colonia
- AND the fix hint names both the stock location address and the provider setting

#### Scenario: The admin form marks the origin colonia required

- GIVEN the origin contract test that pins the guard against the admin form in both directions
- WHEN it runs after this slice
- THEN it is green because the form marks the colonia required

---

### Requirement: Quotations Are Served From a Short-Lived, Fail-Open Cache

`S5` · `AUTO` (through an injectable fake) + `MANUAL` (cross-replica)

The provider MUST be able to serve a quotation from a cache keyed on the **normalized origin ⨯
destination ⨯ parcel**. This requirement states observable behaviour only; it carries **no correctness
content** beyond the guarantees below, and it is the first slice to drop if budget runs out.

- A cache hit MUST NOT serve a price for a **different destination**. Any component of the destination
  that the carrier reads — including the colonia — differing MUST miss.
- A cache hit MUST NOT serve a price for a **different parcel**.
- A cache hit MUST NOT serve a price for a **different origin**.
- Entries MUST expire within a bounded, explicitly configured staleness window. A cached rate is a
  price we charge; the window is a revenue decision, not a performance knob, and is decided in design
  with an explicit invalidation story.
- A cache **miss, read error, or write error MUST degrade to a live quotation**, never to an error.
  Fail-open by construction: removing the cache removes a latency win, never a price path.
- Normalization MUST be stable: values differing only by surrounding whitespace or letter case MUST
  produce the same key, so trivially different spellings of the same destination do not both pay a
  cold quote.
- If the carrier-selection change lands first, the requested-carriers restriction MUST become a
  mandatory key component. Otherwise a carrier-restricted quote and an unrestricted one collide and we
  sell a price for carriers we did not offer.

#### Scenario: A second cart to the same colonia and parcel is served from cache

- GIVEN a quotation was cached for an origin, destination and parcel
- WHEN a second quotation is requested for the same normalized origin, destination and parcel within the staleness window
- THEN the cached result is returned
- AND no carrier quotation is issued

#### Scenario: A different colonia misses

- GIVEN a cached quotation for a destination whose colonia is `"Roma Norte"`
- WHEN a quotation is requested for the same postal code with colonia `"Roma Sur"`
- THEN the cache misses and a live quotation is issued

#### Scenario: A different parcel misses

- GIVEN a cached quotation for a parcel
- WHEN a quotation is requested for the same origin and destination with different parcel dimensions or weight
- THEN the cache misses and a live quotation is issued

#### Scenario: An expired entry misses

- GIVEN a cached quotation older than the configured staleness window
- WHEN a quotation is requested for the same key
- THEN the cache misses and a live quotation is issued

#### Scenario: A cache failure never fails the quote

- GIVEN a cache source whose read throws, and separately one whose write throws
- WHEN a quotation is requested
- THEN a live quotation is issued and its result is returned
- AND no error reaches the caller because of the cache

#### Scenario: Normalization is case- and whitespace-stable

- GIVEN two destinations differing only by surrounding whitespace and letter case
- WHEN their cache keys are built
- THEN the keys are equal

#### Scenario: The cache is shared across backend containers

- GIVEN more than one backend container behind the same cache infrastructure
- WHEN a second container quotes a destination the first has already quoted
- THEN it is served from the shared cache
- *(`MANUAL` — depends on M0(c) and on more than one running container. If M0(c) fails, this scenario is withdrawn and the cache degrades to per-replica, which the fail-open rule already permits.)*

---

## MODIFIED Requirements

### Requirement: The whole quote flow stays inside a single derived budget

`S1` · `AUTO`
(Previously: "Whole quote flow stays inside the shared 8s budget" — an unmeasured 8 s literal
presented as a designed trade-off.)

The token fetch (if any), quotation create, and completion polling MUST all share a **single** budget
enforced by one `AbortController`. If the quotation does not complete within the budget, the client
MUST treat it as a quote failure.

That budget MUST be the derived value defined by "The Checkout Quote Budget Is Derived From a Dated,
Measured Constant". The literal 8 s is removed: measured cold completions of the identical
create-and-poll call were **12811 / 11353 / 12043 ms**, so an 8 s budget was arithmetically incapable
of completing the call and failed **every first purchase to a new destination by construction**. The
same call on the admin label path is already granted ~17.1 s.

#### Scenario: Timeout before completion degrades to manual

- GIVEN a quotation that never reaches completion within the derived budget
- WHEN the shared budget elapses
- THEN the quote fails with a graceful `MedusaError`
- AND checkout degrades to the `manual` provider

#### Scenario: Token fetch time counts against the same budget

- GIVEN a first-call quote that must also fetch a token
- WHEN the budget is measured
- THEN token fetch, create, and poll all consume the single `AbortController` budget

#### Scenario: The budget in force is the derived value

- GIVEN the module after this slice
- WHEN the quotation budget is read at the checkout call site
- THEN it equals the derived expression and not a literal

---

### Requirement: Quotation requires the destination address hierarchy including area_level3

`S4` · `AUTO`
(Previously: `area_level3` was best-effort — included when the cart provided it, omitted otherwise.)

At `calculatePrice`, the quotation MUST source and send `country_code`, `postal_code`, `area_level1`
(state), `area_level2` (city) **and `area_level3` (colonia)** as **required** fields. `area_level1`
MUST be sent in the format PRO expects (full state name), normalizing any ISO/abbreviated `province`
code. No component may be fabricated when absent.

`area_level3` moves from best-effort to required because Skydropx PRO rejects a quote without it:
`422 {"errors":{"address_from":{"area_level3":["no puede estar en blanco"]},"address_to":{"area_level3":["no puede estar en blanco"]}}}`.

#### Scenario: Address present on the quotation request

- GIVEN a cart whose shipping address yields country, postal code, state, city and colonia
- WHEN the quotation request is built
- THEN `address_to` includes `country_code`, `postal_code`, `area_level1` (normalized state name), `area_level2` and `area_level3`

#### Scenario: A missing colonia is not fabricated

- GIVEN a cart shipping address with no colonia from any source
- WHEN the quotation request is built
- THEN no `area_level3` value is invented
- AND the request is not issued at all (see the pre-flight requirement below)

---

### Requirement: A missing destination component fails fast, actionably, and leak-free

`S4` · `AUTO`
(Previously: "Missing destination address degrades to manual (no crash)" — the provider degraded, but
a missing colonia was tolerated and discovered only after a full quote round and an opaque carrier
422.)

If any required destination component is missing at `calculatePrice` — including the colonia on
**either** end of the shipment — the provider MUST fail **before any network call** with an
`INVALID_DATA` error naming the missing field, and MUST degrade checkout to `manual` rather than
crash it. It MUST NOT spend a carrier round-trip discovering a gap it can see locally, and it MUST NOT
surface the carrier's raw Spanish 422 body.

**The message MUST be actionable and leak-free at the same time.** Because this path is reachable
from the public `POST /store/shipping-options/:id/calculate` and Medusa passes messages through
verbatim, the message MUST be composed **only** from our own field catalogue and fix-hint maps. It
MUST NOT contain, in any form: an upstream response body or fragment of one, an upstream HTTP status,
an internal or third-party endpoint or host, a credential or identifier, or a stack. The full detail
MUST still reach the **server log**, as it does today.

The audience distinction MUST be preserved: the admin-audience message MAY carry detail; the
storefront-audience message MUST NOT.

#### Scenario: A missing destination colonia fails before any network call

- GIVEN a cart shipping address with country, postal code, state and city but no colonia
- WHEN `calculatePrice` runs
- THEN it raises `INVALID_DATA` before any carrier or token request is issued
- AND the message names the colonia as the missing field
- AND checkout degrades to `manual` without crashing

#### Scenario: A missing origin colonia fails before any network call

- GIVEN a stock-location origin with no colonia and no configured origin-colonia setting
- WHEN `calculatePrice` runs
- THEN it raises before any carrier request
- AND the message names the origin colonia and where to set it

#### Scenario: The storefront-facing message leaks nothing

- GIVEN any pre-flight failure on the storefront audience
- WHEN the message is inspected
- THEN it contains no upstream body, no upstream status code, no endpoint or host, and no credential
- AND the full detail is present in the server log

#### Scenario: The carrier 422 is never echoed to a public caller

- GIVEN the carrier returns `422 {"errors":{"address_to":{"area_level3":["no puede estar en blanco"]}}}`
- WHEN the error is translated for the storefront audience
- THEN the response message is the fixed non-secret storefront string
- AND the raw body appears only in the server log

#### Scenario: Missing required state or city still degrades gracefully

- GIVEN a cart shipping address missing `area_level1` or `area_level2`
- WHEN `calculatePrice` runs
- THEN the provider degrades to `manual` before any API call
- AND checkout does not crash

#### Scenario: Missing dimensions still degrades gracefully

- GIVEN a cart line item with no resolvable weight/dimensions
- WHEN `calculatePrice` runs
- THEN the provider degrades to `manual` via the existing seam fallback without crashing

---

## Verification summary

| Class | Requirements | How |
|---|---|---|
| `AUTO` | Derived budget + floor guard, failure semantics, origin-colonia fallback, destination pre-flight and its message, cache behaviour through a fake source | `pnpm --filter @dtc/backend test:unit` |
| `STATIC` | Provenance on the measurement constant, absence of bare budget literals, corrected docstrings | Code inspection |
| `MANUAL` | A real cold quote completing on first attempt (M0(a)); the platform holding the derived budget (M0(b)); cross-replica cache sharing (M0(c)) | Runtime probes and live-carrier QA |

**`sdd-verify` MUST NOT claim automated coverage of any `MANUAL` requirement.** In particular, no unit
test can prove the budget is large enough — only the M0(a) measurement can, and the floor guard is
what keeps that measurement binding afterwards.

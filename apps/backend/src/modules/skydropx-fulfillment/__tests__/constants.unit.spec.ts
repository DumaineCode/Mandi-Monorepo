/**
 * Budget composition invariants.
 *
 * The timeout constants are load-bearing and mutually dependent: the incident
 * that produced this file was a PER-REQUEST bound being used as the budget for a
 * whole multi-round async cycle. Individually each number looked reasonable; only
 * their composition was wrong, and nothing failed when it drifted.
 *
 * Every assertion here must be capable of FAILING on a plausible retune. An
 * assertion on a value derived from the same inputs it is compared against is an
 * algebraic identity, not a test — `worstCase <= gateway` would be exactly that,
 * so the ceiling is asserted against the UNMARGINED gateway and the margin is
 * what gives it teeth.
 */
import {
  ASSUMED_GATEWAY_TIMEOUT_MS,
  DEFAULT_GATEWAY_TIMEOUT_MS,
  GATEWAY_SAFETY_MARGIN,
  LABEL_POLL_INTERVAL_MS,
  LABEL_QUOTE_BUDGET_MS,
  MIN_VIABLE_GATEWAY_TIMEOUT_MS,
  PRE_ANCHOR_BUDGET_MS,
  readGatewayTimeout,
  SKYDROPX_FULFILLMENT_BUDGET_MS,
} from "../service"
import {
  DERIVED_QUOTE_CYCLE_BUDGET_MS,
  MIN_VIABLE_QUOTE_BUDGET_MS,
  QUOTE_POLL_INTERVAL_MS,
  readQuoteCycleBudget,
  SKYDROPX_CANCEL_TIMEOUT_MS,
  SKYDROPX_QUOTATION_REQUEST_TIMEOUT_MS,
  SKYDROPX_QUOTE_CYCLE_BUDGET_MS,
  SKYDROPX_REQUEST_TIMEOUT_MS,
} from "../client"

const worstCase = () =>
  PRE_ANCHOR_BUDGET_MS +
  SKYDROPX_FULFILLMENT_BUDGET_MS +
  SKYDROPX_CANCEL_TIMEOUT_MS // post-failure containment runs outside the anchor

describe("Skydropx budget composition", () => {
  /**
   * The one that matters: the client must get an answer before the edge gateway
   * gives up. A 504 mid-purchase means the label is bought and orphaned, because
   * SD-4 containment only runs in the process that observed the failure.
   *
   * Asserted with real slack, not just `<=`: nothing in the chain budgets for
   * TLS, DNS, JSON parsing, event-loop lag or workflow overhead.
   */
  it("keeps the whole request under the gateway with slack to spare", () => {
    expect(worstCase()).toBeLessThanOrEqual(
      ASSUMED_GATEWAY_TIMEOUT_MS * GATEWAY_SAFETY_MARGIN
    )
    expect(ASSUMED_GATEWAY_TIMEOUT_MS - worstCase()).toBeGreaterThanOrEqual(
      ASSUMED_GATEWAY_TIMEOUT_MS * 0.05
    )
  })

  /**
   * A negative or trivially small anchor makes every deadline land in the past,
   * so EVERY label purchase fails instantly with "0ms remained" — a total outage
   * of the fulfillment path from a single mistuned number.
   */
  it("derives an anchor that can actually fund a purchase", () => {
    expect(SKYDROPX_FULFILLMENT_BUDGET_MS).toBeGreaterThan(0)
    expect(SKYDROPX_FULFILLMENT_BUDGET_MS).toBeGreaterThan(
      SKYDROPX_REQUEST_TIMEOUT_MS
    )
  })

  it("leaves the label purchase a usable share of the anchor after quoting", () => {
    const afterQuote = SKYDROPX_FULFILLMENT_BUDGET_MS - LABEL_QUOTE_BUDGET_MS

    // Enough to buy the label and read at least one status poll, or the quote
    // slice has silently eaten the purchase it exists to enable.
    expect(afterQuote).toBeGreaterThanOrEqual(
      SKYDROPX_REQUEST_TIMEOUT_MS + LABEL_POLL_INTERVAL_MS
    )
  })

  it("gives the quote slice room for several poll rounds", () => {
    // The original bug in one assertion: a budget that affords fewer rounds than
    // a PRO quotation needs cannot ever complete, however healthy Skydropx is.
    const rounds = LABEL_QUOTE_BUDGET_MS / QUOTE_POLL_INTERVAL_MS

    expect(rounds).toBeGreaterThan(
      SKYDROPX_REQUEST_TIMEOUT_MS / QUOTE_POLL_INTERVAL_MS
    )
  })

  it("keeps every per-request bound inside the budget that contains it", () => {
    // CRITICAL-1: the per-request quotation bound is used on BOTH the checkout and
    // label paths inside `quoteAndPoll_`. On the label path it must stay contained
    // by the label budget so a single hung POST cannot eat every poll round.
    expect(SKYDROPX_QUOTATION_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(
      LABEL_QUOTE_BUDGET_MS
    )
    expect(SKYDROPX_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(
      SKYDROPX_FULFILLMENT_BUDGET_MS
    )
    expect(SKYDROPX_CANCEL_TIMEOUT_MS).toBeLessThanOrEqual(SKYDROPX_REQUEST_TIMEOUT_MS)
  })

  /**
   * CRITICAL-2: both quote budgets must clear the SHARED physical floor
   * (`MIN_VIABLE_QUOTE_BUDGET_MS` = slowest observed cold quote + one poll
   * interval). If `SKYDROPX_COLD_QUOTE_P95_MS` / `TAIL_ALLOWANCE_MS` are retuned
   * below the floor, or a `SKYDROPX_GATEWAY_TIMEOUT_MS` reduction starves the
   * label quote, one of these goes RED — a plausible retune this catches.
   */
  it("keeps both quote budgets above the shared cold-quote floor", () => {
    expect(SKYDROPX_QUOTE_CYCLE_BUDGET_MS).toBeGreaterThanOrEqual(
      MIN_VIABLE_QUOTE_BUDGET_MS
    )
    expect(LABEL_QUOTE_BUDGET_MS).toBeGreaterThanOrEqual(MIN_VIABLE_QUOTE_BUDGET_MS)
  })
})

/**
 * The checkout cycle deadline is a load-time constant with an operator override
 * (`SKYDROPX_QUOTE_BUDGET_MS`). Like `readGatewayTimeout` it must refuse to throw
 * at boot (the provider stays inert-safe) — but unlike a bare default it must also
 * CLAMP its own derived default to the floor, so the guard binds the production
 * path, not only the env-override path (CRITICAL-2).
 */
describe("readQuoteCycleBudget", () => {
  const silent = () => {}

  it("clamps the derived default to the floor when unset or blank", () => {
    // The production path: nothing in the repo sets SKYDROPX_QUOTE_BUDGET_MS, so
    // the unset branch is what actually runs. It must never fall below the floor.
    expect(readQuoteCycleBudget(undefined, silent)).toBe(
      DERIVED_QUOTE_CYCLE_BUDGET_MS
    )
    expect(readQuoteCycleBudget(undefined, silent)).toBeGreaterThanOrEqual(
      MIN_VIABLE_QUOTE_BUDGET_MS
    )
    expect(readQuoteCycleBudget("", silent)).toBe(DERIVED_QUOTE_CYCLE_BUDGET_MS)
    expect(readQuoteCycleBudget("   ", silent)).toBe(DERIVED_QUOTE_CYCLE_BUDGET_MS)
  })

  it("accepts an override at or above the floor unchanged", () => {
    expect(readQuoteCycleBudget("20000", silent)).toBe(20_000)
    expect(readQuoteCycleBudget(String(MIN_VIABLE_QUOTE_BUDGET_MS), silent)).toBe(
      MIN_VIABLE_QUOTE_BUDGET_MS
    )
  })

  it.each([
    [String(MIN_VIABLE_QUOTE_BUDGET_MS - 1), "just below the floor"],
    ["8000", "the pre-fix cycle literal, now below the floor"],
    ["abc", "a non-numeric value"],
    ["NaN", "NaN"],
  ])("warns on %s (%s) and falls back to the clamped default", (raw) => {
    const warn = jest.fn()

    expect(readQuoteCycleBudget(raw, warn)).toBe(DERIVED_QUOTE_CYCLE_BUDGET_MS)
    expect(readQuoteCycleBudget(raw, warn)).toBeGreaterThanOrEqual(
      MIN_VIABLE_QUOTE_BUDGET_MS
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(raw))
  })
})

/**
 * The override is the one input an operator can get wrong at 3am, and an
 * unvalidated one derives a NEGATIVE anchor — every deadline in the past, every
 * label purchase failing instantly. The unit typo (seconds instead of
 * milliseconds) is the realistic case and must be rejected, not obeyed.
 */
describe("readGatewayTimeout", () => {
  const silent = () => {}

  it("uses the default when unset or blank", () => {
    expect(readGatewayTimeout(undefined, silent)).toBe(DEFAULT_GATEWAY_TIMEOUT_MS)
    expect(readGatewayTimeout("", silent)).toBe(DEFAULT_GATEWAY_TIMEOUT_MS)
    expect(readGatewayTimeout("   ", silent)).toBe(DEFAULT_GATEWAY_TIMEOUT_MS)
  })

  it("accepts a plausible override", () => {
    expect(readGatewayTimeout("120000", silent)).toBe(120_000)
    expect(readGatewayTimeout(String(MIN_VIABLE_GATEWAY_TIMEOUT_MS), silent)).toBe(
      MIN_VIABLE_GATEWAY_TIMEOUT_MS
    )
  })

  it.each([
    ["60", "the seconds-instead-of-milliseconds typo"],
    ["-1", "a negative value"],
    ["0", "zero"],
    ["abc", "a non-numeric value"],
    ["NaN", "NaN"],
  ])("rejects %s (%s) and warns", (raw) => {
    const warn = jest.fn()

    expect(readGatewayTimeout(raw, warn)).toBe(DEFAULT_GATEWAY_TIMEOUT_MS)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(raw))
  })

  it("never derives a non-positive anchor from a value it accepts", () => {
    // Whatever passes validation must still leave room for the fixed costs the
    // anchor is derived against.
    const accepted = readGatewayTimeout(
      String(MIN_VIABLE_GATEWAY_TIMEOUT_MS),
      silent
    )
    const derived =
      Math.floor(accepted * GATEWAY_SAFETY_MARGIN) -
      PRE_ANCHOR_BUDGET_MS -
      SKYDROPX_CANCEL_TIMEOUT_MS

    expect(derived).toBeGreaterThan(SKYDROPX_REQUEST_TIMEOUT_MS)
  })
})

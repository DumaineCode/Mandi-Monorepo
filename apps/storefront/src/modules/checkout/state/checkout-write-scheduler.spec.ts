import type { HttpTypes } from "@medusajs/types"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  checkoutReducer,
  initFromServer,
  type CheckoutAction,
  type CheckoutState,
} from "./checkout-reducer"
import {
  CHECKOUT_WRITE_TIMEOUT_MS,
  createCheckoutWriteScheduler,
  type PersistDraft,
} from "./checkout-write-scheduler"
import { AUTOSAVE_DEBOUNCE_MS, QUOTE_DEBOUNCE_MS } from "@lib/util/shipping-quote"

/**
 * The scheduler is the answer to B1, and this file is the reason the answer is
 * verifiable rather than merely asserted.
 *
 * Before the extraction, the debounce composition and both `persistCheckoutDraft`
 * call sites lived in `checkout-context.tsx`. That file is a `.tsx`, the runner is
 * `environment: "node"` with `include: src/**\/*.spec.ts`, and there is no jsdom —
 * so it could not be loaded by a test at all, let alone driven through a race.
 * Every rule that ended up there was a rule nothing verified, which is precisely
 * what the provider's own docstring warned against and exactly how two concurrent
 * writers got in.
 *
 * The timing rule is pure: two trailing-edge debounces armed by the same
 * transition, and a serialiser in front of the writer. `vi.useFakeTimers()` drives
 * it deterministically in node, with no DOM anywhere.
 */

const CDMX = {
  first_name: "Ana",
  last_name: "Ruiz",
  company: "",
  address_1: "Av. Álvaro Obregón 100",
  address_2: "Roma Norte",
  postal_code: "06700",
  city: "Ciudad de México",
  province: "CDMX",
  country_code: "mx",
  phone: "5512345678",
}

const cartWith = (
  address: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {}
): HttpTypes.StoreCart =>
  ({
    id: "cart_01",
    email: "ana@example.com",
    items: [{ id: "li_01" }],
    shipping_methods: [],
    shipping_address: { id: "caaddr_01", ...CDMX, ...address },
    billing_address: null,
    region: { id: "reg_01", countries: [{ iso_2: "mx" }] },
    total: 1000,
    ...overrides,
  } as unknown as HttpTypes.StoreCart)

/**
 * A test harness that models the two things that actually matter about the real
 * provider: a reducer-backed state, and the fact that React may not have
 * re-rendered by the time a queued write starts.
 *
 * `applyDispatches: false` is the hostile case — `readState()` keeps returning
 * pre-write state, exactly as it does when two writes resolve inside the same
 * microtask queue. A scheduler that only works when React has caught up does not
 * close B1.
 */
const harness = (
  options: {
    cart?: HttpTypes.StoreCart
    applyDispatches?: boolean
  } = {}
) => {
  const applyDispatches = options.applyDispatches ?? true

  let state: CheckoutState = initFromServer({
    cart: options.cart ?? cartWith(),
    customer: null,
    shippingOptions: [],
  })

  const actions: CheckoutAction[] = []
  const dispatch = (action: CheckoutAction) => {
    actions.push(action)
    if (applyDispatches) {
      state = checkoutReducer(state, action)
    }
  }

  let sequence = 0

  /** Every payload the writer actually sent, in order. */
  const sent: Array<{
    patch: Record<string, unknown>
    email: string | null
  }> = []

  /** Resolvers for in-flight writes, so a race can be held open deliberately. */
  const pending: Array<(cart: HttpTypes.StoreCart) => void> = []
  let concurrent = 0
  let maxConcurrent = 0

  const persist: PersistDraft = (patch, email) => {
    concurrent += 1
    maxConcurrent = Math.max(maxConcurrent, concurrent)
    sent.push({ patch: patch as Record<string, unknown>, email })

    return new Promise((resolve) => {
      pending.push((cart) => {
        concurrent -= 1
        resolve({ ok: true, cart })
      })
    })
  }

  const scheduler = createCheckoutWriteScheduler({
    readState: () => state,
    persist,
    nextSequence: () => {
      sequence += 1
      return sequence
    },
    dispatch,
  })

  return {
    scheduler,
    actions,
    sent,
    get maxConcurrent() {
      return maxConcurrent
    },
    get openWrites() {
      return pending.length
    },
    /** Resolves the oldest open write with the cart the server would return. */
    settleNext: async (cart: HttpTypes.StoreCart) => {
      const resolve = pending.shift()
      if (!resolve) {
        throw new Error("no write in flight")
      }
      resolve(cart)
      await vi.advanceTimersByTimeAsync(0)
    },
    dispatchToState: (action: CheckoutAction) => {
      state = checkoutReducer(state, action)
    },
    readState: () => state,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("the debounce composition (W5)", () => {
  it("arms the autosave and the requote from the SAME transition, 200ms apart", () => {
    // This is the composition that made B1 reachable, stated as a fact rather
    // than as a comment: one dispatch arms both timers, and they fire in order.
    expect(AUTOSAVE_DEBOUNCE_MS).toBeLessThan(QUOTE_DEBOUNCE_MS)
    expect(QUOTE_DEBOUNCE_MS - AUTOSAVE_DEBOUNCE_MS).toBe(200)
  })

  it("does not write before the autosave debounce elapses", async () => {
    const h = harness()
    h.dispatchToState({
      type: "FIELD_BLUR",
      field: "address_1",
      value: "Otra calle 9",
    })

    h.scheduler.scheduleAutosave(AUTOSAVE_DEBOUNCE_MS)

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1)
    expect(h.sent).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(h.sent).toHaveLength(1)
  })

  it("keeps only the LAST arming, so typing does not queue a write per keystroke", async () => {
    const h = harness()
    h.dispatchToState({
      type: "FIELD_BLUR",
      field: "address_1",
      value: "Otra calle 9",
    })

    h.scheduler.scheduleAutosave(AUTOSAVE_DEBOUNCE_MS)
    await vi.advanceTimersByTimeAsync(300)
    h.scheduler.scheduleAutosave(AUTOSAVE_DEBOUNCE_MS)
    await vi.advanceTimersByTimeAsync(300)
    expect(h.sent).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(100)
    expect(h.sent).toHaveLength(1)
  })

  it("cancels a pending autosave outright", async () => {
    const h = harness()
    h.dispatchToState({
      type: "FIELD_BLUR",
      field: "address_1",
      value: "Otra calle 9",
    })

    h.scheduler.scheduleAutosave(AUTOSAVE_DEBOUNCE_MS)
    h.scheduler.cancelAutosave()

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 5)
    expect(h.sent).toHaveLength(0)
  })
})

describe("at most one write in flight (B1)", () => {
  it("never runs two writes concurrently, even when both are requested at once", async () => {
    const h = harness()
    h.dispatchToState({
      type: "FIELD_BLUR",
      field: "address_1",
      value: "Otra calle 9",
    })

    void h.scheduler.persistNow()
    void h.scheduler.persistNow()
    await vi.advanceTimersByTimeAsync(0)

    expect(h.maxConcurrent).toBe(1)
    expect(h.openWrites).toBe(1)
  })

  it("reports itself busy while a write is open, and idle once it settles", async () => {
    const h = harness()
    h.dispatchToState({
      type: "FIELD_BLUR",
      field: "address_1",
      value: "Otra calle 9",
    })

    const write = h.scheduler.persistNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.scheduler.isBusy()).toBe(true)

    await h.settleNext(cartWith({ address_1: "Otra calle 9" }))
    await write
    expect(h.scheduler.isBusy()).toBe(false)
  })

  /**
   * B1 failure mode 1, reproduced end to end.
   *
   * The autosave fires at 400ms and its write is still open at 600ms when the
   * requote path needs the address persisted. Before the fix both paths called
   * `persistCheckoutDraft` directly, `state.cart` was unchanged because the first
   * write had not returned, `selectUnsavedDraftPatch` still reported the same
   * fields as unsaved, and a SECOND concurrent write went out with an identical
   * payload — two fresh reads, both resolving `absent`, both taking `em.create`.
   */
  it("does not issue a second, identical write while the first is still open", async () => {
    const h = harness()
    h.dispatchToState({
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44100",
    })

    h.scheduler.scheduleAutosave(AUTOSAVE_DEBOUNCE_MS)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS)
    expect(h.sent).toHaveLength(1)
    expect(h.openWrites).toBe(1)

    // 600ms: the requote path needs the address on the cart before listing.
    const requoteWrite = h.scheduler.persistNow()
    await vi.advanceTimersByTimeAsync(QUOTE_DEBOUNCE_MS - AUTOSAVE_DEBOUNCE_MS)

    // Still exactly one write in flight — the second is queued, not concurrent.
    expect(h.maxConcurrent).toBe(1)
    expect(h.sent).toHaveLength(1)

    await h.settleNext(cartWith({ postal_code: "44100" }))
    await requoteWrite

    // And once the first landed, the second found nothing left to write.
    expect(h.sent).toHaveLength(1)
    expect(await requoteWrite).toEqual({ status: "noop" })
  })

  /**
   * B1 failure mode 2 — the data-loss one, and the reason this is a blocker
   * rather than a duplicate-request annoyance.
   *
   * Write A carries `{postal_code}`. `CP_LOOKUP_FOUND` re-arms with
   * `{postal_code, province, city}`. Unserialised, A landed AFTER B and
   * `em.create`d a row holding only `postal_code`, repointing the FK — province
   * and city were gone from the database while the client still showed them,
   * because A's `CART_UPDATED` was dropped by the sequence guard.
   *
   * Serialised, B is derived AFTER A resolved and against what A actually
   * persisted, so nothing that reached the database is ever un-sent.
   */
  it("derives a queued write against what the previous write actually persisted", async () => {
    const h = harness({ applyDispatches: false })
    h.dispatchToState({
      type: "FIELD_BLUR",
      field: "postal_code",
      value: "44100",
    })

    const first = h.scheduler.persistNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.sent[0].patch).toEqual({ postal_code: "44100" })

    // SEPOMEX lands while the write is open and widens the draft.
    h.dispatchToState({
      type: "CP_LOOKUP_FOUND",
      postalCode: "44100",
      province: "Jalisco",
      city: "Guadalajara",
      colonias: [],
    })

    const second = h.scheduler.persistNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.sent).toHaveLength(1)

    await h.settleNext(cartWith({ postal_code: "44100" }))
    await first
    await vi.advanceTimersByTimeAsync(0)

    expect(h.sent).toHaveLength(2)
    // Only the genuinely new fields. `postal_code` is NOT re-sent, so there is no
    // second id-less create for the same address.
    expect(h.sent[1].patch).toEqual({
      province: "Jalisco",
      city: "Guadalajara",
    })

    await h.settleNext(
      cartWith({
        postal_code: "44100",
        province: "Jalisco",
        city: "Guadalajara",
      })
    )
    expect(await second).toEqual({ status: "written", cart: expect.anything() })
    // And the two writes never overlapped.
    expect(h.maxConcurrent).toBe(1)
  })

  it("runs queued writes in the order they were requested", async () => {
    const h = harness({ applyDispatches: false })

    h.dispatchToState({ type: "FIELD_BLUR", field: "city", value: "Guadalajara" })
    const first = h.scheduler.persistNow()
    await vi.advanceTimersByTimeAsync(0)

    h.dispatchToState({ type: "FIELD_BLUR", field: "company", value: "Mandi" })
    const second = h.scheduler.persistNow()

    await h.settleNext(cartWith({ city: "Guadalajara" }))
    await first
    await vi.advanceTimersByTimeAsync(0)
    await h.settleNext(cartWith({ city: "Guadalajara", company: "Mandi" }))
    await second

    expect(h.sent[0].patch).toEqual({ city: "Guadalajara" })
    expect(h.sent[1].patch).toEqual({ company: "Mandi" })
  })
})

describe("what the scheduler tells the reducer", () => {
  it("issues strictly increasing sequences, one per actual write", async () => {
    const h = harness({ applyDispatches: false })

    h.dispatchToState({ type: "FIELD_BLUR", field: "city", value: "Guadalajara" })
    const first = h.scheduler.persistNow()
    await vi.advanceTimersByTimeAsync(0)
    h.dispatchToState({ type: "FIELD_BLUR", field: "company", value: "Mandi" })
    const second = h.scheduler.persistNow()

    await h.settleNext(cartWith({ city: "Guadalajara" }))
    await first
    await vi.advanceTimersByTimeAsync(0)
    await h.settleNext(cartWith({ city: "Guadalajara", company: "Mandi" }))
    await second

    const started = h.actions.filter((a) => a.type === "CART_WRITE_STARTED")
    expect(started.map((a) => (a as { sequence: number }).sequence)).toEqual([
      1, 2,
    ])
  })

  it("announces the write BEFORE performing it, so the status line can say Guardando", async () => {
    const h = harness()
    h.dispatchToState({
      type: "FIELD_BLUR",
      field: "address_1",
      value: "Otra calle 9",
    })

    void h.scheduler.persistNow()
    await vi.advanceTimersByTimeAsync(0)

    expect(h.actions[0].type).toBe("CART_WRITE_STARTED")
    expect(h.readState().autosaveStatus).toBe("saving")
  })

  it("reports a failure to the reducer and stays usable afterwards", async () => {
    let outcome: { ok: true; cart: HttpTypes.StoreCart } | { ok: false } = {
      ok: false,
    }
    const actions: CheckoutAction[] = []
    let state = initFromServer({
      cart: cartWith(),
      customer: null,
      shippingOptions: [],
    })
    let sequence = 0

    const scheduler = createCheckoutWriteScheduler({
      readState: () => state,
      persist: async () => outcome,
      nextSequence: () => (sequence += 1),
      dispatch: (action) => {
        actions.push(action)
        state = checkoutReducer(state, action)
      },
    })

    state = checkoutReducer(state, {
      type: "FIELD_BLUR",
      field: "address_1",
      value: "Otra calle 9",
    })

    expect(await scheduler.persistNow()).toEqual({ status: "failed" })
    expect(actions.at(-1)?.type).toBe("CART_WRITE_FAILED")
    expect(state.autosaveStatus).toBe("error")

    outcome = { ok: true, cart: cartWith({ address_1: "Otra calle 9" }) }
    const retry = await scheduler.persistNow()
    expect(retry.status).toBe("written")
    expect(state.autosaveStatus).toBe("saved")
  })

  it("treats a rejected write as a failure rather than letting it escape", async () => {
    const actions: CheckoutAction[] = []
    let state = initFromServer({
      cart: cartWith(),
      customer: null,
      shippingOptions: [],
    })
    let sequence = 0

    const scheduler = createCheckoutWriteScheduler({
      readState: () => state,
      persist: async () => {
        throw new Error("network down")
      },
      nextSequence: () => (sequence += 1),
      dispatch: (action) => {
        actions.push(action)
        state = checkoutReducer(state, action)
      },
    })

    state = checkoutReducer(state, {
      type: "FIELD_BLUR",
      field: "address_1",
      value: "Otra calle 9",
    })

    expect(await scheduler.persistNow()).toEqual({ status: "failed" })
    expect(state.autosaveStatus).toBe("error")
    // The queue is not poisoned by the rejection.
    expect(scheduler.isBusy()).toBe(false)
  })
})

/**
 * ## The failure mode none of the sixteen tests above could see
 *
 * Every one of them settles. `performWrite` did a bare `await deps.persist(...)`
 * with no timeout and no `AbortSignal`, and the FIFO tail is `tail =
 * run.catch(...)` — so a server action that NEVER settles is not a slow write, it
 * is a permanently stalled scheduler:
 *
 * - `tail` never resolves, so every later `persistNow()` queues forever;
 * - `isBusy()` answers `true` forever;
 * - and the requote effect's `await scheduler.persistNow()` never returns, so the
 *   `inFlightSignature` claimed by `QUOTE_STARTED` one line earlier is never
 *   released — the same permanent "quoting" deadlock as the leaked in-flight slot,
 *   arrived at from a second direction.
 *
 * A dropped connection or a mobile tab put to sleep mid-write reaches this. The
 * platform's own socket timeout is the only other bound, and it is neither
 * guaranteed nor short.
 *
 * Driven under `vi.useFakeTimers()` with a `persist` that simply never resolves,
 * which is exactly what the harness's `pending` queue already models.
 */
describe("a write that never settles", () => {
  /**
   * Stated as a literal rather than imported, deliberately: asserting the module's
   * constant against itself passes for every value. The magnitude is pinned
   * against independent facts in the last test of this block.
   */
  const BUDGET_MS = 15_000

  const hungHarness = () => {
    const h = harness()
    h.dispatchToState({
      type: "FIELD_BLUR",
      field: "address_1",
      value: "Otra calle 9",
    })
    return h
  }

  it("gives up rather than hanging forever", async () => {
    const h = hungHarness()

    let settled: unknown = "pending"
    void h.scheduler.persistNow().then((outcome) => {
      settled = outcome
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(h.sent).toHaveLength(1)
    expect(settled).toBe("pending")

    await vi.advanceTimersByTimeAsync(BUDGET_MS)

    expect(settled).toEqual({ status: "failed" })
  })

  it("tells the customer, through the same status line every other failure uses", async () => {
    const h = hungHarness()

    void h.scheduler.persistNow()
    await vi.advanceTimersByTimeAsync(BUDGET_MS)

    expect(h.actions.map((a) => a.type)).toEqual([
      "CART_WRITE_STARTED",
      "CART_WRITE_FAILED",
    ])
  })

  it("releases the chain, so a later write is not stranded behind it", async () => {
    const h = hungHarness()

    void h.scheduler.persistNow()
    await vi.advanceTimersByTimeAsync(BUDGET_MS)

    // The customer edits again and blurs. This must reach the server.
    void h.scheduler.persistNow()
    await vi.advanceTimersByTimeAsync(0)

    expect(h.sent).toHaveLength(2)
  })

  /**
   * `isBusy()` is what the provider reads to decide whether a write is open. Left
   * `true` forever it is not merely wrong, it is a lie that every later decision
   * is taken against.
   */
  it("stops reporting itself busy", async () => {
    const h = hungHarness()

    void h.scheduler.persistNow()
    expect(h.scheduler.isBusy()).toBe(true)

    await vi.advanceTimersByTimeAsync(BUDGET_MS)

    expect(h.scheduler.isBusy()).toBe(false)
  })

  /**
   * The requote path, which is the one that deadlocks the checkout outright:
   * `QUOTE_STARTED` claims the in-flight slot, then the effect awaits
   * `persistNow()`. If that never returns, `QUOTE_FAILED` is never dispatched and
   * the slot is never released. A resolved failure is what lets the effect reach
   * its own error path at all.
   */
  it("resolves to a failure the requote path can act on", async () => {
    const h = hungHarness()

    let outcome: unknown = "pending"
    void h.scheduler.persistNow().then((o) => {
      outcome = o
    })
    await vi.advanceTimersByTimeAsync(BUDGET_MS)

    // Not a rejection: the caller `await`s this without a try/catch of its own for
    // the persist step, and a throw here would skip the QUOTE_FAILED dispatch.
    expect(outcome).toEqual({ status: "failed" })
  })

  /**
   * A PROPERTY, not `X === X`. The exported constant is compared against facts
   * declared elsewhere in the codebase and restated here as literals, so this test
   * fails if the number is retuned into a range that breaks the relationship —
   * which asserting it against its own import never would.
   */
  it("stays above the read budget already inside the write it wraps", () => {
    // `persistCheckoutDraft` runs `retrieveCartFresh` SEQUENTIALLY in front of the
    // PATCH, and that read carries its own 5 s `AbortSignal.timeout`
    // (`CART_READ_TIMEOUT_MS`, `lib/data/cart.ts`). A scheduler bound at or below
    // that would pre-empt the inner timeout — the half with the diagnosable
    // failure path — and turn every slow read into an undiagnosable one.
    expect(CHECKOUT_WRITE_TIMEOUT_MS).toBeGreaterThan(5_000)

    // …and it stays a stall breaker rather than a UX budget. A customer waiting
    // this long has already been told the save is in progress by the status line.
    expect(CHECKOUT_WRITE_TIMEOUT_MS).toBeLessThanOrEqual(30_000)

    // The block above drives the timers off an independently stated literal; if
    // the constant moves outside it, these tests stop exercising the deadline.
    expect(BUDGET_MS).toBeGreaterThanOrEqual(CHECKOUT_WRITE_TIMEOUT_MS)
  })

  it("does not fire for a write that answers within the budget", async () => {
    const h = hungHarness()

    let settled: unknown = "pending"
    void h.scheduler.persistNow().then((o) => {
      settled = o
    })

    await vi.advanceTimersByTimeAsync(BUDGET_MS - 1)
    await h.settleNext(cartWith({ address_1: "Otra calle 9" }))

    expect(settled).toMatchObject({ status: "written" })
    expect(h.actions.map((a) => a.type)).toEqual([
      "CART_WRITE_STARTED",
      "CART_UPDATED",
    ])
  })
})

describe("the no-op guard (F2)", () => {
  /**
   * Per finding F2 every `updateCart` re-runs `refreshCartShippingMethodsWorkflow`
   * once the cart has a shipping method, and that is a live Skydropx quote. A write
   * with nothing to say is not a wasted round trip, it is a wasted carrier call.
   */
  it("performs no write at all when the draft already matches the cart", async () => {
    const h = harness()

    expect(await h.scheduler.persistNow()).toEqual({ status: "noop" })
    expect(h.sent).toHaveLength(0)
    expect(h.actions).toHaveLength(0)
  })

  it("does not announce a write it is not going to perform", async () => {
    const h = harness()

    h.scheduler.scheduleAutosave(AUTOSAVE_DEBOUNCE_MS)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS)

    expect(h.actions.some((a) => a.type === "CART_WRITE_STARTED")).toBe(false)
  })

  it("still writes an email the cart does not have, with no address patch", async () => {
    const h = harness()
    h.dispatchToState({
      type: "FIELD_BLUR",
      field: "email",
      value: "nuevo@example.com",
    })

    void h.scheduler.persistNow()
    await vi.advanceTimersByTimeAsync(0)

    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].patch).toEqual({})
    expect(h.sent[0].email).toBe("nuevo@example.com")
  })
})

/**
 * ---------------------------------------------------------------------------
 * `runExclusive` — the CTA write joins the same chain (PR2c, task 2c.7)
 * ---------------------------------------------------------------------------
 *
 * PR2b left this as an explicit handoff: *"PR2c's `syncCheckoutAddresses` DOES
 * write the address and MUST go through the scheduler."*
 *
 * The reason is B1 restated at the CTA. `syncCheckoutAddresses` writes
 * `shipping_address`, which is the entity the whole `em.create` PII-destruction
 * finding is about, and it runs at a moment when an autosave debounce armed by
 * the customer's last blur is very likely still pending — 400 ms is roughly the
 * gap between tabbing out of the final field and clicking the button. Two
 * concurrent partial writers against one nested entity is the exact shape PR1a
 * closed and PR2a reopened.
 *
 * `persistNow` cannot be reused for it: the payload is different (both
 * addresses, in full) and it is not derived from the unsaved-draft diff. So the
 * scheduler gains one method whose only job is to put a FOREIGN write on the
 * same FIFO chain, under the same sequence counter.
 */
describe("runExclusive (PR2c)", () => {
  it("cancels a pending autosave so it cannot fire mid-order", async () => {
    const h = harness()
    h.dispatchToState({
      type: "FIELD_BLUR",
      field: "address_1",
      value: "Otra calle 9",
    })

    h.scheduler.scheduleAutosave(AUTOSAVE_DEBOUNCE_MS)

    // The CTA is clicked 100ms after the last blur — well inside the debounce.
    await vi.advanceTimersByTimeAsync(100)

    const run = h.scheduler.runExclusive(async () => ({
      ok: true as const,
      cart: cartWith({}, { total: 1500 }),
    }))

    await vi.advanceTimersByTimeAsync(1000)
    await run

    // The autosave must never have gone out. If it had, its response would race
    // the CTA write against the same cart_address row.
    expect(h.sent).toHaveLength(0)
  })

  it("waits for an in-flight autosave instead of racing it", async () => {
    const h = harness()
    h.dispatchToState({
      type: "FIELD_BLUR",
      field: "address_1",
      value: "Otra calle 9",
    })

    h.scheduler.scheduleAutosave(AUTOSAVE_DEBOUNCE_MS)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS)

    // The autosave is now OPEN and unresolved.
    expect(h.openWrites).toBe(1)

    let exclusiveStarted = false
    const run = h.scheduler.runExclusive(async () => {
      exclusiveStarted = true
      return { ok: true as const, cart: cartWith({}, { total: 1500 }) }
    })

    await vi.advanceTimersByTimeAsync(0)

    // THE ASSERTION. The CTA write has not begun while the autosave is open.
    expect(exclusiveStarted).toBe(false)

    await h.settleNext(cartWith({}, { total: 1000 }))
    await run

    expect(exclusiveStarted).toBe(true)
  })

  it("draws its sequence from the same counter as the autosave", async () => {
    const h = harness()
    h.dispatchToState({
      type: "FIELD_BLUR",
      field: "address_1",
      value: "Otra calle 9",
    })

    h.scheduler.scheduleAutosave(AUTOSAVE_DEBOUNCE_MS)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS)
    await h.settleNext(cartWith({}, { total: 1000 }))

    let seen: number | null = null
    await h.scheduler.runExclusive(async (sequence) => {
      seen = sequence
      return { ok: true as const, cart: cartWith({}, { total: 1500 }) }
    })

    // A shared counter is what lets the reducer drop a response that a newer
    // write has already superseded. A private counter would let the two writers
    // issue the same number and the ordering guarantee would silently stop
    // meaning anything.
    expect(seen).toBe(2)
  })

  it("dispatches CART_UPDATED with the cart the write returned", async () => {
    const h = harness()

    await h.scheduler.runExclusive(async () => ({
      ok: true as const,
      cart: cartWith({}, { total: 1500 }),
    }))

    const updated = h.actions.filter((action) => action.type === "CART_UPDATED")
    expect(updated).toHaveLength(1)
    expect(h.readState().cart?.total).toBe(1500)
  })

  it("reports a failed write without poisoning the chain", async () => {
    const h = harness()

    const outcome = await h.scheduler.runExclusive(async () => ({
      ok: false as const,
    }))

    expect(outcome.status).toBe("failed")
    expect(
      h.actions.some((action) => action.type === "CART_WRITE_FAILED")
    ).toBe(true)

    // The customer must be able to fix whatever went wrong and click again.
    const retry = await h.scheduler.runExclusive(async () => ({
      ok: true as const,
      cart: cartWith({}, { total: 1500 }),
    }))

    expect(retry.status).toBe("written")
  })

  it("survives a write that REJECTS rather than returning a failure", async () => {
    const h = harness()

    const outcome = await h.scheduler.runExclusive(async () => {
      throw new Error("boom")
    })

    expect(outcome.status).toBe("failed")

    const retry = await h.scheduler.runExclusive(async () => ({
      ok: true as const,
      cart: cartWith({}, { total: 1500 }),
    }))

    expect(retry.status).toBe("written")
  })

  /**
   * -------------------------------------------------------------------------
   * A CTA write that never settles
   * -------------------------------------------------------------------------
   *
   * `performWrite` races its await against `CHECKOUT_WRITE_TIMEOUT_MS`;
   * `performExclusiveWrite` did a bare `await write(sequence)`. This module's
   * own docstring states the rule that breaks: *"a single write that never
   * settles is not a slow save, it is a permanently stalled checkout."*
   *
   * The exclusive write is the MORE exposed of the two. `syncCheckoutAddresses`
   * bounds only its fresh READ (`CART_READ_TIMEOUT_MS`, 5 s); the
   * `sdk.store.cart.update` behind it is deliberately unbounded, because the
   * typed SDK method takes no request init.
   *
   * The customer: on flaky LTE, taps *Realizar pedido*, the PATCH socket hangs.
   * `place()`'s `finally` never runs, so `running` stays `true` and every later
   * click returns `busy` SILENTLY with no message. `placingOrder` stays `true`
   * and the button spins forever. `tail` never resolves, so every subsequent
   * autosave queues forever and the requote effect deadlocks. The card was
   * already tokenized, so the single-use token is burned with no way to spend
   * it.
   */
  describe("a CTA write that never settles", () => {
    /** Stated as a literal for the same reason the `persistNow` block does. */
    const BUDGET_MS = 15_000

    /** A write that is issued and then never answers. */
    const hang = () => new Promise<never>(() => {})

    it("gives up rather than hanging forever", async () => {
      const h = harness()

      let settled: unknown = "pending"
      void h.scheduler.runExclusive(hang).then((outcome) => {
        settled = outcome
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe("pending")

      await vi.advanceTimersByTimeAsync(BUDGET_MS)

      expect(settled).toEqual({ status: "failed" })
    })

    it("tells the customer, through the same status line every other failure uses", async () => {
      const h = harness()

      void h.scheduler.runExclusive(hang)
      await vi.advanceTimersByTimeAsync(BUDGET_MS)

      expect(h.actions.map((a) => a.type)).toEqual([
        "CART_WRITE_STARTED",
        "CART_WRITE_FAILED",
      ])
    })

    /**
     * The one the customer feels. A resolved failure is what lets
     * `placeOrderFlow` reach `settleFailed` — which releases its re-entrancy
     * flag, clears `placingOrder` and shows the reason. Without it the button
     * spins forever on a card that has already been tokenized.
     */
    it("resolves to a failure the place-order flow can act on", async () => {
      const h = harness()

      let outcome: unknown = "pending"
      void h.scheduler.runExclusive(hang).then((o) => {
        outcome = o
      })
      await vi.advanceTimersByTimeAsync(BUDGET_MS)

      // Not a rejection: `placeOrderFlow` awaits this and branches on
      // `status`, and a throw would skip the settle.
      expect(outcome).toEqual({ status: "failed" })
    })

    it("releases the chain, so a later write is not stranded behind it", async () => {
      const h = harness()

      void h.scheduler.runExclusive(hang)
      await vi.advanceTimersByTimeAsync(BUDGET_MS)

      // The customer fixes something and clicks again. This must reach the
      // server.
      const retry = await h.scheduler.runExclusive(async () => ({
        ok: true as const,
        cart: cartWith({}, { total: 1500 }),
      }))

      expect(retry.status).toBe("written")
    })

    it("does not strand a queued autosave behind it either", async () => {
      const h = harness()
      h.dispatchToState({
        type: "FIELD_BLUR",
        field: "address_1",
        value: "Otra calle 9",
      })

      void h.scheduler.runExclusive(hang)
      void h.scheduler.persistNow()

      await vi.advanceTimersByTimeAsync(BUDGET_MS)

      expect(h.sent).toHaveLength(1)
    })

    it("stops reporting itself busy", async () => {
      const h = harness()

      void h.scheduler.runExclusive(hang)
      expect(h.scheduler.isBusy()).toBe(true)

      await vi.advanceTimersByTimeAsync(BUDGET_MS)

      expect(h.scheduler.isBusy()).toBe(false)
    })

    it("does not fire for a write that answers within the budget", async () => {
      const h = harness()

      let resolveWrite:
        | ((value: { ok: true; cart: HttpTypes.StoreCart }) => void)
        | undefined

      let settled: unknown = "pending"
      void h.scheduler
        .runExclusive(
          () =>
            new Promise<{ ok: true; cart: HttpTypes.StoreCart }>((resolve) => {
              resolveWrite = resolve
            })
        )
        .then((o) => {
          settled = o
        })

      await vi.advanceTimersByTimeAsync(BUDGET_MS - 1)
      resolveWrite?.({ ok: true, cart: cartWith({}, { total: 1500 }) })
      await vi.advanceTimersByTimeAsync(0)

      expect(settled).toMatchObject({ status: "written" })
      expect(h.actions.map((a) => a.type)).toEqual([
        "CART_WRITE_STARTED",
        "CART_UPDATED",
      ])
    })

    /**
     * Both writers share one deadline on purpose. Two numbers here would be two
     * answers to "how long is too long for a cart write", and the CTA — the one
     * request per checkout the customer cannot casually retry — would be the
     * one left holding the looser of them.
     */
    it("uses the same budget as the autosave", () => {
      expect(CHECKOUT_WRITE_TIMEOUT_MS).toBeGreaterThan(5_000)
      expect(BUDGET_MS).toBeGreaterThanOrEqual(CHECKOUT_WRITE_TIMEOUT_MS)
    })
  })

  /**
   * The total-change guard sends the customer back to confirm once more, and
   * their next blur re-arms the autosave. That autosave must diff against the
   * cart the CTA write produced — not the one before it — or it re-sends fields
   * the CTA already persisted and, worse, patches against a stale address row.
   */
  it("leaves its cart as the base the next autosave diffs against", async () => {
    const h = harness({ applyDispatches: false })

    await h.scheduler.runExclusive(async () => ({
      ok: true as const,
      cart: cartWith({ address_1: "Calle nueva 1" }, { total: 1500 }),
    }))

    h.dispatchToState({
      type: "FIELD_BLUR",
      field: "address_1",
      value: "Calle nueva 1",
    })

    h.scheduler.scheduleAutosave(AUTOSAVE_DEBOUNCE_MS)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS)

    // Nothing is unsaved relative to the CTA's cart, so no request goes out.
    // Per F2 every one of those is a live Skydropx quote, so this is not merely
    // tidy.
    expect(h.sent).toHaveLength(0)
  })
})

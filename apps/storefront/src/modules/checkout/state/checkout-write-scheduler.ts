import type { CheckoutDraftAddress } from "@lib/util/cart-address-payload"
import type { HttpTypes } from "@medusajs/types"

import {
  selectUnsavedDraftPatchAgainst,
  selectUnsavedEmailAgainst,
  selectWriteBaseCart,
  type CheckoutAction,
  type CheckoutState,
  type PendingWrite,
} from "./checkout-reducer"

/**
 * The checkout's ONE cart writer, and the debounce that arms it.
 *
 * ## The bug this exists to close (B1)
 *
 * `checkout-context.tsx` had TWO call sites for `persistCheckoutDraft`: the
 * autosave effect and the requote effect. They did not merely happen to overlap —
 * they raced BY CONSTRUCTION, because a single dispatch armed both. `FIELD_BLUR`
 * and `CP_LOOKUP_FOUND` bump `blurSequence` (arming the 400 ms autosave) AND move
 * `quoteSignature` (arming the 600 ms requote) in one transition, so the second
 * timer fired 200 ms into the first write's round trip — a round trip whose
 * server-side `retrieveCartFresh` alone carries a 5 s budget in front of the
 * PATCH.
 *
 * Two reachable failure modes, both of which this module removes:
 *
 * 1. **Same payload, new cart.** At 600 ms the cart had not changed yet, so the
 *    unsaved-patch selector still reported the same fields, so a second
 *    concurrent write went out. Both writes did a fresh read, both resolved the
 *    address as `absent`, and both took the id-less `em.create` path — `design.md`
 *    §14 item 1b, on the first checkout of every new customer.
 * 2. **Divergent payloads, data loss.** Write A carrying `{postal_code}` in
 *    flight; `CP_LOOKUP_FOUND` re-arms; write B commits `{postal_code, province,
 *    city}`; A lands later and `em.create`s a row with `postal_code` only,
 *    repointing the FK. `province` and `city` were gone from the database while
 *    the client still displayed them, because A's `CART_UPDATED` was correctly
 *    dropped by the sequence guard.
 *
 * ## Why sequencing could not reach it
 *
 * `issuedWriteSequence` orders RESPONSES — it decides which reply is allowed to
 * touch state. The TOCTOU above is on the REQUEST side, at the server's fresh
 * read, and both requests were already in the air before either reply existed.
 * Ordering replies cannot un-send a request. Nor could `clearTimeout`: it cancels
 * a timer that has not fired, and by 600 ms the autosave timer had already fired.
 *
 * So the fix is a serialiser: at most one write is ever in flight, and a write
 * that arrives while one is running WAITS and then re-derives its own patch
 * against the cart the previous write actually persisted. Failure mode 1 collapses
 * to a no-op because there is nothing left unsaved; failure mode 2 sends only the
 * genuinely new fields, so nothing that reached the database is ever un-sent.
 *
 * ## Why it is a module and not a `useRef` in the provider
 *
 * Because the provider is a `.tsx` and this repo's runner is node-only with no
 * jsdom — a rule left there is a rule nothing can test, which is how two writers
 * got in behind a docstring claiming there was one. Here the whole race is
 * driven deterministically under `vi.useFakeTimers()`.
 *
 * Holds no rules of its own: what counts as unsaved, and which cart to compare
 * against, are pure exports of `checkout-reducer.ts`. This file only sequences.
 *
 * @see `checkout-write-scheduler.spec.ts` — both failure modes, reproduced.
 */

/**
 * Last-resort bound on ONE cart write, in milliseconds.
 *
 * ## Why the scheduler needs its own bound at all
 *
 * `persistCheckoutDraft` is a `"use server"` action, and server actions cannot be
 * cancelled from the client — the whole module is built around that fact. What
 * this bounds is not the request but the AWAIT: how long this scheduler is willing
 * to hold its FIFO chain open for a reply that may never come.
 *
 * Without it a single write that never settles is not a slow save, it is a
 * permanently stalled checkout. `tail` never resolves, so every later
 * `persistNow()` queues forever and `isBusy()` answers `true` forever; and the
 * requote effect awaits `persistNow()` one line after `QUOTE_STARTED` has claimed
 * `inFlightSignature`, so the slot is never released and `selectQuoteStatus`
 * reports `"quoting"` until the page is reloaded. A dropped connection or a mobile
 * tab suspended mid-write reaches this, and the platform socket timeout is the
 * only other bound — neither guaranteed nor short.
 *
 * ## The number, and why it is bigger than every other timeout in this codebase
 *
 * The existing budgets are all on single READS: `CART_READ_TIMEOUT_MS` 5 s and
 * `CART_OPTIONS_TIMEOUT_MS` 5 s (`lib/data/cart.ts`), `SHIPPING_OPTIONS_TIMEOUT_MS`
 * 5 s + 2 s retry (`lib/data/fulfillment.ts`), `POSTAL_CODE_TIMEOUT_MS` and
 * `PROVIDER_CONFIG_TIMEOUT_MS` 3 s.
 *
 * This one wraps a whole action that already contains one of them:
 * `persistCheckoutDraft` runs `retrieveCartFresh` — bounded at 5 s — SEQUENTIALLY
 * in front of the PATCH, and the PATCH itself is deliberately unbounded (the SDK's
 * typed `cart.update` takes no request init, and hand-rolling `sdk.client.fetch`
 * on the destructive write was rejected as a bad trade; see the note on
 * `CART_READ_TIMEOUT_MS`). So this MUST exceed 5 s, or it would pre-empt the inner
 * timeout — the half with the better-diagnosed failure path — and turn every slow
 * read into an undiagnosable one. 15 s leaves the read its full budget and the
 * write roughly 10 s.
 *
 * It is a stall breaker, not a UX budget. The customer's feedback on a slow save
 * is the `saving` status line, which is already on screen.
 */
export const CHECKOUT_WRITE_TIMEOUT_MS = 15_000

/**
 * Resolves to {@link TIMED_OUT} rather than rejecting, because the caller is a
 * step in the middle of `performWrite` and a throw there would skip the
 * `CART_WRITE_FAILED` dispatch that is the customer's only feedback.
 *
 * The abandoned promise keeps both handlers attached, so a reply that arrives
 * after the deadline cannot surface as an unhandled rejection. It is otherwise
 * ignored: applying a cart this scheduler has already given up on would move
 * `lastWrite` behind the writes queued after it. Being abandoned makes it behave
 * exactly like a failed write, which is a path the chain already handles.
 */
const TIMED_OUT = Symbol("checkout-write-timeout")

const withDeadline = <T>(
  promise: Promise<T>,
  ms: number
): Promise<T | typeof TIMED_OUT> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })

export type PersistDraft = (
  patch: Partial<CheckoutDraftAddress>,
  email: string | null
) => Promise<{ ok: true; cart: HttpTypes.StoreCart } | { ok: false }>

export type WriteOutcome =
  /** Nothing was unsaved. No request was made — per F2 that is a carrier call saved. */
  | { status: "noop" }
  | { status: "written"; cart: HttpTypes.StoreCart }
  | { status: "failed" }

export type CheckoutWriteSchedulerDeps = {
  /** The freshest state available to the caller. */
  readState: () => CheckoutState
  persist: PersistDraft
  /** The single cart-write sequence source. PR2c must draw from the same one. */
  nextSequence: () => number
  dispatch: (action: CheckoutAction) => void
}

export type CheckoutWriteScheduler = {
  /**
   * Persists whatever is unsaved, serialised against every other call.
   *
   * Awaitable on purpose: the requote path needs the address on the cart before
   * it lists options (the list is filtered server-side on `country_code |
   * province | city | postal_expression`), and awaiting this is how it gets that
   * guarantee without becoming a second writer.
   */
  persistNow: () => Promise<WriteOutcome>
  /**
   * Runs a cart write that is NOT the draft autosave, on the SAME FIFO chain.
   *
   * Exists for `syncCheckoutAddresses` at the CTA (PR2c, task 2c.7). That call
   * writes `shipping_address` — the entity the whole `em.create`
   * PII-destruction finding is about — at a moment when an autosave armed by
   * the customer's last blur is very likely still pending, because 400 ms is
   * roughly the gap between tabbing out of the final field and clicking the
   * button. Letting the two overlap is B1 all over again, at the one moment in
   * the checkout the customer cannot casually retry.
   *
   * `persistNow` could not be reused: its payload is derived from the unsaved
   * draft diff, and the CTA writes both addresses in full. So the WRITE is the
   * caller's, and the SERIALISATION, the sequence and the dispatch are this
   * scheduler's — which keeps the ordering guarantee in the one place that can
   * actually hold it.
   *
   * Cancels any armed autosave before running: a debounce that fires while the
   * order is being placed would put a second writer on the same row for no
   * benefit, since this write persists the same draft anyway.
   */
  runExclusive: (write: ExclusiveWrite) => Promise<WriteOutcome>
  /** Arms a trailing-edge debounce. A previous arming is replaced, latest wins. */
  scheduleAutosave: (delayMs: number) => void
  cancelAutosave: () => void
  isBusy: () => boolean
}

/**
 * A foreign cart write, handed the sequence this scheduler allocated for it.
 *
 * Returns the same discriminated shape as {@link PersistDraft} so both writers
 * reach `performWrite`'s outcome handling by the same route.
 */
export type ExclusiveWrite = (
  sequence: number
) => Promise<{ ok: true; cart: HttpTypes.StoreCart } | { ok: false }>

export function createCheckoutWriteScheduler(
  deps: CheckoutWriteSchedulerDeps
): CheckoutWriteScheduler {
  /**
   * The tail of the FIFO chain. Every `persistNow` links onto it, which is what
   * makes "at most one in flight" true by construction rather than by a flag two
   * callers have to remember to check.
   */
  let tail: Promise<unknown> = Promise.resolve()
  let inFlight = 0

  /**
   * The cart this scheduler's most recent write returned.
   *
   * Needed because `readState()` is not guaranteed to reflect it: React may not
   * have re-rendered between one write's `CART_UPDATED` and the next write
   * starting, since both can happen inside the same microtask drain. Which of the
   * two carts is actually newer is decided by `selectWriteBaseCart` on SEQUENCE,
   * so a cart updated by anything other than this scheduler is never shadowed.
   */
  let lastWrite: PendingWrite = null

  let autosaveTimer: ReturnType<typeof setTimeout> | null = null

  const performWrite = async (): Promise<WriteOutcome> => {
    const state = deps.readState()
    const base = selectWriteBaseCart(state, lastWrite)

    const patch = selectUnsavedDraftPatchAgainst(
      state.draft,
      base?.shipping_address
    )
    const email = selectUnsavedEmailAgainst(state.email, base)

    if (!patch && email === null) {
      return { status: "noop" }
    }

    const sequence = deps.nextSequence()
    deps.dispatch({ type: "CART_WRITE_STARTED", sequence })

    let result: Awaited<ReturnType<PersistDraft>> | typeof TIMED_OUT

    try {
      /**
       * Persists INVALID values too (settled decision 3). The backend normalises
       * the phone and format is the CTA predicate's job; losing what the customer
       * typed is worse than a dirty cart.
       *
       * Raced against a deadline so a reply that never comes cannot hold the FIFO
       * chain — and with it the requote path — open forever.
       */
      result = await withDeadline(
        deps.persist(patch ?? {}, email),
        CHECKOUT_WRITE_TIMEOUT_MS
      )
    } catch {
      /**
       * A rejected server action must not poison the chain: the customer's next
       * blur has to be able to retry. `CART_WRITE_FAILED` is dispatched for the
       * same reason a returned failure is — the status line is the only feedback
       * they get.
       */
      deps.dispatch({ type: "CART_WRITE_FAILED", sequence })
      return { status: "failed" }
    }

    /**
     * A write we gave up waiting for is reported EXACTLY like one that failed.
     * The customer sees the same status line, the next blur retries, and — this is
     * the load-bearing part — the requote effect gets a resolved
     * `{ status: "failed" }` it can act on, so it dispatches `QUOTE_FAILED` and
     * releases the in-flight signature instead of deadlocking on the await.
     */
    if (result === TIMED_OUT || !result.ok) {
      deps.dispatch({ type: "CART_WRITE_FAILED", sequence })
      return { status: "failed" }
    }

    lastWrite = { cart: result.cart, sequence }
    deps.dispatch({ type: "CART_UPDATED", cart: result.cart, sequence })

    return { status: "written", cart: result.cart }
  }

  const persistNow = (): Promise<WriteOutcome> => {
    inFlight += 1

    const run = tail.then(performWrite).finally(() => {
      inFlight -= 1
    })

    // The chain must survive a rejection, or one failed write would strand every
    // later one. `performWrite` already converts failures into outcomes; this is
    // belt and braces against anything it cannot see.
    tail = run.catch(() => undefined)

    return run
  }

  /**
   * The foreign-write counterpart of `performWrite`.
   *
   * Deliberately shares its bookkeeping rather than reimplementing it: the same
   * `CART_WRITE_STARTED` / `CART_WRITE_FAILED` / `CART_UPDATED` sequence, and
   * the same `lastWrite` assignment. That last one is what the total-change
   * guard's retry path depends on — after an abort the customer blurs a field
   * again, and the autosave must diff against the cart THIS write produced or
   * it re-sends fields the CTA already persisted, patching against an address
   * row it no longer has the freshest view of.
   */
  const performExclusiveWrite = async (
    write: ExclusiveWrite
  ): Promise<WriteOutcome> => {
    const sequence = deps.nextSequence()
    deps.dispatch({ type: "CART_WRITE_STARTED", sequence })

    let result: Awaited<ReturnType<ExclusiveWrite>>

    try {
      result = await write(sequence)
    } catch {
      // A rejection must not poison the chain: the customer has to be able to
      // fix whatever went wrong and click the button again.
      deps.dispatch({ type: "CART_WRITE_FAILED", sequence })
      return { status: "failed" }
    }

    if (!result.ok) {
      deps.dispatch({ type: "CART_WRITE_FAILED", sequence })
      return { status: "failed" }
    }

    lastWrite = { cart: result.cart, sequence }
    deps.dispatch({ type: "CART_UPDATED", cart: result.cart, sequence })

    return { status: "written", cart: result.cart }
  }

  return {
    persistNow,

    runExclusive: (write: ExclusiveWrite) => {
      if (autosaveTimer !== null) {
        clearTimeout(autosaveTimer)
        autosaveTimer = null
      }

      inFlight += 1

      const run = tail
        .then(() => performExclusiveWrite(write))
        .finally(() => {
          inFlight -= 1
        })

      tail = run.catch(() => undefined)

      return run
    },

    scheduleAutosave: (delayMs: number) => {
      if (autosaveTimer !== null) {
        clearTimeout(autosaveTimer)
      }

      autosaveTimer = setTimeout(() => {
        autosaveTimer = null
        void persistNow()
      }, delayMs)
    },

    cancelAutosave: () => {
      if (autosaveTimer !== null) {
        clearTimeout(autosaveTimer)
        autosaveTimer = null
      }
    },

    isBusy: () => inFlight > 0,
  }
}

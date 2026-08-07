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
  /** Arms a trailing-edge debounce. A previous arming is replaced, latest wins. */
  scheduleAutosave: (delayMs: number) => void
  cancelAutosave: () => void
  isBusy: () => boolean
}

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

    let result: Awaited<ReturnType<PersistDraft>>

    try {
      /**
       * Persists INVALID values too (settled decision 3). The backend normalises
       * the phone and format is the CTA predicate's job; losing what the customer
       * typed is worse than a dirty cart.
       */
      result = await deps.persist(patch ?? {}, email)
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

    if (!result.ok) {
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

  return {
    persistNow,

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

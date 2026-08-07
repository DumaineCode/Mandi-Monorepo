"use client"

import { persistCheckoutDraft } from "@lib/data/cart"
import {
  calculatePriceForShippingOption,
  listCartShippingMethods,
} from "@lib/data/fulfillment"
import { getPostalCode } from "@lib/data/postal-code"
import {
  AUTOSAVE_DEBOUNCE_MS,
  classifyQuoteResult,
  evaluateQuoteReadiness,
  QUOTE_DEBOUNCE_MS,
} from "@lib/util/shipping-quote"
import type { HttpTypes } from "@medusajs/types"
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from "react"

import {
  checkoutReducer,
  initFromServer,
  selectQuoteIsBlockedByFailure,
  selectQuoteRelevantAddress,
  selectShippingOptionsKey,
  selectShouldLookUpPostalCode,
  type CheckoutAction,
  type CheckoutInit,
  type CheckoutState,
} from "./checkout-reducer"
import { createCheckoutWriteScheduler } from "./checkout-write-scheduler"

/**
 * The single owner of checkout client state, and the only place effects run.
 *
 * `useReducer` + Context, and no new dependency. react-query, SWR and Zustand
 * were all rejected in `design.md` D1: there is no client fetch layer for them
 * to unify — every read and write in this app goes through a `"use server"`
 * action — so they would add 13–40 kB to the highest-intent page in the funnel
 * in exchange for nothing.
 *
 * ## Division of labour, which is the whole point
 *
 * `checkout-reducer.ts` DECIDES: every ordering rule, every invalidation, every
 * supersession check. It is pure and it is spec'd.
 *
 * This file only PERFORMS: fetch, and dispatch the result. It is a `.tsx` client
 * component, so in this repo — node-only vitest, no jsdom, no
 * `@testing-library`, Playwright an explicit non-goal — nothing here can be
 * tested at all. That asymmetry is deliberate: anything resembling a rule that
 * ends up in this file is a rule that has escaped verification, and belongs back
 * in the reducer.
 *
 * ## What was extracted out of here, and why (B1 / W5)
 *
 * The debounce composition and BOTH `persistCheckoutDraft` call sites used to
 * live in this file, and the reducer carried a docstring claiming the shipping
 * address had exactly one writer. It did not. `FIELD_BLUR` and `CP_LOOKUP_FOUND`
 * arm the 400 ms autosave and the 600 ms requote in ONE transition, so the two
 * writers raced by construction — reopening the `em.create` PII-destruction path
 * PR1a closed.
 *
 * That happened precisely because the rule was in a `.tsx`: nothing could test
 * it, so the claim in the docstring was never contradicted by a failing suite.
 * The timing and serialisation rules now live in `checkout-write-scheduler.ts`,
 * where the whole race is driven under `vi.useFakeTimers()` in node. This file
 * owns no write ordering of its own — it arms the scheduler and awaits it.
 */

type CheckoutActions = {
  dispatch: Dispatch<CheckoutAction>
  /**
   * Issues the next cart-write sequence number.
   *
   * ONE counter for every cart write the checkout performs. The reducer applies
   * a response only when nothing newer has been issued, which is what closes
   * `design.md` §14 item 1 — server actions cannot be cancelled, so ordering is
   * enforced on the way back in rather than by an `AbortController` that (as
   * that item records) was never passed to the action and cancelled nothing.
   *
   * A ref rather than reducer state on purpose: the number must be allocated
   * synchronously at call time, and reading it out of a render-scoped value
   * would hand two writes fired in the same tick the same sequence.
   *
   * PR2c's `syncCheckoutAddresses` MUST draw from here too — or, better, go
   * through the write scheduler, which is the only thing that also guarantees
   * the write is not concurrent with the autosave.
   */
  nextWriteSequence: () => number
}

type CheckoutCartValue = {
  cart: HttpTypes.StoreCart | null
  shippingOptions: HttpTypes.StoreCartShippingOption[]
}

/**
 * Three contexts rather than one (W6).
 *
 * A single value memoized on `[state]` churned on EVERY keystroke, re-rendering
 * `ShippingAddress`, `BillingAddress`, `ContactAddressSection`, `CheckoutForm`
 * and — through it — `Shipping`, `Payment` and `Review`, per character typed.
 * `Shipping` re-running is not merely wasteful: its price effect is keyed on the
 * options array, so a churning identity there costs live carrier quotes (C3).
 *
 * Splitting by change frequency is the contained fix:
 *
 * - {@link CheckoutActionsContext} never changes, so a dispatch-only consumer
 *   never re-renders;
 * - {@link CheckoutCartContext} changes only when the cart or the options list
 *   actually change, which is what `CheckoutForm` and everything below it needs;
 * - {@link CheckoutStateContext} carries the draft and churns per keystroke, and
 *   is consumed only by the field components that genuinely render it.
 */
const CheckoutActionsContext = createContext<CheckoutActions | null>(null)
const CheckoutCartContext = createContext<CheckoutCartValue | null>(null)
const CheckoutStateContext = createContext<CheckoutState | null>(null)

const required = <T,>(value: T | null, hook: string): T => {
  if (value === null) {
    throw new Error(`${hook} must be used inside <CheckoutProvider>`)
  }

  return value
}

/** Stable for the provider's lifetime. Prefer this when you only dispatch. */
export function useCheckoutActions(): CheckoutActions {
  return required(useContext(CheckoutActionsContext), "useCheckoutActions")
}

/**
 * The same actions, or `null` outside the provider.
 *
 * For the one component that legitimately has two homes: `discount-code` renders
 * both inside `CheckoutSummary` and inside the CART page's summary, and only the
 * first has client state to keep in step. On the cart page the `revalidateTag`
 * that `applyPromotions` already performs is still the whole mechanism, because
 * that page IS server-rendered on every navigation.
 *
 * Deliberately NOT the default: everything else under this provider needs the
 * context to exist, and swallowing its absence would turn a missing provider into
 * a checkout that silently stops updating instead of a crash in development.
 */
export function useOptionalCheckoutActions(): CheckoutActions | null {
  return useContext(CheckoutActionsContext)
}

/**
 * The server-owned slice. Re-renders on cart and options changes only — NOT on
 * every keystroke, which is what keeps `Shipping`'s price effect from re-firing.
 */
export function useCheckoutCart(): CheckoutCartValue {
  return required(useContext(CheckoutCartContext), "useCheckoutCart")
}

/** The full state, including the per-keystroke draft. */
export function useCheckoutState(): CheckoutState {
  return required(useContext(CheckoutStateContext), "useCheckoutState")
}

export function useCheckout(): CheckoutActions & { state: CheckoutState } {
  const actions = useCheckoutActions()
  const state = useCheckoutState()

  return { ...actions, state }
}

export function CheckoutProvider({
  initial,
  children,
}: {
  initial: CheckoutInit
  children: ReactNode
}) {
  const [state, dispatch] = useReducer(checkoutReducer, initial, initFromServer)

  const writeSequenceRef = useRef(0)
  const nextWriteSequence = () => {
    writeSequenceRef.current += 1
    return writeSequenceRef.current
  }

  /**
   * The latest state, readable from inside an async body without a stale
   * closure. Read-only: every decision taken against it is a pure function
   * exported by the reducer, so the ref carries facts, never rules.
   *
   * Assigned in an effect, NOT during render (W6). Mutating a ref while
   * rendering is a render-phase side effect — the pattern React documents as
   * unsafe, because under concurrent rendering a render can be thrown away or
   * replayed and the ref would then carry state that was never committed. An
   * effect runs after commit, so the ref only ever holds state the tree actually
   * shows. Every reader here is a debounced timer at least 400 ms out or an
   * awaited continuation, so there is no reader that could observe the one-commit
   * lag this introduces.
   */
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const cartId = state.cart?.id ?? null
  const postalCode = state.draft.postal_code

  /**
   * The single cart writer (B1).
   *
   * Created once and held in a ref: it owns the FIFO chain and the cart its last
   * write returned, and recreating it per render would reset both, which is the
   * serialisation guarantee gone. Its dependencies are read through refs for the
   * same reason — the scheduler must outlive any single render.
   */
  const schedulerRef = useRef<ReturnType<
    typeof createCheckoutWriteScheduler
  > | null>(null)

  if (schedulerRef.current === null) {
    schedulerRef.current = createCheckoutWriteScheduler({
      readState: () => stateRef.current,
      persist: persistCheckoutDraft,
      nextSequence: nextWriteSequence,
      dispatch,
    })
  }

  const scheduler = schedulerRef.current

  // -------------------------------------------------------------------------
  // SEPOMEX lookup
  // -------------------------------------------------------------------------

  /**
   * Dedupe guard for the postal-code lookup. The one ref this file keeps, and it
   * guards an EXTERNAL call rather than a state transition: React may re-run an
   * effect for reasons that have nothing to do with the value changing.
   *
   * It is now the ONLY guard on this path. It used to sit beside a `cancelled`
   * flag set from the cleanup function, and the two contradicted each other
   * whenever the effect re-ran for any reason other than a postal-code change —
   * which the dep array makes routine, because
   * `cart.shipping_address.postal_code` moves on the very autosave this lookup
   * arms. Cleanup set `cancelled`, the new body early-returned HERE because the
   * postal code had not changed, and SEPOMEX then answered into a dead callback:
   * `cpStatus` pinned at `"loading"` with no lookup in flight, `selectQuoteStatus`
   * short-circuiting on it, and no order placeable until a page reload.
   *
   * Staleness is a state transition, so it moved to the reducer, which compares
   * the postal code carried on the action against the draft. This ref keeps only
   * the job it was always right about.
   */
  const lastLookedUpCp = useRef("")

  useEffect(() => {
    const cp = (postalCode || "").trim()

    if (!selectShouldLookUpPostalCode(stateRef.current)) {
      /**
       * Reset only for a postal code that is not usable at all. A COMPLETE
       * returning address also lands here — the selector declines it — and
       * resetting `cpStatus` there is correct too: there is no lookup in
       * flight and no list to show.
       */
      lastLookedUpCp.current = ""
      dispatch({ type: "CP_LOOKUP_RESET" })
      return
    }

    if (cp === lastLookedUpCp.current) {
      return
    }
    lastLookedUpCp.current = cp

    dispatch({ type: "CP_LOOKUP_STARTED" })

    /**
     * Every path dispatches, unconditionally. There is no cleanup flag and no
     * early return: a lookup that STARTED must always reach a terminal action,
     * because `CP_LOOKUP_STARTED` is what puts `cpStatus` into `"loading"` and
     * nothing else takes it out. Whether the answer is still wanted is the
     * reducer's call, made against `postalCode` below.
     */
    getPostalCode(cp)
      .then((res) => {
        if (!res || !res.found) {
          dispatch({ type: "CP_LOOKUP_NOT_FOUND", postalCode: cp })
          return
        }

        dispatch({
          type: "CP_LOOKUP_FOUND",
          postalCode: cp,
          province: res.state || "",
          city: res.city || "",
          colonias: res.colonias || [],
        })
      })
      .catch(() => {
        /**
         * A lookup failure is NOT a quote failure and must never block the
         * section. It degrades to manual state/city entry, and once province
         * and city are present by any means the signature completes and quoting
         * proceeds identically.
         */
        dispatch({ type: "CP_LOOKUP_NOT_FOUND", postalCode: cp })
      })

    /**
     * W6: `selectShouldLookUpPostalCode` reads `draft.province`, `draft.city` and
     * the cart's persisted postal code as well as the draft postal code. Its
     * second clause — "province or city is missing, so there is something to fill
     * in" — can flip to `true` without the postal code changing at all (a
     * customer clearing the city on a returning address), and with `[postalCode]`
     * alone the effect never re-ran to notice.
     *
     * The mount-case guard itself is unchanged and still correct: a returning
     * cart with a complete address is still left alone, because the selector
     * still declines it. This only makes the effect re-evaluate when any input to
     * that decision moves.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    postalCode,
    state.draft.province,
    state.draft.city,
    state.cart?.shipping_address?.postal_code,
  ])

  // -------------------------------------------------------------------------
  // Autosave (R6)
  // -------------------------------------------------------------------------

  const blurSequence = state.blurSequence

  useEffect(() => {
    if (blurSequence === 0) {
      return
    }

    /**
     * The whole body is now ONE call. What used to be here — read state, decide
     * whether anything is unsaved, allocate a sequence, write, dispatch the
     * result — is the scheduler's `persistNow`, because every one of those steps
     * is a rule, and none of them could be tested while they lived in a `.tsx`.
     */
    scheduler.scheduleAutosave(AUTOSAVE_DEBOUNCE_MS)

    return () => scheduler.cancelAutosave()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blurSequence])

  // -------------------------------------------------------------------------
  // Requote (R4, D6)
  // -------------------------------------------------------------------------

  const quoteSignature = state.quoteSignature

  useEffect(() => {
    if (!cartId || !quoteSignature) {
      return
    }

    let cancelled = false

    const timer = setTimeout(async () => {
      const current = stateRef.current

      /**
       * A failure parks until the customer edits the address or presses retry.
       * `evaluateQuoteReadiness` deliberately keeps answering `quote` for a
       * failed address — that is what makes it retryable — so without this
       * guard the effect would re-fire on its own and, per F2, spend a live
       * carrier quote on every pass.
       */
      if (selectQuoteIsBlockedByFailure(current)) {
        return
      }

      const decision = evaluateQuoteReadiness({
        draftAddress: selectQuoteRelevantAddress(current.draft),
        lastRequestedSignature: current.quotedSignature,
        inFlightSignature: current.inFlightSignature,
        cartId,
      })

      if (decision.action !== "quote") {
        return
      }

      const signature = decision.signature
      dispatch({ type: "QUOTE_STARTED", signature })

      try {
        /**
         * The address must land before the options are listed — the list is
         * filtered server-side on `country_code | province | city |
         * postal_expression`.
         *
         * This is NOT a second writer (B1). It funnels through the SAME
         * scheduler as the autosave, so when the 400 ms write is still open at
         * 600 ms this WAITS for it instead of racing it, and then finds nothing
         * left to write. That also covers the returning-cart case (edge case 6):
         * `persistNow` reports `noop`, options and prices appear on load without
         * the customer re-touching anything, and no redundant carrier call is
         * spent.
         */
        const persisted = await scheduler.persistNow()

        if (persisted.status === "failed") {
          dispatch({ type: "QUOTE_FAILED", signature })
          return
        }

        const options = await listCartShippingMethods(cartId)

        if (!options) {
          dispatch({ type: "QUOTE_FAILED", signature })
          return
        }

        const calculated = options.filter((o) => o.price_type === "calculated")
        const settled = await Promise.allSettled(
          calculated.map((o) => calculatePriceForShippingOption(o.id, cartId))
        )

        /**
         * `?? null`, never `?? 0`. A calculate call that resolves without an
         * amount has NOT priced the option, and the previous `?? 0` here made
         * that indistinguishable from free shipping: the row rendered $0.00 and
         * selectable, `classifyQuoteResult` counted the round as priced, and the
         * order could be placed with no shipping charged. Both
         * `classifyQuoteResult` and `readAmount` were written to tell those two
         * apart and neither could ever see a null, because it was coerced away
         * one line before they ran.
         */
        const prices: Record<string, number | null> = {}
        settled.forEach((r) => {
          if (r.status === "fulfilled" && r.value?.id) {
            prices[r.value.id] = r.value.amount ?? null
          }
        })

        /**
         * The `unpriceable` vs `not_serviceable` judgement is NOT made here. It
         * lives in `classifyQuoteResult`, where a spec can contradict it — this
         * file is node-untestable, so a rule that stays here is a rule nothing
         * can check. It previously lived here as a two-term boolean that also
         * counted map keys rather than matching per option, so a leftover key
         * from an earlier round could rescue a list none of whose options priced.
         */
        if (classifyQuoteResult({ options, prices }) === "unpriceable") {
          dispatch({ type: "QUOTE_FAILED", signature })
          return
        }

        if (cancelled) {
          return
        }

        /**
         * The reducer drops this whole result if the signature has moved on.
         * That single comparison replaces the `AbortController` +
         * `lastPrefetchedSignature` + `cancelled` triad this change deletes.
         */
        dispatch({ type: "QUOTE_READY", signature, options, prices })
      } catch {
        dispatch({ type: "QUOTE_FAILED", signature })
      }
    }, QUOTE_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartId, quoteSignature, state.failedSignature])

  /**
   * Stable for the provider's lifetime: `dispatch` is stable by contract and
   * `nextWriteSequence` closes over a ref. A dispatch-only consumer therefore
   * never re-renders because someone typed a character (W6).
   */
  const actions = useMemo<CheckoutActions>(
    () => ({ dispatch, nextWriteSequence }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  /**
   * C3: a CONTENT-stable identity for the options list.
   *
   * `QUOTE_READY` replaces `shippingOptions` with a freshly-built array on every
   * successful quote, even when the carrier returned the same options. The
   * `Shipping` component's price effect is keyed on `[availableShippingMethods]`
   * — array IDENTITY, not content — so each new identity re-fanned out
   * `calculatePriceForShippingOption` across every calculated option and flashed
   * the section back to loading. Per F2 each of those is a live Skydropx quote.
   *
   * Keying the memo on the option ids collapses that: the reference changes only
   * when the SET of options changes, which is the only thing `Shipping`'s effect
   * actually cares about. The prices it recomputes are its own; the reducer's
   * `calculatedPrices` are wired up by `shipping-section` in PR2b, which is when
   * this component and its effect are deleted outright.
   */
  const shippingOptionsKey = selectShippingOptionsKey(state.shippingOptions)
  const shippingOptions = useMemo(
    () => state.shippingOptions,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shippingOptionsKey]
  )

  const cartValue = useMemo<CheckoutCartValue>(
    () => ({ cart: state.cart, shippingOptions }),
    [state.cart, shippingOptions]
  )

  return (
    <CheckoutActionsContext.Provider value={actions}>
      <CheckoutCartContext.Provider value={cartValue}>
        <CheckoutStateContext.Provider value={state}>
          {children}
        </CheckoutStateContext.Provider>
      </CheckoutCartContext.Provider>
    </CheckoutActionsContext.Provider>
  )
}

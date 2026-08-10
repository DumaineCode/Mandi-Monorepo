import { placeOrder } from "@lib/data/cart"
import { getCartId } from "@lib/data/cookies"
import { NextRequest, NextResponse } from "next/server"

/**
 * Openpay 3DS return endpoint (SF-3).
 *
 * The customer lands here after completing (or abandoning) the bank's 3DS
 * challenge. This is a Route Handler — NOT a server-component page — because
 * placeOrder mutates cookies and revalidates cache tags, which is illegal
 * during RSC render on Next 15 (design amendment fix 1).
 *
 * Payment outcome is resolved exclusively server-side: placeOrder re-runs
 * cart completion and the Openpay provider re-fetches the charge from the
 * Openpay API. Query params are NEVER read for the outcome — a forged
 * redirect cannot complete an order (OP-4).
 */

/**
 * `step=review` is gone with the four-step checkout; `error=payment_failed`
 * STAYS, and it is now READ.
 *
 * Surfacing it was an explicit non-goal for most of this change, so it was
 * produced and consumed by nothing. That was defensible while `?step=`
 * deadlocked the checkout anyway — the customer could not have acted on the
 * message. It stopped being defensible in the slice that starts taking money:
 * a customer landing here from a declined 3DS challenge saw a pristine
 * checkout, read it as "my click didn't register", and retried — which is a
 * SECOND authorization hold on the same card.
 *
 * `checkout/page.tsx` now reads it through `selectCheckoutEntryError` and seeds
 * `state.error`. The parameter's value must stay exactly `payment_failed`:
 * that rule matches on the literal and deliberately refuses anything else,
 * because the query string is attacker-controlled.
 */
const failureRedirect = (request: NextRequest, countryCode: string) =>
  NextResponse.redirect(
    new URL(`/${countryCode}/checkout?error=payment_failed`, request.url)
  )

const isNextRedirectError = (err: unknown): boolean => {
  const digest = (err as { digest?: unknown })?.digest
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ countryCode: string }> }
) {
  const { countryCode } = await params

  const cartId = await getCartId()

  if (!cartId) {
    return failureRedirect(request, countryCode)
  }

  try {
    await placeOrder(cartId)
  } catch (err) {
    // On success placeOrder redirects to the order confirmation page via
    // next/navigation redirect(), which throws NEXT_REDIRECT. Re-throw so
    // Next.js turns it into the actual redirect response.
    if (isNextRedirectError(err)) {
      throw err
    }

    // Observability: log the failure class + cart id before redirecting.
    // NEVER log card or token data here (PCI boundary).
    console.error(
      `Openpay 3DS return: order completion failed for cart ${cartId} — ` +
        (err instanceof Error
          ? `${err.constructor.name} (${err.name})`
          : `non-Error thrown (${typeof err})`)
    )

    // Charge not captured (declined, abandoned, or verification failed) —
    // send the customer back to the single-page checkout; the cart is intact
    // and the payment is retryable from the CTA.
    return failureRedirect(request, countryCode)
  }

  // placeOrder returned without redirecting: the cart did not complete into
  // an order (payment still pending) — treat as a retryable failure.
  return failureRedirect(request, countryCode)
}

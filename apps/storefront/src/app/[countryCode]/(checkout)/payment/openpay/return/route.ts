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

const failureRedirect = (request: NextRequest, countryCode: string) =>
  NextResponse.redirect(
    new URL(
      `/${countryCode}/checkout?step=review&error=payment_failed`,
      request.url
    )
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

    // Charge not captured (declined, abandoned, or verification failed) —
    // send the customer back to the review step; the cart is intact and the
    // payment is retryable.
    return failureRedirect(request, countryCode)
  }

  // placeOrder returned without redirecting: the cart did not complete into
  // an order (payment still pending) — treat as a retryable failure.
  return failureRedirect(request, countryCode)
}

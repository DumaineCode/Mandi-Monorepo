import { placeOrder } from "@lib/data/cart"
import { getCartId } from "@lib/data/cookies"
import { NextRequest, NextResponse } from "next/server"

/**
 * Mercado Pago Checkout Pro success back_url (MP-3 / SF-4).
 *
 * A Route Handler — NOT an RSC page — because placeOrder mutates cookies and
 * revalidates cache tags, which is illegal during RSC render on Next 15
 * (design amendment fix 1).
 *
 * The redirect itself is informational and is NEVER trusted: order placement is
 * gated exclusively on the server-side payment state (authorizePayment searches
 * MP's payments API; the webhook is the source of truth). When the payment is
 * already confirmed — instant card, or an OXXO whose webhook already fired —
 * placeOrder completes the cart and redirects to the confirmation page. When it
 * is not yet confirmed, the customer is shown the pending experience; the order
 * completes later, webhook-driven.
 */

const isNextRedirectError = (err: unknown): boolean => {
  const digest = (err as { digest?: unknown })?.digest
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")
}

const pendingRedirect = (request: NextRequest, countryCode: string) =>
  NextResponse.redirect(
    new URL(`/${countryCode}/payment/mercadopago/status`, request.url)
  )

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ countryCode: string }> }
) {
  const { countryCode } = await params
  const cartId = await getCartId()

  if (!cartId) {
    // Cart cookie already cleared → the order most likely completed on a prior
    // visit or via webhook. Send the customer to the pending/status page.
    return pendingRedirect(request, countryCode)
  }

  try {
    await placeOrder(cartId)
  } catch (err) {
    // On success placeOrder redirects via next/navigation redirect(), which
    // throws NEXT_REDIRECT — re-throw so Next issues the real redirect.
    if (isNextRedirectError(err)) {
      throw err
    }

    // Payment not confirmed yet (async method still pending, or completion
    // failed): never mark the order paid on the redirect alone. NEVER log
    // payment/token data here.
    console.error(
      `Mercado Pago success return: cart ${cartId} not completed — ` +
        (err instanceof Error
          ? `${err.constructor.name} (${err.name})`
          : `non-Error thrown (${typeof err})`)
    )
    return pendingRedirect(request, countryCode)
  }

  // placeOrder returned without redirecting: the cart did not complete into an
  // order yet (payment pending) — show the pending experience.
  return pendingRedirect(request, countryCode)
}

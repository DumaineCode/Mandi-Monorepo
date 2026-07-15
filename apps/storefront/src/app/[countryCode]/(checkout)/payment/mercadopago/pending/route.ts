import { placeOrder } from "@lib/data/cart"
import { getCartId } from "@lib/data/cookies"
import { NextRequest, NextResponse } from "next/server"

/**
 * Mercado Pago Checkout Pro pending back_url (MP-3 / SF-4).
 *
 * Reached when the customer chose an async method inside MP (e.g. OXXO) and
 * returned before payment is confirmed. Still a Route Handler (not RSC) so it
 * can attempt placeOrder — the MP webhook may have already completed the cart
 * server-side, in which case placeOrder redirects to the confirmation page.
 * Otherwise the customer lands on the pending/status page; the order completes
 * later, webhook-driven. The order is NEVER marked paid on the redirect alone.
 */

const isNextRedirectError = (err: unknown): boolean => {
  const digest = (err as { digest?: unknown })?.digest
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")
}

const statusRedirect = (request: NextRequest, countryCode: string) =>
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
    return statusRedirect(request, countryCode)
  }

  try {
    await placeOrder(cartId)
  } catch (err) {
    if (isNextRedirectError(err)) {
      throw err
    }
    // Expected for a genuinely pending payment — the cart is preserved and the
    // webhook will complete the order when MP confirms the payment.
    return statusRedirect(request, countryCode)
  }

  return statusRedirect(request, countryCode)
}

import { placeOrder } from "@lib/data/cart"
import { getCartId } from "@lib/data/cookies"
import { redirectTargetFrom, toPublicURL } from "@lib/util/public-redirect"
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

const statusRedirect = (countryCode: string) =>
  NextResponse.redirect(
    toPublicURL(`/${countryCode}/payment/mercadopago/status`)
  )

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ countryCode: string }> }
) {
  const { countryCode } = await params
  const cartId = await getCartId()

  if (!cartId) {
    return statusRedirect(countryCode)
  }

  try {
    await placeOrder(cartId)
  } catch (err) {
    // placeOrder's success redirect, re-issued against the public origin
    // instead of the bind address (`0.0.0.0:8000`).
    const target = redirectTargetFrom(err)
    if (target) {
      return NextResponse.redirect(
        toPublicURL(target.destination),
        target.status
      )
    }
    // Expected for a genuinely pending payment — the cart is preserved and the
    // webhook will complete the order when MP confirms the payment.
    return statusRedirect(countryCode)
  }

  return statusRedirect(countryCode)
}

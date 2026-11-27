import { toPublicURL } from "@lib/util/public-redirect"
import { NextRequest, NextResponse } from "next/server"

/**
 * Mercado Pago Checkout Pro failure back_url (MP-3 / SF-4).
 *
 * The payment was rejected or the customer abandoned MP's checkout. The cart is
 * preserved untouched — no order is placed, no session is captured — and the
 * customer is sent back to the single-page checkout to retry with any method.
 * Query params are NEVER used to authorize anything (there is nothing to
 * authorize here); this route only navigates.
 *
 * `step=payment` is gone with the four-step checkout; `error=payment_failed`
 * STAYS, and it is now READ. `checkout/page.tsx` passes it through
 * `selectCheckoutEntryError` and seeds `state.error`, so a customer who
 * abandoned or was rejected by Mercado Pago is told why they are back here
 * instead of reading the return as a click that never registered. The value
 * must stay exactly `payment_failed` — that rule matches on the literal and
 * refuses anything else, because the query string is attacker-controlled.
 *
 * The target is built from the public origin, never `request.url`, which is
 * the bind address (`0.0.0.0:8000`) behind the production proxy.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ countryCode: string }> }
) {
  const { countryCode } = await params
  return NextResponse.redirect(
    toPublicURL(`/${countryCode}/checkout?error=payment_failed`)
  )
}

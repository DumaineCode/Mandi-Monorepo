import { NextRequest, NextResponse } from "next/server"

/**
 * Mercado Pago Checkout Pro failure back_url (MP-3 / SF-4).
 *
 * The payment was rejected or the customer abandoned MP's checkout. The cart is
 * preserved untouched — no order is placed, no session is captured — and the
 * customer is sent back to the payment step to retry with any method. Query
 * params are NEVER used to authorize anything (there is nothing to authorize
 * here); this route only navigates.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ countryCode: string }> }
) {
  const { countryCode } = await params
  return NextResponse.redirect(
    new URL(
      `/${countryCode}/checkout?step=payment&error=payment_failed`,
      request.url
    )
  )
}

"use client"

import { Button, Container, Heading, Text } from "@modules/common/components/ui"
import { useRouter } from "next/navigation"

/**
 * Shown when a dependency the checkout cannot render without failed to load.
 *
 * ## Why this component exists
 *
 * `CheckoutForm` used to `return null` when `listCartShippingMethods` or
 * `listCartPaymentMethods` came back `null`. One timeout or one 5xx therefore
 * rendered the ENTIRE checkout subtree as nothing — no address form, no
 * payment, no message, no way forward. The customer sees a blank page and
 * leaves; the team sees an abandoned cart and no signal.
 *
 * That was survivable while `listCartShippingMethods` was `force-cache`,
 * because a served stale entry masked transient backend blips. Removing the
 * cache was correct — the response is address-filtered, so a stale list is the
 * WRONG list — but it removed the mask without adding a fallback, and it raised
 * the probability of the failure it exposes. This is the fallback.
 *
 * ## Why an error state and not a partial render
 *
 * The distinction is between a FAILED call and a SUCCESSFUL empty one, and an
 * earlier version of this comment blurred them by claiming the empty-list render
 * had been "considered and rejected". It has not been rejected, because it is
 * not this component's decision to make: `listCartShippingMethods` returns
 * `null` only when the call failed, and a successful `[]` is truthy at
 * `checkout-form/index.tsx`, so an empty list still renders the address form
 * with no shipping options exactly as before. That path is untouched.
 *
 * What this component covers is the case where we have NO ANSWER. Rendering the
 * form there would say "no delivery options exist for your address" — a claim
 * about the customer we have no evidence for. An honest "we could not load
 * this" is a smaller lie than a confident wrong answer. When the backend DOES
 * answer with an empty list, that claim is evidence-backed and the form is the
 * right thing to show.
 *
 * Deliberately a client component only so the retry can be a real retry.
 * `router.refresh()` re-runs the server render in place, keeping cart cookies
 * and scroll position, which is what makes a transient failure a two-second
 * annoyance rather than a lost order.
 */
const CheckoutUnavailable = ({ reason }: { reason: string }) => {
  const router = useRouter()

  return (
    <Container
      className="flex flex-col gap-y-4 rounded-large border border-line bg-cream p-6"
      data-testid="checkout-unavailable"
    >
      <Heading level="h2" className="text-xl-semi text-ink">
        No pudimos cargar el checkout
      </Heading>
      <Text className="text-base-regular text-ink-muted">
        {reason} Tu carrito está intacto. Intenta de nuevo en unos segundos.
      </Text>
      <Button
        variant="secondary"
        className="w-fit"
        onClick={() => router.refresh()}
        data-testid="checkout-unavailable-retry"
      >
        Reintentar
      </Button>
    </Container>
  )
}

export default CheckoutUnavailable

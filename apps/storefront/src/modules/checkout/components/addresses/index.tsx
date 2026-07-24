"use client"
import { setAddresses } from "@lib/data/cart"
import useToggleState from "@lib/hooks/use-toggle-state"
import compareAddresses from "@lib/util/compare-addresses"
import { CheckCircleSolid } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import { Heading, Text } from "@modules/common/components/ui"
import Spinner from "@modules/common/icons/spinner"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useActionState, useEffect, useRef } from "react"
import BillingAddress from "../billing_address"
import ErrorMessage from "../error-message"
import ShippingAddress from "../shipping-address"
import type { PrefetchedShipping } from "../shipping-address"
import { SubmitButton } from "../submit-button"

const Addresses = ({
  cart,
  customer,
  availableShippingMethods,
  onPrefetch,
}: {
  cart: HttpTypes.StoreCart | null
  customer: HttpTypes.StoreCustomer | null
  availableShippingMethods?: HttpTypes.StoreCartShippingOption[] | null
  onPrefetch?: (result: PrefetchedShipping) => void
}) => {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const isOpen = searchParams.get("step") === "address"

  const { state: sameAsBilling, toggle: toggleSameAsBilling } = useToggleState(
    cart?.shipping_address && cart?.billing_address
      ? compareAddresses(cart?.shipping_address, cart?.billing_address)
      : true
  )

  const handleEdit = () => {
    router.push(pathname + "?step=address")
  }

  const [result, formAction] = useActionState(setAddresses, null)

  // On error `setAddresses` returns a string; on success it returns a fresh
  // `{ ok: true }` object. Derive the error string (or null) for display.
  const errorMessage = typeof result === "string" ? result : null

  // Client-side navigation replacing the old server redirect: on a successful
  // submit `setAddresses` returns a fresh `{ ok: true }` object, so soft-navigate
  // to the delivery step without a scroll jump. This preserves the client tree
  // (and any prefetched shipping prices) instead of a full remount.
  //
  // Navigate ONLY on success. Because `result` is a new object reference on
  // every successful submit, the effect dependency changes deterministically
  // (Object.is) and fires on each success — including the clean happy path where
  // the previous state was the initial `null`. Error results (a string) never
  // trigger navigation; the ErrorMessage renders instead. `pathname` already
  // carries the `/{countryCode}` prefix (checkout is country-scoped), so the
  // relative push lands on the correct locale's delivery step.
  const submittedRef = useRef(false)
  useEffect(() => {
    const isSuccess =
      typeof result === "object" && result !== null && result.ok === true
    if (submittedRef.current && isOpen && isSuccess) {
      submittedRef.current = false
      router.push(pathname + "?step=delivery", { scroll: false })
    }
  }, [result, isOpen, pathname, router])

  return (
    <div className="rounded-large border border-line bg-paper p-6 small:p-8">
      <div className="flex flex-row items-center justify-between mb-6">
        <Heading
          level="h2"
          className="flex flex-row font-bricolage text-2xl text-ink gap-x-2 items-baseline"
        >
          Dirección de envío
          {!isOpen && <CheckCircleSolid className="text-coral" />}
        </Heading>
        {!isOpen && cart?.shipping_address && (
          <Text>
            <button
              onClick={handleEdit}
              className="text-ink-muted hover:text-ink transition-colors"
              data-testid="edit-address-button"
            >
              Editar
            </button>
          </Text>
        )}
      </div>
      {isOpen ? (
        <form
          action={formAction}
          onSubmit={() => {
            submittedRef.current = true
          }}
        >
          <div className="pb-8">
            <ShippingAddress
              customer={customer}
              checked={sameAsBilling}
              onChange={toggleSameAsBilling}
              cart={cart}
              availableShippingMethods={availableShippingMethods}
              onPrefetch={onPrefetch}
            />

            {!sameAsBilling && (
              <div>
                <Heading
                  level="h2"
                  className="font-bricolage text-xl text-ink gap-x-4 pb-6 pt-8"
                >
                  Dirección de facturación
                </Heading>

                <BillingAddress cart={cart} />
              </div>
            )}
            <SubmitButton className="mt-6" data-testid="submit-address-button">
              Continuar al envío
            </SubmitButton>
            <ErrorMessage
              error={errorMessage}
              data-testid="address-error-message"
            />
          </div>
        </form>
      ) : (
        <div>
          <div className="text-small-regular">
            {cart && cart.shipping_address ? (
              <div className="flex items-start gap-x-8">
                <div className="flex items-start gap-x-1 w-full">
                  <div
                    className="flex flex-col w-1/3"
                    data-testid="shipping-address-summary"
                  >
                    <Text className="txt-medium-plus text-ink mb-1">
                      Dirección de envío
                    </Text>
                    <Text className="txt-medium text-ink-muted">
                      {cart.shipping_address.first_name}{" "}
                      {cart.shipping_address.last_name}
                    </Text>
                    <Text className="txt-medium text-ink-muted">
                      {cart.shipping_address.address_1}{" "}
                      {cart.shipping_address.address_2}
                    </Text>
                    <Text className="txt-medium text-ink-muted">
                      {cart.shipping_address.postal_code},{" "}
                      {cart.shipping_address.city}
                    </Text>
                    <Text className="txt-medium text-ink-muted">
                      {cart.shipping_address.country_code?.toUpperCase()}
                    </Text>
                  </div>

                  <div
                    className="flex flex-col w-1/3 "
                    data-testid="shipping-contact-summary"
                  >
                    <Text className="txt-medium-plus text-ink mb-1">
                      Contacto
                    </Text>
                    <Text className="txt-medium text-ink-muted">
                      {cart.shipping_address.phone}
                    </Text>
                    <Text className="txt-medium text-ink-muted">
                      {cart.email}
                    </Text>
                  </div>

                  <div
                    className="flex flex-col w-1/3"
                    data-testid="billing-address-summary"
                  >
                    <Text className="txt-medium-plus text-ink mb-1">
                      Dirección de facturación
                    </Text>

                    {sameAsBilling ? (
                      <Text className="txt-medium text-ink-muted">
                        La facturación y el envío usan la misma dirección.
                      </Text>
                    ) : (
                      <>
                        <Text className="txt-medium text-ink-muted">
                          {cart.billing_address?.first_name}{" "}
                          {cart.billing_address?.last_name}
                        </Text>
                        <Text className="txt-medium text-ink-muted">
                          {cart.billing_address?.address_1}{" "}
                          {cart.billing_address?.address_2}
                        </Text>
                        <Text className="txt-medium text-ink-muted">
                          {cart.billing_address?.postal_code},{" "}
                          {cart.billing_address?.city}
                        </Text>
                        <Text className="txt-medium text-ink-muted">
                          {cart.billing_address?.country_code?.toUpperCase()}
                        </Text>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <Spinner />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default Addresses
